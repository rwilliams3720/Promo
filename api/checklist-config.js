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

  // Only account owners can manage config
  const { data: acct } = await supabase
    .from('accounts')
    .select('has_sales_addon, is_admin, sales_entry_mode, checklist_email_config, checklist_token, company_name, sales_product_types')
    .eq('user_id', user.id)
    .single();
  if (!acct) return res.status(403).json({ error: 'Owner access required' });

  // ── GET: load full config, seeding defaults if needed ────────────────────
  if (req.method === 'GET') {
    const [formRes, subcatRes] = await Promise.all([
      supabase.from('checklist_config').select('*').eq('user_id', user.id).order('sort_order'),
      supabase.from('sales_subcategories').select('*').eq('user_id', user.id).order('scoring_category').order('sort_order'),
    ]);
    const { data: agentData }    = await supabase.from('agent_roster').select('id, agent_id, name, active').eq('user_id', user.id).order('name');
    const { data: locationData } = await supabase.from('sales_locations').select('id, name, active, sort_order').eq('user_id', user.id).order('sort_order').order('created_at');

    let formConfig = formRes.data || [];
    let subcategories = subcatRes.data || [];

    // Seed form types on first access
    if (!formConfig.length) {
      const rows = DEFAULT_FORM_TYPES.map(f => ({ ...f, user_id: user.id }));
      await supabase.from('checklist_config').insert(rows);
      formConfig = rows;
    }

    // Seed subcategories on first access
    if (!subcategories.length) {
      const rows = DEFAULT_SUBCATEGORIES.map(s => ({ ...s, user_id: user.id }));
      await supabase.from('sales_subcategories').insert(rows);
      subcategories = rows.map((r, i) => ({ ...r, id: `seeded-${i}` }));
      // Re-fetch to get actual IDs
      const { data: fresh } = await supabase.from('sales_subcategories').select('*').eq('user_id', user.id).order('scoring_category').order('sort_order');
      subcategories = fresh || subcategories;
    }

    const emailCfg = acct.checklist_email_config || {
      subject:     'New Customer — Checklist Completed',
      agency_name: acct.company_name || '',
      agent_name:  '', agent_phone: '', agent_email: '',
      brand_color: '#00d4ff', greeting: '', footer: '',
    };

    return res.status(200).json({
      hasSalesAddon:    acct.has_sales_addon || acct.is_admin || false,
      salesEntryMode:   acct.sales_entry_mode || 'upload',
      checklistToken:   acct.checklist_token,
      formConfig,
      subcategories,
      emailConfig: emailCfg,
      agents: agentData || [],
      locations: locationData || [],
      productTypes: acct.sales_product_types || DEFAULT_PRODUCT_TYPES,
    });
  }

  // ── PATCH: update config ──────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { action, formTypes, subcategoryUpdates, emailConfig, salesEntryMode, clearCurrentSales, productTypes, locationUpdates } = req.body || {};

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
      const allowed = ['subject','agency_name','agent_name','agent_phone','agent_email','brand_color','greeting','footer'];
      const cfg = {};
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
