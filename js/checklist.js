// ── Public checklist screen ───────────────────────────────────────────────────
let _clToken    = null;
let _clAgents   = [];
let _clFormCfg     = [];
let _clSubcats     = [];
let _clEmailCfg    = {};
let _clLeadSources = [];
let _clEmailPayload = null;
let _clLocations = [];
let _clFormItems      = {};
let _clRequiredFields = {};
let _clPenaltyWarning = '';
let _clInternalEmail  = '';
let _clLocationName   = '';
let _clPenaltyAcknowledged = false;
let _clPendingFormData = null;

function clOnMeetingType(val) {
  const wrap = document.getElementById('cl-appt-location-wrap');
  if (!wrap) return;
  if (val === 'In Person') {
    wrap.style.display = '';
  } else {
    wrap.style.display = 'none';
    const sel = document.getElementById('cl-appt-location');
    if (sel) sel.value = '';
  }
}

async function loadChecklistScreen(token) {
  _clToken = token;
  showScreen('checklist');

  // Set today as default submission date
  const today = new Date().toISOString().slice(0, 10);
  const subDt = document.getElementById('cl-sub-date');
  if (subDt) subDt.value = today;

  try {
    const r = await fetch(`/api/checklist-form?token=${encodeURIComponent(token)}`);
    const d = await r.json();
    if (!r.ok) {
      document.getElementById('cl-error').style.display = 'block';
      document.getElementById('cl-error').textContent   = d.error || 'This link is invalid or the feature is not active.';
      return;
    }
    _clAgents      = d.agents        || [];
    _clFormCfg     = d.formConfig    || [];
    _clSubcats     = d.subcategories || [];
    _clEmailCfg    = d.emailConfig   || {};
    _productTypes  = d.productTypes  || [];
    _clLocations   = d.locations     || [];
    _clLeadSources = d.leadSources   || [];
    _clFormItems      = Object.assign({}, DEFAULT_FORM_ITEMS, d.emailConfig?.form_items || {});
    _clRequiredFields = Object.assign({}, DEFAULT_REQUIRED_FIELDS, d.emailConfig?.required_fields || {});
    _clPenaltyWarning = d.emailConfig?.penalty_warning || '';
    _clInternalEmail  = d.emailConfig?.internal_email  || '';

    // Branding
    const headerEl = document.getElementById('cl-agency-name');
    if (headerEl) headerEl.textContent = d.emailConfig?.agency_name || d.companyName || 'Checklist';

    // Agent dropdown
    const sel = document.getElementById('cl-salesperson');
    if (sel) {
      sel.innerHTML = '<option value="">— Select Agent —</option>' +
        _clAgents.map(a => `<option value="${escHtml(a.agent_id)}">${escHtml(a.name)}</option>`).join('');
    }

    // Location dropdowns — populated from account's configured locations
    if (_clLocations.length > 0) {
      const opts = '<option value="">— Select Location —</option>' +
        _clLocations.map(l => `<option value="${escHtml(l.name)}">${escHtml(l.name)}</option>`).join('');
      const locSel = document.getElementById('cl-location');
      const locWrap = document.getElementById('cl-location-wrap');
      if (locSel) { locSel.innerHTML = opts; if (locWrap) locWrap.style.display = ''; }
      const apptLocSel = document.getElementById('cl-appt-location');
      if (apptLocSel) apptLocSel.innerHTML = opts;
    }

    // Form checklist table
    const formsDiv = document.getElementById('cl-forms-table');
    if (formsDiv) {
      const cbStyle = 'style="width:18px;height:18px;cursor:pointer;accent-color:var(--accent);"';
      const tdBorder = 'style="border-bottom:1px solid var(--border2);"';
      let rows = '';

      FORM_ITEM_DEFS.forEach(({ key, label, editable }) => {
        const item = _clFormItems[key] || {};
        const displayLabel = editable ? (item.label || '') : label;
        if (item.show === false) return; // hidden by config
        if (editable && !displayLabel) return; // hide unconfigured Other slots
        const reqStar = item.required
          ? ' <span style="color:#e53e3e;font-size:11px;font-weight:700;" title="Required">*</span>' : '';
        const link = (item.link_url && item.link_label)
          ? ` <a href="${escHtml(item.link_url)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);margin-left:6px;">${escHtml(item.link_label)}</a>` : '';
        const keyTag = key !== displayLabel
          ? `<span style="display:inline-block;background:var(--card2);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:12px;padding:2px 7px;">${escHtml(key)}</span>`
          : '';
        const nameTag = editable
          ? `<span style="font-size:13px;">${escHtml(displayLabel)}</span>`
          : (keyTag || `<span style="display:inline-block;background:var(--card2);border:1px solid var(--border);border-radius:4px;font-family:monospace;font-size:12px;padding:2px 7px;">${escHtml(key)}</span>`);

        const isWfolder = key === 'wfolder';
        rows += `<tr id="cl-row-${key}">
          <td style="padding:10px 8px;border-bottom:1px solid var(--border2);">${nameTag}${reqStar}${link}</td>
          <td style="text-align:center;padding:10px 8px;border-bottom:1px solid var(--border2);">
            <input type="checkbox" data-form="${escHtml(key)}" data-field="applied" ${cbStyle}></td>
          ${isWfolder ? `
          <td ${tdBorder}></td><td ${tdBorder}></td><td ${tdBorder}></td><td ${tdBorder}></td><td ${tdBorder}></td>
          ` : `
          <td style="text-align:center;padding:10px 8px;border-bottom:1px solid var(--border2);">
            <input type="checkbox" data-form="${escHtml(key)}" data-field="submitted" ${cbStyle}></td>
          <td style="text-align:center;padding:10px 8px;border-bottom:1px solid var(--border2);">
            <input type="checkbox" data-form="${escHtml(key)}" data-field="notified" ${cbStyle}></td>
          <td style="text-align:center;padding:10px 8px;border-bottom:1px solid var(--border2);">
            <input type="checkbox" data-form="${escHtml(key)}" data-field="wfi" ${cbStyle}></td>
          <td style="text-align:center;padding:10px 8px;border-bottom:1px solid var(--border2);">
            <input type="date" data-form="${escHtml(key)}" data-field="notif_date" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 6px;font-size:12px;outline:none;width:140px;"></td>
          <td style="text-align:center;padding:10px 8px;border-bottom:1px solid var(--border2);">
            <input type="checkbox" data-form="${escHtml(key)}" data-field="na" ${cbStyle}></td>
          `}
        </tr>`;
      });

      formsDiv.innerHTML = `<div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;min-width:600px;">
          <thead>
            <tr style="background:var(--card2);">
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">Form</th>
              <th style="text-align:center;padding:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">Applied</th>
              <th style="text-align:center;padding:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">Submitted</th>
              <th style="text-align:center;padding:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">Customer Notified</th>
              <th style="text-align:center;padding:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">Task Created</th>
              <th style="text-align:left;padding:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">Notification Date</th>
              <th style="text-align:center;padding:8px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);">N/A</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="7" style="padding:12px;font-size:13px;color:var(--muted);">No form items configured.</td></tr>'}</tbody>
        </table>
      </div>`;
    }

    // Add one empty sale row
    clAddSaleRow();
  } catch(e) {
    document.getElementById('cl-error').style.display = 'block';
    document.getElementById('cl-error').textContent   = 'Failed to load checklist: ' + e.message;
  }
}

function clSubcatOptsFor(cat) {
  return '<option value="">— optional —</option>' +
    _clSubcats.filter(s => s.scoring_category === cat).map(s =>
      `<option value="${escHtml(s.label)}">${escHtml(s.label)}</option>`
    ).join('');
}

let _clRowIdx = 0;
function clAddSaleRow() {
  const id = ++_clRowIdx;
  const html = `<div class="cl-sale-row" id="clrow-${id}" style="background:var(--card2);border:1px solid var(--border2);border-radius:10px;padding:.85rem;margin-bottom:.75rem;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.75rem;">
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PRODUCT</label>
        <select class="clrow-product" onchange="clUpdateSubcat(this,${id})" style="${msrSelectStyle()}">
          ${activeCats().map(c => `<option value="${c.key}">${c.label}</option>`).join('')}
        </select>
      </div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">SUBCATEGORY</label>
        <select class="clrow-subcat" id="clrow-subcat-${id}" style="${msrSelectStyle()}">
          ${clSubcatOptsFor('auto')}
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:.75rem;margin-bottom:.75rem;">
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PREMIUM</label>
        <input class="clrow-prem" type="number" step="0.01" placeholder="0.00" style="${msrInputStyle()}"></div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PERIOD (MO)</label>
        <select class="clrow-period" style="${msrSelectStyle()}">
          <option value="">—</option><option value="6">6</option><option value="12">12</option>
        </select>
      </div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">LEAD SOURCE <span style="color:var(--danger)">*</span></label>
        <select class="clrow-source" style="${msrSelectStyle()}">
          <option value="">— required —</option>
          ${(_clLeadSources.length ? _clLeadSources : LEAD_SOURCES).map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;padding-top:14px;">
        <label style="font-size:12px;display:flex;gap:5px;align-items:center;cursor:pointer;"><input class="clrow-issued" type="checkbox"> Auto Issued</label>
        <label style="font-size:12px;display:flex;gap:5px;align-items:center;cursor:pointer;"><input class="clrow-split" type="checkbox" onchange="clToggleTeammate(this,${id})"> Split Sale</label>
      </div>
    </div>
    <div id="clrow-teammate-${id}" style="display:none;margin-bottom:.5rem;">
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">TEAMMATE</label>
      <select class="clrow-teammate-sel" style="${msrSelectStyle()};max-width:240px;">
        <option value="">— Select agent —</option>
        ${(_clAgents || _agentRoster.filter(a => a.active !== false)).map(a => `<option value="${escHtml(a.agent_id || a.id)}">${escHtml(a.name)}</option>`).join('')}
      </select>
    </div>
    <div style="margin-bottom:.5rem;">
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">DESCRIPTION <span style="font-weight:400;color:var(--muted);font-size:10px;">(included in email, not saved)</span></label>
      <input class="clrow-desc" type="text" placeholder="e.g. 2022 Toyota Camry, Term 20yr, etc." style="${msrInputStyle()}">
    </div>
    <div style="text-align:right;">
      <button class="btn btn-danger" style="padding:3px 10px;font-size:12px;" onclick="document.getElementById('clrow-${id}').remove()">Remove Row</button>
    </div>
  </div>`;
  document.getElementById('cl-sales-rows').insertAdjacentHTML('beforeend', html);
}

function clUpdateSubcat(sel, id) {
  const sub = document.getElementById(`clrow-subcat-${id}`);
  if (sub) sub.innerHTML = clSubcatOptsFor(sel.value);
}

function clToggleTeammate(cb, id) {
  const row = document.getElementById(`clrow-teammate-${id}`);
  if (row) row.style.display = cb.checked ? '' : 'none';
}

async function clSubmit() {
  const btn   = document.getElementById('cl-submit-btn');
  const errEl = document.getElementById('cl-error');
  errEl.style.display = 'none';
  const custName = document.getElementById('cl-cust-name').value.trim();
  const subDate  = document.getElementById('cl-sub-date').value;
  if (!custName) { errEl.textContent = 'Customer name is required.'; errEl.style.display='block'; return; }
  if (!subDate)  { errEl.textContent = 'Submission date is required.'; errEl.style.display='block'; return; }

  // Collect form completions (checkboxes)
  const formCompletions = {};
  document.querySelectorAll('#cl-forms-table input[type=checkbox]').forEach(cb => {
    const form  = cb.dataset.form;
    const field = cb.dataset.field;
    if (!form || !field) return;
    if (!formCompletions[form]) formCompletions[form] = {};
    formCompletions[form][field] = cb.checked;
  });
  // Collect notification dates
  document.querySelectorAll('#cl-forms-table input[type=date]').forEach(inp => {
    const form  = inp.dataset.form;
    const field = inp.dataset.field;
    if (!form || !field) return;
    if (!formCompletions[form]) formCompletions[form] = {};
    formCompletions[form][field] = inp.value || null;
  });

  const apptTime  = document.getElementById('cl-appt-time')?.value || null;
  const meetingTypeCb = document.querySelector('input[name="cl-meeting-type"]:checked');
  const meetingType   = meetingTypeCb?.value || null;
  const wfolderApplied = document.querySelector('[data-form="wfolder"][data-field="applied"]')?.checked ?? false;
  const salespersonId = document.getElementById('cl-salesperson').value || null;

  // ── Inline validation ──────────────────────────────────────────────────────
  clClearErrors();
  let firstErrEl = null;
  function clErr(el, msg) {
    if (!el) return;
    el.style.border      = '1.5px solid #c0392b';
    el.style.background  = '#fff5f5';
    el.style.boxShadow   = '0 0 0 3px rgba(192,57,43,0.15)';
    el.style.color       = 'inherit';
    el.dataset.clErr     = '1';
    if (msg) {
      const tip = document.createElement('div');
      tip.className = 'cl-err-tip';
      tip.style.cssText = 'color:#c0392b;font-size:11px;margin-top:3px;';
      tip.textContent = msg;
      el.insertAdjacentElement('afterend', tip);
    }
    if (!firstErrEl) firstErrEl = el;
  }
  function clErrLabel(labelId) {
    const lbl = document.getElementById(labelId);
    if (lbl) { lbl.style.color = '#c0392b'; lbl.dataset.clErrLbl = '1'; }
  }

  // Salesperson
  const spEl = document.getElementById('cl-salesperson');
  if (!salespersonId) { clErr(spEl, 'Salesperson is required.'); clErrLabel('cl-label-salesperson'); }

  // Appointment date
  if (_clRequiredFields.appt_date) {
    const el = document.getElementById('cl-appt-date');
    if (!el?.value) clErr(el, 'Appointment date is required.');
  }
  // Appointment time
  if (_clRequiredFields.appt_time) {
    const el = document.getElementById('cl-appt-time');
    if (!el?.value) clErr(el, 'Appointment time is required.');
  }
  // Meeting type
  if (_clRequiredFields.meeting_type) {
    const grp = document.getElementById('cl-meeting-type-group');
    if (!meetingType) {
      if (grp) {
        grp.style.border     = '1.5px solid #c0392b';
        grp.style.borderRadius = '8px';
        grp.style.padding    = '6px 8px';
        grp.style.boxShadow  = '0 0 0 3px rgba(192,57,43,0.15)';
        grp.dataset.clErr    = '1';
        const tip = document.createElement('div');
        tip.className = 'cl-err-tip';
        tip.style.cssText = 'color:#c0392b;font-size:11px;margin-top:3px;';
        tip.textContent = 'Please select a meeting type.';
        grp.insertAdjacentElement('afterend', tip);
        if (!firstErrEl) firstErrEl = grp;
      }
    }
  }
  // Sales location (when locations are configured for this account)
  if (_clRequiredFields.location && _clLocations.length > 0) {
    const el = document.getElementById('cl-location');
    if (!el?.value) clErr(el, 'Please select a location.');
  }
  // Appointment location (when In Person)
  if (meetingType === 'In Person' && _clLocations.length > 0) {
    const el = document.getElementById('cl-appt-location');
    if (!el?.value) clErr(el, 'Please select the appointment location.');
  }
  // Required form items: Applied OR N/A must be checked; secondary fields validated when Applied
  FORM_ITEM_DEFS.forEach(({ key, editable }) => {
    const item = _clFormItems[key] || {};
    if (item.show === false) return;
    if (editable && !item.label) return;
    const fc  = formCompletions[key] || {};
    const row = document.getElementById('cl-row-' + key);

    // Applied OR N/A required check
    if (item.required && !fc.applied && !fc.na) {
      if (row) {
        row.style.background = '#fff5f5';
        row.dataset.clErr    = '1';
        const nameCell = row.querySelector('td');
        if (nameCell && !firstErrEl) firstErrEl = nameCell;
        const tip = document.createElement('div');
        tip.className = 'cl-err-tip';
        tip.style.cssText = 'color:#c0392b;font-size:11px;margin-top:3px;';
        tip.textContent = 'Required — check Applied or N/A.';
        nameCell?.appendChild(tip);
      }
    }

    // Secondary requirements (only when Applied is checked, not N/A)
    if (fc.applied && !fc.na && key !== 'wfolder' && row) {
      const normMode = v => v === true ? 'and' : (v || false);
      const secFields = [
        { reqKey: 'req_submitted',  fcKey: 'submitted'  },
        { reqKey: 'req_notified',   fcKey: 'notified'   },
        { reqKey: 'req_wfi',        fcKey: 'wfi'        },
        { reqKey: 'req_notif_date', fcKey: 'notif_date' },
      ];
      // If any OR field is satisfied (checked on form), secondary requirements pass
      const orSatisfied = secFields.some(({ reqKey, fcKey }) =>
        normMode(item[reqKey]) === 'or' && !!fc[fcKey]
      );
      if (!orSatisfied) {
        secFields.forEach(({ reqKey, fcKey }) => {
          if (normMode(item[reqKey]) !== 'and') return;
          if (fc[fcKey]) return;
          const cb = row.querySelector(`[data-field="${fcKey}"]`);
          if (!cb) return;
          const cell = cb.closest('td');
          if (!cell) return;
          cell.style.background = '#fff5f5';
          cell.dataset.clErr = '1';
          if (!firstErrEl) firstErrEl = cell;
          const tip = document.createElement('div');
          tip.className = 'cl-err-tip';
          tip.style.cssText = 'color:#c0392b;font-size:10px;margin-top:2px;';
          tip.textContent = 'Required';
          cell.appendChild(tip);
        });
      }
    }
  });

  if (firstErrEl) {
    firstErrEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Warning modal only fires if penalty warning text is configured
  if (_clPenaltyWarning && !_clPenaltyAcknowledged) {
    _clPendingFormData = { apptTime, meetingType, wfolderApplied, formCompletions };
    document.getElementById('cl-penalty-text').textContent = _clPenaltyWarning;
    document.getElementById('cl-penalty-modal').style.display = 'flex';
    return;
  }
  _clPenaltyAcknowledged = false;

  // Collect sale rows
  const salesRows = document.querySelectorAll('#cl-sales-rows .cl-sale-row');
  const sales = [];
  for (const row of salesRows) {
    const product = row.querySelector('.clrow-product')?.value;
    if (!product) continue;
    const subcatRaw = row.querySelector('.clrow-subcat')?.value || '';
    sales.push({
      product,
      subcategory: subcatRaw || null,
      writtenPremium: row.querySelector('.clrow-prem')?.value  || null,
      period:         row.querySelector('.clrow-period')?.value || null,
      leadSource:     row.querySelector('.clrow-source')?.value || null,
      autoIssued:     row.querySelector('.clrow-issued')?.checked            ?? null,
      splitSale:      row.querySelector('.clrow-split')?.checked             ?? null,
      teammate:       row.querySelector('.clrow-teammate-sel')?.value        || null,
      saleWeight:     row.querySelector('.clrow-split')?.checked ? 0.5 : 1,
      description:    row.querySelector('.clrow-desc')?.value.trim()         || null,
    });
  }

  // Validate sale rows — all visible rows must have product, premium, and lead source
  document.querySelectorAll('#cl-sales-rows .cl-sale-row').forEach(rowEl => {
    const prodEl = rowEl.querySelector('.clrow-product');
    const premEl = rowEl.querySelector('.clrow-prem');
    const srcEl  = rowEl.querySelector('.clrow-source');
    const splitEl = rowEl.querySelector('.clrow-split');
    const tmEl    = rowEl.querySelector('.clrow-teammate-sel');
    if (prodEl && !prodEl.value) clErr(prodEl, 'Product is required.');
    if (premEl && !premEl.value) clErr(premEl, 'Premium is required.');
    if (srcEl  && !srcEl.value)  clErr(srcEl,  'Lead source is required.');
    if (splitEl?.checked && tmEl && !tmEl.value) clErr(tmEl, 'Teammate is required.');
  });

  const agentDisplayName = _clAgents.find(a => a.agent_id === salespersonId)?.name || salespersonId || '';

  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const r = await fetch('/api/checklist-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token:           _clToken,
        subDate,
        apptDate:        document.getElementById('cl-appt-date').value || null,
        apptTime,
        meetingType,
        customerName:    custName,
        salespersonId,
        location:        document.getElementById('cl-location')?.value || null,
        apptLocation:    document.getElementById('cl-appt-location')?.value || null,
        wfolderApplied,
        formCompletions,
        sales,
      }),
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Submission failed.'; errEl.style.display='block'; return; }
    _clEmailPayload = d.emailPayload;
    showChecklistEmailModal({ ...d.emailPayload, agentDisplayName });
  } catch(e) {
    errEl.textContent = e.message; errEl.style.display='block';
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Checklist';
  }
}

let _clSummarySubject = '';
let _clSummaryBody    = '';
let _clCustHtml       = '';
let _clCustPlain      = '';

function clShowTab(tab, btn) {
  document.getElementById('cl-tab-summary').style.display  = tab === 'summary'  ? '' : 'none';
  document.getElementById('cl-tab-customer').style.display = tab === 'customer' ? '' : 'none';
  document.querySelectorAll('#cl-email-modal .acct-stab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function clFormatDate(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  const d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function clFormatTime(t) {
  if (!t) return '';
  const p = t.split(':');
  let h = parseInt(p[0], 10); const m = p[1] || '00';
  const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return h + ':' + m + ' ' + ampm;
}

function clApptLine(payload) {
  const date = clFormatDate(payload.apptDate);
  const time = clFormatTime(payload.apptTime);
  const type = payload.meetingType || '';
  let loc = '';
  if (type === 'In Person' && payload.apptLocation) {
    const match = _clLocations.find(l => l.name === payload.apptLocation);
    loc = ' @ ' + (match ? match.name : payload.apptLocation);
  }
  return [date, time ? 'at ' + time : '', type + loc].filter(Boolean).join(' — ');
}

function buildSummaryEmail(payload) {
  const fc = payload.formCompletions || {};
  const apptLine = clApptLine(payload);
  const agentName = payload.agentDisplayName || payload.salespersonId || '';

  const formLines = [];
  if (payload.wfolderApplied) formLines.push('  w:/ folder: Applied ✓');
  (_clFormCfg.length ? _clFormCfg : [{form_key:'GSD'},{form_key:'DSS'},{form_key:'SCD'},{form_key:'DTD'},{form_key:'SFPP'}]).forEach(f => {
    const k = f.form_key;
    const d = fc[k] || {};
    if (d.na) { formLines.push(`  ${k}: N/A`); return; }
    const parts = [];
    if (d.applied)   parts.push('Applied ✓');
    if (d.submitted) parts.push('Submitted ✓');
    if (d.notified)  parts.push('Notified ✓');
    if (d.wfi)       parts.push('Task ✓');
    if (d.notif_date) parts.push('Date: ' + d.notif_date);
    formLines.push(`  ${k}: ${parts.length ? parts.join(' | ') : 'Not completed'}`);
  });

  const salesLines = (payload.sales || []).map((s, i) => {
    const cat = labelForCat ? labelForCat(s.product) : s.product;
    let line = `  ${i+1}. ${cat}`;
    if (s.subcategory)    line += ` — ${s.subcategory}`;
    if (s.writtenPremium) line += ` ($${parseFloat(s.writtenPremium).toFixed(2)})`;
    if (s.description)    line += ` — ${s.description}`;
    if (s.autoIssued)     line += ' ✓ Auto Issued';
    if (s.splitSale) {
      const tmName = _agentRoster.find(a => a.agent_id === s.teammate)?.name || _clAgents?.find(a => a.agent_id === s.teammate)?.name || s.teammate || 'TBD';
      line += ` — Split w/ ${tmName}`;
    }
    return line;
  });

  const subject = `New Business — ${payload.customerName || 'Customer'} — ${payload.subDate || ''}`;
  const body = [
    `Customer: ${payload.customerName || ''}`,
    `Agent: ${agentName}`,
    `Submission Date: ${payload.subDate || ''}`,
    apptLine ? `Appointment: ${apptLine}` : '',
    '',
    'FORMS:',
    ...formLines,
    '',
    `SALES (${(payload.sales||[]).length} items):`,
    ...salesLines,
  ].filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { subject, body };
}

function buildCustomerEmailHtml(payload, formItemsOverride) {
  const fc = payload.formCompletions || {};
  const agencyName = payload.agencyName || 'Russel Williams State Farm';
  const brandColor = payload.brandColor || '#D62311';
  const apptLine   = clApptLine(payload);
  const greeting   = payload.greeting || 'Hello and welcome to ' + agencyName + '!';
  const footer     = payload.footer   || "Don't hesitate to contact us if you have any questions — we're here to help!";
  const agentName  = payload.agentName  || '';
  const agentPhone = payload.agentPhone || '';
  const agentEmail = payload.agentEmail || '';
  // Configurable body sections (fallback to defaults when not set)
  const bodyPara1        = payload.bodyPara1        ?? ET_DEFAULT_BODY_PARA1;
  const bodyPara1Enabled = payload.bodyPara1Enabled ?? true;
  const bodyPara2        = payload.bodyPara2        ?? ET_DEFAULT_BODY_PARA2;
  const bodyPara2Enabled = payload.bodyPara2Enabled ?? true;
  const importantEnabled = payload.importantEnabled ?? true;
  const importantTitle   = payload.importantTitle   ?? ET_DEFAULT_IMPORTANT_TITLE;
  const importantBody    = payload.importantBody    ?? ET_DEFAULT_IMPORTANT_BODY;
  const resourcesEnabled = payload.resourcesEnabled ?? true;
  const resourcesTitle   = payload.resourcesTitle   ?? ET_DEFAULT_RESOURCES_TITLE;
  const resourcesLinks   = payload.resourcesLinks   ?? ET_DEFAULT_RESOURCES_LINKS;
  const thankYou         = (payload.thankYou        ?? ET_DEFAULT_THANK_YOU).replace('[AgencyName]', agencyName);
  const thankYouEnabled  = payload.thankYouEnabled  ?? true;

  // Build config-driven form item sections
  const _fiItems = formItemsOverride || _clFormItems;
  let discountHtml = '', discountPlain = '';
  const P2 = 'style="margin:0 0 14px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:14px;color:#403C3C;line-height:1.7;"';
  FORM_ITEM_DEFS.forEach(({ key, label, editable }) => {
    const item = _fiItems[key] || DEFAULT_FORM_ITEMS[key] || {};
    if (!fc[key]?.applied) return;
    const desc = item.description || '';
    if (!desc) return;
    const displayLabel = editable ? (item.label || label) : label;
    const sectionTitle = item.title || displayLabel;
    const linkHtml = (item.link_url && item.link_label)
      ? `<ul style="margin:8px 0 16px 20px;padding:0;"><li style="margin:0 0 6px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:13px;color:#403C3C;line-height:1.7;"><a href="${escHtml(item.link_url)}" style="color:#D62311;text-decoration:none;">${escHtml(item.link_label)}</a></li></ul>` : '';
    discountHtml += `<p style="margin:18px 0 8px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#403C3C;text-transform:uppercase;letter-spacing:0.05em;">${escHtml(sectionTitle)}</p>`;
    desc.split(/\n\n+/).forEach(para => {
      discountHtml += `<p ${P2}>${escHtml(para)}</p>`;
    });
    discountHtml += linkHtml;
    discountPlain += `\n${displayLabel}\n${desc.split('\n')[0]}\n`;
  });
  const discounts = { html: discountHtml, plain: discountPlain };

  // Build footer office rows from _clLocations
  let footerRows = '';
  if (_clLocations.length > 0) {
    _clLocations.forEach((loc, i) => {
      const divider = i > 0 ? '<tr><td style="border-top:1px solid rgba(255,255,255,0.15);height:1px;font-size:1px;line-height:1px;">&nbsp;</td></tr>' : '';
      const detailParts = [];
      if (loc.address) detailParts.push(escHtml(loc.address));
      const contactParts = [];
      if (loc.phone) contactParts.push(`<a href="tel:${escHtml(loc.phone.replace(/\D/g,''))}" style="color:rgba(255,255,255,0.9);text-decoration:none;">${escHtml(loc.phone)}</a>`);
      if (loc.hours) contactParts.push(escHtml(loc.hours));
      if (contactParts.length) detailParts.push(contactParts.join(' &nbsp;&bull;&nbsp; '));
      footerRows += `${divider}<tr><td style="padding:${i>0?'16px':0} 0 0;">
        <p style="margin:0 0 4px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#ffffff;text-transform:uppercase;letter-spacing:0.08em;">${escHtml(loc.name)}</p>
        ${detailParts.length ? `<p style="margin:0;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:12px;color:rgba(255,255,255,0.72);line-height:1.7;">${detailParts.join('<br>')}</p>` : ''}
      </td></tr>`;
    });
  } else {
    // Fallback to hardcoded offices
    footerRows = `<tr><td style="padding-bottom:16px;">
      <p style="margin:0 0 4px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#ffffff;text-transform:uppercase;letter-spacing:0.08em;">West Linn Office</p>
      <p style="margin:0;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:12px;color:rgba(255,255,255,0.72);line-height:1.7;">6105 West A St, Ste C, West Linn, OR 97068<br><a href="tel:5036576690" style="color:rgba(255,255,255,0.9);text-decoration:none;">(503) 657-6690</a> &nbsp;&bull;&nbsp; Mon&ndash;Fri, 9 AM &ndash; 5:30 PM</p>
      </td></tr>
      <tr><td style="border-top:1px solid rgba(255,255,255,0.15);padding-top:16px;">
      <p style="margin:0 0 4px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#ffffff;text-transform:uppercase;letter-spacing:0.08em;">Happy Valley Office</p>
      <p style="margin:0;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:12px;color:rgba(255,255,255,0.72);line-height:1.7;">13255 SE 130th Ave Ste 300, Happy Valley, OR 97015<br><a href="tel:9712526298" style="color:rgba(255,255,255,0.9);text-decoration:none;">(971) 252-6298</a></p>
      </td></tr>`;
  }

  const P = 'style="margin:0 0 14px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:14px;color:#403C3C;line-height:1.7;"';

  const bodyHtml = `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F5F5;">
<tr><td align="center" style="padding:20px 12px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #DCDCDC;">

<tr><td bgcolor="${brandColor}" style="background-color:${brandColor};padding:20px 32px;">
<p style="margin:0;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;line-height:1.2;">${escHtml(agencyName)}</p>
</td></tr>

<tr><td style="padding:32px 32px 24px;">

<p style="margin:0 0 14px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:15px;color:#403C3C;line-height:1.6;">${greeting}</p>
${bodyPara1Enabled && bodyPara1 ? `<p ${P}>${escHtml(bodyPara1)}</p>` : ''}
${bodyPara2Enabled && bodyPara2 ? `<p ${P}>${escHtml(bodyPara2)}</p>` : ''}

${apptLine ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
<tr><td bgcolor="#f5f5f5" style="background-color:#f5f5f5;border-left:4px solid ${brandColor};padding:16px 20px;">
<p style="margin:0 0 5px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:${brandColor};text-transform:uppercase;letter-spacing:0.08em;">YOUR NEXT APPOINTMENT</p>
<p style="margin:0;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#403C3C;line-height:1.4;">${apptLine}</p>
</td></tr></table>` : ''}

${discounts.html}

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td style="border-top:1px solid #DCDCDC;height:1px;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>

${importantEnabled && importantBody ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
<tr><td bgcolor="#fff8e6" style="background-color:#fff8e6;border-left:4px solid #e8a020;padding:14px 18px;">
<p style="margin:0 0 4px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#856404;text-transform:uppercase;letter-spacing:0.08em;">${escHtml(importantTitle)}</p>
<p style="margin:0;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:13px;color:#403C3C;line-height:1.6;">${escHtml(importantBody)}</p>
</td></tr></table>` : ''}

${resourcesEnabled && resourcesLinks.length ? `<p style="margin:0 0 8px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#403C3C;">${escHtml(resourcesTitle)}</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
${resourcesLinks.map(lnk => `<tr><td style="padding:3px 0;"><a href="${escHtml(lnk.url)}" style="font-family:Arial,Calibri,Helvetica,sans-serif;font-size:13px;color:#D62311;text-decoration:none;">&#8250; ${escHtml(lnk.label)}</a></td></tr>`).join('')}
</table>` : ''}

<p ${P}>${footer}</p>
${thankYouEnabled && thankYou ? `<p style="margin:0 0 24px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:14px;color:#403C3C;line-height:1.7;">${escHtml(thankYou)}</p>` : ''}

<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;"><tr><td style="border-top:1px solid #DCDCDC;height:1px;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
<p style="margin:14px 0 2px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:13px;color:#403C3C;">Best regards,</p>
<p style="margin:0 0 4px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#403C3C;">${escHtml(agentName || agencyName + ' Team')}</p>
${agentPhone ? `<p style="margin:0 0 2px;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:13px;color:#403C3C;">${escHtml(agentPhone)}</p>` : ''}
${agentEmail ? `<p style="margin:0;font-family:Arial,Calibri,Helvetica,sans-serif;font-size:13px;color:#403C3C;">${escHtml(agentEmail)}</p>` : ''}

</td></tr>

<tr><td bgcolor="#403C3C" style="background-color:#403C3C;padding:24px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0">
${footerRows}
</table>
</td></tr>

</table>
</td></tr></table>`;

  const compactBody = bodyHtml.replace(/>\s+</g, '><');

  const fullHtml = [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">',
    '<head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"/>',
    '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->',
    '<style type="text/css">a{color:#D62311;text-decoration:none;}a:hover{text-decoration:underline;}</style>',
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f4f8fc;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">',
    compactBody,
    '</body></html>'
  ].join('\n');

  return { bodyHtml, fullHtml };
}

// Spanish email builder: uses agency-configured Spanish text with fallback to built-in Spanish defaults.
// Customer-specific data (appointment details, agent contact info, agency name) is never translated.
function buildCustomerEmailHtmlEs(payload) {
  const esPayload = {
    ...payload,
    greeting:       payload.greetingEs       || payload.greeting       || '',
    footer:         payload.footerEs         || payload.footer         || '',
    bodyPara1:      payload.bodyPara1Es      || ET_DEFAULT_BODY_PARA1_ES,
    bodyPara2:      payload.bodyPara2Es      || ET_DEFAULT_BODY_PARA2_ES,
    importantTitle: payload.importantTitleEs || ET_DEFAULT_IMPORTANT_TITLE_ES,
    importantBody:  payload.importantBodyEs  || ET_DEFAULT_IMPORTANT_BODY_ES,
    resourcesTitle: payload.resourcesTitleEs || ET_DEFAULT_RESOURCES_TITLE_ES,
    resourcesLinks: (payload.resourcesLinksEs && payload.resourcesLinksEs.length)
                      ? payload.resourcesLinksEs
                      : ET_DEFAULT_RESOURCES_LINKS_ES,
    thankYou:       payload.thankYouEs       || ET_DEFAULT_THANK_YOU_ES,
  };
  // Build Spanish form items: use _es fields when set, fall back to English text
  const esFormItems = {};
  FORM_ITEM_DEFS.forEach(({ key }) => {
    const item = _clFormItems[key] || DEFAULT_FORM_ITEMS[key] || {};
    esFormItems[key] = {
      ...item,
      title:       item.title_es       || item.title       || '',
      description: item.description_es || item.description || '',
      link_label:  item.link_label_es  || item.link_label  || '',
    };
  });
  let { bodyHtml, fullHtml } = buildCustomerEmailHtml(esPayload, esFormItems);
  // Translate the two hardcoded structural labels embedded in the HTML template
  bodyHtml = bodyHtml.split('YOUR NEXT APPOINTMENT').join('SU PRÓXIMA CITA').split('>Best regards,<').join('>Atentamente,<');
  fullHtml = fullHtml.split('YOUR NEXT APPOINTMENT').join('SU PRÓXIMA CITA').split('>Best regards,<').join('>Atentamente,<');
  return { bodyHtml, fullHtml };
}

let _clSpanish = false;
let _clEmailPayloadRef = null; // set by showChecklistEmailModal for re-render

function clToggleSpanish(isSpanish) {
  _clSpanish = isSpanish;
  if (!_clEmailPayloadRef) return;
  const cust = isSpanish
    ? buildCustomerEmailHtmlEs(_clEmailPayloadRef)
    : buildCustomerEmailHtml(_clEmailPayloadRef);
  _clCustHtml = cust.fullHtml;
  document.getElementById('cl-email-preview-body').innerHTML = cust.bodyHtml;
}

function showChecklistEmailModal(payload) {
  _clEmailPayloadRef = payload;
  // Reset Spanish toggle on each new submission
  _clSpanish = false;
  const spToggle = document.getElementById('cl-spanish-toggle');
  if (spToggle) spToggle.checked = false;

  // Build internal summary
  const sum = buildSummaryEmail(payload);
  _clSummarySubject = sum.subject;
  _clSummaryBody    = sum.body;
  document.getElementById('cl-sum-subject').textContent = _clSummarySubject;
  document.getElementById('cl-sum-body').textContent    = _clSummaryBody;

  // Build customer email
  const cust = buildCustomerEmailHtml(payload);
  _clCustHtml  = cust.fullHtml;
  let custPlainDiscounts = '';
  FORM_ITEM_DEFS.forEach(({ key, label, editable }) => {
    const item = _clFormItems[key] || DEFAULT_FORM_ITEMS[key] || {};
    if (!cust.bodyHtml || !payload.formCompletions?.[key]?.applied) return;
    const desc = item.description || '';
    if (!desc) return;
    const displayLabel = editable ? (item.label || label) : label;
    const sectionTitle = item.title || displayLabel;
    custPlainDiscounts += `\n${sectionTitle}\n${desc.split('\n')[0]}\n`;
  });
  const _cpAgency    = payload.agencyName || 'our agency';
  const _cpPara1En   = payload.bodyPara1Enabled ?? true;
  const _cpPara1     = payload.bodyPara1 ?? ET_DEFAULT_BODY_PARA1;
  const _cpPara2En   = payload.bodyPara2Enabled ?? true;
  const _cpPara2     = payload.bodyPara2 ?? ET_DEFAULT_BODY_PARA2;
  const _cpImpEn     = payload.importantEnabled ?? true;
  const _cpImpTitle  = payload.importantTitle   ?? ET_DEFAULT_IMPORTANT_TITLE;
  const _cpImpBody   = payload.importantBody    ?? ET_DEFAULT_IMPORTANT_BODY;
  const _cpResEn     = payload.resourcesEnabled ?? true;
  const _cpResTitle  = payload.resourcesTitle   ?? ET_DEFAULT_RESOURCES_TITLE;
  const _cpResLinks  = payload.resourcesLinks   ?? ET_DEFAULT_RESOURCES_LINKS;
  const _cpTyEn      = payload.thankYouEnabled  ?? true;
  const _cpTy        = (payload.thankYou ?? ET_DEFAULT_THANK_YOU).replace('[AgencyName]', _cpAgency);
  _clCustPlain = 'Hello and welcome to ' + _cpAgency + '!\n\n'
    + (payload.greeting || '') + '\n\n'
    + (_cpPara1En && _cpPara1 ? _cpPara1 + '\n\n' : '')
    + (_cpPara2En && _cpPara2 ? _cpPara2 + '\n\n' : '')
    + 'YOUR NEXT APPOINTMENT: ' + clApptLine(payload) + '\n'
    + custPlainDiscounts
    + (_cpImpEn && _cpImpBody ? '\n' + _cpImpTitle.toUpperCase() + ': ' + _cpImpBody + '\n\n' : '')
    + (_cpResEn && _cpResLinks.length ? _cpResTitle + '\n' + _cpResLinks.map(l => '* ' + l.label + ': ' + l.url).join('\n') + '\n\n' : '')
    + (payload.footer || '') + '\n\n'
    + (_cpTyEn && _cpTy ? _cpTy + '\n\n' : '')
    + 'Best regards,\n' + (payload.agentName || _cpAgency + ' Team');
  document.getElementById('cl-email-preview-body').innerHTML = cust.bodyHtml;

  document.getElementById('cl-email-modal').style.display = 'flex';
  clShowTab('summary', document.getElementById('cl-tab-btn-summary'));
}

function clCopySummary() {
  navigator.clipboard.writeText(_clSummarySubject + '\n\n' + _clSummaryBody).then(() => {
    const msg = document.getElementById('cl-sum-copy-msg');
    if (msg) { msg.style.display='block'; setTimeout(() => msg.style.display='none', 2000); }
  });
}

function clOpenSummaryMailto() {
  const to = encodeURIComponent(_clInternalEmail || '');
  const subj = encodeURIComponent(_clSummarySubject);
  const body = encodeURIComponent(_clSummaryBody);
  window.open(`mailto:${to}?subject=${subj}&body=${body}`, '_blank');
}

function clCopyCustomerEmail() {
  if (navigator.clipboard && window.ClipboardItem) {
    const bHtml  = new Blob([_clCustHtml],  { type: 'text/html' });
    const bPlain = new Blob([_clCustPlain], { type: 'text/plain' });
    navigator.clipboard.write([new ClipboardItem({ 'text/html': bHtml, 'text/plain': bPlain })])
      .then(() => {
        const msg = document.getElementById('cl-cust-copy-msg');
        if (msg) { msg.style.display='block'; setTimeout(() => msg.style.display='none', 3000); }
      })
      .catch(() => clOpenCustomerMailto());
  } else {
    clOpenCustomerMailto();
  }
}

function clOpenCustomerMailto() {
  const subj = encodeURIComponent((_clEmailPayload?.subject) || 'Welcome!');
  window.open('mailto:?subject=' + subj, '_blank');
}

function clClearErrors() {
  document.querySelectorAll('[data-cl-err]').forEach(el => {
    el.style.border     = '';
    el.style.background = '';
    el.style.boxShadow  = '';
    delete el.dataset.clErr;
  });
  document.querySelectorAll('[data-cl-err-lbl]').forEach(el => {
    el.style.color = '';
    delete el.dataset.clErrLbl;
  });
  document.querySelectorAll('.cl-err-tip').forEach(el => el.remove());
}

function clPenaltyContinue() {
  _clPenaltyAcknowledged = true;
  document.getElementById('cl-penalty-modal').style.display = 'none';
  clSubmit();
}

function clNewSubmission() {
  clClearErrors();
  document.getElementById('cl-email-modal').style.display = 'none';
  document.getElementById('cl-cust-name').value  = '';
  document.getElementById('cl-appt-date').value  = '';
  document.getElementById('cl-sales-rows').innerHTML = '';
  document.getElementById('cl-forms-table').querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  document.getElementById('cl-forms-table').querySelectorAll('input[type=date]').forEach(inp => inp.value = '');
  document.getElementById('cl-error').style.display = 'none';
  const locSel = document.getElementById('cl-location');
  if (locSel) locSel.value = '';
  const apptLocSel = document.getElementById('cl-appt-location');
  if (apptLocSel) apptLocSel.value = '';
  const apptLocWrap = document.getElementById('cl-appt-location-wrap');
  if (apptLocWrap) apptLocWrap.style.display = 'none';
  document.querySelectorAll('input[name="cl-meeting-type"]').forEach(r => r.checked = false);
  const t = document.getElementById('cl-appt-time');
  if (t) t.value = '';
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('cl-sub-date').value = today;
  clAddSaleRow();
}

