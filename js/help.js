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
      { text: 'Open the Goals tab. If your manager has flagged one of your annual (or recurring monthly) goals as raise-eligible, you’ll see a "🎯 Raise Eligibility" card near the top.' },
      { text: 'The progress bar shows how close you are to your goal. Depending on how this goal is set up, you may be compared against your own numbers only, a blend of your numbers and your agency’s, or both shown side by side.' },
      {
        text: 'Toggle "Show annualized projection" (or "projected pace" on a monthly goal) to see your pace projected out to the full period instead of just progress-so-far — useful early on, when your raw progress % naturally looks low simply because the period just started.',
        html: `<div class="hg-panel">
          <div class="hg-formula">78% progress ÷ <b>8 months elapsed</b>&nbsp; = &nbsp;<b>9.75%</b>/month&nbsp; × &nbsp;12&nbsp; = &nbsp;<b>117%</b> projected year-end</div>
          <div style="font-size:10px;color:var(--muted);margin-top:.4rem;">That projected number then runs through the same reward math as your real progress does — it's a pace projection, not a guarantee.</div>
        </div>`,
      },
      { text: 'Bar color meaning depends on which view you’re looking at: the progress-so-far view turns green at 80%+; the projected/annualized view turns green at 100%+, since it’s already accounting for time remaining in the period.' },
      { text: 'If a minimum floor is set on this goal, falling below it zeroes out the raise regardless of any blended score — you’ll see a warning banner on the card if that applies to you.' },
      { text: 'This card is an estimate to help you track your own progress — your actual raise is decided by your manager.' },
    ],
  },
  {
    id: 'raise-eligibility-owner',
    category: 'Goals & Growth',
    title: 'Setting Up a Raise-Eligible Goal',
    description: 'Flag an annual (or recurring monthly) goal to track raise eligibility, choose how it’s scored, and set an optional floor.',
    visibility: ['owner'],
    steps: [
      {
        text: 'Go to Account → Sales → Team, find the agent (or a Whole Agency / Team card), and create or edit an Annual goal — or a Monthly goal with Recurring checked.',
        html: `<div class="hg-panel">
          <div class="hg-path">Account <b>→</b> Sales <b>→</b> Team <b>→</b> <b>Andy Rose</b> <b>→</b> + Add Goal</div>
          <div class="hg-row">
            <div class="hg-field"><span class="hg-label">Period Type</span><div class="hg-input">Annual</div></div>
            <div class="hg-field"><span class="hg-label">Period</span><div class="hg-input">2026</div></div>
          </div>
        </div>`,
      },
      {
        text: 'How the number actually accumulates: sales just add up over the period, month over month, with no penalty for a slow month and no special credit for a big one beyond its raw count — an off month is fully forgiven, not held against the total.',
        html: `<div class="hg-panel">
          <div class="hg-months">
            <div class="hg-month"><div class="hg-m">January</div><div class="hg-n">40</div></div>
            <div class="hg-month"><div class="hg-m">February</div><div class="hg-n">10</div></div>
            <div class="hg-month"><div class="hg-m">March</div><div class="hg-n">60</div></div>
          </div>
          <div class="hg-formula">Summed, no gating, no reset&nbsp; → &nbsp;<b>110 / 360 · 31%</b> through March</div>
        </div>`,
      },
      {
        text: 'Check "🎯 Raise-Eligible Goal" to reveal the raise settings.',
        html: `<div class="hg-panel">
          <label class="hg-check"><span class="hg-box hg-checked"></span>🎯 Raise-Eligible Goal</label>
          <div class="hg-div"></div>
          <div class="hg-gold">
            <div class="hg-hdr">Raise settings revealed</div>
            <div class="hg-body">Combination Mode · Reward Calculation · Individual Gate — configured below.</div>
          </div>
        </div>`,
      },
      {
        text: 'Choose a Combination Mode: Individual (just this agent), Blended (a weighted mix of this agent and an Agency Location’s goal — pick one specific location or All Locations combined), or Separate (both shown side by side with no combined score, for whoever makes the raise call to weigh manually).',
        html: `<div class="hg-panel">
          <span class="hg-label">Combination Mode</span>
          <div class="hg-row" style="margin-bottom:.6rem;">
            <span class="hg-pill">Individual</span><span class="hg-pill hg-new">Blended</span><span class="hg-pill">Separate</span>
          </div>
          <div class="hg-row">
            <div class="hg-field"><span class="hg-label">Agency Location</span><div class="hg-input">All Locations</div></div>
            <div class="hg-field"><span class="hg-label">Measured By</span><div class="hg-input">Policy Count</div></div>
          </div>
          <div class="hg-div"></div>
          <div class="hg-dualbar">
            <div class="hg-dualbar-lbl"><span>Individual <span style="opacity:.7;">(70%)</span></span><span>76%</span></div>
            <div class="hg-dualbar-track"><div class="hg-dualbar-fill" style="width:76%;background:var(--accent);"></div></div>
          </div>
          <div class="hg-dualbar">
            <div class="hg-dualbar-lbl"><span>Agency Goal <span style="opacity:.7;">(30%)</span></span><span>82%</span></div>
            <div class="hg-dualbar-track"><div class="hg-dualbar-fill" style="width:82%;background:var(--accent2);"></div></div>
          </div>
          <div class="hg-dualbar" style="margin-top:.5rem;padding-top:.5rem;border-top:1px dashed var(--border2);">
            <div class="hg-dualbar-lbl"><b>Combined score</b><b>78%</b></div>
            <div class="hg-dualbar-track"><div class="hg-dualbar-fill" style="width:78%;background:var(--gold);"></div></div>
          </div>
        </div>`,
      },
      {
        text: 'Choose a Reward Calculation: Proportional (a target % earned at 100% of goal, scaling up at the same rate into a stretch zone for exceeding goal, capped at a higher max %) or Threshold Tiers (fixed raise amounts unlocked at specific progress milestones — an all-or-nothing cliff instead of a smooth ramp).',
        html: `<div class="hg-panel">
          <span class="hg-label">Reward Calculation</span>
          <div class="hg-row" style="margin-bottom:.6rem;">
            <span class="hg-pill hg-new">Proportional</span><span class="hg-pill">Threshold Tiers</span>
          </div>
          <div class="hg-row">
            <div class="hg-field"><span class="hg-label">Target Raise %</span><div class="hg-input">3.00</div></div>
            <div class="hg-field"><span class="hg-label">Max Raise %</span><div class="hg-input">4.00</div></div>
          </div>
          <div class="hg-div"></div>
          <div class="hg-formula">3.00% target&nbsp; × &nbsp;78% of goal&nbsp; = &nbsp;<b>2.34% earned so far</b></div>
          <div style="font-size:10px;color:var(--muted);margin-top:.4rem;line-height:1.5;">Same rate continues past 100%: hit 120% of goal and the target's fully earned (3%) plus partway through the stretch zone — 3.6% total, capping at the 4% max around 133%.</div>
        </div>`,
      },
      {
        text: 'For comparison, here\'s what Threshold Tiers looks like instead — nothing below the first breakpoint, then a flat amount the instant you cross it. Simpler to explain, but doesn\'t distinguish 80% from 99%.',
        html: `<div class="hg-panel">
          <div class="hg-tierladder">
            <div class="hg-tier"><div class="hg-t">Below 80%</div><div class="hg-r">—</div></div>
            <div class="hg-tier hg-active"><div class="hg-t">80% to goal (at 78%→82%)</div><div class="hg-r">3%</div></div>
            <div class="hg-tier"><div class="hg-t">100% to goal</div><div class="hg-r">4%</div></div>
          </div>
          <div style="font-size:10px;color:var(--muted);">Someone at 79% earns the same $0 as someone at 0% — Proportional's continuous ramp is usually the better fit unless a hard cutoff is intentional.</div>
        </div>`,
      },
      {
        text: 'Optionally enable the Individual Gate and set a floor — if the agent’s own progress falls below it, the raise shows as 0% no matter what the rest of the formula would say. Matters most in Blended/Separate mode, where a strong agency number could otherwise paper over personal underperformance.',
        html: `<div class="hg-panel">
          <label class="hg-check" style="margin-bottom:.5rem;"><span class="hg-box hg-checked"></span>Individual Gate</label>
          <div class="hg-field" style="margin-bottom:.6rem;"><span class="hg-label">Floor %</span><div class="hg-input">50</div></div>
          <div class="hg-dualbar">
            <div class="hg-dualbar-lbl"><span>Individual progress <span style="opacity:.7;">(needs 50%)</span></span><span style="color:var(--danger);">40%</span></div>
            <div class="hg-dualbar-track"><div class="hg-dualbar-fill" style="width:40%;background:var(--danger);"></div></div>
          </div>
          <div class="hg-dualbar">
            <div class="hg-dualbar-lbl"><span>Agency Goal</span><span>95%</span></div>
            <div class="hg-dualbar-track"><div class="hg-dualbar-fill" style="width:95%;background:var(--accent2);"></div></div>
          </div>
          <div class="hg-div"></div>
          <div class="hg-danger">🚫 <b>Gated — $0 raise.</b> Blended score is 56.5% (would normally earn 1.70%), but individual progress (40%) is below the required 50% floor.</div>
        </div>`,
      },
      {
        text: 'Use the Public checkbox as usual to control visibility — the agent it belongs to can always see their own raise progress regardless — then Save.',
        html: `<div class="hg-panel">
          <div class="hg-row" style="gap:1rem;margin-bottom:.6rem;">
            <label class="hg-check"><span class="hg-box hg-off"></span>Public</label>
          </div>
          <span class="hg-btn">Save</span>
        </div>`,
      },
    ],
  },
  {
    id: 'agency-goals-setup',
    category: 'Goals & Growth',
    title: 'How to Set Agency Goals',
    description: 'Set goals for a single office (Location Goals) or for a whole team/the whole agency (Whole-Agency Goals) — and know which one to use.',
    visibility: ['owner'],
    steps: [
      { text: 'Boat Race has two different agency-goal tools. Location Goals track one physical office (policies + premium, monthly and annual). Whole-Agency Goals track any metric — including Handle Rate, Voicemail Count, and Missed Calls — for the whole account or a single team, and can be flagged as raise/bonus-eligible.' },
      {
        text: 'Location Goals: go to Account → Sales → Locations, click Edit next to the office, check "Office Goals: Enabled," then fill in Monthly and/or Annual Policy Goal and Premium Goal ($) — both optional and independent, with an optional per-product breakdown (Auto, Fire, Health, WL, UL, Term). Choose who can see it under "Visible in Goals Tab To," then Save.',
        html: `<div class="hg-panel">
          <div class="hg-path">Account <b>→</b> Sales <b>→</b> Locations <b>→</b> <b>West Linn</b> <b>→</b> Edit</div>
          <div class="hg-row">
            <div class="hg-field"><span class="hg-label">Monthly Policy Goal</span><div class="hg-input">100</div></div>
            <div class="hg-field"><span class="hg-label">Monthly Premium Goal ($)</span><div class="hg-input">100000</div></div>
          </div>
          <div class="hg-row">
            <div class="hg-field"><span class="hg-label">Annual Policy Goal</span><div class="hg-input hg-ph">e.g. 600</div></div>
            <div class="hg-field"><span class="hg-label">Annual Premium Goal ($)</span><div class="hg-input hg-ph">e.g. 1200000</div></div>
          </div>
          <div class="hg-div"></div>
          <span class="hg-label">Visible in Goals Tab To</span>
          <div class="hg-row" style="gap:1rem;">
            <label class="hg-check"><span class="hg-box hg-checked"></span>Everyone</label>
            <label class="hg-check"><span class="hg-box hg-off"></span>Captain</label>
          </div>
          <div class="hg-div"></div>
          <span class="hg-btn">Save</span>
        </div>`,
      },
      { text: 'This is the only Location Goals feature that connects to raises: an individual agent\'s raise-eligible goal can be set to Blended or Separate mode to weigh their own progress against a specific location\'s policy/premium goal (see the "Setting Up a Raise-Eligible Goal" guide above).' },
      {
        text: 'Whole-Agency & Team Goals: go to Account → Sales → Team and scroll to "Team & Agency Goals," just above the individual agent list. Pick a scope — Whole Agency, Sales Team, or Service Team — and click + Add.',
        html: `<div class="hg-panel">
          <div class="hg-path">Account <b>→</b> Sales <b>→</b> Team <b>→</b> Team &amp; Agency Goals</div>
          <div class="hg-scope-grid">
            <div class="hg-scope-card"><div class="hg-name">Whole Agency</div><div class="hg-sub">+ Add</div></div>
            <div class="hg-scope-card"><div class="hg-name">Sales Team</div><div class="hg-sub">+ Add</div></div>
            <div class="hg-scope-card"><div class="hg-name">Service Team</div><div class="hg-sub">+ Add</div></div>
          </div>
        </div>`,
      },
      {
        text: 'Choose a Period Type/Period (check Recurring to roll forward automatically), then check any Target Metrics that apply — alongside products/policies/premium, this is also where Handle Rate (higher is better), Voicemail Count, and Missed Calls (both lower is better) can be set, agency-scope only.',
        html: `<div class="hg-panel">
          <div class="hg-row">
            <div class="hg-field"><span class="hg-label">Period Type</span><div class="hg-input">Annual</div></div>
            <div class="hg-field"><span class="hg-label">Period</span><div class="hg-input">2026</div></div>
          </div>
          <div class="hg-div"></div>
          <span class="hg-label">Target Metrics</span><br>
          <span class="hg-pill">Total Policies</span><span class="hg-pill">Premium ($)</span>
          <span class="hg-pill hg-new">Handle Rate (%)</span><span class="hg-pill hg-new">Voicemail Count</span><span class="hg-pill hg-new">Missed Calls</span>
        </div>`,
      },
      {
        text: 'If Period Type is Annual, check "🎯 Raise-Eligible Goal" to configure this team/agency goal as a raise or bonus driver, same settings as an individual raise goal. Click Save — the goal shows up in Performance → Goals under its own scope heading, right alongside individual agents.',
        html: `<div class="hg-panel">
          <div class="hg-gold">
            <div class="hg-hdr">🎯 Raise-Eligible Goal</div>
            <div class="hg-body">Same Combination Mode / Reward Calculation / Individual Gate settings as an individual raise goal, applied to the whole team or agency.</div>
          </div>
          <div class="hg-div"></div>
          <span class="hg-btn">Save</span>
        </div>`,
      },
      { text: 'Note: a team/agency goal earns its own raise or bonus independently — there\'s currently no way to blend an individual\'s raise against their own team\'s or the agency\'s performance in one combined score.' },
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
            <div style="font-size:13px;margin-bottom:${(s.img || s.html) ? '.5rem' : '0'};">${escHtml(s.text)}</div>
            ${s.img ? `<img src="${escHtml(s.img)}" alt="" style="max-width:100%;border-radius:8px;border:1px solid var(--border2);display:block;">` : ''}
            ${s.html || ''}
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}
