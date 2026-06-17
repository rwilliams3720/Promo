// ── DIRECTIVE 2: SALES TRACKING ADD-ON ───────────────────────────────────────

const ET_DEFAULT_BODY_PARA1    = "We’re excited to have you as part of our State Farm family. Our team is here to support you every step of the way with your insurance needs and provide you with helpful resources.";
const ET_DEFAULT_BODY_PARA2    = "You should have a copy of your ID cards in your inbox and in your online portal.";
const ET_DEFAULT_IMPORTANT_TITLE = "Important";
const ET_DEFAULT_IMPORTANT_BODY  = "If you have monthly payments, please be sure to sign and return your email payment authorization form as soon as possible. This will ensure your payments are processed smoothly and on time.";
const ET_DEFAULT_RESOURCES_TITLE = "Helpful Online Resources:";
const ET_DEFAULT_RESOURCES_LINKS = [
  { label: "Manage your policy: statefarm.com",  url: "https://www.statefarm.com"         },
  { label: "File a claim: statefarm.com/claims", url: "https://www.statefarm.com/claims"  },
  { label: "Pay your bill: statefarm.com/billing",url: "https://www.statefarm.com/billing"},
];
const ET_DEFAULT_THANK_YOU = "Thank you again for trusting [AgencyName]. We look forward to serving you!";

const ET_DEFAULT_BODY_PARA1_ES   = "Estamos muy contentos de que sea parte de nuestra familia de State Farm. Nuestro equipo está aquí para apoyarle en cada paso con sus necesidades de seguro y brindarle recursos útiles.";
const ET_DEFAULT_BODY_PARA2_ES   = "Debe tener una copia de sus tarjetas de identificación en su bandeja de entrada y en su portal en línea.";
const ET_DEFAULT_IMPORTANT_TITLE_ES = "Importante";
const ET_DEFAULT_IMPORTANT_BODY_ES  = "Si tiene pagos mensuales, asegúrese de firmar y devolver su formulario de autorización de pago por correo electrónico lo antes posible. Esto garantizará que sus pagos se procesen sin problemas y a tiempo.";
const ET_DEFAULT_RESOURCES_TITLE_ES = "Recursos en línea útiles:";
const ET_DEFAULT_RESOURCES_LINKS_ES = [
  { label: "Administre su póliza: statefarm.com",   url: "https://www.statefarm.com"         },
  { label: "Presente un reclamo: statefarm.com/claims", url: "https://www.statefarm.com/claims"  },
  { label: "Pague su factura: statefarm.com/billing",   url: "https://www.statefarm.com/billing"},
];
const ET_DEFAULT_THANK_YOU_ES = "Gracias nuevamente por confiar en [AgencyName]. ¡Esperamos poder servirle!";

let _etResourcesLinks   = [];   // in-editor state for resources links (English)
let _etResourcesLinksEs = [];   // in-editor state for resources links (Spanish)

const LEAD_SOURCES = [
  'Aged Lead Store','Agent Tagged Media','Call In','Contractors List',
  'Current Customer','Customer Letter','Direct Mail','Events',
  'Facebook','Google','Home Office Campaign','iLead',
  'Mortgage Broker','Other','Pivot','Realtor',
  'School','Self Generate','Statefarm.com','State2State',
  'Walk-In','Win-Back',
];

// Returns user-configured lead sources, falling back to the hardcoded default list
function getLeadSources() {
  return _leadSources.length ? _leadSources : LEAD_SOURCES;
}

// Render the lead sources list in the Products sub-pane
function renderLeadSourcesList() {
  const container = document.getElementById('lead-sources-list');
  if (!container) return;
  const sources = _leadSources.length ? _leadSources : [...LEAD_SOURCES];
  if (!sources.length) {
    container.innerHTML = '<span style="font-size:13px;color:var(--muted);">No custom lead sources — using defaults.</span>';
    return;
  }
  container.innerHTML = sources.map((s, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border2);" id="ls-row-${i}">
      <span style="flex:1;font-size:13px;">${escHtml(s)}</span>
      <button onclick="removeLeadSource(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;line-height:1;padding:0 4px;" title="Remove">✕</button>
    </div>`).join('');
}

function addLeadSource() {
  const inp = document.getElementById('new-lead-source');
  const val = inp?.value.trim();
  if (!val) return;
  const sources = _leadSources.length ? _leadSources : [...LEAD_SOURCES];
  if (!sources.includes(val)) sources.push(val);
  _leadSources = sources;
  inp.value = '';
  renderLeadSourcesList();
}

function removeLeadSource(idx) {
  const sources = _leadSources.length ? _leadSources : [...LEAD_SOURCES];
  sources.splice(idx, 1);
  _leadSources = sources;
  renderLeadSourcesList();
}

async function saveLeadSources(btn) {
  btn.disabled = true; btn.textContent = 'Saving…';
  const msg = document.getElementById('lead-sources-msg');
  try {
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadSources: _leadSources }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to save');
    showInlineMsg('lead-sources-msg', 'Saved.', 'ok');
  } catch(e) { showInlineMsg('lead-sources-msg', e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Save Lead Sources'; }
}

const DEFAULT_SCORING_CATS = [
  { key: 'auto',    label: 'Auto'             },
  { key: 'fire',    label: 'Fire'             },
  { key: 'health',  label: 'Health'           },
  { key: 'wl',      label: 'Whole Life (WL)'  },
  { key: 'ul',      label: 'Univ. Life (UL)'  },
  { key: 'term',    label: 'Term'             },
  { key: 'deposit', label: 'Deposit/Bank'     },
  { key: 'other',   label: 'Other'            },
];
// Returns user-configured active product types, falling back to defaults
function activeCats() {
  const src = _productTypes.length ? _productTypes : DEFAULT_SCORING_CATS;
  return src.filter(c => c.active !== false);
}
// Finds the display label for a given product key (searches user config then defaults)
function labelForCat(key) {
  if (!key) return '—';
  const all = _productTypes.length ? _productTypes : DEFAULT_SCORING_CATS;
  return (all.find(c => c.key === key) || DEFAULT_SCORING_CATS.find(c => c.key === key))?.label || key;
}

// ── Account tab: sales add-on section rendering ───────────────────────────────
function renderSalesAddonSection(acct) {
  const hasSub  = acct.has_sales_addon || _hasSalesAddon || _isAdmin;
  const hasMa   = acct.has_member_analysis || _hasMemberAnalysis || _isAdmin;
  const isPro   = ['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus);
  const showContent = hasSub || hasMa || isPro;

  // Billing pane: upsell vs active card
  document.getElementById('sales-addon-upsell').style.display  = hasSub ? 'none' : '';
  document.getElementById('sales-addon-active').style.display  = hasSub ? ''     : 'none';

  // Sales pane: locked vs content
  document.getElementById('sales-pane-locked').style.display  = showContent ? 'none' : '';
  document.getElementById('sales-pane-content').style.display = showContent ? ''     : 'none';

  // Member analysis agent section
  document.getElementById('ma-agents-section').style.display = hasMa ? '' : 'none';
  if (hasMa) renderMemberAnalysisAgentPicker();

  // Hours section: sales add-on only; teaser for pro/member-analysis users who don't have it
  document.getElementById('ma-hours-section').style.display = hasSub ? '' : 'none';
  document.getElementById('ma-hours-teaser').style.display  = (!hasSub && showContent) ? '' : 'none';
  if (hasSub) renderMaHoursPeriods();

  if (!hasSub) return;

  renderAgentRoster();
  renderLocationsList();

  // Link
  const host  = window.location.origin;
  const token = acct.checklist_token || _checklistToken;
  const link  = token ? `${host}/app?checklist=${token}` : '';
  document.getElementById('ac-checklist-link').value = link;

  // Mode buttons
  const mode = acct.sales_entry_mode || _salesEntryMode;
  document.getElementById('mode-btn-upload').style.background = mode === 'upload' ? 'var(--accent)' : '';
  document.getElementById('mode-btn-upload').style.color      = mode === 'upload' ? '#000' : '';
  document.getElementById('mode-btn-manual').style.background = mode === 'manual' ? 'var(--accent2)' : '';
  document.getElementById('mode-btn-manual').style.color      = mode === 'manual' ? '#fff' : '';

  // Email template
  const cfg = acct.checklist_email_config || _checklistEmailCfg || {};
  document.getElementById('et-subject').value          = cfg.subject         || '';
  document.getElementById('et-agency').value           = cfg.agency_name     || acct.company_name || '';
  document.getElementById('et-color').value            = cfg.brand_color     || '#00d4ff';
  document.getElementById('et-agent-name').value       = cfg.agent_name      || '';
  document.getElementById('et-agent-phone').value      = cfg.agent_phone     || '';
  document.getElementById('et-agent-email').value      = cfg.agent_email     || '';
  document.getElementById('et-internal-email').value   = cfg.internal_email  || '';
  document.getElementById('et-penalty-warning').value  = cfg.penalty_warning || '';
  // English content fields — seed defaults if not yet saved
  document.getElementById('et-greeting').value             = cfg.greeting           || '';
  document.getElementById('et-footer').value               = cfg.footer             || '';
  document.getElementById('et-body-para1').value           = cfg.body_para1         ?? ET_DEFAULT_BODY_PARA1;
  document.getElementById('et-body-para1-enabled').checked = cfg.body_para1_enabled  ?? true;
  document.getElementById('et-body-para2').value           = cfg.body_para2         ?? ET_DEFAULT_BODY_PARA2;
  document.getElementById('et-body-para2-enabled').checked = cfg.body_para2_enabled  ?? true;
  document.getElementById('et-important-enabled').checked  = cfg.important_enabled   ?? true;
  document.getElementById('et-important-title').value      = cfg.important_title    ?? ET_DEFAULT_IMPORTANT_TITLE;
  document.getElementById('et-important-body').value       = cfg.important_body     ?? ET_DEFAULT_IMPORTANT_BODY;
  document.getElementById('et-resources-enabled').checked  = cfg.resources_enabled   ?? true;
  document.getElementById('et-resources-title').value      = cfg.resources_title    ?? ET_DEFAULT_RESOURCES_TITLE;
  _etResourcesLinks = cfg.resources_links ? JSON.parse(JSON.stringify(cfg.resources_links)) : JSON.parse(JSON.stringify(ET_DEFAULT_RESOURCES_LINKS));
  renderEtResourcesList();
  document.getElementById('et-thank-you').value           = cfg.thank_you           ?? ET_DEFAULT_THANK_YOU;
  document.getElementById('et-thank-you-enabled').checked = cfg.thank_you_enabled    ?? true;
  // Spanish content fields — empty means "use default"
  document.getElementById('et-greeting-es').value         = cfg.greeting_es         || '';
  document.getElementById('et-footer-es').value           = cfg.footer_es           || '';
  document.getElementById('et-body-para1-es').value       = cfg.body_para1_es       || '';
  document.getElementById('et-body-para2-es').value       = cfg.body_para2_es       || '';
  document.getElementById('et-important-title-es').value  = cfg.important_title_es  || '';
  document.getElementById('et-important-body-es').value   = cfg.important_body_es   || '';
  document.getElementById('et-resources-title-es').value  = cfg.resources_title_es  || '';
  _etResourcesLinksEs = cfg.resources_links_es ? JSON.parse(JSON.stringify(cfg.resources_links_es)) : [];
  renderEtResourcesListEs();
  document.getElementById('et-thank-you-es').value        = cfg.thank_you_es        || '';
  etSetLang('en');
  // Form items + required fields
  renderFormItemsConfig();

  // Product types & Subcategories
  renderProductTypeList();
  renderSubcatList();

  // Lead sources
  renderLeadSourcesList();
}

function renderAgentRoster() {
  const container = document.getElementById('agent-roster-list');
  if (!container) return;
  if (!_agentRoster.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--muted);margin-bottom:.5rem;">No agents yet — add one below or upload a sales/call file.</div>';
    return;
  }
  const showStructure = _hasCommissionsAddon || _isAdmin;
  container.innerHTML = _agentRoster.map(a => {
    const safeId = escHtml(a.agent_id);
    const structSection = showStructure ? (() => {
      const assignedIds = a.commission_structure_ids || (a.commission_structure_id ? [a.commission_structure_id] : []);
      const assignedRows = assignedIds.map(sid => {
        const s = _commissionStructures.find(x => x.id === sid);
        if (!s) return '';
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <span style="font-size:12px;flex:1;">${escHtml(s.name)}</span>
          <button onclick="removeAgentStructure('${safeId}','${escHtml(sid)}',this)" style="background:none;border:1px solid var(--border2);color:var(--danger);border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer;">&#x2715;</button>
        </div>`;
      }).join('');
      const availableToAdd = _commissionStructures.filter(s => !assignedIds.includes(s.id));
      const addDropdown = availableToAdd.length
        ? `<div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
             <select id="add-struct-${safeId}" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:11px;outline:none;flex:1;">
               <option value="">+ Add structure...</option>
               ${availableToAdd.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('')}
             </select>
             <button onclick="addAgentStructure('${safeId}',this)" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 9px;font-size:11px;cursor:pointer;">Add</button>
           </div>` : '';
      const qualLabel = assignedIds.length > 1
        ? `<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px;margin-top:5px;cursor:pointer;">
             <input type="checkbox" id="qual-${safeId}" ${a.commission_all_must_qualify ? 'checked' : ''} onchange="saveAgentQualifier('${escHtml(a.id)}',this.checked)">
             All structures must qualify for any payout
           </label>` : '';
      const capTotalHtml = `<div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:10px;color:var(--muted);white-space:nowrap;">Max Total Commission $</span>
        <input id="cap-total-${safeId}" type="number" min="0" step="1" placeholder="No cap" value="${a.commission_cap_total != null ? a.commission_cap_total : ''}"
               style="width:110px;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:11px;outline:none;">
        <button onclick="saveCommissionCapTotal('${safeId}',document.getElementById('cap-total-${safeId}'),this)" style="background:none;border:1px solid rgba(0,212,255,.3);color:var(--accent);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">Save</button>
        <span style="font-size:10px;color:var(--muted);">per month total</span>
      </div>`;
      return `<div style="margin-top:6px;padding:6px 8px;background:var(--deep);border-radius:6px;border:1px solid var(--border2);">
        <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Commission Structures</div>
        ${assignedRows || '<div style="font-size:11px;color:var(--muted);">None assigned</div>'}
        ${addDropdown}
        ${qualLabel}
        ${capTotalHtml}
      </div>`;
    })() : '';
    return `<div style="margin-bottom:.5rem;padding:.5rem;background:var(--card2);border:1px solid var(--border2);border-radius:8px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;">
          <input type="checkbox" ${a.active !== false ? 'checked' : ''} onchange="toggleAgentRoster('${escHtml(a.id)}', this.checked)">
          <span style="font-size:11px;color:var(--muted);white-space:nowrap;">Active</span>
        </label>
        <span id="rn-label-${safeId}" style="font-size:13px;font-weight:600;flex:1;">${escHtml(a.name)}</span>
        <button onclick="startEditRosterName('${escHtml(a.id)}','${safeId}')" style="background:none;border:none;color:var(--muted);padding:0 2px;cursor:pointer;font-size:14px;line-height:1;" title="Rename">&#x270E;</button>
        <span style="font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;">${escHtml(a.agent_id)}</span>
        <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="deleteAgentRoster('${escHtml(a.id)}', this)">&#x2715;</button>
      </div>
      ${structSection}
      ${renderAgentRosterGoalsSection(a)}
    </div>`;
  }).join('');
}

// Refreshes all live agent dropdowns in open manual-entry and checklist rows
function refreshAgentDropdowns() {
  const activeRoster = _agentRoster.filter(a => a.active !== false);
  const agentOpts = '<option value="">— Select —</option>' +
    activeRoster.map(a => `<option value="${escHtml(a.agent_id)}">${escHtml(a.name)}</option>`).join('');
  const tmOpts = '<option value="">— optional —</option>' +
    activeRoster.map(a => `<option value="${escHtml(a.agent_id)}">${escHtml(a.name)}</option>`).join('');
  document.querySelectorAll('#manual-sales-rows .msr-agent').forEach(sel => {
    const cur = sel.value; sel.innerHTML = agentOpts; sel.value = cur;
  });
  document.querySelectorAll('#manual-sales-rows .msr-teammate-sel').forEach(sel => {
    const cur = sel.value; sel.innerHTML = tmOpts; sel.value = cur;
  });
  document.querySelectorAll('#cl-sales-rows .clrow-teammate-sel').forEach(sel => {
    const cur = sel.value; sel.innerHTML = tmOpts; sel.value = cur;
  });
  // Refresh member-analysis picker if the section is visible
  const maContainer = document.getElementById('ma-agent-picker');
  if (maContainer && maContainer.offsetParent !== null) renderMemberAnalysisAgentPicker();
}

function startEditRosterName(id, agentId) {
  const label = document.getElementById('rn-label-' + agentId);
  if (!label) return;
  const currentName = label.textContent;
  const pencil = label.nextElementSibling; // the ✎ button
  label.style.display = 'none';
  if (pencil) pencil.style.display = 'none';
  const wrap = document.createElement('span');
  wrap.id = 'rn-edit-' + agentId;
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1;min-width:0;';
  wrap.innerHTML = `<input id="rn-input-${agentId}" value="${currentName.replace(/"/g,'&quot;')}" style="font-size:13px;font-weight:600;flex:1;min-width:60px;background:var(--card);border:1px solid var(--accent);color:var(--text);border-radius:5px;padding:2px 6px;outline:none;"><button onclick="saveRosterName('${id}','${agentId}',this)" style="background:none;border:1px solid rgba(0,212,255,.3);color:var(--accent);border-radius:5px;padding:2px 9px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;">Save</button><button onclick="cancelEditRosterName('${agentId}')" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;">✕</button><span id="rn-msg-${agentId}" style="font-size:11px;display:none;"></span>`;
  label.parentNode.insertBefore(wrap, label.nextSibling?.nextSibling || null);
  const inp = document.getElementById('rn-input-' + agentId);
  if (inp) { inp.focus(); inp.select(); inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveRosterName(id, agentId, inp); if (e.key === 'Escape') cancelEditRosterName(agentId); }); }
}

async function saveRosterName(id, agentId, triggerEl) {
  const input = document.getElementById('rn-input-' + agentId);
  const msg   = document.getElementById('rn-msg-' + agentId);
  const newName = (input?.value || '').trim();
  if (!newName) return;
  const saveBtn = input?.parentNode?.querySelector('button');
  if (saveBtn) saveBtn.disabled = true;
  const r = await fetch('/api/agent-roster', {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, agent_id: agentId, name: newName }),
  });
  if (r.ok) {
    const a = _agentRoster.find(x => x.id === id);
    if (a) a.name = newName;
    // Also update race_data so race tab reflects the new name immediately
    const rd = _raceData.find(r => r.agent_id === agentId);
    if (rd) { rd.name = newName; renderRace(_raceData); }
    renderAgentRoster();
    refreshAgentDropdowns();
  } else {
    const d = await r.json().catch(() => ({}));
    if (saveBtn) saveBtn.disabled = false;
    if (msg) { msg.style.display = 'inline'; msg.style.color = 'var(--danger)'; msg.textContent = d.error || 'Save failed'; }
  }
}

function cancelEditRosterName(agentId) {
  const label  = document.getElementById('rn-label-' + agentId);
  const pencil = label?.nextElementSibling;
  const wrap   = document.getElementById('rn-edit-' + agentId);
  if (label)  label.style.display = '';
  if (pencil && pencil.tagName === 'BUTTON') pencil.style.display = '';
  if (wrap)   wrap.remove();
}

async function addAgentStructure(agentId, btn) {
  const sel = document.getElementById('add-struct-' + agentId);
  const structId = sel?.value;
  if (!structId) return;
  btn.disabled = true;
  try {
    const r = await fetch('/api/agent-roster', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_commission_structure', agent_id: agentId, commission_structure_id: structId }),
    });
    if (r.ok) {
      const a = _agentRoster.find(x => x.agent_id === agentId);
      if (a) {
        if (!a.commission_structure_ids) a.commission_structure_ids = a.commission_structure_id ? [a.commission_structure_id] : [];
        if (!a.commission_structure_ids.includes(structId)) a.commission_structure_ids.push(structId);
      }
      renderAgentRoster();
    }
  } finally { btn.disabled = false; }
}

async function removeAgentStructure(agentId, structId, btn) {
  btn.disabled = true;
  try {
    const r = await fetch('/api/agent-roster', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_commission_structure', agent_id: agentId, commission_structure_id: structId }),
    });
    if (r.ok) {
      const a = _agentRoster.find(x => x.agent_id === agentId);
      if (a) a.commission_structure_ids = (a.commission_structure_ids || []).filter(id => id !== structId);
      renderAgentRoster();
    }
  } finally { btn.disabled = false; }
}

async function saveAgentQualifier(agentRosterId, checked) {
  const a = _agentRoster.find(x => x.id === agentRosterId);
  if (a) a.commission_all_must_qualify = checked;
  await fetch('/api/agent-roster', {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_qualifier', id: agentRosterId, commission_all_must_qualify: checked }),
  });
}

async function saveCommissionCapTotal(agentId, input, btn) {
  const val = parseFloat(input.value) || null;
  btn.disabled = true;
  const r = await fetch('/api/agent-roster', {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_cap_total', agent_id: agentId, commission_cap_total: val }),
  });
  const d = await r.json();
  btn.disabled = false;
  if (r.ok) {
    const ag = _agentRoster.find(a => a.agent_id === agentId);
    if (ag) ag.commission_cap_total = val;
    input.style.borderColor = 'var(--accent2)';
    setTimeout(() => input.style.borderColor = '', 1500);
  }
}

async function assignAgentStructure(agentId, structureId) {
  const a = _agentRoster.find(r => r.agent_id === agentId);
  if (!a) return;
  await fetch('/api/agent-roster', {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: a.id, commission_structure_id: structureId || null }),
  });
  a.commission_structure_id = structureId || null;
}

// ── COMMISSION STRUCTURES ──────────────────────────────────────────────────────

// Commission builder uses the same product list as the rest of the app (user-configurable)
function csProducts() { return activeCats(); }

function downloadCommissionTemplate() {
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded.'); return; }
  const rows = [
    ['Structure Name', 'My Structure Name'],
    ['Default Primary Split %', 50],
    [],
    ['Product Key', 'Subcategory (blank = product default)', 'Type (percent / flat / none)', 'Rate'],
  ];
  for (const p of csProducts()) {
    rows.push([p.key, '', 'none', '']);
    const subcats = _salesSubcats.filter(s => s.scoring_category === p.key && s.active !== false);
    for (const sub of subcats) rows.push([p.key, sub.label, 'inherit', '']);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 12 }, { wch: 36 }, { wch: 28 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Commission Structure');
  XLSX.writeFile(wb, 'commission_structure_template.xlsx');
}

function csRateTypeChanged(product) {
  const type  = document.getElementById('cs-rate-type-' + product)?.value;
  const valEl = document.getElementById('cs-rate-val-' + product);
  const fsEl  = document.getElementById('cs-fs-rate-' + product);
  const show  = type && type !== 'none';
  if (valEl) valEl.style.display = show ? '' : 'none';
  if (fsEl)  fsEl.style.display  = show ? '' : 'none';
}

function csSubRateTypeChanged(product, idx) {
  const type  = document.getElementById(`cs-sub-type-${product}-${idx}`)?.value;
  const valEl = document.getElementById(`cs-sub-val-${product}-${idx}`);
  if (valEl) valEl.style.display = (type && type !== 'inherit') ? '' : 'none';
}

function buildRatesTable(existingRates) {
  const tbody = document.getElementById('cs-builder-rates');
  if (!tbody) return;
  const sel  = 'background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:12px;';
  const inp  = 'width:72px;background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:12px;';

  tbody.innerHTML = csProducts().map(p => {
    const prodCfg  = existingRates?.[p.key] || {};
    const prodType = prodCfg.type   || 'none';
    const prodRate = prodCfg.rate   != null ? prodCfg.rate   : '';
    const prodMin  = prodCfg.minimum != null ? prodCfg.minimum : '';
    const prodFsR  = prodCfg.fs_rate != null ? prodCfg.fs_rate : '';
    const subcats  = _salesSubcats.filter(s => s.scoring_category === p.key && s.active !== false);
    const hasFsSub = subcats.some(s => s.is_financial_service);
    const show     = prodType !== 'none';

    let html = `<tr style="background:rgba(255,255,255,.03);border-bottom:1px solid var(--border2);">
      <td style="padding:6px 8px;font-weight:700;">${escHtml(p.label)}</td>
      <td style="padding:5px 8px;">
        <select id="cs-rate-type-${p.key}" onchange="csRateTypeChanged('${p.key}')" style="${sel}">
          <option value="none"${prodType==='none'?' selected':''}>None</option>
          <option value="percent"${prodType==='percent'?' selected':''}>Percent %</option>
          <option value="flat"${prodType==='flat'?' selected':''}>Flat $</option>
        </select>
      </td>
      <td style="padding:5px 8px;">
        <input id="cs-rate-val-${p.key}" type="number" min="0" step="0.01" value="${prodRate}" placeholder="e.g. 10"
          style="${inp}display:${show?'':'none'};">
      </td>
      <td style="padding:5px 8px;">
        <input id="cs-min-${p.key}" type="number" min="0" step="1" value="${prodMin}" placeholder="0"
          title="Minimum written premium" style="${inp}width:72px;">
      </td>
      <td style="padding:5px 8px;">
        ${hasFsSub ? `<input id="cs-fs-rate-${p.key}" type="number" min="0" step="0.01" value="${prodFsR}" placeholder="FS rate"
          title="Rate for financial-service subcategories" style="${inp}width:72px;display:${show?'':'none'};">` : '<span style="font-size:11px;color:var(--border2);">—</span>'}
      </td>
    </tr>`;

    html += subcats.map((sub, idx) => {
      const subCfg  = prodCfg.subcategories?.[sub.label] || {};
      const subType = subCfg.type || 'inherit';
      const subRate = subCfg.rate != null ? subCfg.rate : '';
      return `<tr style="border-bottom:1px solid var(--border2);">
        <td style="padding:4px 8px 4px 22px;font-size:11px;color:var(--muted);">↳ ${escHtml(sub.label)}${sub.is_financial_service ? ' <span style="font-size:10px;color:var(--accent);">FS</span>' : ''}</td>
        <td style="padding:3px 8px;">
          <select id="cs-sub-type-${p.key}-${idx}" onchange="csSubRateTypeChanged('${p.key}','${idx}')" style="${sel}font-size:11px;">
            <option value="inherit"${subType==='inherit'?' selected':''}>Use Default</option>
            <option value="percent"${subType==='percent'?' selected':''}>Percent %</option>
            <option value="flat"${subType==='flat'?' selected':''}>Flat $</option>
          </select>
        </td>
        <td style="padding:3px 8px;">
          <input id="cs-sub-val-${p.key}-${idx}" type="number" min="0" step="0.01" value="${subRate}" placeholder="e.g. 10"
            style="${inp}font-size:11px;display:${subType!=='inherit'?'':'none'};">
        </td>
        <td></td><td></td>
      </tr>`;
    }).join('');

    return html;
  }).join('');
}

// ── Commission Bank config ────────────────────────────────────────────────────
function toggleBankFields(enabled) {
  const fields = document.getElementById('bank-config-fields');
  if (fields) fields.style.display = enabled ? 'grid' : 'none';
}

function renderBankConfigFields() {
  const cfg = _commissionBankConfig || {};
  const enabledCb = document.getElementById('bank-enabled');
  if (enabledCb) enabledCb.checked = cfg.enabled || false;
  const capInput  = document.getElementById('bank-cap');
  if (capInput)  capInput.value = cfg.cap_per_period != null ? cfg.cap_per_period : '';
  const rateInput = document.getElementById('bank-rate');
  if (rateInput) rateInput.value = cfg.interest_rate != null ? cfg.interest_rate : '';
  toggleBankFields(cfg.enabled || false);
}

async function saveBankConfig(btn) {
  const enabledCb = document.getElementById('bank-enabled');
  const capInput  = document.getElementById('bank-cap');
  const rateInput = document.getElementById('bank-rate');
  const msg       = document.getElementById('bank-config-msg');
  const enabled   = enabledCb?.checked || false;
  const capVal  = capInput?.value  ? parseFloat(capInput.value)  : null;
  const rateVal = rateInput?.value ? parseFloat(rateInput.value) : 0;
  _commissionBankConfig = { enabled, cap_per_period: capVal, interest_rate: rateVal };
  if (btn) btn.disabled = true;
  try {
    const { error } = await _supabase.from('accounts')
      .update({ commission_bank_config: _commissionBankConfig })
      .eq('user_id', _userId);
    if (error) throw error;
    if (msg) { msg.style.display = 'block'; msg.style.color = 'var(--accent2)'; msg.textContent = 'Bank config saved.'; setTimeout(() => { msg.style.display = 'none'; }, 2500); }
    loadCommissions(); // refresh commission display with new bank config
  } catch(e) {
    if (msg) { msg.style.display = 'block'; msg.style.color = 'var(--danger)'; msg.textContent = e.message || 'Save failed'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openStructureBuilder(structure) {
  const builder = document.getElementById('cs-builder');
  if (!builder) return;
  builder.style.display = '';
  document.getElementById('cs-builder-id').textContent = structure?.id  || '';
  document.getElementById('cs-builder-name').value     = structure?.name || '';
  document.getElementById('cs-builder-split').value    = structure ? Math.round((structure.default_split_ratio || 0.5) * 100) : 50;
  const poiEl = document.getElementById('cs-builder-pay-on-issue');
  if (poiEl) poiEl.checked = structure?.pay_on_issue || false;
  // Restore thresholds; preserve group IDs from saved data so requires references work
  const thrIdMap = {};
  _csEscSeq = 0;
  _csThresholds = (structure?.thresholds || []).map(t => {
    const newId = t.id || ('thr' + (++_csThresholdSeq));
    thrIdMap[t.id] = newId;
    return {
      id:             newId,
      label:          t.label || '',
      products:       t.products || [],
      min_count:      t.min_count || 0,
      min_commission: t.min_commission || 0,
      requires:            [],  // filled in below after all IDs are mapped
      required_activities: (t.required_activities || []),
      escalators:          (t.escalators || []).map(e => ({
        id:               e.id || ('esc' + (++_csEscSeq)),
        trigger_group_id: e.trigger_group_id || '',  // remapped in second pass
        activity_type_id: e.activity_type_id || null,
        tiers:            (e.tiers || []).map(tier => ({
          min:       tier.min ?? 0,
          max:       tier.max ?? null,
          bonus_pct: tier.bonus_pct ?? 0,
        })),
      })),
    };
  });
  _csThresholds.forEach((t, i) => {
    const orig = (structure?.thresholds || [])[i];
    t.requires = (orig?.requires || []).map(r => thrIdMap[r] || r).filter(r => _csThresholds.some(x => x.id === r));
    t.escalators.forEach(esc => {
      esc.trigger_group_id = thrIdMap[esc.trigger_group_id] || esc.trigger_group_id;
    });
  });
  buildRatesTable(structure?.rates || {});
  renderThresholdGroups();
  document.getElementById('cs-builder-cap-policy').value    = structure?.cap_per_policy    != null ? structure.cap_per_policy    : '';
  document.getElementById('cs-builder-cap-structure').value = structure?.cap_per_structure  != null ? structure.cap_per_structure  : '';
  const msgEl = document.getElementById('cs-builder-msg');
  if (msgEl) { msgEl.style.display = 'none'; }
  builder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openStructureById(id) {
  const s = _commissionStructures.find(s => s.id === id);
  if (s) openStructureBuilder(s);
}

function closeStructureBuilder() {
  const builder = document.getElementById('cs-builder');
  if (builder) builder.style.display = 'none';
  _csThresholds = [];
  document.getElementById('cs-builder-cap-policy').value    = '';
  document.getElementById('cs-builder-cap-structure').value = '';
}

// ── Production threshold state ─────────────────────────────────────────────
// Each group: {id, label, products:[], min_count, min_commission, requires:[ids], escalators:[]}
// min_count:      combined policy count across products must be >= this (0 = no count check)
// min_commission: group's total earned must EXCEED this floor; only the overage is paid (0 = no floor)
// requires:       other group IDs — all must pass before this group pays anything
// escalators:     [{id, trigger_group_id, tiers:[{min, max, bonus_pct}]}]
//   → after group passes, find the tier where trigger group count falls; add bonus_pct% to payout
let _csThresholds = [];
let _csThresholdSeq = 0;
let _csEscSeq = 0;

function syncThresholdsFromDOM() {
  _csThresholds = _csThresholds.map(t => {
    const labelEl   = document.getElementById('cs-thr-label-'   + t.id);
    const countEl   = document.getElementById('cs-thr-count-'   + t.id);
    const mincommEl = document.getElementById('cs-thr-mincomm-' + t.id);
    const prodCbs   = document.querySelectorAll('.cs-thr-prod-' + t.id + ':checked');
    return {
      ...t,
      label:          labelEl   ? (labelEl.value   || '')           : (t.label          || ''),
      products:       prodCbs.length ? [...prodCbs].map(cb => cb.value) : (t.products   || []),
      min_count:      countEl   ? (parseInt(countEl.value)    || 0)  : (t.min_count      || 0),
      min_commission: mincommEl ? (parseFloat(mincommEl.value) || 0) : (t.min_commission || 0),
      // requires tracked directly in state via updateThresholdRequires
    };
  });
}

function thrGroupName(t, idx) {
  return (t.label || '').trim() || `Group ${idx + 1}`;
}

function renderThresholdGroups() {
  const list = document.getElementById('cs-thresholds-list');
  if (!list) return;
  const prods = csProducts();
  const inp = 'background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 7px;font-size:12px;outline:none;';
  const btnSm = 'font-size:11px;padding:3px 10px;white-space:nowrap;';
  if (!_csThresholds.length) {
    list.innerHTML = '<div style="font-size:11px;color:var(--border2);font-style:italic;padding:.25rem 0;">No thresholds — all commissions pay regardless of production volume.</div>';
    return;
  }
  list.innerHTML = _csThresholds.map((t, tIdx) => {
    const others = _csThresholds.map((x, i) => ({ ...x, _idx: i })).filter(x => x.id !== t.id);
    const escs   = t.escalators || [];

    const escHtml2 = escs.map(esc => {
      const tierRows = (esc.tiers || []).map((tier, ti) => `
        <div style="display:grid;grid-template-columns:60px 60px 60px 22px;gap:4px;align-items:center;margin-bottom:3px;">
          <input type="number" min="0" step="1" value="${tier.min ?? 0}" placeholder="0"
            oninput="updateEscTier('${t.id}','${esc.id}',${ti},'min',this.value)"
            style="${inp}width:100%;font-size:11px;padding:2px 5px;">
          <input type="number" min="0" step="1" value="${tier.max ?? ''}" placeholder="∞"
            oninput="updateEscTier('${t.id}','${esc.id}',${ti},'max',this.value)"
            style="${inp}width:100%;font-size:11px;padding:2px 5px;">
          <input type="number" min="0" step="0.1" value="${tier.bonus_pct ?? 0}" placeholder="0"
            oninput="updateEscTier('${t.id}','${esc.id}',${ti},'bonus_pct',this.value)"
            style="${inp}width:100%;font-size:11px;padding:2px 5px;">
          <button onclick="removeEscTier('${t.id}','${esc.id}',${ti})" style="background:none;border:none;color:var(--danger);font-size:13px;cursor:pointer;padding:0;line-height:1;opacity:.7;">✕</button>
        </div>`).join('');

      const activeActTypes = _activityTypes.filter(at => at.active !== false);
      const selectedActId  = esc.activity_type_id || null;
      const triggerOpts = [
        others.length ? '<optgroup label="Production Groups">' : '',
        ...others.map(og => `<option value="${og.id}"${esc.trigger_group_id === og.id ? ' selected' : ''}>${escHtml(thrGroupName(og, og._idx))}</option>`),
        others.length ? '</optgroup>' : '',
        activeActTypes.length ? '<optgroup label="Activity Types">' : '',
        ...activeActTypes.map(at => `<option value="act:${at.id}"${selectedActId === at.id ? ' selected' : ''}>${escHtml(at.name)}${at.subcategory?' · '+escHtml(at.subcategory):''}</option>`),
        activeActTypes.length ? '</optgroup>' : '',
      ].join('');

      return `<div style="background:rgba(0,212,255,.04);border:1px solid rgba(0,212,255,.15);border-radius:6px;padding:.4rem .55rem;margin-bottom:.35rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem;">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">
            <div style="font-size:10px;color:var(--muted);white-space:nowrap;">Triggered by count in:</div>
            <select onchange="updateEscTrigger('${t.id}','${esc.id}',this.value)"
              style="${inp}font-size:11px;padding:2px 5px;">
              <option value="">— Select group —</option>
              ${triggerOpts}
            </select>
          </div>
          <button onclick="removeEscalator('${t.id}','${esc.id}')" style="background:none;border:none;color:var(--muted);font-size:14px;cursor:pointer;padding:0 2px;line-height:1;opacity:.6;" title="Remove escalator">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:60px 60px 60px 22px;gap:4px;font-size:10px;color:var(--muted);margin-bottom:2px;padding-left:1px;">
          <span>Count ≥</span><span>Count ≤</span><span>Bonus %</span><span></span>
        </div>
        ${tierRows}
        <button class="btn btn-secondary" onclick="addEscTier('${t.id}','${esc.id}')" style="${btnSm}margin-top:2px;">+ Add Tier</button>
      </div>`;
    }).join('');

    return `<div style="background:rgba(255,255,255,.03);border:1px solid var(--border2);border-radius:8px;padding:.65rem .75rem;margin-bottom:.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:8px;">
        <div style="flex:1;">
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:2px;">Group Label</label>
          <input id="cs-thr-label-${t.id}" type="text" value="${escHtml(t.label||'')}" placeholder="e.g. Life, Auto &amp; Fire"
            oninput="updateThresholdLabel('${t.id}',this.value)"
            style="${inp}width:100%;max-width:240px;">
        </div>
        <button onclick="removeThresholdGroup('${t.id}')" style="background:none;border:1px solid rgba(255,77,109,.3);color:var(--danger);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;white-space:nowrap;flex-shrink:0;">✕ Remove</button>
      </div>

      <div style="margin-bottom:.5rem;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Products (policy counts combined)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${prods.map(p => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid var(--border2);border-radius:5px;padding:2px 8px;white-space:nowrap;">
            <input type="checkbox" class="cs-thr-prod-${t.id}" value="${escHtml(p.key)}"${(t.products||[]).includes(p.key)?' checked':''} style="accent-color:var(--accent);cursor:pointer;">
            ${escHtml(p.label)}
          </label>`).join('')}
        </div>
      </div>

      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:.5rem;">
        <div>
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:2px;">Min Policy Count</label>
          <input id="cs-thr-count-${t.id}" type="number" min="0" step="1" value="${t.min_count||0}" placeholder="0"
            style="${inp}width:64px;">
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">0 = no count required</div>
        </div>
        <div>
          <label style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:2px;">Commission Floor $</label>
          <input id="cs-thr-mincomm-${t.id}" type="number" min="0" step="0.01" value="${t.min_commission||''}" placeholder="0.00"
            style="${inp}width:90px;">
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Only pays amount above floor</div>
        </div>
      </div>

      ${others.length ? `<div style="margin-bottom:.5rem;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Requires these groups to qualify first</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${others.map(og => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid var(--border2);border-radius:5px;padding:2px 8px;white-space:nowrap;">
            <input type="checkbox"${(t.requires||[]).includes(og.id)?' checked':''} style="accent-color:var(--warn);cursor:pointer;"
              onchange="updateThresholdRequires('${t.id}','${og.id}',this.checked)">
            <span class="cs-req-label-${og.id}">${escHtml(thrGroupName(og, og._idx))}</span>
          </label>`).join('')}
        </div>
      </div>` : ''}

      ${_activityTypes.filter(at => at.active !== false).length ? `<div style="margin-bottom:.5rem;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Required Activities (min count)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${_activityTypes.filter(at => at.active !== false).map(at => {
            const existing = (t.required_activities||[]).find(ra => ra.activity_type_id === at.id);
            return `<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;background:rgba(123,97,255,.06);border:1px solid var(--border2);border-radius:5px;padding:2px 8px;white-space:nowrap;">
              <input type="checkbox"${existing?' checked':''} style="accent-color:#7b61ff;cursor:pointer;"
                onchange="updateRequiredActivity('${t.id}','${at.id}',this.checked)">
              ${escHtml(at.name)}${at.subcategory?' <span style="color:var(--muted);">· '+escHtml(at.subcategory)+'</span>':''}
              <input type="number" min="1" value="${existing?.min_count||1}" style="width:36px;${inp}font-size:11px;padding:2px 5px;"
                oninput="updateRequiredActivityMin('${t.id}','${at.id}',this.value)" title="Minimum count required">
            </label>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.3rem;">
          <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Bonus Escalators</div>
          ${(others.length || _activityTypes.filter(at=>at.active!==false).length)
            ? `<button class="btn btn-secondary" onclick="addEscalator('${t.id}')" style="${btnSm}">+ Add Escalator</button>`
            : `<span style="font-size:10px;color:var(--border2);font-style:italic;">Add more groups or activity types to enable</span>`}
        </div>
        ${escs.length
          ? escHtml2
          : `<div style="font-size:10px;color:var(--border2);font-style:italic;">${(others.length || _activityTypes.length) ? 'No escalators — commission pays at face value.' : ''}</div>`}
      </div>
    </div>`;
  }).join('');
}

function updateThresholdLabel(id, val) {
  const grp = _csThresholds.find(t => t.id === id);
  if (grp) grp.label = val;
  // Update the display text in every other group's requires section without re-rendering
  const idx = _csThresholds.indexOf(grp);
  const display = (val || '').trim() || `Group ${idx + 1}`;
  document.querySelectorAll(`.cs-req-label-${id}`).forEach(el => { el.textContent = display; });
}

function addThresholdGroup() {
  syncThresholdsFromDOM();
  const id = 'thr' + (++_csThresholdSeq);
  _csThresholds.push({ id, label: '', products: [], min_count: 0, min_commission: 0, requires: [], escalators: [] });
  renderThresholdGroups();
}

function removeThresholdGroup(id) {
  syncThresholdsFromDOM();
  _csThresholds = _csThresholds.filter(t => t.id !== id);
  // Remove this id from any other group's requires
  _csThresholds.forEach(t => { t.requires = (t.requires || []).filter(r => r !== id); });
  renderThresholdGroups();
}

function updateThresholdRequires(groupId, reqId, checked) {
  const grp = _csThresholds.find(t => t.id === groupId);
  if (!grp) return;
  grp.requires = grp.requires || [];
  if (checked) { if (!grp.requires.includes(reqId)) grp.requires.push(reqId); }
  else { grp.requires = grp.requires.filter(r => r !== reqId); }
}

function addEscalator(groupId) {
  syncThresholdsFromDOM();
  const grp = _csThresholds.find(t => t.id === groupId);
  if (!grp) return;
  grp.escalators = grp.escalators || [];
  grp.escalators.push({ id: 'esc' + (++_csEscSeq), trigger_group_id: '', tiers: [] });
  renderThresholdGroups();
}

function removeEscalator(groupId, escId) {
  syncThresholdsFromDOM();
  const grp = _csThresholds.find(t => t.id === groupId);
  if (!grp) return;
  grp.escalators = (grp.escalators || []).filter(e => e.id !== escId);
  renderThresholdGroups();
}

function addEscTier(groupId, escId) {
  syncThresholdsFromDOM();
  const grp = _csThresholds.find(t => t.id === groupId);
  if (!grp) return;
  const esc = (grp.escalators || []).find(e => e.id === escId);
  if (!esc) return;
  esc.tiers = esc.tiers || [];
  const prevMax = esc.tiers.length ? (esc.tiers[esc.tiers.length - 1].max ?? null) : null;
  esc.tiers.push({ min: prevMax != null ? prevMax + 1 : 0, max: null, bonus_pct: 0 });
  renderThresholdGroups();
}

function removeEscTier(groupId, escId, tierIdx) {
  syncThresholdsFromDOM();
  const grp = _csThresholds.find(t => t.id === groupId);
  if (!grp) return;
  const esc = (grp.escalators || []).find(e => e.id === escId);
  if (!esc) return;
  esc.tiers.splice(tierIdx, 1);
  renderThresholdGroups();
}

function updateEscTrigger(groupId, escId, val) {
  const grp = _csThresholds.find(t => t.id === groupId);
  if (!grp) return;
  const esc = (grp.escalators || []).find(e => e.id === escId);
  if (!esc) return;
  if (val.startsWith('act:')) {
    esc.activity_type_id = val.slice(4);
    esc.trigger_group_id = null;
  } else {
    esc.trigger_group_id = val || null;
    esc.activity_type_id = null;
  }
}

function updateEscTier(groupId, escId, tierIdx, field, val) {
  const grp = _csThresholds.find(t => t.id === groupId);
  if (!grp) return;
  const esc = (grp.escalators || []).find(e => e.id === escId);
  if (!esc || !esc.tiers[tierIdx]) return;
  const num = parseFloat(val);
  if (field === 'max') esc.tiers[tierIdx].max = (val === '' || isNaN(num)) ? null : num;
  else esc.tiers[tierIdx][field] = isNaN(num) ? 0 : num;
}

function collectThresholds() {
  syncThresholdsFromDOM();
  return _csThresholds
    .filter(t => (t.products||[]).length > 0 || t.min_commission > 0)
    .map(t => ({
      id:             t.id,
      label:          t.label || '',
      products:       t.products || [],
      min_count:      t.min_count || 0,
      min_commission: t.min_commission || 0,
      requires:       t.requires || [],
      escalators:     (t.escalators || []).filter(e => e.trigger_group_id && (e.tiers||[]).length > 0).map(e => ({
        id:               e.id,
        trigger_group_id: e.trigger_group_id,
        tiers:            (e.tiers || []).map(tier => ({
          min:       tier.min ?? 0,
          max:       tier.max ?? null,
          bonus_pct: tier.bonus_pct ?? 0,
        })),
      })),
    }));
}

async function saveStructureFromBuilder(btn) {
  const name     = (document.getElementById('cs-builder-name')?.value || '').trim();
  const splitPct = parseFloat(document.getElementById('cs-builder-split')?.value) || 50;
  const id       = document.getElementById('cs-builder-id')?.textContent.trim() || null;
  if (!name) { showInlineMsg('cs-builder-msg', 'Structure name is required.', 'err'); return; }

  const payOnIssue = document.getElementById('cs-builder-pay-on-issue')?.checked || false;

  const rates = {};
  for (const p of csProducts()) {
    const type = document.getElementById('cs-rate-type-' + p.key)?.value || 'none';
    const entry = {};
    if (type && type !== 'none') {
      const rate = parseFloat(document.getElementById('cs-rate-val-' + p.key)?.value);
      if (!isNaN(rate) && rate >= 0) { entry.type = type; entry.rate = rate; }
      const fsRate = parseFloat(document.getElementById('cs-fs-rate-' + p.key)?.value);
      if (!isNaN(fsRate) && fsRate >= 0) entry.fs_rate = fsRate;
    }
    const minVal = parseFloat(document.getElementById('cs-min-' + p.key)?.value);
    if (!isNaN(minVal) && minVal > 0) entry.minimum = minVal;
    // Collect subcategory overrides
    const subcats = _salesSubcats.filter(s => s.scoring_category === p.key && s.active !== false);
    const subRates = {};
    subcats.forEach((sub, idx) => {
      const subType = document.getElementById(`cs-sub-type-${p.key}-${idx}`)?.value || 'inherit';
      if (subType !== 'inherit') {
        const subRate = parseFloat(document.getElementById(`cs-sub-val-${p.key}-${idx}`)?.value);
        if (!isNaN(subRate) && subRate >= 0) subRates[sub.label] = { type: subType, rate: subRate };
      }
    });
    if (Object.keys(subRates).length) entry.subcategories = subRates;
    if (Object.keys(entry).length) rates[p.key] = entry;
  }

  const thresholds = collectThresholds();
  const payload = {
    name,
    default_split_ratio: splitPct / 100,
    pay_on_issue: payOnIssue,
    thresholds,
    rates,
    cap_per_policy:    parseFloat(document.getElementById('cs-builder-cap-policy').value)    || null,
    cap_per_structure: parseFloat(document.getElementById('cs-builder-cap-structure').value)  || null,
  };
  btn.disabled = true;
  try {
    const method = id ? 'PATCH' : 'POST';
    const body   = id ? { id, ...payload } : payload;
    const r = await fetch('/api/commission-structures', {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { showInlineMsg('cs-builder-msg', d.error || 'Error saving.', 'err'); return; }
    if (id) {
      const idx = _commissionStructures.findIndex(s => s.id === id);
      if (idx >= 0) _commissionStructures[idx] = d;
      else _commissionStructures.push(d);
    } else {
      _commissionStructures.push(d);
    }
    _commissionStructures.sort((a, b) => a.name.localeCompare(b.name));
    closeStructureBuilder();
    renderCommissionStructuresList();
    renderAgentRoster();
  } catch(e) { showInlineMsg('cs-builder-msg', e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function deleteCommissionStructure(id) {
  if (!confirm('Delete this structure? Agents assigned to it will lose their rate.')) return;
  const r = await fetch(`/api/commission-structures?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) { alert('Error deleting structure.'); return; }
  _commissionStructures = _commissionStructures.filter(s => s.id !== id);
  for (const a of _agentRoster) {
    if (a.commission_structure_id === id) a.commission_structure_id = null;
    if ((a.commission_structure_ids || []).includes(id)) {
      a.commission_structure_ids = a.commission_structure_ids.filter(x => x !== id);
    }
  }
  renderCommissionStructuresList();
  renderAgentRoster();
}

function renderCommissionStructuresList() {
  const el = document.getElementById('cs-structures-list');
  if (!el) return;
  if (!_commissionStructures.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--muted);">No structures yet. Create one above or upload a template.</p>';
    return;
  }
  el.innerHTML = _commissionStructures.map(s => {
    const splitPrimary = Math.round((s.default_split_ratio || 0.5) * 100);
    const rateLines = csProducts()
      .filter(p => s.rates?.[p.key]?.type && s.rates[p.key].type !== 'none')
      .map(p => {
        const r = s.rates[p.key];
        return `<span style="font-size:11px;color:var(--muted);">${escHtml(p.label)}: ${r.type === 'percent' ? r.rate + '%' : '$' + r.rate}</span>`;
      }).join('<span style="color:var(--border2);margin:0 4px;">·</span>');
    return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:.65rem .75rem;background:var(--card2);border:1px solid var(--border2);border-radius:8px;margin-bottom:.5rem;gap:.75rem;flex-wrap:wrap;">
      <div>
        <div style="font-weight:600;font-size:13px;margin-bottom:3px;">${escHtml(s.name)}</div>
        <div style="margin-bottom:${rateLines ? '3px' : '0'};">
          <span style="font-size:11px;color:var(--muted);">Split: ${splitPrimary}/${100 - splitPrimary}</span>
          ${s.pay_on_issue ? '<span style="font-size:10px;color:var(--accent);margin-left:8px;">Pay on Issue</span>' : ''}
          ${(s.thresholds||[]).length ? `<span style="font-size:10px;color:var(--warn);margin-left:8px;" title="${(s.thresholds||[]).map(t=>`${t.label||'Group'}: ${t.min_count?t.min_count+' policies':''}${t.min_commission?` $${t.min_commission} floor`:''}${(t.requires||[]).length?' (requires others)':''}`).join(' | ')}">${s.thresholds.length} prod. group${s.thresholds.length>1?'s':''}</span>` : ''}
          ${(s.cap_per_policy || s.cap_per_structure) ? `<span style="font-size:10px;color:var(--accent2);margin-left:8px;" title="${[s.cap_per_policy?`$${s.cap_per_policy}/policy`:'',s.cap_per_structure?`$${s.cap_per_structure}/period`:''].filter(Boolean).join(', ')} cap">&#x2B06; Cap</span>` : ''}
        </div>
        ${rateLines ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">${rateLines}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;" onclick="openStructureById('${escHtml(s.id)}')">Edit</button>
        <button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;" onclick="duplicateCommissionStructure('${escHtml(s.id)}')">Duplicate</button>
        <button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;color:var(--danger);" onclick="deleteCommissionStructure('${escHtml(s.id)}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function duplicateCommissionStructure(id) {
  const src = _commissionStructures.find(s => s.id === id);
  if (!src) return;
  const baseName = src.name.replace(/^Copy of /i, '').replace(/ \(\d+\)$/, '').trim();
  let newName = `Copy of ${baseName}`;
  let attempt = 2;
  while (_commissionStructures.some(s => s.name.toLowerCase() === newName.toLowerCase())) {
    newName = `Copy of ${baseName} (${attempt++})`;
  }
  const r = await fetch('/api/commission-structures', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name:                 newName,
      default_split_ratio:  src.default_split_ratio,
      pay_on_issue:         src.pay_on_issue,
      thresholds:           JSON.parse(JSON.stringify(src.thresholds || [])),
      rates:                JSON.parse(JSON.stringify(src.rates     || {})),
    }),
  });
  const d = await r.json();
  if (!r.ok) { alert(d.error || 'Duplicate failed'); return; }
  _commissionStructures.push(d);
  _commissionStructures.sort((a, b) => a.name.localeCompare(b.name));
  renderCommissionStructuresList();
  renderAgentRoster();
}

async function csFileChange(input) {
  if (input.files?.[0]) await parseAndUploadCommissionXlsx(input.files[0]);
  input.value = '';
}

// ── Bonus Activity Tab ────────────────────────────────────────────────────────

const BONUS_CAT_LABELS = { appointment:'Appt', review:'Review', call:'Call', custom:'Custom' };
const BONUS_CAT_COLORS = { appointment:'rgba(0,212,255,.15)', review:'rgba(0,229,180,.15)', call:'rgba(255,165,0,.15)', custom:'rgba(123,97,255,.15)' };

function initBonusSubTab() {
  loadBonusActivityTypes();
}

async function loadBonusActivityTypes() {
  const r = await fetch('/api/bonus-activities?resource=types', { headers: authHeaders() });
  if (!r.ok) return;
  _activityTypes = await r.json();
  renderBonusActivityTypes();
}

function _bonusInputSt() {
  return 'width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 7px;font-size:12px;outline:none;';
}

function renderBonusActivityTypes() {
  const el = document.getElementById('bonus-types-list');
  if (!el) return;
  if (!_activityTypes.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--muted);margin-bottom:.5rem;">No activity types defined yet. Add one below.</div>';
    return;
  }
  el.innerHTML = _activityTypes.map(t => {
    const sid   = escHtml(t.id);
    const catBg = BONUS_CAT_COLORS[t.category] || BONUS_CAT_COLORS.custom;
    const catLb = BONUS_CAT_LABELS[t.category] || t.category;
    const srcBadge = t.source === 'call_log'
      ? '<span style="font-size:10px;background:rgba(255,165,0,.15);border:1px solid rgba(255,165,0,.3);border-radius:4px;padding:1px 6px;margin-left:4px;">Call Log</span>'
      : '<span style="font-size:10px;background:rgba(255,255,255,.07);border:1px solid var(--border2);border-radius:4px;padding:1px 6px;margin-left:4px;">Manual</span>';
    return `<div style="background:var(--card2);border:1px solid var(--border2);border-radius:8px;padding:.6rem .75rem;margin-bottom:.4rem;">
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" ${t.active !== false ? 'checked' : ''} onchange="toggleBonusTypeActive('${sid}',this.checked)" title="Active">
        <span style="font-size:11px;background:${catBg};border-radius:4px;padding:1px 7px;white-space:nowrap;">${escHtml(catLb)}</span>
        <span style="font-size:13px;font-weight:600;flex:1;">${escHtml(t.name)}${t.subcategory ? ` <span style="font-size:11px;color:var(--muted);font-weight:400;">· ${escHtml(t.subcategory)}</span>` : ''}${t.payment > 0 ? ` · <span style="color:var(--accent2);">$${t.payment.toFixed(2)}</span>` : ''}${srcBadge}</span>
        <button class="btn btn-secondary" style="padding:2px 9px;font-size:11px;" onclick="toggleBonusTypeEdit('${sid}')">Edit</button>
        <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="deleteBonusActivityType('${sid}',this)">✕</button>
      </div>
      <div id="bonus-type-edit-${sid}" style="display:none;margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--border2);">
        <div style="display:grid;grid-template-columns:1fr 140px 150px 110px;gap:.5rem;margin-bottom:.5rem;">
          <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">Name</label>
            <input id="bonus-edit-name-${sid}" type="text" value="${escHtml(t.name)}" style="${_bonusInputSt()}"></div>
          <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">Category</label>
            <select id="bonus-edit-cat-${sid}" style="${_bonusInputSt()}">
              <option value="appointment"${t.category==='appointment'?' selected':''}>Appointment</option>
              <option value="review"${t.category==='review'?' selected':''}>Review</option>
              <option value="call"${t.category==='call'?' selected':''}>Call Activity</option>
              <option value="custom"${t.category==='custom'?' selected':''}>Custom</option>
            </select></div>
          <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">Source</label>
            <select id="bonus-edit-src-${sid}" onchange="onBonusEditSourceChange('${sid}')" style="${_bonusInputSt()}">
              <option value="manual"${t.source==='manual'?' selected':''}>Manual Entry</option>
              <option value="call_log"${t.source==='call_log'?' selected':''}>From Call Log</option>
            </select></div>
          <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">$ / Occurrence</label>
            <input id="bonus-edit-payment-${sid}" type="number" min="0" step="0.01" value="${t.payment||0}" style="${_bonusInputSt()}"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem;">
          <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">Subcategory / Type</label>
            <input id="bonus-edit-subcat-${sid}" type="text" value="${escHtml(t.subcategory||'')}" placeholder="e.g. In-Person" style="${_bonusInputSt()}"></div>
          <div id="bonus-edit-disp-row-${sid}" style="display:${t.source==='call_log'?'':'none'};">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">Call Disposition Filter</label>
            <select id="bonus-edit-disp-${sid}" style="${_bonusInputSt()}">
              <option value=""${!t.call_disposition?' selected':''}>All call types</option>
              <option value="placed"${t.call_disposition==='placed'?' selected':''}>Placed (Outbound)</option>
              <option value="answered"${t.call_disposition==='answered'?' selected':''}>Answered (Inbound)</option>
              <option value="voicemail"${t.call_disposition==='voicemail'?' selected':''}>Voicemail</option>
              <option value="missed"${t.call_disposition==='missed'?' selected':''}>Missed / Abandon</option>
            </select></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="saveBonusActivityType('${sid}',this)">Save</button>
          <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="toggleBonusTypeEdit('${sid}')">Cancel</button>
          <span id="bonus-type-save-msg-${sid}" style="font-size:12px;display:none;"></span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleBonusTypeEdit(id) {
  const el = document.getElementById('bonus-type-edit-' + id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function onBonusEditSourceChange(id) {
  const src  = document.getElementById('bonus-edit-src-' + id)?.value;
  const disp = document.getElementById('bonus-edit-disp-row-' + id);
  if (disp) disp.style.display = src === 'call_log' ? '' : 'none';
}

function onBonusNewSourceChange() {
  const src  = document.getElementById('bonus-new-source')?.value;
  const disp = document.getElementById('bonus-new-call-disp-row');
  if (disp) disp.style.display = src === 'call_log' ? '' : 'none';
}

async function addBonusActivityType(btn) {
  const name     = (document.getElementById('bonus-new-name')?.value || '').trim();
  const category = document.getElementById('bonus-new-category')?.value || 'custom';
  const source   = document.getElementById('bonus-new-source')?.value   || 'manual';
  const subcategory    = (document.getElementById('bonus-new-subcat')?.value || '').trim() || null;
  const call_disposition = source === 'call_log' ? (document.getElementById('bonus-new-call-disp')?.value || null) : null;
  const payment  = parseFloat(document.getElementById('bonus-new-payment')?.value) || 0;
  if (!name) return showInlineMsg('bonus-type-add-msg', 'Name is required', 'err');
  btn.disabled = true;
  try {
    const r = await fetch('/api/bonus-activities', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_type', name, category, subcategory, source, call_disposition, payment }),
    });
    const d = await r.json();
    if (!r.ok) { showInlineMsg('bonus-type-add-msg', d.error || 'Failed', 'err'); return; }
    _activityTypes.push(d);
    renderBonusActivityTypes();
    document.getElementById('bonus-new-name').value = '';
    document.getElementById('bonus-new-subcat').value = '';
    if (document.getElementById('bonus-new-payment')) document.getElementById('bonus-new-payment').value = '';
    showInlineMsg('bonus-type-add-msg', 'Added', 'ok');
  } finally { btn.disabled = false; }
}

async function saveBonusActivityType(id, btn) {
  const name             = (document.getElementById('bonus-edit-name-' + id)?.value || '').trim();
  const category         = document.getElementById('bonus-edit-cat-' + id)?.value  || 'custom';
  const source           = document.getElementById('bonus-edit-src-' + id)?.value  || 'manual';
  const subcategory      = (document.getElementById('bonus-edit-subcat-' + id)?.value || '').trim() || null;
  const call_disposition = source === 'call_log' ? (document.getElementById('bonus-edit-disp-' + id)?.value || null) : null;
  const payment          = parseFloat(document.getElementById('bonus-edit-payment-' + id)?.value) || 0;
  btn.disabled = true;
  try {
    const r = await fetch('/api/bonus-activities', {
      method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_type', id, name, category, subcategory, source, call_disposition, payment }),
    });
    const msgEl = document.getElementById('bonus-type-save-msg-' + id);
    if (r.ok) {
      const t = _activityTypes.find(x => x.id === id);
      if (t) Object.assign(t, { name, category, subcategory, source, call_disposition, payment });
      renderBonusActivityTypes();
    } else {
      if (msgEl) { msgEl.textContent = 'Error saving'; msgEl.style.color='var(--danger)'; msgEl.style.display=''; setTimeout(()=>{ if(msgEl) msgEl.style.display='none'; },2500); }
    }
  } finally { btn.disabled = false; }
}

async function toggleBonusTypeActive(id, active) {
  const t = _activityTypes.find(x => x.id === id);
  if (t) t.active = active;
  await fetch('/api/bonus-activities', {
    method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_type', id, active }),
  });
}

async function deleteBonusActivityType(id, btn) {
  if (!confirm('Delete this activity type? Existing log entries for it will also be deleted.')) return;
  btn.disabled = true;
  try {
    const r = await fetch(`/api/bonus-activities?resource=types&id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) { _activityTypes = _activityTypes.filter(t => t.id !== id); renderBonusActivityTypes(); }
  } finally { btn.disabled = false; }
}

// ── Manage Tab: Activity Log ──────────────────────────────────────────────────

let _manageActLogLoaded = false;

function showManageActivityLog(btn) {
  const body = document.getElementById('manage-act-panel-body');
  const toggleBtn = document.getElementById('manage-act-toggle-btn');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (toggleBtn) toggleBtn.textContent = isHidden ? 'Hide ▴' : 'Show ▾';
  if (isHidden && !_manageActLogLoaded) {
    _manageActLogLoaded = true;
    // Populate month/year selectors
    const now = new Date();
    const mSel = document.getElementById('manage-act-month');
    const ySel = document.getElementById('manage-act-year');
    if (mSel && !mSel.options.length) {
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      MONTHS.forEach((m, i) => { const o = document.createElement('option'); o.value = i+1; o.textContent = m; if (i+1 === now.getMonth()+1) o.selected = true; mSel.appendChild(o); });
    }
    if (ySel && !ySel.options.length) {
      for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) {
        const o = document.createElement('option'); o.value = y; o.textContent = y; if (y === now.getFullYear()) o.selected = true; ySel.appendChild(o);
      }
    }
    loadManageActivityLog();
  }
}

async function loadManageActivityLog() {
  const month = parseInt(document.getElementById('manage-act-month')?.value) || (new Date().getMonth() + 1);
  const year  = parseInt(document.getElementById('manage-act-year')?.value)  || new Date().getFullYear();
  const el    = document.getElementById('manage-act-log-content');
  if (el) el.innerHTML = '<span style="color:var(--muted);">Loading…</span>';
  try {
    const r = await fetch(`/api/bonus-activities?month=${month}&year=${year}`, { headers: authHeaders() });
    if (!r.ok) { if (el) el.innerHTML = '<span style="color:var(--danger);">Error loading log.</span>'; return; }
    const d = await r.json();
    _bonusLogEntries    = d.entries    || [];
    _bonusLogCallTotals = d.callTotals || [];
    renderManageActivityLog();
  } catch(e) { if (el) el.innerHTML = '<span style="color:var(--danger);">Error loading log.</span>'; }
}

function renderManageActivityLog() {
  const el = document.getElementById('manage-act-log-content');
  if (!el) return;
  const activeTypes = _activityTypes.filter(t => t.active !== false);
  if (!activeTypes.length) { el.innerHTML = '<span style="color:var(--muted);">No activity types defined.</span>'; return; }
  const hasData = _bonusLogEntries.length || _bonusLogCallTotals.length;
  if (!hasData) { el.innerHTML = '<span style="color:var(--muted);">No activities logged for this month.</span>'; return; }

  const getAgentName = id => _agentRoster.find(a => a.agent_id === id)?.name || id;

  el.innerHTML = activeTypes.map(t => {
    const catBg = BONUS_CAT_COLORS[t.category] || BONUS_CAT_COLORS.custom;
    const catLb = BONUS_CAT_LABELS[t.category] || t.category;

    if (t.source === 'call_log') {
      const rows = _bonusLogCallTotals.filter(x => x.activity_type_id === t.id);
      if (!rows.length) return '';
      const total = rows.reduce((s,r)=>s+r.count,0);
      return `<div style="background:var(--card2);border:1px solid var(--border2);border-radius:8px;padding:.65rem .75rem;margin-bottom:.5rem;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:.4rem;">
          <span style="font-size:11px;background:${catBg};border-radius:4px;padding:1px 7px;">${escHtml(catLb)}</span>
          <strong style="font-size:13px;">${escHtml(t.name)}${t.subcategory?` <span style="font-weight:400;color:var(--muted);">· ${escHtml(t.subcategory)}</span>`:''}</strong>
          <span style="font-size:10px;background:rgba(255,165,0,.15);border:1px solid rgba(255,165,0,.3);border-radius:4px;padding:1px 6px;">Auto · Call Log</span>
          <span style="margin-left:auto;font-size:12px;color:var(--muted);">Total: <strong style="color:var(--text);">${total}</strong></span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${rows.map(r=>`<span style="font-size:12px;background:rgba(255,255,255,.04);border:1px solid var(--border2);border-radius:6px;padding:3px 10px;">${escHtml(getAgentName(r.agent_id))} <strong>${r.count}</strong></span>`).join('')}
        </div>
      </div>`;
    }

    // Manual type
    const entries = _bonusLogEntries.filter(x => x.activity_type_id === t.id);
    if (!entries.length) return '';
    const total = entries.reduce((s,e)=>s+e.count,0);
    return `<div style="background:var(--card2);border:1px solid var(--border2);border-radius:8px;padding:.65rem .75rem;margin-bottom:.5rem;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:.4rem;">
        <span style="font-size:11px;background:${catBg};border-radius:4px;padding:1px 7px;">${escHtml(catLb)}</span>
        <strong style="font-size:13px;">${escHtml(t.name)}${t.subcategory?` <span style="font-weight:400;color:var(--muted);">· ${escHtml(t.subcategory)}</span>`:''}</strong>
        <span style="margin-left:auto;font-size:12px;color:var(--muted);">Total: <strong style="color:var(--text);">${total}</strong></span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="color:var(--muted);text-align:left;">
          <th style="padding:3px 8px 3px 0;font-weight:600;">Agent</th>
          <th style="padding:3px 8px 3px 0;">Date</th>
          <th style="padding:3px 8px 3px 0;">Count</th>
          <th style="padding:3px 8px 3px 0;">Notes</th>
          <th></th>
        </tr></thead>
        <tbody>${entries.map(e=>`<tr style="border-top:1px solid var(--border2);">
          <td style="padding:4px 8px 4px 0;">${escHtml(getAgentName(e.agent_id))}</td>
          <td style="padding:4px 8px 4px 0;">${escHtml(e.activity_date||'')}</td>
          <td style="padding:4px 8px 4px 0;"><strong>${e.count}</strong></td>
          <td style="padding:4px 8px 4px 0;color:var(--muted);">${escHtml(e.notes||'')}</td>
          <td style="padding:4px 0;text-align:right;"><button onclick="deleteManageActivityEntry('${escHtml(e.id)}',this)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;opacity:.6;" title="Delete">✕</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).filter(Boolean).join('') || '<span style="color:var(--muted);">No activities logged for this month.</span>';
}

function showManageActivityEntryForm() {
  const manualTypes = _activityTypes.filter(t => t.source === 'manual' && t.active !== false);
  if (!manualTypes.length) { alert('No manual activity types defined. Add a Manual Entry type in the Bonus tab first.'); return; }
  const agentSel = document.getElementById('manage-act-entry-agent');
  const typeSel  = document.getElementById('manage-act-entry-type');
  if (agentSel) {
    agentSel.innerHTML = '<option value="">— Select agent —</option>' +
      _agentRoster.filter(a => a.active !== false).map(a => `<option value="${escHtml(a.agent_id)}">${escHtml(a.name)}</option>`).join('');
  }
  if (typeSel) {
    typeSel.innerHTML = manualTypes.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.name)}${t.subcategory?' · '+escHtml(t.subcategory):''}</option>`).join('');
  }
  const dateEl = document.getElementById('manage-act-entry-date');
  if (dateEl && !dateEl.value) {
    const now = new Date();
    dateEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  const form = document.getElementById('manage-act-entry-form');
  if (form) form.style.display = '';
}

async function saveManageActivityEntry(btn) {
  const activity_type_id = document.getElementById('manage-act-entry-type')?.value;
  const agent_id         = document.getElementById('manage-act-entry-agent')?.value;
  const activity_date    = (document.getElementById('manage-act-entry-date')?.value || '').trim();
  const count            = parseInt(document.getElementById('manage-act-entry-count')?.value) || 1;
  const notes            = (document.getElementById('manage-act-entry-notes')?.value || '').trim() || null;
  if (!activity_type_id || !agent_id || !activity_date) return showInlineMsg('manage-act-entry-msg', 'Agent, type, and date required', 'err');
  btn.disabled = true;
  try {
    const r = await fetch('/api/bonus-activities', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_entry', activity_type_id, agent_id, activity_date, count, notes }),
    });
    if (!r.ok) { const d = await r.json(); showInlineMsg('manage-act-entry-msg', d.error || 'Failed', 'err'); return; }
    document.getElementById('manage-act-entry-form').style.display = 'none';
    document.getElementById('manage-act-entry-notes').value = '';
    loadManageActivityLog();
  } finally { btn.disabled = false; }
}

async function deleteManageActivityEntry(id, btn) {
  btn.disabled = true;
  try {
    const r = await fetch(`/api/bonus-activities?resource=entries&id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) { _bonusLogEntries = _bonusLogEntries.filter(e => e.id !== id); renderManageActivityLog(); }
  } finally { btn.disabled = false; }
}

// ── Agent Self-Reporting ──────────────────────────────────────────────────────

function renderSelfReportSettings() {
  const cfg = _selfReportConfig || {};
  const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setChk('sr-activities-enabled', cfg.activities_enabled);
  setChk('sr-sales-enabled',      cfg.sales_enabled);
  setChk('sr-requires-approval',  cfg.requires_approval);
  setChk('sr-sales-log-edit',     cfg.sales_log_edit_enabled);
  setChk('sr-req-act-notes',      cfg.req_act_notes);
  const rf = cfg.req_sales_fields || {};
  setChk('sr-req-customer-name', rf.customer_name);
  setChk('sr-req-premium',       rf.written_premium);
  setChk('sr-req-subcategory',   rf.subcategory);
  setChk('sr-req-lead-source',   rf.lead_source);
  setChk('sr-req-location',      rf.location);
  setChk('sr-req-period',        rf.period);
  const actFields = document.getElementById('sr-activity-fields');
  if (actFields) actFields.style.display = cfg.activities_enabled ? '' : 'none';
  const salesFields = document.getElementById('sr-sales-fields');
  if (salesFields) salesFields.style.display = cfg.sales_enabled ? '' : 'none';
}

function onSrConfigChange() {
  const actEl   = document.getElementById('sr-activities-enabled');
  const salesEl = document.getElementById('sr-sales-enabled');
  const actFields   = document.getElementById('sr-activity-fields');
  const salesFields = document.getElementById('sr-sales-fields');
  if (actFields)   actFields.style.display   = actEl?.checked   ? '' : 'none';
  if (salesFields) salesFields.style.display = salesEl?.checked ? '' : 'none';
}

async function saveSelfReportConfig(btn) {
  btn.disabled = true;
  const cfg = {
    activities_enabled:    document.getElementById('sr-activities-enabled')?.checked  || false,
    sales_enabled:         document.getElementById('sr-sales-enabled')?.checked       || false,
    requires_approval:     document.getElementById('sr-requires-approval')?.checked   || false,
    sales_log_edit_enabled: document.getElementById('sr-sales-log-edit')?.checked    || false,
    req_act_notes:         document.getElementById('sr-req-act-notes')?.checked       || false,
    req_sales_fields: {
      customer_name:   document.getElementById('sr-req-customer-name')?.checked  || false,
      written_premium: document.getElementById('sr-req-premium')?.checked        || false,
      subcategory:     document.getElementById('sr-req-subcategory')?.checked    || false,
      lead_source:     document.getElementById('sr-req-lead-source')?.checked    || false,
      location:        document.getElementById('sr-req-location')?.checked       || false,
      period:          document.getElementById('sr-req-period')?.checked         || false,
    },
  };
  try {
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_self_report', selfReportConfig: cfg }),
    });
    if (r.ok) {
      _selfReportConfig = cfg;
      showInlineMsg('sr-save-msg', 'Saved', 'ok');
    } else {
      showInlineMsg('sr-save-msg', 'Error saving', 'err');
    }
  } catch(e) { showInlineMsg('sr-save-msg', e.message, 'err'); }
  finally { btn.disabled = false; }
}

function _initSrMonthYearPickers() {
  const mSel = document.getElementById('sr-act-month');
  const ySel = document.getElementById('sr-act-year');
  if (mSel && !mSel.options.length) {
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].forEach((m,i) => {
      const o = document.createElement('option'); o.value = i+1; o.textContent = m; mSel.appendChild(o);
    });
    mSel.value = new Date().getMonth() + 1;
  }
  if (ySel && !ySel.options.length) {
    const y = new Date().getFullYear();
    for (let i = y-1; i <= y+1; i++) { const o = document.createElement('option'); o.value = i; o.textContent = i; ySel.appendChild(o); }
    ySel.value = y;
  }
}

function _populateSrActivityTypes() {
  const sel = document.getElementById('sr-act-entry-type');
  if (!sel) return;
  const manualTypes = _activityTypes.filter(t => t.source === 'manual' && t.active !== false);
  sel.innerHTML = manualTypes.length
    ? '<option value="">— Select type —</option>' + manualTypes.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.name)}${t.subcategory?' · '+escHtml(t.subcategory):''}</option>`).join('')
    : '<option value="">No manual types defined</option>';
}

function showSrActivityForm() {
  _populateSrActivityTypes();
  const form = document.getElementById('sr-act-entry-form');
  if (form) form.style.display = '';
  const dateEl = document.getElementById('sr-act-entry-date');
  if (dateEl && !dateEl.value) {
    const now = new Date();
    dateEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
}

async function loadSrActivityLog() {
  const month = parseInt(document.getElementById('sr-act-month')?.value) || (new Date().getMonth()+1);
  const year  = parseInt(document.getElementById('sr-act-year')?.value)  || new Date().getFullYear();
  const el    = document.getElementById('sr-act-log-content');
  if (el) el.innerHTML = '<span style="color:var(--muted);">Loading...</span>';
  try {
    const r = await fetch(`/api/bonus-activities?month=${month}&year=${year}`, { headers: authHeaders() });
    if (!r.ok) { if (el) el.innerHTML = '<span style="color:var(--danger);">Error loading log.</span>'; return; }
    const d = await r.json();
    _bonusLogEntries    = d.entries    || [];
    _bonusLogCallTotals = d.callTotals || [];
    _renderSrActivityLog(el);
  } catch(e) { if (el) el.innerHTML = '<span style="color:var(--danger);">Error.</span>'; }
}

function _renderSrActivityLog(el) {
  if (!el) return;
  const statusBadge = s => {
    if (s === 'pending')  return '<span style="font-size:10px;background:rgba(255,179,0,.15);color:#ffb300;border:1px solid rgba(255,179,0,.3);border-radius:4px;padding:1px 6px;margin-left:4px;">Pending</span>';
    if (s === 'rejected') return '<span style="font-size:10px;background:rgba(255,107,107,.15);color:#ff6b6b;border:1px solid rgba(255,107,107,.3);border-radius:4px;padding:1px 6px;margin-left:4px;">Rejected</span>';
    return '<span style="font-size:10px;background:rgba(0,229,180,.12);color:var(--accent2);border:1px solid rgba(0,229,180,.2);border-radius:4px;padding:1px 6px;margin-left:4px;">Approved</span>';
  };
  const myEntries = _bonusLogEntries;
  if (!myEntries.length && !_bonusLogCallTotals.length) {
    el.innerHTML = '<span style="color:var(--muted);">No activities logged for this month.</span>';
    return;
  }
  el.innerHTML = _activityTypes.filter(t => t.active !== false).map(t => {
    const entries = myEntries.filter(e => e.activity_type_id === t.id);
    if (!entries.length) return '';
    return `<div style="background:var(--card2);border:1px solid var(--border2);border-radius:8px;padding:.6rem .75rem;margin-bottom:.5rem;">
      <strong style="font-size:13px;">${escHtml(t.name)}</strong>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:.4rem;">
        <thead><tr style="color:var(--muted);">
          <th style="padding:3px 8px 3px 0;font-weight:600;text-align:left;">Date</th>
          <th style="padding:3px 8px 3px 0;text-align:left;">Count</th>
          <th style="padding:3px 8px 3px 0;text-align:left;">Notes</th>
          <th style="padding:3px 8px 3px 0;text-align:left;">Status</th>
        </tr></thead>
        <tbody>${entries.map(e => `<tr style="border-top:1px solid var(--border2);">
          <td style="padding:4px 8px 4px 0;">${escHtml(e.activity_date||'')}</td>
          <td style="padding:4px 8px 4px 0;">${e.count}</td>
          <td style="padding:4px 8px 4px 0;">${escHtml(e.notes||'—')}</td>
          <td style="padding:4px 8px 4px 0;">${statusBadge(e.status||'approved')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  }).filter(Boolean).join('') || '<span style="color:var(--muted);">No manual activities this month.</span>';
}

async function submitSrActivity(btn) {
  const activity_type_id = document.getElementById('sr-act-entry-type')?.value;
  const activity_date    = (document.getElementById('sr-act-entry-date')?.value || '').trim();
  const count            = parseInt(document.getElementById('sr-act-entry-count')?.value) || 1;
  const notes            = (document.getElementById('sr-act-entry-notes')?.value || '').trim() || null;
  if (!activity_type_id || !activity_date) return showInlineMsg('sr-act-entry-msg', 'Type and date required', 'err');
  if (_selfReportConfig?.req_act_notes && !notes) return showInlineMsg('sr-act-entry-msg', 'Notes are required', 'err');
  btn.disabled = true;
  try {
    const r = await fetch('/api/bonus-activities', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_entry', activity_type_id, activity_date, count, notes }),
    });
    if (!r.ok) { const d = await r.json(); showInlineMsg('sr-act-entry-msg', d.error || 'Failed', 'err'); return; }
    document.getElementById('sr-act-entry-form').style.display = 'none';
    document.getElementById('sr-act-entry-notes').value = '';
    loadSrActivityLog();
  } finally { btn.disabled = false; }
}

function srSalesAddRow() {
  const container = document.getElementById('sr-sales-rows');
  if (!container) return;
  const rowId = 'sr-sr-' + Date.now();
  const si = 'width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:5px 7px;font-size:12px;outline:none;';
  const cfg = (_selfReportConfig?.req_sales_fields) || {};
  const req = (field) => cfg[field] ? `<span style="color:var(--danger);margin-left:2px;">*</span>` : '';
  const cats = activeCats();
  const productOpts = '<option value="">— Product —</option>' + cats.map(c => `<option value="${c.key}">${c.label}</option>`).join('');
  const srcOpts = '<option value="">—</option>' + getLeadSources().map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  const locOpts = '<option value="">— optional —</option>' + _salesLocations.filter(l => l.active !== false).map(l => `<option value="${escHtml(l.name)}">${escHtml(l.name)}</option>`).join('');
  const div = document.createElement('div');
  div.className = 'sr-sale-row'; div.id = rowId;
  div.style.cssText = 'background:var(--card2);border:1px solid var(--border2);border-radius:8px;padding:.75rem;margin-bottom:.5rem;';
  div.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem;">
      <div><label style="font-size:11px;color:var(--muted);">PRODUCT</label>
        <select id="${rowId}-product" onchange="srUpdateSubcat(this,'${rowId}')" style="${si}">${productOpts}</select></div>
      <div><label style="font-size:11px;color:var(--muted);">SUBCATEGORY${req('subcategory')}</label>
        <select id="${rowId}-subcat" style="${si}"><option value="">— select product first —</option></select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem;margin-bottom:.5rem;">
      <div><label style="font-size:11px;color:var(--muted);">SALE DATE *</label>
        <input id="${rowId}-date" type="text" placeholder="YYYY-MM-DD" style="${si}"></div>
      <div><label style="font-size:11px;color:var(--muted);">CUSTOMER NAME${req('customer_name')}</label>
        <input id="${rowId}-customer" type="text" style="${si}"></div>
      <div><label style="font-size:11px;color:var(--muted);">PREMIUM${req('written_premium')}</label>
        <input id="${rowId}-prem" type="number" step="0.01" style="${si}"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:.5rem;align-items:end;">
      <div><label style="font-size:11px;color:var(--muted);">LEAD SOURCE <span style="color:var(--danger)">*</span></label>
        <select id="${rowId}-source" style="${si}">${srcOpts}</select></div>
      <div><label style="font-size:11px;color:var(--muted);">PERIOD${req('period')}</label>
        <select id="${rowId}-period" style="${si}"><option value="">—</option><option value="6">6</option><option value="12">12</option></select></div>
      <div><label style="font-size:11px;color:var(--muted);">LOCATION${req('location')}</label>
        <select id="${rowId}-location" style="${si}">${locOpts}</select></div>
      <button onclick="this.closest('.sr-sale-row').remove()" style="background:none;border:1px solid var(--border2);color:var(--danger);border-radius:5px;padding:5px 8px;cursor:pointer;font-size:12px;">✕</button>
    </div>`;
  container.appendChild(div);
  const dateEl = div.querySelector(`#${rowId}-date`);
  if (dateEl) {
    const now = new Date();
    dateEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    if (!dateEl._flatpickr) flatpickr(dateEl, { dateFormat: 'Y-m-d', allowInput: true });
  }
}

function srUpdateSubcat(sel, rowId) {
  const product = sel.value;
  const subcatSel = document.getElementById(rowId + '-subcat');
  if (subcatSel) subcatSel.innerHTML = _slSubcatOpts(product, '');
}

async function srSalesSubmitAll(btn) {
  const rows = document.querySelectorAll('.sr-sale-row');
  if (!rows.length) return;
  const cfg = (_selfReportConfig?.req_sales_fields) || {};
  const msgs = [];
  const entries = [];
  rows.forEach((row, i) => {
    const id     = row.id;
    const product    = document.getElementById(id+'-product')?.value;
    const saleDate   = document.getElementById(id+'-date')?.value?.trim();
    const customer   = document.getElementById(id+'-customer')?.value?.trim();
    const prem       = document.getElementById(id+'-prem')?.value;
    const subcatRaw  = document.getElementById(id+'-subcat')?.value || '';
    const subcategory = subcatRaw.includes('|') ? subcatRaw.split('|')[1] : null;
    const leadSource = document.getElementById(id+'-source')?.value;
    const period     = document.getElementById(id+'-period')?.value;
    const location   = document.getElementById(id+'-location')?.value;

    if (!product) { msgs.push(`Row ${i+1}: product required`); return; }
    if (!saleDate) { msgs.push(`Row ${i+1}: sale date required`); return; }
    if (cfg.customer_name && !customer) { msgs.push(`Row ${i+1}: customer name required`); return; }
    if (cfg.written_premium && !prem) { msgs.push(`Row ${i+1}: premium required`); return; }
    if (cfg.subcategory && !subcategory) { msgs.push(`Row ${i+1}: subcategory required`); return; }
    if (!leadSource) { msgs.push(`Row ${i+1}: lead source required`); return; }
    if (cfg.location && !location) { msgs.push(`Row ${i+1}: location required`); return; }
    if (cfg.period && !period) { msgs.push(`Row ${i+1}: period required`); return; }

    entries.push({ product, saleDate, customerName: customer, writtenPremium: prem || null,
      subcategory, leadSource: leadSource || null, period: period || null, location: location || null });
  });

  if (msgs.length) { showInlineMsg('sr-sales-msg', msgs[0], 'err'); return; }
  btn.disabled = true;
  try {
    const results = await Promise.all(entries.map(e =>
      fetch('/api/sales', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(e),
      })
    ));
    const failed = results.filter(r => !r.ok);
    if (failed.length) { showInlineMsg('sr-sales-msg', `${failed.length} submission(s) failed.`, 'err'); return; }
    document.getElementById('sr-sales-rows').innerHTML = '';
    showInlineMsg('sr-sales-msg', `${entries.length} sale(s) submitted.`, 'ok');
    srSalesAddRow();
  } finally { btn.disabled = false; }
}

async function loadPendingApprovals() {
  const el = document.getElementById('pending-approvals-list');
  const badge = document.getElementById('pending-count-badge');
  if (el) el.innerHTML = '<span style="color:var(--muted);">Loading...</span>';
  try {
    const r = await fetch('/api/bonus-activities?resource=pending', { headers: authHeaders() });
    if (!r.ok) { if (el) el.innerHTML = '<span style="color:var(--danger);">Error loading approvals.</span>'; return; }
    const data = await r.json();
    if (badge) badge.textContent = data.length || '';
    if (!data.length) { if (el) el.innerHTML = '<span style="color:var(--muted);">No pending submissions.</span>'; return; }
    const getAgentName = id => _agentRoster.find(a => a.agent_id === id)?.name || id;
    const getTypeName  = id => { const t = _activityTypes.find(x => x.id === id); return t ? t.name : id; };
    if (el) el.innerHTML = data.map(e => `
      <div id="pend-row-${escHtml(e.id)}" style="background:var(--card2);border:1px solid rgba(255,179,0,.2);border-radius:8px;padding:.6rem .75rem;margin-bottom:.4rem;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="font-size:13px;font-weight:600;">${escHtml(getAgentName(e.agent_id))}</div>
          <div style="font-size:12px;color:var(--muted);">${escHtml(getTypeName(e.activity_type_id))} · ${escHtml(e.activity_date||'')} · Count: ${e.count}${e.notes?` · <em>${escHtml(e.notes)}</em>`:''}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="pend-note-${escHtml(e.id)}" type="text" placeholder="Note (optional)" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:4px 7px;font-size:12px;outline:none;width:160px;">
          <button class="btn btn-primary" style="font-size:11px;padding:3px 10px;" onclick="approveActivity('${escHtml(e.id)}','approved',this)">Approve</button>
          <button class="btn btn-danger" style="font-size:11px;padding:3px 10px;" onclick="approveActivity('${escHtml(e.id)}','rejected',this)">Reject</button>
        </div>
      </div>`).join('');
  } catch(e) { if (el) el.innerHTML = '<span style="color:var(--danger);">Error.</span>'; }
}

async function approveActivity(id, status, btn) {
  btn.disabled = true;
  const note = document.getElementById('pend-note-' + id)?.value || null;
  try {
    const r = await fetch('/api/bonus-activities', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_status', id, status, approval_note: note }),
    });
    if (r.ok) {
      const row = document.getElementById('pend-row-' + id);
      if (row) row.remove();
      const badge = document.getElementById('pending-count-badge');
      const remaining = document.querySelectorAll('[id^="pend-row-"]').length;
      if (badge) badge.textContent = remaining || '';
      if (!remaining) {
        const el = document.getElementById('pending-approvals-list');
        if (el) el.innerHTML = '<span style="color:var(--muted);">No pending submissions.</span>';
      }
    }
  } finally { btn.disabled = false; }
}

// ── Bonus: required activities helpers (commission builder) ───────────────────

function updateRequiredActivity(tId, actTypeId, checked) {
  const grp = _csThresholds.find(t => t.id === tId);
  if (!grp) return;
  grp.required_activities = grp.required_activities || [];
  if (checked) {
    if (!grp.required_activities.some(ra => ra.activity_type_id === actTypeId)) {
      grp.required_activities.push({ activity_type_id: actTypeId, min_count: 1 });
    }
  } else {
    grp.required_activities = grp.required_activities.filter(ra => ra.activity_type_id !== actTypeId);
  }
}

function updateRequiredActivityMin(tId, actTypeId, val) {
  const grp = _csThresholds.find(t => t.id === tId);
  const ra  = (grp?.required_activities || []).find(r => r.activity_type_id === actTypeId);
  if (ra) ra.min_count = parseInt(val) || 1;
}

function csFileDrop(event) {
  event.preventDefault();
  document.getElementById('cs-upload-drop').style.borderColor = 'var(--border2)';
  const file = event.dataTransfer.files?.[0];
  if (file) parseAndUploadCommissionXlsx(file);
}

async function parseAndUploadCommissionXlsx(file) {
  const msgEl = document.getElementById('cs-upload-msg');
  if (msgEl) { msgEl.style.display = ''; msgEl.style.color = 'var(--muted)'; msgEl.textContent = 'Parsing…'; }
  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const name       = String(rows[0]?.[1] || '').trim();
    const splitPct   = parseFloat(rows[1]?.[1]) || 50;
    if (!name) throw new Error('Structure Name cell is empty (row 1, column B).');

    const rates = {};
    for (let i = 3; i < rows.length; i++) {
      const [col0, col1, col2, col3] = rows[i];
      // Support both 3-col (old: key, type, rate) and 4-col (new: key, subcat, type, rate)
      const hasFourCols = col3 !== undefined;
      const productKey  = String(col0 || '').toLowerCase().trim();
      const subcatLabel = hasFourCols ? String(col1 || '').trim() : '';
      const typeRaw     = hasFourCols ? String(col2 || '') : String(col1 || '');
      const rateRaw     = hasFourCols ? col3 : col2;

      if (!productKey || !csProducts().find(p => p.key === productKey)) continue;
      const typeStr = typeRaw.toLowerCase().trim();
      if (!typeStr || typeStr === 'none' || typeStr === 'inherit') continue;
      const t = typeStr.includes('flat') ? 'flat' : 'percent';
      const r = parseFloat(rateRaw);
      if (isNaN(r) || r < 0) continue;

      if (!rates[productKey]) rates[productKey] = {};
      if (subcatLabel) {
        if (!rates[productKey].subcategories) rates[productKey].subcategories = {};
        rates[productKey].subcategories[subcatLabel] = { type: t, rate: r };
      } else {
        rates[productKey].type = t;
        rates[productKey].rate = r;
      }
    }

    const existing = _commissionStructures.find(s => s.name.toLowerCase() === name.toLowerCase());
    const method   = existing ? 'PATCH' : 'POST';
    const body     = existing
      ? { id: existing.id, name, default_split_ratio: splitPct / 100, rates }
      : { name, default_split_ratio: splitPct / 100, rates };

    const r = await fetch('/api/commission-structures', {
      method,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Save failed');

    if (existing) {
      const idx = _commissionStructures.findIndex(s => s.id === existing.id);
      if (idx >= 0) _commissionStructures[idx] = d;
    } else {
      _commissionStructures.push(d);
    }
    _commissionStructures.sort((a, b) => a.name.localeCompare(b.name));
    renderCommissionStructuresList();
    renderAgentRoster();
    if (msgEl) { msgEl.style.color = 'var(--accent2)'; msgEl.textContent = `"${escHtml(name)}" saved successfully.`; }
  } catch(e) {
    if (msgEl) { msgEl.style.color = 'var(--danger)'; msgEl.textContent = e.message; }
  }
}

// ── COMMISSIONS REPORT ─────────────────────────────────────────────────────────

function commPrevMonth() {
  const [yr, mo] = _commMonth.split('-').map(Number);
  const d = new Date(yr, mo - 2);
  _commMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  loadCommissions();
}

function commNextMonth() {
  const [yr, mo] = _commMonth.split('-').map(Number);
  const d = new Date(yr, mo);
  _commMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  loadCommissions();
}

function updateCommMonthDisplay() {
  const [yr, mo] = _commMonth.split('-').map(Number);
  const label = new Date(yr, mo - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const el = document.getElementById('comm-month-label');
  if (el) el.textContent = label;
}

async function loadCommissions() {
  if (!_commMonth) {
    const now = new Date();
    _commMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  updateCommMonthDisplay();
  const wrap = document.getElementById('comm-table-wrap');
  if (wrap) { wrap.innerHTML = '<span style="color:var(--muted);font-size:13px;">Loading…</span>'; }
  try {
    const r = await fetch(`/api/commissions?month=${_commMonth}`, { headers: authHeaders() });
    if (!r.ok) { if (wrap) wrap.innerHTML = '<span style="color:var(--danger);font-size:13px;">Error loading commissions.</span>'; return; }
    _commData = await r.json();
    if (_commData.bank_config) {
      _commissionBankConfig = _commData.bank_config;
      renderBankConfigFields();
    }
    renderCommissions();
    if (_isMember) populateWhatIfProducts();
  } catch(e) {
    if (wrap) wrap.innerHTML = `<span style="color:var(--danger);font-size:13px;">${escHtml(e.message)}</span>`;
  }
}

function renderCommissions() {
  if (!_commData) return;
  const results = _commData.results || [];
  const month   = _commData.month   || '';

  if (_isMember) {
    document.getElementById('comm-owner-view').style.display  = 'none';
    document.getElementById('comm-member-view').style.display = '';
    // Find the member's own entry by matching any agent they appear in as primary
    const memberPane = document.getElementById('comm-member-own');
    if (!memberPane) return;
    if (!results.length) { memberPane.innerHTML = '<p style="font-size:13px;color:var(--muted);">No commission data for this month.</p>'; return; }
    memberPane.innerHTML = results.map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;flex-wrap:wrap;gap:.5rem;">
        <span style="font-size:14px;font-weight:600;">${escHtml(r.name)}</span>
        <span style="font-size:18px;font-weight:700;color:var(--accent2);">$${r.earned.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
      </div>
      ${r.breakdown.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:.75rem;">
        <thead><tr style="border-bottom:1px solid var(--border2);">
          <th style="text-align:left;padding:4px 8px;color:var(--muted);">Product</th>
          <th style="text-align:right;padding:4px 8px;color:var(--muted);">Premium</th>
          <th style="text-align:right;padding:4px 8px;color:var(--muted);">Your Share</th>
          <th style="text-align:right;padding:4px 8px;color:var(--muted);">Commission</th>
        </tr></thead>
        <tbody>${r.breakdown.map(b => `<tr style="border-bottom:1px solid var(--border2);">
          <td style="padding:4px 8px;">${escHtml(b.product)}${b.split ? ' <span style="font-size:10px;color:var(--muted);">('+b.role+')</span>' : ''}</td>
          <td style="padding:4px 8px;text-align:right;">$${(b.premium||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td style="padding:4px 8px;text-align:right;">$${(b.share||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td style="padding:4px 8px;text-align:right;font-weight:600;">$${(b.commission||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<p style="font-size:12px;color:var(--muted);">No sales this month.</p>'}
    `).join('<hr style="border:none;border-top:1px solid var(--border2);margin:.75rem 0;">');
    return;
  }

  // Owner view — rebuild payment lookup map (avoids embedding JSON in onclick attributes)
  _commPayments = {};
  for (const r of results) { if (r.paid?.amount_paid != null) _commPayments[r.agent_id] = r.paid; }

  document.getElementById('comm-owner-view').style.display  = '';
  document.getElementById('comm-member-view').style.display = 'none';
  const wrap = document.getElementById('comm-table-wrap');
  if (!wrap) return;

  if (!results.length) {
    wrap.innerHTML = '<p style="font-size:13px;color:var(--muted);">No agent data found.</p>';
    return;
  }

  // Detect if any agent has a carry-forward in or out this month
  const hasCF = results.some(r => (r.carry_forward_in || 0) !== 0 || (r.carry_forward_out || 0) !== 0);
  const colCount = hasCF ? 9 : 8;
  const fmt2 = n => n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

  wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="border-bottom:1px solid var(--border2);">
        <th style="text-align:left;padding:8px 10px;color:var(--muted);font-weight:600;">Agent</th>
        <th style="text-align:right;padding:8px 10px;color:var(--muted);font-weight:600;">Earned</th>
        <th style="text-align:right;padding:8px 10px;color:var(--muted);font-weight:600;">Bonus</th>
        <th style="text-align:right;padding:8px 10px;color:var(--muted);font-weight:600;">CB</th>
        ${hasCF ? '<th style="text-align:right;padding:8px 10px;color:var(--muted);font-weight:600;" title="Carry-forward debt applied from prior month">Prior Debt</th>' : ''}
        <th style="text-align:right;padding:8px 10px;color:var(--muted);font-weight:600;">Net</th>
        <th style="text-align:right;padding:8px 10px;color:var(--muted);font-weight:600;">Paid</th>
        <th style="text-align:center;padding:8px 10px;color:var(--muted);font-weight:600;">Status</th>
        <th style="padding:8px 10px;"></th>
      </tr>
    </thead>
    <tbody>
      ${results.map(r => {
        const isPaid  = r.paid?.amount_paid != null;
        const notes   = r.paid?.notes || '';
        const cfIn    = r.carry_forward_in  || 0;
        const cfOut   = r.carry_forward_out || 0;
        // net_earned from API = earned + bonus - CB + carry_forward_in (true net; can be negative)
        const netDisplay = r.net_earned;
        // Default amount for Mark Paid: bank paid_out if available, otherwise max(0, net)
        const defaultPay = r.bank_summary ? r.bank_summary.paid_out : Math.max(0, netDisplay);
        const rowBg = r.recalculated ? 'background:rgba(255,179,0,.06);' : (cfOut < 0 ? 'background:rgba(255,77,109,.04);' : '');
        return `<tr style="border-bottom:1px solid var(--border2);${rowBg}" id="comm-row-${escHtml(r.agent_id)}">
          <td style="padding:8px 10px;">${escHtml(r.name)}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:600;">$${fmt2(r.earned)}</td>
          <td style="padding:8px 10px;text-align:right;color:var(--accent);">${r.bonus_earned > 0 ? '$'+fmt2(r.bonus_earned) : '<span style="color:var(--muted);">—</span>'}</td>
          <td style="padding:8px 10px;text-align:right;">${r.chargeback_total > 0 ? `<span style="color:#ff6b6b;">-$${fmt2(r.chargeback_total)}</span>` : '<span style="color:var(--muted);">—</span>'}</td>
          ${hasCF ? `<td style="padding:8px 10px;text-align:right;">${cfIn < 0 ? `<span style="color:#ff6b6b;" title="Carry-forward from prior month">-$${fmt2(-cfIn)}</span>` : '<span style="color:var(--muted);">—</span>'}</td>` : ''}
          <td style="padding:8px 10px;text-align:right;font-weight:700;${netDisplay < 0 ? 'color:#ff6b6b;' : ''}">
            ${netDisplay < 0
              ? `-$${fmt2(-netDisplay)}<div style="font-size:10px;color:#ff6b6b;font-weight:400;">carries fwd</div>`
              : `$${fmt2(netDisplay)}`}
          </td>
          <td style="padding:8px 10px;text-align:right;">
            ${isPaid
              ? `<div style="font-weight:600;">$${fmt2(parseFloat(r.paid.amount_paid))}</div>
                 ${notes ? `<div style="font-size:10px;color:var(--muted);margin-top:1px;">${escHtml(notes)}</div>` : ''}`
              : `<span style="color:var(--muted);">—</span>`}
          </td>
          <td style="padding:8px 10px;text-align:center;">
            ${r.threshold_note
              ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,179,0,.12);color:#ffb300;cursor:help;" title="${escHtml(r.threshold_note)}">&#x26A0; Min not met</span>`
              : r.cap_total_note
                ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,179,0,.12);color:#ffb300;cursor:help;" title="${escHtml(r.cap_total_note)}">&#x2B06; Capped</span>`
                : r.recalculated
                  ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,179,0,.12);color:#ffb300;">&#x26A0; Recalculated</span>`
                  : cfOut < 0
                    ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:rgba(255,77,109,.12);color:#ff6b6b;" title="$${fmt2(-cfOut)} carries into next month">&#x21B3; CF Debt</span>`
                    : `<span style="font-size:11px;padding:2px 8px;border-radius:20px;${isPaid ? 'background:rgba(0,229,180,.15);color:var(--accent2)' : 'background:rgba(255,255,255,.06);color:var(--muted)'};">${isPaid ? 'Paid' : 'Unpaid'}</span>`}
          </td>
          <td style="padding:8px 10px;display:flex;gap:4px;align-items:center;">
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 9px;" onclick="toggleCommBreakdown('${escHtml(r.agent_id)}')">&darr;</button>
            <button class="btn btn-secondary" style="font-size:11px;padding:3px 9px;" onclick="openPayForm('${escHtml(r.agent_id)}','${escHtml(r.name)}',${defaultPay},'${escHtml(month)}')">${isPaid ? 'Edit' : 'Mark Paid'}</button>
          </td>
        </tr>
        <tr id="comm-breakdown-${escHtml(r.agent_id)}" style="display:none;">
          <td colspan="${colCount}" style="padding:4px 10px 16px 28px;">
            ${r.structure_details ? (() => {
              const fmt = n => '$' + (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
              return r.structure_details.map(sd => {
                const structStatus = sd.blocked_by_qualifier
                  ? `<span style="font-size:10px;background:rgba(255,100,100,.15);color:#ff6b6b;border-radius:4px;padding:1px 6px;margin-left:6px;">Blocked - qualifier not met</span>`
                  : sd.threshold_note
                    ? `<span style="font-size:10px;background:rgba(255,179,0,.15);color:#ffb300;border-radius:4px;padding:1px 6px;margin-left:6px;" title="${escHtml(sd.threshold_note)}">&#x26A0; Min not met</span>`
                    : `<span style="font-size:10px;background:rgba(0,229,180,.1);color:var(--accent2);border-radius:4px;padding:1px 6px;margin-left:6px;">&#x2713; Qualifies</span>`;
                const breakdownTable = sd.breakdown.length ? `<table style="font-size:12px;border-collapse:collapse;margin-bottom:8px;width:100%;">
                  <thead><tr style="border-bottom:1px solid var(--border2);">
                    <th style="text-align:left;padding:3px 8px;color:var(--muted);">Product</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Premium</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Share</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Commission</th>
                  </tr></thead>
                  <tbody>${sd.breakdown.map(b => `<tr>
                    <td style="padding:3px 8px;">${escHtml(b.product)}${b.split ? ` <span style="font-size:10px;color:var(--muted);">(${b.role})</span>` : ''}</td>
                    <td style="padding:3px 8px;text-align:right;">${fmt(b.premium)}</td>
                    <td style="padding:3px 8px;text-align:right;">${fmt(b.share)}</td>
                    <td style="padding:3px 8px;text-align:right;font-weight:600;">${fmt(b.commission)}</td>
                  </tr>`).join('')}</tbody>
                </table>` : '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">No qualifying sales for this structure.</div>';
                const groupTable = sd.group_details ? (() => {
                  const gdRows = sd.group_details.map(g => {
                    const sc = g.passes ? 'var(--accent2)' : '#ff6b6b';
                    return `<tr style="border-bottom:1px solid var(--border2);">
                      <td style="padding:3px 8px;font-weight:600;">${escHtml(g.label)}</td>
                      <td style="padding:3px 8px;text-align:right;">${g.count}</td>
                      <td style="padding:3px 8px;text-align:right;">${fmt(g.earned)}</td>
                      <td style="padding:3px 8px;text-align:right;color:var(--muted);">${g.floor ? '-'+fmt(g.floor)+' floor' : '&#x2014;'}</td>
                      <td style="padding:3px 8px;text-align:right;color:var(--accent);">${g.esc_bonus ? '+'+fmt(g.esc_bonus)+' esc' : '&#x2014;'}</td>
                      <td style="padding:3px 8px;text-align:right;font-weight:700;">${fmt(g.payout)}</td>
                      <td style="padding:3px 8px;text-align:center;color:${sc};">${g.passes ? '&#x2713;' : '&#x2717;'}</td>
                    </tr>`;
                  }).join('');
                  const uRow = (sd.ungrouped_earned != null && sd.ungrouped_earned !== 0)
                    ? `<tr><td colspan="5" style="padding:3px 8px;color:var(--muted);">No-group products</td><td style="padding:3px 8px;text-align:right;font-weight:700;">${fmt(sd.ungrouped_earned)}</td><td></td></tr>` : '';
                  return `<table style="font-size:11px;border-collapse:collapse;width:100%;max-width:500px;">
                    <thead><tr style="border-bottom:1px solid var(--border2);">
                      <th style="text-align:left;padding:3px 8px;color:var(--muted);">Group</th>
                      <th style="text-align:right;padding:3px 8px;color:var(--muted);">Policies</th>
                      <th style="text-align:right;padding:3px 8px;color:var(--muted);">Earned</th>
                      <th style="text-align:right;padding:3px 8px;color:var(--muted);">Floor</th>
                      <th style="text-align:right;padding:3px 8px;color:var(--muted);">Escalator</th>
                      <th style="text-align:right;padding:3px 8px;color:var(--muted);">Payout</th>
                      <th style="padding:3px 8px;"></th>
                    </tr></thead>
                    <tbody>${gdRows}${uRow}</tbody>
                  </table>`;
                })() : '';
                return `<div style="margin-bottom:10px;padding:8px 10px;background:rgba(255,255,255,.02);border-radius:6px;border-left:2px solid var(--border);">
                  <div style="display:flex;align-items:center;margin-bottom:8px;">
                    <span style="font-size:12px;font-weight:700;color:var(--text);">${escHtml(sd.structure_name)}</span>
                    ${structStatus}
                    <span style="margin-left:auto;font-size:13px;font-weight:700;color:${sd.earned > 0 ? 'var(--accent2)' : 'var(--muted)'};">${fmt(sd.earned)}</span>
                  </div>
                  ${breakdownTable}
                  ${groupTable}
                </div>`;
              }).join('');
            })() : (() => {
              const fmt = n => '$' + (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
              return `${r.breakdown.length ? `<table style="font-size:12px;border-collapse:collapse;margin-bottom:10px;">
              <thead><tr style="border-bottom:1px solid var(--border2);">
                <th style="text-align:left;padding:3px 8px;color:var(--muted);">Product</th>
                <th style="text-align:right;padding:3px 8px;color:var(--muted);">Premium</th>
                <th style="text-align:right;padding:3px 8px;color:var(--muted);">Share</th>
                <th style="text-align:right;padding:3px 8px;color:var(--muted);">Rate Commission</th>
              </tr></thead>
              <tbody>${r.breakdown.map(b => `<tr>
                <td style="padding:3px 8px;">${escHtml(b.product)}${b.split ? ` <span style="font-size:10px;color:var(--muted);">(${b.role})</span>` : ''}</td>
                <td style="padding:3px 8px;text-align:right;">$${(b.premium||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                <td style="padding:3px 8px;text-align:right;">$${(b.share||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                <td style="padding:3px 8px;text-align:right;font-weight:600;">$${(b.commission||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
              </tr>`).join('')}</tbody>
            </table>` : '<span style="font-size:12px;color:var(--muted);">No sales this month.</span>'}
            ${r.group_details ? (() => {
              const rows = r.group_details.map(g => {
                const statusColor = g.passes ? 'var(--accent2)' : '#ff6b6b';
                const statusIcon  = g.passes ? '&#x2713;' : '&#x2717;';
                return `<tr style="border-bottom:1px solid var(--border2);">
                  <td style="padding:3px 8px;font-weight:600;">${escHtml(g.label)}</td>
                  <td style="padding:3px 8px;text-align:right;">${g.count}</td>
                  <td style="padding:3px 8px;text-align:right;">${fmt(g.earned)}</td>
                  <td style="padding:3px 8px;text-align:right;color:var(--muted);">${g.floor ? '-'+fmt(g.floor)+' floor' : '&#x2014;'}</td>
                  <td style="padding:3px 8px;text-align:right;color:var(--accent);">${g.esc_bonus ? '+'+fmt(g.esc_bonus)+' esc' : '&#x2014;'}</td>
                  <td style="padding:3px 8px;text-align:right;font-weight:700;">${fmt(g.payout)}</td>
                  <td style="padding:3px 8px;text-align:center;color:${statusColor};">${statusIcon}</td>
                </tr>`;
              }).join('');
              const ungroupedRow = (r.ungrouped_earned != null && r.ungrouped_earned !== 0)
                ? `<tr><td style="padding:3px 8px;color:var(--muted);" colspan="5">No-group products</td><td style="padding:3px 8px;text-align:right;font-weight:700;">${fmt(r.ungrouped_earned)}</td><td></td></tr>` : '';
              return `<div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em;">Threshold Groups</div>
                <table style="font-size:12px;border-collapse:collapse;width:100%;max-width:520px;">
                  <thead><tr style="border-bottom:1px solid var(--border2);">
                    <th style="text-align:left;padding:3px 8px;color:var(--muted);">Group</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Policies</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Earned</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Floor</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Escalator</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Payout</th>
                    <th style="padding:3px 8px;"></th>
                  </tr></thead>
                  <tbody>${rows}${ungroupedRow}</tbody>
                </table>`;
            })() : ''}`;
            })()}
            ${r.bank_summary ? (() => {
              const bs  = r.bank_summary;
              const fmt = n => '$' + (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
              const items = [
                ['Bank Balance (start)', fmt(bs.balance_before)],
                bs.interest > 0 ? ['Interest', `+${fmt(bs.interest)}`] : null,
                bs.banked   > 0 ? ['Banked this month', `+${fmt(bs.banked)}`] : null,
                bs.drawdown > 0 ? ['Drawn from bank', `-${fmt(bs.drawdown)}`] : null,
                ['Paid Out', `<strong>${fmt(bs.paid_out)}</strong>`],
                ['Bank Balance (end)', `<strong>${fmt(bs.balance_after)}</strong>`],
              ].filter(Boolean);
              return `<div style="margin-top:10px;padding:8px 10px;background:rgba(123,97,255,.06);border:1px solid rgba(123,97,255,.2);border-radius:6px;">
                <div style="font-size:11px;font-weight:700;color:#7b61ff;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Commission Bank${bs.cap != null ? ` — Cap ${fmt(bs.cap)}/mo` : ''}</div>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 16px;font-size:12px;">
                  ${items.map(([k,v]) => `<span style="color:var(--muted);">${k}</span><span style="text-align:right;">${v}</span>`).join('')}
                </div>
              </div>`;
            })() : ''}
            ${(r.chargebacks && r.chargebacks.length) ? (() => {
              const fmt = n => '$' + (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
              return `<div style="margin-top:10px;padding:8px;background:rgba(255,107,107,.05);border:1px solid rgba(255,107,107,.15);border-radius:6px;">
                <div style="font-size:11px;font-weight:700;color:#ff6b6b;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Chargebacks This Month</div>
                <table style="font-size:12px;border-collapse:collapse;width:100%;">
                  <thead><tr style="border-bottom:1px solid rgba(255,107,107,.2);">
                    <th style="text-align:left;padding:3px 8px;color:var(--muted);">Product</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Premium</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Share</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">Commission</th>
                    <th style="text-align:right;padding:3px 8px;color:var(--muted);">CB Date</th>
                  </tr></thead>
                  <tbody>${r.chargebacks.map(cb => `<tr style="border-bottom:1px solid rgba(255,107,107,.1);">
                    <td style="padding:3px 8px;">${escHtml(cb.product)}</td>
                    <td style="padding:3px 8px;text-align:right;">${fmt(cb.premium)}</td>
                    <td style="padding:3px 8px;text-align:right;">${fmt(cb.share)}</td>
                    <td style="padding:3px 8px;text-align:right;color:#ff6b6b;font-weight:600;">-${fmt(cb.commission)}</td>
                    <td style="padding:3px 8px;text-align:right;color:var(--muted);">${escHtml(cb.chargeback_date)}</td>
                  </tr>`).join('')}</tbody>
                </table>
              </div>`;
            })() : ''}
            ${((r.carry_forward_in || 0) < 0 || (r.carry_forward_out || 0) < 0) ? (() => {
              const fmt = n => '$' + Math.abs(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
              const cfIn  = r.carry_forward_in  || 0;
              const cfOut = r.carry_forward_out || 0;
              const rows = [];
              if (cfIn < 0) rows.push(`<tr><td style="padding:3px 8px;color:var(--muted);">Prior debt applied</td><td style="padding:3px 8px;text-align:right;color:#ff6b6b;">-${fmt(cfIn)}</td></tr>`);
              if (cfOut < 0) rows.push(`<tr><td style="padding:3px 8px;color:var(--muted);">Carries into next month</td><td style="padding:3px 8px;text-align:right;color:#ff6b6b;font-weight:600;">-${fmt(cfOut)}</td></tr>`);
              return `<div style="margin-top:10px;padding:8px 10px;background:rgba(255,77,109,.05);border:1px solid rgba(255,77,109,.2);border-radius:6px;">
                <div style="font-size:11px;font-weight:700;color:#ff6b6b;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em;">Carry-Forward</div>
                <table style="font-size:12px;border-collapse:collapse;width:100%;max-width:320px;">${rows.join('')}</table>
              </div>`;
            })() : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
  // Auto-save carry-forward debts so next month's calculation picks them up
  _autoSaveCarryForwards(results, month);
}

async function _autoSaveCarryForwards(results, month) {
  for (const r of results) {
    const cfOut = r.carry_forward_out || 0;
    if (cfOut === 0) continue;               // nothing to carry forward
    if (r.paid?.amount_paid != null) continue; // Mark Paid already saved the bank entry
    // Build a bank entry representing the carry-forward debt
    let bankEntry = r.bank_summary ? { ...r.bank_summary } : {
      earned:          (r.earned || 0) + (r.bonus_earned || 0) - (r.chargeback_total || 0),
      cap:             null,
      paid_out:        Math.max(0, r.net_earned || 0),
      banked:          0,
      interest:        0,
      balance_before:  r.carry_forward_in || 0,
      balance_after:   cfOut,
      drawdown:        0,
    };
    // For bank accounts ensure balance_after reflects the carry-forward debt
    if (r.bank_summary && cfOut < 0) bankEntry.balance_after = cfOut;
    fetch('/api/commissions', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: r.agent_id, month, amountPaid: null, bankEntry }),
    }).catch(() => {});
  }
}

function toggleCommBreakdown(agentId) {
  const row = document.getElementById('comm-breakdown-' + agentId);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

function openPayForm(agentId, agentName, earned, month) {
  // Find bank_summary (or carry-forward data) for this agent from last loaded commission data
  const agentRow = (_commData?.results || []).find(r => r.agent_id === agentId);
  let bankSummary = agentRow?.bank_summary || null;
  // For non-bank accounts with carry-forward, build a synthetic bank entry so it persists
  if (!bankSummary && agentRow && ((agentRow.carry_forward_in || 0) !== 0 || (agentRow.carry_forward_out || 0) !== 0)) {
    bankSummary = {
      earned:         (agentRow.earned || 0) + (agentRow.bonus_earned || 0) - (agentRow.chargeback_total || 0),
      cap:            null,
      paid_out:       Math.max(0, agentRow.net_earned || 0),
      banked:         0,
      interest:       0,
      balance_before: agentRow.carry_forward_in  || 0,
      balance_after:  agentRow.carry_forward_out || 0,
      drawdown:       0,
    };
  }
  const container = document.getElementById('comm-pay-modal');
  if (!container) return;
  const existing = _commPayments[agentId] || null;
  const paid = existing?.amount_paid != null;
  container.style.display = '';
  container.innerHTML = `
    <div class="panel" style="margin-top:1rem;border:1px solid var(--border);border-radius:10px;padding:1rem;">
      <div style="font-size:13px;font-weight:700;margin-bottom:.75rem;">Record Payment — ${escHtml(agentName)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem;margin-bottom:.75rem;">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">AMOUNT PAID</label>
          <input id="pay-amount" type="number" min="0" step="0.01" value="${paid ? existing.amount_paid : earned}" style="width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:13px;outline:none;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PAID DATE</label>
          <input id="pay-date" type="date" value="${paid ? (existing.paid_date || '') : new Date().toISOString().slice(0,10)}" style="width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:13px;outline:none;box-sizing:border-box;">
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">NOTES</label>
          <input id="pay-notes" type="text" value="${paid ? escHtml(existing.notes || '') : ''}" style="width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:13px;outline:none;box-sizing:border-box;">
        </div>
      </div>
      <div id="pay-msg" style="font-size:12px;margin-bottom:.5rem;display:none;"></div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" style="font-size:13px;" onclick="saveCommissionPayment('${escHtml(agentId)}','${escHtml(month)}',this,${bankSummary ? `'${escHtml(JSON.stringify(bankSummary))}'` : 'null'})">Save</button>
        <button class="btn btn-secondary" style="font-size:13px;" onclick="document.getElementById('comm-pay-modal').style.display='none'">Cancel</button>
      </div>
    </div>`;
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function saveCommissionPayment(agentId, month, btn, bankSummaryJson) {
  const amountPaid = parseFloat(document.getElementById('pay-amount')?.value);
  const paidDate   = document.getElementById('pay-date')?.value || null;
  const notes      = document.getElementById('pay-notes')?.value || null;
  if (isNaN(amountPaid) || amountPaid < 0) { showInlineMsg('pay-msg', 'Enter a valid amount.', 'err'); return; }
  btn.disabled = true;
  let bankEntry = null;
  if (bankSummaryJson) {
    try { bankEntry = JSON.parse(bankSummaryJson); } catch(_) {}
  }
  try {
    const r = await fetch('/api/commissions', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, month, amountPaid, paidDate, notes, bankEntry }),
    });
    if (!r.ok) { const d = await r.json(); showInlineMsg('pay-msg', d.error || 'Error', 'err'); return; }
    document.getElementById('comm-pay-modal').style.display = 'none';
    await loadCommissions();
  } catch(e) { showInlineMsg('pay-msg', e.message, 'err'); }
  finally { btn.disabled = false; }
}

// ── WHAT-IF CALCULATOR ─────────────────────────────────────────────────────────

function wiAddRow() {
  const container = document.getElementById('wi-rows-container');
  if (!container) return;
  const rowId = 'wi-row-' + Date.now();
  const opts = csProducts().map(p => `<option value="${escHtml(p.key)}">${escHtml(p.label)}</option>`).join('');
  const div = document.createElement('div');
  div.id = rowId;
  div.className = 'wi-product-row';
  div.style.cssText = 'display:grid;grid-template-columns:1fr 70px 1fr auto;gap:.5rem;margin-bottom:.5rem;align-items:end;';
  div.innerHTML = `
    <div>
      <label style="font-size:10px;color:var(--muted);display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em;">Product</label>
      <select class="wi-row-product" style="width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 10px;font-size:13px;outline:none;">${opts}</select>
    </div>
    <div>
      <label style="font-size:10px;color:var(--muted);display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em;">Qty</label>
      <input type="number" class="wi-row-qty" min="1" value="1" style="width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 6px;font-size:13px;outline:none;box-sizing:border-box;">
    </div>
    <div>
      <label style="font-size:10px;color:var(--muted);display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:.04em;">Premium ea</label>
      <input type="number" class="wi-row-premium" min="0" step="0.01" placeholder="0.00" style="width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 10px;font-size:13px;outline:none;box-sizing:border-box;">
    </div>
    <button onclick="wiRemoveRow('${rowId}')" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0 4px;line-height:1;" title="Remove">×</button>`;
  container.appendChild(div);
  _wiSyncRemoveButtons();
}

function wiRemoveRow(rowId) {
  const el = document.getElementById(rowId);
  if (el) el.remove();
  _wiSyncRemoveButtons();
}

function _wiSyncRemoveButtons() {
  const rows = document.querySelectorAll('.wi-product-row');
  rows.forEach(r => {
    const btn = r.querySelector('button');
    if (btn) btn.style.visibility = rows.length > 1 ? '' : 'hidden';
  });
}

function wiToggleSplit() {
  const show = document.getElementById('wi-split')?.checked;
  const row  = document.getElementById('wi-split-row');
  if (row) row.style.display = show ? '' : 'none';
}

function populateWhatIfProducts() {
  const container = document.getElementById('wi-rows-container');
  if (!container) return;
  if (!container.children.length) wiAddRow();
}

function calcWhatIf() {
  const isSplit  = document.getElementById('wi-split')?.checked || false;
  const ratioPct = parseFloat(document.getElementById('wi-ratio')?.value) || 50;
  const ratio    = isSplit ? ratioPct / 100 : 1;
  const resultEl = document.getElementById('wi-result');
  if (!resultEl) return;

  let structure = null;
  if (_commissionStructures.length > 0) structure = _commissionStructures[0];

  if (!structure) {
    resultEl.style.display = '';
    resultEl.style.color = 'var(--muted)';
    resultEl.innerHTML = 'No commission structure assigned yet.';
    return;
  }

  const rows = document.querySelectorAll('.wi-product-row');
  if (!rows.length) {
    resultEl.style.display = '';
    resultEl.style.color = 'var(--muted)';
    resultEl.innerHTML = 'Add at least one product row.';
    return;
  }

  // Aggregate total premium per product across all rows
  const premByProduct = {};
  const qtyByProduct  = {};
  rows.forEach(row => {
    const product = row.querySelector('.wi-row-product')?.value;
    const qty     = Math.max(1, parseFloat(row.querySelector('.wi-row-qty')?.value) || 1);
    const premEa  = parseFloat(row.querySelector('.wi-row-premium')?.value) || 0;
    if (product) {
      premByProduct[product] = (premByProduct[product] || 0) + qty * premEa;
      qtyByProduct[product]  = (qtyByProduct[product]  || 0) + qty;
    }
  });

  const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let grandTotal = 0;
  const breakdown = [];

  for (const [product, totalPrem] of Object.entries(premByProduct)) {
    const share      = totalPrem * ratio;
    const rateConfig = structure.rates?.[product];
    let commission   = 0;
    if (rateConfig && rateConfig.type && rateConfig.type !== 'none') {
      if (rateConfig.type === 'percent') commission = share * (rateConfig.rate / 100);
      else commission = (rateConfig.rate || 0) * (qtyByProduct[product] || 1);
    }
    grandTotal += commission;
    breakdown.push({ product, totalPrem, share, commission });
  }

  const splitNote    = isSplit ? ` <span style="font-size:12px;color:var(--muted);font-weight:400;">(${ratioPct}% share)</span>` : '';
  const breakdownHtml = breakdown.map(b => {
    const productLabel = csProducts().find(p => p.key === b.product)?.label || b.product;
    const shareStr     = isSplit ? ` → $${fmt(b.share)} share` : '';
    return `<div style="font-size:12px;color:var(--muted);font-weight:400;margin-top:2px;">
      ${escHtml(productLabel)}: $${fmt(b.totalPrem)} prem${shareStr} → <span style="color:var(--accent2);">$${fmt(b.commission)}</span></div>`;
  }).join('');

  resultEl.style.display = '';
  resultEl.style.color   = 'var(--accent2)';
  resultEl.innerHTML = `Estimated: <strong>$${fmt(grandTotal)}</strong>${splitNote}
    <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border2);">
      ${breakdownHtml}
      <div style="font-size:11px;color:var(--muted);margin-top:5px;">Based on "${escHtml(structure.name)}"</div>
    </div>`;
}

async function addAgentToRoster(btn) {
  const input = document.getElementById('new-agent-name');
  const name = (input?.value || '').trim();
  if (!name) return showInlineMsg('agent-roster-msg', 'Enter a name', 'err');
  btn.disabled = true;
  try {
    const r = await fetch('/api/agent-roster', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const d = await r.json();
    if (!r.ok) { showInlineMsg('agent-roster-msg', d.error || 'Error', 'err'); return; }
    _agentRoster.push(d);
    _agentRoster.sort((a, b) => a.name.localeCompare(b.name));
    input.value = '';
    renderAgentRoster();
    refreshAgentDropdowns();
  } catch(e) { showInlineMsg('agent-roster-msg', e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function toggleAgentRoster(id, active) {
  await fetch('/api/agent-roster', { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ id, active }) });
  const a = _agentRoster.find(a => a.id === id);
  if (a) a.active = active;
}

async function deleteAgentRoster(id, btn) {
  btn.disabled = true;
  const r = await fetch(`/api/agent-roster?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
  if (r.ok) {
    _agentRoster = _agentRoster.filter(a => a.id !== id);
    renderAgentRoster();
    refreshAgentDropdowns();
  } else { btn.disabled = false; }
}

function refreshManualRowLocations() {
  const activeLocs = _salesLocations.filter(l => l.active !== false);
  const hasLocs    = activeLocs.length > 0;
  const optsHtml   = '<option value="">— optional —</option>' +
    activeLocs.map(l => `<option value="${escHtml(l.name)}">${escHtml(l.name)}</option>`).join('');
  document.querySelectorAll('#manual-sales-rows .manual-sale-row').forEach(row => {
    const existingSel = row.querySelector('.msr-location');
    const row2Grid    = Array.from(row.querySelectorAll('div')).find(d => d.querySelector('.msr-date'));
    if (!row2Grid) return;
    if (hasLocs && !existingSel) {
      row2Grid.style.gridTemplateColumns = '1fr 1fr 1fr 1fr 1fr 1fr';
      const div = document.createElement('div');
      div.innerHTML = `<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">LOCATION</label><select class="msr-location" style="${msrSelectStyle()}">${optsHtml}</select>`;
      row2Grid.appendChild(div);
    } else if (hasLocs && existingSel) {
      const cur = existingSel.value;
      existingSel.innerHTML = optsHtml;
      existingSel.value = cur;
    } else if (!hasLocs && existingSel) {
      existingSel.closest('div').remove();
      row2Grid.style.gridTemplateColumns = '1fr 1fr 1fr 1fr 1fr';
    }
  });
}

function _locInputSt() {
  return 'width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 8px;font-size:13px;outline:none;';
}

function renderLocationsList() {
  const container = document.getElementById('locations-list');
  if (!container) return;
  if (!_salesLocations.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--muted);margin-bottom:.5rem;">No locations added yet.</div>';
    return;
  }
  container.innerHTML = _salesLocations.map(l => {
    const safeId = escHtml(l.id);
    const summary = [l.address, l.phone, l.hours].filter(Boolean).join(' · ');
    return `<div style="background:var(--card2);border:1px solid var(--border2);border-radius:8px;padding:.65rem .75rem;margin-bottom:.5rem;">
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" ${l.active !== false ? 'checked' : ''} onchange="toggleLocation('${safeId}',this.checked)" title="Active in dropdowns">
        <span style="font-size:13px;font-weight:600;flex:1;">${escHtml(l.name)}</span>
        ${summary ? `<span style="font-size:11px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(summary)}</span>` : ''}
        <button class="btn btn-secondary" style="padding:2px 9px;font-size:11px;" onclick="toggleLocationEdit('${safeId}')">Edit</button>
        <button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" onclick="deleteLocation('${safeId}',this)">✕</button>
      </div>
      <div id="loc-edit-${safeId}" style="display:none;margin-top:.65rem;padding-top:.65rem;border-top:1px solid var(--border2);">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem;">
          <div><label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Address</label>
            <input id="loc-addr-${safeId}" type="text" value="${escHtml(l.address||'')}" placeholder="123 Main St, City, ST" style="${_locInputSt()}"></div>
          <div><label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Phone</label>
            <input id="loc-phone-${safeId}" type="tel" value="${escHtml(l.phone||'')}" placeholder="(503) 657-6690" style="${_locInputSt()}"></div>
        </div>
        <div style="margin-bottom:.5rem;"><label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Hours</label>
          <input id="loc-hours-${safeId}" type="text" value="${escHtml(l.hours||'')}" placeholder="Mon–Fri, 9 AM – 5:30 PM" style="${_locInputSt()}"></div>
        <div style="margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--border2);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:.4rem;">
            <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Office Goals</span>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;user-select:none;">
              <input type="checkbox" id="loc-goals-enabled-${safeId}" ${l.goals_enabled ? 'checked' : ''} onchange="toggleLocationGoals('${safeId}',this.checked)">
              Enabled
            </label>
          </div>
          <div id="loc-goals-fields-${safeId}" style="display:${l.goals_enabled ? '' : 'none'}">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem;">
              <div><label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Monthly Policy Goal</label>
                <input id="loc-goal-count-${safeId}" type="number" min="0" value="${l.goal_count||''}" placeholder="e.g. 50" style="${_locInputSt()}"></div>
              <div><label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Monthly Premium Goal ($)</label>
                <input id="loc-goal-prem-${safeId}" type="number" min="0" value="${l.goal_premium||''}" placeholder="e.g. 100000" style="${_locInputSt()}"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem;">
              <div><label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Annual Policy Goal</label>
                <input id="loc-goal-count-ann-${safeId}" type="number" min="0" value="${l.goal_count_annual||''}" placeholder="e.g. 600" style="${_locInputSt()}"></div>
              <div><label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Annual Premium Goal ($)</label>
                <input id="loc-goal-prem-ann-${safeId}" type="number" min="0" value="${l.goal_premium_annual||''}" placeholder="e.g. 1200000" style="${_locInputSt()}"></div>
            </div>
            ${(() => {
              const PKEYS = ['wl','ul','term','health','auto','fire'];
              const prods = activeCats().filter(c => PKEYS.includes(c.key));
              if (!prods.length) return '';
              const moGoals  = l.product_goals_monthly || {};
              const annGoals = l.product_goals_annual  || {};
              const inputGrid = (prefix, goals) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:.4rem;">${
                prods.map(c => `<div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">${escHtml(c.label)}</label>
                  <input id="loc-pg-${prefix}-${safeId}-${c.key}" type="number" min="0" value="${goals[c.key]||''}" placeholder="—" style="${_locInputSt()}"></div>`).join('')
              }</div>`;
              return `<div style="padding-top:.4rem;border-top:1px solid var(--border2);margin-bottom:.5rem;">
                <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.35rem;">Monthly Product Goals</div>
                ${inputGrid('mo', moGoals)}
              </div>
              <div style="margin-bottom:.5rem;">
                <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.35rem;">Annual Product Goals</div>
                ${inputGrid('ann', annGoals)}
              </div>`;
            })()}
            <div style="margin-bottom:.5rem;">
              <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.35rem;">Visible in Goals Tab to</div>
              <div style="display:flex;flex-wrap:wrap;gap:.5rem;">${(() => {
                const vis = l.goals_visibility || ['all'];
                return [['all','Everyone'],['captain','Captain'],['chief_officer','Chief Officer'],['bosun','Bosun'],['custom','Custom']].map(([val, lbl]) =>
                  `<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;white-space:nowrap;">
                    <input type="checkbox" class="loc-vis-${safeId}" value="${val}" ${vis.includes(val) ? 'checked' : ''} onchange="onLocVisChange('${safeId}')">
                    ${lbl}</label>`
                ).join('');
              })()}</div>
            </div>
            <div id="loc-act-goals-${safeId}" style="margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--border2);">
              <div style="font-size:11px;color:var(--muted);margin-bottom:.4rem;">Activity Goals (per month)</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.4rem;">
                ${_activityTypes.filter(at => at.active !== false).map(at => {
                  const currentGoal = (l.activity_goals || {})[at.id] || '';
                  return `<div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:2px;">${escHtml(at.name)}</label>
                    <input id="loc-act-goal-${safeId}-${escHtml(at.id)}" type="number" min="0" value="${currentGoal}" placeholder="—" style="${_locInputSt()}"></div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="saveLocationDetails('${safeId}',this)">Save</button>
          <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="toggleLocationEdit('${safeId}')">Cancel</button>
          <span id="loc-save-msg-${safeId}" style="font-size:12px;display:none;"></span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleLocationEdit(id) {
  const el = document.getElementById('loc-edit-' + id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function toggleLocationGoals(id, enabled) {
  const fields = document.getElementById('loc-goals-fields-' + id);
  if (fields) fields.style.display = enabled ? '' : 'none';
  const loc = _salesLocations.find(l => l.id === id);
  if (loc) loc.goals_enabled = enabled;
  await fetch('/api/checklist-config', {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationUpdates: [{ action: 'update_goals_enabled', id, goals_enabled: enabled }] }),
  });
}

function onLocVisChange(id) {
  const boxes = [...document.querySelectorAll(`.loc-vis-${id}`)];
  const allBox = boxes.find(b => b.value === 'all');
  if (allBox?.checked) {
    boxes.filter(b => b.value !== 'all').forEach(b => { b.checked = false; });
  } else {
    if (allBox) allBox.checked = false;
  }
}

async function saveLocationDetails(id, btn) {
  const address    = (document.getElementById('loc-addr-' + id)?.value  || '').trim();
  const phone      = (document.getElementById('loc-phone-' + id)?.value || '').trim();
  const hours      = (document.getElementById('loc-hours-' + id)?.value || '').trim();
  const goal_count         = document.getElementById('loc-goal-count-' + id)?.value     || null;
  const goal_premium       = document.getElementById('loc-goal-prem-' + id)?.value      || null;
  const goal_count_annual  = document.getElementById('loc-goal-count-ann-' + id)?.value || null;
  const goal_premium_annual= document.getElementById('loc-goal-prem-ann-' + id)?.value  || null;
  const visBoxes = [...document.querySelectorAll(`.loc-vis-${id}:checked`)].map(b => b.value);
  const goals_visibility = visBoxes.length ? visBoxes : ['all'];
  const PKEYS = ['wl','ul','term','health','auto','fire'];
  const policyProds = activeCats().filter(c => PKEYS.includes(c.key));
  const product_goals_monthly = {}, product_goals_annual = {};
  policyProds.forEach(c => {
    const mv = document.getElementById(`loc-pg-mo-${id}-${c.key}`)?.value;
    if (mv && parseFloat(mv) > 0) product_goals_monthly[c.key] = parseFloat(mv);
    const av = document.getElementById(`loc-pg-ann-${id}-${c.key}`)?.value;
    if (av && parseFloat(av) > 0) product_goals_annual[c.key] = parseFloat(av);
  });
  const actGoals = {};
  (_activityTypes || []).filter(at => at.active !== false).forEach(at => {
    const v = document.getElementById(`loc-act-goal-${id}-${at.id}`)?.value;
    if (v && parseFloat(v) > 0) actGoals[at.id] = parseFloat(v);
  });
  btn.disabled = true;
  try {
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationUpdates: [{ action: 'update_details', id, address, phone, hours, goal_count, goal_premium, goal_count_annual, goal_premium_annual, goals_visibility, product_goals_monthly, product_goals_annual, activity_goals: actGoals }] }),
    });
    const loc = _salesLocations.find(l => l.id === id);
    if (loc) { loc.address = address; loc.phone = phone; loc.hours = hours; loc.goal_count = goal_count ? parseInt(goal_count) : null; loc.goal_premium = goal_premium ? parseFloat(goal_premium) : null; loc.goal_count_annual = goal_count_annual ? parseInt(goal_count_annual) : null; loc.goal_premium_annual = goal_premium_annual ? parseFloat(goal_premium_annual) : null; loc.goals_visibility = goals_visibility; loc.product_goals_monthly = product_goals_monthly; loc.product_goals_annual = product_goals_annual; loc.activity_goals = actGoals; }
    const msgEl = document.getElementById('loc-save-msg-' + id);
    if (msgEl) {
      msgEl.textContent = r.ok ? 'Saved' : 'Error saving';
      msgEl.style.color = r.ok ? 'var(--accent2)' : '#e74c3c';
      msgEl.style.display = '';
      setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 2000);
    }
    if (r.ok) renderLocationsList();
  } finally { btn.disabled = false; }
}

async function addLocation(btn) {
  const input = document.getElementById('new-location-name');
  const name  = (input?.value || '').trim();
  if (!name) return showInlineMsg('location-msg', 'Enter a location name', 'err');
  btn.disabled = true;
  try {
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationUpdates: [{ action: 'add', name, sort_order: _salesLocations.length }] })
    });
    if (!r.ok) { showInlineMsg('location-msg', 'Failed to add', 'err'); return; }
    const fresh = await fetch('/api/checklist-config', { headers: authHeaders() });
    const d     = await fresh.json();
    _salesLocations = d.locations || [];
    renderLocationsList();
    refreshManualRowLocations();
    input.value = '';
    showInlineMsg('location-msg', 'Location added', 'ok');
  } catch(e) { showInlineMsg('location-msg', e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function toggleLocation(id, active) {
  await fetch('/api/checklist-config', {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationUpdates: [{ action: 'toggle', id, active }] })
  });
  const loc = _salesLocations.find(l => l.id === id);
  if (loc) loc.active = active;
  refreshManualRowLocations();
}

async function deleteLocation(id, btn) {
  btn.disabled = true;
  try {
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationUpdates: [{ action: 'delete', id }] })
    });
    if (r.ok) {
      _salesLocations = _salesLocations.filter(l => l.id !== id);
      renderLocationsList();
      refreshManualRowLocations();
    }
  } finally { btn.disabled = false; }
}

function renderFormItemsConfig() {
  const container = document.getElementById('form-items-config');
  if (!container) return;
  const saved = (_checklistEmailCfg || {}).form_items || {};
  const rf    = (_checklistEmailCfg || {}).required_fields || DEFAULT_REQUIRED_FIELDS;

  const inputStyle = 'width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 10px;font-size:13px;outline:none;';
  const taStyle    = inputStyle + 'resize:vertical;padding:8px 10px;';
  const chkStyle   = 'width:14px;height:14px;accent-color:var(--accent);cursor:pointer;';
  const lblStyle   = 'display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;white-space:nowrap;';
  const secLblStyle = 'font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:4px;';

  container.innerHTML = FORM_ITEM_DEFS.map(({ key, label, editable }) => {
    const cur = Object.assign({}, DEFAULT_FORM_ITEMS[key] || {}, saved[key] || {});
    const isWfolder = key === 'wfolder';
    const norm = v => v === true ? 'and' : (v || '');
    const selStyle = 'font-size:11px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:2px 4px;outline:none;cursor:pointer;';
    const opt = (val, cur) => `<option value="${val}" ${norm(cur)===val?'selected':''}>${val.toUpperCase()}</option>`;
    const secToggles = isWfolder ? '' : `
      <div style="margin-top:.6rem;padding:.5rem .6rem;background:var(--card2);border:1px solid var(--border2);border-radius:6px;">
        <div style="${secLblStyle}">When Applied, also require: <span style="font-weight:400;font-size:10px;">(AND = required alongside others; OR = satisfies requirement on its own)</span></div>
        <div style="display:grid;grid-template-columns:auto auto 1fr auto auto 1fr;gap:.3rem .5rem;align-items:center;margin-top:.35rem;">
          <select id="fi-rsubmit-${key}" style="${selStyle}"><option value="">Off</option>${opt('and',cur.req_submitted)}${opt('or',cur.req_submitted)}</select>
          <span style="font-size:12px;">Submitted</span><span></span>
          <select id="fi-rnotify-${key}" style="${selStyle}"><option value="">Off</option>${opt('and',cur.req_notified)}${opt('or',cur.req_notified)}</select>
          <span style="font-size:12px;">Customer Notified</span><span></span>
          <select id="fi-rwfi-${key}"    style="${selStyle}"><option value="">Off</option>${opt('and',cur.req_wfi)}${opt('or',cur.req_wfi)}</select>
          <span style="font-size:12px;">Task Created</span><span></span>
          <select id="fi-rdate-${key}"   style="${selStyle}"><option value="">Off</option>${opt('and',cur.req_notif_date)}${opt('or',cur.req_notif_date)}</select>
          <span style="font-size:12px;">Notification Date</span><span></span>
        </div>
      </div>`;

    return `<div style="border:1px solid var(--border2);border-radius:8px;margin-bottom:.4rem;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:8px;padding:.55rem .75rem;background:var(--card2);cursor:pointer;" onclick="toggleFiPanel('${key}')">
        <span style="font-family:monospace;font-size:12px;background:var(--deep);border:1px solid var(--border);border-radius:4px;padding:1px 6px;white-space:nowrap;">${escHtml(key)}</span>
        ${editable
          ? `<input id="fi-label-${key}" type="text" value="${escHtml(cur.label||'')}" placeholder="Custom label..." onclick="event.stopPropagation()" style="font-size:13px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 8px;outline:none;flex:1;max-width:200px;">`
          : `<span style="font-size:13px;color:var(--text);">${escHtml(label)}</span>`}
        <label style="${lblStyle};margin-left:auto;" onclick="event.stopPropagation()">
          <input type="checkbox" id="fi-show-${key}" ${cur.show !== false ? 'checked':''} style="${chkStyle}"> Show
        </label>
        <label style="${lblStyle}" onclick="event.stopPropagation()">
          <input type="checkbox" id="fi-req-${key}" ${cur.required ? 'checked':''} style="${chkStyle}"> Required
        </label>
        <span id="fi-arrow-${key}" style="color:var(--muted);font-size:12px;margin-left:2px;">▾</span>
      </div>
      <div id="fi-panel-${key}" style="display:none;padding:.75rem;border-top:1px solid var(--border2);">
        <!-- English fields -->
        <div class="fi-lang-block fi-lang-en">
          <div style="margin-bottom:.5rem;">
            <label style="${secLblStyle}">EMAIL TITLE <span style="font-weight:400;">(heading shown in customer email when Applied)</span></label>
            <input id="fi-title-${key}" type="text" value="${escHtml(cur.title||'')}" placeholder="${escHtml(label)}" style="${inputStyle}">
          </div>
          <div style="margin-bottom:.5rem;">
            <label style="${secLblStyle}">DESCRIPTION <span style="font-weight:400;">(body text — leave blank to omit section from email)</span></label>
            <textarea id="fi-desc-${key}" rows="3" style="${taStyle}">${escHtml(cur.description||'')}</textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:.5rem;margin-bottom:.25rem;">
            <div><label style="${secLblStyle}">LINK LABEL</label>
              <input id="fi-link-label-${key}" type="text" value="${escHtml(cur.link_label||'')}" style="${inputStyle}"></div>
            <div><label style="${secLblStyle}">LINK URL</label>
              <input id="fi-link-url-${key}" type="url" value="${escHtml(cur.link_url||'')}" placeholder="https://..." style="${inputStyle}"></div>
          </div>
        </div>
        <!-- Spanish fields -->
        <div class="fi-lang-block fi-lang-es" style="display:none;">
          <div style="font-size:11px;color:var(--muted);margin-bottom:.5rem;">Leave blank to fall back to the English text for this item.</div>
          <div style="margin-bottom:.5rem;">
            <label style="${secLblStyle}">TÍTULO EN CORREO <span style="font-weight:400;">(encabezado en correo cuando se aplica)</span></label>
            <input id="fi-title-es-${key}" type="text" value="${escHtml(cur.title_es||'')}" placeholder="${escHtml(cur.title||label)}" style="${inputStyle}">
          </div>
          <div style="margin-bottom:.5rem;">
            <label style="${secLblStyle}">DESCRIPCIÓN <span style="font-weight:400;">(texto del cuerpo — dejar vacío omite la sección)</span></label>
            <textarea id="fi-desc-es-${key}" rows="3" style="${taStyle}">${escHtml(cur.description_es||'')}</textarea>
          </div>
          <div style="margin-bottom:.25rem;">
            <label style="${secLblStyle}">ETIQUETA DE ENLACE <span style="font-weight:400;">(URL del enlace es el mismo para ambos idiomas)</span></label>
            <input id="fi-link-label-es-${key}" type="text" value="${escHtml(cur.link_label_es||'')}" placeholder="${escHtml(cur.link_label||'')}" style="${inputStyle}">
          </div>
        </div>
        ${secToggles}
      </div>
    </div>`;
  }).join('');

  // Load required fields toggles
  const rfMap = { 'req-appt-date': 'appt_date', 'req-appt-time': 'appt_time', 'req-meeting-type': 'meeting_type', 'req-location': 'location' };
  Object.entries(rfMap).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el) el.checked = rf[key] !== undefined ? rf[key] : DEFAULT_REQUIRED_FIELDS[key];
  });
}

function toggleFiPanel(key) {
  const panel = document.getElementById('fi-panel-' + key);
  const arrow = document.getElementById('fi-arrow-' + key);
  if (!panel) return;
  const open = panel.style.display === 'none';
  panel.style.display = open ? '' : 'none';
  if (arrow) arrow.textContent = open ? '▴' : '▾';
}

let _fiLang = 'en';
function fiSetLang(lang) {
  _fiLang = lang;
  document.querySelectorAll('.fi-lang-en').forEach(el => el.style.display = lang === 'en' ? '' : 'none');
  document.querySelectorAll('.fi-lang-es').forEach(el => el.style.display = lang === 'es' ? '' : 'none');
  const enBtn = document.getElementById('fi-lang-btn-en');
  const esBtn = document.getElementById('fi-lang-btn-es');
  if (enBtn) { enBtn.style.background = lang === 'en' ? 'var(--accent)' : 'transparent'; enBtn.style.color = lang === 'en' ? '#000' : 'var(--muted)'; }
  if (esBtn) { esBtn.style.background = lang === 'es' ? 'var(--accent2)' : 'transparent'; esBtn.style.color = lang === 'es' ? '#fff' : 'var(--muted)'; }
}

async function saveFormItems(btn) {
  btn.disabled = true;
  try {
    const form_items = {};
    FORM_ITEM_DEFS.forEach(({ key, editable }) => {
      const isWfolder = key === 'wfolder';
      const item = {
        show:          document.getElementById('fi-show-' + key)?.checked            ?? true,
        required:      document.getElementById('fi-req-' + key)?.checked             ?? false,
        title:         document.getElementById('fi-title-' + key)?.value.trim()      || '',
        description:   document.getElementById('fi-desc-' + key)?.value.trim()       || '',
        link_label:    document.getElementById('fi-link-label-' + key)?.value.trim() || '',
        link_url:      document.getElementById('fi-link-url-' + key)?.value.trim()   || '',
        title_es:      document.getElementById('fi-title-es-' + key)?.value.trim()      || '',
        description_es:document.getElementById('fi-desc-es-' + key)?.value.trim()       || '',
        link_label_es: document.getElementById('fi-link-label-es-' + key)?.value.trim() || '',
      };
      if (!isWfolder) {
        item.req_submitted  = document.getElementById('fi-rsubmit-' + key)?.value || false;
        item.req_notified   = document.getElementById('fi-rnotify-' + key)?.value || false;
        item.req_wfi        = document.getElementById('fi-rwfi-' + key)?.value    || false;
        item.req_notif_date = document.getElementById('fi-rdate-' + key)?.value   || false;
      }
      if (editable) item.label = document.getElementById('fi-label-' + key)?.value.trim() || '';
      form_items[key] = item;
    });
    const required_fields = {
      appt_date:    document.getElementById('req-appt-date')?.checked    ?? true,
      appt_time:    document.getElementById('req-appt-time')?.checked    ?? true,
      meeting_type: document.getElementById('req-meeting-type')?.checked ?? true,
      location:     document.getElementById('req-location')?.checked     ?? true,
    };
    const r = await fetch('/api/checklist-config', {
      method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailConfig: { form_items, required_fields } }),
    });
    const d = await r.json();
    if (d.ok) {
      if (!_checklistEmailCfg) _checklistEmailCfg = {};
      _checklistEmailCfg.form_items      = form_items;
      _checklistEmailCfg.required_fields = required_fields;
      showInlineMsg('fi-msg', 'Saved.', 'ok');
    } else showInlineMsg('fi-msg', d.error || 'Error', 'err');
  } catch(e) { showInlineMsg('fi-msg', e.message, 'err'); }
  finally { btn.disabled = false; }
}

