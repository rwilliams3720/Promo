// ── Product Type CRUD ─────────────────────────────────────────────────────────
function renderProductTypeList() {
  const container = document.getElementById('product-types-list');
  if (!container) return;
  const pts = _productTypes.length ? _productTypes : DEFAULT_SCORING_CATS;
  if (!pts.length) { container.innerHTML = ''; return; }
  container.innerHTML = pts.map(p => {
    if (_editingPtKey === p.key) {
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
        <input id="pt-edit-label-${p.key}" type="text" value="${escHtml(p.label)}" style="flex:1;min-width:120px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 8px;font-size:13px;outline:none;">
        <button class="btn btn-primary" style="padding:2px 10px;font-size:11px;" onclick="ptSaveEdit('${p.key}')">Save</button>
        <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="ptCancelEdit()">Cancel</button>
      </div>`;
    }
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <span style="font-size:13px;flex:1;">${escHtml(p.label)}</span>
      <span style="font-size:10px;color:var(--muted);font-family:monospace;">${escHtml(p.key)}</span>
      <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="ptEdit('${p.key}')">Edit</button>
      <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="ptDelete('${p.key}')">✕</button>
    </div>`;
  }).join('');
  renderNewScCatOptions();
}

function ptEdit(key) { _editingPtKey = key; renderProductTypeList(); }
function ptCancelEdit() { _editingPtKey = null; renderProductTypeList(); }

async function ptSaveEdit(key) {
  const input = document.getElementById(`pt-edit-label-${key}`);
  if (!input) return;
  const label = input.value.trim();
  if (!label) return;
  const pts = _productTypes.length ? [..._productTypes] : [...DEFAULT_SCORING_CATS];
  const idx = pts.findIndex(p => p.key === key);
  if (idx >= 0) pts[idx] = { ...pts[idx], label };
  _productTypes = pts;
  _editingPtKey = null;
  renderProductTypeList();
  await _savePtToApi();
  refreshEntryDropdowns(true);
  showInlineMsg('pt-msg', 'Saved.', 'ok');
}

async function ptDelete(key) {
  const pts = (_productTypes.length ? _productTypes : DEFAULT_SCORING_CATS).filter(p => p.key !== key);
  _productTypes = pts;
  renderProductTypeList();
  renderSubcatList();
  await _savePtToApi();
  refreshEntryDropdowns(true);
}

async function addProductType() {
  const input = document.getElementById('new-pt-label');
  if (!input) return;
  const label = input.value.trim();
  if (!label) return;
  const pts = _productTypes.length ? [..._productTypes] : [...DEFAULT_SCORING_CATS];
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'custom';
  let key = base;
  let i = 2;
  while (pts.find(p => p.key === key)) { key = `${base}_${i}`; i++; }
  pts.push({ key, label });
  _productTypes = pts;
  input.value = '';
  renderProductTypeList();
  renderSubcatList();
  await _savePtToApi();
  refreshEntryDropdowns(true);
  showInlineMsg('pt-msg', 'Added.', 'ok');
}

async function _savePtToApi() {
  await fetch('/api/checklist-config', {
    method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ productTypes: _productTypes }),
  });
}

function refreshEntryDropdowns(refreshProducts = false) {
  if (refreshProducts) {
    document.querySelectorAll('.msr-product').forEach(sel => {
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Select —</option>' +
        activeCats().map(c => `<option value="${escHtml(c.key)}"${c.key === cur ? ' selected' : ''}>${escHtml(c.label)}</option>`).join('');
    });
    document.querySelectorAll('.clrow-product').forEach(sel => {
      const cur = sel.value;
      sel.innerHTML = activeCats().map(c => `<option value="${escHtml(c.key)}"${c.key === cur ? ' selected' : ''}>${escHtml(c.label)}</option>`).join('');
    });
  }
  document.querySelectorAll('.msr-product').forEach(sel => {
    const m = (sel.getAttribute('onchange') || '').match(/msrUpdateSubcat\(this,(\d+)\)/);
    if (m) msrUpdateSubcat(sel, parseInt(m[1]));
  });
  document.querySelectorAll('.clrow-product').forEach(sel => {
    const m = (sel.getAttribute('onchange') || '').match(/clUpdateSubcat\(this,(\d+)\)/);
    if (m) clUpdateSubcat(sel, parseInt(m[1]));
  });
}

function renderNewScCatOptions() {
  const sel = document.getElementById('new-sc-cat');
  if (sel) sel.innerHTML = activeCats().map(c => `<option value="${c.key}">${c.label}</option>`).join('');
}

function renderSubcatList() {
  renderNewScCatOptions();
  const container = document.getElementById('subcats-list');
  if (!container) return;
  if (!_salesSubcats.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--muted);margin-bottom:.75rem;">Subcategories will be seeded on first access of the checklist config.</div>';
    return;
  }
  const grouped = {};
  for (const s of _salesSubcats) {
    if (!grouped[s.scoring_category]) grouped[s.scoring_category] = [];
    grouped[s.scoring_category].push(s);
  }
  container.innerHTML = Object.entries(grouped).map(([cat, items]) => {
    const catLabel = labelForCat(cat);
    return `<div style="margin-bottom:1rem;">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">${escHtml(catLabel)}</div>
      ${items.map(s => {
        if (_editingSubcatId === s.id) {
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <input type="checkbox" ${s.active ? 'checked' : ''} onchange="subcatToggle('${s.id}',this.checked)">
            <input id="sc-edit-label-${s.id}" type="text" value="${escHtml(s.label)}" style="flex:1;min-width:120px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 8px;font-size:13px;outline:none;">
            <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;"><input type="checkbox" id="sc-edit-fin-${s.id}" ${s.is_financial_service ? 'checked' : ''}> Fin. Service</label>
            <button class="btn btn-primary" style="padding:2px 10px;font-size:11px;" onclick="subcatSaveEdit('${s.id}')">Save</button>
            <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="subcatCancelEdit()">Cancel</button>
          </div>`;
        }
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <input type="checkbox" ${s.active ? 'checked' : ''} onchange="subcatToggle('${s.id}',this.checked)">
          <span style="font-size:13px;flex:1;">${escHtml(s.label)}</span>
          ${s.is_financial_service ? '<span style="font-size:10px;color:var(--accent2);background:rgba(0,255,136,.08);padding:1px 6px;border-radius:4px;white-space:nowrap;">Fin. Service</span>' : ''}
          <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="subcatEdit('${s.id}')">Edit</button>
          <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="subcatDelete('${s.id}')">✕</button>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

async function subcatToggle(id, active) {
  const s = _salesSubcats.find(x => x.id === id);
  if (s) s.active = active;
  await fetch('/api/checklist-config', {
    method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ subcategoryUpdates: [{ action: 'toggle', id, active }] }),
  });
  refreshEntryDropdowns(false);
  showInlineMsg('sc-msg', 'Saved.', 'ok');
}

async function subcatDelete(id) {
  _salesSubcats = _salesSubcats.filter(x => x.id !== id);
  renderSubcatList();
  refreshEntryDropdowns(false);
  await fetch('/api/checklist-config', {
    method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ subcategoryUpdates: [{ action: 'delete', id }] }),
  });
}

function subcatEdit(id) {
  _editingSubcatId = id;
  renderSubcatList();
}

function subcatCancelEdit() {
  _editingSubcatId = null;
  renderSubcatList();
}

async function subcatSaveEdit(id) {
  const labelEl = document.getElementById(`sc-edit-label-${id}`);
  const finEl   = document.getElementById(`sc-edit-fin-${id}`);
  if (!labelEl) return;
  const label = labelEl.value.trim();
  if (!label) return;
  const is_financial_service = finEl.checked;
  const s = _salesSubcats.find(x => x.id === id);
  if (s) { s.label = label; s.is_financial_service = is_financial_service; }
  _editingSubcatId = null;
  renderSubcatList();
  refreshEntryDropdowns(false);
  await fetch('/api/checklist-config', {
    method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ subcategoryUpdates: [{ action: 'update', id, label, is_financial_service }] }),
  });
  showInlineMsg('sc-msg', 'Saved.', 'ok');
}

async function addSubcategory() {
  const cat   = document.getElementById('new-sc-cat').value;
  const label = document.getElementById('new-sc-label').value.trim();
  const isFin = document.getElementById('new-sc-fin').checked;
  if (!label) return;
  const r = await fetch('/api/checklist-config', {
    method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ subcategoryUpdates: [{ action: 'add', scoring_category: cat, label, is_financial_service: isFin }] }),
  });
  const d = await r.json();
  if (d.ok) {
    document.getElementById('new-sc-label').value = '';
    document.getElementById('new-sc-fin').checked = false;
    await loadAddonConfig();
    renderSubcatList();
    refreshEntryDropdowns(false);
    showInlineMsg('sc-msg', 'Added.', 'ok');
  }
}

function renderEtResourcesList() {
  const el = document.getElementById('et-resources-list');
  if (!el) return;
  if (!_etResourcesLinks.length) { el.innerHTML = '<div style="font-size:12px;color:var(--muted);margin-bottom:.25rem;">No links yet.</div>'; return; }
  el.innerHTML = _etResourcesLinks.map((lnk, i) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;margin-bottom:5px;">
      <input type="text" value="${escHtml(lnk.label)}" oninput="_etResourcesLinks[${i}].label=this.value" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;outline:none;">
      <input type="url"  value="${escHtml(lnk.url)}"   oninput="_etResourcesLinks[${i}].url=this.value"   style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;outline:none;">
      <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="etRemoveResourceLink(${i})">✕</button>
    </div>`
  ).join('');
}
function etAddResourceLink() {
  const label = document.getElementById('et-new-res-label').value.trim();
  const url   = document.getElementById('et-new-res-url').value.trim();
  if (!label && !url) return;
  _etResourcesLinks.push({ label, url });
  document.getElementById('et-new-res-label').value = '';
  document.getElementById('et-new-res-url').value   = '';
  renderEtResourcesList();
}
function etRemoveResourceLink(i) {
  _etResourcesLinks.splice(i, 1);
  renderEtResourcesList();
}

function renderEtResourcesListEs() {
  const el = document.getElementById('et-resources-list-es');
  if (!el) return;
  if (!_etResourcesLinksEs.length) { el.innerHTML = '<div style="font-size:12px;color:var(--muted);margin-bottom:.25rem;">(Default links will be used if empty)</div>'; return; }
  el.innerHTML = _etResourcesLinksEs.map((lnk, i) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:center;margin-bottom:5px;">
      <input type="text" value="${escHtml(lnk.label)}" oninput="_etResourcesLinksEs[${i}].label=this.value" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;outline:none;">
      <input type="url"  value="${escHtml(lnk.url)}"   oninput="_etResourcesLinksEs[${i}].url=this.value"   style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 8px;font-size:12px;outline:none;">
      <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="etRemoveResourceLinkEs(${i})">✕</button>
    </div>`
  ).join('');
}
function etAddResourceLinkEs() {
  const label = document.getElementById('et-new-res-label-es').value.trim();
  const url   = document.getElementById('et-new-res-url-es').value.trim();
  if (!label && !url) return;
  _etResourcesLinksEs.push({ label, url });
  document.getElementById('et-new-res-label-es').value = '';
  document.getElementById('et-new-res-url-es').value   = '';
  renderEtResourcesListEs();
}
function etRemoveResourceLinkEs(i) {
  _etResourcesLinksEs.splice(i, 1);
  renderEtResourcesListEs();
}

function etSetLang(lang) {
  document.getElementById('et-lang-fields-en').style.display = lang === 'en' ? '' : 'none';
  document.getElementById('et-lang-fields-es').style.display = lang === 'es' ? '' : 'none';
  const enBtn = document.getElementById('et-lang-btn-en');
  const esBtn = document.getElementById('et-lang-btn-es');
  if (enBtn) { enBtn.style.background = lang === 'en' ? 'var(--accent)' : 'transparent'; enBtn.style.color = lang === 'en' ? '#000' : 'var(--muted)'; }
  if (esBtn) { esBtn.style.background = lang === 'es' ? 'var(--accent2)' : 'transparent'; esBtn.style.color = lang === 'es' ? '#fff' : 'var(--muted)'; }
}

async function saveEmailTemplate(btn) {
  btn.disabled = true;
  try {
    const cfg = {
      subject:          document.getElementById('et-subject').value.trim(),
      agency_name:      document.getElementById('et-agency').value.trim(),
      brand_color:      document.getElementById('et-color').value,
      agent_name:       document.getElementById('et-agent-name').value.trim(),
      agent_phone:      document.getElementById('et-agent-phone').value.trim(),
      agent_email:      document.getElementById('et-agent-email').value.trim(),
      internal_email:   document.getElementById('et-internal-email').value.trim(),
      penalty_warning:  document.getElementById('et-penalty-warning').value.trim(),
      // English content
      greeting:         document.getElementById('et-greeting').value.trim(),
      footer:           document.getElementById('et-footer').value.trim(),
      body_para1:         document.getElementById('et-body-para1').value.trim(),
      body_para1_enabled: document.getElementById('et-body-para1-enabled').checked,
      body_para2:         document.getElementById('et-body-para2').value.trim(),
      body_para2_enabled: document.getElementById('et-body-para2-enabled').checked,
      important_enabled:  document.getElementById('et-important-enabled').checked,
      important_title:    document.getElementById('et-important-title').value.trim(),
      important_body:     document.getElementById('et-important-body').value.trim(),
      resources_enabled:  document.getElementById('et-resources-enabled').checked,
      resources_title:    document.getElementById('et-resources-title').value.trim(),
      resources_links:    _etResourcesLinks,
      thank_you:          document.getElementById('et-thank-you').value.trim(),
      thank_you_enabled:  document.getElementById('et-thank-you-enabled').checked,
      // Spanish content (empty string = use built-in default)
      greeting_es:          document.getElementById('et-greeting-es').value.trim(),
      footer_es:            document.getElementById('et-footer-es').value.trim(),
      body_para1_es:        document.getElementById('et-body-para1-es').value.trim(),
      body_para2_es:        document.getElementById('et-body-para2-es').value.trim(),
      important_title_es:   document.getElementById('et-important-title-es').value.trim(),
      important_body_es:    document.getElementById('et-important-body-es').value.trim(),
      resources_title_es:   document.getElementById('et-resources-title-es').value.trim(),
      resources_links_es:   _etResourcesLinksEs,
      thank_you_es:         document.getElementById('et-thank-you-es').value.trim(),
    };
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailConfig: cfg }),
    });
    const d = await r.json();
    if (d.ok) { _checklistEmailCfg = cfg; showInlineMsg('et-msg', 'Saved.', 'ok'); }
    else showInlineMsg('et-msg', d.error || 'Error', 'err');
  } catch(e) { showInlineMsg('et-msg', e.message, 'err'); }
  finally { btn.disabled = false; }
}

function previewEmailTemplate() {
  const cfg = {
    agencyName:       document.getElementById('et-agency').value.trim()     || 'Your Agency Name',
    brandColor:       document.getElementById('et-color').value             || '#D62311',
    agentName:        document.getElementById('et-agent-name').value.trim() || '',
    agentPhone:       document.getElementById('et-agent-phone').value.trim()|| '',
    agentEmail:       document.getElementById('et-agent-email').value.trim()|| '',
    greeting:         document.getElementById('et-greeting').value.trim()   || '',
    footer:           document.getElementById('et-footer').value.trim()     || '',
    subject:          document.getElementById('et-subject').value.trim()    || 'New Customer — Checklist Completed',
    bodyPara1:        document.getElementById('et-body-para1').value.trim(),
    bodyPara1Enabled: document.getElementById('et-body-para1-enabled').checked,
    bodyPara2:        document.getElementById('et-body-para2').value.trim(),
    bodyPara2Enabled: document.getElementById('et-body-para2-enabled').checked,
    importantEnabled: document.getElementById('et-important-enabled').checked,
    importantTitle:   document.getElementById('et-important-title').value.trim(),
    importantBody:    document.getElementById('et-important-body').value.trim(),
    resourcesEnabled: document.getElementById('et-resources-enabled').checked,
    resourcesTitle:   document.getElementById('et-resources-title').value.trim(),
    resourcesLinks:   _etResourcesLinks,
    thankYou:         document.getElementById('et-thank-you').value.trim(),
    thankYouEnabled:  document.getElementById('et-thank-you-enabled').checked,
  };
  const firstLoc = (_salesLocations || []).find(l => l.active !== false);
  const previewFormCompletions = { wfolder: { applied: true } };
  (_checklistFormCfg || []).forEach(item => {
    previewFormCompletions[item.form_key] = { applied: item.active !== false };
  });
  const dummyPayload = {
    ...cfg,
    customerName: 'Jo Smith',
    subDate: new Date().toISOString().slice(0,10),
    apptDate: new Date(Date.now() + 86400000).toISOString().slice(0,10),
    apptTime: '10:00',
    meetingType: firstLoc ? 'In Person' : 'Virtual',
    apptLocation: firstLoc ? firstLoc.name : null,
    location: firstLoc ? firstLoc.name : null,
    formCompletions: previewFormCompletions,
    sales: [],
  };
  const { bodyHtml } = buildCustomerEmailHtml(dummyPayload);

  document.getElementById('et-preview-subject').textContent = cfg.subject;
  const preEl = document.getElementById('et-preview-body');
  preEl.innerHTML = bodyHtml;
  preEl.style.background = '#f4f8fc';
  preEl.style.padding = '0';
  preEl.style.whiteSpace = 'normal';
  document.getElementById('et-preview-modal').style.display = 'flex';
}

// ── Checklist link management ─────────────────────────────────────────────────
function copyChecklistLink() {
  const val = document.getElementById('ac-checklist-link').value;
  if (!val) return;
  navigator.clipboard.writeText(val).then(() => showInlineMsg('ac-link-msg', 'Copied!', 'ok'));
}

async function regenerateChecklistLink(btn) {
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm Regenerate?';
    setTimeout(() => { btn.dataset.confirming = ''; btn.textContent = 'Regenerate'; }, 5000);
    return;
  }
  btn.disabled = true; btn.textContent = 'Regenerating…';
  try {
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'regenerate_token' }),
    });
    const d = await r.json();
    if (d.ok) {
      _checklistToken = d.checklistToken;
      const host = window.location.origin;
      document.getElementById('ac-checklist-link').value = `${host}/app?checklist=${d.checklistToken}`;
      showInlineMsg('ac-link-msg', 'Link regenerated. Old link no longer works.', 'ok');
    }
  } finally { btn.disabled = false; btn.dataset.confirming = ''; btn.textContent = 'Regenerate'; }
}

// ── Entry mode toggle ─────────────────────────────────────────────────────────
async function confirmSalesEntryMode(newMode) {
  if (newMode === _salesEntryMode) return;
  const label = newMode === 'manual' ? 'Manual / Checklist' : 'Upload (File)';
  const warn  = newMode === 'manual'
    ? 'Switching to Manual mode will delete this month\'s uploaded sales data. Archived months are unaffected. Continue?'
    : 'Switching to Upload mode will delete this month\'s manually entered sales data. Archived months are unaffected. Continue?';
  if (!confirm(warn)) return;
  const r = await fetch('/api/checklist-config', {
    method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ salesEntryMode: newMode, clearCurrentSales: true }),
  });
  const d = await r.json();
  if (d.ok) {
    _salesEntryMode = newMode;
    renderManageTabMode();
    const msg = document.getElementById('ac-mode-msg');
    if (msg) showInlineMsg('ac-mode-msg', `Switched to ${label} mode.`, 'ok');
    document.getElementById('mode-btn-upload').style.background = newMode === 'upload' ? 'var(--accent)' : '';
    document.getElementById('mode-btn-upload').style.color      = newMode === 'upload' ? '#000' : '';
    document.getElementById('mode-btn-manual').style.background = newMode === 'manual' ? 'var(--accent2)' : '';
    document.getElementById('mode-btn-manual').style.color      = newMode === 'manual' ? '#fff' : '';
  }
}

function renderManageTabMode() {
  const banner      = document.getElementById('manage-mode-banner');
  const uploadPanelS= document.getElementById('upload-panel-sales');
  const manualPanel = document.getElementById('manual-entry-panel');
  const actLogPanel = document.getElementById('manage-activity-log-panel');
  if (!banner) return;
  if (_hasSalesAddon || _isAdmin) {
    banner.style.display = 'flex';
    const lbl = document.getElementById('manage-mode-label');
    if (lbl) lbl.textContent = _salesEntryMode === 'manual' ? 'Manual / Checklist' : 'Upload (File)';
    if (uploadPanelS) uploadPanelS.style.display = _salesEntryMode === 'upload' ? '' : 'none';
    if (manualPanel)  manualPanel.style.display  = _salesEntryMode === 'manual' ? '' : 'none';
    if (_salesEntryMode === 'manual' && manualPanel && !manualPanel.querySelector('.manual-sale-row')) {
      manualAddRow();
    }
  } else {
    banner.style.display = 'none';
    if (manualPanel)  manualPanel.style.display  = 'none';
    if (uploadPanelS) uploadPanelS.style.display = '';
  }
  // Show activity log panel for users with commissions add-on or admin
  if (actLogPanel) actLogPanel.style.display = (_hasCommissionsAddon || _isAdmin) ? '' : 'none';

  // Self-report panels for members
  const srPanel = document.getElementById('manage-self-report');
  const srAct   = document.getElementById('manage-sr-activities');
  const srSales = document.getElementById('manage-sr-sales');
  const pendingPanel = document.getElementById('manage-pending-approvals');
  const isCapOrCO = ['captain', 'chief_officer'].includes(_memberRole);
  const cfg = _selfReportConfig || {};

  if (_isMember) {
    // Show the self-report panel container
    if (srPanel) srPanel.style.display = '';
    // Hide the upload panel for non-captain/CO members (they can't upload)
    const uploadDiv = document.getElementById('manage-sub-upload');
    if (uploadDiv && !isCapOrCO) uploadDiv.style.display = 'none';

    // Member self-report forms (only for non-approvers)
    if (!isCapOrCO) {
      if (srAct)   srAct.style.display   = cfg.activities_enabled ? '' : 'none';
      if (srSales) srSales.style.display = cfg.sales_enabled      ? '' : 'none';
      // Populate month/year pickers on first render
      _initSrMonthYearPickers();
      if (cfg.activities_enabled) _populateSrActivityTypes();
      if (cfg.sales_enabled && !document.getElementById('sr-sales-rows').children.length) srSalesAddRow();
    } else {
      if (srAct)   srAct.style.display   = 'none';
      if (srSales) srSales.style.display = 'none';
    }

    // Pending approvals for captains/chief_officers when approval is required
    if (isCapOrCO && cfg.requires_approval && (cfg.activities_enabled || cfg.sales_enabled)) {
      if (pendingPanel) { pendingPanel.style.display = ''; loadPendingApprovals(); }
    } else {
      if (pendingPanel) pendingPanel.style.display = 'none';
    }
  } else {
    if (srPanel)      srPanel.style.display      = 'none';
    if (pendingPanel) pendingPanel.style.display = 'none';
  }
}

// ── Load add-on config ────────────────────────────────────────────────────────
async function loadAddonConfig() {
  const r = await fetch('/api/checklist-config', { headers: authHeaders() });
  if (!r.ok) return;
  const d = await r.json();
  _hasSalesAddon        = d.hasSalesAddon;
  _hasCommissionsAddon  = d.hasCommissionsAddon || false;
  _commissionStructures = d.commissionStructures || [];
  _salesEntryMode   = d.salesEntryMode || 'upload';
  _checklistToken   = d.checklistToken;
  _checklistEmailCfg= d.emailConfig;
  _checklistFormCfg = d.formConfig    || [];
  _salesSubcats       = d.subcategories    || [];
  _agentRoster        = d.agents           || [];
  _salesLocations     = d.locations        || [];
  _productTypes       = d.productTypes     || [];
  _leadSources        = d.leadSources      || [];
  _selfReportConfig   = d.selfReportConfig || {};
  // Load activity types if commissions add-on is active, admin, or self-reporting of activities is enabled
  // Must be awaited so _activityTypes is populated before renderManageTabMode calls _populateSrActivityTypes
  if (_hasCommissionsAddon || _isAdmin || _selfReportConfig.activities_enabled) {
    try {
      const tr = await fetch('/api/bonus-activities?resource=types', { headers: authHeaders() });
      _activityTypes = tr.ok ? (await tr.json()) : [];
      if (!Array.isArray(_activityTypes)) _activityTypes = [];
    } catch(_) { _activityTypes = []; }
  }
}

// ── Purchase add-on ───────────────────────────────────────────────────────────
async function purchaseSalesAddon(btn) {
  btn.disabled = true; btn.textContent = 'Redirecting…';
  try {
    const r = await fetch('/api/addon-checkout', { method: 'POST', headers: authHeaders() });
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else { showInlineMsg('addon-upsell-msg', d.error || 'Error', 'err'); btn.disabled = false; btn.textContent = 'Add to Plan'; }
  } catch(e) { showInlineMsg('addon-upsell-msg', e.message, 'err'); btn.disabled = false; btn.textContent = 'Add to Plan'; }
}

async function cancelSalesAddon(btn) {
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm Remove — click again to cancel';
    setTimeout(() => {
      if (btn.dataset.confirming === 'yes') {
        btn.dataset.confirming = '';
        btn.textContent = 'Remove Add-On';
      }
    }, 5000);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Removing…';
  try {
    const r = await fetch('/api/addon-checkout', { method: 'DELETE', headers: authHeaders() });
    const d = await r.json();
    if (!r.ok) {
      showInlineMsg('addon-cancel-msg', d.error || 'Error removing add-on', 'err');
      btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = '';
      return;
    }
    _hasSalesAddon = false;
    await loadAccountTab();
    showAccountSubTab('billing', document.querySelector('[data-pane=billing]'));
    renderManageTabMode();
  } catch(e) {
    showInlineMsg('addon-cancel-msg', e.message, 'err');
    btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = '';
  }
}

// ── Commissions add-on ────────────────────────────────────────────────────────
function renderCommissionsAddonSection(acct) {
  const hasAddon = acct.has_commissions_addon || _hasCommissionsAddon || _isAdmin;
  document.getElementById('commissions-addon-upsell').style.display = hasAddon ? 'none' : '';
  document.getElementById('commissions-addon-active').style.display = hasAddon ? ''     : 'none';
}

async function purchaseCommissionsAddon(btn) {
  btn.disabled = true; btn.textContent = 'Redirecting…';
  try {
    const r = await fetch('/api/commissions-checkout', { method: 'POST', headers: authHeaders() });
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else { showInlineMsg('commissions-addon-upsell-msg', d.error || 'Error', 'err'); btn.disabled = false; btn.textContent = 'Add to Plan'; }
  } catch(e) { showInlineMsg('commissions-addon-upsell-msg', e.message, 'err'); btn.disabled = false; btn.textContent = 'Add to Plan'; }
}

async function cancelCommissionsAddon(btn) {
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm Remove — click again to cancel';
    setTimeout(() => {
      if (btn.dataset.confirming === 'yes') { btn.dataset.confirming = ''; btn.textContent = 'Remove Add-On'; }
    }, 5000);
    return;
  }
  btn.disabled = true; btn.textContent = 'Removing…';
  try {
    const r = await fetch('/api/commissions-checkout', { method: 'DELETE', headers: authHeaders() });
    const d = await r.json();
    if (!r.ok) {
      showInlineMsg('commissions-addon-cancel-msg', d.error || 'Error removing add-on', 'err');
      btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = '';
      return;
    }
    _hasCommissionsAddon = false;
    await loadAccountTab();
    showAccountSubTab('billing', document.querySelector('[data-pane=billing]'));
  } catch(e) {
    showInlineMsg('commissions-addon-cancel-msg', e.message, 'err');
    btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = '';
  }
}

// ── Lead Analysis add-on ──────────────────────────────────────────────────────
function renderLeadAnalysisAddonSection(acct) {
  const hasAddon = !!(acct.has_lead_analysis_addon) || _isAdmin;
  document.getElementById('lead-analysis-addon-upsell').style.display = hasAddon ? 'none' : '';
  document.getElementById('lead-analysis-addon-active').style.display = hasAddon ? ''     : 'none';
}

async function purchaseLeadAnalysisAddon(btn) {
  btn.disabled = true; btn.textContent = 'Redirecting…';
  try {
    const r = await fetch('/api/lead-analysis-checkout', { method: 'POST', headers: authHeaders() });
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else { showInlineMsg('lead-analysis-addon-upsell-msg', d.error || 'Error', 'err'); btn.disabled = false; btn.textContent = 'Add to Plan'; }
  } catch(e) { showInlineMsg('lead-analysis-addon-upsell-msg', e.message, 'err'); btn.disabled = false; btn.textContent = 'Add to Plan'; }
}

async function cancelLeadAnalysisAddon(btn) {
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm Remove — click again to cancel';
    setTimeout(() => {
      if (btn.dataset.confirming === 'yes') { btn.dataset.confirming = ''; btn.textContent = 'Remove Add-On'; }
    }, 5000);
    return;
  }
  btn.disabled = true; btn.textContent = 'Removing…';
  try {
    const r = await fetch('/api/lead-analysis-checkout', { method: 'DELETE', headers: authHeaders() });
    const d = await r.json();
    if (!r.ok) {
      showInlineMsg('lead-analysis-addon-cancel-msg', d.error || 'Error removing add-on', 'err');
      btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = '';
      return;
    }
    _hasLeadAnalysisAddon = false;
    await loadAccountTab();
    showAccountSubTab('billing', document.querySelector('[data-pane=billing]'));
  } catch(e) {
    showInlineMsg('lead-analysis-addon-cancel-msg', e.message, 'err');
    btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = '';
  }
}

