import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const DEFAULT_FORM_TYPES = [
  { form_key: 'GSD',  label: 'GSD',  active: true, sort_order: 0 },
  { form_key: 'DSS',  label: 'DSS',  active: true, sort_order: 1 },
  { form_key: 'SCD',  label: 'SCD',  active: true, sort_order: 2 },
  { form_key: 'DTD',  label: 'DTD',  active: true, sort_order: 3 },
  { form_key: 'SFPP', label: 'SFPP', active: true, sort_order: 4 },
];

// Mirrors the list in checklist-form.js — the source of truth for seeding
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Resolve account — owner path first, then captain/chief_officer member read-only path
  let acct = null;
  let dataUserId = user.id;
  let isMember = false;

  const { data: myAcct } = await supabase
    .from('accounts')
    .select('has_sales_addon, is_admin, sales_entry_mode, checklist_email_config, checklist_token, company_name, sales_product_types, has_commissions_addon, self_report_config')
    .eq('user_id', user.id)
    .single();

  if (myAcct) {
    acct = myAcct;
  } else {
    const { data: member } = await supabase
      .from('account_members')
      .select('owner_user_id, role')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .single();
    if (!member || !['captain', 'chief_officer'].includes(member.role)) {
      return res.status(403).json({ error: 'Owner access required' });
    }
    const { data: ownerAcct } = await supabase
      .from('accounts')
      .select('has_sales_addon, is_admin, sales_entry_mode, has_commissions_addon, company_name, sales_product_types, self_report_config')
      .eq('user_id', member.owner_user_id)
      .single();
    if (!ownerAcct) return res.status(403).json({ error: 'Owner account not found' });
    acct = ownerAcct;
    dataUserId = member.owner_user_id;
    isMember = true;
  }

  // ── GET: load full config, seeding defaults if needed ────────────────────
  if (req.method === 'GET') {
    const [formRes, subcatRes] = await Promise.all([
      supabase.from('checklist_config').select('*').eq('user_id', dataUserId).order('sort_order'),
      supabase.from('sales_subcategories').select('*').eq('user_id', dataUserId).order('scoring_category').order('sort_order'),
    ]);
    const { data: agentData }    = await supabase.from('agent_roster').select('id, agent_id, name, active, commission_structure_id, commission_all_must_qualify').eq('user_id', dataUserId).order('name');
    const { data: locationData } = await supabase.from('sales_locations').select('id, name, active, sort_order, address, phone, hours, goal_count, goal_premium, goals_enabled, activity_goals').eq('user_id', dataUserId).order('sort_order').order('created_at');
    const { data: lsRow }        = await supabase.from('accounts').select('lead_sources').eq('user_id', dataUserId).single();
    const { data: agentStructData } = await supabase
      .from('agent_commission_structures')
      .select('agent_id, commission_structure_id, sort_order')
      .eq('user_id', dataUserId)
      .order('sort_order');

    let formConfig = formRes.data || [];
    let subcategories = subcatRes.data || [];

    // Seed form types on first access — skip for member requests (read-only)
    if (!formConfig.length && !isMember) {
      const rows = DEFAULT_FORM_TYPES.map(f => ({ ...f, user_id: dataUserId }));
      await supabase.from('checklist_config').insert(rows);
      formConfig = rows;
    }

    // Fetch admin account once for defaults (skip if current user is admin or member)
    let adminDefaults = null;
    const needsAdminDefaults = !isMember && !acct.is_admin && (!subcategories.length || !acct.sales_product_types || !lsRow?.lead_sources);
    if (needsAdminDefaults) {
      const { data: adminAcct } = await supabase.from('accounts')
        .select('user_id, sales_product_types, lead_sources')
        .eq('is_admin', true).limit(1).single();
      adminDefaults = adminAcct || null;
    }

    // Seed subcategories on first access — skip for member requests (read-only)
    if (!subcategories.length && !isMember) {
      let seedRows;
      if (adminDefaults?.user_id) {
        const { data: adminSubs } = await supabase.from('sales_subcategories')
          .select('scoring_category, label, is_financial_service, active, sort_order')
          .eq('user_id', adminDefaults.user_id)
          .order('scoring_category').order('sort_order');
        if (adminSubs?.length) {
          seedRows = adminSubs.map(s => ({ ...s, user_id: dataUserId, is_default: false }));
        }
      }
      if (!seedRows) {
        seedRows = DEFAULT_SUBCATEGORIES.map(s => ({ ...s, user_id: dataUserId }));
      }
      await supabase.from('sales_subcategories').insert(seedRows);
      const { data: fresh } = await supabase.from('sales_subcategories').select('*').eq('user_id', dataUserId).order('scoring_category').order('sort_order');
      subcategories = fresh || seedRows;
    }

    // Default product types — prefer admin account's if user hasn't customized
    let productTypes = acct.sales_product_types || adminDefaults?.sales_product_types || DEFAULT_PRODUCT_TYPES;

    // Default lead sources — seed from admin account on first access (skip for members)
    let leadSources = lsRow?.lead_sources ?? null;
    if (!leadSources && adminDefaults?.lead_sources && !isMember) {
      leadSources = adminDefaults.lead_sources;
      await supabase.from('accounts').update({ lead_sources: leadSources }).eq('user_id', dataUserId);
    }

    const emailCfg = acct.checklist_email_config || {
      subject:     'New Customer — Checklist Completed',
      agency_name: acct.company_name || '',
      agent_name:  '', agent_phone: '', agent_email: '',
      brand_color: '#00d4ff', greeting: '', footer: '',
    };

    // Fetch commission structures if commissions add-on is active (or admin)
    let commStructures = [];
    if (acct.has_commissions_addon || acct.is_admin) {
      const { data: csData } = await supabase
        .from('commission_structures')
        .select('id, name, default_split_ratio, pay_on_issue, thresholds, rates')
        .eq('user_id', dataUserId)
        .order('name');
      commStructures = csData || [];
    }

    return res.status(200).json({
      hasSalesAddon:        acct.has_sales_addon || acct.is_admin || false,
      hasCommissionsAddon:  acct.has_commissions_addon || acct.is_admin || false,
      salesEntryMode:       acct.sales_entry_mode || 'upload',
      checklistToken:       isMember ? null : acct.checklist_token,
      formConfig,
      subcategories,
      emailConfig: emailCfg,
      agents: (() => {
        const agentStructsByAgent = {};
        for (const row of (agentStructData || [])) {
          if (!agentStructsByAgent[row.agent_id]) agentStructsByAgent[row.agent_id] = [];
          agentStructsByAgent[row.agent_id].push(row.commission_structure_id);
        }
        return (agentData || []).map(a => ({
          ...a,
          commission_structure_ids: agentStructsByAgent[a.agent_id] || [],
        }));
      })(),
      locations: locationData || [],
      productTypes,
      leadSources,
      commissionStructures: commStructures,
      selfReportConfig: acct.self_report_config || {},
    });
  }

  // ── PATCH: update config (owner only) ────────────────────────────────────
  if (req.method === 'PATCH') {
    const { action, formTypes, subcategoryUpdates, emailConfig, salesEntryMode, clearCurrentSales, productTypes, locationUpdates, leadSources } = req.body || {};

    if (action === 'update_self_report') {
      if (isMember) return res.status(403).json({ error: 'Owner access required' });
      const { error } = await supabase.from('accounts')
        .update({ self_report_config: req.body.selfReportConfig || {} })
        .eq('user_id', dataUserId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (isMember) return res.status(403).json({ error: 'Members cannot modify account configuration' });

    // Regenerate public link token
    if (action === 'regenerate_token') {
      const newToken = crypto.randomUUID();
      await supabase.from('accounts').update({ checklist_token: newToken }).eq('user_id', user.id);
      return res.status(200).json({ ok: true, checklistToken: newToken });
    }

    // Update form types (full replace)
    if (formTypes) {
      await supabase.from('checklist_config').delete().eq('user_id', user.id);
      if (formTypes.length) {
        const rows = formTypes.map((f, i) => ({
          user_id:    user.id,
          form_key:   f.form_key || `custom_${i}`,
          label:      f.label,
          active:     f.active ?? true,
          sort_order: i,
        }));
        await supabase.from('checklist_config').insert(rows);
      }
    }

    // Subcategory updates (toggle active, add new, update label)
    if (subcategoryUpdates) {
      for (const upd of subcategoryUpdates) {
        if (upd.action === 'add') {
          await supabase.from('sales_subcategories').insert({
            user_id:              user.id,
            scoring_category:     upd.scoring_category,
            label:                upd.label,
            is_financial_service: upd.is_financial_service ?? false,
            active:               true,
            sort_order:           upd.sort_order ?? 99,
            is_default:           false,
          });
        } else if (upd.action === 'toggle') {
          await supabase.from('sales_subcategories')
            .update({ active: upd.active })
            .eq('id', upd.id)
            .eq('user_id', user.id);
        } else if (upd.action === 'update') {
          const fields = {};
          if (upd.label !== undefined)                fields.label = upd.label;
          if (upd.is_financial_service !== undefined) fields.is_financial_service = upd.is_financial_service;
          if (upd.sort_order !== undefined)           fields.sort_order = upd.sort_order;
          if (Object.keys(fields).length) {
            await supabase.from('sales_subcategories').update(fields).eq('id', upd.id).eq('user_id', user.id);
          }
        } else if (upd.action === 'delete') {
          await supabase.from('sales_subcategories').delete().eq('id', upd.id).eq('user_id', user.id);
        }
      }
    }

    // Email template update
    if (emailConfig) {
      const allowed = ['subject','agency_name','agent_name','agent_phone','agent_email','brand_color','greeting','footer','internal_email','penalty_warning','form_items','required_fields','body_para1','body_para1_enabled','body_para2','body_para2_enabled','important_enabled','important_title','important_body','resources_enabled','resources_title','resources_links','thank_you','thank_you_enabled'];
      const { data: acctRow } = await supabase.from('accounts').select('checklist_email_config').eq('user_id', user.id).single();
      const cfg = { ...(acctRow?.checklist_email_config || {}) };
      for (const k of allowed) if (emailConfig[k] !== undefined) cfg[k] = emailConfig[k];
      await supabase.from('accounts').update({ checklist_email_config: cfg }).eq('user_id', user.id);
    }

    // Sales entry mode change
    if (salesEntryMode && ['upload', 'manual'].includes(salesEntryMode)) {
      await supabase.from('accounts').update({ sales_entry_mode: salesEntryMode }).eq('user_id', user.id);
      if (clearCurrentSales) {
        // Determine current month range and delete manual/checklist sales in that window
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
        if (salesEntryMode === 'manual') {
          // Switching to manual: delete current month's upload-sourced sales
          await supabase.from('sales_log').delete()
            .eq('user_id', user.id).eq('source', 'upload')
            .gte('sale_date', from).lte('sale_date', to);
        } else {
          // Switching to upload: delete current month's manual/checklist sales
          await supabase.from('sales_log').delete()
            .eq('user_id', user.id).in('source', ['manual', 'checklist'])
            .gte('sale_date', from).lte('sale_date', to);
        }
      }
    }

    // Product types update (full replace)
    if (productTypes !== undefined && Array.isArray(productTypes)) {
      await supabase.from('accounts').update({ sales_product_types: productTypes }).eq('user_id', user.id);
    }

    // Lead sources update (full replace; null resets to defaults)
    if (leadSources !== undefined) {
      await supabase.from('accounts').update({ lead_sources: leadSources }).eq('user_id', user.id);
    }

    // Location CRUD
    if (locationUpdates) {
      for (const upd of locationUpdates) {
        let locErr;
        if (upd.action === 'add') {
          ({ error: locErr } = await supabase.from('sales_locations').insert({ user_id: user.id, name: upd.name, sort_order: upd.sort_order ?? 0 }));
        } else if (upd.action === 'toggle') {
          ({ error: locErr } = await supabase.from('sales_locations').update({ active: upd.active }).eq('id', upd.id).eq('user_id', user.id));
        } else if (upd.action === 'update') {
          ({ error: locErr } = await supabase.from('sales_locations').update({ name: upd.name }).eq('id', upd.id).eq('user_id', user.id));
        } else if (upd.action === 'update_details') {
          const detailsUpdate = {
            address:    upd.address    || null,
            phone:      upd.phone      || null,
            hours:      upd.hours      || null,
            goal_count:   upd.goal_count   != null ? (parseInt(upd.goal_count)   || null) : undefined,
            goal_premium: upd.goal_premium != null ? (parseFloat(upd.goal_premium) || null) : undefined,
          };
          if (upd.activity_goals !== undefined) detailsUpdate.activity_goals = upd.activity_goals || {};
          ({ error: locErr } = await supabase.from('sales_locations').update(detailsUpdate).eq('id', upd.id).eq('user_id', user.id));
        } else if (upd.action === 'update_activity_goals') {
          ({ error: locErr } = await supabase.from('sales_locations').update({ activity_goals: upd.activity_goals || {} })
            .eq('user_id', dataUserId).eq('id', upd.id));
        } else if (upd.action === 'update_goals_enabled') {
          ({ error: locErr } = await supabase.from('sales_locations').update({
            goals_enabled: !!upd.goals_enabled,
          }).eq('id', upd.id).eq('user_id', user.id));
        } else if (upd.action === 'delete') {
          ({ error: locErr } = await supabase.from('sales_locations').delete().eq('id', upd.id).eq('user_id', user.id));
        }
        if (locErr) return res.status(500).json({ error: locErr.message });
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
