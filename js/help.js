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
  {
    id: 'raise-eligibility-member',
    category: 'Goals & Growth',
    title: 'Understanding Your Raise Eligibility',
    description: 'How your annual goal progress translates into a raise, and what the colors mean.',
    visibility: ['all'],
    steps: [
      { text: 'Open the Goals tab. If your manager has flagged one of your annual goals as raise-eligible, you’ll see a "🎯 Raise Eligibility" card near the top.' },
      { text: 'The progress bar shows how close you are to your goal. Depending on how this goal is set up, you may be compared against your own numbers only, a blend of your numbers and your agency’s, or both shown side by side.' },
      { text: 'Toggle "Show annualized projection" to see your pace projected out to the full year instead of just year-to-date — useful early in the year when your raw progress % naturally looks low.' },
      { text: 'Bar color meaning depends on which view you’re looking at: the year-to-date view turns green at 80%+ progress; the annualized/projected view turns green at 100%+, since it’s already accounting for time remaining in the year.' },
      { text: 'If a minimum floor is set on this goal, falling below it zeroes out the raise regardless of any blended score — you’ll see a warning banner on the card if that applies to you.' },
      { text: 'This card is an estimate to help you track your own progress — your actual raise is decided by your manager.' },
    ],
  },
  {
    id: 'raise-eligibility-owner',
    category: 'Goals & Growth',
    title: 'Setting Up a Raise-Eligible Goal',
    description: 'Flag an annual goal to track raise eligibility, choose how it’s scored, and set an optional floor.',
    visibility: ['owner'],
    steps: [
      { text: 'Go to Account → Sales → Team, find the agent, and create or edit an Annual goal.' },
      { text: 'Check "🎯 Raise-Eligible Goal" to reveal the raise settings.' },
      { text: 'Choose a Combination Mode: Individual (just this agent), Blended (a weighted mix of this agent and an Agency Location’s annual goal), or Separate (both shown side by side with no combined score).' },
      { text: 'If you chose Blended or Separate, pick the Agency Location to compare against and whether it’s measured by policy count or premium.' },
      { text: 'Choose a Reward Calculation: Proportional (a target % earned at 100% of goal, scaling up to a higher max % for exceeding goal) or Threshold Tiers (fixed raise amounts unlocked at specific progress milestones).' },
      { text: 'Optionally enable the Individual Gate and set a floor — if the agent’s own progress falls below it, the raise shows as 0% no matter what the rest of the formula would say.' },
      { text: 'Use the Public checkbox as usual to control whether other agents can see this goal — the agent it belongs to can always see their own raise progress regardless.' },
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
