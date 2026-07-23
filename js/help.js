// ── HELP / HOW-TO GUIDES (Account → Help) ───────────────────────────────────
// Each guide: id, category, title, description, visibility, steps.
// visibility: array of audiences — 'all' (everyone with Account access),
// 'owner' (account owner only, i.e. !_isMember), or specific member roles
// ('captain' | 'chief_officer' | 'bosun' | 'custom').
const HELP_GUIDES = [
  {
    id: 'invite-bosun',
    category: 'Team & Roles',
    title: 'How to Invite a Bosun to Your Team',
    description: 'Add a new team member with Race-tab-only access and send them an invitation.',
    visibility: ['owner'],
    steps: [
      { text: 'Navigate to your Boat Race dashboard.', img: '/img/help/invite-bosun-1.jpg' },
      { text: 'Click "Account".', img: '/img/help/invite-bosun-2.jpg' },
      { text: 'Click "Team".', img: '/img/help/invite-bosun-3.jpg' },
      { text: 'Click the email address field under "Invite a Team Member".', img: '/img/help/invite-bosun-4.jpg' },
      { text: 'Set Access Role to "Bosun — Race tab only".', img: '/img/help/invite-bosun-5.jpg' },
      { text: 'Click "Send Invite".', img: '/img/help/invite-bosun-6.jpg' },
    ],
  },
];

function _canSeeHelpGuide(g) {
  if (!g.visibility || g.visibility.includes('all')) return true;
  if (g.visibility.includes('owner')) return !_isMember || _isAdmin;
  return _isMember && g.visibility.includes(_memberRole);
}

// listId: container to render guide cards into.
// wrapperId: optional ancestor section to hide entirely when no guides are visible
// (used for the member Account panel, where an empty "Help" section would look
// like a bug rather than intentional — the owner's dedicated Help sub-tab shows
// an explicit empty state instead since it's a whole tab, not an inline section).
function renderHelpTab(listId, wrapperId) {
  listId = listId || 'help-guides-list';
  const container = document.getElementById(listId);
  if (!container) return;
  const wrapper = wrapperId ? document.getElementById(wrapperId) : null;

  const visible = HELP_GUIDES.filter(_canSeeHelpGuide);
  if (!visible.length) {
    if (wrapper) { wrapper.style.display = 'none'; return; }
    container.innerHTML = '<p style="font-size:13px;color:var(--muted);">No guides available for your role yet.</p>';
    return;
  }
  if (wrapper) wrapper.style.display = '';

  const byCategory = {};
  for (const g of visible) {
    if (!byCategory[g.category]) byCategory[g.category] = [];
    byCategory[g.category].push(g);
  }

  container.innerHTML = Object.entries(byCategory).map(([category, guides]) => `
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.6rem;">${escHtml(category)}</div>
      ${guides.map(g => _renderHelpGuideCard(g)).join('')}
    </div>
  `).join('');
}

function _renderHelpGuideCard(g) {
  return `<div class="panel" style="margin-bottom:.75rem;">
    <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none';this.querySelector('.help-guide-arrow').textContent=this.nextElementSibling.style.display===''?'▲':'▼';">
      <div>
        <div style="font-size:14px;font-weight:600;">${escHtml(g.title)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px;">${escHtml(g.description)}</div>
      </div>
      <span class="help-guide-arrow" style="font-size:11px;color:var(--muted);flex-shrink:0;margin-left:1rem;">▼</span>
    </div>
    <div style="display:none;margin-top:1rem;">
      ${g.steps.map((s, i) => `
        <div style="display:flex;gap:.75rem;align-items:flex-start;margin-bottom:${i < g.steps.length - 1 ? '1rem' : '0'};">
          <div style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:var(--accent);color:#000;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;margin-bottom:${s.img ? '.5rem' : '0'};">${escHtml(s.text)}</div>
            ${s.img ? `<img src="${escHtml(s.img)}" alt="" style="max-width:100%;border-radius:8px;border:1px solid var(--border2);display:block;">` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}
