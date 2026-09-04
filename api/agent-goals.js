import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  computeMonthsElapsed, computeIndividualProgressPct, computeAgencyProgressPct,
  computeCombinedProgressPct, gatePassed, computeProportionalReward,
  computeThresholdReward, sanitizeRaiseConfig, annualizedPct, colorForYtd, colorForAnnualized,
  ALL_LOCATIONS_SENTINEL, WHOLE_AGENCY_GOAL_SENTINEL,
} from './_lib/raise-calc.js';

// A raise goal must be annual, or monthly AND recurring — a one-off,
// non-recurring monthly goal only ever covers a single already-past-or-
// current period, so there's no ongoing pace to track a raise against.
function isRaiseEligiblePeriod(periodType, isRecurring) {
  return periodType === 'annual' || (periodType === 'monthly' && !!isRecurring);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const WRITE_ROLES = ['captain', 'chief_officer'];
const POLICY_PRODUCTS = ['wl', 'ul', 'term', 'health', 'auto', 'fire'];

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_ABBR  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Team/agency goals — see CLAUDE.md "Call-Metric Goals" for the full design.
// A goal applies to more than one agent by using one of these sentinel
// strings as agent_id instead of a real roster agent_id, on an otherwise
// ordinary agent_goals row (same mechanism the '__unlinked_member__' sentinel
// below already uses for a different fail-closed purpose).
const KNOWN_SENTINELS = ['__agency__', '__team_sales__', '__team_service__'];
const TEAM_SENTINEL_RE = /^__team_(sales|service)__$/;

// voicemail/missed calls carry no agent (or team) attribution anywhere in
// call_log by design — a missed/voicemail call never reached anyone, so
// there's nothing to attribute it to. Only a whole-account pooled total is
// ever real (confirmed against api/perf.js's own Call Performance table,
// which hardcodes per-agent VM/Missed to 0 and only ever shows the true
// count on a separate account-wide "TEAM TOTAL" row). handle_rate depends on
// both, so all 3 call metrics are agency-scope-only. Fixed 2026-09-04 after
// an agency handle_rate goal was found showing 100% regardless of real
// performance — see CLAUDE.md "Call-Metric Goals" for the full incident.
const CALL_METRIC_KEYS = ['handle_rate', 'voicemail_count', 'missed_calls'];
function callMetricScopeError(agentId, goals) {
  if (agentId === '__agency__') return null;
  if (CALL_METRIC_KEYS.some(k => goals?.[k] !== undefined)) {
    return 'Handle Rate, Voicemail Count, and Missed Calls can only be set on a Whole Agency goal — call data has no per-agent or per-team attribution.';
  }
  return null;
}

// Only one goal can be pinned to the app header at a time — unset it on
// every other __agency__ goal so there's never ambiguity about which one the
// condensed header bar reflects. Never throws — a failure here just means an
// old pin might linger, not worth failing the actual save over.
async function unpinOtherHeaderGoals(dataUserId, keepGoalId) {
  await supabase.from('agent_goals').update({ show_in_header: false })
    .eq('user_id', dataUserId).eq('agent_id', '__agency__')
    .eq('show_in_header', true).neq('id', keepGoalId);
}

// Which real agent_ids a goal's agent_id resolves to: individual -> itself,
// team sentinel -> every roster agent on that team, agency sentinel -> null
// (no filter — every agent). rosterByTeam is built once per request/batch.
function resolveScopeAgentIds(goalAgentId, rosterByTeam) {
  if (goalAgentId === '__agency__') return null;
  const m = TEAM_SENTINEL_RE.exec(goalAgentId);
  if (m) return rosterByTeam[m[1]] || new Set();
  return new Set([goalAgentId]);
}

// Rejects an obviously-mistyped sentinel (e.g. '__team_saels__') outright —
// any '__'-prefixed value must exactly match a known sentinel. A real
// agent_id is checked against the roster only when one exists for this
// account; an account with no roster (no sales add-on) can't be validated
// against it, so it's allowed through rather than blocking goal creation —
// same graceful-degradation posture already used elsewhere in this app for
// roster-less accounts.
async function validateAgentId(agentId, dataUserId) {
  if (agentId.startsWith('__')) return KNOWN_SENTINELS.includes(agentId);
  const { data: rosterRows } = await supabase.from('agent_roster').select('agent_id').eq('user_id', dataUserId);
  if (!rosterRows || !rosterRows.length) return true;
  return rosterRows.some(r => r.agent_id === agentId);
}

const ENCRYPTION_KEY = process.env.CUSTOMER_ENCRYPTION_KEY
  ? Buffer.from(process.env.CUSTOMER_ENCRYPTION_KEY, 'hex')
  : null;

function decryptField(ciphertext) {
  if (!ciphertext) return null;
  if (!ENCRYPTION_KEY || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivB64, encB64, tagB64] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(Buffer.from(encB64, 'base64')) + decipher.final('utf8');
  } catch {
    return ciphertext;
  }
}

// Every "YYYY-MM" month key from pStart to pEnd inclusive (goal periods are
// always whole-month-aligned — see currentPeriodDates/getGoalPeriodOptions).
function monthsInRange(pStart, pEnd) {
  const months = [];
  let [y, m] = pStart.split('-').map(Number);
  const [endY, endM] = pEnd.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return months;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  let dataUserId = user.id;
  let isMember   = false;
  let memberRole = null;
  let memberAgentId = null;
  let isAdmin    = false;

  const { data: acctRow } = await supabase
    .from('accounts').select('is_admin').eq('user_id', user.id).single();

  if (!acctRow) {
    const { data: memberRow } = await supabase
      .from('account_members')
      .select('owner_user_id, role, roster_agent_id')
      .eq('member_user_id', user.id).eq('status', 'active').single();
    if (!memberRow) return res.status(403).json({ error: 'No account found' });
    dataUserId    = memberRow.owner_user_id;
    isMember      = true;
    memberRole    = memberRow.role;
    memberAgentId = memberRow.roster_agent_id;
  } else {
    isAdmin = !!acctRow.is_admin;
  }

  const canWrite = !isMember || WRITE_ROLES.includes(memberRole) || isAdmin;

  // GET — list goals
  if (req.method === 'GET') {
    let q = supabase.from('agent_goals')
      .select('*').eq('user_id', dataUserId)
      .order('period_start', { ascending: false });

    // Members who can't write (bosun, custom) only ever see their own agent's goals,
    // their own team's, and the whole agency's — gated on role via canWrite, not on
    // whether roster_agent_id happens to be set. Fails closed: an unlinked non-writer
    // matches a sentinel agent_id that can never exist, so they see nothing beyond the
    // agency until an owner links them (fixed 2026-08-05; extended 2026-09-03 for
    // team/agency sentinel goals — without this, GET would never return a
    // '__team_sales__'/'__agency__' row to a non-writer at all, regardless of is_public).
    if (isMember && !canWrite) {
      const scopeIds = [memberAgentId || '__unlinked_member__', '__agency__'];
      if (memberAgentId) {
        const { data: rosterRow } = await supabase.from('agent_roster')
          .select('team').eq('user_id', dataUserId).eq('agent_id', memberAgentId).maybeSingle();
        scopeIds.push(`__team_${rosterRow?.team || 'sales'}__`);
      }
      q = q.in('agent_id', scopeIds);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    if (req.query.withActuals === '1') {
      const refDate = req.query.refDate || null; // YYYY-MM — sets reference month for recurring goal actuals
      // Needed to compute "now" in the account's own local date (see currentPeriodDates)
      // rather than the server's raw UTC date. dataUserId is the DATA owner, not
      // necessarily the caller (a member's own accounts row has no timezone/is admin-only
      // fields relevant here) — always look up the owner's own row.
      const { data: ownerAcct } = await supabase.from('accounts').select('timezone').eq('user_id', dataUserId).single();
      const withActuals = await computeActuals(data || [], dataUserId, refDate, ownerAcct?.timezone);
      const withRaise   = await attachRaiseStatus(withActuals, dataUserId, ownerAcct?.timezone);
      attachHeaderProgress(withRaise, ownerAcct?.timezone);
      return res.status(200).json(withRaise);
    }
    return res.status(200).json(data || []);
  }

  // POST — create / upsert
  if (req.method === 'POST') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const { agent_id, period_type, period_label, period_start, period_end, goals, is_public, show_in_header } = req.body || {};
    if (!agent_id || !period_type || !period_label || !period_start || !period_end) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const valid = ['monthly', 'quarterly', 'semi_annual', 'annual'];
    if (!valid.includes(period_type)) return res.status(400).json({ error: 'Invalid period_type' });
    if (!(await validateAgentId(agent_id, dataUserId))) {
      return res.status(400).json({ error: 'Unknown agent_id' });
    }
    const cmError = callMetricScopeError(agent_id, goals);
    if (cmError) return res.status(400).json({ error: cmError });
    if (show_in_header && agent_id !== '__agency__') {
      return res.status(400).json({ error: 'Only a Whole Agency goal can be pinned to the header' });
    }

    const { is_recurring, is_raise_goal, raise_config } = req.body || {};
    // A raise goal is a flag on an ANNUAL goal, or a RECURRING MONTHLY one —
    // a one-off monthly goal has no ongoing pace to track a raise against, so
    // this is enforced here rather than left to the frontend to police on its own.
    if (is_raise_goal && !isRaiseEligiblePeriod(period_type, is_recurring)) {
      return res.status(400).json({ error: 'Raise-eligible goals must be annual, or monthly and recurring' });
    }
    let sanitizedRaiseConfig = {};
    if (is_raise_goal) {
      sanitizedRaiseConfig = sanitizeRaiseConfig(raise_config);
      const locId = sanitizedRaiseConfig.agency_location_id;
      if (sanitizedRaiseConfig.combination_mode !== 'individual' && locId && locId !== ALL_LOCATIONS_SENTINEL && locId !== WHOLE_AGENCY_GOAL_SENTINEL) {
        const { data: locRow } = await supabase.from('sales_locations')
          .select('id').eq('id', locId).eq('user_id', dataUserId).maybeSingle();
        if (!locRow) return res.status(400).json({ error: 'Agency location not found' });
      }
    }

    const upsertRow = {
      user_id: dataUserId,
      agent_id, period_type, period_label,
      period_start, period_end,
      goals: goals || {},
      is_public:      !!is_public,
      is_recurring:   !!is_recurring,
      is_raise_goal:  !!is_raise_goal,
      raise_config:   sanitizedRaiseConfig,
      show_in_header: !!show_in_header,
      updated_at: new Date().toISOString(),
    };
    let { data, error } = await supabase.from('agent_goals').upsert(upsertRow,
      { onConflict: 'user_id,agent_id,period_type,period_label' }).select().single();
    // Graceful degradation until goal-show-in-header-migration.sql has run —
    // an unknown column fails the WHOLE upsert, not just this field.
    if (error) {
      const { show_in_header: _drop, ...retryRow } = upsertRow;
      ({ data, error } = await supabase.from('agent_goals').upsert(retryRow,
        { onConflict: 'user_id,agent_id,period_type,period_label' }).select().single());
    }
    if (error) return res.status(500).json({ error: error.message });
    if (data?.show_in_header) await unpinOtherHeaderGoals(dataUserId, data.id);
    return res.status(200).json(data);
  }

  // PATCH — update fields
  if (req.method === 'PATCH') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const { id, goals, is_public, is_recurring, period_start, period_end, is_raise_goal, raise_config, show_in_header } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    let existingAgentId;
    if ((goals !== undefined && CALL_METRIC_KEYS.some(k => goals?.[k] !== undefined)) || show_in_header !== undefined) {
      const { data: existingGoal } = await supabase.from('agent_goals')
        .select('agent_id').eq('id', id).eq('user_id', dataUserId).single();
      existingAgentId = existingGoal?.agent_id;
      const cmError = callMetricScopeError(existingAgentId, goals);
      if (cmError) return res.status(400).json({ error: cmError });
    }
    if (show_in_header && existingAgentId !== '__agency__') {
      return res.status(400).json({ error: 'Only a Whole Agency goal can be pinned to the header' });
    }
    const update = { updated_at: new Date().toISOString() };
    if (goals          !== undefined) update.goals          = goals;
    if (is_public      !== undefined) update.is_public      = !!is_public;
    if (is_recurring   !== undefined) update.is_recurring   = !!is_recurring;
    if (show_in_header !== undefined) update.show_in_header = !!show_in_header;
    if (period_start)                 update.period_start   = period_start;
    if (period_end)                   update.period_end     = period_end;

    // period_type isn't itself editable via PATCH, so it has to be looked up
    // rather than trusted from the request body. Also needed whenever
    // is_recurring is being turned off, even if is_raise_goal isn't touched
    // this save — a monthly raise goal that stops being recurring is no
    // longer eligible, and leaving is_raise_goal:true would orphan an
    // invalid state that skipped this same validation on the way in.
    if (is_raise_goal !== undefined || is_recurring === false) {
      const { data: existingGoal } = await supabase.from('agent_goals')
        .select('period_type, is_recurring, is_raise_goal').eq('id', id).eq('user_id', dataUserId).single();
      const effectiveRecurring = is_recurring !== undefined ? !!is_recurring : existingGoal?.is_recurring;

      if (is_raise_goal !== undefined) {
        if (is_raise_goal) {
          if (!isRaiseEligiblePeriod(existingGoal?.period_type, effectiveRecurring)) {
            return res.status(400).json({ error: 'Raise-eligible goals must be annual, or monthly and recurring' });
          }
          const sanitizedRaiseConfig = sanitizeRaiseConfig(raise_config);
          const locId = sanitizedRaiseConfig.agency_location_id;
          if (sanitizedRaiseConfig.combination_mode !== 'individual' && locId && locId !== ALL_LOCATIONS_SENTINEL && locId !== WHOLE_AGENCY_GOAL_SENTINEL) {
            const { data: locRow } = await supabase.from('sales_locations')
              .select('id').eq('id', locId).eq('user_id', dataUserId).maybeSingle();
            if (!locRow) return res.status(400).json({ error: 'Agency location not found' });
          }
          update.is_raise_goal = true;
          update.raise_config  = sanitizedRaiseConfig;
        } else {
          update.is_raise_goal = false;
          update.raise_config  = {};
        }
      } else if (existingGoal?.is_raise_goal && !isRaiseEligiblePeriod(existingGoal.period_type, effectiveRecurring)) {
        // is_raise_goal wasn't part of this save, but turning off Recurring
        // just made an existing monthly raise goal invalid — clear it rather
        // than leave an orphaned is_raise_goal:true a fresh save could never
        // have produced.
        update.is_raise_goal = false;
        update.raise_config  = {};
      }
    }

    let { error } = await supabase.from('agent_goals')
      .update(update).eq('id', id).eq('user_id', dataUserId);
    // Graceful degradation until goal-show-in-header-migration.sql has run.
    if (error && update.show_in_header !== undefined) {
      const { show_in_header: _drop, ...retryUpdate } = update;
      ({ error } = await supabase.from('agent_goals').update(retryUpdate).eq('id', id).eq('user_id', dataUserId));
    }
    if (error) return res.status(500).json({ error: error.message });
    if (update.show_in_header) await unpinOtherHeaderGoals(dataUserId, id);
    return res.status(200).json({ success: true });
  }

  // DELETE
  if (req.method === 'DELETE') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase.from('agent_goals')
      .delete().eq('id', id).eq('user_id', dataUserId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function currentPeriodDates(periodType, refDateStr, timezone) {
  let yr, mo;
  if (refDateStr) {
    const parts = refDateStr.split('-').map(Number);
    yr = parts[0];
    mo = parts[1] - 1; // 0-indexed
  } else {
    // "Now" must be the account's LOCAL date, not the server's raw UTC date — every US
    // timezone lags UTC, so for several hours every day (roughly 4-5pm-midnight Pacific)
    // the server's UTC calendar date has already rolled to tomorrow while the account's
    // real business day/month hasn't ended yet. Near a period boundary (most obviously
    // the 1st of a month) this made a recurring goal's "current period" silently roll
    // over hours early, showing 0/target for a goal that was legitimately on pace the
    // entire time the actual local day/month was still in progress — reported as "Goals
    // aren't capturing the checked products" (the product-scope filtering was never the
    // problem; the date window computed for it was) (fixed 2026-09-01). Same
    // Intl.DateTimeFormat('en-CA', tz) technique already used by todayInTz/yesterdayInTz
    // in api/email-report.js — en-CA formats as YYYY-MM-DD directly, no parsing needed.
    const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date());
    const [ly, lm] = localToday.split('-').map(Number);
    yr = ly;
    mo = lm - 1; // 0-indexed
  }
  if (periodType === 'monthly') {
    const s = new Date(Date.UTC(yr, mo, 1)), e = new Date(Date.UTC(yr, mo + 1, 0));
    return { start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10) };
  }
  if (periodType === 'quarterly') {
    const q = Math.floor(mo / 3);
    const s = new Date(Date.UTC(yr, q*3, 1)), e = new Date(Date.UTC(yr, q*3+3, 0));
    return { start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10) };
  }
  if (periodType === 'semi_annual') {
    const h = mo < 6 ? 0 : 1;
    const s = new Date(Date.UTC(yr, h*6, 1)), e = new Date(Date.UTC(yr, h*6+6, 0));
    return { start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10) };
  }
  const s = `${yr}-01-01`, e = `${yr}-12-31`;
  return { start: s, end: e };
}

async function computeActuals(goals, dataUserId, refDateStr, timezone) {
  if (!goals.length) return goals;

  // Recurring goals use the reference period's date range for actuals
  const effective = goals.map(g => {
    if (!g.is_recurring) return g;
    const curr = currentPeriodDates(g.period_type, refDateStr, timezone);
    return { ...g, _eff_start: curr.start, _eff_end: curr.end };
  });

  const minStart = effective.reduce((m, g) => (g._eff_start||g.period_start) < m ? (g._eff_start||g.period_start) : m, effective[0]._eff_start||effective[0].period_start);
  const maxEnd   = effective.reduce((m, g) => (g._eff_end  ||g.period_end  ) > m ? (g._eff_end  ||g.period_end  ) : m, effective[0]._eff_end  ||effective[0].period_end  );

  // Team/agency goals aggregate across more than one agent_id — resolve the
  // account's roster-by-team once per request, reused for every goal's scope
  // resolution below (individual goals resolve to just themselves, unaffected).
  const needsRoster = effective.some(g => g.agent_id === '__agency__' || TEAM_SENTINEL_RE.test(g.agent_id));
  const rosterByTeam = { sales: new Set(), service: new Set() };
  if (needsRoster) {
    const { data: rosterRows } = await supabase.from('agent_roster').select('agent_id, team').eq('user_id', dataUserId);
    if (rosterRows && rosterRows.length) {
      for (const r of rosterRows) (rosterByTeam[r.team || 'sales'] ||= new Set()).add(r.agent_id);
    } else {
      // No roster (account without the sales add-on) — race_data.team carries the
      // same default-to-'sales' assumption already used everywhere else in the app.
      const { data: rdRows } = await supabase.from('race_data').select('agent_id, team').eq('user_id', dataUserId);
      for (const r of (rdRows || [])) (rosterByTeam[r.team || 'sales'] ||= new Set()).add(r.agent_id);
    }
  }

  const [salesRes, actRes] = await Promise.all([
    supabase.from('sales_log')
      .select('agent_id, product, written_premium, sale_date, is_cancelled, sale_weight')
      .eq('user_id', dataUserId)
      .gte('sale_date', minStart)
      .lte('sale_date', maxEnd),
    supabase.from('bonus_activities')
      .select('agent_id, activity_type_id, count, activity_date')
      .eq('user_id', dataUserId)
      .eq('status', 'approved')
      .gte('activity_date', minStart)
      .lte('activity_date', maxEnd),
  ]);

  const salesRows = (salesRes.data || []).filter(s => !s.is_cancelled);
  const actRows   = actRes.data || [];

  // Call-metric actuals (handle_rate/voicemail_count/missed_calls) need a
  // separate, potentially-expensive data source — only computed when at
  // least one goal in this batch actually tracks one of them.
  const needsCallMetrics = effective.some(g =>
    g.goals?.handle_rate !== undefined || g.goals?.voicemail_count !== undefined || g.goals?.missed_calls !== undefined
  );
  const callMetricsByGoal = needsCallMetrics
    ? await computeCallMetricActuals(effective, dataUserId, minStart, maxEnd)
    : {};

  return effective.map(goal => {
    const pStart   = goal._eff_start || goal.period_start;
    const pEnd     = goal._eff_end   || goal.period_end;
    const scopeIds = resolveScopeAgentIds(goal.agent_id, rosterByTeam);
    const inScope  = id => scopeIds === null || scopeIds.has(id);
    const agSales = salesRows.filter(s => inScope(s.agent_id) && s.sale_date >= pStart && s.sale_date <= pEnd);
    const agActs  = actRows.filter(a => inScope(a.agent_id) && a.activity_date >= pStart && a.activity_date <= pEnd);

    // Weighted by sale_weight (0.5 for either side of a split sale) rather than a flat
    // row count — matches the Race tab, Sales Performance, and the Daily Report (see
    // CLAUDE.md "Cross-report consistency"). A split sale is one real deal shared by two
    // agents; counting each side as a full 1 toward a policy goal double-credits it,
    // exactly the same bug already fixed everywhere else this got counted (fixed
    // 2026-09-01 — Goals was simply never included in that original reconciliation pass).
    const weightOf = s => s.sale_weight ?? 1;
    const actuals = {};
    for (const prod of POLICY_PRODUCTS) {
      if (goal.goals[prod] !== undefined) {
        actuals[prod] = agSales.filter(s => s.product === prod).reduce((sum, s) => sum + weightOf(s), 0);
      }
    }
    if (goal.goals.policies !== undefined) {
      actuals.policies = agSales.filter(s => POLICY_PRODUCTS.includes(s.product)).reduce((sum, s) => sum + weightOf(s), 0);
    }
    if (goal.goals.premium !== undefined) {
      actuals.premium = agSales.reduce((s, r) => s + (parseFloat(r.written_premium) || 0), 0);
    }
    for (const key of Object.keys(goal.goals)) {
      if (!key.startsWith('activity_')) continue;
      const typeId = key.replace('activity_', '');
      actuals[key] = agActs.filter(a => a.activity_type_id === typeId).reduce((s, a) => s + (a.count || 0), 0);
    }
    if (Array.isArray(goal.goals.combined_groups)) {
      for (const grp of goal.goals.combined_groups) {
        // type is only set on newer activity-combined groups; existing saved groups
        // predate this field and are always product groups — keep that the default.
        if (grp.type === 'activity') {
          actuals['combined_' + grp.id] = agActs.filter(a => (grp.activity_type_ids || []).includes(a.activity_type_id)).reduce((s, a) => s + (a.count || 0), 0);
          continue;
        }
        const grpSales = agSales.filter(s => (grp.products || []).includes(s.product));
        actuals['combined_' + grp.id] = grpSales.reduce((sum, s) => sum + weightOf(s), 0);
        // Premium target is independent of the policy-count target — only compute
        // this when the group actually has one set, same "either or both" shape
        // as the plain (non-combined) policies/premium fields.
        if (grp.target_premium) {
          actuals['combined_' + grp.id + '_premium'] = grpSales.reduce((sum, s) => sum + (parseFloat(s.written_premium) || 0), 0);
        }
      }
    }

    const cm = callMetricsByGoal[goal.id];
    let callMetricCoverage;
    if (cm) {
      if (goal.goals.handle_rate !== undefined) {
        const inbound = cm.answered + cm.missed + cm.voicemail;
        actuals.handle_rate = inbound > 0 ? Math.round(cm.answered / inbound * 100) : 0;
      }
      if (goal.goals.voicemail_count !== undefined) actuals.voicemail_count = cm.voicemail;
      if (goal.goals.missed_calls    !== undefined) actuals.missed_calls    = cm.missed;
      // Surfaced to the client so a goal spanning mostly-unarchived months
      // shows a visible caveat instead of a silently-incomplete number —
      // see computeCallMetricActuals for why a "missing" month can never
      // be recovered after the fact.
      if (cm.coverage.coveredMonths < cm.coverage.totalMonths) callMetricCoverage = cm.coverage;
    }

    return { ...goal, actuals, ...(callMetricCoverage ? { call_metric_coverage: callMetricCoverage } : {}) };
  });
}

// Aggregates whole-account answered/missed/voicemail counts per goal for the
// 3 call-metric keys, merging archived (historical_months, month-level) and
// live (call_log) data — call_log rows are hard-deleted on every Archive &
// Reset, so an annual goal's period will usually span several
// already-archived months plus the live one. Same merge strategy as
// api/perf.js's "Yearly Call Performance archive merge" fix (2026-09-01).
//
// Pooled account-wide, NOT per-agent — voicemail/missed calls carry no agent
// (or team) attribution anywhere in call_log by design (see CLAUDE.md
// "Call-Metric Goals"), so these 3 metrics are enforced agency-scope-only at
// save time (POST/PATCH, callMetricScopeError). historical_wins is per-agent
// and its own missed/voicemail columns are always 0 for the same underlying
// reason — historical_months is the correct source for archived months here,
// same table api/perf.js's Yearly merge already reads for its account-wide
// "TEAM TOTAL" row. Fixed 2026-09-04 after an agency handle_rate goal showed
// 100% regardless of real performance, traced to per-agent bucketing
// silently dropping every voicemail/missed row (empty agent_id decrypts to
// falsy and got skipped before ever being counted).
async function computeCallMetricActuals(goals, dataUserId, minStart, maxEnd) {
  const relevant = goals.filter(g =>
    g.agent_id === '__agency__' &&
    (g.goals?.handle_rate !== undefined || g.goals?.voicemail_count !== undefined || g.goals?.missed_calls !== undefined)
  );
  if (!relevant.length) return {};

  // mergedByMonth: "YYYY-MM" -> {answered,missed,voicemail}, pooled account-wide.
  const mergedByMonth = {};
  const addTo = (monthKey, v) => {
    if (!mergedByMonth[monthKey]) mergedByMonth[monthKey] = { answered: 0, missed: 0, voicemail: 0 };
    const t = mergedByMonth[monthKey];
    t.answered  += v.answered  || 0;
    t.missed    += v.missed    || 0;
    t.voicemail += v.voicemail || 0;
  };

  // The account's current (still-live, not-yet-archived) race month must
  // never be trusted from historical_months, even if a row for it exists —
  // an out-of-order upload or a partial/early archive attempt can leave a
  // stale or zeroed snapshot for the month that's still actively accumulating
  // real call_log data. Same root cause and same fix already applied to AI
  // Analysis (see CLAUDE.md "Current race month always uses live data") —
  // this function just never got the same guard when it was built. Reported
  // 2026-09-04 as "Sept shows 86%, but annual shows 100%": September's real,
  // nonzero missed/voicemail were being replaced by a stale zeroed
  // historical_months row the moment the annual aggregation pulled it in,
  // even though querying September alone (a different code path) correctly
  // went straight to live call_log and got the real number.
  const { data: raceCfgRows } = await supabase.from('race_config')
    .select('value').eq('user_id', dataUserId).eq('key', 'current_month').maybeSingle();
  const currentMonthKey = (() => {
    const parts = String(raceCfgRows?.value || '').trim().split(/\s+/);
    if (parts.length < 2) return null;
    let mi = MONTH_NAMES.findIndex(x => x.toLowerCase() === parts[0].toLowerCase());
    if (mi < 0) mi = MONTH_ABBR.findIndex(x => x.toLowerCase() === parts[0].toLowerCase());
    const yr = parseInt(parts[1], 10);
    return (mi < 0 || isNaN(yr)) ? null : `${yr}-${String(mi + 1).padStart(2, '0')}`;
  })();

  const { data: histRows } = await supabase.from('historical_months')
    .select('month, answered, missed, voicemail')
    .eq('user_id', dataUserId);
  const histMonthsCovered = new Set();
  for (const h of (histRows || [])) {
    const parts = String(h.month || '').trim().split(/\s+/);
    if (parts.length < 2) continue;
    let mi = MONTH_NAMES.findIndex(x => x.toLowerCase() === parts[0].toLowerCase());
    if (mi < 0) mi = MONTH_ABBR.findIndex(x => x.toLowerCase() === parts[0].toLowerCase());
    const yr = parseInt(parts[1], 10);
    if (mi < 0 || isNaN(yr)) continue;
    const monthKey = `${yr}-${String(mi + 1).padStart(2, '0')}`;
    if (monthKey === currentMonthKey) continue; // always re-derive the live month from call_log instead
    addTo(monthKey, { answered: h.answered, missed: h.missed, voicemail: h.voicemail });
    histMonthsCovered.add(monthKey);
  }

  // Only query live call_log for months historical_months doesn't already cover.
  const liveMonths = monthsInRange(minStart, maxEnd).filter(mo => !histMonthsCovered.has(mo));
  if (liveMonths.length) {
    const [ly, lm] = liveMonths[0].split('-').map(Number);
    const [hy, hm] = liveMonths[liveMonths.length - 1].split('-').map(Number);
    const liveFrom = `${ly}-${String(lm).padStart(2, '0')}-01`;
    const lastDay  = new Date(hy, hm, 0).getDate();
    const liveTo   = `${hy}-${String(hm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Account-wide counts, not per-agent — answered rows have a real agent_id
    // but it's irrelevant here (agency scope sums everyone regardless), and
    // missed/voicemail rows never have one to decrypt in the first place.
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase.from('call_log')
        .select('disposition, call_dt')
        .eq('user_id', dataUserId)
        .in('disposition', ['answered', 'missed', 'voicemail'])
        .gte('call_dt', liveFrom).lte('call_dt', liveTo)
        .order('hash', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || !data.length) break;
      for (const row of data) {
        const d = String(row.call_dt || '');
        if (d.length < 7) continue;
        const monthKey = d.slice(0, 7);
        addTo(monthKey, { [row.disposition]: 1 });
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // Only two things can ever supply a real number for a given month: an
  // archived historical_months row, or the account's current live race
  // month (queried fresh from call_log above). Any OTHER month in a goal's
  // period — never archived, and not currently live — has no data source
  // at all and silently contributes zero, exactly like a real zero would.
  // That's mathematically "correct" given what's in the database, but reads
  // as a real, non-obvious number (e.g. a misleadingly high handle_rate)
  // with no indication most of the period is actually just missing, not
  // genuinely zero. Reported live: "when I select annual it's only showing
  // this month's numbers" — call_log is hard-deleted on every Archive &
  // Reset (see CLAUDE.md), so a month that was never archived is a
  // permanent gap, not something a query can ever recover — the fix here is
  // to surface that gap explicitly rather than to keep searching for one.
  const result = {};
  for (const goal of relevant) {
    const pStart = goal._eff_start || goal.period_start;
    const pEnd   = goal._eff_end   || goal.period_end;
    let answered = 0, missed = 0, voicemail = 0;
    const monthsInPeriod  = monthsInRange(pStart, pEnd);
    const monthsCovered   = [];
    const monthsMissing   = [];
    for (const monthKey of monthsInPeriod) {
      const v = mergedByMonth[monthKey];
      if (v) {
        answered += v.answered; missed += v.missed; voicemail += v.voicemail;
        monthsCovered.push(monthKey);
      } else {
        monthsMissing.push(monthKey);
      }
    }
    result[goal.id] = {
      answered, missed, voicemail,
      coverage: { totalMonths: monthsInPeriod.length, coveredMonths: monthsCovered.length, missingMonths: monthsMissing },
    };
  }
  return result;
}

// Attaches a `raise_status` object to every goal flagged `is_raise_goal`.
// Mutates and returns the same array `computeActuals` already produced (its
// goals are fresh `{...goal, actuals}` objects per call, safe to extend here
// without touching anything else). Cheap bail-out when nothing is raise-flagged.
//
// Eligible periods: annual, or monthly AND recurring (isRaiseEligiblePeriod —
// enforced again here, not just at save time, in case a row was written
// before this rule existed or a bug elsewhere leaves one in an invalid state).
// Uses each goal's EFFECTIVE period (_eff_start/_eff_end, already computed by
// computeActuals for any recurring goal) rather than the raw stored
// period_start/period_end — for a recurring goal those drift apart after the
// first cycle (a monthly recurring goal's stored period_start stays pinned to
// whichever month it was first created; a recurring annual one, to whichever
// year). Using the raw columns here would have silently frozen "months
// elapsed" and the agency-location comparison window at the creation period
// forever — harmless in the annual case until a raise goal actually survives
// past its first year, but immediately and obviously wrong for the new
// monthly-recurring case, so fixed for both while adding the latter.
async function attachRaiseStatus(goals, dataUserId, timezone) {
  const raiseGoals = goals.filter(g => g.is_raise_goal && isRaiseEligiblePeriod(g.period_type, g.is_recurring));
  if (!raiseGoals.length) return goals;

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date());
  const periodOf = g => ({ start: g._eff_start || g.period_start, end: g._eff_end || g.period_end });

  // Agency locations (Blended/Separate modes) — dedupe by (location, period)
  // so a shared location+period pair is only fetched/aggregated once, not
  // once per goal. A monthly goal blends against that SAME month's sales and
  // the location's MONTHLY target columns (see computeAgencyProgressPct);
  // an annual goal still blends against the calendar year and the annual
  // target columns, exactly as before.
  const specificGoals = raiseGoals.filter(g =>
    g.raise_config?.agency_location_id &&
    g.raise_config.agency_location_id !== ALL_LOCATIONS_SENTINEL &&
    g.raise_config.agency_location_id !== WHOLE_AGENCY_GOAL_SENTINEL);
  const allLocGoals = raiseGoals.filter(g => g.raise_config?.agency_location_id === ALL_LOCATIONS_SENTINEL);

  // "Whole Agency Goal" — align an individual's raise with the agency's own
  // raise-eligible goal (Account → Sales → Team → Team & Agency Goals →
  // Whole Agency), NOT a sales_locations Office Goal. Matched by period_type
  // rather than exact period, since a recurring monthly individual goal
  // should compare against whatever the CURRENT recurring monthly whole-
  // agency goal is, not a frozen creation-time period. computeActuals()
  // already populated .actuals for every goal in this batch, including the
  // whole-agency one (it's just another agent_goals row), so its own
  // progress is computed by reusing computeIndividualProgressPct() directly
  // on it — the exact same "mean of actual/target ratios" math any goal
  // already gets, not a new formula.
  const wholeAgencyGoalByPeriodType = {};
  for (const g of raiseGoals) {
    if (g.agent_id === '__agency__' && !wholeAgencyGoalByPeriodType[g.period_type]) {
      wholeAgencyGoalByPeriodType[g.period_type] = g;
    }
  }

  const locKeyOf = g => `${g.raise_config.agency_location_id}|${periodOf(g).start}|${periodOf(g).end}`;
  const locationIds = [...new Set(specificGoals.map(g => g.raise_config.agency_location_id))];
  const locationById = {};
  const locationActualsByKey = {};

  if (locationIds.length) {
    const { data: locs } = await supabase.from('sales_locations')
      .select('id, name, goal_count, goal_premium, goal_count_annual, goal_premium_annual')
      .in('id', locationIds).eq('user_id', dataUserId);
    for (const loc of (locs || [])) locationById[loc.id] = loc;

    const uniqueKeys = [...new Set(specificGoals.map(locKeyOf))];
    for (const key of uniqueKeys) {
      const [locId, start, end] = key.split('|');
      const loc = locationById[locId];
      if (!loc) continue;
      const { data: rows } = await supabase.from('sales_log')
        .select('written_premium, sale_weight')
        .eq('user_id', dataUserId)
        .eq('location', loc.name)
        .eq('is_cancelled', false)
        .gte('sale_date', start).lte('sale_date', end);
      let count = 0, premium = 0;
      for (const r of (rows || [])) {
        count   += r.sale_weight ?? 1;
        premium += parseFloat(r.written_premium) || 0;
      }
      locationActualsByKey[key] = { count, premium };
    }
  }

  // "All Locations" — aggregate goal_count(_annual)/goal_premium(_annual)
  // across every goals-enabled location as the target, and every location's
  // sales account-wide (unfiltered by `location`) as the actual, for
  // whichever period(s) are actually referenced. Same "All Locations"
  // semantics js/sales-log.js's Sales Log scorecard already uses.
  const allLocTargetsByPeriodType = {};
  const allLocActualByPeriodKey = {};
  if (allLocGoals.length) {
    const { data: allLocs } = await supabase.from('sales_locations')
      .select('goal_count, goal_premium, goal_count_annual, goal_premium_annual, goals_enabled')
      .eq('user_id', dataUserId);
    const enabled = (allLocs || []).filter(l => l.goals_enabled);
    allLocTargetsByPeriodType.monthly = {
      goal_count:   enabled.reduce((s, l) => s + (Number(l.goal_count)   || 0), 0),
      goal_premium: enabled.reduce((s, l) => s + (Number(l.goal_premium) || 0), 0),
    };
    allLocTargetsByPeriodType.annual = {
      goal_count_annual:   enabled.reduce((s, l) => s + (Number(l.goal_count_annual)   || 0), 0),
      goal_premium_annual: enabled.reduce((s, l) => s + (Number(l.goal_premium_annual) || 0), 0),
    };

    const uniquePeriods = [...new Set(allLocGoals.map(g => { const p = periodOf(g); return `${p.start}|${p.end}`; }))];
    for (const key of uniquePeriods) {
      const [start, end] = key.split('|');
      const { data: rows } = await supabase.from('sales_log')
        .select('written_premium, sale_weight')
        .eq('user_id', dataUserId)
        .eq('is_cancelled', false)
        .gte('sale_date', start).lte('sale_date', end);
      let count = 0, premium = 0;
      for (const r of (rows || [])) {
        count   += r.sale_weight ?? 1;
        premium += parseFloat(r.written_premium) || 0;
      }
      allLocActualByPeriodKey[key] = { count, premium };
    }
  }

  for (const goal of raiseGoals) {
    const cfg = goal.raise_config || {};
    const period = periodOf(goal);
    const monthsElapsed = computeMonthsElapsed(period.start, period.end, todayStr);
    const individualPct = computeIndividualProgressPct(goal);

    let agencyPct = null;
    if (cfg.combination_mode !== 'individual' && cfg.agency_location_id) {
      if (cfg.agency_location_id === WHOLE_AGENCY_GOAL_SENTINEL) {
        const wholeAgencyGoal = wholeAgencyGoalByPeriodType[goal.period_type];
        // Never the goal comparing against itself — only relevant if the
        // Whole Agency's own raise goal somehow also pointed back at
        // __whole_agency_goal__, which sanitizeRaiseConfig can't prevent by
        // construction since agent_id and agency_location_id are unrelated
        // fields; guarding here instead of trusting that can't happen.
        if (wholeAgencyGoal && wholeAgencyGoal.id !== goal.id) {
          agencyPct = computeIndividualProgressPct(wholeAgencyGoal);
        }
      } else if (cfg.agency_location_id === ALL_LOCATIONS_SENTINEL) {
        const targets = allLocTargetsByPeriodType[goal.period_type] || {};
        const act = allLocActualByPeriodKey[`${period.start}|${period.end}`] || { count: 0, premium: 0 };
        agencyPct = computeAgencyProgressPct(targets, act.count, act.premium, goal.period_type);
      } else {
        const loc = locationById[cfg.agency_location_id];
        const act = locationActualsByKey[locKeyOf(goal)] || { count: 0, premium: 0 };
        agencyPct = computeAgencyProgressPct(loc, act.count, act.premium, goal.period_type);
      }
    }

    const combinedPct = computeCombinedProgressPct(individualPct, agencyPct, cfg.combination_mode, cfg.blend_individual_weight);
    // Separate mode has no combined number (computeCombinedProgressPct returns
    // null for it) — the driver for color/annualize/reward in that case falls
    // back to the agent's own individual number, consistent with the gate
    // always keying off individual performance.
    const driverPct = cfg.combination_mode === 'blended' ? combinedPct : individualPct;
    const gateOk = gatePassed(individualPct, cfg.gate_enabled, cfg.gate_floor_pct);
    const annualized = annualizedPct(driverPct, monthsElapsed);

    const status = {
      individual_pct:   individualPct,
      agency_pct:       agencyPct,
      agency_color:     agencyPct != null ? colorForYtd(agencyPct) : null,
      combined_pct:      combinedPct,
      months_elapsed:    Math.round(monthsElapsed * 10) / 10,
      annualized_pct:    annualized,
      gate_passed:       gateOk,
      ytd_color:         colorForYtd(driverPct),
      annualized_color:  colorForAnnualized(annualized),
    };

    // Separate mode intentionally carries no earned/projected number at all —
    // per spec, whoever makes the actual raise call weighs both bars manually.
    if (cfg.combination_mode !== 'separate') {
      const isThreshold = cfg.reward_mode === 'threshold';
      const prop = cfg.proportional || {};
      const ytdReward  = isThreshold
        ? computeThresholdReward(driverPct, cfg.threshold_tiers)
        : computeProportionalReward(driverPct, prop.target_pct, prop.max_pct, prop.stretch_mode, prop.stretch_breakpoint_pct);
      const projReward = isThreshold
        ? computeThresholdReward(annualized, cfg.threshold_tiers)
        : computeProportionalReward(annualized, prop.target_pct, prop.max_pct, prop.stretch_mode, prop.stretch_breakpoint_pct);

      status.earned_pct    = gateOk ? ytdReward.earnedPct  : 0;
      status.projected_pct = gateOk ? projReward.earnedPct : 0;
      if (isThreshold) status.tier_index = ytdReward.tierIndex;
      else             status.stretch_breakpoint_pct = ytdReward.stretchBreakpointPct;
    }

    goal.raise_status = status;
  }

  return goals;
}

// Attaches a `header_progress` object to whichever __agency__ goal(s) have
// show_in_header=true — the condensed progress bar pinned to the app header
// (Account → Sales → Team → Team & Agency Goals → Whole Agency → a goal's
// "Show in header" checkbox). Deliberately NOT gated on is_raise_goal or
// isRaiseEligiblePeriod — this works for any Whole Agency goal regardless of
// period type or raise status, unlike attachRaiseStatus above. Reuses the
// exact same pure math (computeIndividualProgressPct/computeMonthsElapsed/
// annualizedPct) rather than inventing new formulas — "progress toward goal"
// and "pace-projected progress" mean the same thing here as they do for an
// individual's own raise card, just computed for a goal that may not be
// raise-eligible at all. Synchronous — goals already have .actuals from
// computeActuals(), no new DB queries needed.
function attachHeaderProgress(goals, timezone) {
  const pinned = goals.filter(g => g.agent_id === '__agency__' && g.show_in_header);
  if (!pinned.length) return goals;

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date());
  for (const goal of pinned) {
    const progressPct = computeIndividualProgressPct(goal);
    const period = { start: goal._eff_start || goal.period_start, end: goal._eff_end || goal.period_end };
    const monthsElapsed = computeMonthsElapsed(period.start, period.end, todayStr);
    const projectedPct = annualizedPct(progressPct, monthsElapsed);
    goal.header_progress = {
      progress_pct:    progressPct,
      progress_color:  colorForYtd(progressPct),
      projected_pct:   projectedPct,
      projected_color: colorForAnnualized(projectedPct),
    };
  }
  return goals;
}
