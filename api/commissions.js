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
    const [salesRes, rosterRes, structuresRes, subcatsRes] = await Promise.all([
      supabase.from('sales_log')
        .select('hash, agent_id, product, subcategory, written_premium, split_sale, split_ratio, teammate, sale_date, issued_date')
        .eq('user_id', dataUserId)
        .or(`and(sale_date.gte.${fromDate},sale_date.lte.${toDate}),and(issued_date.gte.${fromDate},issued_date.lte.${toDate})`),
      supabase.from('agent_roster')
        .select('agent_id, name, commission_structure_id')
        .eq('user_id', dataUserId),
      supabase.from('commission_structures')
        .select('id, name, default_split_ratio, pay_on_issue, thresholds, rates')
        .eq('user_id', dataUserId),
      supabase.from('sales_subcategories')
        .select('label, is_financial_service')
        .eq('user_id', dataUserId),
    ]);

    if (salesRes.error)      return res.status(500).json({ error: salesRes.error.message });
    if (rosterRes.error)     return res.status(500).json({ error: rosterRes.error.message });
    if (structuresRes.error) return res.status(500).json({ error: structuresRes.error.message });

    const sales      = salesRes.data      || [];
    const roster     = rosterRes.data     || [];
    const structures = structuresRes.data || [];
    const subcats    = subcatsRes.data    || [];

    // Build lookup maps
    const structureById = {};
    for (const s of structures) structureById[s.id] = s;

    const agentById = {};
    for (const a of roster) agentById[a.agent_id] = a;

    // is_financial_service by subcategory label
    const isFinancialService = {};
    for (const s of subcats) isFinancialService[s.label] = s.is_financial_service || false;

    // Accumulator: agentId → { earned, breakdown }
    const accumulator = {};
    const ensureAgent = (agentId) => {
      if (!accumulator[agentId]) {
        const agent = agentById[agentId];
        accumulator[agentId] = {
          agent_id: agentId,
          name: agent?.name || agentId,
          earned: 0,
          breakdown: [],
        };
      }
    };

    const getStructure = (agentId) => {
      const agent = agentById[agentId];
      if (agent?.commission_structure_id) return structureById[agent.commission_structure_id] || null;
      return null;
    };

    // Check whether a sale date falls in the target month
    const inMonth = (dateStr) => dateStr && dateStr >= fromDate && dateStr <= toDate;

    // Process each sale
    for (const sale of sales) {
      const premium   = parseFloat(sale.written_premium) || 0;
      const product   = sale.product || 'other';
      const isSplit   = !!sale.split_sale;
      const primaryId = sale.agent_id;
      const isFS      = isFinancialService[sale.subcategory] || false;

      if (primaryId) {
        const struct       = getStructure(primaryId);
        const payOnIssue   = struct?.pay_on_issue || false;
        const dateOk       = payOnIssue ? inMonth(sale.issued_date) : inMonth(sale.sale_date);
        if (dateOk) {
          const defaultRatio = struct?.default_split_ratio ?? 0.5;
          const ratio        = isSplit ? (sale.split_ratio ?? defaultRatio) : 1;
          const share        = premium * ratio;
          const commission   = applyRate(struct, product, sale.subcategory || null, share, premium, isFS);

          ensureAgent(primaryId);
          accumulator[primaryId].earned += commission;
          accumulator[primaryId].breakdown.push({
            hash:       sale.hash,
            product,
            premium,
            share,
            commission,
            split:      isSplit,
            role:       'primary',
          });
        }
      }

      // Teammate (split sale only) — match by name against roster
      if (isSplit && sale.teammate) {
        const teammateName  = (sale.teammate || '').toLowerCase().trim();
        const teammateAgent = roster.find(a => a.name.toLowerCase().trim() === teammateName);
        if (teammateAgent) {
          const tmId         = teammateAgent.agent_id;
          const struct       = getStructure(tmId);
          const payOnIssue   = struct?.pay_on_issue || false;
          const dateOk       = payOnIssue ? inMonth(sale.issued_date) : inMonth(sale.sale_date);
          if (dateOk) {
            const defaultRatio = struct?.default_split_ratio ?? 0.5;
            const primaryRatio = sale.split_ratio ?? defaultRatio;
            const tmShare      = premium * (1 - primaryRatio);
            const commission   = applyRate(struct, product, sale.subcategory || null, tmShare, premium, isFS);

            ensureAgent(tmId);
            accumulator[tmId].earned += commission;
            accumulator[tmId].breakdown.push({
              hash:       sale.hash,
              product,
              premium,
              share:      tmShare,
              commission,
              split:      true,
              role:       'teammate',
            });
          }
        }
      }
    }

    // Apply production group thresholds per agent
    for (const agent of roster) {
      const struct     = getStructure(agent.agent_id);
      const thresholds = struct?.thresholds || [];
      if (!thresholds.length) continue;
      const acc = accumulator[agent.agent_id];
      if (!acc) continue;

      // Map each product to the first group that claims it
      const productToGroup = {};
      for (const grp of thresholds) {
        for (const pk of (grp.products || [])) {
          if (!productToGroup[pk]) productToGroup[pk] = grp.id;
        }
      }

      // Aggregate per-group: policy counts (primary only), earned commission, and premium shares
      const groupCounts  = {};
      const groupEarned  = {};
      const groupShares  = {};  // sum of premium shares — used by escalators to apply bonus as rate points
      let   ungrouped    = 0;

      for (const b of acc.breakdown) {
        const gId = productToGroup[b.product];
        if (gId) {
          if (b.role === 'primary') groupCounts[gId] = (groupCounts[gId] || 0) + 1;
          groupEarned[gId] = (groupEarned[gId] || 0) + b.commission;
          groupShares[gId] = (groupShares[gId] || 0) + b.share;
        } else {
          ungrouped += b.commission;
        }
      }

      // Topological group evaluation — multiple passes handle dependency chains
      const groupStatus = {};  // id → {passes:bool, payout:number}
      for (let pass = 0; pass <= thresholds.length; pass++) {
        for (const grp of thresholds) {
          if (groupStatus[grp.id] !== undefined) continue;
          const requiresDone = (grp.requires || []).every(r => groupStatus[r] !== undefined);
          if (!requiresDone) continue;

          const countOk    = !grp.min_count || (groupCounts[grp.id] || 0) >= grp.min_count;
          const requiresOk = (grp.requires || []).every(r => groupStatus[r]?.passes);

          if (!countOk || !requiresOk) {
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
      // Default any unresolved (circular deps) to failed
      for (const grp of thresholds) {
        if (groupStatus[grp.id] === undefined) groupStatus[grp.id] = { passes: false, payout: 0 };
      }

      // Apply escalator bonuses — bonus_pct adds percentage points to the effective rate.
      // Bonus = this group's premium shares × bonus_pct%, NOT commission × bonus_pct%.
      // e.g. 12% rate → $1,000 commission on $8,333 share; +2% escalator → $8,333 × 2% = $167 bonus → $1,167 total (same as 14% rate).
      for (const grp of thresholds) {
        if (!groupStatus[grp.id]?.passes) continue;
        for (const esc of (grp.escalators || [])) {
          if (!esc.trigger_group_id) continue;
          const triggerCount = groupCounts[esc.trigger_group_id] || 0;
          const tier = (esc.tiers || []).find(tr =>
            triggerCount >= (tr.min ?? 0) &&
            (tr.max == null || triggerCount <= tr.max)
          );
          if (tier && tier.bonus_pct) {
            groupStatus[grp.id].payout += (groupShares[grp.id] || 0) * (tier.bonus_pct / 100);
          }
        }
      }

      const groupPayout = thresholds.reduce((s, grp) => s + (groupStatus[grp.id]?.payout || 0), 0);
      acc.earned = Math.round((ungrouped + groupPayout) * 100) / 100;

      // Store group-level details for breakdown display
      acc.ungrouped_earned = Math.round(ungrouped * 100) / 100;
      acc.group_details = thresholds.map(grp => {
        const basePayoutBeforeEsc = (() => {
          const e = groupEarned[grp.id] || 0;
          const f = grp.min_commission || 0;
          if (!groupStatus[grp.id]?.passes) return 0;
          return f === 0 ? e : Math.max(0, e - f);
        })();
        return {
          label:      grp.label || grp.id,
          count:      groupCounts[grp.id] || 0,
          earned:     Math.round((groupEarned[grp.id] || 0) * 100) / 100,
          shares:     Math.round((groupShares[grp.id] || 0) * 100) / 100,
          floor:      grp.min_commission || 0,
          passes:     groupStatus[grp.id]?.passes || false,
          payout:     Math.round((groupStatus[grp.id]?.payout || 0) * 100) / 100,
          esc_bonus:  Math.round(((groupStatus[grp.id]?.payout || 0) - basePayoutBeforeEsc) * 100) / 100,
        };
      });

      // Note if any group with sales/earnings failed
      const anyFailed = thresholds.some(grp =>
        !groupStatus[grp.id]?.passes &&
        ((groupCounts[grp.id] || 0) > 0 || (groupEarned[grp.id] || 0) > 0)
      );
      acc.threshold_note = anyFailed ? buildThresholdNote(thresholds, groupStatus, groupCounts, groupEarned) : null;
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
      const acc  = accumulator[agent.agent_id];
      const paid = paymentByAgent[agent.agent_id] || null;
      return {
        agent_id:        agent.agent_id,
        name:            agent.name,
        earned:          acc ? Math.round(acc.earned * 100) / 100 : 0,
        breakdown:       acc ? acc.breakdown : [],
        threshold_note:  acc?.threshold_note || null,
        group_details:   acc?.group_details   || null,
        ungrouped_earned: acc?.ungrouped_earned ?? null,
        paid,
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
