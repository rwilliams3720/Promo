import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Resolve which user's data to use, and whether commissions add-on is active
async function resolveUser(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: acct } = await supabase
    .from('accounts')
    .select('has_commissions_addon, is_admin')
    .eq('user_id', user.id)
    .single();

  if (acct) {
    // Owner path
    const hasAddon = acct.has_commissions_addon || acct.is_admin || false;
    return { userId: user.id, dataUserId: user.id, hasAddon, isOwner: true, memberAgentId: null };
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
    .select('has_commissions_addon, is_admin')
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
  };
}

// Format month label: "2026-05" → "May 2026"
function monthLabel(yyyyMM) {
  const [yr, mo] = yyyyMM.split('-').map(Number);
  return new Date(yr, mo - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Apply commission rate — checks minimum threshold, subcategory override, FS rate, then product default
function applyRate(structure, product, subcategory, premiumShare, writtenPremium, isFS) {
  const productCfg = structure?.rates?.[product];
  if (!productCfg) return 0;

  // Minimum premium threshold — whole sale must exceed this before any commission
  if (productCfg.minimum != null && writtenPremium < productCfg.minimum) return 0;

  // Subcategory override takes priority over all product-level settings
  if (subcategory && productCfg.subcategories?.[subcategory]) {
    const sub = productCfg.subcategories[subcategory];
    if (!sub.type || sub.type === 'none') return 0;
    if (sub.type === 'percent') return premiumShare * ((sub.rate || 0) / 100);
    if (sub.type === 'flat')    return sub.rate || 0;
  }

  // No subcategory override — use product default or FS rate
  if (!productCfg.type || productCfg.type === 'none') return 0;

  // Financial service rate overrides the base rate (still uses product's type)
  const rate = (isFS && productCfg.fs_rate != null) ? productCfg.fs_rate : (productCfg.rate || 0);
  if (productCfg.type === 'percent') return premiumShare * (rate / 100);
  if (productCfg.type === 'flat')    return rate;
  return 0;
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

function calcStructurePayout(agentId, struct, sales, roster, isFinancialService, actCounts, fromDate, toDate) {
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

    if (sale.agent_id === agentId) {
      const dateOk = payOnIssue ? inMonth(sale.issued_date) : inMonth(sale.sale_date);
      if (dateOk) {
        const defaultRatio = struct.default_split_ratio ?? 0.5;
        const ratio = isSplit ? (sale.split_ratio ?? defaultRatio) : 1;
        const share = premium * ratio;
        const commission = applyRate(struct, product, sale.subcategory || null, share, premium, isFS);
        breakdown.push({ hash: sale.hash, product, premium, share, commission, split: isSplit, role: 'primary' });
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
          breakdown.push({ hash: sale.hash, product, premium, share: tmShare, commission, split: true, role: 'teammate' });
        }
      }
    }
  }

  const thresholds = struct.thresholds || [];
  if (!thresholds.length) {
    const total = Math.round(breakdown.reduce((s, b) => s + b.commission, 0) * 100) / 100;
    return { earned: total, breakdown, threshold_note: null, group_details: null, ungrouped_earned: total };
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
  const totalEarned = Math.round((ungrouped + groupPayout) * 100) / 100;

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
    earned: totalEarned,
    breakdown,
    threshold_note: anyFailed ? buildThresholdNote(thresholds, groupStatus, groupCounts, groupEarned) : null,
    group_details,
    ungrouped_earned: Math.round(ungrouped * 100) / 100,
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

  const { dataUserId, isOwner, memberAgentId } = ctx;

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
    const [salesRes, rosterRes, structuresRes, subcatsRes, agentStructsRes] = await Promise.all([
      supabase.from('sales_log')
        .select('hash, agent_id, product, subcategory, written_premium, split_sale, split_ratio, teammate, sale_date, issued_date, is_cancelled, chargeback_date')
        .eq('user_id', dataUserId)
        .or(`and(sale_date.gte.${fromDate},sale_date.lte.${toDate}),and(issued_date.gte.${fromDate},issued_date.lte.${toDate})`),
      supabase.from('agent_roster')
        .select('agent_id, name, commission_structure_id, commission_all_must_qualify')
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

      const structureDetails = structList.map(struct => ({
        structure_id:   struct.id,
        structure_name: struct.name,
        ...calcStructurePayout(agent.agent_id, struct, sales, roster, isFinancialService, actCounts, fromDate, toDate),
      }));

      if (allMustQualify && structureDetails.some(sd => sd.threshold_note)) {
        for (const sd of structureDetails) { sd.earned = 0; sd.blocked_by_qualifier = true; }
      }

      const totalEarned = Math.round(structureDetails.reduce((s, sd) => s + sd.earned, 0) * 100) / 100;

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

    // Process chargebacks: cancelled sales where chargeback_date falls in this month
    // Use first structure for chargeback rate calculation (backward-compatible)
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
        const struct       = getStructureList(primaryId)[0] || null;
        const defaultRatio = struct?.default_split_ratio ?? 0.5;
        const ratio        = isSplit ? (sale.split_ratio ?? defaultRatio) : 1;
        const share        = premium * ratio;
        const commission   = applyRate(struct, product, sale.subcategory || null, share, premium, isFS);
        if (!chargebacks[primaryId]) chargebacks[primaryId] = [];
        chargebacks[primaryId].push({ hash: sale.hash, product, premium, share, commission, chargeback_date: cbDate });
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

    // Build final results — include all agents from roster (even those with no sales)
    let results = roster.map(agent => {
      const res  = agentResults[agent.agent_id] || { earned: 0, breakdown: [], threshold_note: null, group_details: null, ungrouped_earned: null, structure_details: null };
      const paid = paymentByAgent[agent.agent_id] || null;
      const cbList           = chargebacks[agent.agent_id] || [];
      const chargeback_total = Math.round(cbList.reduce((s, c) => s + c.commission, 0) * 100) / 100;
      const agentBonus       = bonusEarned[agent.agent_id] || 0;
      const net_earned       = Math.round((res.earned - chargeback_total) * 100) / 100;
      const recalculated     = paid != null && Math.abs(parseFloat(paid.amount_paid) - (res.earned + agentBonus - chargeback_total)) > 0.01;
      return {
        agent_id:          agent.agent_id,
        name:              agent.name,
        earned:            res.earned,
        breakdown:         res.breakdown,
        threshold_note:    res.threshold_note,
        group_details:     res.group_details,
        ungrouped_earned:  res.ungrouped_earned,
        structure_details: res.structure_details,
        paid,
        bonus_earned:      agentBonus,
        chargebacks:       cbList,
        chargeback_total,
        net_earned,
        recalculated,
      };
    });

    // Sort by earned desc
    results.sort((a, b) => b.earned - a.earned);

    // Members linked to a specific agent only see their own row
    if (memberAgentId) {
      results = results.filter(r => r.agent_id === memberAgentId);
    }

    return res.status(200).json({ results, month: label });
  }

  // ── PATCH: upsert commission payment ────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!isOwner) return res.status(403).json({ error: 'Only the account owner can record payments' });

    const { month, agentId, amountPaid, paidDate, notes } = req.body || {};
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
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
