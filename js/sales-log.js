// ── Manual entry (Manage tab) ─────────────────────────────────────────────────
let _manualRowCounter = 0;

function manualAddRow(opts = {}) {
  const id  = ++_manualRowCounter;
  const { agentId = '', customerName = '', saleDate = '' } = opts;
  const activeLocs = _salesLocations.filter(l => l.active !== false);
  const hasLocs    = activeLocs.length > 0;
  const row2Cols   = hasLocs ? '1fr 1fr 1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr 1fr 1fr 1fr';
  const locColHtml = hasLocs ? `<div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">LOCATION</label>
        <select class="msr-location" style="${msrSelectStyle()}">
          <option value="">— optional —</option>
          ${activeLocs.map(l => `<option value="${escHtml(l.name)}">${escHtml(l.name)}</option>`).join('')}
        </select></div>` : '';
  const html = `<div class="manual-sale-row" id="msr-${id}" style="background:var(--card2);border:1px solid var(--border2);border-radius:10px;padding:.85rem;margin-bottom:.75rem;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem;margin-bottom:.75rem;">
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">AGENT</label>
        <select class="msr-agent" style="${msrSelectStyle()}">
          <option value="">— Select —</option>
          ${(_agentRoster.filter(a => a.active !== false)).map(a => `<option value="${escHtml(a.agent_id)}"${a.agent_id === agentId ? ' selected' : ''}>${escHtml(a.name)}</option>`).join('')}
        </select>
      </div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PRODUCT</label>
        <select class="msr-product" onchange="msrUpdateSubcat(this,${id})" style="${msrSelectStyle()}">
          <option value="">— Select —</option>
          ${activeCats().map(c => `<option value="${c.key}">${c.label}</option>`).join('')}
        </select>
      </div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">SUBCATEGORY</label>
        <select class="msr-subcat" id="msr-subcat-${id}" style="${msrSelectStyle()}">
          <option value="">— optional —</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:${row2Cols};gap:.75rem;margin-bottom:.75rem;">
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">SALE DATE</label>
        <input class="msr-date" id="msr-sale-date-${id}" type="text" placeholder="YYYY-MM-DD" value="${escHtml(saleDate)}" style="${msrInputStyle()}"></div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">ISSUED DATE</label>
        <input class="msr-issued-date" id="msr-issued-date-${id}" type="text" placeholder="YYYY-MM-DD" style="${msrInputStyle()}"></div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">SUBMITTED PREM</label>
        <input class="msr-prem" type="number" step="0.01" placeholder="0.00" style="${msrInputStyle()}"></div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">ISSUED PREM</label>
        <input class="msr-issued-prem" type="number" step="0.01" placeholder="0.00" style="${msrInputStyle()}"></div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PERIOD (MO)</label>
        <select class="msr-period" style="${msrSelectStyle()}">
          <option value="">—</option><option value="6">6</option><option value="12">12</option>
        </select>
      </div>
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">LEAD SOURCE <span style="color:var(--danger)">*</span></label>
        <select class="msr-source" style="${msrSelectStyle()}">
          <option value="">— required —</option>
          ${getLeadSources().map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
        </select>
      </div>
      ${locColHtml}
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:.75rem;align-items:end;">
      <div><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">CUSTOMER NAME <span style="color:var(--muted);font-weight:400;">(2 initials + last)</span></label>
        <input class="msr-cust" type="text" placeholder="John Smith" value="${escHtml(customerName)}" style="${msrInputStyle()}"></div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="font-size:11px;color:var(--muted);">AUTO ISSUED</label>
        <input class="msr-issued" type="checkbox" onchange="msrAutoIssuedChanged(this,${id})" style="width:18px;height:18px;margin-top:4px;">
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        <label style="font-size:11px;color:var(--muted);">SPLIT SALE</label>
        <input class="msr-split" type="checkbox" style="width:18px;height:18px;margin-top:4px;" onchange="msrToggleTeammate(this,${id})">
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end;align-items:flex-end;">
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="msrDuplicate(${id})">+ Dup</button>
        <button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="document.getElementById('msr-${id}').remove()">Remove</button>
      </div>
    </div>
    <div id="msr-teammate-row-${id}" style="display:none;margin-top:.5rem;">
      <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">TEAMMATE</label>
          <select class="msr-teammate-sel" style="${msrSelectStyle()}; max-width:240px;">
            <option value="">— Select agent —</option>
            ${_agentRoster.filter(a => a.active !== false).map(a => `<option value="${escHtml(a.agent_id)}">${escHtml(a.name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PRIMARY %</label>
          <input class="msr-split-ratio" type="number" min="1" max="99" value="50" placeholder="%" style="${msrInputStyle()}; max-width:90px;">
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('manual-sales-rows').insertAdjacentHTML('beforeend', html);
  flatpickr(`#msr-sale-date-${id}`, {
    dateFormat: 'Y-m-d', allowInput: true, defaultDate: saleDate || null,
    onChange: (d, s) => msrSaleDateChanged({ value: s }, id)
  });
  flatpickr(`#msr-issued-date-${id}`, { dateFormat: 'Y-m-d', allowInput: true });
}

function msrDuplicate(id) {
  const row = document.getElementById(`msr-${id}`);
  if (!row) return;
  manualAddRow({
    agentId:      row.querySelector('.msr-agent')?.value || '',
    customerName: row.querySelector('.msr-cust')?.value  || '',
    saleDate:     row.querySelector('.msr-date')?.value  || '',
  });
}

function msrSelectStyle() { return 'width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:12px;outline:none;'; }
function msrInputStyle()  { return 'width:100%;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:12px;outline:none;box-sizing:border-box;'; }

function msrUpdateSubcat(productSel, id) {
  const cat    = productSel.value;
  const subSel = document.getElementById(`msr-subcat-${id}`);
  if (!subSel) return;
  if (!cat) { subSel.innerHTML = '<option value="">— optional —</option>'; return; }
  const opts = _salesSubcats.filter(s => s.active && s.scoring_category === cat);
  subSel.innerHTML = '<option value="">— optional —</option>' +
    opts.map(s => `<option value="${escHtml(s.scoring_category)}|${escHtml(s.label)}">${escHtml(s.label)}</option>`).join('');
}

function msrToggleTeammate(cb, id) {
  const row = document.getElementById(`msr-teammate-row-${id}`);
  if (row) row.style.display = cb.checked ? '' : 'none';
  // Primary % default reset on toggle
  if (cb.checked) {
    const ratioInput = row?.querySelector('.msr-split-ratio');
    if (ratioInput && !ratioInput.value) ratioInput.value = '50';
  }
}

function _msrShowDupWarning(row) {
  if (row.querySelector('.msr-dup-warn')) return;
  const warn = document.createElement('div');
  warn.className = 'msr-dup-warn';
  warn.style.cssText = 'background:rgba(255,179,0,.1);border:1px solid rgba(255,179,0,.35);border-radius:6px;padding:7px 10px;margin-top:6px;font-size:12px;color:#ffb300;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
  warn.innerHTML = `<span style="flex:1;">&#x26A0; This sale already exists in the log.</span>
    <button style="background:rgba(255,179,0,.2);border:1px solid rgba(255,179,0,.4);color:#ffb300;border-radius:5px;padding:3px 12px;font-size:12px;cursor:pointer;font-family:inherit;"
      onclick="var r=this.closest('.manual-sale-row');r.dataset.dupForce='1';this.closest('.msr-dup-warn').remove();manualSubmitAll(this);">Add anyway</button>
    <button style="background:none;border:1px solid rgba(255,255,255,.15);color:var(--muted);border-radius:5px;padding:3px 12px;font-size:12px;cursor:pointer;font-family:inherit;"
      onclick="this.closest('.manual-sale-row').remove();">Skip</button>`;
  row.appendChild(warn);
}

async function manualSubmitAll(btn) {
  const rows = document.querySelectorAll('#manual-sales-rows .manual-sale-row');
  if (!rows.length) return;
  btn.disabled = true;
  const msg = document.getElementById('manual-entry-msg');
  msg.style.display = 'none';
  let saved = 0, errors = 0;
  for (const row of rows) {
    const product    = row.querySelector('.msr-product')?.value;
    const subcatRaw  = row.querySelector('.msr-subcat')?.value || '';
    const saleDate   = row.querySelector('.msr-date')?.value;
    const leadSource = row.querySelector('.msr-source')?.value;
    if (!product || !saleDate || !leadSource) { errors++; continue; }
    const subcategory = subcatRaw.includes('|') ? subcatRaw.split('|')[1] : '';
    const isSplit   = row.querySelector('.msr-split')?.checked ?? false;
    const ratioRaw  = isSplit ? parseFloat(row.querySelector('.msr-split-ratio')?.value || '50') : 100;
    const ratio     = Math.min(Math.max(ratioRaw, 1), 99) / 100;
    const premRaw      = row.querySelector('.msr-prem')?.value || null;
    const premFloat    = premRaw ? parseFloat(premRaw) : null;
    const issPremRaw   = row.querySelector('.msr-issued-prem')?.value || null;
    const issPremFloat = issPremRaw ? parseFloat(issPremRaw) : null;
    const teammateId= isSplit ? (row.querySelector('.msr-teammate-sel')?.value || null) : null;
    const primaryAgent = row.querySelector('.msr-agent')?.value || null;
    const baseBody = {
      product,
      subcategory:   subcategory    || null,
      saleDate,
      customerName:  row.querySelector('.msr-cust')?.value        || '',
      leadSource:    row.querySelector('.msr-source')?.value      || null,
      period:        row.querySelector('.msr-period')?.value      || null,
      autoIssued:    row.querySelector('.msr-issued')?.checked    ?? null,
      issuedDate:    row.querySelector('.msr-issued-date')?.value || null,
      location:      row.querySelector('.msr-location')?.value    || null,
      splitSale:     isSplit                                      || null,
    };
    const body = {
      ...baseBody,
      agentId:        primaryAgent,
      writtenPremium: premFloat != null ? (isSplit ? +(premFloat * ratio).toFixed(2) : premFloat) : null,
      issuedPremium:  issPremFloat != null ? (isSplit ? +(issPremFloat * ratio).toFixed(2) : issPremFloat) : null,
      splitRatio:     isSplit ? ratio : null,
      teammate:       teammateId,
      saleWeight:     isSplit ? 0.5 : 1,
    };
    const force = row.dataset.dupForce === '1';
    const r = await fetch('/api/sales', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, force }) });
    if (r.status === 409) {
      _msrShowDupWarning(row);
      continue;
    }
    if (!r.ok) { errors++; continue; }
    // Second entry for teammate when split sale
    if (isSplit && teammateId) {
      const body2 = {
        ...baseBody,
        agentId:        teammateId,
        writtenPremium: premFloat    != null ? +(premFloat    * (1 - ratio)).toFixed(2) : null,
        issuedPremium:  issPremFloat != null ? +(issPremFloat * (1 - ratio)).toFixed(2) : null,
        splitRatio:     1 - ratio,
        teammate:       primaryAgent,
        saleWeight:     0.5,
        force,
      };
      await fetch('/api/sales', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body2) });
    }
    saved++; row.remove();
  }
  btn.disabled = false;
  msg.style.display = 'block';
  if (saved)   { msg.style.color = 'var(--accent2)'; msg.textContent = `${saved} entr${saved===1?'y':'ies'} saved.`; }
  if (errors)  { msg.style.color = 'var(--danger)';  msg.textContent += ` ${errors} failed (product, date, and lead source required).`; }
  if (saved)   { loadRaceData().catch(() => {}); manualAddRow(); }
}

// ── Manual entry helpers ──────────────────────────────────────────────────────
function msrSaleDateChanged(input, id) {
  const cb = document.getElementById('msr-issued-cb-' + id) || document.querySelector('#msr-' + id + ' .msr-issued');
  if (cb?.checked) {
    const issued = document.getElementById('msr-issued-date-' + id);
    if (issued) issued._flatpickr ? issued._flatpickr.setDate(input.value, false) : (issued.value = input.value);
  }
}
function msrAutoIssuedChanged(cb, id) {
  const issued  = document.getElementById('msr-issued-date-' + id);
  const saleDt  = document.getElementById('msr-sale-date-' + id);
  if (!issued) return;
  if (cb.checked) {
    issued._flatpickr ? issued._flatpickr.setDate(saleDt?.value || '', false) : (issued.value = saleDt?.value || '');
    issued.disabled = true;
  } else { issued.disabled = false; }
}

// ── Sales log ─────────────────────────────────────────────────────────────────
function _slSubcatOpts(product, selectedLabel) {
  const opts = _salesSubcats.filter(s => s.active && (!product || s.scoring_category === product));
  return '<option value="">— optional —</option>' + opts.map(s => {
    const val = s.scoring_category + '|' + s.label;
    return `<option value="${escHtml(val)}"${s.label === selectedLabel ? ' selected' : ''}>${escHtml(s.label)}</option>`;
  }).join('');
}
function slUpdateSubcat(sel, h) {
  const sub = document.getElementById('sl-subcat-' + h);
  if (sub) sub.innerHTML = _slSubcatOpts(sel.value, '');
}
function slSaleDateChanged(input, h) {
  const cb = document.getElementById('sl-auto-issued-' + h);
  if (cb?.checked) {
    const d = document.getElementById('sl-issued-date-' + h);
    if (d) d._flatpickr ? d._flatpickr.setDate(input.value, false) : (d.value = input.value);
  }
}
function slAutoIssuedChanged(cb, h) {
  const issued = document.getElementById('sl-issued-date-' + h);
  const sale   = document.getElementById('sl-sale-date-' + h);
  if (!issued) return;
  if (cb.checked) {
    issued._flatpickr ? issued._flatpickr.setDate(sale?.value || '', false) : (issued.value = sale?.value || '');
    issued.disabled = true;
  } else { issued.disabled = false; }
}
function slToggleTeammate(cb, h) {
  const row = document.getElementById('sl-teammate-row-' + h);
  if (row) row.style.display = cb.checked ? '' : 'none';
}
function _buildSlEditForm(e) {
  const h   = e.hash;
  const ss  = msrSelectStyle();
  const si  = msrInputStyle();
  const lbl = (t) => `<label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">${t}</label>`;
  const agentOpts = '<option value="">— Select —</option>' +
    _agentRoster.filter(a => a.active !== false).map(a =>
      `<option value="${escHtml(a.agent_id)}"${a.agent_id === e.agent_id ? ' selected' : ''}>${escHtml(a.name)}</option>`
    ).join('');
  const productOpts = '<option value="">— Select —</option>' +
    activeCats().map(c => `<option value="${c.key}"${c.key === e.product ? ' selected' : ''}>${c.label}</option>`).join('');
  const srcOpts = '<option value="">—</option>' +
    getLeadSources().map(s => `<option value="${escHtml(s)}"${e.lead_source === s ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
  const autoChk = e.auto_issued ? ' checked' : '';
  const splitChk = e.split_sale ? ' checked' : '';
  const activeLocs = _salesLocations.filter(l => l.active !== false);
  const existingLoc = e.location || '';
  const locsForOpts = [...activeLocs.map(l => l.name)];
  if (existingLoc && !locsForOpts.includes(existingLoc)) locsForOpts.push(existingLoc);
  const locOpts = `<option value="">— optional —</option>` +
    locsForOpts.map(n => `<option value="${escHtml(n)}"${n === existingLoc ? ' selected' : ''}>${escHtml(n)}</option>`).join('');
  return `<div style="background:var(--deep);border-radius:8px;padding:.85rem;margin-top:.5rem;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.75rem;margin-bottom:.75rem;">
      <div>${lbl('AGENT')}<select id="sl-agent-${h}" style="${ss}">${agentOpts}</select></div>
      <div>${lbl('PRODUCT')}<select id="sl-product-${h}" onchange="slUpdateSubcat(this,'${h}')" style="${ss}">${productOpts}</select></div>
      <div>${lbl('SUBCATEGORY')}<select id="sl-subcat-${h}" style="${ss}">${_slSubcatOpts(e.product, e.subcategory)}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.75rem;margin-bottom:.75rem;align-items:end;">
      <div>${lbl('SALE DATE')}<input id="sl-sale-date-${h}" type="text" placeholder="YYYY-MM-DD" value="${e.sale_date || ''}" style="${si}"></div>
      <div>${lbl('ISSUED DATE')}<input id="sl-issued-date-${h}" type="text" placeholder="YYYY-MM-DD" value="${e.issued_date || ''}"${e.auto_issued ? ' disabled' : ''} style="${si}"></div>
      <div style="display:flex;flex-direction:column;gap:4px;padding-bottom:2px;">
        <label style="font-size:11px;color:var(--muted);">AUTO ISSUED</label>
        <input id="sl-auto-issued-${h}" type="checkbox"${autoChk} onchange="slAutoIssuedChanged(this,'${h}')" style="width:18px;height:18px;margin-top:4px;">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:.75rem;margin-bottom:.75rem;">
      <div>${lbl('CUSTOMER NAME')}<input id="sl-cust-${h}" type="text" value="${escHtml(e.customer_name || '')}" style="${si}"></div>
      <div>${lbl('SUBMITTED PREM')}<input id="sl-prem-${h}" type="number" step="0.01" value="${e.written_premium || ''}" style="${si}"></div>
      <div>${lbl('ISSUED PREM')}<input id="sl-issued-prem-${h}" type="number" step="0.01" value="${e.issued_premium || ''}" style="${si}"></div>
      <div>${lbl('PERIOD')}<select id="sl-period-${h}" style="${ss}"><option value="">—</option><option value="6"${e.period==6?' selected':''}>6</option><option value="12"${e.period==12?' selected':''}>12</option></select></div>
      <div>${lbl('LEAD SOURCE')}<select id="sl-source-${h}" style="${ss}">${srcOpts}</select></div>
      <div>${lbl('LOCATION')}<select id="sl-location-${h}" style="${ss}">${locOpts}</select></div>
    </div>
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
      <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input id="sl-split-${h}" type="checkbox"${splitChk} onchange="slToggleTeammate(this,'${h}')"> Split Sale
      </label>
      <div id="sl-teammate-row-${h}" style="display:${e.split_sale ? 'flex' : 'none'};flex:1;gap:.75rem;align-items:flex-end;flex-wrap:wrap;">
        <div>
          <span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">TEAMMATE</span>
          <select id="sl-teammate-${h}" style="${ss};max-width:200px;">${(() => {
            const active = _agentRoster.filter(a => a.active !== false);
            const inRoster = active.some(a => a.agent_id === e.teammate);
            const extra = (e.teammate && !inRoster) ? `<option value="${escHtml(e.teammate)}" selected>${escHtml(e.teammate)}</option>` : '';
            return '<option value="">— Select —</option>' + extra +
              active.map(a => `<option value="${escHtml(a.agent_id)}"${a.agent_id === e.teammate ? ' selected' : ''}>${escHtml(a.name)}</option>`).join('');
          })()}</select>
        </div>
        <div>
          <span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">PRIMARY %</span>
          <input id="sl-split-ratio-${h}" type="number" min="1" max="99" value="${e.split_ratio != null ? Math.round(e.split_ratio * 100) : 50}" placeholder="Primary %" style="${si};max-width:90px;">
        </div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
        <div id="sl-msg-${h}" style="font-size:12px;display:none;"></div>
        <button class="btn btn-primary" style="padding:4px 14px;font-size:12px;" onclick="saveSalesLogRow('${h}',this)">Save</button>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="cancelSalesLogEdit('${h}')">Cancel</button>
      </div>
    </div>
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-top:.5rem;padding:6px 8px;background:rgba(255,100,100,.05);border-radius:6px;border:1px solid rgba(255,100,100,.1);">
      <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input id="sl-cancelled-${h}" type="checkbox"${e.is_cancelled ? ' checked' : ''} onchange="slCancelledChanged(this,'${h}')"> Policy Cancelled / Chargeback
      </label>
      <div id="sl-chargeback-row-${h}" style="display:${e.is_cancelled ? '' : 'none'};flex:1;">
        <span style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">CHARGEBACK DATE</span>
        <input id="sl-chargeback-date-${h}" type="text" placeholder="YYYY-MM-DD" value="${escHtml(e.chargeback_date||'')}" style="${si};max-width:160px;">
      </div>
    </div>
  </div>`;
}
function slCancelledChanged(el, h) {
  const row = document.getElementById('sl-chargeback-row-' + h);
  if (row) row.style.display = el.checked ? '' : 'none';
}

function editSalesLogRow(h) {
  const edit = document.getElementById('sl-edit-' + h);
  if (!edit) return;
  const wasHidden = edit.style.display === 'none';
  edit.style.display = wasHidden ? '' : 'none';
  if (wasHidden) {
    const saleDateEl   = document.getElementById('sl-sale-date-' + h);
    const issuedDateEl = document.getElementById('sl-issued-date-' + h);
    if (saleDateEl && !saleDateEl._flatpickr) {
      flatpickr(saleDateEl, { dateFormat: 'Y-m-d', allowInput: true,
        onChange: (d, s) => slSaleDateChanged({ value: s }, h) });
    }
    if (issuedDateEl && !issuedDateEl._flatpickr) {
      flatpickr(issuedDateEl, { dateFormat: 'Y-m-d', allowInput: true });
    }
    const cbDateEl = document.getElementById('sl-chargeback-date-' + h);
    if (cbDateEl && !cbDateEl._flatpickr) {
      flatpickr(cbDateEl, { dateFormat: 'Y-m-d', allowInput: true });
    }
  }
}
function cancelSalesLogEdit(h) {
  const edit = document.getElementById('sl-edit-' + h);
  if (edit) edit.style.display = 'none';
}
async function saveSalesLogRow(h, btn) {
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const subcatRaw  = document.getElementById('sl-subcat-' + h)?.value || '';
    const subcategory = subcatRaw.includes('|') ? subcatRaw.split('|')[1] : null;
    const body = {
      hash:          h,
      agent_id:      document.getElementById('sl-agent-' + h)?.value      || null,
      product:       document.getElementById('sl-product-' + h)?.value     || null,
      subcategory:   subcategory,
      sale_date:     document.getElementById('sl-sale-date-' + h)?.value   || null,
      issued_date:   document.getElementById('sl-issued-date-' + h)?.value || null,
      auto_issued:   document.getElementById('sl-auto-issued-' + h)?.checked ?? null,
      written_premium: document.getElementById('sl-prem-' + h)?.value        || null,
      issued_premium:  document.getElementById('sl-issued-prem-' + h)?.value || null,
      customer_name: document.getElementById('sl-cust-' + h)?.value          || null,
      lead_source:   document.getElementById('sl-source-' + h)?.value      || null,
      period:        document.getElementById('sl-period-' + h)?.value       || null,
      split_sale:    document.getElementById('sl-split-' + h)?.checked      ?? null,
      split_ratio:   document.getElementById('sl-split-' + h)?.checked && document.getElementById('sl-split-ratio-' + h)?.value
                       ? parseFloat(document.getElementById('sl-split-ratio-' + h).value) / 100 || null
                       : null,
      teammate:      document.getElementById('sl-teammate-' + h)?.value     || null,
      location:      document.getElementById('sl-location-' + h)?.value     || null,
      is_cancelled:  document.getElementById('sl-cancelled-' + h)?.checked  ?? false,
      chargeback_date: document.getElementById('sl-cancelled-' + h)?.checked
        ? (document.getElementById('sl-chargeback-date-' + h)?.value || null) : null,
    };
    const r = await fetch('/api/sales', { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { showInlineMsg('sl-msg-' + h, d.error || 'Save failed', 'err'); return; }
    await loadSalesLog(); // re-fetch so edited data reflects in _salesLogEntries
  } catch(err) {
    showInlineMsg('sl-msg-' + h, err.message, 'err');
  } finally { btn.disabled = false; btn.textContent = 'Save'; }
}
async function deleteSalesLogRow(h, btn) {
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes'; btn.textContent = 'Confirm?';
    setTimeout(() => { if (btn.dataset.confirming === 'yes') { btn.dataset.confirming = ''; btn.textContent = '✕'; } }, 3000);
    return;
  }
  btn.disabled = true;
  try {
    const r = await fetch('/api/sales?hash=' + encodeURIComponent(h), { method: 'DELETE', headers: authHeaders() });
    if (r.ok) { await loadSalesLog(); loadRaceData().catch(() => {}); }
    else { const d = await r.json(); showInlineMsg('sl-msg-' + h, d.error || 'Delete failed', 'err'); btn.disabled = false; }
  } catch(err) { btn.disabled = false; }
}
let _salesLogEntries      = [];
let _salesLogMonth        = new Date().getMonth() + 1;
let _salesLogYear         = new Date().getFullYear();
let _salesLogAllYear      = false;
let _salesLogIssuedFilter = 'all';
let _salesLogCustomFrom   = null; // YYYY-MM-DD when quarterly mode active
let _salesLogCustomTo     = null;
let _spEntries        = [];
let _spMetric         = 'count';
let _spDateMode       = 'month';
let _spDateMonth      = '';
let _spDateYear       = '';
let _spDateStart      = '';
let _spDateEnd        = '';
let _spDim1           = 'product';
let _spDim2           = 'lead_source';
let _spCrumbs         = [];
let _spChart1         = null;
let _spChart2         = null;
let _spLocationFilter = 'all';

function initSalesLogControls() {
  const monthSel = document.getElementById('sl-month-sel');
  const yearSel  = document.getElementById('sl-year-sel');
  if (!monthSel || !yearSel || monthSel.options.length) return;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  monthSel.innerHTML = MONTHS.map((m, i) => `<option value="${i+1}">${m}</option>`).join('');
  const curYear = new Date().getFullYear();
  yearSel.innerHTML = [curYear-2, curYear-1, curYear].map(y => `<option value="${y}">${y}</option>`).join('');
  monthSel.value = _salesLogMonth;
  yearSel.value  = _salesLogYear;
}

function onSalesLogMonthChange() {
  _salesLogMonth = parseInt(document.getElementById('sl-month-sel')?.value) || _salesLogMonth;
  _salesLogYear  = parseInt(document.getElementById('sl-year-sel')?.value)  || _salesLogYear;
  _salesLogCustomFrom = null; _salesLogCustomTo = null;
  const qsel = document.getElementById('sl-quarter-mode');
  if (qsel) qsel.value = '';
  _slHideSpecificRange();
  loadSalesLog();
}

function _slHideSpecificRange() {
  const sr = document.getElementById('sl-specific-range');
  const monthSel = document.getElementById('sl-month-sel');
  const yearSel  = document.getElementById('sl-year-sel');
  if (sr) sr.style.display = 'none';
  if (monthSel) { monthSel.style.display = ''; monthSel.disabled = false; }
  if (yearSel)  yearSel.style.display  = '';
}

function onSalesLogQuarterChange() {
  const val = document.getElementById('sl-quarter-mode')?.value;
  const monthSel = document.getElementById('sl-month-sel');
  const yearSel  = document.getElementById('sl-year-sel');

  if (val === 'specific') {
    if (monthSel) monthSel.style.display = 'none';
    if (yearSel)  yearSel.style.display  = 'none';
    const sr = document.getElementById('sl-specific-range');
    if (sr) sr.style.display = 'flex';
    _salesLogCustomFrom = null; _salesLogCustomTo = null;
    return;
  }

  _slHideSpecificRange();
  _salesLogYear = parseInt(yearSel?.value) || _salesLogYear;
  const q = parseInt(val) || 0;
  if (q) {
    if (monthSel) monthSel.disabled = true;
    const startM = (q - 1) * 3 + 1;
    const endM   = q * 3;
    const last   = new Date(_salesLogYear, endM, 0).getDate();
    _salesLogCustomFrom = `${_salesLogYear}-${String(startM).padStart(2,'0')}-01`;
    _salesLogCustomTo   = `${_salesLogYear}-${String(endM).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
  } else {
    if (monthSel) monthSel.disabled = false;
    _salesLogCustomFrom = null;
    _salesLogCustomTo   = null;
  }
  loadSalesLog();
}

function onSalesLogSpecificDateChange() {
  const from = document.getElementById('sl-date-from')?.value;
  const to   = document.getElementById('sl-date-to')?.value;
  if (from && to && from <= to) {
    _salesLogCustomFrom = from;
    _salesLogCustomTo   = to;
    loadSalesLog();
  }
}
function onSalesLogFilterChange() { loadSalesLog(); }
function onSalesLogAllYearChange() {
  _salesLogAllYear = !!document.getElementById('sl-all-year')?.checked;
  const qsel = document.getElementById('sl-quarter-mode');
  if (qsel?.value === 'specific') { qsel.value = ''; _slHideSpecificRange(); _salesLogCustomFrom = null; _salesLogCustomTo = null; }
  const monthSel = document.getElementById('sl-month-sel');
  if (monthSel) monthSel.disabled = _salesLogAllYear;
  _salesLogYear = parseInt(document.getElementById('sl-year-sel')?.value) || _salesLogYear;
  loadSalesLog();
}

function onSalesLogLocationChange() {
  _salesLogLocationFilter = document.getElementById('sl-location-filter')?.value || 'all';
  filterSalesLog();
}

async function loadSalesLog() {
  initSalesLogControls();
  const list = document.getElementById('checklist-subs-list');
  if (!list) return;
  list.innerHTML = '<span style="color:var(--muted);font-size:13px;">Loading…</span>';
  try {
    const showUnissued = document.getElementById('sl-show-unissued')?.checked ? '1' : '0';
    const showHidden   = document.getElementById('sl-show-hidden')?.checked   ? '1' : '0';
    const params = _salesLogCustomFrom
      ? new URLSearchParams({ fromDate: _salesLogCustomFrom, toDate: _salesLogCustomTo, includeUnissued: showUnissued, includeHidden: showHidden })
      : new URLSearchParams({ month: _salesLogMonth, year: _salesLogYear, includeUnissued: showUnissued, includeHidden: showHidden, ...((_salesLogAllYear) ? { allYear: '1' } : {}) });
    const r = await fetch(`/api/sales?${params}`, { headers: authHeaders() });
    const d = await r.json();
    _salesLogEntries = d.entries || [];
    _populateSlLocationFilter();
    renderSalesLog();
  } catch(err) { list.innerHTML = `<span style="color:var(--danger);font-size:13px;">Error: ${err.message}</span>`; }
}
function filterSalesLog() { renderSalesLog(); }

function onSalesLogIssuedFilterChange() {
  _salesLogIssuedFilter = document.getElementById('sl-issued-filter')?.value || 'all';
  renderSalesLog();
}

function _populateSlLocationFilter() {
  const sel = document.getElementById('sl-location-filter');
  if (!sel) return;
  const locs = [...new Set(_salesLogEntries.map(e => (e.location || '').trim()).filter(Boolean))].sort();
  if (!locs.length) { sel.style.display = 'none'; return; }
  sel.style.display = '';
  const cur = sel.value;
  sel.innerHTML = '<option value="all">All Locations</option>'
    + locs.map(l => `<option value="${escHtml(l)}">${escHtml(l)}</option>`).join('');
  if (locs.includes(cur)) { sel.value = cur; _salesLogLocationFilter = cur; }
  else { sel.value = 'all'; _salesLogLocationFilter = 'all'; }
}

// ── Chargeback Report ──────────────────────────────────────────────────────────
let _cbMode           = 'month';
let _cbMonth          = new Date().getMonth() + 1;
let _cbYear           = new Date().getFullYear();
let _cbQuarter        = Math.ceil((new Date().getMonth() + 1) / 3);
let _cbAllEntries     = [];
let _cbEntries        = [];
let _cbSortCol        = 'chargeback_date';
let _cbSortDir        = -1;
let _cbAgentFilter    = 'all';
let _cbLocationFilter = 'all';

function _initCbControls() {
  const curYear  = new Date().getFullYear();
  const yearOpts = [curYear-2, curYear-1, curYear].map(y => `<option value="${y}">${y}</option>`).join('');
  const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthSel = document.getElementById('cb-month-sel');
  if (monthSel && !monthSel.options.length) {
    monthSel.innerHTML = MONTHS.map((m,i) => `<option value="${i+1}">${m}</option>`).join('');
    monthSel.value = _cbMonth;
  }
  ['cb-year-sel','cb-quarter-year','cb-year-only'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.options.length) { el.innerHTML = yearOpts; el.value = _cbYear; }
  });
  const qSel = document.getElementById('cb-quarter-sel');
  if (qSel) qSel.value = _cbQuarter;
}

function setCbMode(mode, btn) {
  _cbMode = mode;
  document.querySelectorAll('#perf-sub-chargebacks .acct-stab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('cb-range-month').style.display   = mode === 'month'   ? 'flex' : 'none';
  document.getElementById('cb-range-quarter').style.display = mode === 'quarter' ? 'flex' : 'none';
  document.getElementById('cb-range-year').style.display    = mode === 'year'    ? 'flex' : 'none';
  loadChargebackReport();
}

function _cbDateRange() {
  if (_cbMode === 'month') {
    const y = parseInt(document.getElementById('cb-year-sel')?.value)  || _cbYear;
    const m = parseInt(document.getElementById('cb-month-sel')?.value) || _cbMonth;
    const last = new Date(y, m, 0).getDate();
    return { fromDate: `${y}-${String(m).padStart(2,'0')}-01`, toDate: `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}` };
  }
  if (_cbMode === 'quarter') {
    const y  = parseInt(document.getElementById('cb-quarter-year')?.value) || _cbYear;
    const q  = parseInt(document.getElementById('cb-quarter-sel')?.value)  || _cbQuarter;
    const sm = (q - 1) * 3 + 1;
    const em = q * 3;
    const last = new Date(y, em, 0).getDate();
    return { fromDate: `${y}-${String(sm).padStart(2,'0')}-01`, toDate: `${y}-${String(em).padStart(2,'0')}-${String(last).padStart(2,'0')}` };
  }
  const y = parseInt(document.getElementById('cb-year-only')?.value) || _cbYear;
  return { fromDate: `${y}-01-01`, toDate: `${y}-12-31` };
}

async function loadChargebackReport() {
  _initCbControls();
  const listEl = document.getElementById('cb-list');
  if (!listEl) return;
  listEl.innerHTML = '<span style="color:var(--muted);">Loading…</span>';
  await loadMemberOrgTree();
  try {
    const { fromDate, toDate } = _cbDateRange();
    const params = new URLSearchParams({ fromDate, toDate, includeHidden: '1', chargebackMode: '1' });
    const r = await fetch(`/api/sales?${params}`, { headers: authHeaders() });
    const d = await r.json();
    _cbAllEntries = d.entries || [];
    _cbEntries    = _cbAllEntries;
    const memberLimited = _isMember && !['captain','chief_officer'].includes(_memberRole);
    _cbAgentFilter    = (memberLimited && _memberAgentId) ? _memberAgentId : 'all';
    _cbLocationFilter = 'all';
    _cbPopulateFilters();
    renderChargebackReport();
  } catch(err) {
    if (listEl) listEl.innerHTML = `<span style="color:var(--danger);font-size:13px;">Error: ${err.message}</span>`;
  }
}

function _cbPopulateFilters() {
  const filterRow = document.getElementById('cb-filter-row');
  const agentSel  = document.getElementById('cb-agent-filter');
  const locSel    = document.getElementById('cb-location-filter');
  if (!agentSel || !locSel) return;

  const agents = [...new Set(_cbEntries.map(e => e.agent_id).filter(Boolean))].sort((a, b) => {
    const na = _agentRoster.find(x => x.agent_id === a)?.name || a;
    const nb = _agentRoster.find(x => x.agent_id === b)?.name || b;
    return na.localeCompare(nb);
  });
  const locs = [...new Set(_cbEntries.map(e => (e.location || '').trim()).filter(Boolean))].sort();

  const memberLimited = _isMember && !['captain','chief_officer'].includes(_memberRole);
  if (memberLimited && _memberAgentId) {
    const agentName = _agentRoster.find(x => x.agent_id === _memberAgentId)?.name || _memberAgentId;
    agentSel.innerHTML = `<option value="${escHtml(_memberAgentId)}">${escHtml(agentName)}</option>`;
    agentSel.value = _memberAgentId;
    agentSel.disabled = true;
  } else {
    agentSel.innerHTML = '<option value="all">All Agents</option>' +
      agents.map(id => {
        const name = _agentRoster.find(x => x.agent_id === id)?.name || id;
        return `<option value="${escHtml(id)}">${escHtml(name)}</option>`;
      }).join('');
    agentSel.value = _cbAgentFilter;
    agentSel.disabled = false;
  }

  locSel.innerHTML = '<option value="all">All Locations</option>' +
    locs.map(l => `<option value="${escHtml(l)}">${escHtml(l)}</option>`).join('');
  locSel.value = _cbLocationFilter;

  if (filterRow) filterRow.style.display = (_cbEntries.length > 0) ? 'flex' : 'none';
}

function onCbFilterChange() {
  _cbAgentFilter    = document.getElementById('cb-agent-filter')?.value    || 'all';
  _cbLocationFilter = document.getElementById('cb-location-filter')?.value || 'all';
  renderChargebackReport();
}

function setCbSort(col) {
  if (_cbSortCol === col) _cbSortDir *= -1;
  else { _cbSortCol = col; _cbSortDir = -1; }
  renderChargebackReport();
}

function renderChargebackReport() {
  const listEl  = document.getElementById('cb-list');
  const statsEl = document.getElementById('cb-stats-row');
  if (!listEl) return;

  const matchesFilter = e =>
    (_cbAgentFilter    === 'all' || e.agent_id === _cbAgentFilter) &&
    (_cbLocationFilter === 'all' || (e.location || '').trim() === _cbLocationFilter);

  const filteredAll = _cbAllEntries.filter(matchesFilter);
  const filtered    = _cbEntries.filter(matchesFilter);

  const total    = filteredAll.length;
  const cbCount  = filtered.length;
  const cbRate   = total > 0 ? (cbCount / total * 100).toFixed(1) : '0.0';
  const cbPrem   = filtered.reduce((s, e) => s + (parseFloat(e.written_premium) || 0), 0);
  const rateColor = parseFloat(cbRate) > 10 ? '#ff6b6b' : parseFloat(cbRate) > 5 ? '#fbbf24' : 'var(--accent2)';

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card" style="padding:.75rem 1rem;min-width:110px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Chargebacks</div>
        <div style="font-size:1.4rem;font-weight:700;color:#ff6b6b;">${cbCount}</div>
        <div style="font-size:11px;color:var(--muted);">of ${total} policies</div>
      </div>
      <div class="stat-card" style="padding:.75rem 1rem;min-width:110px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Chargeback Rate</div>
        <div style="font-size:1.4rem;font-weight:700;color:${rateColor};">${cbRate}%</div>
      </div>
      <div class="stat-card" style="padding:.75rem 1rem;min-width:110px;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px;">Premium at Risk</div>
        <div style="font-size:1.4rem;font-weight:700;color:#ff6b6b;">$${cbPrem.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
      </div>`;
  }

  if (!cbCount) {
    listEl.innerHTML = '<span style="color:var(--accent2);font-size:13px;">No chargebacks in this period.</span>';
    return;
  }

  const cbSortFn = (a, b) => {
    let av, bv;
    if (_cbSortCol === 'chargeback_date') { av = a.chargeback_date || a.sale_date || ''; bv = b.chargeback_date || b.sale_date || ''; return _cbSortDir * av.localeCompare(bv); }
    if (_cbSortCol === 'sale_date')       { return _cbSortDir * (a.sale_date || '').localeCompare(b.sale_date || ''); }
    if (_cbSortCol === 'agent')           { av = _agentRoster.find(x => x.agent_id === a.agent_id)?.name || a.agent_id || ''; bv = _agentRoster.find(x => x.agent_id === b.agent_id)?.name || b.agent_id || ''; return _cbSortDir * av.localeCompare(bv); }
    if (_cbSortCol === 'product')         { return _cbSortDir * labelForCat(a.product).localeCompare(labelForCat(b.product)); }
    if (_cbSortCol === 'premium')         { return _cbSortDir * ((parseFloat(a.written_premium)||0) - (parseFloat(b.written_premium)||0)); }
    return 0;
  };

  const th = (col, label) => {
    const arrow = _cbSortCol === col ? (_cbSortDir === 1 ? ' ▲' : ' ▼') : '';
    return `<th style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 8px;text-align:left;cursor:pointer;user-select:none;white-space:nowrap;" onclick="setCbSort('${col}')">${label}${arrow}</th>`;
  };

  const canWaive = !_isMember || _isAdmin;
  const renderCbRow = e => {
    const ag = _agentRoster.find(a => a.agent_id === e.agent_id)?.name || e.agent_id || '—';
    const pr = e.written_premium ? '$' + Number(e.written_premium).toFixed(2) : '—';
    const waiveCell = canWaive
      ? `<td style="padding:6px 8px;text-align:center;">
           <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:var(--muted);">
             <input type="checkbox" ${e.chargeback_exempt ? 'checked' : ''} onchange="toggleCbExempt('${escHtml(e.hash)}',this.checked)" style="accent-color:var(--accent2);cursor:pointer;">
             Waive
           </label>
         </td>`
      : '';
    return `<tr style="border-bottom:1px solid var(--border2);">
      <td style="padding:6px 8px;font-size:12px;color:#ff6b6b;">${e.chargeback_date || '—'}</td>
      <td style="padding:6px 8px;font-size:12px;color:var(--muted);">${e.sale_date || '—'}</td>
      <td style="padding:6px 8px;font-size:13px;font-weight:600;">${escHtml(ag)}</td>
      <td style="padding:6px 8px;font-size:12px;">${escHtml(labelForCat(e.product))}${e.subcategory ? '<span style="color:var(--muted);font-size:11px;"> · ' + escHtml(e.subcategory) + '</span>' : ''}</td>
      <td style="padding:6px 8px;font-size:12px;color:var(--muted);">${escHtml(e.customer_name || '—')}</td>
      <td style="padding:6px 8px;font-size:12px;color:var(--danger);">${pr}</td>
      ${waiveCell}
    </tr>`;
  };

  const waiveTh = canWaive ? `<th style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 8px;text-align:center;">Waive</th>` : '';
  const theadHtml = `<thead><tr>${th('chargeback_date','CB Date')}${th('sale_date','Sale Date')}${th('agent','Agent')}${th('product','Product')}<th style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 8px;">Customer</th>${th('premium','Premium')}${waiveTh}</tr></thead>`;

  const orgGroups = _getOrgGroups();
  if (orgGroups && _cbAgentFilter === 'all') {
    // org chart sections — one table per CO group
    const agentToGroup = {};
    orgGroups.forEach(g => g.agentIds.forEach(id => { agentToGroup[id] = g; }));
    listEl.innerHTML = orgGroups.map(group => {
      const groupEntries = filtered.filter(e => group.agentIds.includes(e.agent_id));
      if (!groupEntries.length) return '';
      const sorted = [...groupEntries].sort(cbSortFn);
      const hdrColor = group.isUnassigned ? 'var(--muted)' : 'var(--accent)';
      const hdrLabel = group.isUnassigned ? 'Unassigned' : `Chief Officer: ${escHtml(group.label)}`;
      const gCount = groupEntries.length;
      const gPrem  = groupEntries.reduce((s, e) => s + (parseFloat(e.written_premium) || 0), 0);
      return `<div style="margin-bottom:1.25rem;">
        <div style="font-size:12px;font-weight:700;color:${hdrColor};padding:.35rem .5rem;background:rgba(255,255,255,.04);border-radius:5px;margin-bottom:.4rem;display:flex;align-items:center;gap:8px;">
          ${hdrLabel}
          <span style="font-size:11px;font-weight:400;color:var(--muted);">${gCount} chargeback${gCount !== 1 ? 's' : ''} · $${gPrem.toLocaleString('en-US',{maximumFractionDigits:0})}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">${theadHtml}<tbody>${sorted.map(renderCbRow).join('')}</tbody></table>
      </div>`;
    }).filter(Boolean).join('');
  } else {
    const sorted = [...filtered].sort(cbSortFn);
    listEl.innerHTML = `<table style="width:100%;border-collapse:collapse;">${theadHtml}<tbody>${sorted.map(renderCbRow).join('')}</tbody></table>`;
  }
}

async function toggleCbExempt(hash, exempt) {
  try {
    await fetch('/api/sales', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, chargeback_exempt: exempt }),
    });
    const entry = _cbAllEntries.find(e => e.hash === hash);
    if (entry) entry.chargeback_exempt = exempt;
    renderChargebackReport();
  } catch(e) { console.error('toggleCbExempt:', e); }
}

function _renderSlScorecard(entries) {
  const sc = document.getElementById('sl-scorecard');
  if (!sc) return;
  const counts = {};
  const prems  = {};
  entries.forEach(e => {
    if (!e.product) return;
    counts[e.product] = (counts[e.product] || 0) + 1;
    if (e.written_premium) prems[e.product] = (prems[e.product] || 0) + parseFloat(e.written_premium);
  });
  const fmtN  = n => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const pill  = (content, extra='') => `<span style="font-size:11px;background:var(--deep);border:1px solid var(--border);border-radius:10px;padding:3px 8px;white-space:nowrap;display:inline-flex;flex-direction:column;align-items:center;line-height:1.3;${extra}">${content}</span>`;
  const order = ['auto','fire','health','wl','ul','term','deposit','other'];
  const parts = order.filter(k => counts[k]).map(k => {
    const label = (_productTypes.find(p => p.key === k)?.label) || labelForCat(k);
    const prem  = prems[k] ? `<div style="font-size:10px;color:var(--muted);margin-top:1px;">$${fmtN(prems[k])}</div>` : '';
    return pill(`${escHtml(label)} <strong>${counts[k]}</strong>${prem}`);
  });

  // Totals pill pushed to the right
  const totalCount = entries.length;
  const totalPrem  = Object.values(prems).reduce((a, b) => a + b, 0);
  if (totalCount) {
    const premStr = totalPrem ? `<div style="font-size:10px;color:var(--muted);margin-top:1px;">$${fmtN(totalPrem)}</div>` : '';
    parts.push(pill(`Total <strong>${totalCount}</strong>${premStr}`, 'margin-left:auto;border-color:rgba(0,212,255,.4);'));
  }

  // Goal progress pills (only when a location is selected and it has goals enabled)
  if (_salesLogLocationFilter && _salesLogLocationFilter !== 'all') {
    const loc = _salesLocations.find(l => l.name === _salesLogLocationFilter);
    if (loc?.goals_enabled) {
      if (loc.goal_count) {
        const met  = totalCount >= loc.goal_count;
        const pct  = totalCount / loc.goal_count;
        const col  = met ? 'var(--accent2)' : pct >= 0.8 ? '#ffa94d' : 'var(--text)';
        const bord = met ? 'border-color:var(--accent2);' : pct >= 0.8 ? 'border-color:#ffa94d;' : '';
        const txt  = met ? '✓ Policy Goal!' : `${loc.goal_count - totalCount} to policy goal`;
        parts.push(pill(`<span style="color:${col};">${escHtml(txt)}</span> <strong style="color:${col};">${totalCount} / ${fmtN(loc.goal_count)}</strong>`, bord));
      }
      if (loc.goal_premium) {
        const met  = totalPrem >= loc.goal_premium;
        const pct  = totalPrem / loc.goal_premium;
        const col  = met ? 'var(--accent2)' : pct >= 0.8 ? '#ffa94d' : 'var(--text)';
        const bord = met ? 'border-color:var(--accent2);' : pct >= 0.8 ? 'border-color:#ffa94d;' : '';
        const rem  = Math.ceil(loc.goal_premium - totalPrem);
        const txt  = met ? '✓ Premium Goal!' : `$${fmtN(rem)} to premium goal`;
        parts.push(pill(`<span style="color:${col};">${escHtml(txt)}</span> <strong style="color:${col};">$${fmtN(totalPrem)} / $${fmtN(loc.goal_premium)}</strong>`, bord));
      }
      // Activity goal pills — only when bonus log data is available
      if (loc.activity_goals && (Object.keys(loc.activity_goals).length > 0) && (_bonusLogEntries.length || _bonusLogCallTotals.length)) {
        for (const [typeId, goalVal] of Object.entries(loc.activity_goals)) {
          const actType = _activityTypes.find(a => a.id === typeId);
          if (!actType) continue;
          // Calculate total count for this activity type
          let actCount = 0;
          if (actType.source === 'call_log') {
            actCount = _bonusLogCallTotals.filter(x => x.activity_type_id === typeId).reduce((s, x) => s + x.count, 0);
          } else {
            actCount = _bonusLogEntries.filter(x => x.activity_type_id === typeId).reduce((s, x) => s + x.count, 0);
          }
          const goal = parseFloat(goalVal);
          if (!goal) continue;
          const met  = actCount >= goal;
          const pct  = actCount / goal;
          const col  = met ? 'var(--accent2)' : pct >= 0.8 ? '#ffa94d' : 'var(--text)';
          const bord = met ? 'border-color:var(--accent2);' : pct >= 0.8 ? 'border-color:#ffa94d;' : '';
          const txt  = met ? `✓ ${actType.name}!` : `${actType.name}`;
          parts.push(pill(`<span style="color:${col};">${escHtml(txt)}</span> <strong style="color:${col};">${actCount} / ${fmtN(goal)}</strong>`, bord));
        }
      }
    }
  } else {
    // "All Locations" — aggregate goals across all enabled locations
    const enabledLocs = (_salesLocations || []).filter(l => l.goals_enabled && l.active !== false);
    if (enabledLocs.length > 0) {
      const totalCountGoal = enabledLocs.reduce((s, l) => s + (parseInt(l.goal_count) || 0), 0);
      const totalPremGoal  = enabledLocs.reduce((s, l) => s + (parseFloat(l.goal_premium) || 0), 0);

      if (totalCountGoal > 0) {
        const actual = entries.length;
        const pct    = totalCountGoal > 0 ? actual / totalCountGoal : 0;
        const color  = pct >= 1 ? 'rgba(0,229,180,.4)' : pct >= 0.8 ? 'rgba(255,179,0,.4)' : 'rgba(255,255,255,.15)';
        const textColor = pct >= 1 ? 'var(--accent2)' : pct >= 0.8 ? '#ffb300' : 'var(--muted)';
        parts.push(pill(`All Offices: <strong>${actual}</strong><span style="font-size:10px;color:${textColor};display:block;">/ ${totalCountGoal} goal</span>`, `border-color:${color};`));
      }
      if (totalPremGoal > 0) {
        const actualPrem = Object.values(prems).reduce((a,b)=>a+b,0);
        const pct    = totalPremGoal > 0 ? actualPrem / totalPremGoal : 0;
        const color  = pct >= 1 ? 'rgba(0,229,180,.4)' : pct >= 0.8 ? 'rgba(255,179,0,.4)' : 'rgba(255,255,255,.15)';
        const textColor = pct >= 1 ? 'var(--accent2)' : pct >= 0.8 ? '#ffb300' : 'var(--muted)';
        parts.push(pill(`Premium: <strong>$${fmtN(actualPrem)}</strong><span style="font-size:10px;color:${textColor};display:block;">/ $${fmtN(totalPremGoal)} goal</span>`, `border-color:${color};`));
      }

      // Activity goals aggregated across all enabled locations
      if (_bonusLogEntries.length || _bonusLogCallTotals.length) {
        const combinedActGoals = {};
        for (const l of enabledLocs) {
          for (const [typeId, goal] of Object.entries(l.activity_goals || {})) {
            combinedActGoals[typeId] = (combinedActGoals[typeId] || 0) + parseFloat(goal);
          }
        }
        for (const [typeId, goalVal] of Object.entries(combinedActGoals)) {
          const actType = _activityTypes.find(t => t.id === typeId);
          if (!actType || actType.active === false) continue;
          let actual = 0;
          if (actType.source === 'call_log') {
            actual = _bonusLogCallTotals.filter(x => x.activity_type_id === typeId).reduce((s,r)=>s+r.count,0);
          } else {
            actual = _bonusLogEntries.filter(e => e.activity_type_id === typeId && (e.status === 'approved' || !e.status)).reduce((s,e)=>s+e.count,0);
          }
          const pct = goalVal > 0 ? actual / goalVal : 0;
          const color = pct >= 1 ? 'rgba(0,229,180,.4)' : pct >= 0.8 ? 'rgba(255,179,0,.4)' : 'rgba(255,255,255,.15)';
          const textColor = pct >= 1 ? 'var(--accent2)' : pct >= 0.8 ? '#ffb300' : 'var(--muted)';
          parts.push(pill(`${escHtml(actType.name)}: <strong>${actual}</strong><span style="font-size:10px;color:${textColor};display:block;">/ ${goalVal} goal</span>`, `border-color:${color};`));
        }
      }
    }
  }

  sc.innerHTML = parts.join('');
}

// ── Basic Sales Breakdown (no add-on, upload-only users) ─────────────────────

async function loadBasicSalesBreakdown(targetId) {
  const id        = targetId || 'basic-sales-breakdown';
  const container = document.getElementById(id);
  if (!container) return;
  const isChartPane = id === 'sp-empty-state';

  const SKIP = new Set(['other','other2','other3','other4','other5','deposit','skip']);
  const cats = activeCats().filter(c => !SKIP.has(c.key));

  // Fetch historical wins (product columns only)
  const { data: histRows } = await _supabase
    .from('historical_wins')
    .select('month, wl, ul, term, health, auto, fire')
    .eq('user_id', _dataUserId);

  const FULL_TO_ABBR = {
    January:'Jan', February:'Feb', March:'Mar',  April:'Apr',
    May:'May',     June:'Jun',     July:'Jul',   August:'Aug',
    September:'Sep', October:'Oct', November:'Nov', December:'Dec',
  };
  const MONTH_ORDER = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

  // Aggregate historical months (sum all agents per month)
  const monthTotals = {};
  for (const row of (histRows || [])) {
    const parts = row.month.trim().split(' ');
    const norm  = (FULL_TO_ABBR[parts[0]] || parts[0]) + ' ' + parts[1];
    if (!monthTotals[norm]) monthTotals[norm] = {};
    for (const c of cats) monthTotals[norm][c.key] = (monthTotals[norm][c.key] || 0) + (row[c.key] || 0);
  }

  const sortedMonths = Object.keys(monthTotals).sort((a, b) => {
    const [am, ay] = [MONTH_ORDER[a.split(' ')[0]], parseInt(a.split(' ')[1])];
    const [bm, by] = [MONTH_ORDER[b.split(' ')[0]], parseInt(b.split(' ')[1])];
    return ay !== by ? ay - by : am - bm;
  }).slice(-12); // last 12 archived months

  // Current period — prefer _spEntries (same source as SP charts) so numbers match.
  // Fall back to race_data for upload-only accounts that have no _spEntries.
  const ABBR12 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let curKey;
  if (_raceCurrentMonth) {
    const _rp = _raceCurrentMonth.trim().split(' ');
    const _ri = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(_rp[0]);
    curKey = (_ri >= 0 ? ABBR12[_ri] : _rp[0]) + ' ' + _rp[1];
  } else {
    const now = new Date();
    curKey = `${ABBR12[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  }
  const curTotals = {};
  for (const c of cats) curTotals[c.key] = 0;
  const useSPEntries = Array.isArray(_spEntries) && _spEntries.length > 0;
  if (useSPEntries) {
    for (const e of _spEntries) {
      if (e.product && curTotals[e.product] !== undefined) curTotals[e.product]++;
    }
  } else {
    for (const ag of (_raceData || [])) {
      for (const c of cats) curTotals[c.key] += (ag[c.key] || 0);
    }
  }
  const hasCurData = cats.some(c => curTotals[c.key] > 0);

  if (!sortedMonths.length && !hasCurData) {
    container.style.display = 'none';
    return;
  }

  const th = t => `<th style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;padding:4px 8px;text-align:center;white-space:nowrap;border-bottom:1px solid var(--border);">${t}</th>`;
  const td = (v, hi) => `<td style="text-align:center;padding:3px 8px;font-family:'DM Mono',monospace;font-size:12px;color:${hi ? 'var(--accent2)' : v ? 'var(--text)' : 'var(--muted)'};">${v || '—'}</td>`;

  // Month × product team-total table
  const histTableRows = sortedMonths.map(mon => {
    const row   = monthTotals[mon] || {};
    const total = cats.reduce((s, c) => s + (row[c.key] || 0), 0);
    return `<tr>
      <td style="padding:3px 8px;font-size:12px;white-space:nowrap;">${mon}</td>
      ${cats.map(c => td(row[c.key] || 0)).join('')}
      ${td(total, true)}
    </tr>`;
  });

  if (hasCurData) {
    const curTotal = cats.reduce((s, c) => s + curTotals[c.key], 0);
    histTableRows.push(`<tr style="border-top:1px solid var(--border);">
      <td style="padding:3px 8px;font-size:12px;font-weight:700;color:var(--accent2);white-space:nowrap;">${curKey} ▸</td>
      ${cats.map(c => td(curTotals[c.key] || 0)).join('')}
      ${td(curTotal, true)}
    </tr>`);
  }

  // Per-agent breakdown for current period
  let agentSection = '';
  if (hasCurData) {
    let agentsSorted;
    if (useSPEntries) {
      const agMap = {};
      for (const e of _spEntries) {
        if (!e.agent_id || !e.product || curTotals[e.product] === undefined) continue;
        if (!agMap[e.agent_id]) {
          const n = _agentRoster.find(a => a.agent_id === e.agent_id)?.name || e.agent_id;
          agMap[e.agent_id] = { name: n, total: 0, products: {} };
          for (const c of cats) agMap[e.agent_id].products[c.key] = 0;
        }
        if (agMap[e.agent_id].products[e.product] !== undefined) {
          agMap[e.agent_id].products[e.product]++;
          agMap[e.agent_id].total++;
        }
      }
      agentsSorted = Object.values(agMap).filter(ag => ag.total > 0).sort((a, b) => b.total - a.total);
    } else {
      agentsSorted = (_raceData || [])
        .map(ag => {
          const products = {};
          let total = 0;
          for (const c of cats) { products[c.key] = ag[c.key] || 0; total += products[c.key]; }
          return { name: ag.name || ag.agent_id, total, products };
        })
        .filter(ag => ag.total > 0)
        .sort((a, b) => b.total - a.total);
    }

    if (agentsSorted.length) {
      agentSection = `
        <div style="margin-top:1.25rem;">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.5rem;">Current Period — By Agent</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr>${th('Agent')}${cats.map(c => th(c.label)).join('')}${th('Total')}</tr></thead>
              <tbody>${agentsSorted.map(ag => `<tr>
                <td style="padding:3px 8px;font-size:12px;white-space:nowrap;">${escHtml(ag.name)}</td>
                ${cats.map(c => td(ag.products[c.key] || 0)).join('')}
                ${td(ag.total, true)}
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`;
    }
  }

  const periodCount = sortedMonths.length + (hasCurData ? 1 : 0);
  const chartNote = isChartPane
    ? `<div class="panel" style="margin-bottom:1rem;padding:.875rem 1rem;text-align:center;">
        <span style="font-size:13px;color:var(--muted);">Sales Performance charts use manually entered and checklist sales. Your uploaded data is summarised below — switch to manual entry in Account → Sales to unlock drilldown by lead source, location, and subcategory.</span>
      </div>`
    : '';
  container.style.display = '';
  container.innerHTML = chartNote + `<div class="panel" style="margin-bottom:1rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
      <div style="font-size:13px;font-weight:700;color:var(--text);text-transform:uppercase;letter-spacing:.04em;">Sales Overview</div>
      <span style="font-size:11px;color:var(--muted);">${periodCount} period${periodCount !== 1 ? 's' : ''}</span>
    </div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>${th('Period')}${cats.map(c => th(c.label)).join('')}${th('Total')}</tr></thead>
        <tbody>${histTableRows.join('')}</tbody>
      </table>
    </div>
    ${agentSection}
  </div>`;
}

