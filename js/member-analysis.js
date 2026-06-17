// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showInlineMsg(id, text, type='ok') {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  el.style.color   = type === 'ok' ? 'var(--accent2)' : 'var(--danger)';
  el.textContent   = text;
  setTimeout(() => { if (el) el.style.display = 'none'; }, 4000);
}

// ── Member Analysis — billing ─────────────────────────────────────────────────
async function purchaseMemberAnalysis(btn) {
  const countEl = document.getElementById('ma-seat-count-new');
  const count = Math.max(1, parseInt(countEl?.value) || 1);
  btn.disabled = true; btn.textContent = 'Redirecting…';
  try {
    const r = await fetch('/api/member-analysis-checkout', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    });
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else { showInlineMsg('ma-upsell-msg', d.error || 'Error', 'err'); btn.disabled = false; btn.textContent = 'Subscribe'; }
  } catch(e) { showInlineMsg('ma-upsell-msg', e.message, 'err'); btn.disabled = false; btn.textContent = 'Subscribe'; }
}

async function updateMemberAnalysisCount(btn) {
  const countEl = document.getElementById('ma-seat-count-update');
  const count = Math.max(1, parseInt(countEl?.value) || 1);
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const r = await fetch('/api/member-analysis-checkout', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', count }),
    });
    const d = await r.json();
    if (r.ok) {
      _memberAnalysisCount = count;
      showInlineMsg('ma-update-msg', `Updated to ${count} seat${count !== 1 ? 's' : ''} ($${count * 10}/mo).`, 'ok');
      document.getElementById('ma-active-price').textContent = `${count} seat${count !== 1 ? 's' : ''} · $${count * 10}/mo`;
      renderMemberAnalysisAgentPicker();
    } else {
      showInlineMsg('ma-update-msg', d.error || 'Update failed', 'err');
    }
  } catch(e) { showInlineMsg('ma-update-msg', e.message, 'err'); }
  btn.disabled = false; btn.textContent = 'Update';
}

async function cancelMemberAnalysis(btn) {
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = 'Confirm Remove — click again to cancel';
    setTimeout(() => { if (btn.dataset.confirming === 'yes') { btn.dataset.confirming = ''; btn.textContent = 'Remove Add-On'; } }, 5000);
    return;
  }
  btn.disabled = true; btn.textContent = 'Removing…';
  try {
    const r = await fetch('/api/member-analysis-checkout', { method: 'DELETE', headers: authHeaders() });
    const d = await r.json();
    if (!r.ok) {
      showInlineMsg('ma-cancel-msg', d.error || 'Error removing add-on', 'err');
      btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = '';
      return;
    }
    _hasMemberAnalysis = false;
    _memberAnalysisCount = 0;
    await loadAccountTab();
  } catch(e) { showInlineMsg('ma-cancel-msg', e.message, 'err'); btn.disabled = false; btn.textContent = 'Remove Add-On'; btn.dataset.confirming = ''; }
}

function renderMemberAnalysisSection(acct) {
  const hasMa = acct.has_member_analysis || _hasMemberAnalysis;
  document.getElementById('member-analysis-upsell').style.display = hasMa ? 'none' : '';
  document.getElementById('member-analysis-active').style.display = hasMa ? ''     : 'none';
  if (hasMa) {
    const count = acct.member_analysis_count || _memberAnalysisCount || 0;
    const priceEl = document.getElementById('ma-active-price');
    if (priceEl) priceEl.textContent = `${count} seat${count !== 1 ? 's' : ''} · $${count * 10}/mo`;
    const updateEl = document.getElementById('ma-seat-count-update');
    if (updateEl) updateEl.value = count;
  }
}

// ── Member Analysis — agent picker ───────────────────────────────────────────
function maAgentLockRemainingMs() {
  if (_isAdmin || !_memberAnalysisAgentsSetAt) return 0;
  return Math.max(0, new Date(_memberAnalysisAgentsSetAt).getTime() + MA_AGENT_LOCK_MS - Date.now());
}

function renderMemberAnalysisAgentPicker() {
  const desc = document.getElementById('ma-agents-desc');
  const container = document.getElementById('ma-agent-picker');
  if (!container) return;
  const count   = _memberAnalysisCount || 0;
  const isAdmin = _isAdmin;
  const lockMs  = maAgentLockRemainingMs();
  const locked  = lockMs > 0;

  if (desc) desc.textContent = `Select up to ${isAdmin ? 'unlimited' : count} agent${count !== 1 ? 's' : ''} for individual coaching analysis${count > 0 ? ` (${count} seat${count !== 1 ? 's' : ''} purchased)` : ''}.`;

  // Source: agent_roster (active only) if has_sales_addon, else race_data
  let agents = [];
  if (_hasSalesAddon || _isAdmin) {
    agents = _agentRoster.filter(a => a.agent_id && a.name && a.active !== false).map(a => ({ id: a.agent_id, name: a.name }));
  } else {
    agents = (_raceData || []).filter(a => a.agent_id && a.name).map(a => ({ id: a.agent_id, name: a.name }));
  }

  const activeIdSet    = new Set(agents.map(a => a.id));
  const selectedIds    = new Set((_memberAnalysisAgents || []).map(a => a.agent_id || a));
  const inactiveInSel  = (_memberAnalysisAgents || []).filter(a => {
    const id = a.agent_id || a;
    return selectedIds.has(id) && !activeIdSet.has(id);
  });

  container.innerHTML = agents.map(ag => {
    const isChecked = selectedIds.has(ag.id);
    const checked = isChecked ? 'checked' : '';
    // When locked: selected agents cannot be removed; unselected can still be added if a seat is open
    const seatAvailable = isAdmin || selectedIds.size < count;
    const disableThis = locked && (isChecked || !seatAvailable);
    return `<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--card2);border:1px solid var(--border2);border-radius:8px;font-size:13px;${disableThis ? 'opacity:.55;cursor:not-allowed;' : 'cursor:pointer;'}">
      <input type="checkbox" value="${escHtml(ag.id)}" data-name="${escHtml(ag.name)}" ${checked}
             ${disableThis ? 'disabled' : `onchange="enforceMaLimit(this,${isAdmin ? 9999 : count})"`}>
      ${escHtml(ag.name)}
    </label>`;
  }).join('');

  if (!agents.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--muted);">No agents found. Add agents to the roster first.</div>';
  }

  // Inactive-in-selection warning
  let inactiveEl = document.getElementById('ma-inactive-warn');
  if (!inactiveEl) {
    inactiveEl = document.createElement('div');
    inactiveEl.id = 'ma-inactive-warn';
    container.parentNode.insertBefore(inactiveEl, container);
  }
  if (inactiveInSel.length) {
    const names = inactiveInSel.map(a => escHtml(a.name || a.agent_id || a)).join(', ');
    inactiveEl.innerHTML = `<div style="margin-bottom:.6rem;padding:.65rem .9rem;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:8px;font-size:13px;color:var(--warn);">
      <strong>${inactiveInSel.length} agent${inactiveInSel.length !== 1 ? 's' : ''} no longer active:</strong> ${names}.
      <button onclick="removeInactiveMaAgents(this)" style="margin-left:10px;font-size:12px;padding:2px 10px;background:rgba(251,191,36,.15);border:1px solid rgba(251,191,36,.4);color:var(--warn);border-radius:5px;cursor:pointer;">Remove from selection</button>
    </div>`;
  } else {
    inactiveEl.innerHTML = '';
  }

  // Lock status row
  let lockEl = document.getElementById('ma-agent-lock-status');
  if (!lockEl) {
    lockEl = document.createElement('div');
    lockEl.id = 'ma-agent-lock-status';
    lockEl.style.cssText = 'font-size:12px;margin-bottom:.5rem;';
    container.parentNode.insertBefore(lockEl, container.nextSibling);
  }
  if (locked) {
    const days  = Math.ceil(lockMs / 86400000);
    const unlockDate = new Date(Date.now() + lockMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    lockEl.innerHTML = `<span style="color:var(--warning,#f5a623);">&#128274; Agent selection is locked until ${unlockDate} (${days} day${days !== 1 ? 's' : ''} remaining). Subscriptions lock agent selection for 30 days to ensure consistent analysis.</span>`;
    // Auto-refresh when lock expires
    setTimeout(() => { renderMemberAnalysisAgentPicker(); }, Math.min(lockMs + 500, 3600000));
  } else {
    lockEl.textContent = '';
  }

  // Save button: disabled only when fully locked (no open seats and nothing can be changed)
  const saveBtn = container.closest('.acct-section')?.querySelector('button[onclick*="saveMemberAnalysisAgents"]');
  if (saveBtn) saveBtn.disabled = locked && (selectedIds.size >= count && !isAdmin);

  if (!locked) updateMaCounter();
}

function updateMaCounter() {
  const el = document.getElementById('ma-seat-counter');
  if (!el) return;
  if (_isAdmin) { el.textContent = ''; return; }
  const limit = _memberAnalysisCount || 0;
  const checked = document.querySelectorAll('#ma-agent-picker input[type=checkbox]:checked').length;
  const remaining = limit - checked;
  el.style.color = remaining <= 0 ? 'var(--danger)' : 'var(--muted)';
  el.textContent = remaining > 0
    ? `${remaining} seat${remaining !== 1 ? 's' : ''} remaining`
    : `0 seats remaining — uncheck an agent to select a different one`;
}

function enforceMaLimit(cb, limit) {
  const all = document.querySelectorAll('#ma-agent-picker input[type=checkbox]');
  const checkedCount = Array.from(all).filter(c => c.checked).length;
  if (checkedCount > limit) { cb.checked = false; }
  updateMaCounter();
}

async function saveMemberAnalysisAgents(btn) {
  const all = document.querySelectorAll('#ma-agent-picker input[type=checkbox]:checked');
  const agents = Array.from(all).map(cb => ({ agent_id: cb.value, name: cb.dataset.name }));
  const limit = _memberAnalysisCount || 0;
  if (!_isAdmin && agents.length > limit) {
    showInlineMsg('ma-agents-msg', `Seat limit is ${limit}. Uncheck ${agents.length - limit} agent${agents.length - limit !== 1 ? 's' : ''}.`, 'err');
    return;
  }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/member-analysis', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents }),
    });
    const d = await r.json();
    if (r.ok) {
      _memberAnalysisAgents = agents;
      if (d.lockedUntil) {
        // Full save — lock clock was reset
        _memberAnalysisAgentsSetAt = new Date().toISOString();
        showInlineMsg('ma-agents-msg', 'Agent selection saved. Selection is locked for 30 days.', 'ok');
      } else {
        // Additive save — lock clock unchanged
        showInlineMsg('ma-agents-msg', 'Agent added to selection.', 'ok');
      }
      renderMemberAnalysisAgentPicker();
    } else {
      showInlineMsg('ma-agents-msg', d.error || 'Save failed', 'err');
    }
  } catch(e) { showInlineMsg('ma-agents-msg', e.message, 'err'); }
  btn.disabled = false; btn.textContent = 'Save Selection';
}

async function removeInactiveMaAgents(btn) {
  // Build active agent id set
  const activeIds = new Set(
    (_hasSalesAddon || _isAdmin)
      ? _agentRoster.filter(a => a.active !== false).map(a => a.agent_id)
      : (_raceData || []).map(a => a.agent_id)
  );
  const filtered = (_memberAnalysisAgents || []).filter(a => activeIds.has(a.agent_id || a));
  if (filtered.length === _memberAnalysisAgents.length) return; // nothing to do

  btn.disabled = true; btn.textContent = 'Removing…';
  try {
    const r = await fetch('/api/member-analysis', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: filtered, removeInactiveOnly: true }),
    });
    const d = await r.json();
    if (r.ok) {
      _memberAnalysisAgents = filtered;
      // lock timestamp intentionally NOT updated — removal of inactive agents doesn't restart clock
      showInlineMsg('ma-agents-msg', 'Inactive agents removed from selection.', 'ok');
      renderMemberAnalysisAgentPicker();
    } else {
      btn.disabled = false; btn.textContent = 'Remove from selection';
      showInlineMsg('ma-agents-msg', d.error || 'Remove failed', 'err');
    }
  } catch(e) {
    btn.disabled = false; btn.textContent = 'Remove from selection';
    showInlineMsg('ma-agents-msg', e.message, 'err');
  }
}

// ── Member Analysis — analysis pane ──────────────────────────────────────────
function showAnalysisSubTab(name, btn) {
  document.getElementById('analysis-pane-trends').style.display       = name === 'trends'       ? '' : 'none';
  document.getElementById('analysis-pane-members').style.display      = name === 'members'      ? '' : 'none';
  document.getElementById('analysis-pane-leadsources').style.display  = name === 'leadsources'  ? '' : 'none';
  document.getElementById('analysis-pane-premaccuracy').style.display = name === 'premaccuracy' ? '' : 'none';
  document.querySelectorAll('#tab-analysis .acct-stab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'leadsources') {
    const hasAddon = _hasSalesAddon || _isAdmin;
    document.getElementById('la-teaser').style.display  = hasAddon ? 'none' : '';
    document.getElementById('la-content').style.display = hasAddon ? ''     : 'none';
    if (hasAddon) { updateLeadAnalysisBtn(); displayCachedLeadAnalysis(); }
  }
  if (name === 'premaccuracy') {
    const monthInput = document.getElementById('pa-month-input');
    if (monthInput && !monthInput.value) {
      const now = new Date();
      monthInput.value = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
    }
  }
}

// ── Premium Accuracy ──────────────────────────────────────────────────────────

let _paEntries = [];

async function loadPremiumAccuracyData() {
  const monthInput = document.getElementById('pa-month-input');
  const month = monthInput?.value;
  if (!month) { showInlineMsg('pa-msg', 'Select a month first.', 'err'); return; }
  const [year, mo] = month.split('-');
  const fromDate = `${year}-${mo}-01`;
  const lastDay  = new Date(parseInt(year), parseInt(mo), 0).getDate();
  const toDate   = `${year}-${mo}-${String(lastDay).padStart(2,'0')}`;
  const loading  = document.getElementById('pa-loading');
  const wrap     = document.getElementById('pa-table-wrap');
  loading.style.display = ''; wrap.style.display = 'none';
  try {
    const r = await fetch(`/api/sales?fromDate=${fromDate}&toDate=${toDate}`, { headers: authHeaders() });
    const d = await r.json();
    _paEntries = d.entries || [];
    renderPremiumAccuracyTable();
  } catch(e) {
    showInlineMsg('pa-msg', 'Error loading data.', 'err');
  } finally {
    loading.style.display = 'none';
  }
}

function renderPremiumAccuracyTable() {
  const byAgent = {};
  for (const e of _paEntries) {
    const agentId   = e.agent_id || '(unknown)';
    const agentName = _agentRoster.find(a => a.agent_id === agentId)?.name || agentId;
    if (!byAgent[agentId]) byAgent[agentId] = { name: agentName, submitted: 0, issued: 0, matchCount: 0, total: 0 };
    const sub = parseFloat(e.written_premium) || 0;
    const iss = parseFloat(e.issued_premium)  || 0;
    byAgent[agentId].total++;
    if (sub > 0) byAgent[agentId].submitted += sub;
    if (iss > 0) byAgent[agentId].issued    += iss;
    if (sub > 0 && iss > 0) byAgent[agentId].matchCount++;
  }
  const agents    = Object.values(byAgent).sort((a, b) => b.submitted - a.submitted);
  const totalSub  = agents.reduce((s, a) => s + a.submitted, 0);
  const totalIss  = agents.reduce((s, a) => s + a.issued, 0);
  const fmt = v => v ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const pct = (iss, sub) => sub > 0 ? (iss / sub * 100).toFixed(1) + '%' : '—';
  const pctStyle = (iss, sub) => {
    if (!sub) return '';
    const a = iss / sub * 100;
    return a >= 95 ? 'color:var(--accent2);' : a >= 80 ? 'color:var(--warn);' : 'color:var(--danger);';
  };
  const el = document.getElementById('pa-table-wrap');
  if (!agents.length) {
    el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:2rem;">No sales data for this period. Make sure agents have issued premium amounts entered.</div>';
    el.style.display = ''; return;
  }
  el.innerHTML = `
    <div style="font-size:13px;margin-bottom:.85rem;padding:.6rem .8rem;background:var(--card2);border-radius:8px;">
      <strong>Team:</strong> ${fmt(totalSub)} submitted · ${fmt(totalIss)} issued ·
      <strong style="${pctStyle(totalIss,totalSub)}">${pct(totalIss,totalSub)} accuracy</strong>
    </div>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:1px solid var(--border2);">
        <th style="text-align:left;padding:6px 10px;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Agent</th>
        <th style="text-align:right;padding:6px 10px;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Submitted</th>
        <th style="text-align:right;padding:6px 10px;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Issued</th>
        <th style="text-align:right;padding:6px 10px;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Matched / Total</th>
        <th style="text-align:right;padding:6px 10px;font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:600;">Accuracy</th>
      </tr></thead>
      <tbody>
        ${agents.map(a => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);">
          <td style="padding:7px 10px;font-weight:600;">${escHtml(a.name)}</td>
          <td style="padding:7px 10px;text-align:right;">${fmt(a.submitted)}</td>
          <td style="padding:7px 10px;text-align:right;">${fmt(a.issued)}</td>
          <td style="padding:7px 10px;text-align:right;color:var(--muted);">${a.matchCount} / ${a.total}</td>
          <td style="padding:7px 10px;text-align:right;font-weight:700;${pctStyle(a.issued,a.submitted)}">${pct(a.issued,a.submitted)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  el.style.display = '';
}

// ── Lead Source Analysis ──────────────────────────────────────────────────────

function leadAnalysisRemainingMs() {
  if (!_leadAnalysisAt) return 0;
  return Math.max(0, new Date(_leadAnalysisAt).getTime() + LEAD_ANALYSIS_COOLDOWN_MS - Date.now());
}

function updateLeadAnalysisBtn() {
  const btn       = document.getElementById('la-refresh-btn');
  const forceLink = document.getElementById('la-force-link');
  if (!btn) return;
  const remaining = leadAnalysisRemainingMs();
  if (remaining > 0) {
    const days  = Math.floor(remaining / 86400000);
    const hrs   = Math.floor((remaining % 86400000) / 3600000);
    const label = days > 0 ? `${days}d ${hrs}h` : `${hrs}h`;
    btn.disabled = true;
    btn.textContent = `Analyze (${label})`;
    if (forceLink) forceLink.style.display = '';
    setTimeout(updateLeadAnalysisBtn, Math.min(remaining, 5 * 60 * 1000));
  } else {
    btn.disabled = false;
    btn.textContent = 'Analyze';
    if (forceLink) forceLink.style.display = 'none';
  }
}

function renderLeadSourceTable(chartData) {
  const el = document.getElementById('la-source-table');
  if (!el || !chartData?.sources?.length) { if (el) el.style.display = 'none'; return; }
  const rows = chartData.sources.map(s => {
    const trendArrow = s.trend[2] > s.trend[1] ? '↑' : s.trend[2] < s.trend[1] ? '↓' : '→';
    const trendColor = s.trend[2] > s.trend[1] ? 'var(--accent2)' : s.trend[2] < s.trend[1] ? 'var(--danger)' : 'var(--muted)';
    const premCell   = s.avgPremium > 0 ? `$${s.avgPremium.toLocaleString()}` : '—';
    return `<tr>
      <td style="padding:6px 8px;font-size:13px;">${escHtml(s.source)}</td>
      <td style="padding:6px 8px;text-align:center;font-family:'DM Mono',monospace;font-size:12px;">${s.count}</td>
      <td style="padding:6px 8px;text-align:center;font-size:12px;color:var(--muted);">${s.pct}%</td>
      <td style="padding:6px 8px;text-align:center;font-family:'DM Mono',monospace;font-size:12px;">${premCell}</td>
      <td style="padding:6px 8px;text-align:center;font-size:13px;color:${trendColor};">${trendArrow}</td>
      <td style="padding:6px 8px;font-size:12px;color:var(--muted);">${escHtml(s.topProduct)}</td>
    </tr>`;
  }).join('');
  el.style.display = '';
  el.innerHTML = `<div class="panel">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem;">Source Breakdown — Last 90 Days</div>
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="border-bottom:1px solid var(--border);">
          <th style="padding:5px 8px;text-align:left;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;">Source</th>
          <th style="padding:5px 8px;text-align:center;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;">Sales</th>
          <th style="padding:5px 8px;text-align:center;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;">% Mix</th>
          <th style="padding:5px 8px;text-align:center;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;">Avg Prem</th>
          <th style="padding:5px 8px;text-align:center;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;">Trend</th>
          <th style="padding:5px 8px;text-align:left;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;">Top Product</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:.5rem;">Trend arrow compares most recent 30 days vs prior 30 days.</div>
  </div>`;
}

function displayCachedLeadAnalysis() {
  if (!_leadAnalysisAt) return;
  // Always check the server first — it never regenerates (uses DB cache only).
  // localStorage is only a fallback for network errors.
  fetch('/api/lead-analysis', { headers: authHeaders() })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (data?.insights) {
        _lsSet('br-lead-analysis-' + _userId, JSON.stringify({ userId: _userId, ...data }));
        _applyLeadAnalysis(data);
      } else {
        // No server data — fall back to localStorage
        const cached = _lsGet('br-lead-analysis-' + _userId);
        if (cached) {
          try {
            const d = JSON.parse(cached);
            if (d.userId === _userId && d.insights) _applyLeadAnalysis(d);
            else _lsRemove('br-lead-analysis-' + _userId);
          } catch(e) {}
        }
      }
    })
    .catch(() => {
      // Network error — fall back to localStorage
      const cached = _lsGet('br-lead-analysis-' + _userId);
      if (cached) {
        try {
          const d = JSON.parse(cached);
          if (d.userId === _userId && d.insights) _applyLeadAnalysis(d);
        } catch(e) {}
      }
    });
}

function _applyLeadAnalysis(data) {
  const body = document.getElementById('la-analysis-body');
  const msg  = document.getElementById('la-analysis-msg');
  if (body && data.insights) {
    body.innerHTML = data.insights.split(/\n\n+/).filter(Boolean).map(p => `<p style="margin-bottom:.85rem;">${p.trim()}</p>`).join('');
  }
  if (data.chartData) renderLeadSourceTable(data.chartData);
  const ts = data.cachedAt || _leadAnalysisAt;
  if (msg && ts) {
    msg.style.display = 'block';
    msg.style.color   = 'var(--muted)';
    msg.textContent   = `Generated ${new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  }
}

async function runLeadAnalysis(force) {
  if (_leadAnalysisLoading) return;
  if (!force && leadAnalysisRemainingMs() > 0) return;
  _leadAnalysisLoading = true;
  const btn  = document.getElementById('la-refresh-btn');
  const body = document.getElementById('la-analysis-body');
  const msg  = document.getElementById('la-analysis-msg');
  if (btn)  { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  if (body) body.innerHTML = '<div style="color:var(--muted);font-size:13px;">Analyzing lead sources…</div>';
  if (msg)  msg.style.display = 'none';
  document.getElementById('la-source-table').style.display = 'none';
  try {
    const r    = await fetch('/api/lead-analysis', { headers: authHeaders() });
    const data = await r.json();
    if (!r.ok) {
      if (body) body.innerHTML = `<div style="color:var(--danger);font-size:13px;">${data.error || 'Error loading analysis.'}</div>`;
      return;
    }
    _leadAnalysisAt = data.cachedAt || new Date().toISOString();
    _lsSet('br-lead-analysis-' + _userId, JSON.stringify({ userId: _userId, ...data }));
    _applyLeadAnalysis({ ...data, cachedAt: _leadAnalysisAt });
  } catch(e) {
    if (body) body.innerHTML = `<div style="color:var(--danger);font-size:13px;">${e.message}</div>`;
  } finally {
    _leadAnalysisLoading = false;
    updateLeadAnalysisBtn();
  }
}

function maAnalysisRemainingMs() {
  if (!_memberAnalysisAt) return 0;
  return Math.max(0, new Date(_memberAnalysisAt).getTime() + ANALYSIS_COOLDOWN_MS - Date.now());
}

function updateMemberAnalysisBtn() {
  const btn       = document.getElementById('ma-refresh-btn');
  const forceLink = document.getElementById('ma-force-link');
  if (!btn) return;
  const hasMa = _hasMemberAnalysis || _isAdmin;
  if (!hasMa) { btn.style.display = 'none'; if (forceLink) forceLink.style.display = 'none'; return; }
  btn.style.display = '';
  const remaining = maAnalysisRemainingMs();
  if (remaining > 0) {
    const days = Math.floor(remaining / 86400000);
    const hrs  = Math.floor((remaining % 86400000) / 3600000);
    btn.disabled = true;
    btn.textContent = days > 0 ? `Next in ${days}d ${hrs}h` : `Next in ${hrs}h`;
    if (forceLink) forceLink.style.display = '';
    setTimeout(updateMemberAnalysisBtn, Math.min(remaining, 5 * 60 * 1000));
  } else {
    btn.disabled = false;
    btn.textContent = 'Analyze';
    if (forceLink) forceLink.style.display = 'none';
  }
}

function displayCachedMemberAnalysis() {
  updateHoursLabel();
  if (!(_hasMemberAnalysis || _isAdmin)) {
    renderMemberAnalysisTeaser();
    return;
  }
  // Always check the server first — checkOnly=1 never triggers a paid generation.
  // Server cache is the source of truth; localStorage is only a fallback for offline/204.
  fetch('/api/member-analysis?checkOnly=1', { headers: authHeaders() })
    .then(r => r.status === 204 ? null : r.json())
    .then(data => {
      if (data?.agentSections) {
        if (data.curKey) _maCurKey = data.curKey;
        const ts = data.cachedAt || data.generatedAt;
        if (ts) { _memberAnalysisAt = ts; updateMemberAnalysisBtn(); }
        renderMemberAnalysisCards(data.agentSections, data.agentData, data.generatedAt || data.cachedAt, data.hoursLastPeriod);
        // Always recompute hours label from _memberHoursData (current DB state),
        // not from hoursLastPeriod in the cache (reflects when analysis was generated, not now).
        updateHoursLabel(null);
        _lsSet('br-member-analysis-' + _userId, JSON.stringify({ userId: _userId, ...data }));
      } else {
        // Server has nothing valid (cache expired or never saved) — fall back to localStorage
        const cached = _lsGet('br-member-analysis-' + _userId);
        if (cached) {
          try {
            const d = JSON.parse(cached);
            if (d.userId === _userId && d.agentSections) {
              if (d.curKey) _maCurKey = d.curKey;
              renderMemberAnalysisCards(d.agentSections, d.agentData, d.generatedAt, d.hoursLastPeriod);
              updateHoursLabel(null);
            }
          } catch(e) {}
        }
      }
    })
    .catch(() => {
      // Network error — fall back to localStorage
      const cached = _lsGet('br-member-analysis-' + _userId);
      if (cached) {
        try {
          const d = JSON.parse(cached);
          if (d.userId === _userId && d.agentSections) {
            if (d.curKey) _maCurKey = d.curKey;
            renderMemberAnalysisCards(d.agentSections, d.agentData, d.generatedAt, d.hoursLastPeriod);
            updateHoursLabel(null);
          }
        } catch(e) {}
      }
    });
}

function maHoursMismatchUpload() {
  document.getElementById('ma-hours-mismatch-warn').style.display = 'none';
  goToSalesSubTab('team', 'ma-hours-section');
}

async function fetchAnalysisCredits() {
  try {
    const r = await fetch('/api/analysis-credits', { headers: authHeaders() });
    if (!r.ok) return;
    const d = await r.json();
    _analysisCredits = Number(d.balance) || 0;
    updateCreditBalanceDisplay();
  } catch(e) {}
}

function updateCreditBalanceDisplay() {
  const el = document.getElementById('credit-balance-display');
  if (el && _analysisCredits !== null) el.textContent = '$' + _analysisCredits.toFixed(2);
}

function closeCreditModal() {
  document.getElementById('credit-run-modal').style.display = 'none';
}

// Shared credit modal — pass the callback to invoke after a successful charge.
// Admin and credit-waived accounts skip the modal entirely.
let _creditRunCallback = null;

async function showCreditRunModal(onConfirm) {
  if (_isAdmin || _creditWaived) { onConfirm(); return; }
  _creditRunCallback = onConfirm;
  try {
    const r = await fetch('/api/analysis-credits', { headers: authHeaders() });
    if (r.ok) { const d = await r.json(); _analysisCredits = Number(d.balance) || 0; }
  } catch(e) {}

  const balance = _analysisCredits !== null ? _analysisCredits : 0;
  const body    = document.getElementById('credit-run-body');
  const actions = document.getElementById('credit-run-actions');

  if (balance >= 3) {
    body.innerHTML =
      `<p style="margin:0 0 .6rem;">This bypasses the cooldown. Cost: <strong>$3.00</strong></p>` +
      `<div style="background:var(--deep);border:1px solid var(--border);border-radius:8px;padding:.7rem 1rem;font-size:13px;">` +
        `<div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Current balance</span><span>$${balance.toFixed(2)}</span></div>` +
        `<div style="display:flex;justify-content:space-between;margin-top:4px;"><span style="color:var(--muted);">After run</span><span>$${(balance - 3).toFixed(2)}</span></div>` +
      `</div>`;
    actions.innerHTML = `<button class="btn btn-primary" onclick="confirmCreditRun(this)">Run — $3.00</button>`;
  } else {
    body.innerHTML =
      `<p style="margin:0 0 .6rem;color:var(--danger);">Insufficient balance: <strong>$${balance.toFixed(2)}</strong></p>` +
      `<p style="margin:0 0 1rem;color:var(--muted);">You need at least $3.00 to re-run. Add funds below:</p>` +
      `<div style="display:flex;gap:8px;flex-wrap:wrap;">` +
        `<button class="btn btn-secondary" style="font-size:13px;" onclick="closeCreditModal();addAnalysisCredits(5)">Add $5</button>` +
        `<button class="btn btn-secondary" style="font-size:13px;" onclick="closeCreditModal();addAnalysisCredits(10)">Add $10</button>` +
        `<button class="btn btn-secondary" style="font-size:13px;" onclick="closeCreditModal();addAnalysisCredits(20)">Add $20</button>` +
      `</div>`;
    actions.innerHTML = '';
  }

  document.getElementById('credit-run-modal').style.display = 'flex';
}

async function confirmCreditRun(btn) {
  btn.disabled = true;
  btn.textContent = 'Processing…';
  try {
    const r = await fetch('/api/analysis-credits', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'charge_run' }),
    });
    const d = await r.json();
    if (!r.ok) {
      document.getElementById('credit-run-body').insertAdjacentHTML('beforeend',
        `<p style="color:var(--danger);margin-top:.75rem;">${d.error || 'Error processing payment.'}</p>`);
      btn.disabled = false;
      btn.textContent = 'Run — $3.00';
      return;
    }
    _analysisCredits = d.balance;
    updateCreditBalanceDisplay();
    closeCreditModal();
    if (_creditRunCallback) { _creditRunCallback(); _creditRunCallback = null; }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Run — $3.00';
  }
}

function forceRunAnalysis()     { showCreditRunModal(() => runAnalysis(true)); }
function forceRunLeadAnalysis() { showCreditRunModal(() => runLeadAnalysis(true)); }
function forceRunMemberAnalysis() { showCreditRunModal(() => runMemberAnalysis(false, true)); }

async function addAnalysisCredits(amount, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/analysis-credits', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'checkout', amount }),
    });
    const d = await r.json();
    if (d.url) { window.location.href = d.url; return; }
    showInlineMsg('credit-wallet-msg', d.error || 'Error starting checkout', 'err');
    if (btn) btn.disabled = false;
  } catch(e) {
    showInlineMsg('credit-wallet-msg', e.message, 'err');
    if (btn) btn.disabled = false;
  }
}

async function runMemberAnalysis(bypassHoursCheck, force) {
  if (_memberAnalysisLoading) return;
  if (!force && maAnalysisRemainingMs() > 0) return;
  if (!(_hasMemberAnalysis || _isAdmin)) return;
  if (!_memberAnalysisAgents?.length) {
    const body = document.getElementById('ma-analysis-body');
    if (body) body.innerHTML = '<div style="color:var(--danger);font-size:13px;">No agents selected. Go to Account → Sales → Team Member Analysis to choose agents.</div>';
    return;
  }

  // Hours mismatch check — warn if uploaded period doesn't match current race month
  if (!bypassHoursCheck) {
    const raceMonth = (document.getElementById('header-month')?.textContent || '').trim();
    if (raceMonth && raceMonth !== 'No race data uploaded' && raceMonth !== 'Loading…') {
      const periods = (_memberHoursData || []).map(p => (p.period || '').trim().toLowerCase());
      const raceMonthLower = raceMonth.toLowerCase();
      const matched = periods.some(p => p === raceMonthLower);
      if (!matched) {
        const warnEl   = document.getElementById('ma-hours-mismatch-warn');
        const detailEl = document.getElementById('ma-hours-mismatch-detail');
        if (detailEl) {
          const latest = (_memberHoursData || []).sort((a,b) => new Date(b.uploaded_at||0) - new Date(a.uploaded_at||0))[0];
          detailEl.textContent = latest
            ? `Current race: "${raceMonth}" — Hours on file: "${latest.period}"`
            : `Current race: "${raceMonth}" — No hours uploaded`;
        }
        if (warnEl) warnEl.style.display = '';
        return;
      }
    }
    document.getElementById('ma-hours-mismatch-warn').style.display = 'none';
  }

  _memberAnalysisLoading = true;
  const btn  = document.getElementById('ma-refresh-btn');
  const body = document.getElementById('ma-analysis-body');
  const msg  = document.getElementById('ma-analysis-msg');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
  if (body) body.innerHTML = '<div style="color:var(--muted);font-size:13px;">Generating individual analysis…</div>';
  if (msg) msg.style.display = 'none';
  try {
    const r = await fetch(`/api/member-analysis${force ? '?force=1' : ''}`, { headers: authHeaders() });
    const data = await r.json();
    if (!r.ok) {
      if (body) body.innerHTML = `<div style="color:var(--danger);font-size:13px;">${data.error || 'Error loading analysis.'}</div>`;
      return;
    }
    const nowIso = new Date().toISOString();
    _memberAnalysisAt = data.cachedAt || data.generatedAt || nowIso;
    if (data.curKey) _maCurKey = data.curKey;
    _lsSet('br-member-analysis-' + _userId, JSON.stringify({ userId: _userId, ...data }));
    renderMemberAnalysisCards(data.agentSections, data.agentData, data.generatedAt || data.cachedAt, data.hoursLastPeriod);
    updateHoursLabel(data.hoursLastPeriod);
    if (msg) {
      msg.style.display = 'block';
      msg.style.color = 'var(--muted)';
      msg.textContent = `Generated ${new Date(_memberAnalysisAt).toLocaleString()}`;
    }
  } catch(e) {
    if (body) body.innerHTML = `<div style="color:var(--danger);font-size:13px;">${e.message}</div>`;
  } finally {
    _memberAnalysisLoading = false;
    updateMemberAnalysisBtn();
  }
}

function renderMemberAnalysisTeaser() {
  const body = document.getElementById('ma-analysis-body');
  const btn  = document.getElementById('ma-refresh-btn');
  if (btn) btn.style.display = 'none';
  if (!body) return;
  if (_isMember) {
    body.innerHTML = `
      <div style="text-align:center;padding:2rem 1rem;">
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:.75rem;">Team Member Analysis</div>
        <p style="font-size:13px;color:var(--muted);max-width:440px;margin:0 auto;">
          Team Member Analysis has not been enabled on this account. Contact your account owner to activate it.
        </p>
      </div>`;
    return;
  }
  body.innerHTML = `
    <div style="text-align:center;padding:2rem 1rem;">
      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:.75rem;">Team Member Analysis</div>
      <p style="font-size:13px;color:var(--muted);max-width:440px;margin:0 auto 1.25rem;">
        Get individual month-over-month coaching analysis for each of your team members —
        trends, strengths, gaps, and group standings — refreshed every 5 days.
      </p>
      <button class="btn btn-primary" onclick="showTab('account',document.querySelector('.tab[onclick*=account]'));showAccountSubTab('billing',document.querySelector('[data-pane=billing]'),'member-analysis-section')">
        Add Team Member Analysis — $10/head/mo
      </button>
    </div>`;
}

function renderMemberAnalysisCards(agentSections, agentData, generatedAt, hoursLastPeriod) {
  // Clear old chart instances before re-rendering
  Object.values(_agentChartInstances).forEach(charts => charts.forEach(c => { try { c.destroy(); } catch(_) {} }));
  _agentChartInstances = {};
  _agentChartsRendered.clear();
  _maAnalysisData = { agentSections, agentData, generatedAt };

  const body = document.getElementById('ma-analysis-body');
  if (!body) return;
  if (!agentSections || !Object.keys(agentSections).length) {
    body.innerHTML = '<div style="color:var(--muted);font-size:13px;">No analysis data. Click Analyze to generate.</div>';
    return;
  }

  const fmtCur = n => n != null ? '$' + Math.round(n).toLocaleString() : null;
  const rankBadge = (rank, total, label) => {
    if (!rank) return '';
    const color = rank === 1 ? 'var(--accent2)' : rank <= Math.ceil(total / 3) ? 'var(--accent)' : 'var(--muted)';
    return `<span style="font-size:10px;font-weight:700;color:${color};background:${color}18;padding:2px 7px;border-radius:4px;margin-right:4px;">#${rank} ${label}</span>`;
  };

  const cards = Object.entries(agentSections).map(([name, text]) => {
    const agId = agentData ? Object.keys(agentData).find(id => agentData[id]?.name === name) : null;
    const ag   = agId ? agentData[agId] : null;
    const cur  = ag?.current;
    const teamColor = ag?.team === 'service' ? 'var(--accent2)' : 'var(--accent)';
    const teamLabel = ag?.team || 'sales';
    const safeId    = agId ? agId.replace(/[^a-z0-9]/gi, '-') : '';

    const statsLine = cur ? [
      `${cur.placed} placed`,
      `${cur.answered} answered`,
      `${cur.talkMin}min talk`,
      `${cur.policies} ${cur.policies === 1 ? 'policy' : 'policies'}`,
      cur.premium ? fmtCur(cur.premium) + ' premium' : null,
    ].filter(Boolean).join(' · ') : '';

    const standings = cur ? [
      rankBadge(ag.scoreRank, Object.keys(agentData).length, 'Score'),
      rankBadge(ag.polRank,   Object.keys(agentData).length, 'Policies'),
      ag.premRank ? rankBadge(ag.premRank, Object.keys(agentData).length, 'Premium') : '',
    ].join('') : '';

    const cardId = 'ma-card-' + escHtml(name).replace(/\s+/g, '-').toLowerCase();
    const paragraphs = (text || '').split(/\n\n+/).filter(Boolean).map(p => `<p style="margin:0 0 .75em;font-size:13px;line-height:1.7;">${p.trim()}</p>`).join('');

    const chartTiles = agId && ag?.months?.length ? `
      <div class="analysis-charts" id="ma-charts-${safeId}" style="margin-bottom:1rem;">
        <div class="analysis-chart-box">
          <div class="analysis-chart-title">Calls Placed, Answered &amp; Policies</div>
          <canvas id="ma-c-calls-${safeId}"></canvas>
        </div>
        <div class="analysis-chart-box">
          <div class="analysis-chart-title">Talk Time (min)</div>
          <canvas id="ma-c-talk-${safeId}"></canvas>
        </div>
        <div class="analysis-chart-box">
          <div class="analysis-chart-title">Premium</div>
          <canvas id="ma-c-prem-${safeId}"></canvas>
        </div>
      </div>` : '';

    return `<div style="border:1px solid var(--border2);border-radius:10px;margin-bottom:.75rem;overflow:hidden;">
      <div style="padding:.85rem 1rem;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;background:var(--card2);" onclick="toggleMaCard('${cardId}','${agId || ''}')">
        <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">
          <span style="font-size:14px;font-weight:700;color:var(--text);">${escHtml(name)}</span>
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${teamColor};background:${teamColor}18;padding:2px 7px;border-radius:4px;">${teamLabel}</span>
          ${standings}
        </div>
        <div style="display:flex;align-items:center;gap:.75rem;">
          <span style="font-size:12px;color:var(--muted);">${statsLine}</span>
          <span class="ma-chevron" style="font-size:11px;color:var(--muted);">▼</span>
        </div>
      </div>
      <div id="${cardId}" style="display:none;padding:1rem;background:var(--deep);">
        ${chartTiles}
        ${paragraphs || '<p style="color:var(--muted);font-size:13px;">No analysis available.</p>'}
      </div>
    </div>`;
  }).join('');

  const genLabel = generatedAt ? `Generated ${new Date(generatedAt).toLocaleString()}` : '';
  body.innerHTML = `
    ${genLabel ? `<div style="font-size:11px;color:var(--muted);margin-bottom:1rem;">${genLabel}</div>` : ''}
    ${cards}`;
}

// ── Hours label (both analysis sub-panes) ────────────────────────────────────
function updateHoursLabel(lastPeriod) {
  if (lastPeriod !== undefined) _maLastHoursPeriod = lastPeriod;
  const period = _maLastHoursPeriod
    || (_memberHoursData?.length
        ? [..._memberHoursData].sort((a,b) => new Date(b.uploaded_at||0) - new Date(a.uploaded_at||0))[0]?.period
        : null);
  const link = `<a href="#" onclick="goToSalesSubTab('team','ma-hours-section');return false;" style="color:var(--accent);">Upload →</a>`;
  const html = period
    ? `Hours on file: <strong>${escHtml(period)}</strong> · ${link}`
    : `No hours on file · ${link}`;
  ['ma-hours-label-trends','ma-hours-label-members'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = html; el.style.display = ''; }
  });
}

// ── Agent card toggle with lazy chart render ──────────────────────────────────
function toggleMaCard(cardId, agId) {
  const body = document.getElementById(cardId);
  if (!body) return;
  const header  = body.previousElementSibling;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  const chevron = header?.querySelector('.ma-chevron');
  if (chevron) chevron.textContent = isHidden ? '▲' : '▼';
  if (isHidden && agId) renderAgentChartsIfNeeded(agId);
}

function renderAgentChartsIfNeeded(agId) {
  if (!agId || _agentChartsRendered.has(agId)) return;
  _agentChartsRendered.add(agId);
  const ag = _maAnalysisData?.agentData?.[agId];
  if (!ag) return;
  renderAgentChartTiles(agId, ag);
}

function renderAgentChartTiles(agId, ag) {
  const safeId   = agId.replace(/[^a-z0-9]/gi, '-');
  const MA        = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const curKey    = _maCurKey || ((() => { const d = new Date(); return MA[d.getMonth()] + ' ' + d.getFullYear(); })());
  const months    = ag.months || [];
  const cur       = ag.current;

  const labels    = [...months.map(m => m.month), ...(cur ? [curKey] : [])];
  const placed    = [...months.map(m => m.placed),   ...(cur ? [cur.placed]   : [])];
  const answered  = [...months.map(m => m.answered), ...(cur ? [cur.answered] : [])];
  const policies  = [...months.map(m => m.policies), ...(cur ? [cur.policies] : [])];
  const talkArr   = [...months.map(m => m.talkMin),  ...(cur ? [cur.talkMin]  : [])];
  const premArr   = [...months.map(m => m.premium),  ...(cur ? [cur.premium]  : [])];

  const gc = 'rgba(255,255,255,0.05)';
  const tc = '#6b8db5';
  const base = {
    responsive: true, maintainAspectRatio: true,
    plugins: { legend: { labels: { color: tc, font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: tc, font: { size: 10 } }, grid: { color: gc } },
      y: { ticks: { color: tc, font: { size: 10 } }, grid: { color: gc } },
    },
  };

  const callsCanvas = document.getElementById(`ma-c-calls-${safeId}`);
  const talkCanvas  = document.getElementById(`ma-c-talk-${safeId}`);
  const premCanvas  = document.getElementById(`ma-c-prem-${safeId}`);
  if (!callsCanvas || !talkCanvas || !premCanvas) return;

  const c1 = new Chart(callsCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Placed',   data: placed,   borderColor:'#00d4ff', backgroundColor:'rgba(0,212,255,.07)', tension:.3, pointRadius:3, fill:true, yAxisID:'y' },
        { label:'Answered', data: answered, borderColor:'#00ff94', backgroundColor:'rgba(0,255,148,.07)', tension:.3, pointRadius:3, fill:true, yAxisID:'y' },
        { label:'Policies', data: policies, borderColor:'#ff8c42', backgroundColor:'transparent',         tension:.3, pointRadius:3, fill:false, borderDash:[4,3], yAxisID:'y2' },
      ],
    },
    options: { ...base, scales: { ...base.scales, y2: { position:'right', ticks: { color: tc, font: { size: 10 } }, grid: { drawOnChartArea: false } } } },
  });

  const c2 = new Chart(talkCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label:'Talk Min', data: talkArr, borderColor:'#ffd166', backgroundColor:'rgba(255,209,102,.1)', tension:.3, pointRadius:3, fill:true }],
    },
    options: { ...base, plugins: { legend: { display: false } } },
  });

  const c3 = new Chart(premCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label:'Premium', data: premArr, borderColor:'#a78bfa', backgroundColor:'rgba(167,139,250,.1)', tension:.3, pointRadius:3, fill:true, spanGaps: false }],
    },
    options: {
      ...base,
      plugins: { legend: { display: false } },
      scales: {
        ...base.scales,
        y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, callback: v => v != null ? '$'+Math.round(v).toLocaleString() : '' } },
      },
    },
  });

  _agentChartInstances[agId] = [c1, c2, c3];
}

// ── Hours upload UI ───────────────────────────────────────────────────────────
function maHoursDrop(e) {
  e.preventDefault();
  document.getElementById('ma-hours-drop').style.borderColor = 'var(--border2)';
  const file = e.dataTransfer?.files?.[0];
  if (file) maHoursParseFile(file);
}

function maHoursFileChange(input) {
  const file = input.files?.[0];
  if (file) maHoursParseFile(file);
  input.value = '';
}

function maHoursParseFile(file) {
  if (!window.XLSX) { alert('File parser not loaded — please refresh.'); return; }
  const nameEl = document.getElementById('ma-hours-drop-name');
  if (nameEl) nameEl.textContent = file.name;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb    = XLSX.read(e.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rows.length) { alert('File appears empty.'); return; }

      _maHoursHeaders = (rows[0] || []).map(String);
      _maHoursFileRows = rows.slice(1).filter(r => r.some(c => String(c).trim()));

      const sel1 = document.getElementById('ma-hours-col-name');
      const sel2 = document.getElementById('ma-hours-col-hours');
      const sel3 = document.getElementById('ma-hours-col-comp');
      if (!sel1 || !sel2) return;
      const opts = _maHoursHeaders.map((h, i) => `<option value="${i}">${escHtml(h) || `Column ${i+1}`}</option>`).join('');
      sel1.innerHTML = opts;
      sel2.innerHTML = opts;
      if (sel3) sel3.innerHTML = `<option value="">— None —</option>` + opts;

      // Auto-guess columns: look for "name", "hours", and "comp/salary/wage/pay" keywords
      const guessName  = _maHoursHeaders.findIndex(h => /name|agent/i.test(h));
      const guessHours = _maHoursHeaders.findIndex(h => /hour/i.test(h));
      const guessComp  = _maHoursHeaders.findIndex(h => /comp|salary|wage|pay/i.test(h));
      if (guessName  >= 0) sel1.value = guessName;
      if (guessHours >= 0) sel2.value = guessHours;
      if (sel3 && guessComp >= 0) sel3.value = guessComp;

      document.getElementById('ma-hours-mapper').style.display = '';
      document.getElementById('ma-hours-match').style.display   = 'none';
      document.getElementById('ma-hours-save-area').style.display = 'none';
    } catch(err) {
      alert('Could not parse file: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function maHoursApplyMapping() {
  const nameColIdx  = parseInt(document.getElementById('ma-hours-col-name')?.value  ?? '0');
  const hoursColIdx = parseInt(document.getElementById('ma-hours-col-hours')?.value ?? '1');
  const compColRaw  = document.getElementById('ma-hours-col-comp')?.value;
  const compColIdx  = (compColRaw !== '' && compColRaw != null) ? parseInt(compColRaw) : -1;
  const hasComp     = compColIdx >= 0;

  // Collect unique agent names, summing hours and compensation
  const nameMap = {}; // rawName → { hours, comp }
  for (const row of _maHoursFileRows) {
    const rawName = String(row[nameColIdx] || '').trim();
    if (!rawName) continue;
    const hrs  = parseFloat(row[hoursColIdx]) || 0;
    const comp = hasComp ? (parseFloat(row[compColIdx]) || 0) : 0;
    if (!nameMap[rawName]) nameMap[rawName] = { hours: 0, comp: 0 };
    nameMap[rawName].hours += hrs;
    nameMap[rawName].comp  += comp;
  }

  const uniqueNames = Object.keys(nameMap);
  if (!uniqueNames.length) { alert('No valid agent names found in selected column.'); return; }

  // Build agent roster options
  const rosterAgents = (_agentRoster || []).filter(a => a.agent_id && a.name);
  const rosterOpts = [`<option value="">— Not matched —</option>`, ...rosterAgents.map(a => `<option value="${escHtml(a.agent_id)}">${escHtml(a.name)}</option>`)].join('');

  const colTemplate = hasComp ? '1fr 1fr auto auto' : '1fr 1fr auto';
  const tableHtml = uniqueNames.map(name => {
    const { hours: hrs, comp } = nameMap[name];
    const exactMatch   = rosterAgents.find(a => a.name.toLowerCase() === name.toLowerCase());
    const partialMatch = !exactMatch && rosterAgents.find(a =>
      a.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(a.name.toLowerCase()));
    const autoVal  = exactMatch?.agent_id || partialMatch?.agent_id || '';
    const sel      = `<select data-raw="${escHtml(name)}" data-hours="${hrs}" data-comp="${comp}" style="width:100%;padding:4px 6px;background:var(--card2);border:1px solid var(--border2);color:var(--text);border-radius:5px;font-size:12px;">${rosterOpts}</select>`;
    const selHtml  = sel.replace(`value="${escHtml(autoVal)}"`, `value="${escHtml(autoVal)}" selected`);
    const compCell = hasComp
      ? `<span style="font-size:12px;color:var(--muted);white-space:nowrap;">${comp > 0 ? '$' + Math.round(comp).toLocaleString() : '—'}</span>`
      : '';
    return `<div style="display:grid;grid-template-columns:${colTemplate};gap:.5rem;align-items:center;padding:5px 0;border-bottom:1px solid var(--border2);">
      <span style="font-size:13px;">${escHtml(name)}</span>
      ${selHtml}
      <span style="font-size:12px;color:var(--muted);white-space:nowrap;">${hrs} hrs</span>
      ${compCell}
    </div>`;
  }).join('');

  const matchTable = document.getElementById('ma-hours-match-table');
  if (matchTable) matchTable.innerHTML = `
    <div style="display:grid;grid-template-columns:${colTemplate};gap:.5rem;padding:4px 0;border-bottom:1px solid var(--border2);margin-bottom:4px;">
      <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">File Name</span>
      <span style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;">Roster Agent</span>
      <span style="font-size:11px;color:var(--muted);">Hours</span>
      ${hasComp ? '<span style="font-size:11px;color:var(--muted);">Compensation</span>' : ''}
    </div>${tableHtml}`;

  document.getElementById('ma-hours-match').style.display    = '';
  document.getElementById('ma-hours-save-area').style.display = '';
}

async function maHoursSave(btn) {
  const periodInput = document.getElementById('ma-hours-period');
  const period = periodInput?.value?.trim();
  if (!period) {
    showInlineMsg('ma-hours-msg', 'Enter a period label (e.g. April 2026)', 'err');
    return;
  }

  // Collect matched rows
  const selects = document.querySelectorAll('#ma-hours-match-table select[data-raw]');
  const rows = [];
  selects.forEach(sel => {
    const agentId   = sel.value;
    const agentName = sel.dataset.raw || '';
    const hours     = parseFloat(sel.dataset.hours) || 0;
    const comp      = parseFloat(sel.dataset.comp)  || 0;
    if (agentId && (hours > 0 || comp > 0)) {
      const row = { agent_name: agentName, agent_id: agentId, hours };
      if (comp > 0) row.compensation = comp;
      rows.push(row);
    }
  });

  if (!rows.length) {
    showInlineMsg('ma-hours-msg', 'No matched agents with hours or compensation data.', 'err');
    return;
  }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/member-hours', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, rows }),
    });
    const d = await r.json();
    if (!r.ok) { showInlineMsg('ma-hours-msg', d.error || 'Save failed', 'err'); return; }

    _memberHoursData = d.periods || [];
    updateHoursLabel(null);
    renderMaHoursPeriods();

    // Clear cached analysis (hours changed)
    _lsRemove('br-member-analysis-' + _userId);

    // Reset UI
    document.getElementById('ma-hours-mapper').style.display    = 'none';
    document.getElementById('ma-hours-match').style.display     = 'none';
    document.getElementById('ma-hours-save-area').style.display = 'none';
    document.getElementById('ma-hours-drop-name').textContent   = '';
    if (periodInput) periodInput.value = '';
    _maHoursFileRows = []; _maHoursHeaders = [];
    showInlineMsg('ma-hours-msg', `Data saved for "${period}". Re-run analysis to include efficiency data.`, 'ok');
    setTimeout(() => scrollAndPulse('ma-hours-periods'), 150);
  } catch(e) {
    showInlineMsg('ma-hours-msg', e.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Hours';
  }
}

function renderMaHoursPeriods() {
  const container = document.getElementById('ma-hours-periods');
  if (!container) return;
  if (!_memberHoursData?.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--muted);">No hours uploaded yet.</div>';
    return;
  }
  const sorted = [..._memberHoursData].sort((a,b) => new Date(b.uploaded_at||0) - new Date(a.uploaded_at||0));
  container.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:.4rem;">Uploaded Periods</div>
    ${sorted.map(p => {
      const agentCount  = p.rows?.length || 0;
      const uploaded    = p.uploaded_at ? new Date(p.uploaded_at).toLocaleDateString() : '';
      const hasCompData = p.rows?.some(r => r.compensation > 0);
      const compNote    = hasCompData ? ' · comp' : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--card2);border:1px solid var(--border2);border-radius:7px;margin-bottom:5px;">
        <div>
          <span style="font-size:13px;font-weight:600;">${escHtml(p.period)}</span>
          <span style="font-size:11px;color:var(--muted);margin-left:.5rem;">${agentCount} agent${agentCount!==1?'s':''}${compNote} · uploaded ${uploaded}</span>
        </div>
        <button class="btn btn-secondary" style="font-size:11px;padding:3px 10px;color:var(--danger);border-color:var(--danger);" onclick="maHoursDeletePeriod('${escHtml(p.period)}',this)">Remove</button>
      </div>`;
    }).join('')}`;
}

async function maHoursDeletePeriod(period, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch('/api/member-hours?' + new URLSearchParams({ period }), {
      method: 'DELETE', headers: authHeaders(),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || 'Delete failed'); return; }
    _memberHoursData = d.periods || [];
    updateHoursLabel(null);
    renderMaHoursPeriods();
    _lsRemove('br-member-analysis-' + _userId);
  } catch(e) { alert(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Remove'; }
}
