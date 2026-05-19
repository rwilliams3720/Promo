import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function rebuildRaceData(dataUserId, agentIds) {
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

  const { data: salesRows } = await supabase
    .from('sales_log')
    .select('agent_id, product')
    .eq('user_id', dataUserId)
    .in('agent_id', ids);

  const totals = {};
  for (const id of ids) totals[id] = { wl: 0, ul: 0, term: 0, health: 0, auto: 0, fire: 0 };
  for (const row of (salesRows || [])) {
    const cat = row.product;
    if (cat === 'other' || cat === 'deposit' || cat === 'skip' || !row.agent_id) continue;
    if (!totals[row.agent_id]) continue;
    if (totals[row.agent_id][cat] !== undefined) totals[row.agent_id][cat]++;
  }

  const now = new Date().toISOString();
  for (const id of ids) {
    await supabase.from('race_data').update({
      ...totals[id],
      last_updated: now,
    }).eq('user_id', dataUserId).eq('agent_id', id);
  }
}

function sha256Short(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

function privacyName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0].slice(0, 2) + ' ' + parts.slice(1).join(' ');
}

async function resolveUser(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: acct } = await supabase.from('accounts').select('has_sales_addon, sales_entry_mode, is_admin').eq('user_id', user.id).single();
  let dataUserId = user.id;
  let hasSalesAddon = (acct?.has_sales_addon || acct?.is_admin) ?? false;
  if (!acct) {
    const { data: member } = await supabase
      .from('account_members')
      .select('owner_user_id, role')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .single();
    if (!member) return null;
    if (!['captain', 'chief_officer'].includes(member.role)) return null;
    dataUserId = member.owner_user_id;
    const { data: ownerAcct } = await supabase.from('accounts').select('has_sales_addon, is_admin').eq('user_id', dataUserId).single();
    hasSalesAddon = (ownerAcct?.has_sales_addon || ownerAcct?.is_admin) ?? false;
  }
  return { userId: user.id, dataUserId, hasSalesAddon };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const ctx = await resolveUser(token);
  if (!ctx) return res.status(401).json({ error: 'Invalid token or insufficient access' });
  if (!ctx.hasSalesAddon) return res.status(403).json({ error: 'Sales tracking add-on required' });

  const { dataUserId } = ctx;

  // ── GET: list manual/checklist entries ────────────────────────────────────
  if (req.method === 'GET') {
    const { month, year, includeUnissued, includeHidden } = req.query;

    const now      = new Date();
    const selYear  = parseInt(year)  || now.getFullYear();
    const selMonth = parseInt(month) || (now.getMonth() + 1);
    const allYear  = req.query.allYear === '1';
    let fromDate = allYear ? `${selYear}-01-01` : `${selYear}-${String(selMonth).padStart(2,'0')}-01`;
    const lastDay  = allYear ? 31 : new Date(selYear, selMonth, 0).getDate();
    let toDate   = allYear ? `${selYear}-12-31` : `${selYear}-${String(selMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    if (req.query.fromDate) fromDate = req.query.fromDate;
    if (req.query.toDate)   toDate   = req.query.toDate;

    const COLS = 'hash, agent_id, product, subcategory, sale_date, issued_date, written_premium, source, customer_name, lead_source, period, auto_issued, split_sale, split_ratio, teammate, checklist_id, hidden, location, is_cancelled, chargeback_date';

    // Selected month
    let q1 = supabase.from('sales_log').select(COLS)
      .eq('user_id', dataUserId)
      .in('source', ['manual', 'checklist'])
      .gte('sale_date', fromDate)
      .lte('sale_date', toDate)
      .order('sale_date', { ascending: false });
    if (includeHidden !== '1') q1 = q1.or('hidden.is.null,hidden.eq.false');

    const { data: monthData, error } = await q1;
    if (error) return res.status(500).json({ error: error.message });

    // Cross-month unissued (if requested)
    let unissuedData = [];
    if (includeUnissued === '1') {
      let q2 = supabase.from('sales_log').select(COLS)
        .eq('user_id', dataUserId)
        .in('source', ['manual', 'checklist'])
        .is('issued_date', null)
        .or(`sale_date.lt.${fromDate},sale_date.gt.${toDate}`)
        .order('sale_date', { ascending: false })
        .limit(100);
      if (includeHidden !== '1') q2 = q2.or('hidden.is.null,hidden.eq.false');
      const { data: d2 } = await q2;
      unissuedData = d2 || [];
    }

    return res.status(200).json({ entries: [...(monthData || []), ...unissuedData] });
  }

  // ── POST: create manual entry ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const { agentId, product, subcategory, saleDate, issuedDate, writtenPremium, customerName,
            leadSource, period, autoIssued, splitSale, splitRatio, teammate, location } = req.body || {};

    if (!product || !saleDate) return res.status(400).json({ error: 'product and saleDate required' });

    const privName   = privacyName(customerName || '');
    const resolvedIssuedDate = autoIssued ? saleDate : (issuedDate || null);
    const hash = sha256Short([agentId || '', product, subcategory || '', saleDate, writtenPremium || '', privName].join('|'));

    const { error } = await supabase.from('sales_log').upsert({
      user_id:         dataUserId,
      hash,
      agent_id:        agentId        || null,
      product,
      subcategory:     subcategory    || null,
      sale_date:       saleDate,
      issued_date:     resolvedIssuedDate,
      written_premium: writtenPremium ? parseFloat(writtenPremium) : null,
      source:          'manual',
      customer_name:   privName       || null,
      lead_source:     leadSource     || null,
      period:          period         ? parseInt(period) : null,
      auto_issued:     autoIssued     ?? null,
      split_sale:      splitSale      ?? null,
      split_ratio:     splitRatio != null ? parseFloat(splitRatio) || null : null,
      teammate:        teammate       || null,
      checklist_id:    null,
      location:        location       || null,
      is_cancelled:    false,
      chargeback_date: null,
    }, { onConflict: 'user_id,hash', ignoreDuplicates: false });

    if (error) return res.status(500).json({ error: error.message });
    const agentIds = agentId ? [agentId] : [];
    await rebuildRaceData(dataUserId, agentIds);
    return res.status(200).json({ ok: true, hash });
  }

  // ── PATCH: update a manual entry ──────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { hash, ...fields } = req.body || {};
    if (!hash) return res.status(400).json({ error: 'hash required' });

    const { data: existing } = await supabase.from('sales_log').select('agent_id').eq('user_id', dataUserId).eq('hash', hash).single();

    const allowed = ['agent_id','product','subcategory','sale_date','issued_date','written_premium',
                     'customer_name','lead_source','period','auto_issued','split_sale','split_ratio','teammate','hidden','location',
                     'is_cancelled','chargeback_date'];
    const update = {};
    for (const k of allowed) {
      if (fields[k] !== undefined) update[k] = fields[k];
    }
    if (update.customer_name)   update.customer_name   = privacyName(update.customer_name);
    if (update.written_premium) update.written_premium = parseFloat(update.written_premium);
    if (update.split_ratio != null) update.split_ratio = parseFloat(update.split_ratio) || null;
    if (fields.is_cancelled !== undefined) update.is_cancelled = !!fields.is_cancelled;
    if (fields.chargeback_date !== undefined) update.chargeback_date = fields.chargeback_date || null;
    if (update.auto_issued && update.sale_date) update.issued_date = update.sale_date;
    else if (update.auto_issued && !update.sale_date) {
      const { data: cur } = await supabase.from('sales_log').select('sale_date').eq('user_id', dataUserId).eq('hash', hash).single();
      if (cur?.sale_date) update.issued_date = cur.sale_date;
    }

    const { error } = await supabase
      .from('sales_log')
      .update(update)
      .eq('user_id', dataUserId)
      .eq('hash', hash);

    if (error) return res.status(500).json({ error: error.message });
    const rebuildIds = [...new Set([existing?.agent_id, fields.agent_id].filter(Boolean))];
    await rebuildRaceData(dataUserId, rebuildIds);
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: remove a manual entry ─────────────────────────────────────────
  if (req.method === 'DELETE') {
    const hash = req.query.hash;
    if (!hash) return res.status(400).json({ error: 'hash required' });

    const { data: existing } = await supabase.from('sales_log').select('agent_id').eq('user_id', dataUserId).eq('hash', hash).single();

    const { error } = await supabase
      .from('sales_log')
      .delete()
      .eq('user_id', dataUserId)
      .eq('hash', hash);

    if (error) return res.status(500).json({ error: error.message });
    await rebuildRaceData(dataUserId, existing?.agent_id ? [existing.agent_id] : []);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
