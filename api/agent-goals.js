import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  computeMonthsElapsed, computeIndividualProgressPct, computeAgencyProgressPct,
  computeCombinedProgressPct, gatePassed, computeProportionalReward,
  computeThresholdReward, sanitizeRaiseConfig, annualizedPct, colorForYtd, colorForAnnualized,
} from './_lib/raise-calc.js';

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
      return res.status(200).json(withRaise);
    }
    return res.status(200).json(data || []);
  }

  // POST — create / upsert
  if (req.method === 'POST') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const { agent_id, period_type, period_label, period_start, period_end, goals, is_public } = req.body || {};
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

    const { is_recurring, is_raise_goal, raise_config } = req.body || {};
    // A raise goal is a flag on an existing ANNUAL goal — a raise doesn't make
    // sense against a monthly/quarterly window, so this is enforced here
    // rather than left to the frontend to police on its own.
    if (is_raise_goal && period_type !== 'annual') {
      return res.status(400).json({ error: 'Raise-eligible goals must be annual' });
    }
    let sanitizedRaiseConfig = {};
    if (is_raise_goal) {
      sanitizedRaiseConfig = sanitizeRaiseConfig(raise_config);
      if (sanitizedRaiseConfig.combination_mode !== 'individual' && sanitizedRaiseConfig.agency_location_id) {
        const { data: locRow } = await supabase.from('sales_locations')
          .select('id').eq('id', sanitizedRaiseConfig.agency_location_id).eq('user_id', dataUserId).maybeSingle();
        if (!locRow) return res.status(400).json({ error: 'Agency location not found' });
      }
    }

    const { data, error } = await supabase.from('agent_goals').upsert({
      user_id: dataUserId,
      agent_id, period_type, period_label,
      period_start, period_end,
      goals: goals || {},
      is_public:      !!is_public,
      is_recurring:   !!is_recurring,
      is_raise_goal:  !!is_raise_goal,
      raise_config:   sanitizedRaiseConfig,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,agent_id,period_type,period_label' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // PATCH — update fields
  if (req.method === 'PATCH') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const { id, goals, is_public, is_recurring, period_start, period_end, is_raise_goal, raise_config } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    if (goals !== undefined && CALL_METRIC_KEYS.some(k => goals?.[k] !== undefined)) {
      const { data: existingGoal } = await supabase.from('agent_goals')
        .select('agent_id').eq('id', id).eq('user_id', dataUserId).single();
      const cmError = callMetricScopeError(existingGoal?.agent_id, goals);
      if (cmError) return res.status(400).json({ error: cmError });
    }
    const update = { updated_at: new Date().toISOString() };
    if (goals        !== undefined) update.goals       = goals;
    if (is_public    !== undefined) update.is_public   = !!is_public;
    if (is_recurring !== undefined) update.is_recurring = !!is_recurring;
    if (period_start)               update.period_start = period_start;
    if (period_end)                 update.period_end   = period_end;

    if (is_raise_goal !== undefined) {
      if (is_raise_goal) {
        // period_type isn't itself editable via PATCH, so it has to be looked
        // up rather than trusted from the request body.
        const { data: existingGoal } = await supabase.from('agent_goals')
          .select('period_type').eq('id', id).eq('user_id', dataUserId).single();
        if (existingGoal?.period_type !== 'annual') {
          return res.status(400).json({ error: 'Raise-eligible goals must be annual' });
        }
        const sanitizedRaiseConfig = sanitizeRaiseConfig(raise_config);
        if (sanitizedRaiseConfig.combination_mode !== 'individual' && sanitizedRaiseConfig.agency_location_id) {
          const { data: locRow } = await supabase.from('sales_locations')
            .select('id').eq('id', sanitizedRaiseConfig.agency_location_id).eq('user_id', dataUserId).maybeSingle();
          if (!locRow) return res.status(400).json({ error: 'Agency location not found' });
        }
        update.is_raise_goal = true;
        update.raise_config  = sanitizedRaiseConfig;
      } else {
        update.is_raise_goal = false;
        update.raise_config  = {};
      }
    }

    const { error } = await supabase.from('agent_goals')
      .update(update).eq('id', id).eq('user_id', dataUserId);
    if (error) return res.status(500).json({ error: error.message });
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
        actuals['combined_' + grp.id] = grp.type === 'activity'
          ? agActs.filter(a => (grp.activity_type_ids || []).includes(a.activity_type_id)).reduce((s, a) => s + (a.count || 0), 0)
          : agSales.filter(s => (grp.products || []).includes(s.product)).reduce((sum, s) => sum + weightOf(s), 0);
      }
    }

    const cm = callMetricsByGoal[goal.id];
    if (cm) {
      if (goal.goals.handle_rate !== undefined) {
        const inbound = cm.answered + cm.missed + cm.voicemail;
        actuals.handle_rate = inbound > 0 ? Math.round(cm.answered / inbound * 100) : 0;
      }
      if (goal.goals.voicemail_count !== undefined) actuals.voicemail_count = cm.voicemail;
      if (goal.goals.missed_calls    !== undefined) actuals.missed_calls    = cm.missed;
    }

    return { ...goal, actuals };
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

  const result = {};
  for (const goal of relevant) {
    const pStart = goal._eff_start || goal.period_start;
    const pEnd   = goal._eff_end   || goal.period_end;
    let answered = 0, missed = 0, voicemail = 0;
    for (const monthKey of monthsInRange(pStart, pEnd)) {
      const v = mergedByMonth[monthKey];
      if (!v) continue;
      answered += v.answered; missed += v.missed; voicemail += v.voicemail;
    }
    result[goal.id] = { answered, missed, voicemail };
  }
  return result;
}

// Attaches a `raise_status` object to every goal flagged `is_raise_goal`.
// Mutates and returns the same array `computeActuals` already produced (its
// goals are fresh `{...goal, actuals}` objects per call, safe to extend here
// without touching anything else). Cheap bail-out when nothing is raise-flagged.
async function attachRaiseStatus(goals, dataUserId, timezone) {
  const raiseGoals = goals.filter(g => g.is_raise_goal && g.period_type === 'annual');
  if (!raiseGoals.length) return goals;

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date());
  const year = todayStr.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;

  // Agency locations (Blended/Separate modes) — dedupe across goals so a
  // shared location is only fetched/aggregated once, not once per goal.
  const locationIds = [...new Set(raiseGoals.map(g => g.raise_config?.agency_location_id).filter(Boolean))];
  const locationById = {};
  const locationActuals = {};

  if (locationIds.length) {
    const { data: locs } = await supabase.from('sales_locations')
      .select('id, name, goal_count_annual, goal_premium_annual')
      .in('id', locationIds).eq('user_id', dataUserId);
    for (const loc of (locs || [])) {
      locationById[loc.id] = loc;
      const { data: rows } = await supabase.from('sales_log')
        .select('written_premium, sale_weight')
        .eq('user_id', dataUserId)
        .eq('location', loc.name)
        .eq('is_cancelled', false)
        .gte('sale_date', yearStart).lte('sale_date', yearEnd);
      let count = 0, premium = 0;
      for (const r of (rows || [])) {
        count   += r.sale_weight ?? 1;
        premium += parseFloat(r.written_premium) || 0;
      }
      locationActuals[loc.id] = { count, premium };
    }
  }

  for (const goal of raiseGoals) {
    const cfg = goal.raise_config || {};
    const monthsElapsed = computeMonthsElapsed(goal.period_start, goal.period_end, todayStr);
    const individualPct = computeIndividualProgressPct(goal);

    let agencyPct = null;
    if (cfg.combination_mode !== 'individual' && cfg.agency_location_id) {
      const loc = locationById[cfg.agency_location_id];
      const act = locationActuals[cfg.agency_location_id] || { count: 0, premium: 0 };
      agencyPct = computeAgencyProgressPct(loc, act.count, act.premium, cfg.agency_metric);
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
