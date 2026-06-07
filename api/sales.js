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
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts = currentMonth.trim().split(' ');
    let idx = MONTH_NAMES.indexOf(parts[0]);
    if (idx === -1) idx = ABBR.indexOf(parts[0]);
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
    await supabase.from('race_data').update({
      ...totals[id],
      last_updated: now,
    }).eq('user_id', dataUserId).eq('agent_id', id);
  }
}

function sha256Short(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

const ENCRYPTION_KEY = process.env.CUSTOMER_ENCRYPTION_KEY
  ? Buffer.from(process.env.CUSTOMER_ENCRYPTION_KEY, 'hex')
  : null;

function encryptField(text) {
  if (!text) return null;
  if (!ENCRYPTION_KEY) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('base64') + ':' + encrypted.toString('base64') + ':' + tag.toString('base64');
}

function decryptField(ciphertext) {
  if (!ciphertext) return null;
  if (!ENCRYPTION_KEY || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivB64, encB64, tagB64] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(Buffer.from(encB64, 'base64')) + decipher.final('utf8');
  } catch {
    return ciphertext;
  }
}

async function resolveUser(token, { readOnly = false } = {}) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: acct } = await supabase.from('accounts').select('has_sales_addon, sales_entry_mode, is_admin').eq('user_id', user.id).single();
  let dataUserId = user.id;
  let hasSalesAddon = (acct?.has_sales_addon || acct?.is_admin) ?? false;
  if (!acct) {
    const { data: member } = await supabase
      .from('account_members')
      .select('owner_user_id, role, roster_agent_id')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .single();
    if (!member) return null;
    const isCapOrCO = ['captain', 'chief_officer'].includes(member.role);
    dataUserId = member.owner_user_id;
    const { data: ownerAcct } = await supabase.from('accounts').select('has_sales_addon, is_admin, self_report_config').eq('user_id', dataUserId).single();
    const ownerSelfReport = ownerAcct?.self_report_config || {};
    // sales_enabled gates self-report submissions; read-only (salesperf view) is allowed for any active member
    if (!isCapOrCO && !ownerSelfReport.sales_enabled && !readOnly) return null;
    hasSalesAddon = (ownerAcct?.has_sales_addon || ownerAcct?.is_admin || ownerSelfReport.sales_enabled) ?? false;
    // For read-only members, inherit hasSalesAddon from owner account directly
    if (readOnly && !hasSalesAddon) hasSalesAddon = !!(ownerAcct?.has_sales_addon || ownerAcct?.is_admin);
    return {
      userId: user.id,
      dataUserId,
      hasSalesAddon,
      isMember: true,
      isCapOrCO,
      memberAgentId: member.roster_agent_id || null,
      selfReportConfig: ownerSelfReport,
      actorEmail: user.email,
    };
  }
  return { userId: user.id, dataUserId, hasSalesAddon, isMember: false, isCapOrCO: false, memberAgentId: null, selfReportConfig: {}, actorEmail: user.email };
}

async function logAccess({ actorUserId, actorEmail, dataUserId, action, recordHash, rowCount, metadata }) {
  try {
    await supabase.from('access_log').insert({
      user_id:       dataUserId,
      actor_user_id: actorUserId,
      actor_email:   actorEmail  || null,
      action,
      resource:      'sales_log',
      record_hash:   recordHash  || null,
      row_count:     rowCount    || null,
      metadata:      metadata    || null,
    });
  } catch {
    // log failure must never break the main operation
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const ctx = await resolveUser(token, { readOnly: req.method === 'GET' });
  if (!ctx) return res.status(401).json({ error: 'Invalid token or insufficient access' });
  // Members can always view their own sales (GET) even without the sales add-on
  if (!ctx.hasSalesAddon && !(ctx.isMember && req.method === 'GET')) {
    return res.status(403).json({ error: 'Sales tracking add-on required' });
  }

  const { dataUserId } = ctx;

  // ── GET: list manual/checklist entries ────────────────────────────────────
  if (req.method === 'GET') {
    // A non-captain/CO member with no linked roster agent must NOT receive the
    // whole company's sales log — return nothing rather than an unscoped query.
    if (ctx.isMember && !ctx.isCapOrCO && !ctx.memberAgentId) {
      return res.status(200).json({ entries: [] });
    }

    const { month, year, includeUnissued, includeHidden } = req.query;

    const now      = new Date();
    const selYear  = parseInt(year)  || now.getFullYear();
    const selMonth = parseInt(month) || (now.getMonth() + 1);
    const allYear  = req.query.allYear === '1';
    let fromDate = allYear ? `${selYear}-01-01` : `${selYear}-${String(selMonth).padStart(2,'0')}-01`;
    const lastDay  = allYear ? 31 : new Date(selYear, selMonth, 0).getDate();
    let toDate   = allYear ? `${selYear}-12-31` : `${selYear}-${String(selMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    // Validate client-supplied date overrides (these feed a PostgREST .or() filter
    // string, so reject anything that isn't a strict YYYY-MM-DD to prevent filter injection).
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (req.query.fromDate) {
      if (!ISO_DATE.test(req.query.fromDate)) return res.status(400).json({ error: 'Invalid fromDate' });
      fromDate = req.query.fromDate;
    }
    if (req.query.toDate) {
      if (!ISO_DATE.test(req.query.toDate)) return res.status(400).json({ error: 'Invalid toDate' });
      toDate = req.query.toDate;
    }

    const COLS = 'hash, agent_id, product, subcategory, sale_date, issued_date, written_premium, issued_premium, source, customer_name, lead_source, period, auto_issued, split_sale, split_ratio, teammate, checklist_id, hidden, location, is_cancelled, chargeback_date';

    // Selected month
    let q1 = supabase.from('sales_log').select(COLS)
      .eq('user_id', dataUserId)
      .in('source', ['manual', 'checklist'])
      .gte('sale_date', fromDate)
      .lte('sale_date', toDate)
      .order('sale_date', { ascending: false });
    // Non-captain/CO members see only their own agent's entries
    if (ctx.isMember && !ctx.isCapOrCO && ctx.memberAgentId) q1 = q1.eq('agent_id', ctx.memberAgentId);
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
      if (ctx.isMember && !ctx.isCapOrCO && ctx.memberAgentId) q2 = q2.eq('agent_id', ctx.memberAgentId);
      if (includeHidden !== '1') q2 = q2.or('hidden.is.null,hidden.eq.false');
      const { data: d2 } = await q2;
      unissuedData = d2 || [];
    }

    const entries = [...(monthData || []), ...unissuedData].map(row => ({
      ...row,
      customer_name: decryptField(row.customer_name),
    }));
    return res.status(200).json({ entries });
  }

  // ── POST: create manual entry ─────────────────────────────────────────────
  if (req.method === 'POST') {
    let { agentId, product, subcategory, saleDate, issuedDate, writtenPremium, issuedPremium, customerName,
          leadSource, period, autoIssued, splitSale, splitRatio, teammate, location, saleWeight } = req.body || {};

    // Non-captain/CO members can only submit for themselves
    if (ctx.isMember && !ctx.isCapOrCO) {
      if (!ctx.memberAgentId) return res.status(400).json({ error: 'No roster agent linked to your account' });
      agentId = ctx.memberAgentId;
    }

    if (!product || !saleDate) return res.status(400).json({ error: 'product and saleDate required' });
    if (!leadSource) return res.status(400).json({ error: 'lead source required' });

    const normalizedName = (customerName || '').toLowerCase().trim();
    const resolvedIssuedDate = autoIssued ? saleDate : (issuedDate || null);
    const hash = sha256Short([agentId || '', product, subcategory || '', saleDate, writtenPremium || '', normalizedName].join('|'));

    const { error } = await supabase.from('sales_log').upsert({
      user_id:         dataUserId,
      hash,
      agent_id:        agentId        || null,
      product,
      subcategory:     subcategory    || null,
      sale_date:       saleDate,
      issued_date:     resolvedIssuedDate,
      written_premium: writtenPremium ? parseFloat(writtenPremium) : null,
      issued_premium:  issuedPremium  ? parseFloat(issuedPremium)  : null,
      source:          'manual',
      customer_name:   encryptField(customerName || '') || null,
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
      sale_weight:     saleWeight != null ? parseFloat(saleWeight) : 1,
    }, { onConflict: 'user_id,hash', ignoreDuplicates: false });

    if (error) return res.status(500).json({ error: error.message });
    const agentIds = [agentId, teammate].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    await rebuildRaceData(dataUserId, agentIds);
    return res.status(200).json({ ok: true, hash });
  }

  // ── PATCH: update a manual entry ──────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (ctx.isMember && !ctx.isCapOrCO && !ctx.selfReportConfig?.sales_log_edit_enabled) {
      return res.status(403).json({ error: 'Editing sales is not enabled for your account' });
    }
    const { hash, ...fields } = req.body || {};
    if (!hash) return res.status(400).json({ error: 'hash required' });

    const { data: existing } = await supabase.from('sales_log').select('agent_id').eq('user_id', dataUserId).eq('hash', hash).single();
    // Non-captain/CO members can only edit their own entries
    if (ctx.isMember && !ctx.isCapOrCO && ctx.memberAgentId && existing?.agent_id !== ctx.memberAgentId) {
      return res.status(403).json({ error: 'You can only edit your own entries' });
    }

    const allowed = ['agent_id','product','subcategory','sale_date','issued_date','written_premium','issued_premium',
                     'customer_name','lead_source','period','auto_issued','split_sale','split_ratio','teammate','hidden','location',
                     'is_cancelled','chargeback_date','sale_weight'];
    const update = {};
    for (const k of allowed) {
      if (fields[k] !== undefined) update[k] = fields[k];
    }
    if (update.customer_name !== undefined) update.customer_name = encryptField(update.customer_name) || null;
    if (update.written_premium) update.written_premium = parseFloat(update.written_premium);
    if (update.issued_premium != null) update.issued_premium = update.issued_premium ? parseFloat(update.issued_premium) : null;
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
    await logAccess({ actorUserId: ctx.userId, actorEmail: ctx.actorEmail, dataUserId, action: 'edit', recordHash: hash, metadata: { fields: Object.keys(update) } });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: remove a manual entry ─────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (ctx.isMember && !ctx.isCapOrCO && !ctx.selfReportConfig?.sales_log_edit_enabled) {
      return res.status(403).json({ error: 'Editing sales is not enabled for your account' });
    }
    const hash = req.query.hash;
    if (!hash) return res.status(400).json({ error: 'hash required' });

    const { data: existing } = await supabase.from('sales_log').select('agent_id').eq('user_id', dataUserId).eq('hash', hash).single();
    // Non-captain/CO members can only delete their own entries
    if (ctx.isMember && !ctx.isCapOrCO && ctx.memberAgentId && existing?.agent_id !== ctx.memberAgentId) {
      return res.status(403).json({ error: 'You can only delete your own entries' });
    }

    const { error } = await supabase
      .from('sales_log')
      .delete()
      .eq('user_id', dataUserId)
      .eq('hash', hash);

    if (error) return res.status(500).json({ error: error.message });
    await rebuildRaceData(dataUserId, existing?.agent_id ? [existing.agent_id] : []);
    await logAccess({ actorUserId: ctx.userId, actorEmail: ctx.actorEmail, dataUserId, action: 'delete', recordHash: hash });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
