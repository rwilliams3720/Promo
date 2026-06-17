// ── LOAD RACE DATA ────────────────────────────────────────────────────────────
async function refreshRaceData(btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try { await loadRaceData(); btn.textContent = '✓ Refreshed'; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000); }
  catch(e) { btn.textContent = orig; btn.disabled = false; }
}

async function loadRaceData() {
  if (!_dataUserId) return;

  const [rdRes, scRes, rcRes, vmRes, msRes, slRes] = await Promise.all([
    _supabase.from('race_data').select('*').eq('user_id', _dataUserId),
    _supabase.from('scoring_config').select('config_key,config_value').eq('user_id', _dataUserId),
    _supabase.from('race_config').select('key,value').eq('user_id', _dataUserId),
    _supabase.from('call_log').select('*', { count: 'exact', head: true }).eq('user_id', _dataUserId).eq('disposition', 'voicemail'),
    _supabase.from('call_log').select('*', { count: 'exact', head: true }).eq('user_id', _dataUserId).eq('disposition', 'missed'),
    _supabase.from('sales_log').select('agent_id,product').eq('user_id', _dataUserId).in('product', ['deposit','other','other2','other3','other4','other5']),
  ]);

  if (rdRes.error) console.error('race_data read error:', rdRes.error);
  if (scRes.error) console.error('scoring_config read error:', scRes.error);
  if (rcRes.error) console.error('race_config read error:', rcRes.error);

  if (scRes.data && scRes.data.length) {
    scRes.data.forEach(r => {
      if (r.config_key.endsWith('_label')) {
        const cat = r.config_key.slice(0, -6);
        if (cat in CAT_LABELS && r.config_value) CAT_LABELS[cat] = r.config_value;
      } else if (r.config_key in SCORING) {
        SCORING[r.config_key] = parseFloat(r.config_value) || 0;
      }
    });
  }

  _raceWideVm     = vmRes.count || 0;
  _raceWideMissed = msRes.count || 0;

  const month = (rcRes.data || []).find(r => r.key === 'current_month')?.value || '';
  document.getElementById('header-month').textContent = month || 'No race data uploaded';
  _raceCurrentMonth = month;

  // Keep Set Month input in sync with current race month
  const setMonthInput = document.getElementById('set-race-month-input');
  if (setMonthInput && month) {
    const FULL12 = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const ABBR12 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts = month.trim().split(' ');
    let idx = FULL12.indexOf(parts[0]);
    if (idx === -1) idx = ABBR12.indexOf(parts[0]);
    const yr = parseInt(parts[1]);
    if (idx !== -1 && !isNaN(yr)) setMonthInput.value = `${yr}-${String(idx+1).padStart(2,'0')}`;
  }

  // Last upload time — stored in race_config so all users see the same value
  const lastUploadAt = (rcRes.data || []).find(r => r.key === 'last_upload_at')?.value || '';
  const luEl = document.getElementById('last-upload-time');
  if (luEl) luEl.textContent = lastUploadAt ? new Date(lastUploadAt).toLocaleString() : '—';

  const EXTRA_CATS = ['deposit','other','other2','other3','other4','other5'];
  const depOthCounts = {};
  (slRes.data || []).forEach(r => {
    if (!r.agent_id || !EXTRA_CATS.includes(r.product)) return;
    if (!depOthCounts[r.agent_id]) depOthCounts[r.agent_id] = Object.fromEntries(EXTRA_CATS.map(c => [c, 0]));
    depOthCounts[r.agent_id][r.product]++;
  });
  _raceData = (rdRes.data || []).map(ag => ({
    ...ag,
    ...Object.fromEntries(EXTRA_CATS.map(c => [c, depOthCounts[ag.agent_id]?.[c] || 0])),
  }));
  buildScoringUI();
  renderRace(_raceData);
  renderSalesTile();
  if (_hasSalesAddon || _isAdmin) loadSalesTileData().catch(() => {});
}

function fmtMins(m) {
  m = m || 0;
  if (m < 60) return (Math.round(m * 10) / 10) + ' min';
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return `${h}h ${String(min).padStart(2,'0')}m`;
}

function calcScore(ag) {
  const svc = ag.team === 'service';
  const polPts =
    (SCORING.wl_enabled      ? (ag.wl     ||0)*SCORING.wl      : 0) +
    (SCORING.ul_enabled      ? (ag.ul     ||0)*SCORING.ul      : 0) +
    (SCORING.term_enabled    ? (ag.term   ||0)*SCORING.term    : 0) +
    (SCORING.health_enabled  ? (ag.health ||0)*SCORING.health  : 0) +
    (SCORING.auto_enabled    ? (ag.auto   ||0)*SCORING.auto    : 0) +
    (SCORING.fire_enabled    ? (ag.fire   ||0)*SCORING.fire    : 0) +
    (SCORING.deposit_enabled ? (ag.deposit||0)*SCORING.deposit : 0) +
    (SCORING.other_enabled   ? (ag.other  ||0)*SCORING.other   : 0) +
    (SCORING.other2_enabled  ? (ag.other2 ||0)*SCORING.other2  : 0) +
    (SCORING.other3_enabled  ? (ag.other3 ||0)*SCORING.other3  : 0) +
    (SCORING.other4_enabled  ? (ag.other4 ||0)*SCORING.other4  : 0) +
    (SCORING.other5_enabled  ? (ag.other5 ||0)*SCORING.other5  : 0);
  const plPts  = (ag.placed||0)   * (svc ? SCORING.placed_service  : SCORING.placed_sales);
  const ansPts = (ag.answered||0) * (svc ? SCORING.answered_service : SCORING.answered_sales);
  const talkPts= (ag.talk_min||0)*SCORING.talk_per_min + (ag.avg_min||0)*SCORING.avg_min;
  const gross  = Math.round(polPts + plPts + ansPts + talkPts);
  const deduct = Math.round(_raceWideMissed*SCORING.missed_deduct + _raceWideVm*SCORING.voicemail_deduct);
  return { gross, deduct, total: Math.max(0, gross + deduct) };
}

function renderRace(data) {
  // Filter to active roster agents only; if roster not loaded yet, show all
  let activeData = data;
  if (_agentRoster.length > 0) {
    const activeIds = new Set(_agentRoster.filter(a => a.active !== false).map(a => a.agent_id));
    activeData = data.filter(ag => activeIds.has(ag.agent_id));
  }

  if (!activeData.length) {
    document.getElementById('race-list').innerHTML = '<p style="color:var(--muted);font-size:13px">No race data yet. Upload a call log to begin.</p>';
    document.getElementById('stats-row').innerHTML = '';
    document.getElementById('podium').innerHTML = '';
    document.getElementById('key-grid').innerHTML = '';
    document.getElementById('deduct-box').innerHTML = '';
    const w = document.getElementById('race-no-calls-warn'); if (w) w.style.display = 'none';
    return;
  }

  const hasAnyCalls = activeData.some(ag => (ag.placed||0) + (ag.answered||0) + (ag.talk_min||0) > 0);
  const warnEl = document.getElementById('race-no-calls-warn');
  if (warnEl) warnEl.style.display = hasAnyCalls ? 'none' : '';

  const agents = activeData.map((ag, i) => {
    if (!AGENT_COLORS[ag.agent_id]) AGENT_COLORS[ag.agent_id] = COLORS[Object.keys(AGENT_COLORS).length % COLORS.length];
    // Use roster name as source of truth — updates immediately when renamed
    const rosterName = _agentRoster.find(a => a.agent_id === ag.agent_id)?.name;
    const sc = calcScore(ag);
    return { ...ag, name: rosterName || ag.name, ...sc, color: AGENT_COLORS[ag.agent_id] };
  });

  agents.sort((a, b) => b.total - a.total);
  const maxScore = agents[0]?.total || 1;
  const maxDeduct = Math.max(...agents.map(a => Math.abs(a.deduct)), 1);
  const rwMissed  = _raceWideMissed;
  const rwVm      = _raceWideVm;

  // Stats row
  const totalPlaced   = agents.reduce((s, a) => s + (a.placed||0), 0);
  const totalAnswered = agents.reduce((s, a) => s + (a.answered||0), 0);
  const totalTalk     = agents.reduce((s, a) => s + (a.talk_min||0), 0);
  const topAgent      = agents[0];

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card" style="--accent-line:var(--gold)">
      <div class="stat-label">Leader</div>
      <div class="stat-val" style="font-size:1.3rem;color:var(--gold)">${escHtml(topAgent.name.split(' ')[0])}</div>
      <div class="stat-sub">${topAgent.total} pts</div>
    </div>
    <div class="stat-card" style="--accent-line:var(--accent2)">
      <div class="stat-label">Placed Calls</div>
      <div class="stat-val">${totalPlaced}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Received</div>
      <div class="stat-val">${totalAnswered}</div>
    </div>
    <div class="stat-card" style="--accent-line:var(--accent)">
      <div class="stat-label">Talk Time</div>
      <div class="stat-val">${fmtMins(totalTalk)}</div>
    </div>
    <div class="stat-card" style="--accent-line:var(--danger)">
      <div class="stat-label">VM / Missed</div>
      <div class="stat-val" style="color:var(--danger)">${rwVm} / ${rwMissed}</div>
    </div>`;

  // Leaderboard
  const rankClasses = ['rank-gold','rank-silver','rank-bronze'];
  document.getElementById('race-list').innerHTML = agents.map((ag, i) => {
    const sc = ag;
    const barW = maxScore > 0 ? (sc.total / maxScore * 100) : 0;
    const dedW = maxDeduct > 0 ? (Math.abs(sc.deduct) / maxDeduct * 100) : 0;
    const rankClass = rankClasses[i] || 'rank-other';
    const svc = ag.team === 'service';
    const polPts =
      (SCORING.wl_enabled      ? (ag.wl     ||0)*SCORING.wl      : 0) +
      (SCORING.ul_enabled      ? (ag.ul     ||0)*SCORING.ul      : 0) +
      (SCORING.term_enabled    ? (ag.term   ||0)*SCORING.term    : 0) +
      (SCORING.health_enabled  ? (ag.health ||0)*SCORING.health  : 0) +
      (SCORING.auto_enabled    ? (ag.auto   ||0)*SCORING.auto    : 0) +
      (SCORING.fire_enabled    ? (ag.fire   ||0)*SCORING.fire    : 0) +
      (SCORING.deposit_enabled ? (ag.deposit||0)*SCORING.deposit : 0) +
      (SCORING.other_enabled   ? (ag.other  ||0)*SCORING.other   : 0);
    return `<div class="race-row">
      <div class="race-rank ${rankClass}">${i+1}</div>
      <div>
        <div class="agent-top">
          <div class="agent-color" style="background:${ag.color}"></div>
          <div class="agent-name">${escHtml(ag.name)}</div>
          <span class="team-badge ${svc?'badge-service':'badge-sales'}">${escHtml(ag.team)}</span>
        </div>
        <div class="pill-row">
          ${ag.wl     && SCORING.wl_enabled      ?`<span class="pill">WL×${ag.wl}</span>`:''}
          ${ag.ul     && SCORING.ul_enabled      ?`<span class="pill">UL×${ag.ul}</span>`:''}
          ${ag.term   && SCORING.term_enabled    ?`<span class="pill">T×${ag.term}</span>`:''}
          ${ag.health && SCORING.health_enabled  ?`<span class="pill">H×${ag.health}</span>`:''}
          ${ag.auto   && SCORING.auto_enabled    ?`<span class="pill">A×${ag.auto}</span>`:''}
          ${ag.fire   && SCORING.fire_enabled    ?`<span class="pill">F×${ag.fire}</span>`:''}
          ${(ag.deposit||0) && SCORING.deposit_enabled ?`<span class="pill">${CAT_LABELS.deposit}×${ag.deposit}</span>`:''}
          ${(ag.other  ||0) && SCORING.other_enabled  ?`<span class="pill">${CAT_LABELS.other}×${ag.other}</span>`:''}
          ${(ag.other2 ||0) && SCORING.other2_enabled ?`<span class="pill">${CAT_LABELS.other2}×${ag.other2}</span>`:''}
          ${(ag.other3 ||0) && SCORING.other3_enabled ?`<span class="pill">${CAT_LABELS.other3}×${ag.other3}</span>`:''}
          ${(ag.other4 ||0) && SCORING.other4_enabled ?`<span class="pill">${CAT_LABELS.other4}×${ag.other4}</span>`:''}
          ${(ag.other5 ||0) && SCORING.other5_enabled ?`<span class="pill">${CAT_LABELS.other5}×${ag.other5}</span>`:''}
        </div>
        ${renderRaceGoalsRow(ag)}
        <div class="race-bar-bg" style="margin-top:6px">
          <div class="race-bar-fill" style="width:${barW}%;background:linear-gradient(90deg,${ag.color}88,${ag.color})">
            <span class="race-bar-text">${fmtMins(ag.talk_min)}</span>
          </div>
        </div>
        ${sc.deduct<0?`<div class="deduct-bar"><div class="deduct-fill" style="width:${dedW}%"></div></div>`:''}
      </div>
      <div></div>
      <div class="race-score-col">
        <div class="race-score">${sc.total}</div>
        ${sc.deduct<0?`<div class="race-deduct">${sc.deduct}</div>`:''}
        <div class="race-gross">gross ${sc.gross}</div>
      </div>
    </div>`;
  }).join('');

  // Podium
  const [p1, p2, p3] = agents;
  document.getElementById('podium').innerHTML = `
    ${p2?`<div class="podium-col">
      <div class="podium-name">${escHtml(p2.name.split(' ')[0])}</div>
      <div class="podium-pts">${p2.total}</div>
      <div class="podium-trophy">🥈</div>
      <div class="podium-block podium-2" style="height:130px">2</div>
    </div>`:''}
    ${p1?`<div class="podium-col">
      <div class="podium-name">${escHtml(p1.name.split(' ')[0])}</div>
      <div class="podium-pts">${p1.total}</div>
      <div class="podium-trophy">🥇</div>
      <div class="podium-block podium-1" style="height:170px">1</div>
    </div>`:''}
    ${p3?`<div class="podium-col">
      <div class="podium-name">${escHtml(p3.name.split(' ')[0])}</div>
      <div class="podium-pts">${p3.total}</div>
      <div class="podium-trophy">🥉</div>
      <div class="podium-block podium-3" style="height:100px">3</div>
    </div>`:''}`;

  // Key — only show enabled categories
  const ALL_KEY_ITEMS = [
    {key:'wl',     color:'#00d4ff', label:'Whole Life'},
    {key:'ul',     color:'#a78bfa', label:'Universal Life'},
    {key:'term',   color:'#60a5fa', label:'Term'},
    {key:'health', color:'#34d399', label:'Health'},
    {key:'auto',   color:'#fbbf24', label:'Auto'},
    {key:'fire',   color:'#fb923c', label:'Fire'},
    {key:'deposit',color:'#f87171'},
    {key:'other',  color:'#94a3b8'},
    {key:'other2', color:'#e879f9'},
    {key:'other3', color:'#4ade80'},
    {key:'other4', color:'#facc15'},
    {key:'other5', color:'#38bdf8'},
  ].map(k => ({ ...k, label: CAT_LABELS[k.key] || k.label }));
  const keyItems = ALL_KEY_ITEMS.filter(k => SCORING[k.key + '_enabled']);
  document.getElementById('key-grid').innerHTML = keyItems.map(k =>
    `<div class="key-item"><div class="key-dot" style="background:${k.color}"></div>
    <div><div class="key-type">${k.label}</div><div class="key-pts">${SCORING[k.key]} pts each</div></div></div>`
  ).join('');

  document.getElementById('deduct-box').innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px;font-weight:600">RACE-WIDE DEDUCTIONS</div>
    <div style="display:flex;gap:24px;flex-wrap:wrap;">
      <div><div style="font-size:11px;color:var(--muted)">Voicemails</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${rwVm} × ${SCORING.voicemail_deduct} = ${Math.round(rwVm*SCORING.voicemail_deduct)}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Missed</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${rwMissed} × ${SCORING.missed_deduct} = ${Math.round(rwMissed*SCORING.missed_deduct)}</div></div>
      <div><div style="font-size:11px;color:var(--muted)">Total Deduction</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${Math.round(rwVm*SCORING.voicemail_deduct + rwMissed*SCORING.missed_deduct)}</div></div>
    </div>`;
}

// ── Sales tile (race tab bottom-right) ───────────────────────────────────────
async function loadSalesTileData() {
  if ((!_hasSalesAddon && !_isAdmin) || !_dataUserId) return;
  // Use the race month so tile numbers match the rest of the race tab
  let m, y;
  if (_raceCurrentMonth) {
    const MONTH_NAMES = ['January','February','March','April','May','June','July',
                         'August','September','October','November','December'];
    const parts = _raceCurrentMonth.trim().split(' ');
    const idx   = MONTH_NAMES.indexOf(parts[0]);
    const yr    = parseInt(parts[1]);
    if (idx !== -1 && !isNaN(yr)) { m = idx + 1; y = yr; }
  }
  if (!m) { const now = new Date(); m = now.getMonth() + 1; y = now.getFullYear(); }
  try {
    const r = await fetch(`/api/sales?month=${m}&year=${y}`, { headers: authHeaders() });
    if (r.ok) {
      const d = await r.json();
      _salesTileEntries = d.entries || [];
    }
  } catch(_) { /* silent */ }
  renderSalesTile();
}

function onSalesTileLocationChange() {
  _salesTileLocation = document.getElementById('sales-tile-loc-sel')?.value || 'all';
  renderSalesTile();
}

function renderSalesTile() {
  const panel = document.getElementById('sales-tile-panel');
  if (!panel) return;
  panel.style.display = '';

  const useSalesLog = _hasSalesAddon || _isAdmin;
  // Only drill into sales_log when a specific location is selected — "All Locations"
  // must read from race_data so that uploaded sales (source='upload') are included.
  const locationActive = useSalesLog && _salesTileLocation !== 'all';

  // Location filter only available when using sales_log data
  const locSel     = document.getElementById('sales-tile-loc-sel');
  const activeLocs = _salesLocations.filter(l => l.active !== false);
  if (locSel) {
    if (useSalesLog && activeLocs.length) {
      locSel.style.display = '';
      locSel.innerHTML = '<option value="all">All Locations</option>' +
        activeLocs.map(l => `<option value="${escHtml(l.name)}"${_salesTileLocation === l.name ? ' selected' : ''}>${escHtml(l.name)}</option>`).join('');
    } else {
      locSel.style.display = 'none';
    }
  }

  // Active scoring cats (exclude deposit/other/skip)
  const SKIP = new Set(['other','other2','other3','other4','other5','deposit','skip']);
  const cats = activeCats().filter(c => !SKIP.has(c.key));

  const agentMap = {};

  if (useSalesLog && _salesTileEntries.length > 0) {
    // Use sales_log for both location-specific and All Locations views so counts are consistent
    const entries = locationActive
      ? _salesTileEntries.filter(e => (e.location || '').trim() === _salesTileLocation && !e.is_cancelled)
      : _salesTileEntries.filter(e => !e.is_cancelled);
    for (const e of entries) {
      if (!e.agent_id || SKIP.has(e.product)) continue;
      if (!agentMap[e.agent_id]) {
        agentMap[e.agent_id] = { name: e.agent_id, total: 0, products: {} };
        for (const c of cats) agentMap[e.agent_id].products[c.key] = 0;
      }
      if (agentMap[e.agent_id].products[e.product] !== undefined) {
        agentMap[e.agent_id].products[e.product]++;
        agentMap[e.agent_id].total++;
      }
    }
    // Resolve names from race_data / roster
    for (const [id, ag] of Object.entries(agentMap)) {
      const rd = (_raceData || []).find(r => r.agent_id === id);
      if (rd) ag.name = rd.name;
      else { const ros = _agentRoster.find(r => r.agent_id === id); if (ros) ag.name = ros.name; }
    }
  } else {
    // Fallback: read product totals from race_data (upload-only accounts with no sales_log entries)
    for (const ag of (_raceData || [])) {
      if (!ag.agent_id) continue;
      const products = {};
      let total = 0;
      for (const c of cats) {
        const n = ag[c.key] || 0;
        products[c.key] = n;
        total += n;
      }
      if (total > 0) agentMap[ag.agent_id] = { name: ag.name || ag.agent_id, total, products };
    }
  }

  const content = document.getElementById('sales-tile-content');
  if (!content) return;
  if (!Object.keys(agentMap).length) {
    content.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:.25rem 0;">No sales recorded this period.</div>';
    return;
  }

  // Totals row
  const totals = { total: 0 };
  for (const c of cats) totals[c.key] = 0;
  for (const ag of Object.values(agentMap)) {
    totals.total += ag.total;
    for (const c of cats) totals[c.key] += (ag.products[c.key] || 0);
  }

  const th = t => `<th style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;padding:4px 6px;text-align:center;white-space:nowrap;border-bottom:1px solid var(--border);">${t}</th>`;
  const td = (v, hi) => `<td style="text-align:center;padding:3px 6px;font-family:'DM Mono',monospace;font-size:12px;color:${hi ? 'var(--accent2)' : v ? 'var(--text)' : 'var(--muted)'};">${v || '—'}</td>`;

  const sortedAgents = Object.values(agentMap).sort((a, b) => b.total - a.total);

  content.innerHTML = `<div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="text-align:left;">
        <th style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;padding:4px 6px;border-bottom:1px solid var(--border);">Agent</th>
        ${cats.map(c => th(c.label)).join('')}
        ${th('Total')}
      </tr></thead>
      <tbody>
        ${sortedAgents.map(ag => `<tr>
          <td style="padding:3px 6px;font-size:12px;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis;">${escHtml(ag.name)}</td>
          ${cats.map(c => td(ag.products[c.key] || 0)).join('')}
          ${td(ag.total, true)}
        </tr>`).join('')}
      </tbody>
      <tfoot><tr style="border-top:1px solid var(--border);">
        <td style="padding:3px 6px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;">Total</td>
        ${cats.map(c => `<td style="text-align:center;padding:3px 6px;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:var(--text);">${totals[c.key] || 0}</td>`).join('')}
        <td style="text-align:center;padding:3px 6px;font-family:'DM Mono',monospace;font-size:12px;font-weight:700;color:var(--accent2);">${totals.total}</td>
      </tr></tfoot>
    </table>
  </div>`;
}

// ── SCORING UI ────────────────────────────────────────────────────────────────
function buildScoringLabelOpts() {
  const cats = activeCats();
  let html = '<option value="">— pick —</option>';
  html += '<optgroup label="Product Types">';
  cats.forEach(c => { html += `<option value="${escHtml(c.label)}">${escHtml(c.label)}</option>`; });
  html += '</optgroup>';
  cats.forEach(c => {
    const subs = _salesSubcats.filter(s => s.scoring_category === c.key && s.active !== false);
    if (!subs.length) return;
    html += `<optgroup label="${escHtml(c.label)} ›">`;
    subs.forEach(s => { html += `<option value="${escHtml(s.label)}">${escHtml(s.label)}</option>`; });
    html += '</optgroup>';
  });
  return html;
}

function buildScoringUI() {
  const fixedCats    = [['wl','Whole Life'],['ul','Universal Life'],['term','Term'],['health','Health'],['auto','Auto'],['fire','Fire']];
  const flexCats     = ['deposit','other','other2','other3','other4','other5'];
  const callFields   = [
    ['placed_sales','Placed (sales)'],['placed_service','Placed (service)'],
    ['answered_sales','Answered (sales)'],['answered_service','Answered (service)'],
    ['talk_per_min','Talk pts/min'],['avg_min','Avg min pts'],
    ['missed_deduct','Missed deduct'],['voicemail_deduct','Voicemail deduct'],
  ];
  const fixedRows = fixedCats.map(([k, lbl]) => `
    <div class="score-cat-row">
      <label><input type="checkbox" id="sc-${k}_enabled" ${SCORING[k+'_enabled'] ? 'checked' : ''}>${lbl}</label>
      <input type="number" id="sc-${k}" step="0.1" value="${SCORING[k]}" placeholder="pts">
    </div>`).join('');
  const labelOpts = buildScoringLabelOpts();
  const flexRows = flexCats.map(k => `
    <div class="score-cat-row">
      <label><input type="checkbox" id="sc-${k}_enabled" ${SCORING[k+'_enabled'] ? 'checked' : ''}>
        <select class="sc-label-pick" title="Pick from product types / subcategories"
                onchange="if(this.value){document.getElementById('sc-${k}_label').value=this.value;this.value=''}">${labelOpts}</select>
        <input type="text" id="sc-${k}_label" class="cat-label-input" value="${CAT_LABELS[k]}" placeholder="label">
      </label>
      <input type="number" id="sc-${k}" step="0.1" value="${SCORING[k]}" placeholder="pts">
    </div>`).join('');
  const callRows = callFields.map(([k, lbl]) =>
    `<div class="score-field"><label>${lbl}</label>
     <input type="number" id="sc-${k}" step="0.1" value="${SCORING[k]}"></div>`
  ).join('');
  document.getElementById('score-grid').innerHTML = `
    <div class="score-section-title">Policy Categories</div>
    ${fixedRows}${flexRows}
    <div class="score-section-title">Call Activity</div>
    <div class="score-grid-inner">${callRows}</div>`;
  buildTeamToggleUI();
}

function buildTeamToggleUI() {
  const grid = document.getElementById('team-assign-grid');
  if (!grid) return;
  if (!_raceData.length) { grid.innerHTML = '<p style="font-size:13px;color:var(--muted)">Load race data first.</p>'; return; }
  const _activeRaceIds = _agentRoster.length > 0 ? new Set(_agentRoster.filter(a => a.active !== false).map(a => a.agent_id)) : null;
  const _visibleRace   = _activeRaceIds ? _raceData.filter(ag => _activeRaceIds.has(ag.agent_id)) : _raceData;
  grid.innerHTML = [..._visibleRace].sort((a,b) => a.name.localeCompare(b.name)).map(ag => `
    <div class="team-assign-row">
      <span class="team-assign-name">${escHtml(ag.name)}</span>
      <div class="team-toggle">
        <button class="team-btn team-btn-sales${ag.team==='sales'?' active':''}"
          onclick="setAgentTeam('${ag.agent_id}','sales',this)">Sales</button>
        <button class="team-btn team-btn-service${ag.team==='service'?' active':''}"
          onclick="setAgentTeam('${ag.agent_id}','service',this)">Service</button>
      </div>
    </div>`).join('');
}

async function setAgentTeam(agentId, team, btn) {
  if (_isMember && _memberRole !== 'captain') return;
  const [{ error }, rosterRes] = await Promise.all([
    _supabase.from('race_data').update({ team }).eq('user_id', _dataUserId).eq('agent_id', agentId),
    fetch('/api/agent-roster', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ action: 'set_team', agent_id: agentId, team }) }),
  ]);
  const msg = document.getElementById('team-assign-msg');
  msg.style.display = 'block';
  if (error) {
    msg.style.color = 'var(--danger)'; msg.textContent = 'Error: ' + error.message;
  } else {
    const ag = _raceData.find(r => r.agent_id === agentId);
    if (ag) {
      ag.team = team;
      if (_perfData) renderPerf();
    }
    const ra = _agentRoster.find(r => r.agent_id === agentId);
    if (ra) ra.team = team;
    buildTeamToggleUI();
    renderRace(_raceData);
    msg.style.color = 'var(--accent2)'; msg.textContent = 'Team updated.';
  }
  setTimeout(() => { msg.style.display = 'none'; }, 2500);
}

async function saveScoring() {
  if (!_userId) return;
  if (_isMember && _memberRole !== 'captain') return;
  const fields = Object.keys(DEFAULT_SCORING);
  fields.forEach(k => {
    if (k.endsWith('_enabled')) {
      const cb = document.getElementById('sc-' + k);
      if (cb) SCORING[k] = cb.checked ? 1 : 0;
    } else {
      const val = parseFloat(document.getElementById('sc-'+k)?.value);
      if (!isNaN(val)) SCORING[k] = val;
    }
  });

  const rows = fields.map(k => ({ user_id: _dataUserId, config_key: k, config_value: String(SCORING[k]) }));
  Object.keys(CAT_LABELS).forEach(k => {
    const input = document.getElementById('sc-' + k + '_label');
    if (input && input.value.trim()) CAT_LABELS[k] = input.value.trim();
    rows.push({ user_id: _dataUserId, config_key: k + '_label', config_value: CAT_LABELS[k] });
  });
  const { error } = await _supabase.from('scoring_config')
    .upsert(rows, { onConflict: 'user_id,config_key' });

  const msg = document.getElementById('scoring-msg');
  msg.style.display = 'block';
  if (error) { msg.style.color='var(--danger)'; msg.textContent='Error: '+error.message; }
  else { msg.style.color='var(--accent2)'; msg.textContent='Scoring saved.'; loadRaceData(); }
  setTimeout(() => { msg.style.display='none'; }, 3000);
}

