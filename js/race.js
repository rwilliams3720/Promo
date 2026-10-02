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

  // Step 1: fetch config and race rows first so we can scope date-sensitive queries to the current month
  const [rdRes, scRes, rcRes] = await Promise.all([
    _supabase.from('race_data').select('*').eq('user_id', _dataUserId),
    _supabase.from('scoring_config').select('config_key,config_value').eq('user_id', _dataUserId),
    _supabase.from('race_config').select('key,value').eq('user_id', _dataUserId),
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

  // Compute date range for the current race month so queries are scoped to the right month
  let fromDate = null, toDate = null;
  if (month) {
    const FULL12 = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const ABBR12 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const parts = month.trim().split(' ');
    let idx = FULL12.indexOf(parts[0]);
    if (idx === -1) idx = ABBR12.indexOf(parts[0]);
    const yr = parseInt(parts[1]);
    if (idx !== -1 && !isNaN(yr)) {
      const m = idx + 1;
      fromDate = `${yr}-${String(m).padStart(2,'0')}-01`;
      const lastDay = new Date(yr, m, 0).getDate();
      toDate = `${yr}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    }
  }

  // Step 2: fetch call and sales data scoped to the current race month.
  // If no race month is set (race_config.current_month is blanked to '' by an
  // Archive & Reset until the owner picks a new one), there's no safe range to
  // scope by — querying with no bounds at all would sum every voicemail/missed
  // call and every deposit/other sale ever logged, not just this month's. Skip
  // these entirely rather than ever run them unscoped (same root cause fixed in
  // api/_lib/race-data.js — see CLAUDE.md "Annual Raise-Eligibility Tracker").
  let vmRes = { count: 0 }, msRes = { count: 0 }, slRes = { data: [] };
  if (fromDate && toDate) {
    [vmRes, msRes, slRes] = await Promise.all([
      _supabase.from('call_log').select('*', { count: 'exact', head: true }).eq('user_id', _dataUserId).eq('disposition', 'voicemail').gte('call_dt', fromDate).lte('call_dt', toDate),
      _supabase.from('call_log').select('*', { count: 'exact', head: true }).eq('user_id', _dataUserId).eq('disposition', 'missed').gte('call_dt', fromDate).lte('call_dt', toDate),
      _supabase.from('sales_log').select('agent_id,product').eq('user_id', _dataUserId).in('product', ['deposit','other','other2','other3','other4','other5']).gte('sale_date', fromDate).lte('sale_date', toDate),
    ]);
  }

  _raceWideVm     = vmRes.count || 0;
  _raceWideMissed = msRes.count || 0;

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

// `teamAnswered` is the total answered-call count across every agent being scored in this
// same pass (both teams combined) — needed only for the handle-rate-based penalty below, to
// compute the team's actual handle rate. `serviceAnswered`/`serviceCount` are the same-pass
// totals restricted to service-team agents, needed only when service_coverage_enabled is also
// on. Callers must pass all three over the exact same agent population being scored (see
// CLAUDE.md "Handle Rate Penalty") so the displayed numbers always match what's deducted;
// omit them only when handle_rate_enabled is off.
function calcScore(ag, teamAnswered, serviceAnswered, serviceCount) {
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

  let deduct;
  if (SCORING.handle_rate_enabled) {
    const totalAnswered = teamAnswered || 0;
    const totalCalls    = totalAnswered + _raceWideMissed + _raceWideVm;
    if (svc) {
      deduct = calcServiceCoverageDeduct(ag, gross, totalCalls, serviceAnswered, serviceCount);
    } else {
      // Sales-team-only, rate-based penalty. Scales with how far the whole team's handle rate
      // falls below target, not with raw missed-call volume, and is capped as a % of the
      // agent's own gross so a bad team month can never wipe out an individual's production.
      const handleRate = totalCalls > 0 ? (totalAnswered / totalCalls * 100) : 100;
      const shortfall   = Math.max(0, (SCORING.handle_rate_target || 0) - handleRate);
      if (shortfall <= 0) {
        deduct = 0;
      } else {
        const raw = -Math.round(shortfall * (SCORING.handle_rate_penalty_per_pt || 0));
        const cap = -Math.round(gross * (SCORING.handle_rate_penalty_cap_pct || 0) / 100);
        deduct = Math.max(raw, cap); // cap is the less-negative floor
      }
    }
  } else {
    deduct = Math.round(_raceWideMissed*SCORING.missed_deduct + _raceWideVm*SCORING.voicemail_deduct);
  }
  return { gross, deduct, total: Math.max(0, gross + deduct) };
}

// Service-team deduction — off (0) unless service_coverage_enabled is also on, in which case
// service is no longer fully exempt from handle_rate_enabled's penalty. The team only owes
// anything once its collective share of total call volume misses service_coverage_target_pct;
// once it does, each agent's own slice is driven by how far THEY personally fall below an
// equal "fair share" of that target (target ÷ active service agents) — an agent who meets or
// beats their own fair share owes nothing even while a teammate drags the team average down,
// so the team's shortfall can't be ridden by a low contributor while a high contributor
// shields them. See CLAUDE.md "Handle Rate Penalty" for the worked example this mirrors.
function calcServiceCoverageDeduct(ag, gross, totalCalls, serviceAnswered, serviceCount) {
  if (!SCORING.service_coverage_enabled) return 0;
  const n = serviceCount || 0;
  if (n <= 0) return 0;
  const targetPct      = SCORING.service_coverage_target_pct || 0;
  const teamServicePct = totalCalls > 0 ? ((serviceAnswered || 0) / totalCalls * 100) : 0;
  const teamShortfall  = Math.max(0, targetPct - teamServicePct);
  if (teamShortfall <= 0) return 0;
  const fairSharePct = targetPct / n;
  const myContribPct = totalCalls > 0 ? ((ag.answered || 0) / totalCalls * 100) : 0;
  const myShortfall  = Math.max(0, fairSharePct - myContribPct);
  if (myShortfall <= 0) return 0;
  const raw = -Math.round(myShortfall * (SCORING.service_coverage_penalty_per_pt || 0));
  const cap = -Math.round(gross * (SCORING.service_coverage_penalty_cap_pct || 0) / 100);
  return Math.max(raw, cap);
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

  // Team-wide totals across the exact population being scored — only consumed by calcScore's
  // handle-rate/service-coverage branches, but computed unconditionally since it's cheap and
  // keeps the deduct-box summary below trivially consistent with what each agent was actually
  // scored against (same numbers, not a second independent recomputation).
  const teamAnswered   = activeData.reduce((s, a) => s + (a.answered||0), 0);
  const serviceAgents  = activeData.filter(a => a.team === 'service');
  const serviceAnswered = serviceAgents.reduce((s, a) => s + (a.answered||0), 0);
  const serviceCount    = serviceAgents.length;

  const agents = activeData.map((ag, i) => {
    if (!AGENT_COLORS[ag.agent_id]) AGENT_COLORS[ag.agent_id] = COLORS[Object.keys(AGENT_COLORS).length % COLORS.length];
    // Use roster name as source of truth — updates immediately when renamed
    const rosterName = _agentRoster.find(a => a.agent_id === ag.agent_id)?.name;
    const sc = calcScore(ag, teamAnswered, serviceAnswered, serviceCount);
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

  if (SCORING.handle_rate_enabled) {
    const totalCalls = teamAnswered + rwMissed + rwVm;
    const handleRate  = totalCalls > 0 ? (teamAnswered / totalCalls * 100) : 100;
    const target      = SCORING.handle_rate_target || 0;
    const shortfall   = Math.max(0, target - handleRate);
    const rawPenalty  = Math.round(shortfall * (SCORING.handle_rate_penalty_per_pt || 0));

    let serviceBlock = `<div style="font-size:11px;color:var(--muted);margin-top:8px;">Service team is exempt from this penalty.</div>`;
    if (SCORING.service_coverage_enabled && serviceCount > 0) {
      const svcTargetPct = SCORING.service_coverage_target_pct || 0;
      const svcActualPct = totalCalls > 0 ? (serviceAnswered / totalCalls * 100) : 0;
      const svcShortfall = Math.max(0, svcTargetPct - svcActualPct);
      const fairShare    = svcTargetPct / serviceCount;
      serviceBlock = `
      <div style="font-size:12px;color:var(--muted);margin:12px 0 8px;font-weight:600">SERVICE COVERAGE TARGET</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div><div style="font-size:11px;color:var(--muted)">Service Share of Calls</div><div style="font-family:'DM Mono',monospace;color:${svcActualPct >= svcTargetPct ? 'var(--accent2)' : 'var(--danger)'};font-size:15px">${svcActualPct.toFixed(1)}% (target ${svcTargetPct}%)</div></div>
        <div><div style="font-size:11px;color:var(--muted)">Team Shortfall</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${svcShortfall.toFixed(1)} pts</div></div>
        <div><div style="font-size:11px;color:var(--muted)">Fair Share / Agent (${serviceCount})</div><div style="font-family:'DM Mono',monospace;color:var(--text);font-size:15px">${fairShare.toFixed(1)}%</div></div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;">Only an agent whose own contribution falls below ${fairShare.toFixed(1)}% is penalized, scaled to their own gap — meeting or beating your fair share means $0 regardless of teammates.</div>`;
    }

    document.getElementById('deduct-box').innerHTML = `
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;font-weight:600">HANDLE RATE PENALTY (SALES TEAM)</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div><div style="font-size:11px;color:var(--muted)">Handle Rate</div><div style="font-family:'DM Mono',monospace;color:${handleRate >= target ? 'var(--accent2)' : 'var(--danger)'};font-size:15px">${handleRate.toFixed(1)}% (target ${target}%)</div></div>
        <div><div style="font-size:11px;color:var(--muted)">Shortfall</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${shortfall.toFixed(1)} pts</div></div>
        <div><div style="font-size:11px;color:var(--muted)">Penalty per Sales Agent</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">-${rawPenalty} (capped at ${SCORING.handle_rate_penalty_cap_pct}% of own score)</div></div>
      </div>
      ${serviceBlock}`;
  } else {
    document.getElementById('deduct-box').innerHTML = `
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px;font-weight:600">RACE-WIDE DEDUCTIONS</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap;">
        <div><div style="font-size:11px;color:var(--muted)">Voicemails</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${rwVm} × ${SCORING.voicemail_deduct} = ${Math.round(rwVm*SCORING.voicemail_deduct)}</div></div>
        <div><div style="font-size:11px;color:var(--muted)">Missed</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${rwMissed} × ${SCORING.missed_deduct} = ${Math.round(rwMissed*SCORING.missed_deduct)}</div></div>
        <div><div style="font-size:11px;color:var(--muted)">Total Deduction</div><div style="font-family:'DM Mono',monospace;color:var(--danger);font-size:15px">${Math.round(rwVm*SCORING.voicemail_deduct + rwMissed*SCORING.missed_deduct)}</div></div>
      </div>`;
  }
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

  // GET /api/sales scopes results to just the caller's own agent_id for bosun/custom members
  // (correct for the Sales Log tab) — so _salesTileEntries is never office-wide for them. Force
  // the race_data fallback below instead of drilling into that per-agent-scoped data, or the tile
  // narrows from "whole office" down to "just me" the moment loadSalesTileData()'s fetch resolves.
  const isCapOrCO   = !_isMember || ['captain','chief_officer'].includes(_memberRole);
  const useSalesLog = (_hasSalesAddon || _isAdmin) && isCapOrCO;
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
        const weight = e.sale_weight ?? 1; // split sales are two rows at 0.5 each — see CLAUDE.md "Split sales"
        agentMap[e.agent_id].products[e.product] += weight;
        agentMap[e.agent_id].total += weight;
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
  const handleRateOn = !!SCORING.handle_rate_enabled;
  const hrField = (k, lbl, placeholder, hint) => `
    <div class="score-field">
      <label>${lbl}</label>
      <input type="number" id="sc-${k}" step="1" value="${SCORING[k]}" placeholder="${placeholder}">
      <div style="font-size:11px;color:var(--muted);line-height:1.4;">${hint} Suggested: <b>${placeholder}</b></div>
    </div>`;
  const serviceCoverageOn = !!SCORING.service_coverage_enabled;
  document.getElementById('score-grid').innerHTML = `
    <div class="score-section-title">Policy Categories</div>
    ${fixedRows}${flexRows}
    <div class="score-section-title">Call Activity</div>
    <div class="score-grid-inner">${callRows}</div>
    <div class="score-section-title" style="margin-top:14px;">Handle Rate Penalty (Sales Team)</div>
    <div class="score-cat-row">
      <label><input type="checkbox" id="sc-handle_rate_enabled" ${handleRateOn ? 'checked' : ''} onchange="toggleHandleRateFields(this.checked)">
        Enable handle-rate-based penalty — replaces the flat Missed/Voicemail deduct above, sales team only. Leave unchecked to keep the current flat deduction for everyone.</label>
    </div>
    <div id="handle-rate-fields" style="display:${handleRateOn ? '' : 'none'};margin-top:6px;">
      <div class="score-grid-inner">
        ${hrField('handle_rate_target', 'Target Handle Rate %', '95',
          'The handle rate (answered ÷ (answered + missed + voicemail)) your team should be hitting. No penalty applies at or above this.')}
        ${hrField('handle_rate_penalty_per_pt', 'Points per % Shortfall', '20',
          'How many points each sales agent loses per 1 percentage point the team falls below target. Example: at 20 pts, a 5-point shortfall costs each sales agent 100 points.')}
        ${hrField('handle_rate_penalty_cap_pct', 'Deduction Cap (% of Own Score)', '50',
          "Caps how much of one agent's own gross score the penalty can ever take, so a bad team month can't wipe out a strong individual producer. Example: at 50%, an agent never loses more than half of what they personally earned.")}
      </div>
      <div class="score-cat-row" style="margin-top:12px;">
        <label><input type="checkbox" id="sc-service_coverage_enabled" ${serviceCoverageOn ? 'checked' : ''} onchange="toggleServiceCoverageFields(this.checked)">
          Also hold the service team accountable to a coverage target — without this, service is fully exempt from any deduction above.</label>
      </div>
      <div id="service-coverage-fields" style="display:${serviceCoverageOn ? '' : 'none'};margin-top:6px;">
        <div class="score-grid-inner">
          ${hrField('service_coverage_target_pct', 'Service Target (% of Total Call Volume)', '25',
            'The share of ALL inbound calls (both teams combined) your service team should collectively be answering. Set this based on your own staffing/volume, not a universal benchmark.')}
          ${hrField('service_coverage_penalty_per_pt', 'Points per % Shortfall (Service)', '10',
            "How many points a service agent loses per 1 percentage point they personally fall below their own fair share (target ÷ number of service agents) — only once the TEAM as a whole misses its target.")}
          ${hrField('service_coverage_penalty_cap_pct', 'Deduction Cap (% of Own Score, Service)', '50',
            'Same protection as the sales cap above, applied to each service agent.')}
        </div>
        <div style="font-size:11px;color:var(--muted);line-height:1.5;margin-top:4px;">
          Example: 2,000 total calls, 90% service target (1,800 calls), team actually answers 80% (1,600). With 3 service agents, each has a 30% fair share. An agent who personally answered 70% of total volume owes nothing — they're far above their fair share. Two agents who together only covered 10% (5% each) each owe a penalty on their 25-point personal shortfall (30% fair share − 5% contributed), not an equal split of the team's 10-point gap. Nobody on service is penalized at all if the team hits 90%+, regardless of how contributions split.
        </div>
      </div>
    </div>`;
  toggleHandleRateFields(handleRateOn);
  toggleServiceCoverageFields(serviceCoverageOn);
  buildTeamToggleUI();
}

// Greys out the legacy flat Missed/Voicemail deduct fields while the handle-rate mode is
// enabled (they're not read by calcScore in that mode, but their saved values are left
// alone so switching back off restores the prior flat-deduction behavior unchanged).
function toggleHandleRateFields(enabled) {
  const box = document.getElementById('handle-rate-fields');
  if (box) box.style.display = enabled ? '' : 'none';
  ['missed_deduct', 'voicemail_deduct'].forEach(k => {
    const inp = document.getElementById('sc-' + k);
    if (inp) { inp.disabled = enabled; inp.style.opacity = enabled ? 0.4 : 1; }
  });
}

function toggleServiceCoverageFields(enabled) {
  const box = document.getElementById('service-coverage-fields');
  if (box) box.style.display = enabled ? '' : 'none';
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

