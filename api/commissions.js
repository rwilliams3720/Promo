import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { applyRate, chargebackCommission } from './_lib/commission-calc.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function decryptField(ciphertext) {
  if (!ciphertext) return null;
  const key = process.env.CUSTOMER_ENCRYPTION_KEY
    ? Buffer.from(process.env.CUSTOMER_ENCRYPTION_KEY, 'hex')
    : null;
  if (!key || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivB64, encB64, tagB64] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(Buffer.from(encB64, 'base64')) + decipher.final('utf8');
  } catch {
    return ciphertext;
  }
}

// Resolve which user's data to use, and whether commissions add-on is active
async function resolveUser(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: acct } = await supabase
    .from('accounts')
    .select('has_commissions_addon, is_admin, commission_bank_config')
    .eq('user_id', user.id)
    .single();

  if (acct) {
    // Owner path
    const hasAddon = acct.has_commissions_addon || acct.is_admin || false;
    return { userId: user.id, dataUserId: user.id, hasAddon, isOwner: true, memberAgentId: null, bankConfig: acct.commission_bank_config || {} };
  }

  // Member path
  const { data: member } = await supabase
    .from('account_members')
    .select('owner_user_id, role, roster_agent_id')
    .eq('member_user_id', user.id)
    .eq('status', 'active')
    .single();

  if (!member) return null;

  const { data: ownerAcct } = await supabase
    .from('accounts')
    .select('has_commissions_addon, is_admin, commission_bank_config')
    .eq('user_id', member.owner_user_id)
    .single();

  const hasAddon = ownerAcct?.has_commissions_addon || ownerAcct?.is_admin || false;
  return {
    userId: user.id,
    dataUserId: member.owner_user_id,
    hasAddon,
    isOwner: false,
    memberRole: member.role,
    memberAgentId: member.roster_agent_id || null,
    bankConfig: ownerAcct?.commission_bank_config || {},
  };
}

// Format month label: "2026-05" → "May 2026"
function monthLabel(yyyyMM) {
  const [yr, mo] = yyyyMM.split('-').map(Number);
  return new Date(yr, mo - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Build a human-readable note explaining which groups blocked payout
function buildThresholdNote(thresholds, groupStatus, groupCounts, groupEarned) {
  const parts = thresholds
    .filter(grp => !groupStatus[grp.id]?.passes)
    .map(grp => {
      const name    = grp.label || 'Group';
      const earned  = groupEarned[grp.id] || 0;
      const count   = groupCounts[grp.id] || 0;
      const reasons = [];
      if (grp.min_count && count < grp.min_count) reasons.push(`${count}/${grp.min_count} policies`);
      if (grp.min_commission && earned <= grp.min_commission) reasons.push(`$${earned.toFixed(0)} of $${grp.min_commission} floor`);
      if ((grp.requires||[]).some(r => !groupStatus[r]?.passes)) reasons.push('prerequisite group not met');
      return `${name}: ${reasons.join(', ') || 'not met'}`;
    });
  return parts.length ? parts.join(' | ') : 'Production minimums not met';
}

function calcStructurePayout(agentId, struct, sales, roster, isFinancialService, actCounts, fromDate, toDate, overrides) {
  if (!struct) return { earned: 0, breakdown: [], threshold_note: null, group_details: null, ungrouped_earned: 0 };
  const payOnIssue = struct.pay_on_issue || false;
  const inMonth = d => d && d >= fromDate && d <= toDate;
  const breakdown = [];

  for (const sale of sales) {
    if (sale.is_cancelled) continue; // cancelled handled separately as chargebacks
    const premium = parseFloat(sale.written_premium) || 0;
    const product = sale.product || 'other';
    const isSplit = !!sale.split_sale;
    const isFS = isFinancialService[sale.subcategory] || false;

    // Product is overridden to a different structure — this structure sits it out
    // so overlapping rates don't double-count the sale (unless override is 'both').
    const ov = (overrides || {})[product];
    if (ov && ov !== 'both' && ov !== struct.id) continue;

    if (sale.agent_id === agentId) {
      const dateOk = payOnIssue ? inMonth(sale.issued_date) : inMonth(sale.sale_date);
      if (dateOk) {
        const defaultRatio = struct.default_split_ratio ?? 0.5;
        const ratio = isSplit ? (sale.split_ratio ?? defaultRatio) : 1;
        const share = premium * ratio;
        const commission = applyRate(struct, product, sale.subcategory || null, share, premium, isFS);
        breakdown.push({ hash: sale.hash, product, premium, share, commission, split: isSplit, role: 'primary', customer_name: decryptField(sale.customer_name), sale_date: sale.sale_date || null, subcategory: sale.subcategory || null });
      }
    }

    if (isSplit && sale.teammate) {
      const tmName = (sale.teammate || '').toLowerCase().trim();
      const tmAgent = roster.find(a => a.name.toLowerCase().trim() === tmName);
      if (tmAgent && tmAgent.agent_id === agentId) {
        const dateOk = payOnIssue ? inMonth(sale.issued_date) : inMonth(sale.sale_date);
        if (dateOk) {
          const defaultRatio = struct.default_split_ratio ?? 0.5;
          const primaryRatio = sale.split_ratio ?? defaultRatio;
          const tmShare = premium * (1 - primaryRatio);
          const commission = applyRate(struct, product, sale.subcategory || null, tmShare, premium, isFS);
          breakdown.push({ hash: sale.hash, product, premium, share: tmShare, commission, split: true, role: 'teammate', customer_name: decryptField(sale.customer_name), sale_date: sale.sale_date || null, subcategory: sale.subcategory || null });
        }
      }
    }
  }

  const thresholds = struct.thresholds || [];
  if (!thresholds.length) {
    const total = Math.round(breakdown.reduce((s, b) => s + b.commission, 0) * 100) / 100;
    return { earned: struct.cap_per_structure != null ? Math.min(total, struct.cap_per_structure) : total, breakdown, threshold_note: null, group_details: null, ungrouped_earned: total };
  }

  const productToGroup = {};
  for (const grp of thresholds) {
    for (const pk of (grp.products || [])) {
      if (!productToGroup[pk]) productToGroup[pk] = grp.id;
    }
  }

  const groupCounts = {}, groupEarned = {}, groupShares = {};
  let ungrouped = 0;
  for (const b of breakdown) {
    const gId = productToGroup[b.product];
    if (gId) {
      if (b.role === 'primary') groupCounts[gId] = (groupCounts[gId] || 0) + 1;
      groupEarned[gId] = (groupEarned[gId] || 0) + b.commission;
      groupShares[gId] = (groupShares[gId] || 0) + b.share;
    } else {
      ungrouped += b.commission;
    }
  }

  const groupStatus = {};
  for (let pass = 0; pass <= thresholds.length; pass++) {
    for (const grp of thresholds) {
      if (groupStatus[grp.id] !== undefined) continue;
      const requiresDone = (grp.requires || []).every(r => groupStatus[r] !== undefined);
      if (!requiresDone) continue;
      const countOk    = !grp.min_count || (groupCounts[grp.id] || 0) >= grp.min_count;
      const requiresOk = (grp.requires || []).every(r => groupStatus[r]?.passes);
      const agActs     = actCounts[agentId] || {};
      const reqActsOk  = (grp.required_activities || []).every(ra =>
        (agActs[ra.activity_type_id] || 0) >= (ra.min_count || 1)
      );
      if (!countOk || !requiresOk || !reqActsOk) {
        groupStatus[grp.id] = { passes: false, payout: 0 };
      } else {
        const earned = groupEarned[grp.id] || 0;
        const floor  = grp.min_commission || 0;
        if (floor === 0) {
          groupStatus[grp.id] = { passes: true, payout: earned };
        } else if (earned > floor) {
          groupStatus[grp.id] = { passes: true, payout: earned - floor };
        } else {
          groupStatus[grp.id] = { passes: false, payout: 0 };
        }
      }
    }
  }
  for (const grp of thresholds) {
    if (groupStatus[grp.id] === undefined) groupStatus[grp.id] = { passes: false, payout: 0 };
  }

  for (const grp of thresholds) {
    if (!groupStatus[grp.id]?.passes) continue;
    for (const esc of (grp.escalators || [])) {
      const triggerCount = esc.trigger_group_id
        ? (groupCounts[esc.trigger_group_id] || 0)
        : esc.activity_type_id
          ? ((actCounts[agentId] || {})[esc.activity_type_id] || 0)
          : -1;
      if (triggerCount < 0) continue;
      const tier = (esc.tiers || []).find(tr =>
        triggerCount >= (tr.min ?? 0) && (tr.max == null || triggerCount <= tr.max)
      );
      if (tier?.bonus_pct) {
        groupStatus[grp.id].payout += (groupShares[grp.id] || 0) * (tier.bonus_pct / 100);
      }
    }
  }

  const groupPayout = thresholds.reduce((s, grp) => s + (groupStatus[grp.id]?.payout || 0), 0);

  // When a group has activity and fails its floor, and no group with activity passes,
  // block ungrouped commissions so a failing structure contributes $0 total.
  const anyGroupActivelyFailed = thresholds.some(grp =>
    !groupStatus[grp.id]?.passes && ((groupCounts[grp.id] || 0) > 0 || (groupEarned[grp.id] || 0) > 0)
  );
  const anyGroupActivelyPassed = thresholds.some(grp =>
    groupStatus[grp.id]?.passes && ((groupCounts[grp.id] || 0) > 0 || (groupEarned[grp.id] || 0) > 0)
  );
  const effectiveUngrouped = (anyGroupActivelyFailed && !anyGroupActivelyPassed) ? 0 : ungrouped;

  const totalEarned = Math.round((effectiveUngrouped + groupPayout) * 100) / 100;
  const cappedEarned = struct.cap_per_structure != null ? Math.min(totalEarned, struct.cap_per_structure) : totalEarned;

  const group_details = thresholds.map(grp => {
    const basePayout = (() => {
      const e = groupEarned[grp.id] || 0;
      const f = grp.min_commission || 0;
      if (!groupStatus[grp.id]?.passes) return 0;
      return f === 0 ? e : Math.max(0, e - f);
    })();
    return {
      label:     grp.label || grp.id,
      count:     groupCounts[grp.id] || 0,
      earned:    Math.round((groupEarned[grp.id] || 0) * 100) / 100,
      shares:    Math.round((groupShares[grp.id] || 0) * 100) / 100,
      floor:     grp.min_commission || 0,
      passes:    groupStatus[grp.id]?.passes || false,
      payout:    Math.round((groupStatus[grp.id]?.payout || 0) * 100) / 100,
      esc_bonus: Math.round(((groupStatus[grp.id]?.payout || 0) - basePayout) * 100) / 100,
    };
  });

  const anyFailed = thresholds.some(grp =>
    !groupStatus[grp.id]?.passes && ((groupCounts[grp.id] || 0) > 0 || (groupEarned[grp.id] || 0) > 0)
  );

  return {
    earned: cappedEarned,
    breakdown,
    threshold_note: anyFailed ? buildThresholdNote(thresholds, groupStatus, groupCounts, groupEarned) : null,
    group_details,
    ungrouped_earned: Math.round(effectiveUngrouped * 100) / 100,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const ctx = await resolveUser(token);
  if (!ctx) return res.status(401).json({ error: 'Invalid token or insufficient access' });
  if (!ctx.hasAddon) return res.status(403).json({ error: 'Commissions add-on required' });

  const { dataUserId, isOwner, memberAgentId, bankConfig } = ctx;

  // ── GET: calculate commissions for a month ───────────────────────────────────
  if (req.method === 'GET') {
    const monthParam = req.query.month; // "YYYY-MM"
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    }

    const [yr, mo] = monthParam.split('-').map(Number);
    const fromDate = `${yr}-${String(mo).padStart(2, '0')}-01`;
    const lastDay  = new Date(yr, mo, 0).getDate();
    const toDate   = `${yr}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const label    = monthLabel(monthParam);

    // Fetch all needed data in parallel
    // Sales: broad OR filter — sale_date OR issued_date within the month (for pay_on_issue support)
    const [salesRes, rosterRes, structuresRes, subcatsRes, agentStructsRes, bankLedgerRes] = await Promise.all([
      supabase.from('sales_log')
        .select('hash, agent_id, product, subcategory, written_premium, split_sale, split_ratio, teammate, sale_date, issued_date, is_cancelled, chargeback_date, chargeback_exempt, customer_name')
        .eq('user_id', dataUserId)
        .or(`and(sale_date.gte.${fromDate},sale_date.lte.${toDate}),and(issued_date.gte.${fromDate},issued_date.lte.${toDate}),and(is_cancelled.eq.true,chargeback_date.gte.${fromDate},chargeback_date.lte.${toDate})`),
      supabase.from('agent_roster')
        .select('agent_id, name, commission_structure_id, commission_all_must_qualify, commission_cap_total, commission_product_overrides')
        .eq('user_id', dataUserId),
      supabase.from('commission_structures')
        .select('id, name, default_split_ratio, pay_on_issue, thresholds, rates')
        .eq('user_id', dataUserId),
      supabase.from('sales_subcategories')
        .select('label, is_financial_service')
        .eq('user_id', dataUserId),
      supabase.from('agent_commission_structures')
        .select('agent_id, commission_structure_id, sort_order')
        .eq('user_id', dataUserId)
        .order('sort_order'),
      // Prior bank ledger entries to compute running balance
      supabase.from('commission_bank')
        .select('agent_id, month, bank_balance_after')
        .eq('user_id', dataUserId)
        .order('created_at', { ascending: false }),
    ]);

    if (salesRes.error)      return res.status(500).json({ error: salesRes.error.message });
    if (rosterRes.error)     return res.status(500).json({ error: rosterRes.error.message });
    if (structuresRes.error) return res.status(500).json({ error: structuresRes.error.message });

    const sales      = salesRes.data      || [];
    const roster     = rosterRes.data     || [];
    const structures = structuresRes.data || [];
    const subcats    = subcatsRes.data    || [];

    // Fetch bonus activity counts for the period (graceful — tables may not exist)
    const actCounts = {}; // { agentId: { typeId: count } }
    try {
      const [actTypesRes, actEntriesRes] = await Promise.all([
        supabase.from('bonus_activity_types').select('id, source, call_disposition').eq('user_id', dataUserId).eq('active', true),
        supabase.from('bonus_activities').select('activity_type_id, agent_id, count').eq('user_id', dataUserId).eq('status', 'approved').gte('activity_date', fromDate).lte('activity_date', toDate),
      ]);
      for (const e of (actEntriesRes.data || [])) {
        if (!actCounts[e.agent_id]) actCounts[e.agent_id] = {};
        actCounts[e.agent_id][e.activity_type_id] = (actCounts[e.agent_id][e.activity_type_id] || 0) + e.count;
      }
      const callTypes = (actTypesRes.data || []).filter(t => t.source === 'call_log');
      if (callTypes.length) {
        const { data: calls } = await supabase.from('call_log').select('agent_id, disposition').eq('user_id', dataUserId).gte('call_dt', fromDate).lte('call_dt', toDate);
        for (const ct of callTypes) {
          for (const c of (calls || [])) {
            if (!c.agent_id) continue;
            if (ct.call_disposition && c.disposition !== ct.call_disposition) continue;
            if (!actCounts[c.agent_id]) actCounts[c.agent_id] = {};
            actCounts[c.agent_id][ct.id] = (actCounts[c.agent_id][ct.id] || 0) + 1;
          }
        }
      }
    } catch(_) { /* bonus tables may not be migrated yet */ }

    // Fetch activity type payment amounts for bonus calculation
    const actPayments = {}; // typeId → payment
    try {
      const { data: actTypesFull } = await supabase
        .from('bonus_activity_types')
        .select('id, payment')
        .eq('user_id', dataUserId)
        .eq('active', true);
      for (const at of (actTypesFull || [])) actPayments[at.id] = parseFloat(at.payment) || 0;
    } catch(_) {}

    // Build lookup maps
    const structureById = {};
    for (const s of structures) structureById[s.id] = s;

    const agentById = {};
    for (const a of roster) agentById[a.agent_id] = a;

    // is_financial_service by subcategory label
    const isFinancialService = {};
    for (const s of subcats) isFinancialService[s.label] = s.is_financial_service || false;

    // Build per-agent structure list from junction table (falls back to single structure_id)
    const agentStructRows = agentStructsRes.data || [];
    const agentStructsByAgent = {};
    for (const row of agentStructRows) {
      if (!agentStructsByAgent[row.agent_id]) agentStructsByAgent[row.agent_id] = [];
      agentStructsByAgent[row.agent_id].push(structureById[row.commission_structure_id]);
    }

    const getStructureList = (agentId) => {
      const multi = agentStructsByAgent[agentId];
      if (multi?.length) return multi.filter(Boolean);
      const single = structureById[agentById[agentId]?.commission_structure_id];
      return single ? [single] : [];
    };

    // Per-agent multi-structure calculation
    const agentResults = {};
    for (const agent of roster) {
      const structList = getStructureList(agent.agent_id);
      const allMustQualify = agent.commission_all_must_qualify || false;
      const productOverrides = agent.commission_product_overrides || {};

      const structureDetails = structList.map(struct => ({
        structure_id:   struct.id,
        structure_name: struct.name,
        ...calcStructurePayout(agent.agent_id, struct, sales, roster, isFinancialService, actCounts, fromDate, toDate, productOverrides),
      }));

      if (allMustQualify && structureDetails.some(sd => sd.threshold_note)) {
        for (const sd of structureDetails) { sd.earned = 0; sd.blocked_by_qualifier = true; }
      }

      const rawTotalEarned = Math.round(structureDetails.reduce((s, sd) => s + sd.earned, 0) * 100) / 100;
      const agentCapTotal  = agentById[agent.agent_id]?.commission_cap_total;
      const totalEarned    = agentCapTotal != null ? Math.min(rawTotalEarned, agentCapTotal) : rawTotalEarned;
      const capTotalNote   = (agentCapTotal != null && rawTotalEarned > agentCapTotal)
        ? `Capped at $${agentCapTotal.toFixed(0)} (earned $${rawTotalEarned.toFixed(0)})` : null;

      // Flatten breakdown for chargeback processing (all structures)
      const allBreakdown = structureDetails.flatMap(sd => sd.breakdown);

      // Combined threshold note
      const failedNotes = structureDetails.filter(sd => sd.threshold_note || sd.blocked_by_qualifier).map(sd =>
        sd.blocked_by_qualifier ? `${sd.structure_name}: blocked (all-must-qualify)` : `${sd.structure_name}: ${sd.threshold_note}`
      );

      agentResults[agent.agent_id] = {
        earned:            totalEarned,
        structure_details: structureDetails.length > 1 ? structureDetails : null,
        // Single-structure compat fields (used when only 1 structure)
        breakdown:         structureDetails.length === 1 ? structureDetails[0].breakdown : allBreakdown,
        threshold_note:    failedNotes.length > 0 ? failedNotes.join(' | ') : null,
        group_details:     structureDetails.length === 1 ? structureDetails[0].group_details : null,
        ungrouped_earned:  structureDetails.length === 1 ? structureDetails[0].ungrouped_earned : null,
        cap_total_note:    capTotalNote,
      };
    }

    // Calculate bonus_earned per agent from activity counts × payment rates
    const bonusEarned = {};
    for (const agent of roster) {
      const agActs = actCounts[agent.agent_id] || {};
      let bonus = 0;
      for (const [typeId, count] of Object.entries(agActs)) {
        bonus += count * (actPayments[typeId] || 0);
      }
      bonusEarned[agent.agent_id] = Math.round(bonus * 100) / 100;
    }

    // Process chargebacks: cancelled sales where chargeback_date falls in this month.
    // Uses the agent's commission_product_overrides to decide attribution when the
    // product is rated in more than one assigned structure — same rule as earned,
    // so a chargeback always deducts exactly what was originally credited.
    const chargebacks = {}; // agentId → [{hash, product, premium, share, commission, chargeback_date}]
    for (const sale of sales) {
      if (!sale.is_cancelled || !sale.chargeback_date) continue;
      const cbDate = sale.chargeback_date;
      if (cbDate < fromDate || cbDate > toDate) continue;
      const primaryId = sale.agent_id;
      const premium   = parseFloat(sale.written_premium) || 0;
      const product   = sale.product || 'other';
      const isSplit   = !!sale.split_sale;
      const isFS      = isFinancialService[sale.subcategory] || false;
      if (primaryId) {
        const structList   = getStructureList(primaryId);
        const defaultRatio = structList[0]?.default_split_ratio ?? 0.5;
        const ratio         = isSplit ? (sale.split_ratio ?? defaultRatio) : 1;
        const share         = premium * ratio;
        const exempt        = !!sale.chargeback_exempt;
        const override      = (agentById[primaryId]?.commission_product_overrides || {})[product];
        const commission    = exempt ? 0 : chargebackCommission(structList, product, sale.subcategory || null, share, premium, isFS, override);
        if (!chargebacks[primaryId]) chargebacks[primaryId] = [];
        chargebacks[primaryId].push({ hash: sale.hash, product, premium, share, commission, chargeback_date: cbDate, exempt });
      }
    }

    // Fetch commission payments for this month
    const { data: payments } = await supabase
      .from('commission_payments')
      .select('agent_id, amount_paid, paid_date, notes')
      .eq('user_id', dataUserId)
      .eq('month', label);

    const paymentByAgent = {};
    for (const p of (payments || [])) paymentByAgent[p.agent_id] = p;

    // Commission bank: build per-agent prior balance lookup
    const bankEnabled   = bankConfig?.enabled || false;
    const bankCap       = bankConfig?.cap_per_period != null ? parseFloat(bankConfig.cap_per_period) : null;
    const bankRate      = parseFloat(bankConfig?.interest_rate || 0) / 100; // annual rate → decimal

    // Most recent prior bank_balance_after per agent (excluding current month)
    const priorBankBalance = {};
    for (const row of (bankLedgerRes.data || [])) {
      if (row.month === label) continue; // skip current month
      if (priorBankBalance[row.agent_id] == null) {
        priorBankBalance[row.agent_id] = parseFloat(row.bank_balance_after) || 0;
      }
    }

    // Build final results — include all agents from roster (even those with no sales)
    let results = roster.map(agent => {
      const res  = agentResults[agent.agent_id] || { earned: 0, breakdown: [], threshold_note: null, group_details: null, ungrouped_earned: null, structure_details: null, cap_total_note: null };
      const paid = paymentByAgent[agent.agent_id] || null;
      const cbList           = chargebacks[agent.agent_id] || [];
      const chargeback_total = Math.round(cbList.reduce((s, c) => s + c.commission, 0) * 100) / 100;
      const agentBonus       = bonusEarned[agent.agent_id] || 0;

      // Prior balance from commission_bank:
      //   > 0 → banked savings (bank-enabled accounts)
      //   < 0 → carry-forward debt from a prior month (any account type)
      const priorBalance     = priorBankBalance[agent.agent_id] || 0;
      const carry_forward_in = Math.min(0, priorBalance);          // prior debt: 0 or negative
      const bankBalanceIn    = bankEnabled ? Math.max(0, priorBalance) : 0; // savings: positive (bank only)

      // Net before carry-forward — can be negative when chargebacks exceed earnings
      const gross_net  = Math.round((res.earned + agentBonus - chargeback_total) * 100) / 100;
      // Apply incoming carry-forward debt to this month's net
      const net_earned = Math.round((gross_net + carry_forward_in) * 100) / 100;

      let carry_forward_out = 0; // debt to push into next month (0 or negative)

      // Commission bank projection
      let bank_summary = null;
      if (bankEnabled) {
        const interest = Math.round(bankBalanceIn * (bankRate / 12) * 100) / 100;
        let paid_out, banked, drawdown;

        if (bankCap != null) {
          if (net_earned >= bankCap) {
            paid_out = bankCap;
            banked   = Math.round((net_earned - bankCap) * 100) / 100;
            drawdown = 0;
          } else {
            // Under cap — draw from bank; if net is negative the deficit grows accordingly
            const deficit = bankCap - net_earned;
            drawdown  = Math.min(deficit, bankBalanceIn + interest);
            paid_out  = Math.round((net_earned + drawdown) * 100) / 100;
            banked    = 0;
          }
        } else {
          if (net_earned >= 0) {
            paid_out = net_earned;
            banked   = 0;
            drawdown = 0;
          } else {
            // Negative net — drain bank to cover as much as possible
            const needed = -net_earned;
            drawdown = Math.min(needed, bankBalanceIn + interest);
            paid_out = Math.round((net_earned + drawdown) * 100) / 100;
            banked   = 0;
          }
        }

        // If bank couldn't fully cover, remainder carries to next month
        if (paid_out < 0) {
          carry_forward_out = Math.round(paid_out * 100) / 100;
          paid_out = 0;
        }

        // Balance after: positive = remaining savings; negative = outstanding debt (stored for next-month carry-forward)
        const rawBalanceAfter = Math.round((bankBalanceIn + interest + banked - drawdown) * 100) / 100;
        const balanceAfter    = carry_forward_out < 0 ? carry_forward_out : Math.max(0, rawBalanceAfter);
        bank_summary = { balance_before: bankBalanceIn, interest, banked, drawdown, paid_out, balance_after: balanceAfter, cap: bankCap };
      } else {
        // No bank — negative net carries forward; agent receives $0 this month
        if (net_earned < 0) {
          carry_forward_out = net_earned; // negative debt
        }
      }

      // Compare recorded payment against expected payout to detect recalculation
      const expectedPaid = bank_summary ? bank_summary.paid_out : Math.max(0, net_earned);
      const recalculated = paid != null && Math.abs(parseFloat(paid.amount_paid) - expectedPaid) > 0.01;

      return {
        agent_id:          agent.agent_id,
        name:              agent.name,
        earned:            res.earned,
        breakdown:         res.breakdown,
        threshold_note:    res.threshold_note,
        group_details:     res.group_details,
        ungrouped_earned:  res.ungrouped_earned,
        structure_details: res.structure_details,
        cap_total_note:    res.cap_total_note || null,
        paid,
        bonus_earned:      agentBonus,
        chargebacks:       cbList,
        chargeback_total,
        carry_forward_in,   // prior debt applied this month (0 or negative)
        carry_forward_out,  // debt to carry into next month (0 or negative)
        net_earned,         // gross_net + carry_forward_in (can be negative)
        recalculated,
        bank_summary,
      };
    });

    // Sort by earned desc
    results.sort((a, b) => b.earned - a.earned);

    // Members linked to a specific agent only see their own row
    if (memberAgentId) {
      results = results.filter(r => r.agent_id === memberAgentId);
    }

    return res.status(200).json({ results, month: label, bank_config: bankConfig });
  }

  // ── PATCH: upsert commission payment ────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!isOwner) return res.status(403).json({ error: 'Only the account owner can record payments' });

    const { month, agentId, amountPaid, paidDate, notes, bankEntry } = req.body || {};
    if (!month || !agentId) return res.status(400).json({ error: 'month and agentId required' });

    const { error } = await supabase
      .from('commission_payments')
      .upsert({
        user_id:     dataUserId,
        month,
        agent_id:    agentId,
        amount_paid: amountPaid != null ? parseFloat(amountPaid) : null,
        paid_date:   paidDate || null,
        notes:       notes    || null,
      }, { onConflict: 'user_id,month,agent_id' });

    if (error) return res.status(500).json({ error: error.message });

    // Save commission bank ledger entry if bank data was provided
    if (bankEntry) {
      try {
        await supabase.from('commission_bank').upsert({
          user_id:             dataUserId,
          agent_id:            agentId,
          month,
          earned:              parseFloat(bankEntry.earned)         || 0,
          cap_amount:          bankEntry.cap       != null ? parseFloat(bankEntry.cap)          : null,
          paid_out:            parseFloat(bankEntry.paid_out)       || 0,
          banked_amount:       parseFloat(bankEntry.banked)         || 0,
          interest_amount:     parseFloat(bankEntry.interest)       || 0,
          bank_balance_before: parseFloat(bankEntry.balance_before) || 0,
          bank_balance_after:  parseFloat(bankEntry.balance_after)  || 0,
          drawdown_amount:     parseFloat(bankEntry.drawdown)       || 0,
          updated_at:          new Date().toISOString(),
        }, { onConflict: 'user_id,agent_id,month' });
      } catch (_) { /* commission_bank table may not be migrated yet */ }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
