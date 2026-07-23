// ── QUICK COUNT WIDGET (round +1 button, right of the tab bar) ─────────────────
// Visible to:
//  - Member agents assigned at least one bonus_activity_type via "assigned_agent_ids"
//    (configured in Account → Sales → Bonus → Edit → Quick-Count Button) — scoped to
//    their own agent_id only.
//  - The account owner and captain/chief_officer members — scoped to EVERY assigned
//    counter across the whole roster, one row per (type, agent) pair. Without this,
//    an owner who's also listed as an agent on their own roster (common on small
//    teams) could assign a counter to themselves and never see it, since the owner's
//    login is not a "member" session and has no single roster_agent_id of its own
//    (2026-07-23 fix — see CLAUDE.md).
// Presses hit POST /api/bonus-activities action=quick_adjust, which upserts a single
// running-total bonus_activities row per (agent, type, current month) — see CLAUDE.md
// "Quick-Count Button" for why that's a running total, not one row per press.
let _qcEntries   = [];   // [{ typeId, typeName, agentId, agentName }] — one row per counter shown
let _qcCounts    = {};   // `${typeId}:${agentId}` -> current month's total (all sources)
let _qcAdminView = false; // true for owner/captain/chief_officer (see all assigned agents, not just self)

async function loadQuickCountWidget() {
  const widget = document.getElementById('quick-count-widget');
  if (!widget) return;
  try {
    _qcAdminView = !_isMember || ['captain', 'chief_officer'].includes(_memberRole);

    const r = await fetch('/api/bonus-activities?resource=types', { headers: authHeaders() });
    if (!r.ok) return;
    const types = (await r.json() || []).filter(t => t.active !== false && (t.assigned_agent_ids || []).length);

    if (_qcAdminView) {
      const nameFor = id => (_agentRoster || []).find(a => a.agent_id === id)?.name || id;
      _qcEntries = types.flatMap(t => (t.assigned_agent_ids || []).map(agentId => ({
        typeId: t.id, typeName: t.name, agentId, agentName: nameFor(agentId),
      })));
    } else {
      _qcEntries = types
        .filter(t => (t.assigned_agent_ids || []).includes(_memberAgentId))
        .map(t => ({ typeId: t.id, typeName: t.name, agentId: _memberAgentId, agentName: null }));
    }

    if (!_qcEntries.length) { widget.style.display = 'none'; return; }
    await _qcRefreshCounts();
    widget.style.display = '';
  } catch (_) { /* widget just stays hidden on any error */ }
}

async function _qcRefreshCounts() {
  try {
    const now = new Date();
    const r = await fetch(`/api/bonus-activities?month=${now.getMonth()+1}&year=${now.getFullYear()}`, { headers: authHeaders() });
    if (!r.ok) return;
    const { entries } = await r.json();
    _qcCounts = {};
    for (const e of (entries || [])) {
      const key = e.activity_type_id + ':' + e.agent_id;
      _qcCounts[key] = (_qcCounts[key] || 0) + (e.count || 0);
    }
  } catch (_) {}
}

function toggleQuickCountPanel() {
  const panel = document.getElementById('quick-count-panel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? '' : 'none';
  if (opening) renderQuickCountPanel();
}

function renderQuickCountPanel() {
  const panel = document.getElementById('quick-count-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.6rem;">Quick Count — this month</div>
    ${_qcEntries.map(e => {
      const key = e.typeId + ':' + e.agentId;
      const label = e.agentName ? `${e.typeName} <span style="color:var(--muted);font-weight:400;">· ${escHtml(e.agentName)}</span>` : escHtml(e.typeName);
      return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:.6rem;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(e.typeName)}${e.agentName ? ' · ' + escHtml(e.agentName) : ''}">${label}</div>
          <div style="font-size:18px;font-weight:700;color:var(--accent2);" id="qc-count-${escHtml(key)}">${_qcCounts[key] || 0}</div>
        </div>
        <button onclick="qcBulkAdjust('${escHtml(e.typeId)}','${escHtml(e.agentId)}')" title="Add/subtract a specific amount" style="width:24px;height:24px;border-radius:50%;background:none;border:1px solid var(--border2);color:var(--muted);font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">±</button>
        <button onclick="qcAdjust('${escHtml(e.typeId)}','${escHtml(e.agentId)}',-1)" title="Undo one" style="width:28px;height:28px;border-radius:50%;background:none;border:1px solid var(--border2);color:var(--muted);font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">−</button>
        <button onclick="qcAdjust('${escHtml(e.typeId)}','${escHtml(e.agentId)}',1)" title="+1" style="width:38px;height:38px;border-radius:50%;background:var(--accent);color:#04121c;border:none;font-size:20px;font-weight:700;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">+</button>
      </div>`;
    }).join('')}
  `;
}

async function qcAdjust(typeId, agentId, delta) {
  const key = typeId + ':' + agentId;
  const el = document.getElementById('qc-count-' + key);
  const prev = _qcCounts[key] || 0;
  // Optimistic update — feels instant on every tap; reconciled below if the request fails.
  _qcCounts[key] = Math.max(0, prev + delta);
  if (el) el.textContent = _qcCounts[key];
  try {
    const body = { action: 'quick_adjust', activity_type_id: typeId, delta };
    if (_qcAdminView) body.agent_id = agentId; // self-scoped members imply their own agent server-side
    const r = await fetch('/api/bonus-activities', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('failed');
    const d = await r.json();
    _qcCounts[key] = d.count;
    if (el) el.textContent = d.count;
  } catch (_) {
    _qcCounts[key] = prev;
    if (el) el.textContent = prev;
  }
}

function qcBulkAdjust(typeId, agentId) {
  const e = _qcEntries.find(x => x.typeId === typeId && x.agentId === agentId);
  const label = e ? (e.agentName ? `${e.typeName} (${e.agentName})` : e.typeName) : 'this counter';
  const input = prompt(`Add or subtract from "${label}" (e.g. 5 or -3):`);
  if (input === null) return;
  const delta = parseInt(input, 10);
  if (!Number.isInteger(delta) || delta === 0) return;
  qcAdjust(typeId, agentId, delta);
}

// Close the panel when clicking outside it
document.addEventListener('click', (e) => {
  const widget = document.getElementById('quick-count-widget');
  const panel  = document.getElementById('quick-count-panel');
  if (!widget || !panel || panel.style.display === 'none') return;
  if (!widget.contains(e.target)) panel.style.display = 'none';
});
