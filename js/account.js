// ── ACCOUNT TAB ───────────────────────────────────────────────────────────────
const ADDONS = [
  {
    key:       'sales_tracking',
    sectionId: 'sales-addon-section',
    label: 'Sales Tracking',
    desc:  'Manual sales entry, shareable checklist link, and subcategory tracking.',
    price: '$25/mo',
    active: acct => !!(acct.has_sales_addon),
  },
  {
    key:       'member_analysis',
    sectionId: 'member-analysis-section',
    label: 'Team Member Analysis',
    desc:  'Individual month-over-month coaching analysis — score, policies, and premium per agent.',
    price: '$10/head/mo',
    active: acct => !!(acct.has_member_analysis),
  },
  {
    key:       'commissions',
    sectionId: 'commissions-addon-section',
    label: 'Commissions',
    desc:  'Tiered structures, escalators, activity bonuses, chargebacks, and payment tracking.',
    price: '$25/mo',
    active: acct => !!(acct.has_commissions_addon),
  },
  {
    key:       'lead_analysis',
    sectionId: 'lead-analysis-addon-section',
    label: 'Lead Source Analysis',
    desc:  'AI analysis of channel performance — volume, avg premium, trend momentum, and agent-source fit.',
    price: '$10/mo',
    active: acct => !!(acct.has_lead_analysis_addon),
  },
];

function renderAddonsOverview(acct) {
  const el = document.getElementById('addons-overview');
  if (!el) return;
  el.innerHTML = ADDONS.map(addon => {
    const on = addon.active(acct) || _isAdmin && addon.active({...acct, has_sales_addon: _hasSalesAddon});
    const badge = on
      ? `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--accent2);background:rgba(0,255,136,.08);border:1px solid rgba(0,255,136,.2);padding:2px 9px;border-radius:4px;">Active</span>`
      : `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);background:rgba(255,255,255,.04);border:1px solid var(--border);padding:2px 9px;border-radius:4px;">Not Active</span>`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1rem;background:var(--card2);border:1px solid var(--border2);border-radius:10px;margin-bottom:.5rem;flex-wrap:wrap;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:2px;">${escHtml(addon.label)}</div>
        <div style="font-size:12px;color:var(--muted);">${escHtml(addon.desc)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:.75rem;flex-shrink:0;">
        <span style="font-size:13px;font-weight:600;color:var(--muted);">${escHtml(addon.price)}</span>
        ${badge}
        <button class="btn btn-secondary" style="padding:3px 12px;font-size:12px;"
                onclick="showAccountSubTab('billing',document.querySelector('[data-pane=billing]'),'${escHtml(addon.sectionId)}')">Manage</button>
      </div>
    </div>`;
  }).join('');
}

async function loadAccountTab() {
  if (!_userId) return;
  if (_isMember) { loadMemberAccountTab(); return; }
  // Ensure sub-tab nav is visible and reset to profile pane
  const nav = document.getElementById('acct-subtab-nav');
  if (nav) nav.style.display = '';
  showAccountSubTab('profile');
  const { data: acct } = await _supabase.from('accounts').select('*').eq('user_id', _userId).single();
  if (!acct) return;
  // Agency management section lives in the Team pane — always visible there for owners
  const agencySection = document.getElementById('agency-mgmt-section');
  if (agencySection) { agencySection.style.display = ''; loadAgencyMembers(); }

  const isSubscribed = ['paid','deferred'].includes(acct.status);
  const planName     = (acct.plan || 'basic').charAt(0).toUpperCase() + (acct.plan || 'basic').slice(1);
  const planDisplay  = acct.status === 'trial'
    ? 'Trial'
    : `Subscribed to ${planName} — $${PLAN_PRICES[acct.plan] || '—'}/mo`;
  const trialEnd = (!isSubscribed && acct.trial_ends_at) ? new Date(acct.trial_ends_at).toLocaleDateString() : '—';
  const paidThru = acct.paid_through ? new Date(acct.paid_through).toLocaleDateString() : '—';

  document.getElementById('acct-info-grid').innerHTML = [
    ['Email', acct.email],
    ['Company', acct.company_name || '—'],
    ['Plan', planDisplay],
    ['Teams', acct.agent_count || 1],
    ['Trial Ends', trialEnd],
    ['Paid Through', paidThru],
  ].map(([lbl, val]) =>
    `<div class="acct-info-item"><div class="acct-info-label">${lbl}</div><div class="acct-info-val">${val}</div></div>`
  ).join('');

  renderAddonsOverview(acct);

  // Editable contact fields
  document.getElementById('ac-contact').value = acct.contact_name || '';
  document.getElementById('ac-phone').value   = acct.phone || '';

  // Report delivery section (pro/premium only)
  const isPaid = ['pro','premium'].includes(acct.plan) && !_trialExpired && _acctStatus !== 'trial';
  document.getElementById('report-delivery-section').style.display = isPaid ? '' : 'none';
  if (isPaid) {
    const tzSel = document.getElementById('ac-timezone');
    const hrSel = document.getElementById('ac-report-hour');
    tzSel.value = acct.timezone || 'America/Los_Angeles';
    hrSel.value = String(acct.report_hour ?? 7);
    document.getElementById('ac-report-email').value = acct.report_email || '';
  }

  // Plan upgrade section
  _currentPlan  = acct.plan || 'basic';
  _acctStatus   = acct.status || _acctStatus;
  _selectedPlan = null;
  const isActiveSub = _acctStatus === 'paid' || _acctStatus === 'deferred';
  document.getElementById('plan-upgrade-btn').style.display  = 'none';
  document.getElementById('plan-portal-btn').style.display   = isActiveSub ? '' : 'none';
  document.getElementById('plan-portal-btn').disabled        = false;
  document.getElementById('plan-portal-btn').textContent     = 'Manage Billing & Subscription';
  document.getElementById('plan-billing-desc').textContent   = isActiveSub
    ? 'Select a different plan below, or manage your subscription and payment method via the billing portal.'
    : 'Select a plan below and subscribe via Stripe to activate your account.';
  document.getElementById('plan-tier-grid').innerHTML = ['basic','pro','premium'].map(p => {
    const isCurrent = _acctStatus !== 'trial' && p === _currentPlan;
    return `<div class="plan-tier${isCurrent?' plan-current':''}" onclick="selectPlan('${p}',this)">
      <div class="plan-tier-name">${p.toUpperCase()}</div>
      <div class="plan-tier-price">$${PLAN_PRICES[p]}<span>/mo</span></div>
      <div class="plan-tier-badge">${isCurrent ? '✓ Current Plan' : PLAN_FEATURES[p]}</div>
    </div>`;
  }).join('');

  buildColumnMapUI();
  if (acct.sales_column_map) _columnMap = acct.sales_column_map;
  COL_FIELDS.forEach(f => {
    const el = document.getElementById('cmap-' + f);
    if (el) el.value = (_columnMap[f] || '');
  });

  document.getElementById('danger-zone-section').style.display  = _isAdmin ? 'none' : 'flex';
  document.getElementById('sandbox-reset-section').style.display = _isAdmin ? '' : 'none';

  // Sales add-on section
  document.getElementById('sales-addon-section').style.display = '';
  renderSalesAddonSection(acct);
  // Member analysis add-on section
  document.getElementById('member-analysis-section').style.display = '';
  renderMemberAnalysisSection(acct);
  // Commissions add-on section
  document.getElementById('commissions-addon-section').style.display = '';
  renderCommissionsAddonSection(acct);
  // Lead Analysis add-on section
  document.getElementById('lead-analysis-addon-section').style.display = '';
  renderLeadAnalysisAddonSection(acct);
  // Analysis credits wallet — show when member analysis is active
  const hasMa = acct.has_member_analysis || _hasMemberAnalysis || _isAdmin;
  document.getElementById('analysis-credits-section').style.display = hasMa ? '' : 'none';
  if (hasMa) fetchAnalysisCredits();
}

async function confirmResetMyData(btn) {
  if (!_isAdmin) return;
  const msg = document.getElementById('sandbox-reset-msg');
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm — this will erase all your data';
    setTimeout(() => { btn.dataset.confirming = ''; btn.textContent = 'Delete All My Data'; }, 5000);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  msg.style.display = 'none';
  try {
    await Promise.all([
      _supabase.from('call_log').delete().eq('user_id', _userId),
      _supabase.from('sales_log').delete().eq('user_id', _userId),
      _supabase.from('historical_wins').delete().eq('user_id', _userId),
      _supabase.from('historical_months').delete().eq('user_id', _userId),
      _supabase.from('checklist_submissions').delete().eq('user_id', _userId),
    ]);
    await _supabase.from('race_data').delete().eq('user_id', _userId);
    await _supabase.from('race_config').delete().eq('user_id', _userId).eq('key', 'current_month');
    msg.style.display = 'block';
    msg.style.color = 'var(--accent2)';
    msg.textContent = 'All data deleted. Uploads reset — ready for fresh test data.';
    _raceData = []; _history = []; _perfData = null;
    _lsRemove('br-analysis-data');
    _analysisAt = null;
    document.getElementById('analysis-body').innerHTML = '<div style="color:var(--muted);font-size:13px;">Click <strong>Analyze</strong> to generate insights.</div>';
    document.getElementById('analysis-email-btn').style.display = 'none';
    document.getElementById('analysis-msg').style.display = 'none';
    loadRaceData();
  } catch(e) {
    msg.style.display = 'block';
    msg.style.color = 'var(--danger)';
    msg.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.dataset.confirming = '';
    btn.textContent = 'Delete All My Data';
  }
}

async function confirmDeleteData(btn) {
  const msg = document.getElementById('delete-data-msg');
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm Delete';
    setTimeout(() => { btn.dataset.confirming = ''; btn.textContent = 'Delete Data'; }, 5000);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  msg.style.display = 'none';
  try {
    await Promise.all([
      _supabase.from('call_log').delete().eq('user_id', _userId),
      _supabase.from('sales_log').delete().eq('user_id', _userId),
      _supabase.from('historical_wins').delete().eq('user_id', _userId),
      _supabase.from('historical_months').delete().eq('user_id', _userId),
      _supabase.from('checklist_submissions').delete().eq('user_id', _userId),
    ]);
    await _supabase.from('race_data').delete().eq('user_id', _userId);
    await _supabase.from('race_config').update({ value: '' }).eq('user_id', _userId).eq('key', 'current_month');
    _raceData = []; _history = []; _perfData = null;
    _lsRemove('br-analysis-data');
    _analysisAt = null;
    document.getElementById('analysis-body').innerHTML = '<div style="color:var(--muted);font-size:13px;">Click <strong>Analyze</strong> to generate insights.</div>';
    document.getElementById('analysis-email-btn').style.display = 'none';
    document.getElementById('analysis-msg').style.display = 'none';
    loadRaceData();
    msg.style.display = 'block';
    msg.style.color = 'var(--accent2)';
    msg.textContent = 'All data deleted. Ready for a fresh upload.';
  } catch(e) {
    msg.style.display = 'block';
    msg.style.color = 'var(--danger)';
    msg.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.dataset.confirming = '';
    btn.textContent = 'Delete Data';
  }
}

async function confirmDeleteAccount(btn) {
  const msg = document.getElementById('delete-account-msg');
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm — this will erase everything';
    setTimeout(() => {
      if (btn.dataset.confirming === 'yes') {
        btn.dataset.confirming = '';
        btn.textContent = 'Delete My Account';
      }
    }, 5000);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  msg.style.display = 'none';
  try {
    const r = await fetch('/api/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + _session.access_token },
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Delete failed');
    await _supabase.auth.signOut();
    showScreen('login');
    const liMsg = document.getElementById('li-msg');
    liMsg.style.display = 'block';
    liMsg.className = 'auth-msg';
    liMsg.textContent = 'Your account has been deleted.';
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Delete My Account';
    msg.style.display = 'block';
    msg.style.color = 'var(--danger)';
    msg.textContent = err.message;
  }
}

async function changePassword() {
  const p1 = document.getElementById('ac-newpass').value;
  const p2 = document.getElementById('ac-confpass').value;
  const msg = document.getElementById('ac-pw-msg');
  msg.style.display = 'block';
  if (!p1 || p1.length < 8) { msg.style.color='var(--danger)'; msg.textContent='Password must be at least 8 characters.'; return; }
  if (p1 !== p2) { msg.style.color='var(--danger)'; msg.textContent='Passwords do not match.'; return; }
  const { error } = await _supabase.auth.updateUser({ password: p1 });
  if (error) { msg.style.color='var(--danger)'; msg.textContent=error.message; }
  else { msg.style.color='var(--accent2)'; msg.textContent='Password updated.'; document.getElementById('ac-newpass').value=''; document.getElementById('ac-confpass').value=''; }
  setTimeout(() => { msg.style.display='none'; }, 4000);
}

function buildColumnMapUI() {
  document.getElementById('col-map-grid').innerHTML = COL_FIELDS.map(f =>
    `<div class="col-map-item">
      <div class="field-label-row">
        <label>${FIELD_LABELS[f]}</label>
        ${FIELD_HINTS[f] ? `<span class="info-tip" data-tip="${FIELD_HINTS[f]}">i</span>` : ''}
      </div>
      <input type="text" id="cmap-${f}" placeholder="Column header in your file" value="${_columnMap[f]||''}"></div>`
  ).join('');
}

async function saveContactInfo() {
  const contact = document.getElementById('ac-contact').value.trim();
  const phone   = document.getElementById('ac-phone').value.trim();
  const msg     = document.getElementById('ac-contact-msg');
  msg.style.display = 'block';
  const { error } = await _supabase.from('accounts').update({ contact_name: contact, phone }).eq('user_id', _userId);
  if (error) { msg.style.color='var(--danger)'; msg.textContent='Error: '+error.message; }
  else { msg.style.color='var(--accent2)'; msg.textContent='Contact info saved.'; }
  setTimeout(() => { msg.style.display='none'; }, 3000);
}

async function saveReportPrefs() {
  const timezone     = document.getElementById('ac-timezone').value;
  const report_hour  = parseInt(document.getElementById('ac-report-hour').value, 10);
  const report_email = document.getElementById('ac-report-email').value.trim() || null;
  const msg          = document.getElementById('ac-report-msg');
  msg.style.display  = 'block';
  const { error } = await _supabase.from('accounts').update({ timezone, report_hour, report_email }).eq('user_id', _userId);
  if (error) { msg.style.color='var(--danger)'; msg.textContent='Error: '+error.message; }
  else { msg.style.color='var(--accent2)'; msg.textContent='Report preferences saved.'; }
  setTimeout(() => { msg.style.display='none'; }, 3000);
}

function selectPlan(plan, el) {
  if (plan === _currentPlan && _acctStatus !== 'trial') return;
  _selectedPlan = plan;
  document.querySelectorAll('.plan-tier').forEach(t => t.classList.remove('plan-selected'));
  el.classList.add('plan-selected');
  document.getElementById('plan-upgrade-btn').style.display = '';
  document.getElementById('plan-upgrade-btn').textContent =
    _acctStatus === 'paid' || _acctStatus === 'deferred'
      ? 'Change Plan — Checkout with Stripe'
      : 'Subscribe — Checkout with Stripe';
}

async function requestPlanUpgrade() {
  if (!_selectedPlan || _selectedPlan === _currentPlan) return;
  const btn = document.getElementById('plan-upgrade-btn');
  const msg = document.getElementById('ac-plan-msg');
  btn.disabled = true;
  btn.textContent = 'Redirecting to Stripe…';
  try {
    const r = await fetch('/api/stripe-checkout', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: _selectedPlan }),
    });
    const data = await r.json();
    if (!r.ok || !data.url) throw new Error(data.error || 'Checkout failed');
    window.location.href = data.url;
  } catch (err) {
    msg.style.display = 'block';
    msg.style.color = 'var(--danger)';
    msg.textContent = 'Error: ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Subscribe — Checkout with Stripe';
    setTimeout(() => { msg.style.display = 'none'; }, 5000);
  }
}

async function openBillingPortal() {
  const btn = document.getElementById('plan-portal-btn');
  const msg = document.getElementById('ac-plan-msg');
  btn.disabled = true;
  btn.textContent = 'Opening portal…';
  try {
    const r = await fetch('/api/stripe-portal', {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await r.json();
    if (!r.ok || !data.url) throw new Error(data.error || 'Portal unavailable');
    window.location.href = data.url;
  } catch (err) {
    msg.style.display = 'block';
    msg.style.color = 'var(--danger)';
    msg.textContent = 'Error: ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Manage Billing & Subscription';
    setTimeout(() => { msg.style.display = 'none'; }, 5000);
  }
}

async function saveColumnMap() {
  const map = {};
  COL_FIELDS.forEach(f => {
    const val = document.getElementById('cmap-' + f)?.value.trim();
    if (val) map[f] = val;
  });
  if (_columnMap._types) map._types = _columnMap._types;
  _columnMap = map;
  const { error } = await _supabase.from('accounts').update({ sales_column_map: _columnMap }).eq('user_id', _userId);
  const msg = document.getElementById('colmap-msg');
  msg.style.display = 'block';
  if (error) { msg.style.color='var(--danger)'; msg.textContent='Error: '+error.message; }
  else { msg.style.color='var(--accent2)'; msg.textContent='Column mapping saved.'; }
  setTimeout(() => { msg.style.display='none'; }, 3000);
}

// ── ADMIN PANEL ───────────────────────────────────────────────────────────────
async function loadAdminPanel() {
  if (!_isAdmin) return;
  const hdrs = authHeaders();
  const res  = await fetch('/api/admin', { headers: hdrs });
  if (!res.ok) return;
  _adminRows = await res.json();
  renderAdminTable(_adminRows);
}

function renderAdminTable(rows) {
  document.getElementById('admin-body').innerHTML = rows.map(r => `
    <tr data-uid="${r.user_id}">
      <td>${escHtml(r.email||'')}</td>
      <td>${r.company_name?escHtml(r.company_name):'—'}</td>
      <td>${r.contact_name?escHtml(r.contact_name):'—'}</td>
      <td><select class="admin-select" onchange="adminSave('${r.user_id}','plan',this.value)">
        ${['basic','pro','premium'].map(p =>
          `<option value="${p}"${p===(r.plan||'basic')?' selected':''}>${p} — $${PLAN_PRICES[p]||'?'}</option>`).join('')}
      </select></td>
      <td><select class="admin-select" onchange="adminSave('${r.user_id}','status',this.value)">
        ${['trial','paid','deferred','past_due','cancelled'].map(s =>
          `<option value="${s}"${s===(r.status||'trial')?' selected':''}>${s}</option>`).join('')}
      </select></td>
      <td>${r.agent_count||1}</td>
      <td>${r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString() : '—'}</td>
      <td>${r.paid_through  ? new Date(r.paid_through).toLocaleDateString()  : '—'}</td>
      <td><input class="admin-notes" value="${(r.notes||'').replace(/"/g,'&quot;')}" onblur="adminSave('${r.user_id}','notes',this.value)"></td>
      <td style="min-width:170px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <div style="display:flex;align-items:center;gap:4px;">
            <button onclick="adminSave('${r.user_id}','has_sales_addon',${!r.has_sales_addon})"
              style="font-size:10px;padding:2px 7px;border-radius:4px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;
                background:${r.has_sales_addon?'rgba(0,255,148,.15)':'rgba(255,255,255,.06)'};
                color:${r.has_sales_addon?'var(--accent2)':'var(--muted)'};"
              title="${r.has_sales_addon?'Disable':'Enable'} Sales Tracking">
              Sales ${r.has_sales_addon?'✓':'—'}
            </button>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <button onclick="adminSave('${r.user_id}','has_member_analysis',${!r.has_member_analysis})"
              style="font-size:10px;padding:2px 7px;border-radius:4px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;
                background:${r.has_member_analysis?'rgba(0,212,255,.15)':'rgba(255,255,255,.06)'};
                color:${r.has_member_analysis?'var(--accent)':'var(--muted)'};"
              title="${r.has_member_analysis?'Disable':'Enable'} Member Analysis">
              Analysis ${r.has_member_analysis?'✓':'—'}
            </button>
            ${r.has_member_analysis ? `<input type="number" min="1" max="99" value="${r.member_analysis_count||1}"
              onblur="adminSave('${r.user_id}','member_analysis_count',parseInt(this.value)||1)"
              title="Agent seats"
              style="width:38px;padding:2px 5px;font-size:11px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:4px;text-align:center;">` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <button onclick="adminSave('${r.user_id}','has_commissions_addon',${!r.has_commissions_addon})"
              style="font-size:10px;padding:2px 7px;border-radius:4px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;
                background:${r.has_commissions_addon?'rgba(255,140,66,.15)':'rgba(255,255,255,.06)'};
                color:${r.has_commissions_addon?'var(--bronze)':'var(--muted)'};"
              title="${r.has_commissions_addon?'Disable':'Enable'} Commissions">
              Comm ${r.has_commissions_addon?'✓':'—'}
            </button>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <button onclick="adminSave('${r.user_id}','has_lead_analysis_addon',${!r.has_lead_analysis_addon})"
              style="font-size:10px;padding:2px 7px;border-radius:4px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;
                background:${r.has_lead_analysis_addon?'rgba(123,97,255,.15)':'rgba(255,255,255,.06)'};
                color:${r.has_lead_analysis_addon?'var(--purple, #7b61ff)':'var(--muted)'};"
              title="${r.has_lead_analysis_addon?'Disable':'Enable'} Lead Analysis">
              Lead ${r.has_lead_analysis_addon?'✓':'—'}
            </button>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <button onclick="adminSave('${r.user_id}','credit_waived',${!r.credit_waived})"
              style="font-size:10px;padding:2px 7px;border-radius:4px;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;
                background:${r.credit_waived?'rgba(251,191,36,.15)':'rgba(255,255,255,.06)'};
                color:${r.credit_waived?'var(--gold)':'var(--muted)'};"
              title="${r.credit_waived?'Remove':'Grant'} free re-runs">
              Credits ${r.credit_waived?'✓':'—'}
            </button>
          </div>
        </div>
      </td>
      <td>${r.is_admin?'✓':''}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap;">
        <select class="admin-select" onchange="adminSave('${r.user_id}','status',this.value)">
          ${['trial','paid','deferred','past_due','cancelled'].map(s =>
            `<option value="${s}"${s===r.status?' selected':''}>${s}</option>`).join('')}
        </select>
        ${!r.is_admin ? `<button class="btn btn-danger" style="font-size:11px;padding:4px 8px;" onclick="adminDeleteUser('${r.user_id}','${(r.email||'').replace(/'/g,"\\'")}',this)">Delete</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="12" style="color:var(--muted);text-align:center;padding:20px">No accounts</td></tr>';
}

function filterAdminTable() {
  const q = document.getElementById('admin-search').value.toLowerCase();
  const filtered = _adminRows.filter(r =>
    (r.email||'').toLowerCase().includes(q) || (r.company_name||'').toLowerCase().includes(q));
  renderAdminTable(filtered);
}

async function loadAccessLog() {
  if (!_isAdmin) return;
  const action = document.getElementById('al-action')?.value || 'all';
  const days   = document.getElementById('al-days')?.value   || '30';
  const actor  = (document.getElementById('al-actor')?.value || '').trim();
  const params = new URLSearchParams({ action, days });
  if (actor) params.set('actor', actor);
  try {
    const r = await fetch(`/api/access-log?${params}`, { headers: authHeaders() });
    if (!r.ok) return;
    const { entries } = await r.json();
    _accessLogEntries = entries || [];
    renderAccessLog();
  } catch { /* non-fatal */ }
}

function renderAccessLog() {
  const tbody = document.getElementById('al-body');
  const count = document.getElementById('al-count');
  if (!tbody) return;
  if (count) count.textContent = _accessLogEntries.length ? `${_accessLogEntries.length} entries` : '';
  if (!_accessLogEntries.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px;">No entries found.</td></tr>';
    return;
  }
  const COLOR = { export: '#00d4ff', edit: '#ff8c42', delete: '#ff4d6d' };
  tbody.innerHTML = _accessLogEntries.map(e => {
    const dt      = new Date(e.created_at);
    const dateStr = dt.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
                  + ' ' + dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    const account = e.account_company || e.account_email || (e.user_id||'').slice(0,8) || '—';
    const actor   = e.actor_email     || (e.actor_user_id||'').slice(0,8) || '—';
    const color   = COLOR[e.action]   || '#aaa';
    let details = '—';
    if (e.action === 'export') {
      const m = e.metadata || {};
      const period = m.all_year ? `All ${m.year}` : `${String(m.month).padStart(2,'0')}/${m.year}`;
      details = `${e.row_count ?? '?'} rows · ${period}`;
    } else if (e.action === 'edit') {
      details = (e.metadata?.fields || []).join(', ') || (e.record_hash||'').slice(0,8) || '—';
    } else if (e.action === 'delete') {
      details = (e.record_hash||'').slice(0,8) || '—';
    }
    return `<tr>
      <td style="white-space:nowrap;font-size:12px;">${dateStr}</td>
      <td style="font-size:12px;">${account}</td>
      <td style="font-size:12px;">${actor}</td>
      <td><span style="background:${color}22;color:${color};padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;">${e.action}</span></td>
      <td style="font-size:12px;color:var(--muted);">${details}</td>
    </tr>`;
  }).join('');
}

async function adminSave(uid, field, value) {
  if (!_isAdmin) return;
  const hdrs = authHeaders();
  await fetch('/api/admin', {
    method: 'PATCH',
    headers: { ...hdrs, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: uid, [field]: value })
  });
  await loadAdminPanel();
}

async function adminDeleteUser(uid, email, btn) {
  if (!_isAdmin) return;
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm?';
    btn.style.background = 'var(--danger)';
    btn.style.color = '#fff';
    setTimeout(() => {
      if (btn.dataset.confirming === 'yes') {
        btn.dataset.confirming = '';
        btn.textContent = 'Delete';
        btn.style.background = '';
        btn.style.color = '';
      }
    }, 5000);
    return;
  }
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const r = await fetch('/api/delete-account', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: uid }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Delete failed');
    await loadAdminPanel();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Delete';
    alert('Delete failed: ' + err.message);
  }
}

// ── ARCHIVE / RESET ───────────────────────────────────────────────────────────
async function confirmArchive() {
  if (_isMember && _memberRole !== 'captain') return;
  if (!confirm('Archive current month results to history and reset the race? This cannot be undone.')) return;

  const { data: rdRows } = await _supabase.from('race_data').select('*').eq('user_id', _dataUserId);
  const { data: rcRow  } = await _supabase.from('race_config').select('value').eq('user_id', _dataUserId).eq('key','current_month').single();

  const _ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Derive month label — prefer race_config, fall back to most common month in call_log
  let rawMonth = rcRow?.value || '';
  if (!rawMonth) {
    const { data: recentCalls } = await _supabase
      .from('call_log')
      .select('call_dt')
      .eq('user_id', _userId)
      .limit(500);
    if (recentCalls?.length) {
      const freq = {};
      for (const r of recentCalls) {
        const d = new Date(String(r.call_dt).split('T')[0] + 'T12:00:00Z');
        if (isNaN(d.getTime())) continue;
        const k = `${_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        freq[k] = (freq[k] || 0) + 1;
      }
      rawMonth = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }
  }
  if (!rawMonth) rawMonth = new Date().toISOString().slice(0, 7);

  // Normalize to abbreviated "Mon YYYY" — handles ISO "2026-04", full "March 2026", or already-abbrev "Mar 2026"
  const _isoM  = rawMonth.match(/^(\d{4})-(\d{2})$/);
  const _FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const _fullIdx = _FULL.indexOf(rawMonth.split(' ')[0]);
  const month = _isoM    ? _ABBR[parseInt(_isoM[2])-1] + ' ' + _isoM[1]
              : _fullIdx >= 0 ? _ABBR[_fullIdx] + ' ' + rawMonth.split(' ')[1]
              : rawMonth;

  if (rdRows?.length) {
    const agents = rdRows.map((ag) => {
      const sc = calcScore(ag);
      return { ...ag, ...sc };
    }).sort((a,b) => b.total - a.total);

    // Guard: if all scores are 0, check if we'd overwrite non-zero historical data
    const totalScore = agents.reduce((s, ag) => s + (ag.total || 0), 0);
    if (totalScore === 0) {
      const { data: existHist } = await _supabase
        .from('historical_wins').select('total_score').eq('user_id', _dataUserId).eq('month', month).limit(1);
      const existingScore = existHist?.[0]?.total_score || 0;
      if (existingScore > 0) {
        if (!confirm(`Warning: The current race has no scored data, but ${month} already has recorded results (scores > 0). Archiving now will overwrite that history with zeros.\n\nAre you sure you want to overwrite?`)) return;
      }
    }

    const histRows = agents.map((ag, i) => ({
      user_id: _dataUserId,
      month,
      rank: i + 1,
      agent_id: ag.agent_id,
      name: ag.name,
      team: ag.team,
      total_score: ag.total,
      gross_score: ag.gross,
      deductions: ag.deduct,
      wl: ag.wl||0, ul: ag.ul||0, term: ag.term||0,
      health: ag.health||0, auto: ag.auto||0, fire: ag.fire||0,
      placed: ag.placed||0, answered: ag.answered||0,
      missed: ag.missed||0, voicemail: ag.voicemail||0,
      talk_min: ag.talk_min||0, avg_min: ag.avg_min||0,
      race_wide_missed: _raceWideMissed,
      race_wide_voicemail: _raceWideVm,
    }));

    await _supabase.from('historical_wins').delete().eq('user_id', _dataUserId).eq('month', month);
    await _supabase.from('historical_wins').insert(histRows);

    // Compute date range for the archived month to scope sales queries
    const _archiveParts = month.trim().split(' ');
    const _archiveIdx   = _ABBR.indexOf(_archiveParts[0]);
    const _archiveYr    = parseInt(_archiveParts[1]);
    let _archiveFrom = null, _archiveTo = null;
    if (_archiveIdx >= 0 && !isNaN(_archiveYr)) {
      _archiveFrom = `${_archiveYr}-${String(_archiveIdx + 1).padStart(2,'0')}-01`;
      const nextMo = _archiveIdx === 11 ? 1 : _archiveIdx + 2;
      const nextYr = _archiveIdx === 11 ? _archiveYr + 1 : _archiveYr;
      _archiveTo   = `${nextYr}-${String(nextMo).padStart(2,'0')}-01`;
    }

    // Write monthly call/sales aggregates for trend chart persistence
    const placed   = rdRows.reduce((s, ag) => s + (ag.placed||0), 0);
    const answered = rdRows.reduce((s, ag) => s + (ag.answered||0), 0);
    const talkMin  = rdRows.reduce((s, ag) => s + (ag.talk_min||0), 0);
    const voicemail = _raceWideVm;
    const missed    = _raceWideMissed;
    let salesCountQ = _supabase.from('sales_log').select('*', { count: 'exact', head: true }).eq('user_id', _dataUserId);
    if (_archiveFrom) salesCountQ = salesCountQ.gte('sale_date', _archiveFrom).lt('sale_date', _archiveTo);
    const { count: salesCount } = await salesCountQ;

    await _supabase.from('historical_months').upsert({
      user_id: _dataUserId, month,
      placed, answered,
      talk_min: Math.round(talkMin),
      voicemail, missed,
      policies: salesCount || 0,
    }, { onConflict: 'user_id,month' });
  }

  // Delete all agents from race so next upload builds a fresh roster
  await _supabase.from('race_data').delete().eq('user_id', _dataUserId);

  await _supabase.from('call_log').delete().eq('user_id', _dataUserId);
  // sales_log is a permanent ledger — individual records are preserved across archives
  await _supabase.from('race_config').update({ value: '' }).eq('user_id', _dataUserId).eq('key','current_month');

  // Invalidate analysis cache so the next Analyze reflects the newly archived month
  await _supabase.from('accounts').update({ ai_analysis_cache: null, ai_analysis_at: null }).eq('user_id', _dataUserId);
  _lsRemove('br-analysis-data');
  _analysisAt = null;

  await loadRaceData();
  await loadHistory();
  alert('Month archived and race reset.');
}

// Tallies sales_log rows into per-agent policy counts. Split sales are represented as
// TWO independent rows (one per agent, each with its own agent_id and sale_weight=0.5),
// not one row with a "teammate" field standing in for a second agent — so a plain
// per-row credit on row.agent_id is correct and can't double-count. Shared by
// recalcSales() and setRaceMonth() so this logic can't drift between the two again.
function _tallySalesTotals(salesRows) {
  const totals = {};
  for (const r of (salesRows || [])) {
    const cat = r.product;
    if (!r.agent_id || cat === 'other' || cat === 'deposit' || cat === 'skip') continue;
    if (!totals[r.agent_id]) totals[r.agent_id] = { wl:0, ul:0, term:0, health:0, auto:0, fire:0 };
    if (totals[r.agent_id][cat] !== undefined) totals[r.agent_id][cat] += (r.sale_weight ?? 1);
  }
  return totals;
}

// ── SET RACE MONTH ───────────────────────────────────────────────────────────
async function setRaceMonth() {
  if (_isMember && _memberRole !== 'captain') return;
  const input = document.getElementById('set-race-month-input');
  const msg   = document.getElementById('set-race-month-msg');
  const val   = input?.value; // "YYYY-MM"
  if (!val) { if (msg) { msg.textContent = 'Pick a month first.'; msg.style.color = 'var(--accent2)'; } return; }
  const [yr, mo] = val.split('-').map(Number);
  const FULL12 = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthLabel = `${FULL12[mo-1]} ${yr}`;
  if (!confirm(`Set the current race month to ${monthLabel}? This will rebuild race scores from the sales log for that month.`)) return;

  if (msg) { msg.textContent = 'Updating…'; msg.style.color = 'var(--muted)'; }

  // Update race_config
  await _supabase.from('race_config').upsert(
    { user_id: _dataUserId, key: 'current_month', value: monthLabel },
    { onConflict: 'user_id,key' }
  );

  // Rebuild race_data sales from this month's sales_log entries
  const from = `${yr}-${String(mo).padStart(2,'0')}-01`;
  const toMo = mo === 12 ? 1 : mo + 1;
  const toYr = mo === 12 ? yr + 1 : yr;
  const to   = `${toYr}-${String(toMo).padStart(2,'0')}-01`;

  const { data: salesRows } = await _supabase
    .from('sales_log')
    .select('agent_id, product, sale_weight')
    .eq('user_id', _dataUserId)
    .eq('is_cancelled', false)
    .gte('sale_date', from)
    .lt('sale_date', to);

  const totals = _tallySalesTotals(salesRows);

  // Seed race_data rows for agents in sales_log that don't have an existing row
  const agentIdsWithSales = Object.keys(totals);
  if (agentIdsWithSales.length) {
    const { data: rosterRows } = await _supabase
      .from('agent_roster')
      .select('agent_id, name, team')
      .eq('user_id', _dataUserId)
      .in('agent_id', agentIdsWithSales);
    const nameMap = {};
    const teamMap = {};
    for (const r of (rosterRows || [])) { nameMap[r.agent_id] = r.name; teamMap[r.agent_id] = r.team; }
    const seedRows = agentIdsWithSales.map(id => ({
      user_id: _dataUserId, agent_id: id,
      name: nameMap[id] || id, team: teamMap[id] || 'sales',
      wl:0, ul:0, term:0, health:0, auto:0, fire:0,
      placed:0, answered:0, missed:0, voicemail:0,
      talk_min:0, avg_min:0, race_wide_missed:0, race_wide_voicemail:0,
    }));
    await _supabase.from('race_data').upsert(seedRows, { onConflict: 'user_id,agent_id', ignoreDuplicates: true });
  }

  // Apply to race_data — zero agents with no sales, set totals for agents with sales
  const { data: raceAgents } = await _supabase.from('race_data').select('agent_id').eq('user_id', _dataUserId);
  const updateFailures = [];
  for (const row of (raceAgents || [])) {
    const t = totals[row.agent_id] || { wl:0, ul:0, term:0, health:0, auto:0, fire:0 };
    const { error } = await _supabase.from('race_data').update(t).eq('user_id', _dataUserId).eq('agent_id', row.agent_id);
    if (error) updateFailures.push(row.agent_id);
  }

  if (msg) {
    msg.textContent = updateFailures.length
      ? `Set to ${monthLabel}, but failed to update: ${updateFailures.join(', ')}.`
      : `Set to ${monthLabel}.`;
    msg.style.color = updateFailures.length ? 'var(--danger)' : 'var(--accent)';
  }
  await loadRaceData();
}

// Rebuilds race_data sales totals from sales_log for the current race month.
// Use after checklist/manual sales were submitted without a corresponding race update.
async function recalcSales(btn) {
  if (_isMember && _memberRole !== 'captain') return;
  const msg = document.getElementById('set-race-month-msg');
  if (!_raceCurrentMonth) {
    if (msg) { msg.textContent = 'No race month set.'; msg.style.color = 'var(--accent2)'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Recalculating…'; }
  if (msg) { msg.textContent = 'Recalculating…'; msg.style.color = 'var(--muted)'; }
  try {
    const FULL12 = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const ABBR   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts  = _raceCurrentMonth.trim().split(' ');
    let idx = FULL12.indexOf(parts[0]);
    if (idx === -1) idx = ABBR.indexOf(parts[0]);
    const yr = parseInt(parts[1]);
    if (idx === -1 || isNaN(yr)) throw new Error('Could not parse race month: ' + _raceCurrentMonth);
    const from  = `${yr}-${String(idx + 1).padStart(2,'0')}-01`;
    const toMo  = idx === 11 ? 1 : idx + 2;
    const toYr  = idx === 11 ? yr + 1 : yr;
    const to    = `${toYr}-${String(toMo).padStart(2,'0')}-01`;

    const { data: salesRows } = await _supabase
      .from('sales_log')
      .select('agent_id, product, sale_weight')
      .eq('user_id', _dataUserId)
      .eq('is_cancelled', false)
      .gte('sale_date', from)
      .lt('sale_date', to);

    const totals = _tallySalesTotals(salesRows);

    const agentIdsWithSales = Object.keys(totals);
    if (agentIdsWithSales.length) {
      const { data: rosterRows } = await _supabase
        .from('agent_roster').select('agent_id, name, team')
        .eq('user_id', _dataUserId).in('agent_id', agentIdsWithSales);
      const nameMap = {}, teamMap = {};
      for (const r of (rosterRows || [])) { nameMap[r.agent_id] = r.name; teamMap[r.agent_id] = r.team; }
      const seedRows = agentIdsWithSales.map(id => ({
        user_id: _dataUserId, agent_id: id,
        name: nameMap[id] || id, team: teamMap[id] || 'sales',
        wl:0, ul:0, term:0, health:0, auto:0, fire:0,
        placed:0, answered:0, missed:0, voicemail:0,
        talk_min:0, avg_min:0, race_wide_missed:0, race_wide_voicemail:0,
      }));
      await _supabase.from('race_data').upsert(seedRows, { onConflict: 'user_id,agent_id', ignoreDuplicates: true });
    }

    const { data: raceAgents } = await _supabase.from('race_data').select('agent_id').eq('user_id', _dataUserId);
    const updateFailures = [];
    for (const row of (raceAgents || [])) {
      const t = totals[row.agent_id] || { wl:0, ul:0, term:0, health:0, auto:0, fire:0 };
      const { error } = await _supabase.from('race_data').update(t).eq('user_id', _dataUserId).eq('agent_id', row.agent_id);
      if (error) updateFailures.push(row.agent_id);
    }

    if (msg) {
      msg.textContent = updateFailures.length
        ? `Sales recalculated, but failed to update: ${updateFailures.join(', ')}.`
        : 'Sales recalculated.';
      msg.style.color = updateFailures.length ? 'var(--danger)' : 'var(--accent)';
    }
    await loadRaceData();
  } catch(e) {
    if (msg) { msg.textContent = e.message; msg.style.color = 'var(--danger)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Recalculate Sales'; }
  }
}

// ── MEMBER TAB GATING ────────────────────────────────────────────────────────
function getAllowedTabs() {
  if (!_isMember) return null;
  switch (_memberRole) {
    case 'captain':       return ['race','scoring','manage','perf','analysis','history'];
    case 'chief_officer': return ['race','scoring','manage','perf','history'];
    case 'bosun': {
      const bosunTabs = ['race','history','perf'];
      if (_selfReportConfig?.activities_enabled || _selfReportConfig?.sales_enabled) bosunTabs.push('manage');
      return bosunTabs;
    }
    case 'custom': {
      const customBase = _memberCustomTabs.length ? _memberCustomTabs : ['race'];
      if (!customBase.includes('history')) customBase.push('history');
      if ((_selfReportConfig?.activities_enabled || _selfReportConfig?.sales_enabled) && !customBase.includes('manage')) customBase.push('manage');
      return customBase;
    }
    default:              return ['race','history'];
  }
}

function _applyPerfMemberGating() {
  const memberLimited = _isMember && !['captain','chief_officer'].includes(_memberRole);
  ['callperf','saleslog','salesperf','commissions'].forEach(sub => {
    const btn = document.getElementById(`perf-stab-${sub}`);
    if (!btn) return;
    // Non-captain/CO members see salesperf + commissions (both scoped to their own agent server-side)
    if (memberLimited) { btn.style.display = (sub === 'salesperf' || sub === 'commissions' || sub === 'saleslog') ? '' : 'none'; return; }
    btn.style.display = '';
  });
}

function applyMemberTabGating() {
  const allowed = getAllowedTabs();
  document.querySelectorAll('.tab').forEach(btn => {
    const match   = (btn.getAttribute('onclick') || '').match(/'(\w+)'/);
    const tabName = match ? match[1] : null;
    if (!tabName || tabName === 'account') return;
    btn.style.display = allowed.includes(tabName) ? '' : 'none';
  });
  // Hide admin tab always for members
  const adminTab = document.getElementById('adminTab');
  if (adminTab) adminTab.style.display = 'none';
  // Show analysis tab only if captain/custom-with-analysis
  const analysisTab = document.getElementById('analysisTab');
  if (analysisTab) {
    const showAnalysis = allowed.includes('analysis') &&
      (_currentPlan === 'premium') && ['paid','deferred'].includes(_acctStatus);
    analysisTab.style.display = showAnalysis ? '' : 'none';
  }
  // Default tab: first allowed tab
  const defaultTab = allowed[0] || 'race';
  const defaultBtn = document.querySelector(`.tab[onclick*="'${defaultTab}'"]`);
  showTab(defaultTab, defaultBtn);
}

// ── INVITE ACCEPT FLOW ───────────────────────────────────────────────────────
async function loadInviteScreen(token) {
  showScreen('invite');
  window._pendingInviteToken = token;
  try {
    const res  = await fetch(`/api/invite?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok || !data.valid) {
      showScreen('login');
      showMsg('li-msg', data.error || 'Invalid or expired invite link.');
      return;
    }
    document.getElementById('invite-email').value       = data.email;
    document.getElementById('invite-company-msg').textContent =
      `You've been invited to view ${data.company}'s dashboard as ${data.roleLabel}.`;
  } catch(e) {
    showScreen('login');
    showMsg('li-msg', 'Could not load invite: ' + e.message);
  }
}

async function acceptInvite() {
  const name  = (document.getElementById('invite-name').value  || '').trim();
  const pass  = document.getElementById('invite-pass').value;
  const pass2 = document.getElementById('invite-pass2').value;
  const token = window._pendingInviteToken;

  if (!name)          return showMsg('invite-msg', 'Please enter your name.');
  if (pass.length < 8) return showMsg('invite-msg', 'Password must be at least 8 characters.');
  if (pass !== pass2) return showMsg('invite-msg', 'Passwords do not match.');

  const btn = document.getElementById('invite-btn');
  btn.disabled = true;
  showMsg('invite-msg', 'Setting up your access…', 'ok');

  try {
    const res  = await fetch('/api/invite?action=accept', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, name, password: pass }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'already_exists') {
        showMsg('invite-msg', 'An account with this email already exists. Please sign in instead.');
      } else {
        showMsg('invite-msg', data.error || 'Something went wrong.');
      }
      btn.disabled = false;
      return;
    }
    // Auto-login with the credentials they just created
    showMsg('invite-msg', 'Account created — signing you in…', 'ok');
    const email = document.getElementById('invite-email').value;
    const { error: signInErr } = await _supabase.auth.signInWithPassword({ email, password: pass });
    if (signInErr) {
      showMsg('invite-msg', 'Account created. Please sign in manually.');
      setTimeout(() => showScreen('login'), 2000);
    }
    // onAuthStateChange will fire and call checkAccountAndShow
  } catch(e) {
    showMsg('invite-msg', 'Error: ' + e.message);
    btn.disabled = false;
  }
}

// ── MEMBER ACCOUNT TAB ───────────────────────────────────────────────────────
function loadMemberAccountTab() {
  // Hide sub-tab nav and all owner panes
  const nav = document.getElementById('acct-subtab-nav');
  if (nav) nav.style.display = 'none';
  document.querySelectorAll('#tab-account .acct-pane').forEach(p => p.style.display = 'none');
  ['sandbox-reset-section','danger-zone-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  // Show member panel
  const mp = document.getElementById('member-account-panel');
  if (mp) {
    mp.style.display = '';
    const ROLE_LABELS = { captain:'Captain', chief_officer:'Chief Officer', bosun:'Bosun', custom:'Custom' };
    document.getElementById('member-info-grid').innerHTML = `
      <div class="acct-info-item"><div class="acct-info-label">Viewing</div><div class="acct-info-val">${_ownerCompany || '—'}</div></div>
      <div class="acct-info-item"><div class="acct-info-label">Your Role</div><div class="acct-info-val" style="color:var(--accent);">${ROLE_LABELS[_memberRole] || _memberRole}</div></div>
      <div class="acct-info-item"><div class="acct-info-label">Your Email</div><div class="acct-info-val" style="font-size:13px;">${_userEmail}</div></div>
    `;
  }
}

async function changeMemberPassword() {
  const p1 = document.getElementById('mac-newpass').value;
  const p2 = document.getElementById('mac-confpass').value;
  const msg = document.getElementById('mac-pw-msg');
  if (!p1 || p1.length < 8) { msg.style.display='block'; msg.style.color='var(--danger)'; msg.textContent='Password must be at least 8 characters.'; return; }
  if (p1 !== p2)            { msg.style.display='block'; msg.style.color='var(--danger)'; msg.textContent='Passwords do not match.'; return; }
  const { error } = await _supabase.auth.updateUser({ password: p1 });
  msg.style.display = 'block';
  if (error) { msg.style.color='var(--danger)'; msg.textContent='Error: ' + error.message; }
  else       { msg.style.color='var(--accent2)'; msg.textContent='Password updated.'; document.getElementById('mac-newpass').value=''; document.getElementById('mac-confpass').value=''; }
}

// ── AGENCY MANAGEMENT ────────────────────────────────────────────────────────
const ROLE_DESC = {
  bosun:         'Can view the Race tab only — scores, rankings, and team standings.',
  chief_officer: 'Can view Race, Scoring, Manage, and Performance tabs.',
  captain:       'Full dashboard access — all tabs except billing and account management.',
  custom:        'Choose which specific tabs this person can access.',
};
const ROLE_LABEL = { captain:'Captain', chief_officer:'Chief Officer', bosun:'Bosun', custom:'Custom' };

const ALL_MEMBER_TABS = ['race','scoring','manage','perf','analysis','history'];
const MEMBER_TAB_LABELS = { race:'Race', scoring:'Scoring', manage:'Manage', perf:'Performance', analysis:'Analysis', history:'History' };

function renderMemberRow(m) {
  const tabCbs = ALL_MEMBER_TABS.map(tab => {
    const chk = (m.custom_tabs || []).includes(tab) ? ' checked' : '';
    return `<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" class="mb-tab-cb-${m.id}" value="${tab}"${chk}> ${MEMBER_TAB_LABELS[tab]}</label>`;
  }).join('');
  const roleOpts = ['bosun','chief_officer','captain','custom'].map(r =>
    `<option value="${r}"${r===m.role?' selected':''}>${ROLE_LABEL[r]}</option>`
  ).join('');
  const statusColor = m.status === 'active' ? 'var(--accent2)' : 'var(--warn)';
  const resendBtn = m.status === 'invited'
    ? `<button onclick="resendInvite('${m.id}','${escHtml(m.email)}',this)" style="background:none;border:1px solid rgba(255,255,255,.15);color:var(--muted);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;margin-right:6px;">Resend</button>`
    : '';
  const rosterOpts = _agentRoster.map(a =>
    `<option value="${escHtml(a.agent_id)}"${m.roster_agent_id === a.agent_id ? ' selected' : ''}>${escHtml(a.name)}</option>`
  ).join('');
  const managerCandidates = _allMembersList.filter(x =>
    x.id !== m.id && ['captain','chief_officer'].includes(x.role) && x.status === 'active'
  );
  const managerOpts = managerCandidates.map(x =>
    `<option value="${x.id}"${m.managed_by === x.id ? ' selected' : ''}>${escHtml(x.email)} (${ROLE_LABEL[x.role]})</option>`
  ).join('');
  return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border2);font-family:'DM Mono',monospace;font-size:12px;">${escHtml(m.email)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border2);">
        <select onchange="onMemberRoleChange('${m.id}',this)" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;font-size:12px;outline:none;">${roleOpts}</select>
        <div id="role-desc-${m.id}" style="font-size:11px;color:var(--muted);margin-top:3px;max-width:220px;">${ROLE_DESC[m.role] || ''}</div>
      </td>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border2);">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:${statusColor};">${m.status}</span>
      </td>
      <td style="padding:6px 8px;border-bottom:1px solid var(--border2);text-align:right;white-space:nowrap;">
        ${resendBtn}<button onclick="removeMember('${m.id}',this)" style="background:none;border:1px solid rgba(255,77,109,.3);color:var(--danger);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Remove</button>
      </td>
    </tr>
    <tr id="agent-link-row-${m.id}">
      <td colspan="4" style="padding:0 8px 8px 8px;border-bottom:1px solid var(--border2);">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--muted);">Agent Profile:</span>
          <select id="agent-link-sel-${m.id}" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;font-size:12px;outline:none;">
            <option value="">— Not linked —</option>
            ${rosterOpts}
          </select>
          <button onclick="saveMemberRosterAgent('${m.id}',this)" style="background:none;border:1px solid rgba(0,212,255,.3);color:var(--accent);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Save</button>
          <span id="agent-link-msg-${m.id}" style="font-size:11px;display:none;"></span>
        </div>
      </td>
    </tr>
    <tr id="manager-row-${m.id}" ${!managerCandidates.length ? 'style="display:none"' : ''}>
      <td colspan="4" style="padding:0 8px 8px 8px;border-bottom:1px solid var(--border2);">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:11px;color:var(--muted);">Reports to:</span>
          <select id="manager-sel-${m.id}" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;font-size:12px;outline:none;">
            <option value="">— No manager —</option>
            ${managerOpts}
          </select>
          <button onclick="saveMemberManager('${m.id}',this)" style="background:none;border:1px solid rgba(0,212,255,.3);color:var(--accent);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Save</button>
          <span id="manager-msg-${m.id}" style="font-size:11px;display:none;"></span>
        </div>
      </td>
    </tr>
    <tr id="custom-tabs-row-${m.id}" style="${m.role==='custom'?'':'display:none'}">
      <td colspan="4" style="padding:0 8px 10px 8px;border-bottom:1px solid var(--border2);">
        <div style="background:rgba(0,212,255,.04);border:1px solid rgba(0,212,255,.12);border-radius:6px;padding:.6rem .75rem;">
          <div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">ALLOWED TABS</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:.5rem;">${tabCbs}</div>
          <button class="btn btn-primary" style="padding:3px 12px;font-size:12px;" onclick="saveMemberCustomTabs('${m.id}')">Save Permissions</button>
          <span id="mb-perm-msg-${m.id}" style="font-size:12px;margin-left:8px;display:none;"></span>
        </div>
      </td>
    </tr>`;
}

function toggleCustomTabsUI() {
  const role = document.getElementById('ag-invite-role').value;
  document.getElementById('ag-custom-tabs-wrap').style.display = role === 'custom' ? '' : 'none';
  document.getElementById('ag-role-desc').textContent = ROLE_DESC[role] || '';
}

async function loadAgencyMembers() {
  const container = document.getElementById('agency-members-list');
  if (!container) return;
  container.innerHTML = '<div style="font-size:13px;color:var(--muted);">Loading…</div>';
  try {
    const res  = await fetch('/api/members', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { container.innerHTML = `<div style="color:var(--danger);font-size:13px;">${data.error}</div>`; return; }
    if (!data.length) { container.innerHTML = '<div style="font-size:13px;color:var(--muted);">No team members yet. Invite someone below.</div>'; return; }
    _allMembersList = data;
    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">
            <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);">Email</th>
            <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);">Role</th>
            <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);">Status</th>
            <th style="padding:5px 8px;border-bottom:1px solid var(--border);"></th>
          </tr>
        </thead>
        <tbody>${data.map(m => renderMemberRow(m)).join('')}</tbody>
      </table>`;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--danger);font-size:13px;">Error loading members: ${e.message}</div>`;
  }
}

async function saveMemberRosterAgent(memberId, btn) {
  const sel    = document.getElementById('agent-link-sel-' + memberId);
  const msgEl  = document.getElementById('agent-link-msg-' + memberId);
  const agentId = sel?.value || null;
  btn.disabled = true;
  try {
    const r = await fetch('/api/members', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, roster_agent_id: agentId }),
    });
    const d = await r.json();
    if (!r.ok) { msgEl.style.color='var(--danger)'; msgEl.textContent=d.error||'Error'; }
    else { msgEl.style.color='var(--accent2)'; msgEl.textContent='Saved'; }
  } catch(e) {
    msgEl.style.color='var(--danger)'; msgEl.textContent=e.message;
  } finally {
    btn.disabled = false;
    if (msgEl) { msgEl.style.display=''; setTimeout(() => { msgEl.style.display='none'; }, 3000); }
  }
}

async function saveMemberManager(memberId, btn) {
  const sel = document.getElementById('manager-sel-' + memberId);
  if (!sel) return;
  const managed_by = sel.value || null;
  btn.disabled = true;
  try {
    const r = await fetch('/api/members', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId, managed_by }),
    });
    const d = await r.json();
    const msg = document.getElementById('manager-msg-' + memberId);
    if (r.ok) {
      if (msg) { msg.textContent = 'Saved'; msg.style.color = 'var(--accent2)'; msg.style.display = ''; setTimeout(() => { msg.style.display = 'none'; }, 2000); }
      const m = _allMembersList.find(x => x.id === memberId);
      if (m) m.managed_by = managed_by;
    } else {
      if (msg) { msg.textContent = d.error || 'Failed'; msg.style.color = 'var(--danger)'; msg.style.display = ''; }
    }
  } catch(e) { console.error(e); }
  btn.disabled = false;
}

async function sendTeamInvite(btn) {
  const email = (document.getElementById('ag-invite-email').value || '').trim();
  const role  = document.getElementById('ag-invite-role').value;
  const msg   = document.getElementById('ag-invite-msg');

  if (!email) { msg.style.display='block'; msg.style.color='var(--danger)'; msg.textContent='Email is required.'; return; }

  let custom_tabs = null;
  if (role === 'custom') {
    custom_tabs = [...document.querySelectorAll('.ag-tab-cb:checked')].map(cb => cb.value);
    if (!custom_tabs.length) { msg.style.display='block'; msg.style.color='var(--danger)'; msg.textContent='Select at least one tab for Custom access.'; return; }
  }

  btn.disabled = true;
  msg.style.display = 'block'; msg.style.color = 'var(--muted)'; msg.textContent = 'Sending…';

  try {
    const res  = await fetch('/api/invite', {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, role, custom_tabs }),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.style.color = 'var(--danger)'; msg.textContent = data.error || 'Failed to send invite.';
    } else {
      msg.style.color = 'var(--accent2)';
      msg.textContent = data.emailWarning ? `Invite saved (email warning: ${data.emailWarning})` : `Invite sent to ${email}.`;
      document.getElementById('ag-invite-email').value = '';
      loadAgencyMembers();
    }
  } catch(e) {
    msg.style.color = 'var(--danger)'; msg.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function resendInvite(memberId, email, btn) {
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res  = await fetch('/api/invite?action=resend', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to resend invite.'); return; }
    btn.textContent = 'Sent!';
    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 3000);
  } catch(e) {
    alert('Error: ' + e.message);
    btn.disabled = false; btn.textContent = orig;
  }
}

async function removeMember(memberId, btn) {
  if (!confirm('Remove this team member? They will lose access immediately.')) return;
  btn.disabled = true;
  try {
    const res  = await fetch(`/api/members?memberId=${encodeURIComponent(memberId)}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to remove member.'); btn.disabled = false; return; }
    loadAgencyMembers();
  } catch(e) {
    alert('Error: ' + e.message); btn.disabled = false;
  }
}

function onMemberRoleChange(memberId, sel) {
  const row  = document.getElementById(`custom-tabs-row-${memberId}`);
  const desc = document.getElementById(`role-desc-${memberId}`);
  if (desc) desc.textContent = ROLE_DESC[sel.value] || '';
  if (sel.value === 'custom') {
    if (row) row.style.display = '';
  } else {
    if (row) row.style.display = 'none';
    updateMemberRole(memberId, sel.value, null);
  }
}

async function saveMemberCustomTabs(memberId) {
  const tabs = [...document.querySelectorAll(`.mb-tab-cb-${memberId}:checked`)].map(cb => cb.value);
  const msg  = document.getElementById(`mb-perm-msg-${memberId}`);
  if (!tabs.length) {
    if (msg) { msg.style.display='inline'; msg.style.color='var(--danger)'; msg.textContent='Select at least one tab.'; }
    return;
  }
  await updateMemberRole(memberId, 'custom', tabs);
  if (msg) { msg.style.display='inline'; msg.style.color='var(--accent2)'; msg.textContent='Saved.'; setTimeout(() => { msg.style.display='none'; }, 2500); }
}

async function updateMemberRole(memberId, role, custom_tabs = null) {
  const res  = await fetch('/api/members', {
    method:  'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body:    JSON.stringify({ memberId, role, custom_tabs }),
  });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Failed to update role.');
    loadAgencyMembers(); // re-render to restore old value
    return;
  }
  // Keep _allMembersList in sync so manager row re-evaluation is correct
  const m = _allMembersList.find(x => x.id === memberId);
  if (m) {
    m.role = role;
    if (custom_tabs !== null) m.custom_tabs = custom_tabs;
  }
  refreshManagerRows();
}

// Re-evaluate every manager-row in the DOM against the current _allMembersList roles.
// Called after any role change so candidates (captain/CO only) stay accurate.
function refreshManagerRows() {
  for (const m of _allMembersList) {
    const row = document.getElementById(`manager-row-${m.id}`);
    const sel = document.getElementById(`manager-sel-${m.id}`);
    if (!row || !sel) continue;
    const candidates = _allMembersList.filter(x =>
      x.id !== m.id && ['captain','chief_officer'].includes(x.role) && x.status === 'active'
    );
    row.style.display = candidates.length ? '' : 'none';
    const preserved = sel.value;
    sel.innerHTML = `<option value="">— No manager —</option>` +
      candidates.map(x =>
        `<option value="${x.id}"${m.managed_by === x.id ? ' selected' : ''}>${escHtml(x.email)} (${ROLE_LABEL[x.role]})</option>`
      ).join('');
    if (preserved && candidates.some(c => c.id === preserved)) sel.value = preserved;
  }
}

// ── STARTUP ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);

