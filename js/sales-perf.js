// ── Sales Performance Tab ─────────────────────────────────────────────────────

const SP_DIMS = [
  { key: 'product',     label: 'Product Type' },
  { key: 'lead_source', label: 'Lead Source'  },
  { key: 'agent',       label: 'Agent'        },
  { key: 'subcategory', label: 'Subcategory'  },
  { key: 'location',    label: 'Location'     },
  { key: 'period',      label: 'Period'       },
  { key: 'auto_issued', label: 'Auto Issued'  },
  { key: 'split_sale',  label: 'Split Sale'   },
];

const SP_NEXT = { product: 'subcategory', subcategory: 'agent', agent: 'product', lead_source: 'agent' };

const SP_COLORS = [
  '#00d4ff','#7b61ff','#00e5b4','#ff6b6b','#ffa94d',
  '#74c0fc','#d0bfff','#96f2d7','#ffc9c9','#ffec99',
  '#b2f2bb','#a5d8ff','#f3d9fa','#ffdeeb',
];

function spFieldVal(key, e) {
  switch (key) {
    case 'product':     return e.product     || 'Unknown';
    case 'lead_source': return e.lead_source || '(None)';
    case 'agent':       { const a = _agentRoster.find(r => r.agent_id === e.agent_id); return a ? a.name : (e.agent_id || '(None)'); }
    case 'subcategory': return e.subcategory || '(None)';
    case 'location':    return e.location    || '(None)';
    case 'period':      return e.period ? e.period + ' mo' : '(None)';
    case 'auto_issued': return e.auto_issued ? 'Issued' : 'Not Issued';
    case 'split_sale':  return e.split_sale  ? 'Split Sale' : 'Full Sale';
    default:            return 'Unknown';
  }
}

function spDisplayLabel(key, rawVal) {
  if (key === 'product') { const pt = _productTypes.find(p => p.key === rawVal); return pt ? pt.label : rawVal; }
  return rawVal;
}

function spActiveEntries() {
  let entries = _spEntries;
  if (_spLocationFilter && _spLocationFilter !== 'all') {
    entries = entries.filter(e => (e.location || '').trim() === _spLocationFilter);
  }
  _spCrumbs.forEach(c => { entries = entries.filter(e => spFieldVal(c.field, e) === c.value); });
  return entries;
}

function onSpLocationChange() {
  _spLocationFilter = document.getElementById('sp-location-filter')?.value || 'all';
  _spCrumbs = [];
  _spDim1 = 'product'; _spDim2 = 'lead_source';
  const s1 = document.getElementById('sp-dim1'); if (s1) s1.value = _spDim1;
  const s2 = document.getElementById('sp-dim2'); if (s2) s2.value = _spDim2;
  spRender();
}

function _spPopulateLocationFilter() {
  const sel = document.getElementById('sp-location-filter');
  if (!sel) return;
  const locs = [...new Set(_spEntries.map(e => (e.location || '').trim()).filter(Boolean))].sort();
  if (!locs.length) { sel.style.display = 'none'; _spLocationFilter = 'all'; return; }
  sel.style.display = '';
  const cur = sel.value;
  sel.innerHTML = '<option value="all">All Locations</option>'
    + locs.map(l => `<option value="${escHtml(l)}">${escHtml(l)}</option>`).join('');
  if (locs.includes(cur)) { sel.value = cur; _spLocationFilter = cur; }
  else { sel.value = 'all'; _spLocationFilter = 'all'; }
}

function spGroup(entries, dimKey) {
  const g = {};
  entries.forEach(e => {
    const k = spFieldVal(dimKey, e);
    if (!g[k]) g[k] = { count: 0, premium: 0 };
    g[k].count++;
    if (e.written_premium) g[k].premium += parseFloat(e.written_premium) || 0;
  });
  return g;
}

async function spLoad() {
  const loading = document.getElementById('sp-loading');
  const grid    = document.getElementById('sp-charts-grid');
  if (loading) loading.style.display = '';
  if (grid)    grid.style.display    = 'none';
  try {
    let params;
    if (_spDateMode === 'month') {
      const [y, m] = _spDateMonth.split('-');
      params = new URLSearchParams({ month: m, year: y });
    } else if (_spDateMode === 'year') {
      params = new URLSearchParams({ year: _spDateYear, allYear: '1' });
    } else {
      params = new URLSearchParams({ fromDate: _spDateStart, toDate: _spDateEnd });
    }
    const r = await fetch(`/api/sales?${params}`, { headers: authHeaders() });
    const d = await r.json();
    _spEntries = d.entries || [];
  } catch (err) {
    console.error('spLoad:', err);
    _spEntries = [];
  } finally {
    if (loading) loading.style.display = 'none';
    if (grid)    grid.style.display    = '';
  }
  _spPopulateLocationFilter();
  spRender();
}

function spRender() {
  const entries = spActiveEntries();
  spRenderSummary(entries);
  spRenderCrumbs();
  const grid    = document.getElementById('sp-charts-grid');
  const emptyEl = document.getElementById('sp-empty-state');
  if (!entries.length && !_spCrumbs.length) {
    if (grid)    grid.style.display    = 'none';
    if (emptyEl) { emptyEl.style.display = ''; loadBasicSalesBreakdown('sp-empty-state').catch(() => {}); }
    return;
  }
  if (grid)    grid.style.display    = '';
  if (emptyEl) emptyEl.style.display = 'none';
  spBuildChart(1, _spDim1, entries);
  spBuildChart(2, _spDim2, entries);
}

function spRenderSummary(entries) {
  const el = document.getElementById('sp-summary');
  if (!el) return;
  const count = entries.length;
  const prem  = entries.reduce((s, e) => s + (parseFloat(e.written_premium) || 0), 0);
  el.textContent = count + (count === 1 ? ' policy' : ' policies') +
    (prem ? '  ·  $' + prem.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' premium' : '');
}

function spRenderCrumbs() {
  const el = document.getElementById('sp-crumbs');
  if (!el) return;
  if (!_spCrumbs.length) { el.innerHTML = ''; return; }
  const sep = '<span style="color:var(--muted);font-size:12px;margin:0 3px;">›</span>';
  const all = `<span style="font-size:12px;color:var(--muted);cursor:pointer;" onclick="spDrillBack(-1)">All</span>`;
  const parts = _spCrumbs.map((c, i) =>
    `${sep}<span style="font-size:12px;color:var(--accent);cursor:pointer;" onclick="spDrillBack(${i})">${escHtml(c.label)}</span>`
  ).join('');
  const reset = `<button onclick="spDrillBack(-1)" style="margin-left:8px;background:none;border:1px solid var(--border);color:var(--muted);cursor:pointer;border-radius:6px;padding:1px 8px;font-size:11px;">Reset</button>`;
  el.innerHTML = `<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:.35rem .7rem;background:var(--deep);border:1px solid var(--border2);border-radius:8px;">${all}${parts}${reset}</div>`;
}

function spDrillBack(idx) {
  if (idx < 0) {
    _spCrumbs = [];
    _spDim1 = 'product'; _spDim2 = 'lead_source';
  } else {
    const c = _spCrumbs[idx];
    if (c.fromChart === 1 && c.prevDim) _spDim1 = c.prevDim;
    if (c.fromChart === 2 && c.prevDim) _spDim2 = c.prevDim;
    _spCrumbs = _spCrumbs.slice(0, idx);
  }
  const s1 = document.getElementById('sp-dim1'); if (s1) s1.value = _spDim1;
  const s2 = document.getElementById('sp-dim2'); if (s2) s2.value = _spDim2;
  spRender();
}

function spBuildChart(num, dimKey, entries) {
  const wrapId   = `sp-chart${num}-wrap`;
  const canvasId = `sp-chart${num}`;
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;

  const existing = num === 1 ? _spChart1 : _spChart2;
  if (existing) { existing.destroy(); if (num === 1) _spChart1 = null; else _spChart2 = null; }

  const groups  = spGroup(entries, dimKey);
  const rawKeys = Object.keys(groups).sort((a, b) => groups[b][_spMetric] - groups[a][_spMetric]);

  wrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;

  if (!rawKeys.length) {
    wrap.innerHTML += `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px;">No data for selection</div>`;
    return;
  }

  const labels = rawKeys.map(k => spDisplayLabel(dimKey, k));
  const data   = rawKeys.map(k => _spMetric === 'premium' ? (groups[k].premium || 0) : groups[k].count);

  const ctx = document.getElementById(canvasId).getContext('2d');
  const chart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: SP_COLORS.slice(0, rawKeys.length),
        borderColor: '#0e0e24',
        borderWidth: 2,
        hoverBorderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#aaaacc', font: { size: 11 }, padding: 10, boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const v     = ctx.parsed;
              const total = ctx.dataset.data.reduce((s, x) => s + x, 0);
              const pct   = total ? ((v / total) * 100).toFixed(1) : '0.0';
              return _spMetric === 'premium'
                ? `${ctx.label}: $${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} (${pct}%)`
                : `${ctx.label}: ${v} (${pct}%)`;
            },
          },
        },
      },
      onClick: (_ev, els) => {
        if (!els.length) return;
        const i = els[0].index;
        spHandleClick(num, dimKey, rawKeys[i], labels[i]);
      },
    },
  });

  if (num === 1) _spChart1 = chart;
  else           _spChart2 = chart;
}

function spHandleClick(chartNum, dimKey, rawValue, displayLabel) {
  if (_spCrumbs.some(c => c.field === dimKey && c.value === rawValue)) return;
  const prevDim = chartNum === 1 ? _spDim1 : _spDim2;
  _spCrumbs.push({ field: dimKey, value: rawValue, label: displayLabel, fromChart: chartNum, prevDim });
  const next = SP_NEXT[dimKey];
  if (next) {
    if (chartNum === 1) { _spDim1 = next; const s = document.getElementById('sp-dim1'); if (s) s.value = next; }
    else               { _spDim2 = next; const s = document.getElementById('sp-dim2'); if (s) s.value = next; }
  }
  spRender();
}

function spSetMode(mode, btn) {
  _spDateMode = mode;
  document.querySelectorAll('#sp-date-modes .acct-stab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sp-range-month').style.display  = mode === 'month'  ? 'flex' : 'none';
  document.getElementById('sp-range-year').style.display   = mode === 'year'   ? 'flex' : 'none';
  document.getElementById('sp-range-custom').style.display = mode === 'custom' ? 'flex' : 'none';
  spLoad();
}

function spRangeChanged() {
  if (_spDateMode === 'month') {
    _spDateMonth = document.getElementById('sp-month-input')?.value || _spDateMonth;
  } else if (_spDateMode === 'year') {
    _spDateYear = document.getElementById('sp-year-input')?.value || _spDateYear;
  } else {
    _spDateStart = document.getElementById('sp-date-start')?.value || _spDateStart;
    _spDateEnd   = document.getElementById('sp-date-end')?.value   || _spDateEnd;
    if (!_spDateStart || !_spDateEnd) return;
  }
  spLoad();
}

function spNavMonth(dir) {
  const el = document.getElementById('sp-month-input');
  if (!el || !el.value) return;
  const [y, m] = el.value.split('-').map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  el.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  spRangeChanged();
}

function spSetMetric(metric, btn) {
  _spMetric = metric;
  document.querySelectorAll('#sp-metric-toggle .acct-stab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  spRender();
}

function spDimChanged(num, sel) {
  if (num === 1) _spDim1 = sel.value;
  else           _spDim2 = sel.value;
  spRender();
}

function spInitDimSelects() {
  const opts = SP_DIMS.map(d => `<option value="${d.key}">${escHtml(d.label)}</option>`).join('');
  const s1 = document.getElementById('sp-dim1'); if (s1) { s1.innerHTML = opts; s1.value = _spDim1; }
  const s2 = document.getElementById('sp-dim2'); if (s2) { s2.innerHTML = opts; s2.value = _spDim2; }
}

function spInitYearSelect() {
  const ySel = document.getElementById('sp-year-input');
  if (!ySel || ySel.options.length) return;
  const cur = parseInt(_spDateYear);
  let html = '';
  for (let y = cur + 1; y >= cur - 4; y--) {
    html += `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`;
  }
  ySel.innerHTML = html;
}

async function initSalesPerf() {
  if (!_spDateMonth) {
    // Prefer the current race month so the view opens on active sales data.
    // Fall back to calendar month only if no race month is configured.
    const MONTH_NAMES_FULL = ['January','February','March','April','May','June',
                              'July','August','September','October','November','December'];
    let y, m;
    if (_raceCurrentMonth) {
      const parts = _raceCurrentMonth.trim().split(' ');
      const idx = MONTH_NAMES_FULL.indexOf(parts[0]);
      const yr  = parseInt(parts[1]);
      if (idx !== -1 && !isNaN(yr)) {
        y = yr;
        m = String(idx + 1).padStart(2, '0');
      }
    }
    if (!y) {
      const now = new Date();
      y = now.getFullYear();
      m = String(now.getMonth() + 1).padStart(2, '0');
    }
    _spDateMonth = `${y}-${m}`;
    _spDateYear  = String(y);
    const lastDay = new Date(y, parseInt(m), 0).getDate();
    _spDateStart  = `${y}-${m}-01`;
    _spDateEnd    = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  }
  spInitDimSelects();
  spInitYearSelect();
  const mInp = document.getElementById('sp-month-input');
  if (mInp) mInp.value = _spDateMonth;
  await spLoad();
}

function _filteredSalesEntries() {
  const q = (document.getElementById('sales-log-search')?.value || '').toLowerCase().trim();
  let entries = _salesLogEntries;
  if (_salesLogLocationFilter && _salesLogLocationFilter !== 'all') {
    entries = entries.filter(e => (e.location || '').trim() === _salesLogLocationFilter);
  }
  if (_salesLogIssuedFilter === 'issued') {
    entries = entries.filter(e => !!e.issued_date);
  } else if (_salesLogIssuedFilter === 'unissued') {
    entries = entries.filter(e => !e.issued_date);
  }
  if (!q) return entries;
  return entries.filter(e => {
    const agName = _agentRoster.find(a => a.agent_id === e.agent_id)?.name || e.agent_id || '';
    return (e.customer_name || '').toLowerCase().includes(q)
        || agName.toLowerCase().includes(q)
        || (e.product || '').toLowerCase().includes(q)
        || labelForCat(e.product).toLowerCase().includes(q)
        || (e.subcategory || '').toLowerCase().includes(q)
        || (e.sale_date || '').includes(q)
        || (e.issued_date || '').includes(q);
  });
}

function renderSalesLog() {
  const list = document.getElementById('checklist-subs-list');
  if (!list) return;
  const entries = _filteredSalesEntries();
  const q = (document.getElementById('sales-log-search')?.value || '').trim();

  // Determine "in scope" boundary
  const yearStr = String(_salesLogYear);
  const fromDate = _salesLogCustomFrom || `${_salesLogYear}-${String(_salesLogMonth).padStart(2,'0')}-01`;
  const lastDay  = new Date(_salesLogYear, _salesLogMonth, 0).getDate();
  const toDate   = _salesLogCustomTo   || `${_salesLogYear}-${String(_salesLogMonth).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const inScope  = (_salesLogAllYear && !_salesLogCustomFrom)
    ? (e) => (e.sale_date || '').startsWith(yearStr + '-')
    : (e) => e.sale_date >= fromDate && e.sale_date <= toDate;

  const scopeEntries = entries.filter(inScope);
  const crossEntries = entries.filter(e => !inScope(e));

  const sortFn = (a, b) => {
    const d = (a.issued_date ? 1 : 0) - (b.issued_date ? 1 : 0);
    return d !== 0 ? d : (b.sale_date || '').localeCompare(a.sale_date || '');
  };
  scopeEntries.sort(sortFn);
  crossEntries.sort((a, b) => (b.sale_date || '').localeCompare(a.sale_date || ''));

  _renderSlScorecard(scopeEntries);

  if (!scopeEntries.length && !crossEntries.length) {
    list.innerHTML = `<span style="color:var(--muted);font-size:13px;">${q ? 'No matches.' : _salesLogAllYear ? 'No entries for this year.' : 'No entries for this month.'}</span>`;
    return;
  }

  const canEdit = _isAdmin || !_isMember || ['captain', 'chief_officer'].includes(_memberRole) || !!_selfReportConfig?.sales_log_edit_enabled;

  const renderRow = (e) => {
    const cat      = labelForCat(e.product);
    const src      = e.source === 'checklist' ? '🔗' : '✏️';
    const agName   = _agentRoster.find(a => a.agent_id === e.agent_id)?.name || e.agent_id || '—';
    const premium  = e.written_premium ? '$' + Number(e.written_premium).toFixed(2) : '—';
    const isHidden = !!e.hidden;
    const isUnissued = !e.issued_date;

    const chargebackBadge = e.is_cancelled
      ? `<span style="font-size:11px;font-weight:600;color:#ff6b6b;background:rgba(255,107,107,.12);padding:1px 7px;border-radius:10px;white-space:nowrap;">Chargeback${e.chargeback_date ? ' ' + e.chargeback_date : ''}</span>`
      : '';
    const issuedBadge = e.issued_date
      ? `<span style="font-size:11px;font-weight:600;color:var(--accent2);background:rgba(0,200,120,.12);padding:1px 7px;border-radius:10px;white-space:nowrap;">Issued ✓</span>`
      : isHidden
        ? `<span style="font-size:11px;font-weight:600;color:var(--muted);background:rgba(150,150,150,.12);padding:1px 7px;border-radius:10px;white-space:nowrap;">Hidden</span>`
        : `<span style="font-size:11px;font-weight:600;color:#f59e0b;background:rgba(245,158,11,.12);padding:1px 7px;border-radius:10px;white-space:nowrap;">Not Issued</span>`;

    const hideBtn = (canEdit && isUnissued)
      ? `<button onclick="toggleSalesLogHidden('${e.hash}',${!isHidden},this)" title="${isHidden ? 'Unhide' : 'Hide'}" style="background:none;border:1px solid var(--border);color:${isHidden ? 'var(--muted)' : '#f59e0b'};font-size:11px;padding:2px 7px;border-radius:5px;cursor:pointer;white-space:nowrap;">${isHidden ? 'Unhide' : 'Hide'}</button>`
      : '';

    const editBtn = canEdit
      ? `<button onclick="editSalesLogRow('${e.hash}')" style="background:none;border:1px solid var(--border);color:var(--text);font-size:11px;padding:2px 8px;border-radius:5px;cursor:pointer;white-space:nowrap;">Edit</button>
         <button onclick="deleteSalesLogRow('${e.hash}',this)" data-confirming="" style="background:none;border:1px solid var(--border);color:var(--danger);font-size:11px;padding:2px 8px;border-radius:5px;cursor:pointer;">✕</button>`
      : '';
    const editForm = canEdit ? `<div id="sl-edit-${e.hash}" style="display:none;">${_buildSlEditForm(e)}</div>` : '';

    return `<div id="sl-row-${e.hash}" style="border-bottom:1px solid var(--border2);padding:7px 0;${isHidden ? 'opacity:.5;' : ''}${e.is_cancelled ? 'background:rgba(255,100,100,.04);' : ''}">
      <div style="display:grid;grid-template-columns:18px 82px 1fr 1fr 1fr 60px auto auto auto auto;gap:8px;align-items:center;">
        <span style="font-size:14px;">${src}</span>
        <span style="font-size:11px;color:var(--muted);">${e.sale_date || '—'}</span>
        <span style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(agName)}</span>
        <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(cat + (e.subcategory ? ' · ' + e.subcategory : '') + (e.location ? ' @ ' + e.location : ''))}">${escHtml(cat)}${e.subcategory ? '<br><span style="color:var(--muted);font-size:11px;">' + escHtml(e.subcategory) + '</span>' : ''}${e.location ? '<br><span style="color:var(--muted);font-size:11px;">📍 ' + escHtml(e.location) + '</span>' : ''}</span>
        <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(e.customer_name || '—')}</span>
        <span style="font-size:12px;color:var(--accent2);text-align:right;">${premium}</span>
        ${issuedBadge}
        ${chargebackBadge}
        <div style="display:flex;gap:4px;">${hideBtn}</div>
        <div style="display:flex;gap:4px;">${editBtn}</div>
      </div>
      ${editForm}
    </div>`;
  };

  let html = scopeEntries.length
    ? scopeEntries.map(renderRow).join('')
    : `<div style="font-size:13px;color:var(--muted);padding:4px 0 8px;">No entries for the selected ${_salesLogAllYear ? 'year' : 'month'}.</div>`;

  if (crossEntries.length) {
    const crossLabel = _salesLogAllYear ? 'Unissued · Prior Year' : 'Unissued · Other Months';
    html += `<div style="margin:10px 0 6px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-top:1px solid var(--border2);padding-top:8px;">${crossLabel}</div>`;
    html += crossEntries.map(renderRow).join('');
  }
  list.innerHTML = html;
}

function downloadSalesLogXlsx() {
  const entries = _filteredSalesEntries();
  if (!entries.length) return;
  fetch('/api/log-access', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'export', resource: 'sales_log', row_count: entries.length, metadata: { year: _salesLogYear, month: _salesLogMonth, all_year: _salesLogAllYear } }),
  }).catch(() => {});
  const rows = entries.map(e => ({
    'Date':          e.sale_date     || '',
    'Agent':         _agentRoster.find(a => a.agent_id === e.agent_id)?.name || e.agent_id || '',
    'Product':       labelForCat(e.product),
    'Subcategory':   e.subcategory   || '',
    'Customer':      e.customer_name || '',
    'Premium':       e.written_premium ? Number(e.written_premium).toFixed(2) : '',
    'Lead Source':   e.lead_source   || '',
    'Period':        e.period        || '',
    'Issued Date':   e.issued_date   || '',
    'Auto Issued':   e.auto_issued   ? 'Yes' : '',
    'Split Sale':    e.split_sale    ? 'Yes' : '',
    'Teammate':      e.teammate      || '',
    'Location':      e.location      || '',
    'Source':        e.source        || '',
    'Hidden':        e.hidden        ? 'Yes' : '',
    'Cancelled':      e.is_cancelled  ? 'Yes' : '',
    'Chargeback Date': e.chargeback_date || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sales Log');
  const filename = _salesLogAllYear
    ? `sales-log-${_salesLogYear}.xlsx`
    : _salesLogCustomFrom
      ? `sales-log-${_salesLogCustomFrom.slice(0,7)}-to-${_salesLogCustomTo.slice(0,7)}.xlsx`
      : `sales-log-${_salesLogYear}-${String(_salesLogMonth).padStart(2,'0')}.xlsx`;
  XLSX.writeFile(wb, filename);
}

async function toggleSalesLogHidden(hash, makeHidden, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await fetch('/api/sales', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, hidden: makeHidden }),
    });
    if (!r.ok) { const d = await r.json(); console.error('Hide toggle failed:', d.error); return; }
    await loadSalesLog();
  } catch(err) {
    console.error('toggleSalesLogHidden error:', err);
    if (btn) { btn.disabled = false; }
  }
}
function loadChecklistSubmissions() { return loadSalesLog(); }

