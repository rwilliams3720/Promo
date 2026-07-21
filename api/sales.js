import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { computeChargebackAmount, buildStructureListLookup } from './_lib/commission-calc.js';
import { rebuildRaceData as sharedRebuildRaceData } from './_lib/race-data.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function rebuildRaceData(dataUserId, agentIds) {
  return sharedRebuildRaceData(supabase, dataUserId, agentIds);
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

    const COLS = 'hash, agent_id, product, subcategory, sale_date, issued_date, written_premium, issued_premium, source, customer_name, lead_source, period, auto_issued, split_sale, split_ratio, teammate, checklist_id, hidden, location, is_cancelled, chargeback_date, chargeback_exempt';

    // Chargeback mode: return only cancelled sales where chargeback_date is in the requested range
    if (req.query.chargebackMode === '1') {
      let cbQ = supabase.from('sales_log').select(COLS)
        .eq('user_id', dataUserId)
        .eq('is_cancelled', true)
        .gte('chargeback_date', fromDate)
        .lte('chargeback_date', toDate)
        .order('chargeback_date', { ascending: false });
      if (ctx.isMember && !ctx.isCapOrCO && ctx.memberAgentId) cbQ = cbQ.eq('agent_id', ctx.memberAgentId);
      const { data: cbData, error: cbErr } = await cbQ;
      if (cbErr) return res.status(500).json({ error: cbErr.message });

      // Compute the commission each chargeback deducts — same math (marginal contribution
      // to the earned month, not a flat rate) and per-agent structure overrides as
      // api/commissions.js, via the shared helper, so the two reports always agree.
      const commissionByHash = {};
      if ((cbData || []).length) {
        const [rosterRes, structsRes, junctionRes, subcatsRes] = await Promise.all([
          supabase.from('agent_roster').select('agent_id, name, commission_structure_id, commission_product_overrides').eq('user_id', dataUserId),
          supabase.from('commission_structures').select('id, name, default_split_ratio, pay_on_issue, thresholds, rates, cap_per_policy, cap_per_structure').eq('user_id', dataUserId),
          supabase.from('agent_commission_structures').select('agent_id, commission_structure_id, sort_order').eq('user_id', dataUserId).order('sort_order'),
          supabase.from('sales_subcategories').select('label, is_financial_service').eq('user_id', dataUserId),
        ]);
        const roster = rosterRes.data || [];
        const structureById = Object.fromEntries((structsRes.data || []).map(s => [s.id, s]));
        const { agentById, getStructureList } = buildStructureListLookup(roster, structureById, junctionRes.data || []);
        const isFinancialService = {};
        for (const s of (subcatsRes.data || [])) isFinancialService[s.label] = s.is_financial_service || false;

        const chargebackCtx = { supabase, dataUserId, roster, isFinancialService, decryptField, cache: {} };
        for (const sale of (cbData || [])) {
          const structList = getStructureList(sale.agent_id);
          const overrides  = agentById[sale.agent_id]?.commission_product_overrides || {};
          commissionByHash[sale.hash] = await computeChargebackAmount(chargebackCtx, sale, structList, overrides);
        }
      }

      const entries = (cbData || []).map(row => ({
        ...row,
        customer_name: decryptField(row.customer_name),
        chargeback_commission: Math.round((commissionByHash[row.hash] || 0) * 100) / 100,
      }));
      return res.status(200).json({ entries });
    }

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
    let { agentId, product, subcategory, saleDate, issuedDate, writtenPremium, issuedPremium, customerName, force,
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
    const baseHash = sha256Short([agentId || '', product, subcategory || '', saleDate, writtenPremium || '', normalizedName].join('|'));

    // Duplicate check — if the same hash exists and caller hasn't confirmed, return 409
    if (!force) {
      const { data: dup } = await supabase.from('sales_log').select('hash').eq('user_id', dataUserId).eq('hash', baseHash).maybeSingle();
      if (dup) return res.status(409).json({ duplicate: true });
    }

    // When forcing a confirmed duplicate, mint a unique hash so it inserts as a new row
    const hash = (force && baseHash) ? sha256Short([agentId || '', product, subcategory || '', saleDate, writtenPremium || '', normalizedName, Date.now().toString()].join('|')) : baseHash;

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
      location:        (location || '').trim() || null,
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

    const { data: existing } = await supabase.from('sales_log').select('agent_id, teammate').eq('user_id', dataUserId).eq('hash', hash).single();
    // Non-captain/CO members can only edit their own entries
    if (ctx.isMember && !ctx.isCapOrCO && ctx.memberAgentId && existing?.agent_id !== ctx.memberAgentId) {
      return res.status(403).json({ error: 'You can only edit your own entries' });
    }

    const allowed = ['agent_id','product','subcategory','sale_date','issued_date','written_premium','issued_premium',
                     'customer_name','lead_source','period','auto_issued','split_sale','split_ratio','teammate','hidden','location',
                     'is_cancelled','chargeback_date','sale_weight','chargeback_exempt'];
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
    if (fields.chargeback_exempt !== undefined) update.chargeback_exempt = !!fields.chargeback_exempt;
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
    // Include both old and new agent_id/teammate — a split sale's teammate must get
    // their race_data refreshed too, whether they were the teammate before the edit,
    // after it, or both (e.g. issuing a split sale, or swapping who the teammate is).
    const rebuildIds = [...new Set([
      existing?.agent_id, existing?.teammate, fields.agent_id, fields.teammate,
    ].filter(Boolean))];
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

    const { data: existing } = await supabase.from('sales_log').select('agent_id, teammate').eq('user_id', dataUserId).eq('hash', hash).single();
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
    await rebuildRaceData(dataUserId, [existing?.agent_id, existing?.teammate].filter(Boolean));
    await logAccess({ actorUserId: ctx.userId, actorEmail: ctx.actorEmail, dataUserId, action: 'delete', recordHash: hash });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
