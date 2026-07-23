// ── INIT ─────────────────────────────────────────────────────────────────────
// localStorage helpers — persistSession:false means Supabase never writes its own keys,
// so our br-* keys have no lock contention and work across tabs.
function _lsGet(k)    { try { return localStorage.getItem(k); }    catch(_) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); }        catch(_) {} }
function _lsRemove(k) { try { localStorage.removeItem(k); }        catch(_) {} }

async function init() {
  // Checklist is a public form — no auth needed. Short-circuit before any session
  // restore so a logged-in user navigating to the link still sees the form, not the app.
  const _initParams = new URLSearchParams(window.location.search);
  if (_initParams.get('checklist')) { loadChecklistScreen(_initParams.get('checklist')); return; }

  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();
    if (!r.ok || !cfg.supabaseUrl || !cfg.supabaseKey)
      throw new Error(cfg.error || 'Config unavailable — check Vercel env vars');

    // Enforce 8-hour session limit before restoring
    const sessionStart = _lsGet('br-session-start');
    if (sessionStart && Date.now() - parseInt(sessionStart) > 8 * 3600 * 1000) {
      _lsRemove('br-session');
      _lsRemove('br-session-start');
    }

    // persistSession:false — Supabase never touches localStorage, eliminating
    // startup token-refresh lock contention that caused signInWithPassword to hang
    _supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false }
    });

    // Synchronous handler only — checkAccountAndShow is deferred via setTimeout(0).
    // Running it inline causes a deadlock: setSession/signInWithPassword hold an internal
    // auth lock while notifying subscribers, and our Supabase queries need that same lock.
    _supabase.auth.onAuthStateChange((event, session) => {
      _session = session;
      if (event === 'PASSWORD_RECOVERY') { showScreen('recovery'); return; }

      if (!session) {
        // INITIAL_SESSION null fires during setSession() before session is established —
        // don't clear br-session or we erase the token mid-restore.
        if (event !== 'INITIAL_SESSION') {
          _lsRemove('br-session');
          _lsRemove('br-session-start');
        }
        _processingToken = null;
        showLoginOrSignup();
        return;
      }

      _lsSet('br-session', JSON.stringify({
        access_token:  session.access_token,
        refresh_token: session.refresh_token,
      }));
      // App already showing — just keep tokens updated, no screen change needed
      if (document.getElementById('screen-app').style.display !== 'none') return;
      if (_processingToken === session.access_token) return;
      _processingToken = session.access_token;

      setTimeout(async () => {
        try {
          await checkAccountAndShow(session);
        } finally {
          if (_processingToken === session.access_token) _processingToken = null;
        }
      }, 0);
    });

    // Restore session from localStorage (works across tabs and page refreshes)
    const saved = (() => { try { return JSON.parse(_lsGet('br-session') || 'null'); } catch(_) { return null; } })();
    if (saved?.access_token && saved?.refresh_token) {
      const { data, error } = await _supabase.auth.setSession({
        access_token:  saved.access_token,
        refresh_token: saved.refresh_token,
      });
      if (error || !data?.session) {
        _lsRemove('br-session');
        try { await _supabase.auth.signOut(); } catch(_) {}
        showScreen('login');
      }
      // On success: SIGNED_IN or TOKEN_REFRESHED already fired above,
      // _processingToken is set, setTimeout(0) will call checkAccountAndShow
      // after setSession releases its lock. No direct call needed here.
    } else {
      showLoginOrSignup();
    }
  } catch(e) {
    showLoginOrSignup();
    showMsg('li-msg', 'Init error: ' + e.message);
  }
}

// ── AUTH HELPERS ─────────────────────────────────────────────────────────────
function showScreen(name) {
  ['login','signup','forgot','recovery','app','invite','checklist'].forEach(s => {
    const el = document.getElementById('screen-' + s);
    if (el) el.style.display = (s === name) ? (s === 'app' ? 'block' : 'flex') : 'none';
  });
  if (name === 'login') {
    const msg = document.getElementById('li-msg');
    if (msg) msg.style.display = 'none';
  }
}

function showLoginOrSignup() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('invite'))    { loadInviteScreen(params.get('invite')); return; }
  if (params.get('checklist')) { loadChecklistScreen(params.get('checklist')); return; }
  const signup = params.get('signup') === 'true';
  showScreen(signup ? 'signup' : 'login');
  if (signup) {
    const plan = params.get('plan');
    const sel  = document.getElementById('su-plan');
    if (sel && plan && ['basic','pro','premium'].includes(plan)) sel.value = plan;
  }
}

function showMsg(id, text, type='err') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'auth-msg ' + type;
  el.style.display = 'block';
}

function authHeaders() {
  if (!_session) return {};
  return { 'Authorization': 'Bearer ' + _session.access_token };
}

function scrollAndPulse(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('deep-link-pulse');
  void el.offsetWidth; // force reflow so animation restarts
  el.classList.add('deep-link-pulse');
  setTimeout(() => el.classList.remove('deep-link-pulse'), 2100);
}

async function checkAccountAndShow(session) {
  console.log('[br] checkAccountAndShow: start, user.id=', session?.user?.id ?? 'MISSING');
  try {
    _userId    = session.user.id;
    _userEmail = session.user.email;

    const { data: acct } = await _supabase
      .from('accounts')
      .select('*')
      .eq('user_id', _userId)
      .single();

    if (acct) {
      _dataUserId  = _userId;
      _isAdmin        = acct.is_admin || false;
      _acctStatus     = acct.status   || 'trial';
      _currentPlan    = acct.plan     || 'basic';
      _columnMap      = acct.sales_column_map || {};
      _analysisAt     = acct.ai_analysis_at   || null;
      _hasSalesAddon  = acct.has_sales_addon  || false;
      _leadAnalysisAt         = acct.lead_analysis_at       || null;
      _hasLeadAnalysisAddon   = acct.has_lead_analysis_addon || false;
      _memberAnalysisAgents      = acct.member_analysis_agents       || [];
      _memberAnalysisAt          = acct.member_analysis_at           || null;
      _memberAnalysisAgentsSetAt = acct.member_analysis_agents_set_at || null;
      _hasMemberAnalysis         = acct.has_member_analysis          || false;
      _memberAnalysisCount       = acct.member_analysis_count        || 0;
      _creditWaived              = acct.credit_waived                || false;
      _memberHoursData           = acct.member_hours_data?.periods   || [];
      _salesEntryMode = acct.sales_entry_mode || 'upload';
      _checklistToken = acct.checklist_token  || null;
      if (_acctStatus === 'trial' && acct.trial_ends_at) {
        if (new Date(acct.trial_ends_at) < new Date()) {
          _acctStatus   = 'past_due';
          _trialExpired = true;
        }
      }
    } else {
      // No account row — check if this user is an invited team member
      const { data: member } = await _supabase
        .from('account_members')
        .select('owner_user_id, role, custom_tabs, status, roster_agent_id')
        .eq('member_user_id', _userId)
        .eq('status', 'active')
        .single();
      if (member) {
        _isMember         = true;
        _memberRole       = member.role;
        _memberCustomTabs = member.custom_tabs || [];
        _ownerUserId      = member.owner_user_id;
        _memberAgentId    = member.roster_agent_id || null;
        _dataUserId       = _ownerUserId;
        const { data: ownerAcct } = await _supabase
          .from('accounts')
          .select('company_name, plan, status, trial_ends_at, has_sales_addon, has_commissions_addon, has_lead_analysis_addon, sales_entry_mode, is_admin, self_report_config, ai_analysis_at, lead_analysis_at, has_member_analysis, member_analysis_agents, member_analysis_at, member_analysis_agents_set_at, member_analysis_count, member_hours_data')
          .eq('user_id', _ownerUserId)
          .single();
        if (ownerAcct) {
          _ownerCompany           = ownerAcct.company_name           || '';
          _currentPlan            = ownerAcct.plan                   || 'basic';
          _acctStatus             = ownerAcct.status                 || 'trial';
          _hasSalesAddon          = ownerAcct.has_sales_addon || ownerAcct.is_admin || false;
          _hasCommissionsAddon    = ownerAcct.has_commissions_addon  || false;
          _salesEntryMode         = ownerAcct.sales_entry_mode       || 'upload';
          _selfReportConfig       = ownerAcct.self_report_config     || {};
          _analysisAt             = ownerAcct.ai_analysis_at         || null;
          _leadAnalysisAt         = ownerAcct.lead_analysis_at        || null;
          _hasLeadAnalysisAddon   = ownerAcct.has_lead_analysis_addon || false;
          _hasMemberAnalysis           = ownerAcct.has_member_analysis           || false;
          _memberAnalysisAgents        = ownerAcct.member_analysis_agents        || [];
          _memberAnalysisAt            = ownerAcct.member_analysis_at            || null;
          _memberAnalysisAgentsSetAt   = ownerAcct.member_analysis_agents_set_at || null;
          _memberAnalysisCount         = ownerAcct.member_analysis_count         || 0;
          _memberHoursData             = ownerAcct.member_hours_data?.periods    || [];
          if (_acctStatus === 'trial' && ownerAcct.trial_ends_at && new Date(ownerAcct.trial_ends_at) < new Date()) {
            _acctStatus = 'past_due'; _trialExpired = true;
          }
        }
      } else {
        showScreen('login');
        showMsg('li-msg', 'No account found. Please sign up or use a valid invite link.');
        return;
      }
    }

    // Load managed subordinates for captains/COs
    if (_isMember && ['captain','chief_officer'].includes(_memberRole)) {
      try {
        const { data: myMemberRow } = await _supabase
          .from('account_members')
          .select('id')
          .eq('member_user_id', _userId)
          .eq('status', 'active')
          .single();
        if (myMemberRow) {
          const { data: subordinates } = await _supabase
            .from('account_members')
            .select('id, roster_agent_id')
            .eq('owner_user_id', _ownerUserId)
            .eq('managed_by', myMemberRow.id)
            .eq('status', 'active');
          if (subordinates?.length) {
            _managedMemberIds = subordinates.map(s => s.id);
            _managedAgentIds  = subordinates.map(s => s.roster_agent_id).filter(Boolean);
          }
        }
      } catch(_) { /* managed_by column may not exist yet */ }
    }

    // Load add-on config for owners, captain/chief_officer members, and self-reporting members
    if (!_isMember || ['captain', 'chief_officer'].includes(_memberRole) || _selfReportConfig.activities_enabled || _selfReportConfig.sales_enabled) {
      await loadAddonConfig().catch(e => console.error('loadAddonConfig:', e));
    }
    // Goals load for every user — bosun/custom members need to see public goals on race tab
    loadAgentGoals().catch(() => {});

    showScreen('app');
    document.getElementById('user-info').textContent = _isMember
      ? (_ownerCompany ? `${_ownerCompany} · ${_memberRole.replace('_',' ')}` : _userEmail)
      : _userEmail;

    // Handle return from Stripe Checkout
    const _urlParams = new URLSearchParams(window.location.search);
    if (_urlParams.get('billing') === 'success') {
      history.replaceState({}, '', '/app');
      setTimeout(() => {
        const msg = document.getElementById('ac-plan-msg');
        if (msg) { msg.style.display='block'; msg.style.color='var(--accent2)'; msg.textContent='Payment successful! Your subscription is now active.'; setTimeout(()=>{msg.style.display='none';},8000); }
      }, 800);
    } else if (_urlParams.get('billing') === 'cancel') {
      history.replaceState({}, '', '/app');
    } else if (_urlParams.get('addon') === 'success') {
      history.replaceState({}, '', '/app');
      _hasSalesAddon = true;
      setTimeout(() => {
        const msg = document.getElementById('addon-upsell-msg');
        if (msg) { msg.style.display='block'; msg.style.color='var(--accent2)'; msg.textContent='Sales Tracking add-on activated!'; }
        loadAddonConfig().then(() => renderManageTabMode()).catch(() => {});
      }, 800);
    } else if (_urlParams.get('addon') === 'cancel') {
      history.replaceState({}, '', '/app');
    } else if (_urlParams.get('addon') === 'commissions_success') {
      history.replaceState({}, '', '/app');
      _hasCommissionsAddon = true;
      setTimeout(() => {
        const msg = document.getElementById('commissions-addon-upsell-msg');
        if (msg) { msg.style.display='block'; msg.style.color='var(--accent2)'; msg.textContent='Commissions add-on activated!'; }
        loadAccountTab().catch(() => {});
      }, 800);
    } else if (_urlParams.get('addon') === 'commissions_cancel') {
      history.replaceState({}, '', '/app');
    } else if (_urlParams.get('addon') === 'lead_analysis_success') {
      history.replaceState({}, '', '/app');
      _hasLeadAnalysisAddon = true;
      setTimeout(() => {
        const msg = document.getElementById('lead-analysis-addon-upsell-msg');
        if (msg) { msg.style.display='block'; msg.style.color='var(--accent2)'; msg.textContent='Lead Source Analysis add-on activated!'; }
        loadAccountTab().catch(() => {});
      }, 800);
    } else if (_urlParams.get('addon') === 'lead_analysis_cancel') {
      history.replaceState({}, '', '/app');
    } else if (_urlParams.get('member_analysis') === 'success') {
      history.replaceState({}, '', '/app');
      const maCount = Math.max(1, parseInt(_urlParams.get('ma_count')) || 1);
      fetch('/api/member-analysis-checkout', {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', count: maCount }),
      }).then(() => {
        _hasMemberAnalysis   = true;
        _memberAnalysisCount = maCount;
      }).catch(() => {});
    } else if (_urlParams.get('member_analysis') === 'cancel') {
      history.replaceState({}, '', '/app');
    } else if (_urlParams.get('billing') === 'credit_success') {
      history.replaceState({}, '', '/app');
      const addedAmt = parseFloat(_urlParams.get('amount')) || 0;
      setTimeout(async () => {
        await fetchAnalysisCredits();
        const el = document.getElementById('credit-balance-display');
        if (el) { el.style.color = 'var(--accent2)'; setTimeout(() => { el.style.color = 'var(--accent)'; }, 3000); }
        if (addedAmt) {
          showInlineMsg('credit-wallet-msg', `$${addedAmt.toFixed(2)} added to your balance!`, 'ok');
        }
      }, 800);
    } else if (_urlParams.get('billing') === 'credit_cancel') {
      history.replaceState({}, '', '/app');
    }

    const banner = document.getElementById('restrict-banner');
    const msg    = document.getElementById('restrict-msg');

    // Members are never locked out — their access follows the owner's account status
    const isLocked = !_isMember && (_trialExpired || _acctStatus === 'past_due' || _acctStatus === 'cancelled');

    if (isLocked) {
      document.querySelectorAll('.tab').forEach(t => {
        const isAccount = (t.getAttribute('onclick') || '').includes("'account'");
        t.style.display = isAccount ? '' : 'none';
      });
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
      const acctTab = document.getElementById('tab-account');
      if (acctTab) acctTab.style.display = 'block';
      const acctBtn = document.querySelector('.tab[onclick*="\'account\'"]');
      if (acctBtn) acctBtn.classList.add('active');
      banner.style.display = 'flex';
      msg.textContent = _acctStatus === 'cancelled'
        ? 'Your subscription has been cancelled. Go to Account → Billing to resubscribe.'
        : _acctStatus === 'past_due'
        ? 'Your payment is past due. Go to Account → Billing to update your payment method.'
        : 'Your trial has expired. Go to Account → Billing to subscribe.';
      await loadAccountTab();
      showAccountSubTab('billing');
    } else {
      banner.style.display = 'none';
      if (_isMember) {
        applyMemberTabGating();
      } else {
        if (_isAdmin) document.getElementById('adminTab').style.display = '';
        const isPremium = acct && acct.plan === 'premium' && !isLocked && _acctStatus !== 'trial';
        const showAnalysis = isPremium || _isAdmin || _acctStatus === 'trial' || (!isLocked && _acctStatus !== 'trial');
        document.getElementById('analysisTab').style.display = showAnalysis ? '' : 'none';
        buildColumnMapUI();
      }
    }
  } catch(e) {
    showScreen('login');
    showMsg('li-msg', 'Sign-in error: ' + e.message);
    return;
  }

  // 8-hour auto-logout
  if (!_lsGet('br-session-start')) _lsSet('br-session-start', Date.now().toString());
  const _elapsed   = Date.now() - parseInt(_lsGet('br-session-start') || '0');
  const _remaining = Math.max(0, 8 * 3600 * 1000 - _elapsed);
  if (_remaining > 0) setTimeout(handleSignOut, _remaining);

  await loadRaceData().catch(e => console.error('loadRaceData:', e));
  await loadHistory().catch(e => console.error('loadHistory:', e));
  if (_isAdmin || (['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus))) await loadPerf();
  renderManageTabMode();
  if (_isMember && _memberAgentId) loadQuickCountWidget().catch(() => {});
}

// ── LOGIN / SIGNUP / AUTH ────────────────────────────────────────────────────
async function handleLogin() {
  if (!_supabase) return showMsg('li-msg', 'Still connecting — please try again in a moment.');
  const email = document.getElementById('li-email').value.trim();
  const pass  = document.getElementById('li-pass').value;
  if (!email || !pass) return showMsg('li-msg', 'Email and password are required.');
  const btn = document.querySelector('#screen-login .auth-btn');
  if (btn) btn.disabled = true;
  showMsg('li-msg', 'Signing in…', 'ok');
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('__timeout__')), 15000)
    );
    const { error } = await Promise.race([
      _supabase.auth.signInWithPassword({ email, password: pass }),
      timeout,
    ]);
    if (error) showMsg('li-msg', error.message);
    else showMsg('li-msg', 'Authenticated — loading your dashboard…', 'ok');
  } catch(e) {
    if (e.message === '__timeout__') {
      showMsg('li-msg', 'Sign-in timed out — please try again.');
    } else {
      showMsg('li-msg', 'Connection error: ' + e.message);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleSignup() {
  const company  = document.getElementById('su-company').value.trim();
  const contact  = document.getElementById('su-contact').value.trim();
  const email    = document.getElementById('su-email').value.trim();
  const phone    = document.getElementById('su-phone').value.trim();
  const agents   = parseInt(document.getElementById('su-agents').value) || 1;
  const plan     = document.getElementById('su-plan').value;
  const referral = document.getElementById('su-referral').value.trim();
  const pass     = document.getElementById('su-pass').value;

  if (!company || !contact || !email || !pass) return showMsg('su-msg', 'Please fill in all required fields.');
  if (pass.length < 8) return showMsg('su-msg', 'Password must be at least 8 characters.');

  const btn = document.querySelector('#screen-signup .auth-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, company_name: company, contact_name: contact, phone, plan, agent_count: agents, referral_source: referral }),
    });
    const result = await res.json();
    if (!res.ok) {
      if (result.error === 'already_exists') {
        return showMsg('su-msg',
          'An account with this email already exists. <button class="auth-link" onclick="showScreen(\'login\')" style="font-size:inherit;display:inline;">Sign in here</button>.');
      }
      return showMsg('su-msg', result.error || 'Signup failed. Please try again.');
    }
    showMsg('su-msg', 'Account created! Taking you to sign in…', 'ok');
    setTimeout(() => showScreen('login'), 2000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleForgotPassword() {
  const email = document.getElementById('fp-email').value.trim();
  if (!email) return showMsg('fp-msg', 'Please enter your email.');
  const { error } = await _supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/app'
  });
  if (error) return showMsg('fp-msg', error.message);
  showMsg('fp-msg', 'Reset link sent! Check your email.', 'ok');
}

async function handlePasswordReset() {
  const p1 = document.getElementById('rc-pass').value;
  const p2 = document.getElementById('rc-pass2').value;
  if (!p1 || p1.length < 8) return showMsg('rc-msg', 'Password must be at least 8 characters.');
  if (p1 !== p2) return showMsg('rc-msg', 'Passwords do not match.');
  const { error } = await _supabase.auth.updateUser({ password: p1 });
  if (error) return showMsg('rc-msg', error.message);
  showMsg('rc-msg', 'Password updated! Redirecting…', 'ok');
  setTimeout(() => showScreen('login'), 1800);
}

async function handleSignOut() {
  try { await _supabase.auth.signOut(); } catch(e) { console.warn('signOut error:', e); }
  _lsRemove('br-session');
  _lsRemove('br-session-start');
  _userId = _userEmail = null;
  _isAdmin = false;
  _processingToken = null;
  _acctStatus = 'trial';
  _trialExpired = false;
  _currentPlan = 'basic';
  _selectedPlan = null;
  _columnMap = {};
  CAT_LABELS = { deposit:'Deposit', other:'Other', other2:'Other 2', other3:'Other 3', other4:'Other 4', other5:'Other 5' };
  _perfData = null;
  _adminRows = [];
  _analysisAt = null;
  _isMember = false; _memberRole = null; _memberCustomTabs = []; _memberAgentId = null;
  _ownerUserId = null; _ownerCompany = ''; _dataUserId = null;
  _uploadInProgress = false;
  document.getElementById('ul-calls').innerHTML = '';
  document.getElementById('ul-sales').innerHTML = '';
  document.getElementById('last-upload-time').textContent = '—';
  showScreen('login');
}

// ── TABS ──────────────────────────────────────────────────────────────────────
function showAccountSubTab(name, btn, targetId) {
  document.querySelectorAll('#tab-account .acct-pane').forEach(p => p.style.display = 'none');
  document.querySelectorAll('#acct-subtab-nav .acct-stab').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('acct-pane-' + name);
  if (pane) pane.style.display = '';
  const activeBtn = btn || document.querySelector(`#acct-subtab-nav [data-pane="${name}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  if (name === 'help') renderHelpTab();
  if (targetId) setTimeout(() => scrollAndPulse(targetId), 200);
}

function showSalesSubTab(name, btn) {
  ['team','checklist','products','locations','commissions','bonus','access'].forEach(n => {
    const p = document.getElementById('sales-sub-' + n);
    if (p) p.style.display = n === name ? '' : 'none';
  });
  document.querySelectorAll('#sales-pane-content .acct-stab').forEach(b => b.classList.remove('active'));
  const activeBtn = btn || document.getElementById('sales-stab-' + name);
  if (activeBtn) activeBtn.classList.add('active');
  if (name === 'commissions') { renderCommissionStructuresList(); renderBankConfigFields(); }
  if (name === 'bonus') initBonusSubTab();
  if (name === 'access') renderSelfReportSettings();
}

// Deep-link into a specific sales sub-tab and optionally pulse a target element.
// Use instead of goToAccountTab('sales',...) when the target lives inside a sub-tab.
function goToSalesSubTab(subTab, targetId) {
  const acctBtn = document.querySelector('.tab[onclick*="account"]');
  showTab('account', acctBtn);
  showAccountSubTab('sales');
  showSalesSubTab(subTab);
  if (targetId) setTimeout(() => scrollAndPulse(targetId), 250);
}

function showManageSubTab(name, btn) {
  // Only 'upload' remains in Manage tab; Sales Log + Sales Performance moved to Performance tab
}

function showPerfSubTab(name, btn) {
  ['callperf','saleslog','salesperf','commissions','goals','chargebacks'].forEach(n => {
    const p = document.getElementById('perf-sub-' + n);
    if (p) p.style.display = n === name ? '' : 'none';
  });
  document.querySelectorAll('#tab-perf .acct-stab').forEach(b => b.classList.remove('active'));
  const activeBtn = btn || document.getElementById('perf-stab-' + name);
  if (activeBtn) activeBtn.classList.add('active');

  if (name === 'callperf') {
    const perfFullAccess = _isAdmin || (['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
    if (!perfFullAccess) {
      document.getElementById('perf-trial-teaser').style.display = '';
      document.getElementById('perf-table-panel').style.display  = 'none';
      document.getElementById('heatmap-panel').style.display     = 'none';
      document.getElementById('heatmap-upsell').style.display    = 'none';
      return;
    }
    document.getElementById('perf-trial-teaser').style.display = 'none';
    document.getElementById('perf-table-panel').style.display  = '';
    loadPerf();
    return;
  }

  if (name === 'saleslog' || name === 'salesperf') {
    // Members always get the sales log (scoped to their own entries server-side)
    const hasSales = _hasSalesAddon || _isAdmin || (_isMember && name === 'saleslog');
    const teaser  = document.getElementById('perf-' + name + '-teaser');
    const content = document.getElementById('perf-' + name + '-content');
    if (teaser)  teaser.style.display  = hasSales ? 'none' : '';
    if (content) content.style.display = hasSales ? '' : 'none';
    if (!hasSales) {
      if (name === 'salesperf') loadBasicSalesBreakdown().catch(() => {});
      return;
    }
    if (name === 'saleslog')  loadChecklistSubmissions();
    if (name === 'salesperf') { initSalesPerf().then(() => loadBasicSalesBreakdown('sales-overview-bottom').catch(() => {})); }
    return;
  }

  if (name === 'commissions') {
    const hasComm   = _hasCommissionsAddon || _isAdmin;
    const teaser    = document.getElementById('perf-commissions-teaser');
    const content   = document.getElementById('perf-commissions-content');
    if (teaser)  teaser.style.display  = hasComm ? 'none' : '';
    if (content) content.style.display = hasComm ? '' : 'none';
    if (!hasComm) return;
    loadCommissions();
  }

  if (name === 'goals') loadGoalsTab();

  if (name === 'chargebacks') {
    const hasSales = _hasSalesAddon || _isAdmin;
    const teaser  = document.getElementById('perf-chargebacks-teaser');
    const content = document.getElementById('perf-chargebacks-content');
    if (teaser)  teaser.style.display  = hasSales ? 'none' : '';
    if (content) content.style.display = hasSales ? '' : 'none';
    if (hasSales) loadChargebackReport();
  }
}

function goToAccountTab(pane, targetId) {
  const btn = document.querySelector('.tab[onclick*="account"]');
  showTab('account', btn);
  if (pane) showAccountSubTab(pane);
  if (targetId) setTimeout(() => scrollAndPulse(targetId), 200);
}

function _startRaceAutoRefresh() {
  clearInterval(_raceAutoRefreshTimer);
  _raceAutoRefreshTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') loadRaceData();
  }, 10 * 60 * 1000); // 10 minutes
}

function _stopRaceAutoRefresh() {
  clearInterval(_raceAutoRefreshTimer);
  _raceAutoRefreshTimer = null;
}

function showTab(name, btn) {
  if (_trialExpired && name !== 'account') return;
  if (_isMember && name !== 'account' && !getAllowedTabs().includes(name)) return;
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.style.display = 'block';
  if (btn) btn.classList.add('active');
  if (name === 'race') { loadRaceData(); _startRaceAutoRefresh(); }
  else _stopRaceAutoRefresh();
  if (name === 'account') loadAccountTab();
  if (name === 'adminpanel') { loadAdminPanel(); loadAccessLog(); }
  if (name === 'perf') {
    _applyPerfMemberGating();
    const memberLimited = _isMember && !['captain','chief_officer'].includes(_memberRole);
    showPerfSubTab(memberLimited ? 'chargebacks' : 'callperf');
  }
  if (name === 'history') loadHistory();
  if (name === 'analysis') {
    const analysisFullAccess = _isAdmin || (_currentPlan === 'premium' && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
    if (!analysisFullAccess) { renderAnalysisTrialTeaser(); return; }
    document.getElementById('analysis-charts-panel').style.display = '';
    document.getElementById('analysis-refresh-btn').style.display = '';
    updateAnalysisBtn();
    displayCachedAnalysis();
    updateMemberAnalysisBtn();
    displayCachedMemberAnalysis();
  }
}

