// Shared commission-rate math used by api/commissions.js and api/sales.js
// (chargeback mode) so the two reports always agree on dollar amounts.

// Apply commission rate — checks minimum threshold, subcategory override, FS rate, then product default
export function applyRate(structure, product, subcategory, premiumShare, writtenPremium, isFS) {
  const productCfg = structure?.rates?.[product];
  if (!productCfg) return 0;

  // Minimum premium threshold — whole sale must exceed this before any commission
  if (productCfg.minimum != null && writtenPremium < productCfg.minimum) return 0;

  // Subcategory override takes priority over all product-level settings
  if (subcategory && productCfg.subcategories?.[subcategory]) {
    const sub = productCfg.subcategories[subcategory];
    if (!sub.type || sub.type === 'none') return 0;
    let subComm = 0;
    if (sub.type === 'percent') subComm = premiumShare * ((sub.rate || 0) / 100);
    else if (sub.type === 'flat') subComm = sub.rate || 0;
    if (structure.cap_per_policy != null && subComm > structure.cap_per_policy) subComm = structure.cap_per_policy;
    return subComm;
  }

  // No subcategory override — use product default or FS rate
  if (!productCfg.type || productCfg.type === 'none') return 0;

  // Financial service rate overrides the base rate (still uses product's type)
  const rate = (isFS && productCfg.fs_rate != null) ? productCfg.fs_rate : (productCfg.rate || 0);
  let comm = 0;
  if (productCfg.type === 'percent') comm = premiumShare * (rate / 100);
  else if (productCfg.type === 'flat') comm = rate;
  if (structure.cap_per_policy != null && comm > structure.cap_per_policy) comm = structure.cap_per_policy;
  return comm;
}

// Builds a getStructureList(agentId) lookup from the standard roster/junction rows.
export function buildStructureListLookup(roster, structureById, junctionRows) {
  const agentById = {};
  for (const a of roster) agentById[a.agent_id] = a;

  const multiByAgent = {};
  for (const row of junctionRows) {
    (multiByAgent[row.agent_id] ||= []).push(structureById[row.commission_structure_id]);
  }

  const getStructureList = (agentId) => {
    const multi = multiByAgent[agentId];
    if (multi?.length) return multi.filter(Boolean);
    const single = structureById[agentById[agentId]?.commission_structure_id];
    return single ? [single] : [];
  };

  return { agentById, getStructureList };
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// "2026-05" -> "May 2026"
export function monthLabel(yyyyMM) {
  const [yr, mo] = yyyyMM.split('-').map(Number);
  return new Date(yr, mo - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// "April 2026" -> sortable integer (year*12 + monthIndex). null if unparseable — callers
// must skip those rows rather than treat them as chronologically comparable.
export function monthKey(label) {
  const parts = String(label || '').trim().split(' ');
  if (parts.length < 2) return null;
  const idx = MONTH_NAMES.indexOf(parts[0]);
  const yr  = parseInt(parts[1], 10);
  if (idx === -1 || isNaN(yr)) return null;
  return yr * 12 + idx;
}

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

// Computes one structure's payout for one agent over a date range — rates, threshold
// groups, floors, and escalators. decryptField is injected so this module doesn't need
// its own copy of the encryption key handling (api/commissions.js and api/sales.js each
// already have one).
export function calcStructurePayout(agentId, struct, sales, roster, isFinancialService, actCounts, fromDate, toDate, overrides, decryptField) {
  if (!struct) return { earned: 0, breakdown: [], threshold_note: null, group_details: null, ungrouped_earned: 0 };
  const payOnIssue = struct.pay_on_issue || false;
  const inMonth = d => d && d >= fromDate && d <= toDate;
  const breakdown = [];
  const decrypt = decryptField || (v => v);

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
        breakdown.push({ hash: sale.hash, product, premium, share, commission, split: isSplit, role: 'primary', customer_name: decrypt(sale.customer_name), sale_date: sale.sale_date || null, subcategory: sale.subcategory || null });
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
          breakdown.push({ hash: sale.hash, product, premium, share: tmShare, commission, split: true, role: 'teammate', customer_name: decrypt(sale.customer_name), sale_date: sale.sale_date || null, subcategory: sale.subcategory || null });
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

// Computes what a chargeback should deduct: the sale's MARGINAL contribution to the
// agent's payout in the month it was actually earned — (total earned that structure/month
// WITH the sale) minus (WITHOUT it) — rather than a flat per-sale rate. This is the only
// way to correctly reflect floor cliffs (a sale that tipped a threshold group over its
// floor is worth the group's WHOLE payout, not its own raw rate) and escalator tier
// changes. Known limitation: this evaluates each structure independently, so it does not
// replicate agent-level commission_all_must_qualify / commission_cap_total interactions
// across multiple structures — those are rare in combination with chargebacks and adding
// full support would require re-running the whole agent aggregation per candidate month.
//
// ctx: { supabase, dataUserId, roster, isFinancialService, decryptField, cache }
// cache must be a fresh {} created per request — see fetchAgentMonthSales/fetchActCountsForMonth.
export async function computeChargebackAmount(ctx, sale, structList, overrides) {
  if (sale.chargeback_exempt) return 0;
  const relevantStructs = (overrides?.[sale.product] && overrides[sale.product] !== 'both')
    ? structList.filter(s => s.id === overrides[sale.product])
    : structList;
  if (!relevantStructs.length) return 0;

  let total = 0;
  for (const struct of relevantStructs) {
    total += await marginalStructureValue(ctx, sale, struct, overrides);
  }
  return Math.round(total * 100) / 100;
}

// ctx.cache must be a fresh {} created per request (see callers) — these are request-
// scoped memoization caches, not safe to share across requests/invocations, since a warm
// serverless container can reuse module state between unrelated calls and would otherwise
// serve stale sales/activity data.
async function fetchAgentMonthSales(ctx, agentId, ey, em) {
  const cache = (ctx.cache.sales ||= {});
  const key = `${agentId}|${ey}-${em}`;
  if (cache[key]) return cache[key];
  const eFrom = `${ey}-${String(em).padStart(2, '0')}-01`;
  const eLast = new Date(ey, em, 0).getDate();
  const eTo   = `${ey}-${String(em).padStart(2, '0')}-${String(eLast).padStart(2, '0')}`;
  const { data } = await ctx.supabase.from('sales_log')
    .select('hash, agent_id, product, subcategory, written_premium, split_sale, split_ratio, teammate, sale_date, issued_date, is_cancelled, customer_name')
    .eq('user_id', ctx.dataUserId)
    .eq('agent_id', agentId)
    .or(`and(sale_date.gte.${eFrom},sale_date.lte.${eTo}),and(issued_date.gte.${eFrom},issued_date.lte.${eTo})`);
  const rows = data || [];
  cache[key] = rows;
  return rows;
}

async function fetchActCountsForMonth(ctx, ey, em) {
  const cache = (ctx.cache.act ||= {});
  const key = `${ey}-${em}`;
  if (cache[key]) return cache[key];
  const eFrom = `${ey}-${String(em).padStart(2, '0')}-01`;
  const eLast = new Date(ey, em, 0).getDate();
  const eTo   = `${ey}-${String(em).padStart(2, '0')}-${String(eLast).padStart(2, '0')}`;
  const counts = {};
  try {
    const [actTypesRes, actEntriesRes] = await Promise.all([
      ctx.supabase.from('bonus_activity_types').select('id, source, call_disposition').eq('user_id', ctx.dataUserId).eq('active', true),
      ctx.supabase.from('bonus_activities').select('activity_type_id, agent_id, count').eq('user_id', ctx.dataUserId).eq('status', 'approved').gte('activity_date', eFrom).lte('activity_date', eTo),
    ]);
    for (const e of (actEntriesRes.data || [])) {
      if (!counts[e.agent_id]) counts[e.agent_id] = {};
      counts[e.agent_id][e.activity_type_id] = (counts[e.agent_id][e.activity_type_id] || 0) + e.count;
    }
    const callTypes = (actTypesRes.data || []).filter(t => t.source === 'call_log');
    if (callTypes.length) {
      const { data: calls } = await ctx.supabase.from('call_log').select('agent_id, disposition').eq('user_id', ctx.dataUserId).gte('call_dt', eFrom).lte('call_dt', eTo);
      for (const ct of callTypes) {
        for (const c of (calls || [])) {
          if (!c.agent_id) continue;
          if (ct.call_disposition && c.disposition !== ct.call_disposition) continue;
          if (!counts[c.agent_id]) counts[c.agent_id] = {};
          counts[c.agent_id][ct.id] = (counts[c.agent_id][ct.id] || 0) + 1;
        }
      }
    }
  } catch(_) { /* bonus tables may not be migrated yet */ }
  cache[key] = counts;
  return counts;
}

async function marginalStructureValue(ctx, sale, struct, overrides) {
  const dateStr = (struct.pay_on_issue ? sale.issued_date : sale.sale_date) || null;
  if (!dateStr) return 0;
  const [ey, em] = dateStr.split('-').map(Number);
  if (!ey || !em) return 0;
  const eFrom = `${ey}-${String(em).padStart(2, '0')}-01`;
  const eLast = new Date(ey, em, 0).getDate();
  const eTo   = `${ey}-${String(em).padStart(2, '0')}-${String(eLast).padStart(2, '0')}`;

  const [monthSales, monthActCounts] = await Promise.all([
    fetchAgentMonthSales(ctx, sale.agent_id, ey, em),
    fetchActCountsForMonth(ctx, ey, em),
  ]);

  // WITH: temporarily "restore" this one sale (it's cancelled, so calcStructurePayout
  // would otherwise skip it) to see what it contributed when it still counted.
  const withSales    = monthSales.map(s => s.hash === sale.hash ? { ...s, is_cancelled: false } : s);
  const withoutSales = monthSales.filter(s => s.hash !== sale.hash);

  const withEarned    = calcStructurePayout(sale.agent_id, struct, withSales,    ctx.roster, ctx.isFinancialService, monthActCounts, eFrom, eTo, overrides, ctx.decryptField).earned;
  const withoutEarned = calcStructurePayout(sale.agent_id, struct, withoutSales, ctx.roster, ctx.isFinancialService, monthActCounts, eFrom, eTo, overrides, ctx.decryptField).earned;
  return Math.max(0, withEarned - withoutEarned);
}

// Threshold bonuses for a bonus_activity_type — on top of its flat $/occurrence rate.
// Each tier is { count, bonus, repeat }: `repeat: false` (milestone) pays `bonus` once
// when `count` first reaches `tier.count` in the period, no matter how far past it it
// goes; `repeat: true` (per-block) pays `bonus` once for every complete multiple of
// `tier.count` — e.g. tier.count=10 and an actual count of 25 pays 2x. Tiers are
// independent and additive — an activity type can mix milestone and repeating tiers.
export function computeThresholdBonus(count, tiers) {
  let bonus = 0;
  const details = [];
  for (const tier of (tiers || [])) {
    const c = parseInt(tier.count, 10) || 0;
    const b = parseFloat(tier.bonus) || 0;
    if (c <= 0 || b <= 0) continue;
    if (tier.repeat) {
      const times = Math.floor(count / c);
      if (times > 0) {
        bonus += times * b;
        details.push({ count: c, bonus: b, repeat: true, times });
      }
    } else if (count >= c) {
      bonus += b;
      details.push({ count: c, bonus: b, repeat: false, times: 1 });
    }
  }
  return { bonus: Math.round(bonus * 100) / 100, details };
}
