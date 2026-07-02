// ── Agent Goals ───────────────────────────────────────────────────────────────
async function loadAgentGoals() {
  try {
    const r = await fetch('/api/agent-goals?withActuals=1', { headers: authHeaders() });
    const d = await r.json();
    _agentGoals  = Array.isArray(d) ? d : [];
    _goalsLoaded = true;
  } catch(e) { _agentGoals = []; _goalsLoaded = true; }
  // Race tab may have already rendered before goals loaded — re-render it now
  if (_raceData.length) renderRace(_raceData);
}

function currentPeriodLabel(periodType) {
  const now = new Date();
  const yr  = now.getFullYear();
  const mo  = now.getMonth();
  const MO  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (periodType === 'monthly')     return MO[mo] + ' ' + yr;
  if (periodType === 'quarterly')   return `Q${Math.floor(mo/3)+1} ${yr}`;
  if (periodType === 'semi_annual') return mo < 6 ? `H1 ${yr}` : `H2 ${yr}`;
  return String(yr);
}

function currentPeriodRange(periodType) {
  const now = new Date();
  const yr  = now.getFullYear();
  const mo  = now.getMonth();
  const iso = d => d.toISOString().slice(0,10);
  if (periodType === 'monthly')     return { start: iso(new Date(yr, mo, 1)),     end: iso(new Date(yr, mo + 1, 0)) };
  if (periodType === 'quarterly')   { const q = Math.floor(mo/3); return { start: iso(new Date(yr, q*3, 1)), end: iso(new Date(yr, q*3+3, 0)) }; }
  if (periodType === 'semi_annual') { const h = mo < 6 ? 0 : 1;   return { start: iso(new Date(yr, h*6, 1)), end: iso(new Date(yr, h*6+6, 0)) }; }
  return { start: `${yr}-01-01`, end: `${yr}-12-31` };
}

function getGoalPeriodOptions(periodType) {
  const now = new Date();
  const yr  = now.getFullYear();
  const mo  = now.getMonth(); // 0-indexed
  const MO  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const opts = [];
  if (periodType === 'monthly') {
    for (let off = -3; off <= 3; off++) {
      let m = mo + off, y = yr;
      while (m < 0)  { m += 12; y--; }
      while (m > 11) { m -= 12; y++; }
      const s = new Date(y, m, 1), e = new Date(y, m + 1, 0);
      opts.push({ label: MO[m] + ' ' + y, start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10), isCurrent: off === 0 });
    }
  } else if (periodType === 'quarterly') {
    const curQ = Math.floor(mo / 3);
    for (let off = -2; off <= 3; off++) {
      let q = curQ + off, y = yr;
      while (q < 0) { q += 4; y--; }
      while (q > 3) { q -= 4; y++; }
      const sm = q * 3, s = new Date(y, sm, 1), e = new Date(y, sm + 3, 0);
      opts.push({ label: `Q${q+1} ${y}`, start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10), isCurrent: off === 0 });
    }
  } else if (periodType === 'semi_annual') {
    const curH = mo < 6 ? 0 : 1;
    for (let off = -2; off <= 3; off++) {
      let h = curH + off, y = yr;
      while (h < 0) { h += 2; y--; }
      while (h > 1) { h -= 2; y++; }
      const sm = h * 6, s = new Date(y, sm, 1), e = new Date(y, sm + 6, 0);
      opts.push({ label: `H${h+1} ${y}`, start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10), isCurrent: off === 0 });
    }
  } else {
    for (let off = -2; off <= 3; off++) {
      const y = yr + off;
      opts.push({ label: String(y), start: `${y}-01-01`, end: `${y}-12-31`, isCurrent: off === 0 });
    }
  }
  return opts;
}

function updateGoalFormPeriods(agentId) {
  const typeEl   = document.getElementById('gf-type-' + agentId);
  const periodEl = document.getElementById('gf-period-' + agentId);
  if (!typeEl || !periodEl) return;
  const opts = getGoalPeriodOptions(typeEl.value);
  periodEl.innerHTML = opts.map(o =>
    `<option value="${escHtml(o.label)}" data-start="${o.start}" data-end="${o.end}"${o.isCurrent?' selected':''}>${escHtml(o.label)}</option>`
  ).join('');
}

function goalMetricToggle(agentId, metricKey) {
  const cb  = document.getElementById(`gf-check-${agentId}-${metricKey}`);
  const inp = document.getElementById(`gf-val-${agentId}-${metricKey}`);
  if (!cb || !inp) return;
  inp.style.display = cb.checked ? '' : 'none';
  if (cb.checked) inp.focus();
}

function buildGoalMetricsHtml(agentId, existingGoals) {
  const rows = [];
  const cats = (_productTypes.length ? _productTypes : DEFAULT_SCORING_CATS).filter(c =>
    ['wl','ul','term','health','auto','fire'].includes(c.key)
  );
  for (const c of cats) {
    const val = existingGoals[c.key] || '';
    rows.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <input type="checkbox" id="gf-check-${escHtml(agentId)}-${c.key}" ${val?'checked':''} onchange="goalMetricToggle('${escHtml(agentId)}','${c.key}')">
      <label style="font-size:11px;min-width:130px;">${escHtml(c.label||c.key)}</label>
      <input type="number" id="gf-val-${escHtml(agentId)}-${c.key}" min="0" value="${escHtml(String(val))}" placeholder="target" style="width:70px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;outline:none;${val?'':'display:none;'}">
    </div>`);
  }
  const polVal  = existingGoals.policies || '';
  const premVal = existingGoals.premium  || '';
  rows.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
    <input type="checkbox" id="gf-check-${escHtml(agentId)}-policies" ${polVal?'checked':''} onchange="goalMetricToggle('${escHtml(agentId)}','policies')">
    <label style="font-size:11px;min-width:130px;">Total Policies</label>
    <input type="number" id="gf-val-${escHtml(agentId)}-policies" min="0" value="${escHtml(String(polVal))}" placeholder="target" style="width:70px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;outline:none;${polVal?'':'display:none;'}">
  </div>`);
  rows.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
    <input type="checkbox" id="gf-check-${escHtml(agentId)}-premium" ${premVal?'checked':''} onchange="goalMetricToggle('${escHtml(agentId)}','premium')">
    <label style="font-size:11px;min-width:130px;">Premium ($)</label>
    <input type="number" id="gf-val-${escHtml(agentId)}-premium" min="0" value="${escHtml(String(premVal))}" placeholder="target" style="width:70px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;outline:none;${premVal?'':'display:none;'}">
  </div>`);
  if (_hasCommissionsAddon || _isAdmin) {
    for (const t of _activityTypes) {
      const key = 'activity_' + t.id;
      const val = existingGoals[key] || '';
      const safeTypeId = escHtml(t.id);
      const safeName   = escHtml(t.name.length > 20 ? t.name.slice(0,18) + '…' : t.name);
      rows.push(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <input type="checkbox" id="gf-check-${escHtml(agentId)}-act-${safeTypeId}" ${val?'checked':''} onchange="goalMetricToggle('${escHtml(agentId)}','act-${safeTypeId}')">
        <label style="font-size:11px;min-width:130px;" title="${escHtml(t.name)}">${safeName}</label>
        <input type="number" id="gf-val-${escHtml(agentId)}-act-${safeTypeId}" min="0" value="${escHtml(String(val))}" placeholder="target" style="width:70px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;outline:none;${val?'':'display:none;'}">
      </div>`);
    }
  }
  // Combined groups section
  const combinedGroups = existingGoals.combined_groups || [];
  const cgHtml = `<div id="gf-combined-groups-${escHtml(agentId)}" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border2);">
    <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Combined Goals <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:10px;">(group products into one target)</span></div>
    <div id="gf-cg-rows-${escHtml(agentId)}">${combinedGroups.map((g,i) => _buildCgRow(agentId,i,g,cats)).join('')}</div>
    <button onclick="_addCgRow('${escHtml(agentId)}')" style="font-size:11px;background:none;border:1px solid var(--border2);color:var(--muted);border-radius:4px;padding:2px 8px;cursor:pointer;margin-top:2px;">+ Add Combined Goal</button>
  </div>`;
  return rows.join('') + cgHtml;
}

function _buildCgRow(agentId, idx, grp, cats) {
  const sid = escHtml(agentId);
  const sel = grp?.products || [];
  return `<div id="gf-cg-${sid}-${idx}" style="display:flex;gap:6px;align-items:flex-start;margin-bottom:5px;padding:5px 7px;background:var(--deep);border-radius:5px;border:1px solid var(--border2);">
    <div style="flex:1;">
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px;">
        <input id="gf-cg-lbl-${sid}-${idx}" type="text" placeholder="Label (e.g. Auto+Fire)" value="${escHtml(grp?.label||'')}" style="flex:1;min-width:90px;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;outline:none;">
        <input id="gf-cg-tgt-${sid}-${idx}" type="number" min="0" placeholder="target" value="${grp?.target||''}" style="width:55px;background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 4px;font-size:11px;outline:none;">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">${
        cats.map(c => `<label style="font-size:10px;display:flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;"><input type="checkbox" id="gf-cg-p-${sid}-${idx}-${c.key}" ${sel.includes(c.key)?'checked':''}> ${escHtml(c.label||c.key)}</label>`).join('')
      }</div>
    </div>
    <button onclick="_removeCgRow('${sid}',${idx})" style="background:none;border:none;color:var(--muted);font-size:15px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0;">×</button>
  </div>`;
}

function _addCgRow(agentId) {
  const cats = (_productTypes.length ? _productTypes : DEFAULT_SCORING_CATS).filter(c => ['wl','ul','term','health','auto','fire'].includes(c.key));
  const container = document.getElementById('gf-cg-rows-' + agentId);
  if (!container) return;
  const idx = container.children.length;
  container.insertAdjacentHTML('beforeend', _buildCgRow(agentId, idx, null, cats));
}

function _removeCgRow(agentId, idx) {
  const el = document.getElementById(`gf-cg-${agentId}-${idx}`);
  if (el) el.remove();
  // Re-index remaining rows so save logic finds them sequentially
  const container = document.getElementById('gf-cg-rows-' + agentId);
  if (!container) return;
  [...container.children].forEach((row, i) => { row.id = `gf-cg-${agentId}-${i}`; });
}

function showGoalForm(agentId, existingGoalId) {
  const container = document.getElementById('goal-form-' + agentId);
  if (!container) return;
  const existing   = existingGoalId ? _agentGoals.find(g => g.id === existingGoalId) : null;
  const periodType = existing?.period_type || 'monthly';
  const opts       = getGoalPeriodOptions(periodType);
  const PT = { monthly:'Monthly', quarterly:'Quarterly', semi_annual:'Semi-Annual', annual:'Annual' };
  container.style.display = '';
  container.innerHTML = `<div style="border-top:1px solid var(--border2);padding-top:8px;">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:flex-end;">
      <div>
        <label style="font-size:9px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:3px;">Period Type</label>
        <select id="gf-type-${escHtml(agentId)}" onchange="updateGoalFormPeriods('${escHtml(agentId)}')" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:11px;outline:none;">
          ${Object.entries(PT).map(([v,l]) => `<option value="${v}"${v===periodType?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:9px;color:var(--muted);text-transform:uppercase;display:block;margin-bottom:3px;">Period</label>
        <select id="gf-period-${escHtml(agentId)}" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:11px;outline:none;">
          ${opts.map(o => `<option value="${escHtml(o.label)}" data-start="${o.start}" data-end="${o.end}"${o.label===(existing?.period_label)||(!existing?.period_label&&o.isCurrent)?' selected':''}>${escHtml(o.label)}</option>`).join('')}
        </select>
      </div>
      <label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer;padding-bottom:2px;">
        <input type="checkbox" id="gf-public-${escHtml(agentId)}" ${existing?.is_public?'checked':''}> Public
      </label>
      <label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px;cursor:pointer;padding-bottom:2px;" title="Auto-apply these targets to each new period — no need to recreate monthly">
        <input type="checkbox" id="gf-recurring-${escHtml(agentId)}" ${existing?.is_recurring?'checked':''}> ↻ Recurring
      </label>
    </div>
    <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;">Target Metrics</div>
    <div id="gf-metrics-${escHtml(agentId)}">${buildGoalMetricsHtml(agentId, existing?.goals||{})}</div>
    <div style="display:flex;gap:6px;align-items:center;margin-top:8px;">
      <button onclick="saveGoalForm('${escHtml(agentId)}','${existingGoalId||''}')" style="background:var(--accent2);color:#000;border:none;border-radius:5px;padding:4px 12px;font-size:12px;cursor:pointer;font-weight:600;">Save</button>
      <button onclick="document.getElementById('goal-form-${escHtml(agentId)}').style.display='none'" style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:5px;padding:4px 10px;font-size:12px;cursor:pointer;">Cancel</button>
      <span id="gf-msg-${escHtml(agentId)}" style="font-size:11px;display:none;color:var(--danger);"></span>
    </div>
  </div>`;
}

async function saveGoalForm(agentId, existingGoalId) {
  const periodEl = document.getElementById('gf-period-' + agentId);
  const typeEl   = document.getElementById('gf-type-'   + agentId);
  const publicEl    = document.getElementById('gf-public-'    + agentId);
  const recurringEl = document.getElementById('gf-recurring-' + agentId);
  const msgEl       = document.getElementById('gf-msg-'       + agentId);
  if (!periodEl || !typeEl) return;

  const period_type  = typeEl.value;
  const period_label = periodEl.value;
  const selOpt       = periodEl.selectedOptions[0];
  const period_start = selOpt.dataset.start;
  const period_end   = selOpt.dataset.end;
  const is_public    = publicEl?.checked    || false;
  const is_recurring = recurringEl?.checked || false;

  const goals = {};
  const PROD_KEYS = ['wl','ul','term','health','auto','fire','policies','premium'];
  for (const key of PROD_KEYS) {
    const cb  = document.getElementById(`gf-check-${agentId}-${key}`);
    const inp = document.getElementById(`gf-val-${agentId}-${key}`);
    if (cb?.checked && inp?.value) goals[key] = parseFloat(inp.value) || 0;
  }
  for (const t of _activityTypes) {
    const mk  = 'act-' + t.id;
    const cb  = document.getElementById(`gf-check-${agentId}-${mk}`);
    const inp = document.getElementById(`gf-val-${agentId}-${mk}`);
    if (cb?.checked && inp?.value) goals['activity_' + t.id] = parseFloat(inp.value) || 0;
  }

  // Collect combined groups
  const _cgCats = (_productTypes.length ? _productTypes : DEFAULT_SCORING_CATS).filter(c => ['wl','ul','term','health','auto','fire'].includes(c.key));
  const cgContainer = document.getElementById(`gf-cg-rows-${agentId}`);
  if (cgContainer) {
    const groups = [];
    [...cgContainer.children].forEach((row, i) => {
      const label   = document.getElementById(`gf-cg-lbl-${agentId}-${i}`)?.value?.trim() || '';
      const target  = parseFloat(document.getElementById(`gf-cg-tgt-${agentId}-${i}`)?.value) || 0;
      const products = _cgCats.filter(c => document.getElementById(`gf-cg-p-${agentId}-${i}-${c.key}`)?.checked).map(c => c.key);
      if (products.length >= 2 && target > 0) groups.push({ id: 'cg' + i, label: label || products.join('+'), products, target });
    });
    if (groups.length) goals.combined_groups = groups;
  }

  if (!Object.keys(goals).length) {
    if (msgEl) { msgEl.style.display=''; msgEl.textContent='Add at least one metric target.'; }
    return;
  }

  const saveBtn = document.querySelector(`#goal-form-${agentId} button`);
  if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }

  try {
    let r;
    if (existingGoalId) {
      r = await fetch('/api/agent-goals', {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existingGoalId, goals, is_public, is_recurring }),
      });
    } else {
      r = await fetch('/api/agent-goals', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, period_type, period_label, period_start, period_end, goals, is_public, is_recurring }),
      });
    }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Save failed');
    if (existingGoalId) {
      const idx = _agentGoals.findIndex(g => g.id === existingGoalId);
      if (idx >= 0) _agentGoals[idx] = { ..._agentGoals[idx], goals, is_public, is_recurring };
    } else {
      _agentGoals.push(d);
    }
    document.getElementById('goal-form-' + agentId).style.display = 'none';
    renderAgentRoster();
  } catch(e) {
    if (msgEl) { msgEl.style.display=''; msgEl.textContent=e.message; }
    if (saveBtn) { saveBtn.disabled=false; saveBtn.textContent='Save'; }
  }
}

async function deleteAgentGoal(goalId, btn) {
  if (btn.dataset.confirming !== 'yes') {
    btn.dataset.confirming = 'yes';
    btn.textContent = '?';
    setTimeout(() => { if (btn.dataset.confirming==='yes') { btn.dataset.confirming=''; btn.innerHTML='&#x2715;'; } }, 3000);
    return;
  }
  btn.disabled = true;
  try {
    const r = await fetch('/api/agent-goals?id=' + encodeURIComponent(goalId), { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) { btn.disabled=false; btn.innerHTML='&#x2715;'; return; }
    _agentGoals = _agentGoals.filter(g => g.id !== goalId);
    renderAgentRoster();
  } catch(e) { btn.disabled=false; btn.innerHTML='&#x2715;'; }
}

function renderAgentRosterGoalsSection(a) {
  const agGoals = _agentGoals.filter(g => g.agent_id === a.agent_id)
    .sort((x, y) => x.period_start < y.period_start ? 1 : -1);
  const sid = escHtml(a.agent_id);
  const PT  = { monthly:'Monthly', quarterly:'Quarterly', semi_annual:'Semi-Annual', annual:'Annual' };
  const ML  = { wl:'WL', ul:'UL', term:'Term', health:'Health', auto:'Auto', fire:'Fire', policies:'Policies', premium:'Premium' };
  const goalRows = agGoals.map(g => {
    const keys = Object.keys(g.goals||{}).filter(k => g.goals[k] && k !== 'combined_groups');
    const cgPills = (g.goals.combined_groups || []).map(grp => {
      const act = g.actuals?.['combined_' + grp.id] ?? '—';
      return `${escHtml(grp.label||grp.id)}:${act}/${grp.target}`;
    });
    const summary = [...keys.slice(0,4).map(k => {
      if (k.startsWith('activity_')) {
        const at = _activityTypes.find(t => 'activity_'+t.id === k);
        return `${at ? at.name : k}:${g.goals[k]}`;
      }
      return `${ML[k]||k}:${g.goals[k]}`;
    }), ...cgPills].join(' · ');
    const badge = g.is_public
      ? '<span style="font-size:9px;background:rgba(0,229,180,.12);color:var(--accent2);border-radius:3px;padding:1px 5px;margin-left:4px;">Public</span>'
      : '<span style="font-size:9px;background:rgba(255,255,255,.06);color:var(--muted);border-radius:3px;padding:1px 5px;margin-left:4px;">Private</span>';
    const recBadge = g.is_recurring
      ? '<span style="font-size:9px;background:rgba(123,97,255,.15);color:#a78bfa;border-radius:3px;padding:1px 5px;margin-left:4px;">↻ Recurring</span>'
      : '';
    const displayLabel = g.is_recurring ? currentPeriodLabel(g.period_type) : g.period_label;
    return `<div style="display:flex;align-items:flex-start;gap:5px;margin-bottom:4px;padding:4px 6px;background:var(--card);border-radius:4px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:600;">${escHtml(displayLabel)} <span style="color:var(--muted);font-weight:400;font-size:10px;">(${PT[g.period_type]||g.period_type})</span>${badge}${recBadge}</div>
        ${summary ? `<div style="font-size:10px;color:var(--muted);margin-top:1px;">${escHtml(summary)}</div>` : ''}
      </div>
      <button onclick="showGoalForm('${sid}','${escHtml(g.id)}')" style="background:none;border:1px solid var(--border2);color:var(--muted);border-radius:3px;padding:1px 6px;font-size:10px;cursor:pointer;white-space:nowrap;">Edit</button>
      <button onclick="deleteAgentGoal('${escHtml(g.id)}',this)" style="background:none;border:1px solid var(--border2);color:var(--danger);border-radius:3px;padding:1px 5px;font-size:10px;cursor:pointer;">&#x2715;</button>
    </div>`;
  }).join('');
  return `<div id="goals-section-${sid}" style="margin-top:6px;padding:6px 8px;background:var(--deep);border-radius:6px;border:1px solid var(--border2);">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
      <div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">Goals</div>
      <button onclick="showGoalForm('${sid}')" style="background:none;border:1px solid var(--border2);color:var(--accent);border-radius:3px;padding:1px 7px;font-size:10px;cursor:pointer;">+ Add</button>
    </div>
    ${agGoals.length ? goalRows : '<div style="font-size:11px;color:var(--muted);">No goals set</div>'}
    <div id="goal-form-${sid}" style="display:none;margin-top:6px;"></div>
  </div>`;
}

function renderRaceGoalsRow(ag) {
  if (!_goalsLoaded || !_agentGoals.length || !_raceCurrentMonth) return '';
  const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTHS_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function parseMoLabel(label) {
    const parts = (label||'').trim().split(/\s+/);
    if (parts.length < 2) return null;
    const mStr = parts[0].toLowerCase();
    const yr   = parseInt(parts[parts.length - 1]);
    if (isNaN(yr)) return null;
    let mi = MONTHS_FULL.findIndex(m => m.toLowerCase() === mStr);
    if (mi < 0) mi = MONTHS_ABBR.findIndex(m => m.toLowerCase() === mStr);
    return mi >= 0 ? { year: yr, month: mi } : null;
  }
  const raceMo = parseMoLabel(_raceCurrentMonth);
  if (!raceMo) return '';
  const canPrivate = _isAdmin || !_isMember || ['captain','chief_officer'].includes(_memberRole);
  const canSee = g => g.agent_id === ag.agent_id && (g.is_public || canPrivate);
  const monthlyVisible = g => canSee(g) && g.period_type === 'monthly';
  // Prefer an exact period match for the current race month; fall back to recurring monthly
  let agGoal = _agentGoals.find(g => {
    if (!monthlyVisible(g) || g.is_recurring) return false;
    const d = new Date(g.period_start + 'T00:00:00Z');
    return d.getUTCFullYear() === raceMo.year && d.getUTCMonth() === raceMo.month;
  });
  if (!agGoal) agGoal = _agentGoals.find(g => monthlyVisible(g) && g.is_recurring);
  // Fall back to monthly goal for current calendar month (handles race month lag when month just turned)
  if (!agGoal) {
    const calMoStr = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    agGoal = _agentGoals.find(g => {
      if (!monthlyVisible(g) || g.is_recurring) return false;
      return g.period_start.startsWith(calMoStr);
    });
  }
  // Fall back to any currently-active non-monthly goal (quarterly / semi-annual / annual)
  if (!agGoal) {
    const todayStr = new Date().toISOString().slice(0, 10);
    agGoal = _agentGoals.find(g => {
      if (!canSee(g) || g.period_type === 'monthly') return false;
      if (g.is_recurring) return true;
      return g.period_start <= todayStr && g.period_end >= todayStr;
    });
  }
  if (!agGoal) return '';
  const useActuals = agGoal.period_type !== 'monthly';
  const PROD = { wl:'WL', ul:'UL', term:'T', health:'H', auto:'A', fire:'F' };
  const PT_SHORT = { quarterly:'Qtrly', semi_annual:'H1/H2', annual:'Annual' };
  const items = [];
  for (const [key, target] of Object.entries(agGoal.goals || {})) {
    if (!target || key === 'combined_groups') continue;
    let actual = 0, label = '';
    if (PROD[key]) {
      actual = useActuals ? (agGoal.actuals?.[key] ?? 0) : (ag[key] || 0);
      label = PROD[key];
    } else if (key === 'policies') {
      actual = useActuals
        ? (agGoal.actuals?.policies ?? 0)
        : (ag.wl||0)+(ag.ul||0)+(ag.term||0)+(ag.health||0)+(ag.auto||0)+(ag.fire||0);
      label  = 'Pol';
    } else if (key === 'premium' && useActuals) {
      actual = agGoal.actuals?.premium ?? 0;
      label  = 'Prem';
    } else continue;
    const pct = target > 0 ? Math.min(100, Math.round(actual / target * 100)) : 0;
    const col = pct >= 100 ? 'var(--accent2)' : pct >= 70 ? '#fbbf24' : 'var(--muted)';
    items.push({ label, actual, target, pct, col });
  }
  for (const grp of (agGoal.goals.combined_groups || [])) {
    if (!grp.target) continue;
    const actual = agGoal.actuals?.['combined_' + grp.id] ?? 0;
    const pct = grp.target > 0 ? Math.min(100, Math.round(actual / grp.target * 100)) : 0;
    const col = pct >= 100 ? 'var(--accent2)' : pct >= 70 ? '#fbbf24' : 'var(--muted)';
    items.push({ label: grp.label || grp.id, actual, target: grp.target, pct, col });
  }
  if (!items.length) return '';
  const lock = !agGoal.is_public ? ' <span style="font-size:9px;opacity:.7;">🔒</span>' : '';
  const periodTag = useActuals ? ` <span style="font-size:9px;opacity:.6;">(${PT_SHORT[agGoal.period_type]||agGoal.period_type})</span>` : '';
  return `<div style="margin-top:5px;padding:5px 7px;background:var(--deep);border-radius:5px;border:1px solid var(--border2);">
    <div style="font-size:9px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Goals${periodTag}${lock}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${items.map(it => `<div style="min-width:55px;flex:1;max-width:90px;">
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px;">
          <span style="color:var(--muted);">${it.label}</span><span style="color:${it.col};">${it.actual}/${it.target}</span>
        </div>
        <div style="height:3px;background:var(--border2);border-radius:2px;overflow:hidden;">
          <div style="height:3px;width:${it.pct}%;background:${it.col};border-radius:2px;"></div>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

let _goalsSelectedMonth = ''; // YYYY-MM format for Goals tab month filter
let _goalsTabGoals = [];      // goals with actuals for the selected Goals tab month (kept separate from _agentGoals used by race tab)

function _populateGoalsMonthPicker() {
  const sel = document.getElementById('goals-month-sel');
  if (!sel) return;
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  let opts = '';
  for (let off = -11; off <= 2; off++) {
    let m = now.getMonth() + off, y = now.getFullYear();
    while (m < 0)  { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    const val = `${y}-${String(m+1).padStart(2,'0')}`;
    opts += `<option value="${val}"${val === _goalsSelectedMonth ? ' selected' : ''}>${MO[m]} ${y}</option>`;
  }
  sel.innerHTML = opts;
}

async function goalsSetMonth(yyyyMm) {
  if (_goalsSelectedMonth === yyyyMm) return;
  _goalsSelectedMonth = yyyyMm;
  await loadGoalsTab();
}

async function loadGoalsTab() {
  const el = document.getElementById('goals-content');
  if (!el) return;
  _goalsViewFilter = 'all';
  syncGoalsFilterButtons();
  if (!_goalsSelectedMonth) {
    const now = new Date();
    _goalsSelectedMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  _populateGoalsMonthPicker();
  el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:2rem;">Loading…</div>';
  await loadMemberOrgTree();
  try {
    const r = await fetch(`/api/agent-goals?withActuals=1&refDate=${_goalsSelectedMonth}`, { headers: authHeaders() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Load failed');
    _goalsTabGoals = Array.isArray(d) ? d : [];
    // Also update _agentGoals (used by race tab) only when showing the current month
    const _nowMo = new Date();
    const _curMoStr = `${_nowMo.getFullYear()}-${String(_nowMo.getMonth()+1).padStart(2,'0')}`;
    if (_goalsSelectedMonth === _curMoStr) { _agentGoals = _goalsTabGoals; _goalsLoaded = true; }
    renderGoalsTab();
  } catch(e) {
    el.innerHTML = `<div style="color:var(--danger);font-size:13px;text-align:center;padding:2rem;">${escHtml(e.message)}</div>`;
  }
}

function syncGoalsFilterButtons() {
  document.querySelectorAll('#goals-period-filter button').forEach(b => {
    const active = b.dataset.filter === _goalsViewFilter;
    b.style.background  = active ? 'var(--accent2)' : 'var(--card2)';
    b.style.color       = active ? '#000' : 'var(--muted)';
    b.style.border      = active ? 'none' : '1px solid var(--border2)';
    b.style.fontWeight  = active ? '600'  : '';
  });
}

function setGoalsFilter(filter) {
  _goalsViewFilter = filter;
  syncGoalsFilterButtons();
  renderGoalsTab();
}

async function loadMemberOrgTree() {
  if (_memberOrgLoaded) return;
  if (_isMember && _memberRole !== 'captain') return;
  try {
    const r = await fetch('/api/member-org', { headers: authHeaders() });
    if (!r.ok) return;
    const members = await r.json();
    const byId = {};
    members.forEach(m => { byId[m.id] = { ...m, agentId: m.roster_agent_id, subordinates: [] }; });
    const tree = [];
    members.forEach(m => {
      if (m.managed_by && byId[m.managed_by]) byId[m.managed_by].subordinates.push(byId[m.id]);
      else tree.push(byId[m.id]);
    });
    _memberOrgTree   = tree;
    _memberOrgLoaded = true;
  } catch(e) { console.warn('loadMemberOrgTree:', e); }
}

function _getOrgGroups() {
  if (!_memberOrgLoaded || !_memberOrgTree.length) return null;
  const coNodes = _memberOrgTree.filter(n => n.role === 'chief_officer');
  if (!coNodes.length) return null;
  const agentName = id => _agentRoster.find(a => a.agent_id === id)?.name || id;
  const assigned = new Set();
  const groups = coNodes.map(co => {
    const subIds = co.subordinates.map(s => s.agentId).filter(Boolean);
    const coId   = co.agentId;
    const ids    = [...(coId ? [coId] : []), ...subIds];
    ids.forEach(id => assigned.add(id));
    return { label: coId ? agentName(coId) : co.email, coAgentId: coId, agentIds: ids, isUnassigned: false };
  });
  const unassigned = (_agentRoster || [])
    .filter(a => a.active !== false && !assigned.has(a.agent_id))
    .map(a => a.agent_id);
  if (unassigned.length) groups.push({ label: 'Unassigned', coAgentId: null, agentIds: unassigned, isUnassigned: true });
  return groups.length ? groups : null;
}

function _renderAgencyGoalsSection() {
  const myRole = _isMember ? _memberRole : 'owner';
  const PROD_LABELS = { wl:'WL', ul:'UL', term:'Term', health:'Health', auto:'Auto', fire:'Fire' };
  const hasGoals = l => l.goal_count || l.goal_premium || l.goal_count_annual || l.goal_premium_annual ||
    Object.keys(l.product_goals_monthly || {}).length || Object.keys(l.product_goals_annual || {}).length;
  const visibleLocs = (_salesLocations || []).filter(l => {
    if (!l.goals_enabled || !hasGoals(l)) return false;
    const vis = l.goals_visibility;
    if (!vis || !vis.length || vis.includes('all')) return true;
    return vis.includes(myRole);
  });
  if (!visibleLocs.length) return '';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let agRefYr, agRefMo;
  if (_goalsSelectedMonth) {
    const parts = _goalsSelectedMonth.split('-').map(Number);
    agRefYr = parts[0]; agRefMo = parts[1] - 1;
  } else { const now = new Date(); agRefYr = now.getFullYear(); agRefMo = now.getMonth(); }
  const monthLabel = MONTHS[agRefMo] + ' ' + agRefYr;
  const yearLabel  = String(agRefYr);
  const prodRow = (goals, period) => {
    const entries = Object.entries(goals || {}).filter(([,v]) => v);
    if (!entries.length) return '';
    return `<div style="font-size:12px;margin-top:3px;"><span style="color:var(--muted);">${period} Product Goals:</span> ${entries.map(([k,v]) => `${PROD_LABELS[k]||k}: <strong>${Number(v).toLocaleString()}</strong>`).join(' · ')}</div>`;
  };
  const cards = visibleLocs.map(l => {
    const items = [];
    if (l.goal_count)         items.push(`<div style="font-size:12px;"><span style="color:var(--muted);">Monthly Policy Goal (${monthLabel}):</span> <strong>${Number(l.goal_count).toLocaleString()}</strong></div>`);
    if (l.goal_premium)       items.push(`<div style="font-size:12px;margin-top:3px;"><span style="color:var(--muted);">Monthly Premium Goal (${monthLabel}):</span> <strong>$${Number(l.goal_premium).toLocaleString()}</strong></div>`);
    const moProds = prodRow(l.product_goals_monthly, `Monthly (${monthLabel})`);
    if (moProds) items.push(moProds);
    if (l.goal_count_annual)   items.push(`<div style="font-size:12px;margin-top:3px;"><span style="color:var(--muted);">Annual Policy Goal (${yearLabel}):</span> <strong>${Number(l.goal_count_annual).toLocaleString()}</strong></div>`);
    if (l.goal_premium_annual) items.push(`<div style="font-size:12px;margin-top:3px;"><span style="color:var(--muted);">Annual Premium Goal (${yearLabel}):</span> <strong>$${Number(l.goal_premium_annual).toLocaleString()}</strong></div>`);
    const annProds = prodRow(l.product_goals_annual, `Annual (${yearLabel})`);
    if (annProds) items.push(annProds);
    if (!items.length) return '';
    return `<div style="background:var(--deep);border:1px solid var(--border2);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${escHtml(l.name)}</div>
      ${items.join('')}
    </div>`;
  }).filter(Boolean).join('');
  if (!cards) return '';
  return `<div style="margin-bottom:1.5rem;border:1px solid var(--border2);border-radius:10px;padding:.85rem;">
    <div style="font-size:13px;font-weight:700;color:var(--accent2);margin-bottom:.75rem;">Agency Goals</div>
    ${cards}
  </div>`;
}

function renderGoalsTab() {
  const el = document.getElementById('goals-content');
  if (!el) return;
  const PT = { monthly:'Monthly', quarterly:'Quarterly', semi_annual:'Semi-Annual', annual:'Annual' };
  const ML = { wl:'WL', ul:'UL', term:'Term', health:'Health', auto:'Auto', fire:'Fire', policies:'Total Policies', premium:'Premium ($)' };

  const agencyHtml = _renderAgencyGoalsSection();

  let filtered = _goalsViewFilter === 'all'
    ? _goalsTabGoals
    : _goalsTabGoals.filter(g => g.period_type === _goalsViewFilter);
  if (_isMember && _managedAgentIds.length > 0) {
    filtered = filtered.filter(g => _managedAgentIds.includes(g.agent_id));
  }
  if (_goalsSelectedMonth) {
    filtered = filtered.filter(g => {
      if (g.is_recurring) return true;
      if (g.period_type === 'monthly') return g.period_start.startsWith(_goalsSelectedMonth);
      const mid = `${_goalsSelectedMonth}-15`;
      return mid >= g.period_start && mid <= g.period_end;
    });
  }

  if (!filtered.length && !agencyHtml) {
    const MO_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const moLabel = _goalsSelectedMonth ? (() => { const [y,m] = _goalsSelectedMonth.split('-').map(Number); return ` for ${MO_FULL[m-1]} ${y}`; })() : '';
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:2rem;">No goals found${moLabel}. Set goals in <button class="btn btn-secondary" style="padding:2px 8px;font-size:12px;" onclick="goToAccountTab('sales','ma-agents-section')">Account → Sales → Team</button></div>`;
    return;
  }

  const byAgent = {};
  for (const g of filtered) {
    if (!byAgent[g.agent_id]) byAgent[g.agent_id] = [];
    byAgent[g.agent_id].push(g);
  }

  const renderGoalCards = (goals) => [...goals].sort((a,b) => b.period_start > a.period_start ? 1 : -1).map(g => {
    const badge = g.is_public
      ? '<span style="font-size:10px;background:rgba(0,229,180,.12);color:var(--accent2);border-radius:3px;padding:1px 6px;">Public</span>'
      : '<span style="font-size:10px;background:rgba(255,255,255,.06);color:var(--muted);border-radius:3px;padding:1px 6px;">Private</span>';
    const recBadge = g.is_recurring
      ? '<span style="font-size:10px;background:rgba(123,97,255,.15);color:#a78bfa;border-radius:3px;padding:1px 6px;">↻ Recurring</span>'
      : '';
    const metrics = Object.entries(g.goals || {}).filter(([k,v]) => v && k !== 'combined_groups');
    const hasCombined = (g.goals.combined_groups || []).length > 0;
    if (!metrics.length && !hasCombined) return '';
    const rows = metrics.map(([key, target]) => {
      const raw    = g.actuals?.[key];
      const actual = typeof raw === 'number' ? raw : null;
      const label  = key.startsWith('activity_')
        ? (_activityTypes.find(t => 'activity_'+t.id === key)?.name || key)
        : (ML[key] || key);
      const numTgt = parseFloat(target) || 0;
      const pct    = actual !== null && numTgt > 0 ? Math.min(100, Math.round(actual/numTgt*100)) : null;
      const col    = pct === null ? 'var(--muted)' : pct>=100 ? 'var(--accent2)' : pct>=70 ? '#fbbf24' : 'var(--danger)';
      const dispA  = actual === null ? '—' : key==='premium' ? '$'+Math.round(actual).toLocaleString() : actual;
      const dispT  = key === 'premium' ? '$'+parseFloat(target).toLocaleString() : target;
      return `<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span>${escHtml(label)}</span>
          <span style="color:${col};">${dispA} / ${dispT}${pct!==null?' ('+pct+'%)':''}</span>
        </div>
        <div style="height:5px;background:var(--border2);border-radius:3px;overflow:hidden;">
          ${pct!==null?`<div style="height:5px;width:${pct}%;background:${col};border-radius:3px;transition:width .3s;"></div>`:''}
        </div>
      </div>`;
    });
    for (const grp of (g.goals.combined_groups || [])) {
      if (!grp.target) continue;
      const raw    = g.actuals?.['combined_' + grp.id];
      const actual = typeof raw === 'number' ? raw : null;
      const numTgt = grp.target;
      const pct    = actual !== null && numTgt > 0 ? Math.min(100, Math.round(actual/numTgt*100)) : null;
      const col    = pct === null ? 'var(--muted)' : pct>=100 ? 'var(--accent2)' : pct>=70 ? '#fbbf24' : 'var(--danger)';
      const dispA  = actual === null ? '—' : actual;
      rows.push(`<div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span>${escHtml(grp.label||grp.id)} <span style="font-size:10px;color:var(--muted);">(combined)</span></span>
          <span style="color:${col};">${dispA} / ${numTgt}${pct!==null?' ('+pct+'%)':''}</span>
        </div>
        <div style="height:5px;background:var(--border2);border-radius:3px;overflow:hidden;">
          ${pct!==null?`<div style="height:5px;width:${pct}%;background:${col};border-radius:3px;transition:width .3s;"></div>`:''}
        </div>
      </div>`);
    }
    const rowsHtml = rows.join('');
    const displayLabel = g.is_recurring ? currentPeriodLabel(g.period_type) : g.period_label;
    const range        = g.is_recurring ? currentPeriodRange(g.period_type) : { start: g.period_start, end: g.period_end };
    return `<div style="background:var(--deep);border:1px solid var(--border2);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <span style="font-size:13px;font-weight:600;">${escHtml(displayLabel)}</span>
        <span style="font-size:11px;color:var(--muted);">${PT[g.period_type]||g.period_type}</span>
        ${badge}${recBadge}
        <span style="font-size:10px;color:var(--muted);margin-left:auto;">${range.start} – ${range.end}</span>
      </div>
      ${rowsHtml}
    </div>`;
  }).join('');

  const renderAgentBlock = (agentId, indent) => {
    const goals = byAgent[agentId];
    if (!goals?.length) return '';
    const name  = (_agentRoster.find(x => x.agent_id === agentId)?.name) || agentId;
    const cards = renderGoalCards(goals);
    return `<div style="margin-bottom:1rem;${indent ? 'margin-left:1.5rem;padding-left:.75rem;border-left:2px solid var(--border2);' : ''}">
      <div style="font-size:${indent ? '13' : '14'}px;font-weight:700;margin-bottom:.5rem;padding-bottom:.4rem;border-bottom:1px solid var(--border2);">${escHtml(name)}</div>
      ${cards || ''}
    </div>`;
  };

  const groups = _getOrgGroups();
  let agentGoalsHtml;

  if (groups) {
    agentGoalsHtml = groups.map(group => {
      const memberBlocks = group.agentIds.map(id => renderAgentBlock(id, id !== group.coAgentId)).join('');
      if (!memberBlocks.trim()) return '';
      const hdrStyle = group.isUnassigned
        ? 'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.75rem;'
        : 'font-size:13px;font-weight:700;color:var(--accent);margin-bottom:.75rem;display:flex;align-items:center;gap:6px;';
      const hdrLabel = group.isUnassigned ? 'Unassigned' : `Chief Officer: ${escHtml(group.label)}`;
      return `<div style="margin-bottom:1.25rem;border:1px solid var(--border2);border-radius:10px;padding:.85rem;">
        <div style="${hdrStyle}">${hdrLabel}</div>
        ${memberBlocks}
      </div>`;
    }).join('');
  } else {
    agentGoalsHtml = Object.entries(byAgent).map(([agentId]) => renderAgentBlock(agentId, false)).join('');
  }

  el.innerHTML = agencyHtml + (agentGoalsHtml || (agencyHtml ? '' : '<div style="color:var(--muted);font-size:13px;text-align:center;padding:2rem;">No agent goals for this filter.</div>'));
}

