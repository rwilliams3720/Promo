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

  let q = supabase.from('sales_log').select('agent_id, product, sale_weight').eq('user_id', dataUserId).in('agent_id', ids);
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

const DEFAULT_FORM_TYPES = [
  { form_key: 'GSD',  label: 'GSD',  sort_order: 0 },
  { form_key: 'DSS',  label: 'DSS',  sort_order: 1 },
  { form_key: 'SCD',  label: 'SCD',  sort_order: 2 },
  { form_key: 'DTD',  label: 'DTD',  sort_order: 3 },
  { form_key: 'SFPP', label: 'SFPP', sort_order: 4 },
];

const DEFAULT_SUBCATEGORIES = [
  { scoring_category: 'auto',    label: 'Antique/Classic',                    is_financial_service: false, sort_order: 0, is_default: true },
  { scoring_category: 'auto',    label: 'Commercial',                         is_financial_service: false, sort_order: 1, is_default: true },
  { scoring_category: 'auto',    label: 'Motorcycle',                         is_financial_service: false, sort_order: 2, is_default: true },
  { scoring_category: 'auto',    label: 'Private Passenger',                  is_financial_service: false, sort_order: 3, is_default: true },
  { scoring_category: 'auto',    label: 'Recreational Vehicle',               is_financial_service: false, sort_order: 4, is_default: true },
  { scoring_category: 'fire',    label: 'Boatowners',                         is_financial_service: false, sort_order: 0, is_default: true },
  { scoring_category: 'fire',    label: 'Commercial',                         is_financial_service: false, sort_order: 1, is_default: true },
  { scoring_category: 'fire',    label: 'Condo Unit Owners',                  is_financial_service: false, sort_order: 2, is_default: true },
  { scoring_category: 'fire',    label: 'Flood',                              is_financial_service: false, sort_order: 3, is_default: true },
  { scoring_category: 'fire',    label: 'Homeowners',                         is_financial_service: false, sort_order: 4, is_default: true },
  { scoring_category: 'fire',    label: 'Manufactured Home',                  is_financial_service: false, sort_order: 5, is_default: true },
  { scoring_category: 'fire',    label: 'Personal Articles Policy',           is_financial_service: false, sort_order: 6, is_default: true },
  { scoring_category: 'fire',    label: 'Personal Liability Umbrella Policy', is_financial_service: false, sort_order: 7, is_default: true },
  { scoring_category: 'fire',    label: 'Rental Condo Unit',                  is_financial_service: false, sort_order: 8, is_default: true },
  { scoring_category: 'fire',    label: 'Rental Dwelling',                    is_financial_service: false, sort_order: 9, is_default: true },
  { scoring_category: 'fire',    label: 'Renters',                            is_financial_service: false, sort_order: 10, is_default: true },
  { scoring_category: 'health',  label: 'BCBS',                               is_financial_service: true,  sort_order: 0, is_default: true },
  { scoring_category: 'health',  label: 'Individual Credit Disability Income',is_financial_service: true,  sort_order: 1, is_default: true },
  { scoring_category: 'health',  label: 'Long Term Disability Income',        is_financial_service: true,  sort_order: 2, is_default: true },
  { scoring_category: 'health',  label: 'Short Term Disability Income',       is_financial_service: true,  sort_order: 3, is_default: true },
  { scoring_category: 'health',  label: 'Supplemental Health',                is_financial_service: true,  sort_order: 4, is_default: true },
  { scoring_category: 'wl',      label: 'Whole Life',                         is_financial_service: true,  sort_order: 0, is_default: true },
  { scoring_category: 'wl',      label: '10 Pay',                             is_financial_service: true,  sort_order: 1, is_default: true },
  { scoring_category: 'wl',      label: '15 Pay',                             is_financial_service: true,  sort_order: 2, is_default: true },
  { scoring_category: 'wl',      label: '20 Pay',                             is_financial_service: true,  sort_order: 3, is_default: true },
  { scoring_category: 'ul',      label: 'Universal Life',                     is_financial_service: true,  sort_order: 0, is_default: true },
  { scoring_category: 'ul',      label: 'GIFE',                               is_financial_service: true,  sort_order: 1, is_default: true },
  { scoring_category: 'term',    label: 'Instant Answer Term',                is_financial_service: true,  sort_order: 0, is_default: true },
  { scoring_category: 'term',    label: 'Single Prem',                        is_financial_service: true,  sort_order: 1, is_default: true },
  { scoring_category: 'term',    label: 'Term 10',                            is_financial_service: true,  sort_order: 2, is_default: true },
  { scoring_category: 'term',    label: 'Term 20',                            is_financial_service: true,  sort_order: 3, is_default: true },
  { scoring_category: 'term',    label: 'Term 30',                            is_financial_service: true,  sort_order: 4, is_default: true },
  { scoring_category: 'term',    label: 'Term ROP',                           is_financial_service: true,  sort_order: 5, is_default: true },
  { scoring_category: 'term',    label: 'Annuity',                            is_financial_service: true,  sort_order: 6, is_default: true },
  { scoring_category: 'deposit', label: 'CD',                                 is_financial_service: true,  sort_order: 0, is_default: true },
  { scoring_category: 'deposit', label: 'Credit Card',                        is_financial_service: true,  sort_order: 1, is_default: true },
  { scoring_category: 'deposit', label: 'Deposit Accounts',                   is_financial_service: true,  sort_order: 2, is_default: true },
  { scoring_category: 'deposit', label: 'Home Equity Loan',                   is_financial_service: true,  sort_order: 3, is_default: true },
  { scoring_category: 'deposit', label: 'Home Equity LOC',                    is_financial_service: true,  sort_order: 4, is_default: true },
  { scoring_category: 'deposit', label: 'Mortgage',                           is_financial_service: true,  sort_order: 5, is_default: true },
  { scoring_category: 'deposit', label: 'Mortgage Referrals Closed',          is_financial_service: true,  sort_order: 6, is_default: true },
  { scoring_category: 'deposit', label: 'Vehicle Loans',                      is_financial_service: true,  sort_order: 7, is_default: true },
  { scoring_category: 'other',   label: 'Pet Insurance',                      is_financial_service: false, sort_order: 0, is_default: true },
  { scoring_category: 'other',   label: 'Medicare Supplement',                is_financial_service: false, sort_order: 1, is_default: true },
  { scoring_category: 'other',   label: 'Life Increase Term/Limited',         is_financial_service: true,  sort_order: 2, is_default: true },
  { scoring_category: 'other',   label: 'Life Increase Whole/UL',             is_financial_service: true,  sort_order: 3, is_default: true },
];

const DEFAULT_PRODUCT_TYPES = [
  { key: 'auto',    label: 'Auto'            },
  { key: 'fire',    label: 'Fire'            },
  { key: 'health',  label: 'Health'          },
  { key: 'wl',      label: 'Whole Life (WL)' },
  { key: 'ul',      label: 'Univ. Life (UL)' },
  { key: 'term',    label: 'Term'            },
  { key: 'deposit', label: 'Deposit/Bank'    },
  { key: 'other',   label: 'Other'           },
];

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

function defaultEmailConfig(companyName) {
  return {
    subject:      'New Customer — Checklist Completed',
    agency_name:  companyName || '',
    agent_name:   '',
    agent_phone:  '',
    agent_email:  '',
    brand_color:  '#00d4ff',
    greeting:     'Thank you for your business! Your agent has completed your new customer checklist.',
    footer:       'If you have any questions, please don\'t hesitate to reach out.',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: return form config for public checklist ──────────────────────────
  if (req.method === 'GET') {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const { data: acct, error } = await supabase
      .from('accounts')
      .select('user_id, company_name, has_sales_addon, checklist_email_config, sales_entry_mode, sales_product_types')
      .eq('checklist_token', token)
      .single();

    if (error || !acct) return res.status(404).json({ error: 'Invalid link' });
    if (!acct.has_sales_addon) return res.status(403).json({ error: 'Feature not active' });

    const userId = acct.user_id;

    const { data: lsRow } = await supabase.from('accounts').select('lead_sources').eq('user_id', userId).single();

    const [formConfigRes, subcatRes, agentsRes, locRes] = await Promise.all([
      supabase.from('checklist_config').select('form_key,label,active,sort_order').eq('user_id', userId).eq('active', true).order('sort_order'),
      supabase.from('sales_subcategories').select('id,scoring_category,label,is_financial_service,sort_order').eq('user_id', userId).eq('active', true).order('scoring_category').order('sort_order'),
      supabase.from('agent_roster').select('agent_id,name').eq('user_id', userId).eq('active', true).order('name'),
      supabase.from('sales_locations').select('id,name,address,phone,hours').eq('user_id', userId).eq('active', true).order('sort_order'),
    ]);

    const formConfig    = formConfigRes.data?.length ? formConfigRes.data : DEFAULT_FORM_TYPES;
    const subcategories = subcatRes.data?.length     ? subcatRes.data     : DEFAULT_SUBCATEGORIES;
    const agents        = (agentsRes.data || []).filter(a => a.agent_id && a.name);
    const locations     = locRes.data || [];

    const emailCfg = acct.checklist_email_config || defaultEmailConfig(acct.company_name);

    return res.status(200).json({
      companyName:  acct.company_name || '',
      productTypes: acct.sales_product_types || DEFAULT_PRODUCT_TYPES,
      leadSources:  lsRow?.lead_sources ?? null,
      formConfig,
      subcategories,
      agents,
      locations,
      emailConfig: {
        agency_name:     emailCfg.agency_name     || acct.company_name || '',
        agent_name:      emailCfg.agent_name      || '',
        agent_phone:     emailCfg.agent_phone     || '',
        agent_email:     emailCfg.agent_email     || '',
        brand_color:     emailCfg.brand_color     || '#00d4ff',
        greeting:        emailCfg.greeting        || '',
        footer:          emailCfg.footer          || '',
        subject:         emailCfg.subject         || 'New Customer — Checklist Completed',
        internal_email:  emailCfg.internal_email  || '',
        penalty_warning: emailCfg.penalty_warning || '',
        form_items:      emailCfg.form_items      || {},
        required_fields: emailCfg.required_fields || {},
      },
    });
  }

  // ── POST: submit a completed checklist ────────────────────────────────────
  if (req.method === 'POST') {
    const {
      token, subDate, apptDate, apptTime, meetingType, customerName,
      salespersonId, formCompletions, sales = [], location, apptLocation, wfolderApplied,
    } = req.body || {};

    if (!token)        return res.status(400).json({ error: 'Missing token' });
    if (!customerName) return res.status(400).json({ error: 'Customer name required' });
    if (!subDate)      return res.status(400).json({ error: 'Submission date required' });

    const { data: acct, error: acctErr } = await supabase
      .from('accounts')
      .select('user_id, company_name, has_sales_addon, checklist_email_config')
      .eq('checklist_token', token)
      .single();

    if (acctErr || !acct) return res.status(404).json({ error: 'Invalid link' });
    if (!acct.has_sales_addon)  return res.status(403).json({ error: 'Feature not active' });

    const userId        = acct.user_id;

    // SECURITY: the body controls salespersonId/teammate. Validate every agent id
    // against the account's active roster so a forged submission cannot attribute
    // sales (and inflate race scores / commissions) to an arbitrary agent.
    const { data: rosterRows } = await supabase
      .from('agent_roster')
      .select('agent_id')
      .eq('user_id', userId)
      .eq('active', true);
    const validAgentIds = new Set((rosterRows || []).map(r => r.agent_id));
    if (salespersonId && !validAgentIds.has(salespersonId)) {
      return res.status(400).json({ error: 'Unknown salesperson' });
    }
    for (const s of (sales || [])) {
      if (s.teammate && !validAgentIds.has(s.teammate)) {
        return res.status(400).json({ error: 'Unknown teammate on a sale' });
      }
    }

    const encryptedName = encryptField(customerName);

    const extendedCompletions = {
      ...( formCompletions || {} ),
      _apptTime:       apptTime       || null,
      _meetingType:    meetingType    || null,
      _apptLocation:   apptLocation   || null,
      _wfolderApplied: wfolderApplied || false,
    };

    // Write checklist submission
    const { data: submission, error: subErr } = await supabase
      .from('checklist_submissions')
      .insert({
        user_id:          userId,
        sub_date:         subDate,
        appt_date:        apptDate || null,
        customer_name:    encryptedName,
        salesperson_id:   salespersonId || null,
        form_completions: extendedCompletions,
      })
      .select('id')
      .single();

    if (subErr) {
      console.error('checklist_submissions insert error:', subErr);
      return res.status(500).json({ error: 'Failed to save submission' });
    }

    const submissionId = submission.id;

    // Write sales_log rows
    if (sales.length > 0) {
      const missingSrc = sales.find(s => !s.leadSource);
      if (missingSrc) return res.status(400).json({ error: 'Lead source required for all sales rows' });
      const logInserts = sales.map(s => ({
        user_id:        userId,
        hash:           sha256Short([salespersonId || '', s.product, s.subcategory || '', subDate, s.writtenPremium || ''].join('|') + Date.now() + Math.random()),
        agent_id:       salespersonId || null,
        product:        s.product,
        subcategory:    s.subcategory  || null,
        sale_date:      subDate,
        written_premium: s.writtenPremium ? parseFloat(s.writtenPremium) : null,
        source:         'checklist',
        customer_name:  encryptedName,
        lead_source:    s.leadSource   || null,
        period:         s.period       ? parseInt(s.period)  : null,
        auto_issued:    s.autoIssued   ?? null,
        split_sale:     s.splitSale    ?? null,
        teammate:       s.teammate     || null,
        checklist_id:   submissionId,
        location:       location       || null,
      }));
      const { error: salesErr } = await supabase.from('sales_log').insert(logInserts);
      if (salesErr) console.error('sales_log insert error:', salesErr);

      // Rebuild race_data so checklist sales appear on the Race tab immediately
      const agentIds = [...new Set([salespersonId, ...sales.map(s => s.teammate)].filter(Boolean))];
      await rebuildRaceData(userId, agentIds).catch(e => console.error('rebuildRaceData:', e));
    }

    const emailCfg = acct.checklist_email_config || defaultEmailConfig(acct.company_name);

    return res.status(200).json({
      ok: true,
      submissionId,
      emailPayload: {
        subject:      (emailCfg.subject || 'New Customer — Checklist Completed').replace('[CustomerName]', customerName),
        agencyName:   emailCfg.agency_name  || acct.company_name || '',
        agentName:    emailCfg.agent_name   || '',
        agentPhone:   emailCfg.agent_phone  || '',
        agentEmail:   emailCfg.agent_email  || '',
        brandColor:   emailCfg.brand_color  || '#00d4ff',
        greeting:     emailCfg.greeting     || '',
        footer:       emailCfg.footer       || '',
        bodyPara1:        emailCfg.body_para1         ?? null,
        bodyPara1Enabled: emailCfg.body_para1_enabled ?? true,
        bodyPara2:        emailCfg.body_para2         ?? null,
        bodyPara2Enabled: emailCfg.body_para2_enabled ?? true,
        importantEnabled: emailCfg.important_enabled  ?? true,
        importantTitle:   emailCfg.important_title    ?? null,
        importantBody:    emailCfg.important_body     ?? null,
        resourcesEnabled: emailCfg.resources_enabled  ?? true,
        resourcesTitle:   emailCfg.resources_title    ?? null,
        resourcesLinks:   emailCfg.resources_links    ?? null,
        thankYou:         emailCfg.thank_you          ?? null,
        thankYouEnabled:  emailCfg.thank_you_enabled  ?? true,
        greetingEs:       emailCfg.greeting_es        || null,
        footerEs:         emailCfg.footer_es          || null,
        bodyPara1Es:      emailCfg.body_para1_es      || null,
        bodyPara2Es:      emailCfg.body_para2_es      || null,
        importantTitleEs: emailCfg.important_title_es || null,
        importantBodyEs:  emailCfg.important_body_es  || null,
        resourcesTitleEs: emailCfg.resources_title_es || null,
        resourcesLinksEs: emailCfg.resources_links_es || null,
        thankYouEs:       emailCfg.thank_you_es       || null,
        customerName,
        subDate,
        apptDate:        apptDate      || null,
        apptTime:        apptTime      || null,
        meetingType:     meetingType   || null,
        apptLocation:    apptLocation  || null,
        wfolderApplied:  wfolderApplied || false,
        location,
        salespersonId,
        formCompletions: formCompletions || {},
        sales,
      },
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
