// ── QUICK COUNT WIDGET (round +1 button, right of the tab bar) ─────────────────
// Visible only to member agents assigned at least one bonus_activity_type via
// "assigned_agent_ids" (configured in Account → Sales → Bonus → Edit → Quick-Count
// Button). Presses hit POST /api/bonus-activities action=quick_adjust, which upserts
// a single running-total bonus_activities row per (agent, type, current month) — see
// CLAUDE.md "Quick-Count Button" for why that's a running total, not one row per press.
let _qcTypes  = [];   // this agent's assigned bonus_activity_types
let _qcCounts = {};   // typeId -> current month's total (all sources, not just quick_count)

async function loadQuickCountWidget() {
  const widget = document.getElementById('quick-count-widget');
  if (!widget) return;
  try {
    const r = await fetch('/api/bonus-activities?resource=types', { headers: authHeaders() });
    if (!r.ok) return;
    const types = await r.json();
    _qcTypes = (types || []).filter(t => t.active !== false && (t.assigned_agent_ids || []).includes(_memberAgentId));
    if (!_qcTypes.length) { widget.style.display = 'none'; return; }
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
      if (e.agent_id !== _memberAgentId) continue;
      _qcCounts[e.activity_type_id] = (_qcCounts[e.activity_type_id] || 0) + (e.count || 0);
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
    ${_qcTypes.map(t => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:.6rem;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escHtml(t.name)}">${escHtml(t.name)}</div>
          <div style="font-size:18px;font-weight:700;color:var(--accent2);" id="qc-count-${escHtml(t.id)}">${_qcCounts[t.id] || 0}</div>
        </div>
        <button onclick="qcBulkAdjust('${escHtml(t.id)}')" title="Add/subtract a specific amount" style="width:24px;height:24px;border-radius:50%;background:none;border:1px solid var(--border2);color:var(--muted);font-size:13px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">±</button>
        <button onclick="qcAdjust('${escHtml(t.id)}',-1)" title="Undo one" style="width:28px;height:28px;border-radius:50%;background:none;border:1px solid var(--border2);color:var(--muted);font-size:16px;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">−</button>
        <button onclick="qcAdjust('${escHtml(t.id)}',1)" title="+1" style="width:38px;height:38px;border-radius:50%;background:var(--accent);color:#04121c;border:none;font-size:20px;font-weight:700;cursor:pointer;padding:0;line-height:1;flex-shrink:0;">+</button>
      </div>`).join('')}
  `;
}

async function qcAdjust(typeId, delta) {
  const el = document.getElementById('qc-count-' + typeId);
  const prev = _qcCounts[typeId] || 0;
  // Optimistic update — feels instant on every tap; reconciled below if the request fails.
  _qcCounts[typeId] = Math.max(0, prev + delta);
  if (el) el.textContent = _qcCounts[typeId];
  try {
    const r = await fetch('/api/bonus-activities', {
      method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'quick_adjust', activity_type_id: typeId, delta }),
    });
    if (!r.ok) throw new Error('failed');
    const d = await r.json();
    _qcCounts[typeId] = d.count;
    if (el) el.textContent = d.count;
  } catch (_) {
    _qcCounts[typeId] = prev;
    if (el) el.textContent = prev;
  }
}

function qcBulkAdjust(typeId) {
  const t = _qcTypes.find(x => x.id === typeId);
  const input = prompt(`Add or subtract from "${t ? t.name : 'this counter'}" (e.g. 5 or -3):`);
  if (input === null) return;
  const delta = parseInt(input, 10);
  if (!Number.isInteger(delta) || delta === 0) return;
  qcAdjust(typeId, delta);
}

// Close the panel when clicking outside it
document.addEventListener('click', (e) => {
  const widget = document.getElementById('quick-count-widget');
  const panel  = document.getElementById('quick-count-panel');
  if (!widget || !panel || panel.style.display === 'none') return;
  if (!widget.contains(e.target)) panel.style.display = 'none';
});
