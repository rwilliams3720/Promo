// ── Agent Roster React Island ────────────────────────────────────────────────
// Regular script (not a module). React, ReactDOM, htm loaded as UMD globals
// immediately before this file. All app globals are in the same global scope.

(function () {
  var html = htm.bind(React.createElement);

  // ── HTML generators ───────────────────────────────────────────────────────

  function buildCommissionSectionHtml(a) {
    if (!_hasCommissionsAddon && !_isAdmin) return '';
    var safeId = escHtml(a.agent_id);
    var assignedIds = a.commission_structure_ids || (a.commission_structure_id ? [a.commission_structure_id] : []);
    var structures = _commissionStructures || [];

    var assignedRows = assignedIds.map(function(sid) {
      var s = structures.find(function(x) { return x.id === sid; });
      if (!s) return '';
      return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">' +
        '<span style="font-size:12px;flex:1;">' + escHtml(s.name) + '</span>' +
        '<button onclick="removeAgentStructure(\'' + safeId + '\',\'' + escHtml(sid) + '\',this)" style="background:none;border:1px solid var(--border2);color:var(--danger);border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer;">&#x2715;</button>' +
        '</div>';
    }).join('');

    var availableToAdd = structures.filter(function(s) { return !assignedIds.includes(s.id); });
    var addDropdown = availableToAdd.length
      ? '<div style="display:flex;gap:6px;align-items:center;margin-top:4px;">' +
          '<select id="add-struct-' + safeId + '" style="background:var(--deep);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:11px;outline:none;flex:1;">' +
          '<option value="">+ Add structure...</option>' +
          availableToAdd.map(function(s) { return '<option value="' + escHtml(s.id) + '">' + escHtml(s.name) + '</option>'; }).join('') +
          '</select>' +
          '<button onclick="addAgentStructure(\'' + safeId + '\',this)" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 9px;font-size:11px;cursor:pointer;">Add</button>' +
        '</div>' : '';

    var qualLabel = assignedIds.length > 1
      ? '<label style="font-size:11px;color:var(--muted);display:flex;align-items:center;gap:5px;margin-top:5px;cursor:pointer;">' +
          '<input type="checkbox" id="qual-' + safeId + '" ' + (a.commission_all_must_qualify ? 'checked' : '') +
          ' onchange="saveAgentQualifier(\'' + escHtml(a.id) + '\',this.checked)"> All structures must qualify for any payout' +
        '</label>' : '';

    var overlapHtml = buildOverlapHtml(a, safeId, assignedIds, structures);

    var capTotalHtml =
      '<div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
      '<span style="font-size:10px;color:var(--muted);white-space:nowrap;">Max Total Commission $</span>' +
      '<input id="cap-total-' + safeId + '" type="number" min="0" step="1" placeholder="No cap" value="' +
        (a.commission_cap_total != null ? a.commission_cap_total : '') + '" ' +
        'style="width:110px;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:3px 6px;font-size:11px;outline:none;">' +
      '<button onclick="saveCommissionCapTotal(\'' + safeId + '\',document.getElementById(\'cap-total-' + safeId + '\'),this)" ' +
        'style="background:none;border:1px solid rgba(0,212,255,.3);color:var(--accent);border-radius:5px;padding:3px 10px;font-size:11px;cursor:pointer;">Save</button>' +
      '<span style="font-size:10px;color:var(--muted);">per month total</span></div>';

    return '<div style="margin-top:6px;padding:6px 8px;background:var(--deep);border-radius:6px;border:1px solid var(--border2);">' +
      '<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Commission Structures</div>' +
      (assignedRows || '<div style="font-size:11px;color:var(--muted);">None assigned</div>') +
      addDropdown + qualLabel + overlapHtml + capTotalHtml + '</div>';
  }

  // Detects products rated by 2+ of an agent's assigned structures and renders a
  // per-product picker so the owner can restrict a product to one structure instead
  // of the default (sum every structure that rates it — unchanged pay unless set).
  function buildOverlapHtml(a, safeId, assignedIds, structures) {
    if (assignedIds.length < 2) return '';
    var assignedStructs = assignedIds.map(function(sid) {
      return structures.find(function(s) { return s.id === sid; });
    }).filter(Boolean);

    var productCounts = {};
    assignedStructs.forEach(function(s) {
      Object.entries(s.rates || {}).forEach(function(entry) {
        var prod = entry[0], cfg = entry[1];
        if (cfg && cfg.type && cfg.type !== 'none') productCounts[prod] = (productCounts[prod] || 0) + 1;
      });
    });
    var overlapping = Object.keys(productCounts).filter(function(p) { return productCounts[p] > 1; });
    if (!overlapping.length) return '';

    var overrides = a.commission_product_overrides || {};
    var rows = overlapping.map(function(prod) {
      var current = overrides[prod] || 'both';
      var structOpts = assignedStructs.map(function(s) {
        return '<option value="' + escHtml(s.id) + '" ' + (current === s.id ? 'selected' : '') + '>' + escHtml(s.name) + '</option>';
      }).join('');
      return '<div style="display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap;">' +
        '<span style="font-size:11px;color:var(--muted);min-width:70px;">' + escHtml(labelForCat(prod)) + '</span>' +
        '<select onchange="saveCommissionProductOverride(\'' + safeId + '\',\'' + escHtml(prod) + '\',this.value)" ' +
          'style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:2px 6px;font-size:11px;outline:none;">' +
          structOpts +
          '<option value="both" ' + (current === 'both' ? 'selected' : '') + '>Both (sum) — current behavior</option>' +
        '</select></div>';
    }).join('');

    return '<div style="margin-top:6px;padding:6px 8px;background:rgba(255,179,0,.06);border:1px solid rgba(255,179,0,.2);border-radius:6px;">' +
      '<div style="font-size:10px;font-weight:600;color:#ffb300;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px;">&#x26A0; Overlapping products rated in multiple structures</div>' +
      '<div style="font-size:10px;color:var(--muted);margin-bottom:4px;">Choose which structure each applies to — affects both earned commission and chargeback deductions. Defaults to summing both.</div>' +
      rows + '</div>';
  }

  function buildAgentCardHtml(a) {
    var safeId = escHtml(a.agent_id);
    var structSection = buildCommissionSectionHtml(a);
    var goalsSection = typeof renderAgentRosterGoalsSection === 'function'
      ? renderAgentRosterGoalsSection(a) : '';
    return '<div style="margin-bottom:.5rem;padding:.5rem;background:var(--card2);border:1px solid var(--border2);border-radius:8px;">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;">' +
          '<input type="checkbox" ' + (a.active !== false ? 'checked' : '') +
          ' onchange="toggleAgentRoster(\'' + escHtml(a.id) + '\', this.checked)">' +
          '<span style="font-size:11px;color:var(--muted);white-space:nowrap;">Active</span></label>' +
        '<span id="rn-label-' + safeId + '" style="font-size:13px;font-weight:600;flex:1;">' + escHtml(a.name) + '</span>' +
        '<button onclick="startEditRosterName(\'' + escHtml(a.id) + '\',\'' + safeId + '\')" ' +
          'style="background:none;border:none;color:var(--muted);padding:0 2px;cursor:pointer;font-size:14px;line-height:1;" title="Rename">&#x270E;</button>' +
        '<span style="font-size:11px;color:var(--muted);font-family:\'DM Mono\',monospace;">' + escHtml(a.agent_id) + '</span>' +
        '<button class="btn btn-secondary" style="padding:2px 8px;font-size:11px;" ' +
          'onclick="deleteAgentRoster(\'' + escHtml(a.id) + '\', this)">&#x2715;</button>' +
      '</div>' + structSection + goalsSection + '</div>';
  }

  // ── React component ───────────────────────────────────────────────────────

  function AgentRosterIsland() {
    var roster = _agentRoster || [];
    if (!roster.length) {
      return html`<div style=${{ fontSize: '13px', color: 'var(--muted)', marginBottom: '.5rem' }}>No agents yet — add one below or upload a sales/call file.</div>`;
    }
    return html`<${React.Fragment}>
      ${roster.map(function(a) {
        return html`<div key=${a.id} dangerouslySetInnerHTML=${{ __html: buildAgentCardHtml(a) }}></div>`;
      })}
    </${React.Fragment}>`;
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  var _root = null;

  function doRender() {
    if (_root) _root.render(html`<${AgentRosterIsland} />`);
  }

  function mountRosterIsland() {
    var container = document.getElementById('agent-roster-list');
    if (!container) return;
    _root = ReactDOM.createRoot(container);
    doRender();

    // Replace the vanilla renderAgentRoster: just call root.render() again.
    // React 18 reconciles efficiently — only changed cards update.
    window.renderAgentRoster = doRender;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountRosterIsland);
  } else {
    mountRosterIsland();
  }

})();
