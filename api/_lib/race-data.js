// Shared race_data rebuild logic used by api/sales.js and api/checklist-form.js so the
// two stay in sync — this exact class of bug (duplicated totals logic drifting apart) is
// why one path used sale_weight and the other silently ignored it.
//
// Split sales are represented as TWO independent sales_log rows — one per agent, each
// with its own agent_id, its own (already-split) written_premium, and sale_weight=0.5 —
// not one row with a "teammate" field standing in for a second agent. Each row's
// agent_id is always the real owning agent, so a plain per-row `totals[row.agent_id]`
// tally is correct and can't double-count: crediting via `teammate` as well would double
// a split sale's credit for both agents once each row properly exists for its own agent.
// See CLAUDE.md "Split sales" note for how this was verified against production data.

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export async function rebuildRaceData(supabase, dataUserId, agentIds) {
  const ids = [...new Set(agentIds.filter(Boolean))];
  if (!ids.length) return;

  const { data: rosterRows } = await supabase
    .from('agent_roster')
    .select('agent_id, name')
    .eq('user_id', dataUserId)
    .in('agent_id', ids);
  const nameMap = {};
  for (const r of (rosterRows || [])) nameMap[r.agent_id] = r.name;

  const ensureRows = ids.map(id => ({
    user_id: dataUserId,
    agent_id: id,
    name: nameMap[id] || id,
    team: 'sales',
    wl: 0, ul: 0, term: 0, health: 0, auto: 0, fire: 0,
    placed: 0, answered: 0, missed: 0, voicemail: 0,
    talk_min: 0, avg_min: 0,
    race_wide_missed: 0, race_wide_voicemail: 0,
  }));
  await supabase.from('race_data').upsert(ensureRows, { onConflict: 'user_id,agent_id', ignoreDuplicates: true });

  // Scope to current race month so historical sales don't inflate live race totals
  const { data: cfgRow } = await supabase
    .from('race_config')
    .select('value')
    .eq('user_id', dataUserId)
    .eq('key', 'current_month')
    .single();
  const currentMonth = cfgRow?.value || '';
  let fromDate = null, toDate = null;
  if (currentMonth) {
    const parts = currentMonth.trim().split(' ');
    let idx = MONTH_NAMES.indexOf(parts[0]);
    if (idx === -1) idx = MONTH_ABBR.indexOf(parts[0]);
    const yr = parseInt(parts[1]);
    if (idx !== -1 && !isNaN(yr)) {
      fromDate = `${yr}-${String(idx + 1).padStart(2, '0')}-01`;
      const nextMo = idx === 11 ? 1 : idx + 2;
      const nextYr = idx === 11 ? yr + 1 : yr;
      toDate = `${nextYr}-${String(nextMo).padStart(2, '0')}-01`;
    }
  }

  let q = supabase.from('sales_log').select('agent_id, product, sale_weight').eq('user_id', dataUserId).eq('is_cancelled', false).in('agent_id', ids);
  if (fromDate) q = q.gte('sale_date', fromDate);
  if (toDate)   q = q.lt('sale_date', toDate);
  const { data: salesRows } = await q;

  const totals = {};
  for (const id of ids) totals[id] = { wl: 0, ul: 0, term: 0, health: 0, auto: 0, fire: 0 };
  for (const row of (salesRows || [])) {
    const cat = row.product;
    if (cat === 'other' || cat === 'deposit' || cat === 'skip' || !row.agent_id) continue;
    if (!totals[row.agent_id]) continue;
    if (totals[row.agent_id][cat] !== undefined) totals[row.agent_id][cat] += (row.sale_weight ?? 1);
  }

  const now = new Date().toISOString();
  for (const id of ids) {
    const { error } = await supabase.from('race_data').update({
      ...totals[id],
      last_updated: now,
    }).eq('user_id', dataUserId).eq('agent_id', id);
    // Never let a write failure here pass silently — it used to (this is exactly how a
    // split sale's fractional total once failed against the old integer columns without
    // anyone noticing). Log so it's at least visible in Vercel logs; callers already
    // treat rebuildRaceData as best-effort (wrapped in .catch() at call sites).
    if (error) console.error(`rebuildRaceData: race_data update failed for agent ${id}:`, error.message);
  }
}
