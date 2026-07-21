// ── PERFORMANCE TAB ───────────────────────────────────────────────────────────
async function loadPerf() {
  document.getElementById('perf-body').innerHTML =
    '<tr><td colspan="9" style="color:var(--muted);text-align:center;padding:20px">Loading…</td></tr>';
  try {
    const hdrs = authHeaders();
    const res  = await fetch('/api/perf', { headers: hdrs });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      document.getElementById('perf-body').innerHTML =
        `<tr><td colspan="9" style="color:var(--danger);text-align:center;padding:20px">Error ${res.status}: ${err.error || res.statusText}</td></tr>`;
      return;
    }
    _perfData = await res.json();
    console.log('[perf] call_log rows returned:', _perfData._debug?.rowCount ?? 'unknown');
    populatePerfDates();
    renderPerf();
    const heatmapAllowed = _isAdmin || (['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
    document.getElementById('heatmap-panel').style.display  = heatmapAllowed ? '' : 'none';
    document.getElementById('heatmap-upsell').style.display = heatmapAllowed ? 'none' : '';
    if (heatmapAllowed) { populateVmDates(); renderVmHeatmap(); }
  } catch (err) {
    console.error('loadPerf error:', err);
    document.getElementById('perf-body').innerHTML =
      `<tr><td colspan="9" style="color:var(--danger);text-align:center;padding:20px">Error: ${err.message}</td></tr>`;
  }
}

function populatePerfDates() {
  const period = document.getElementById('perf-period').value;
  const sel    = document.getElementById('perf-date');
  const prev   = sel.value;
  const rows   = _perfData?.[period] || [];
  const keys   = [...new Set(rows.map(r => r[0]))];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (period === 'daily') {
    keys.sort((a, b) => {
      const [am,ad,ay] = a.split('/').map(Number);
      const [bm,bd,by] = b.split('/').map(Number);
      return new Date(Date.UTC(ay,am-1,ad)) - new Date(Date.UTC(by,bm-1,bd));
    });
  } else if (period === 'monthly') {
    keys.sort((a, b) => {
      const [amon, ayear] = [MONTHS.indexOf(a.split(' ')[0]), parseInt(a.split(' ')[1])];
      const [bmon, byear] = [MONTHS.indexOf(b.split(' ')[0]), parseInt(b.split(' ')[1])];
      return (ayear*12+amon) - (byear*12+bmon);
    });
  } else {
    keys.sort();
  }
  keys.reverse();
  sel.innerHTML = keys.map(k => `<option value="${k}">${k}</option>`).join('');
  if (prev && keys.includes(prev)) sel.value = prev;
}

const PERF_COL_LABELS = { 1:'Agent', 3:'Placed', 4:'Answered', 5:'VM', 6:'Missed', 7:'Talk Min', 8:'Avg Min', 9:'Max Min' };

function setPerfSort(col) {
  if (_perfSortCol === col) {
    _perfSortDir = -_perfSortDir;
  } else {
    _perfSortCol = col;
    _perfSortDir = col === 1 ? 1 : -1; // agent sorts A→Z by default; numbers sort high→low
  }
  renderPerf();
}

function renderPerf() {
  if (!_perfData) return;
  const period   = document.getElementById('perf-period').value;
  const selected = document.getElementById('perf-date').value;
  const allRows  = (_perfData[period] || []).filter(r => r[0] === selected);
  const teamMap  = {};
  (_raceData || []).forEach(ag => { teamMap[ag.name] = ag.team; });

  // Keep TEAM TOTAL pinned at bottom regardless of sort
  const totals = allRows.filter(r => r[1] === '— TEAM TOTAL —');
  let agents   = allRows.filter(r => r[1] !== '— TEAM TOTAL —');

  if (_perfSortCol !== null) {
    agents.sort((a, b) => {
      const av = _perfSortCol === 1 ? (a[1] || '').toLowerCase() : (Number(a[_perfSortCol]) || 0);
      const bv = _perfSortCol === 1 ? (b[1] || '').toLowerCase() : (Number(b[_perfSortCol]) || 0);
      return av < bv ? -_perfSortDir : av > bv ? _perfSortDir : 0;
    });
  }

  // Update header sort indicators
  const theadRow = document.getElementById('perf-thead-row');
  if (theadRow) {
    theadRow.querySelectorAll('th[onclick]').forEach(th => {
      const col = parseInt((th.getAttribute('onclick') || '').replace(/\D/g, ''));
      const label = PERF_COL_LABELS[col] || '';
      th.textContent = col === _perfSortCol
        ? label + ' ' + (_perfSortDir === 1 ? '▲' : '▼')
        : label;
    });
  }

  const totalsRow = totals[0];
  const answered  = totalsRow ? (Number(totalsRow[4]) || 0) : agents.reduce((s, r) => s + (Number(r[4]) || 0), 0);
  const voicemail = totalsRow ? (Number(totalsRow[5]) || 0) : agents.reduce((s, r) => s + (Number(r[5]) || 0), 0);
  const missed    = totalsRow ? (Number(totalsRow[6]) || 0) : agents.reduce((s, r) => s + (Number(r[6]) || 0), 0);
  const inbound   = answered + voicemail + missed;
  const handleRatioEl = document.getElementById('perf-handle-ratio');
  if (handleRatioEl) {
    handleRatioEl.textContent = inbound > 0 ? `Handle Ratio: ${Math.round(answered / inbound * 100)}%` : '';
  }

  const sorted = [...agents, ...totals];
  document.getElementById('perf-body').innerHTML = sorted.map(r => {
    const isTotal  = r[1] === '— TEAM TOTAL —';
    const team     = !isTotal ? (teamMap[r[1]] || r[2]) : '';
    const teamBadge = team
      ? `<span class="team-badge ${team==='sales'?'badge-sales':'badge-service'}">${team}</span>`
      : '';
    return `<tr${isTotal?' class="total-row"':''}>
      <td>${r[1]}${teamBadge ? ' '+teamBadge : ''}</td>
      <td>${r[3]||0}</td><td>${r[4]||0}</td>
      <td>${r[5]||0}</td><td>${r[6]||0}</td>
      <td>${fmtMins(r[7])}</td><td>${fmtMins(r[8])}</td><td>${fmtMins(r[9])}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:20px">No data</td></tr>';
}

const VM_MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function vmWeekKey(dateStr) {
  const [m, d, y] = String(dateStr).split('/').map(Number);
  if (!y) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()} Week ${String(week).padStart(2, '0')}`;
}

function vmMonthKey(dateStr) {
  const [m, , y] = String(dateStr).split('/').map(Number);
  if (!y) return null;
  return `${VM_MONTH_ABBR[m - 1]} ${y}`;
}

function populateVmDates() {
  const period = document.getElementById('vm-period')?.value || 'day';
  const slots  = _perfData?.vmSlots || [];
  let keys;
  if (period === 'day') {
    keys = slots.map(r => r[0]);
  } else if (period === 'week') {
    keys = [...new Set(slots.map(r => vmWeekKey(r[0])).filter(Boolean))];
  } else {
    keys = [...new Set(slots.map(r => vmMonthKey(r[0])).filter(Boolean))];
  }
  keys.sort().reverse();
  document.getElementById('vm-date').innerHTML = keys.map(k => `<option value="${k}">${k}</option>`).join('');
}

const VM_DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function vmDayLabel(dateStr) {
  const [m, d, y] = String(dateStr).split('/').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return VM_DAY_NAMES[dt.getUTCDay()] + ' ' + m + '/' + d;
}

function vmCell(c, maxC, extraClass) {
  const alpha = c / maxC;
  const bg = c === 0 ? 'rgba(0,212,255,.04)' : `rgba(255,77,109,${0.1 + alpha * 0.85})`;
  return `<div class="hm-cell${extraClass ? ' ' + extraClass : ''}" style="background:${bg}"></div>`;
}

function renderVmHeatmap() {
  if (!_perfData) return;
  const period   = document.getElementById('vm-period')?.value || 'day';
  const selected = document.getElementById('vm-date').value;
  const slots    = _perfData.vmSlots || [];
  const heatEl   = document.getElementById('vm-heatmap');
  const lblEl    = document.getElementById('vm-labels');

  const timeLabelHtml = () => {
    let h = '';
    for (let t = 0; t < 24; t += 3) h += `<div class="hm-label">${t}:00</div>`;
    return h;
  };

  if (period === 'day') {
    // Single row — original behaviour
    const row    = slots.find(r => r[0] === selected);
    const counts = row ? row.slice(1) : new Array(48).fill(0);
    const maxC   = Math.max(...counts, 1);
    heatEl.className = 'heatmap';
    heatEl.innerHTML = counts.map((c, i) => {
      const hour = Math.floor(i / 2), half = i % 2 === 0 ? '00' : '30';
      return `<div class="hm-cell" title="${hour}:${half} — ${c} VM${c !== 1 ? 's' : ''}" style="background:${c === 0 ? 'rgba(0,212,255,.04)' : `rgba(255,77,109,${0.1 + (c/maxC) * 0.85})`}"></div>`;
    }).join('');
    lblEl.className = 'hm-labels';
    lblEl.innerHTML = timeLabelHtml();
    return;
  }

  // Week / Month — collect matching days sorted chronologically
  const matchingRows = slots
    .filter(r => (period === 'week' ? vmWeekKey(r[0]) : vmMonthKey(r[0])) === selected)
    .sort((a, b) => {
      const parse = s => { const [m,d,y] = s.split('/').map(Number); return new Date(Date.UTC(y,m-1,d)).getTime(); };
      return parse(a[0]) - parse(b[0]);
    });

  // Summary = column-wise sum across all days
  const summary = new Array(48).fill(0);
  for (const r of matchingRows) for (let i = 0; i < 48; i++) summary[i] += (r[i + 1] || 0);

  // Scale relative to max of individual day cells (not summary) so day variation is visible
  let maxC = 1;
  for (const r of matchingRows) for (let i = 0; i < 48; i++) maxC = Math.max(maxC, r[i + 1] || 0);
  const maxS = Math.max(...summary, 1);

  // Build rows
  const rows = matchingRows.map(r => {
    const cells = Array.from({length:48}, (_,i) => {
      const c = r[i + 1] || 0;
      const hour = Math.floor(i/2), half = i%2===0?'00':'30';
      return `<div class="hm-cell" title="${vmDayLabel(r[0])} ${hour}:${half} — ${c} VM${c!==1?'s':''}" style="background:${c===0?'rgba(0,212,255,.04)':`rgba(255,77,109,${0.1+(c/maxC)*0.85})`}"></div>`;
    }).join('');
    return `<div class="hm-row">
      <div class="hm-row-lbl">${vmDayLabel(r[0])}</div>
      <div class="hm-row-cells">${cells}</div>
    </div>`;
  }).join('');

  // Summary row
  const sumCells = summary.map((c, i) => {
    const hour = Math.floor(i/2), half = i%2===0?'00':'30';
    return `<div class="hm-cell" title="${hour}:${half} — ${c} VM${c!==1?'s':''} total" style="background:${c===0?'rgba(0,212,255,.04)':`rgba(255,77,109,${0.1+(c/maxS)*0.85})`}"></div>`;
  }).join('');

  const label = period === 'week' ? 'Week Total' : 'Month Total';

  heatEl.className = 'hm-grid';
  heatEl.innerHTML = rows
    + `<div class="hm-row hm-summary">
        <div class="hm-row-lbl">${label}</div>
        <div class="hm-row-cells">${sumCells}</div>
       </div>`;

  // Time labels aligned under the cells column
  lblEl.className = '';
  lblEl.innerHTML = `<div class="hm-time-row">
    <div></div>
    <div class="hm-time-cells">${timeLabelHtml()}</div>
  </div>`;
}

// ── HISTORY TAB ───────────────────────────────────────────────────────────────
// ── AI ANALYSIS ──────────────────────────────────────────────────────────────
let _chartCalls = null, _chartTalk = null, _chartVm = null;
let _analysisLoading = false;
const ANALYSIS_COOLDOWN_MS      = 5 * 24 * 60 * 60 * 1000; // 5 days
const LEAD_ANALYSIS_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const MA_AGENT_LOCK_MS          = 30 * 24 * 60 * 60 * 1000; // 30 days

function analysisRemainingMs() {
  if (!_analysisAt) return 0;
  return Math.max(0, new Date(_analysisAt).getTime() + ANALYSIS_COOLDOWN_MS - Date.now());
}

function updateAnalysisBtn() {
  const btn       = document.getElementById('analysis-refresh-btn');
  const forceLink = document.getElementById('ai-force-link');
  if (!btn) return;
  const remaining = analysisRemainingMs();
  if (remaining > 0) {
    const days  = Math.floor(remaining / 86400000);
    const hours = Math.ceil((remaining % 86400000) / 3600000);
    const label = days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    btn.disabled = true;
    btn.textContent = `Analyze (${label})`;
    if (forceLink) forceLink.style.display = '';
    setTimeout(updateAnalysisBtn, Math.min(remaining, 5 * 60 * 1000));
  } else {
    btn.disabled = false;
    btn.textContent = 'Analyze';
    if (forceLink) forceLink.style.display = 'none';
  }
}

function _renderAnalysisData(data) {
  if (data.chartData) renderAnalysisCharts(data.chartData);
  if (data.insights) {
    const paragraphs = data.insights.split(/\n\n+/).filter(Boolean);
    document.getElementById('analysis-body').innerHTML = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
    document.getElementById('analysis-email-btn').style.display = '';
  }
  const ts = data.cachedAt || data.generatedAt || _analysisAt;
  if (ts) {
    const msg = document.getElementById('analysis-msg');
    if (msg) {
      msg.style.display = 'block';
      msg.style.color = 'var(--muted)';
      msg.textContent = `Generated ${new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
    }
  }
}

function displayCachedAnalysis() {
  // Always check the server first — checkOnly=1 never triggers a paid Claude call.
  // Server cache is the source of truth; localStorage is only a fallback for offline/204.
  fetch('/api/ai-analysis?checkOnly=1', { headers: authHeaders() })
    .then(r => r.status === 204 ? null : r.ok ? r.json() : null)
    .then(data => {
      if (data?.insights) {
        const ts = data.cachedAt || data.generatedAt;
        if (ts && !_analysisAt) { _analysisAt = ts; updateAnalysisBtn(); }
        _renderAnalysisData(data);
        _lsSet('br-analysis-data', JSON.stringify({ userId: _dataUserId, insights: data.insights, chartData: data.chartData, cachedAt: ts }));
      } else {
        // Server has nothing valid — fall back to localStorage
        const cached = _lsGet('br-analysis-data');
        if (cached) {
          try {
            const d = JSON.parse(cached);
            if (d.userId === _dataUserId && d.insights) _renderAnalysisData(d);
            else _lsRemove('br-analysis-data');
          } catch(e) { _lsRemove('br-analysis-data'); }
        }
      }
    })
    .catch(() => {
      // Network error — fall back to localStorage
      const cached = _lsGet('br-analysis-data');
      if (cached) {
        try {
          const d = JSON.parse(cached);
          if (d.userId === _dataUserId && d.insights) _renderAnalysisData(d);
        } catch(e) {}
      }
    });
}

function renderAnalysisTrialTeaser() {
  document.getElementById('analysis-charts-panel').style.display = 'none';
  document.getElementById('analysis-refresh-btn').style.display = 'none';
  document.getElementById('analysis-email-btn').style.display = 'none';
  document.getElementById('analysis-body').innerHTML = `
    <div style="text-align:center;padding:2rem 1rem;">
      <div style="font-size:2rem;margin-bottom:1rem;">🤖</div>
      <div style="font-family:'Bebas Neue',sans-serif;font-size:1.6rem;letter-spacing:.04em;margin-bottom:.75rem;">AI Coaching Insights</div>
      <p style="font-size:14px;color:var(--muted);max-width:480px;margin:0 auto 1.5rem;line-height:1.7;">
        Premium subscribers get a full AI-powered analysis of their team's last 90 days — including monthly and weekly call trends,
        top performer breakdowns, agents who need coaching, and specific actions your manager can take this week.
        Powered by Claude AI, refreshable every 5 days.
      </p>
      <button class="btn btn-primary" onclick="goToAccountTab()">Upgrade to Premium</button>
    </div>`;
  document.getElementById('analysis-msg').style.display = 'none';
}

async function runAnalysis(force) {
  if (_analysisLoading) return;
  if (!force && analysisRemainingMs() > 0) return;
  _analysisLoading = true;
  const btn  = document.getElementById('analysis-refresh-btn');
  const body = document.getElementById('analysis-body');
  const msg  = document.getElementById('analysis-msg');
  const emailBtn = document.getElementById('analysis-email-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  if (emailBtn) emailBtn.style.display = 'none';
  body.innerHTML = '<div style="color:var(--muted);font-size:13px;">Generating analysis…</div>';
  msg.style.display = 'none';

  try {
    const res  = await fetch('/api/ai-analysis', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<div style="color:var(--danger);font-size:13px;">${data.error || 'Error loading analysis.'}</div>`;
      return;
    }

    renderAnalysisCharts(data.chartData || []);
    const paragraphs = (data.insights || '').split(/\n\n+/).filter(Boolean);
    body.innerHTML = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');

    const ts = data.cachedAt || data.generatedAt || new Date().toISOString();
    _analysisAt = ts;
    _lsSet('br-analysis-data', JSON.stringify({ userId: _dataUserId, insights: data.insights, chartData: data.chartData, cachedAt: ts }));

    const source = data.cached
      ? `Cached — generated ${new Date(data.cachedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`
      : `Generated ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
    msg.style.display = 'block';
    msg.style.color = 'var(--muted)';
    msg.textContent = source;
    if (emailBtn) emailBtn.style.display = '';
  } catch(e) {
    body.innerHTML = `<div style="color:var(--danger);font-size:13px;">${e.message}</div>`;
  } finally {
    _analysisLoading = false;
    updateAnalysisBtn();
  }
}

async function emailAnalysis() {
  const btn = document.getElementById('analysis-email-btn');
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm Send';
    setTimeout(() => { btn.dataset.confirming = ''; btn.textContent = 'Email Analysis'; }, 6000);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  const msg = document.getElementById('analysis-msg');
  try {
    let localInsights = null;
    try {
      const cached = _lsGet('br-analysis-data');
      if (cached) { const d = JSON.parse(cached); if (d.insights) localInsights = d.insights; }
    } catch(e) {}
    const res  = await fetch('/api/ai-analysis?action=email', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ insights: localInsights }),
    });
    const data = await res.json();
    msg.style.display = 'block';
    if (res.ok) {
      msg.style.color = 'var(--accent2)';
      msg.textContent = 'Analysis emailed successfully.';
    } else {
      msg.style.color = 'var(--danger)';
      msg.textContent = data.error || 'Email failed.';
    }
  } catch(e) {
    msg.style.display = 'block';
    msg.style.color = 'var(--danger)';
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.dataset.confirming = '';
    btn.textContent = 'Email Analysis';
  }
}

function renderAnalysisCharts(data) {
  const labels   = data.map(d => d.period);
  const gridColor = 'rgba(255,255,255,0.05)';
  const tickColor = '#6b8db5';
  const chartDefaults = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { labels: { color: '#a0b4c8', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor }, beginAtZero: true },
    },
  };

  // Calls chart
  if (_chartCalls) _chartCalls.destroy();
  _chartCalls = new Chart(document.getElementById('chart-calls'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Placed',   data: data.map(d => d.placed),   borderColor:'#00d4ff', backgroundColor:'rgba(0,212,255,.1)', tension:.3, fill:true, yAxisID:'y' },
        { label:'Answered', data: data.map(d => d.answered), borderColor:'#00ff94', backgroundColor:'rgba(0,255,148,.1)', tension:.3, fill:true, yAxisID:'y' },
        { label:'Policies', data: data.map(d => d.policies), borderColor:'#ff8c42', backgroundColor:'rgba(255,140,66,.15)', tension:.3, fill:true, yAxisID:'y2', borderDash:[5,3] },
      ],
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y:  { ...chartDefaults.scales.y, position:'left' },
        y2: { ...chartDefaults.scales.y, position:'right', grid:{ drawOnChartArea:false }, ticks:{ color:'#ff8c42', font:{ size:10 } } },
      },
    },
  });

  // Talk time chart
  if (_chartTalk) _chartTalk.destroy();
  _chartTalk = new Chart(document.getElementById('chart-talk'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Talk Min', data: data.map(d => d.talkMin), borderColor:'#ffd166', backgroundColor:'rgba(255,209,102,.1)', tension:.3, fill:true },
      ],
    },
    options: { ...chartDefaults, plugins: { legend: { display: false } } },
  });

  // Voicemail / missed chart
  if (_chartVm) _chartVm.destroy();
  _chartVm = new Chart(document.getElementById('chart-vm'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Voicemail', data: data.map(d => d.voicemail), backgroundColor:'rgba(255,140,66,.7)' },
        { label:'Missed',    data: data.map(d => d.missed),    backgroundColor:'rgba(255,80,80,.6)' },
      ],
    },
    options: { ...chartDefaults, scales: { ...chartDefaults.scales, x: { ...chartDefaults.scales.x, stacked: false } } },
  });
}

let _histByMonth       = {};   // month → [row, ...]
let _histSortCol       = 'rank';
let _histSortDir       = 1;
let _histMonthOrder    = [];   // sorted newest→oldest
let _histSelectedMonth = null;
let _histView          = 'annual';

const HIST_MONTH_ORDER = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };

async function loadHistory() {
  try {
    const res  = await fetch('/api/history', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();

    // Support both legacy array format and new object format
    const rows = Array.isArray(data) ? data.slice(1).map(r => ({
      month: r[0], rank: r[1], agent_id: r[2], name: r[3], team: r[4],
      total_score: r[5], gross_score: r[6], deductions: r[7],
      wl:0, ul:0, term:0, health:0, auto:0, fire:0, placed:0, answered:0, talk_min:0,
    })) : (data.wins || []);

    // Group by month
    const byMonth = {};
    for (const r of rows) {
      if (!byMonth[r.month]) byMonth[r.month] = [];
      byMonth[r.month].push(r);
    }

    _histByMonth = byMonth;
    _histMonthOrder = Object.keys(byMonth).sort((a, b) => {
      const [am, ay] = [HIST_MONTH_ORDER[a.split(' ')[0]], parseInt(a.split(' ')[1])];
      const [bm, by] = [HIST_MONTH_ORDER[b.split(' ')[0]], parseInt(b.split(' ')[1])];
      return ay !== by ? by - ay : bm - am;
    });
    _histSelectedMonth = _histMonthOrder[0] || null;

    renderHistView();
  } catch(e) { console.error('loadHistory:', e); }
}

function setHistView(view, btn) {
  _histView = view;
  document.querySelectorAll('#tab-history .btn').forEach(b => {
    b.style.background = ''; b.style.color = '';
  });
  if (btn) { btn.style.background = 'var(--accent)'; btn.style.color = '#000'; }
  renderHistView();
}

function renderHistView() {
  document.getElementById('hist-pane-annual').style.display = _histView === 'annual' ? '' : 'none';
  document.getElementById('hist-pane-month').style.display  = _histView === 'month'  ? '' : 'none';

  if (_histView === 'annual') renderHistTiles();
  else                        renderHistMonthDetail();

  // Reflect active view button
  const annBtn = document.getElementById('hist-view-btn-annual');
  const monBtn = document.getElementById('hist-view-btn-month');
  if (annBtn) { annBtn.style.background = _histView === 'annual' ? 'var(--accent)' : ''; annBtn.style.color = _histView === 'annual' ? '#000' : ''; }
  if (monBtn) { monBtn.style.background = _histView === 'month'  ? 'var(--accent)' : ''; monBtn.style.color = _histView === 'month'  ? '#000' : ''; }
}

function renderHistTiles() {
  const grid = document.getElementById('hist-tiles-grid');
  if (!grid) return;
  if (!_histMonthOrder.length) {
    grid.innerHTML = '<div style="color:var(--muted);font-size:13px;grid-column:1/-1;text-align:center;padding:2rem;">No history yet. Archive a month to get started.</div>';
    return;
  }
  const canManageHist = !_isMember || ['captain','chief_officer'].includes(_memberRole);
  const rankEmoji = ['🥇','🥈','🥉'];
  grid.innerHTML = _histMonthOrder.map(month => {
    const rows     = _histByMonth[month] || [];
    const sorted   = [...rows].sort((a, b) => (a.rank||99) - (b.rank||99));
    const top3     = sorted.slice(0, 3);
    const agents   = rows.length;
    const policies = rows.reduce((s, r) => s + (r.wl||0)+(r.ul||0)+(r.term||0)+(r.health||0)+(r.auto||0)+(r.fire||0), 0);
    const winner   = top3[0];
    const teamColor = winner?.team === 'service' ? 'var(--accent2)' : 'var(--accent)';

    const podium = top3.map((r, i) => {
      const tc = r.team === 'service' ? 'var(--accent2)' : 'var(--accent)';
      return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:3px;">
        <span>${rankEmoji[i]}</span>
        <span style="font-weight:600;color:var(--text);">${escHtml(r.name)}</span>
        <span style="font-size:10px;color:${tc};font-weight:700;">${r.total_score ?? '—'}</span>
      </div>`;
    }).join('');

    const statsLine = [
      agents ? `${agents} agent${agents !== 1 ? 's' : ''}` : null,
      policies ? `${policies} ${policies === 1 ? 'policy' : 'policies'}` : null,
    ].filter(Boolean).join(' · ');

    return `<div class="hist-month-tile" onclick="drillHistMonth('${escHtml(month)}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:2px;">
        <div style="font-size:16px;font-weight:800;color:var(--text);">${escHtml(month)}</div>
        ${canManageHist ? `<button onclick="event.stopPropagation();openMonthManageModal('${escHtml(month)}')" style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:5px;padding:1px 7px;font-size:11px;cursor:pointer;white-space:nowrap;">Manage</button>` : ''}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:.75rem;">${statsLine}</div>
      <div style="border-top:1px solid var(--border2);padding-top:.6rem;">${podium || '<div style="font-size:12px;color:var(--muted);">No entries</div>'}</div>
    </div>`;
  }).join('');
}

function drillHistMonth(month) {
  _histSelectedMonth = month;
  _histView = 'month';
  renderHistView();
}

function renderHistMonthDetail() {
  const canManageHist = !_isMember || ['captain','chief_officer'].includes(_memberRole);
  const manageBtn = document.getElementById('hist-manage-btn');
  if (manageBtn) manageBtn.style.display = canManageHist ? '' : 'none';

  // Pills
  const pillsEl = document.getElementById('hist-month-pills');
  if (pillsEl) {
    pillsEl.innerHTML = _histMonthOrder.map(m =>
      `<button class="hist-pill${m === _histSelectedMonth ? ' hist-pill-active' : ''}"
               onclick="selectHistMonth('${escHtml(m)}')">${escHtml(m)}</button>`
    ).join('');
  }

  const heading = document.getElementById('hist-month-heading');
  if (heading) heading.textContent = _histSelectedMonth || '';

  const rows = _histByMonth[_histSelectedMonth] || [];
  const sorted = [...rows].sort((a, b) => {
    const col = _histSortCol;
    let av, bv;
    if (col === 'policies') {
      av = (a.wl||0)+(a.ul||0)+(a.term||0)+(a.health||0)+(a.auto||0)+(a.fire||0);
      bv = (b.wl||0)+(b.ul||0)+(b.term||0)+(b.health||0)+(b.auto||0)+(b.fire||0);
    } else if (col === 'name' || col === 'team') {
      av = (a[col]||'').toLowerCase(); bv = (b[col]||'').toLowerCase();
      return _histSortDir * av.localeCompare(bv);
    } else {
      av = a[col] ?? 99; bv = b[col] ?? 99;
    }
    return _histSortDir * (av - bv);
  });
  const rankCls = ['hist-rank-1','hist-rank-2','hist-rank-3'];

  // Update header arrows
  const HIST_COLS = ['rank','name','team','total_score','gross_score','deductions','policies'];
  const thead = document.getElementById('hist-thead');
  if (thead) {
    const ths = thead.querySelectorAll('th');
    ths.forEach((th, i) => {
      const col = HIST_COLS[i];
      const arrow = col === _histSortCol ? (_histSortDir === 1 ? ' ▲' : ' ▼') : '';
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + arrow;
    });
  }

  document.getElementById('hist-body').innerHTML = sorted.map(r => {
    const policies = (r.wl||0)+(r.ul||0)+(r.term||0)+(r.health||0)+(r.auto||0)+(r.fire||0);
    const teamColor = r.team === 'service' ? 'var(--accent2)' : 'var(--accent)';
    return `<tr>
      <td class="${rankCls[(r.rank||99)-1]||''}" style="font-weight:700;">${r.rank ?? '—'}</td>
      <td style="font-weight:600;">${escHtml(r.name || '')}</td>
      <td><span style="font-size:10px;font-weight:700;color:${teamColor};background:${teamColor}18;padding:2px 7px;border-radius:4px;">${escHtml(r.team || '')}</span></td>
      <td style="color:var(--accent);font-weight:700;">${r.total_score ?? '—'}</td>
      <td>${r.gross_score ?? '—'}</td>
      <td style="color:var(--danger);">${r.deductions ?? '—'}</td>
      <td>${policies || '—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:20px">No data for this month</td></tr>';
}

function histSort(col) {
  if (_histSortCol === col) { _histSortDir *= -1; }
  else { _histSortCol = col; _histSortDir = col === 'rank' ? 1 : -1; }
  renderHistMonthDetail();
}

function selectHistMonth(month) {
  _histSelectedMonth = month;
  renderHistMonthDetail();
}

function histNavMonth(dir) {
  if (!_histMonthOrder.length) return;
  const idx = _histMonthOrder.indexOf(_histSelectedMonth);
  const next = idx + dir;
  if (next < 0 || next >= _histMonthOrder.length) return;
  _histSelectedMonth = _histMonthOrder[next];
  renderHistMonthDetail();
}

let _histManagingMonth = null;

function openMonthManageModal(month) {
  if (!month) return;
  _histManagingMonth = month;
  document.getElementById('hist-manage-current').textContent = month;
  document.getElementById('hist-rename-new-name').value = '';
  document.getElementById('hist-manage-msg').style.display = 'none';
  const otherMonths = _histMonthOrder.filter(m => m !== month);
  const sel = document.getElementById('hist-merge-target');
  sel.innerHTML = '<option value="">— Select target month —</option>' +
    otherMonths.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
  document.getElementById('hist-manage-modal').style.display = 'flex';
}

async function histRenameMonth() {
  const newName = document.getElementById('hist-rename-new-name').value.trim();
  if (!newName || !_histManagingMonth) { showInlineMsg('hist-manage-msg', 'Enter a new month label.', 'err'); return; }
  if (newName === _histManagingMonth) { showInlineMsg('hist-manage-msg', 'Name is the same — nothing changed.', 'warn'); return; }
  const btn = document.querySelector('#hist-manage-modal button[onclick="histRenameMonth()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Renaming…'; }
  try {
    const [r1, r2] = await Promise.all([
      _supabase.from('historical_wins').update({ month: newName }).eq('user_id', _dataUserId).eq('month', _histManagingMonth),
      _supabase.from('historical_months').update({ month: newName }).eq('user_id', _dataUserId).eq('month', _histManagingMonth),
    ]);
    if (r1.error || r2.error) throw new Error(r1.error?.message || r2.error?.message);
    _histByMonth[newName] = (_histByMonth[newName] || []).concat(_histByMonth[_histManagingMonth] || []);
    delete _histByMonth[_histManagingMonth];
    _histMonthOrder = _histMonthOrder.map(m => m === _histManagingMonth ? newName : m);
    if (_histSelectedMonth === _histManagingMonth) _histSelectedMonth = newName;
    _histManagingMonth = newName;
    document.getElementById('hist-manage-current').textContent = newName;
    showInlineMsg('hist-manage-msg', 'Month renamed successfully.', 'ok');
    renderHistView();
  } catch(err) {
    showInlineMsg('hist-manage-msg', 'Error: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Rename to This Label'; }
  }
}

async function histMergeMonth() {
  const targetMonth = document.getElementById('hist-merge-target').value;
  if (!targetMonth || !_histManagingMonth) { showInlineMsg('hist-manage-msg', 'Select a target month.', 'err'); return; }
  if (!confirm(`Combine "${_histManagingMonth}" into "${targetMonth}"? This cannot be undone.`)) return;
  const btn = document.querySelector('#hist-manage-modal button[onclick="histMergeMonth()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Combining…'; }
  try {
    const srcRows = _histByMonth[_histManagingMonth] || [];
    const tgtRows = _histByMonth[targetMonth] || [];
    const tgtMap  = {};
    for (const r of tgtRows) tgtMap[r.agent_id] = r;

    const merged = [];
    for (const src of srcRows) {
      const tgt = tgtMap[src.agent_id];
      if (tgt) {
        merged.push({
          user_id: _dataUserId, month: targetMonth, agent_id: src.agent_id,
          name: tgt.name || src.name, team: tgt.team || src.team,
          wl: (tgt.wl||0)+(src.wl||0), ul: (tgt.ul||0)+(src.ul||0),
          term: (tgt.term||0)+(src.term||0), health: (tgt.health||0)+(src.health||0),
          auto: (tgt.auto||0)+(src.auto||0), fire: (tgt.fire||0)+(src.fire||0),
          placed: (tgt.placed||0)+(src.placed||0), answered: (tgt.answered||0)+(src.answered||0),
          talk_min: (tgt.talk_min||0)+(src.talk_min||0),
          gross_score: (tgt.gross_score||0)+(src.gross_score||0),
          deductions: (tgt.deductions||0)+(src.deductions||0),
          total_score: Math.max(0, ((tgt.total_score||0)+(src.total_score||0))),
        });
      } else {
        merged.push({ ...src, user_id: _dataUserId, month: targetMonth });
      }
    }
    // Re-rank all combined rows by total_score
    const allRows = tgtRows.filter(r => !merged.find(m => m.agent_id === r.agent_id)).concat(merged);
    allRows.sort((a, b) => (b.total_score||0) - (a.total_score||0));
    allRows.forEach((r, i) => { r.rank = i + 1; r.user_id = _dataUserId; r.month = targetMonth; });

    await _supabase.from('historical_wins').delete().eq('user_id', _dataUserId).eq('month', targetMonth);
    const { error: uErr } = await _supabase.from('historical_wins').insert(allRows);
    if (uErr) throw new Error(uErr.message);
    await _supabase.from('historical_wins').delete().eq('user_id', _dataUserId).eq('month', _histManagingMonth);
    await _supabase.from('historical_months').delete().eq('user_id', _dataUserId).eq('month', _histManagingMonth);

    _histByMonth[targetMonth] = allRows;
    delete _histByMonth[_histManagingMonth];
    _histMonthOrder = _histMonthOrder.filter(m => m !== _histManagingMonth);
    if (_histSelectedMonth === _histManagingMonth) _histSelectedMonth = targetMonth;
    document.getElementById('hist-manage-modal').style.display = 'none';
    renderHistView();
  } catch(err) {
    showInlineMsg('hist-manage-msg', 'Error: ' + err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Combine Into Selected Month'; }
  }
}

