import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MONTH_ABBR   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000;

const DEFAULT_SCORING = {
  wl:5, ul:4, term:3, health:3, auto:2, fire:2,
  placed_sales:8, placed_service:6, answered_sales:4, answered_service:3,
  talk_per_min:0.5, avg_min:1, missed_deduct:-2, voicemail_deduct:-1,
};

const FULL_TO_ABBR = {
  January:'Jan', February:'Feb', March:'Mar',  April:'Apr',
  May:'May',     June:'Jun',     July:'Jul',   August:'Aug',
  September:'Sep', October:'Oct', November:'Nov', December:'Dec',
};

const MONTH_ORDER = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
const POLICY_PRODUCTS = ['wl','ul','term','health','auto','fire'];

// Mirror of agent-goals.js helper — returns {start, end} for the current recurring period
function currentPeriodDates(periodType, now) {
  const yr = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  if (periodType === 'monthly') {
    return {
      start: new Date(Date.UTC(yr, mo, 1)).toISOString().slice(0, 10),
      end:   new Date(Date.UTC(yr, mo + 1, 0)).toISOString().slice(0, 10),
    };
  }
  if (periodType === 'quarterly') {
    const q = Math.floor(mo / 3);
    return {
      start: new Date(Date.UTC(yr, q * 3, 1)).toISOString().slice(0, 10),
      end:   new Date(Date.UTC(yr, q * 3 + 3, 0)).toISOString().slice(0, 10),
    };
  }
  if (periodType === 'semi_annual') {
    const h = mo < 6 ? 0 : 1;
    return {
      start: new Date(Date.UTC(yr, h * 6, 1)).toISOString().slice(0, 10),
      end:   new Date(Date.UTC(yr, h * 6 + 6, 0)).toISOString().slice(0, 10),
    };
  }
  return { start: `${yr}-01-01`, end: `${yr}-12-31` };
}

function normMonth(raw) {
  const parts = raw.trim().split(' ');
  if (parts.length !== 2) return raw;
  return (FULL_TO_ABBR[parts[0]] || parts[0]) + ' ' + parts[1];
}

function monthCmp(a, b) {
  const [am, ay] = [MONTH_ORDER[a.split(' ')[0]], parseInt(a.split(' ')[1])];
  const [bm, by] = [MONTH_ORDER[b.split(' ')[0]], parseInt(b.split(' ')[1])];
  return ay !== by ? ay - by : am - bm;
}

async function fetchScoringConfig(userId) {
  const { data: rows } = await supabase
    .from('scoring_config')
    .select('config_key, config_value')
    .eq('user_id', userId);
  const scoring = { ...DEFAULT_SCORING };
  for (const row of (rows || [])) {
    const val = parseFloat(row.config_value);
    if (!isNaN(val)) scoring[row.config_key] = val;
  }
  return scoring;
}

function calcScore(row, scoring, raceWideMissed, raceWideVoicemail) {
  const isService = (row.team || 'sales') === 'service';
  const talkMin   = row.talk_min || 0;
  const placed    = row.placed   || 0;
  const answered  = row.answered || 0;
  const avgMin    = placed > 0 ? talkMin / placed : 0;

  const polPts = (row.wl||0)*scoring.wl + (row.ul||0)*scoring.ul +
                 (row.term||0)*scoring.term + (row.health||0)*scoring.health +
                 (row.auto||0)*scoring.auto + (row.fire||0)*scoring.fire;
  const placedPts   = placed   * (isService ? scoring.placed_service  : scoring.placed_sales);
  const answeredPts = answered * (isService ? scoring.answered_service : scoring.answered_sales);
  const talkPts     = talkMin  * scoring.talk_per_min + avgMin * scoring.avg_min;

  const gross  = Math.round(polPts + placedPts + answeredPts + talkPts);
  const deduct = Math.round(
    (raceWideMissed    || 0) * (scoring.missed_deduct    || 0) +
    (raceWideVoicemail || 0) * (scoring.voicemail_deduct || 0)
  );
  return Math.max(0, gross + deduct);
}

function rankBy(ids, scoreFn) {
  const sorted = [...ids].sort((a, b) => scoreFn(b) - scoreFn(a));
  const ranks  = {};
  sorted.forEach((id, i) => { ranks[id] = i + 1; });
  return ranks;
}

function parseAgentSections(text, nameList) {
  const sections = {};
  const parts = text.split(/(?=AGENT:\s)/i);
  for (const part of parts) {
    const m = part.match(/^AGENT:\s+(.+?)(?:\s*\|.*)?(\n|$)/i);
    if (!m) continue;
    const headerName = m[1].trim();
    const matched = nameList.find(n =>
      headerName.toLowerCase().startsWith(n.toLowerCase()) ||
      n.toLowerCase().startsWith(headerName.toLowerCase())
    ) || headerName;
    sections[matched] = part.replace(/^AGENT:\s+.+?(\n|$)/i, '').trim();
  }
  return sections;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Resolve data owner for team members
  let dataUserId = user.id;
  const { data: memberRow } = await supabase
    .from('account_members')
    .select('owner_user_id, role')
    .eq('member_user_id', user.id)
    .eq('status', 'active')
    .single();
  if (memberRow) dataUserId = memberRow.owner_user_id;

  const { data: acct } = await supabase
    .from('accounts')
    .select('is_admin, has_member_analysis, member_analysis_count, member_analysis_agents, member_analysis_cache, member_analysis_at, member_analysis_agents_set_at, has_sales_addon, company_name, member_hours_data')
    .eq('user_id', dataUserId)
    .single();

  if (!acct) return res.status(500).json({ error: 'Account not found' });
  if (!acct.is_admin && !acct.has_member_analysis) {
    return res.status(403).json({ error: 'Team Member Analysis add-on required' });
  }

  // ── PATCH: save selected agents ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { agents, removeInactiveOnly } = req.body || {};
    if (!Array.isArray(agents)) return res.status(400).json({ error: 'agents array required' });

    const MA_LOCK_MS = 30 * 24 * 60 * 60 * 1000;

    if (removeInactiveOnly && !acct.is_admin) {
      // Allow removing inactive agents without resetting the lock clock.
      // Verify no new agents are being added — only removals from the current saved list.
      const currentIds = new Set((acct.member_analysis_agents || []).map(a => a.agent_id || a));
      const hasAdditions = agents.some(a => !currentIds.has(a.agent_id || a));
      if (hasAdditions) return res.status(400).json({ error: 'removeInactiveOnly cannot add new agents' });

      const { error } = await supabase
        .from('accounts')
        .update({ member_analysis_agents: agents })
        .eq('user_id', dataUserId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // 30-day lock: prevent agent switching within the lock window
    if (!acct.is_admin && acct.member_analysis_agents_set_at) {
      const lockedUntil = new Date(acct.member_analysis_agents_set_at).getTime() + MA_LOCK_MS;
      if (Date.now() < lockedUntil) {
        return res.status(423).json({
          error: 'Agent selection is locked for 30 days after each change.',
          lockedUntil: new Date(lockedUntil).toISOString(),
        });
      }
    }

    const limit = acct.member_analysis_count || 0;
    if (!acct.is_admin && agents.length > limit) {
      return res.status(400).json({ error: `Seat limit is ${limit}. Remove ${agents.length - limit} agent(s).` });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('accounts')
      .update({ member_analysis_agents: agents, member_analysis_agents_set_at: now })
      .eq('user_id', dataUserId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, lockedUntil: new Date(Date.now() + MA_LOCK_MS).toISOString() });
  }

  // ── GET: return cached or generate fresh analysis ─────────────────────────
  if (req.method === 'GET') {
    const force = req.query?.force === '1';

    if (!force && acct.member_analysis_cache && acct.member_analysis_at) {
      const age = Date.now() - new Date(acct.member_analysis_at).getTime();
      if (age < CACHE_TTL_MS) {
        return res.status(200).json({
          ...acct.member_analysis_cache,
          cached:   true,
          cachedAt: acct.member_analysis_at,
        });
      }
    }

    const selectedAgents = acct.member_analysis_agents || [];
    if (!selectedAgents.length) {
      return res.status(400).json({ error: 'No agents selected. Go to Account → Sales to choose agents.' });
    }
    const selectedIds = selectedAgents.map(a => (typeof a === 'string' ? a : a.agent_id)).filter(Boolean);

    try {
      const payload = await generateAnalysis(dataUserId, acct, selectedIds, selectedAgents, acct.member_hours_data);
      const now = new Date().toISOString();
      supabase.from('accounts').update({
        member_analysis_cache: payload,
        member_analysis_at:    now,
      }).eq('user_id', dataUserId).then(() => {});
      return res.status(200).json(payload);
    } catch (err) {
      console.error('member-analysis generate error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// Normalize "April 2026" → "Apr 2026" (same format as historical_wins months)
function normPeriodLabel(label) {
  const FULL = { January:'Jan', February:'Feb', March:'Mar', April:'Apr', May:'May', June:'Jun', July:'Jul', August:'Aug', September:'Sep', October:'Oct', November:'Nov', December:'Dec' };
  const parts = (label || '').trim().split(' ');
  if (parts.length !== 2) return label;
  return (FULL[parts[0]] || parts[0]) + ' ' + parts[1];
}

async function generateAnalysis(dataUserId, acct, selectedIds, selectedAgentsRaw, hoursDataRaw) {
  const now          = new Date();
  const mtdStart     = `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-01`;
  const ytdStart     = `${now.getUTCFullYear()}-01-01`;
  const daysElapsed  = now.getUTCDate();
  const daysInMonth  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1, 0)).getUTCDate();
  const pctElapsed   = Math.round(daysElapsed / daysInMonth * 100);
  const curKey       = `${MONTH_ABBR[now.getUTCMonth()]} ${now.getUTCFullYear()}`;

  const today = now.toISOString().slice(0, 10);

  // Parallel data fetch
  const [scoring, raceRes, histWinsRes, rosterRes, missedRes, vmRes, goalsRes] = await Promise.all([
    fetchScoringConfig(dataUserId),
    supabase.from('race_data')
      .select('agent_id,name,team,placed,answered,talk_min,avg_min,wl,ul,term,health,auto,fire')
      .eq('user_id', dataUserId)
      .in('agent_id', selectedIds),
    supabase.from('historical_wins')
      .select('agent_id,name,team,month,placed,answered,talk_min,wl,ul,term,health,auto,fire,missed,voicemail,rank')
      .eq('user_id', dataUserId)
      .in('agent_id', selectedIds),
    supabase.from('agent_roster')
      .select('agent_id,name')
      .eq('user_id', dataUserId),
    supabase.from('call_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', dataUserId)
      .eq('disposition', 'missed'),
    supabase.from('call_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', dataUserId)
      .eq('disposition', 'voicemail'),
    supabase.from('agent_goals')
      .select('agent_id,period_type,period_label,period_start,period_end,goals,is_recurring')
      .eq('user_id', dataUserId)
      .in('agent_id', selectedIds),
  ]);

  const raceMap   = {};
  for (const r of (raceRes.data || []))   raceMap[r.agent_id]   = r;
  const rosterMap = {};
  for (const r of (rosterRes.data || [])) rosterMap[r.agent_id] = r.name;

  const nameFromRaw = {};
  for (const a of selectedAgentsRaw) {
    if (typeof a === 'object' && a.agent_id) nameFromRaw[a.agent_id] = a.name;
  }

  const raceWideMissed = missedRes.count || 0;
  const raceWideVm     = vmRes.count     || 0;

  // Fetch premium data from sales_log if has_sales_addon
  let premByAgentMonth = {}; // agent_id → { monthKey → total }
  let premByAgentMtd   = {}; // agent_id → mtd total
  if (acct.has_sales_addon) {
    const { data: premRows } = await supabase
      .from('sales_log')
      .select('agent_id,written_premium,sale_date')
      .eq('user_id', dataUserId)
      .in('agent_id', selectedIds)
      .gte('sale_date', ytdStart)
      .not('written_premium', 'is', null);

    for (const row of (premRows || [])) {
      if (!row.agent_id) continue;
      const amt    = parseFloat(row.written_premium) || 0;
      if (!amt) continue;
      const dtStr  = String(row.sale_date).split('T')[0];
      const d      = new Date(dtStr + 'T12:00:00Z');
      if (isNaN(d.getTime())) continue;
      const mk     = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      if (!premByAgentMonth[row.agent_id]) premByAgentMonth[row.agent_id] = {};
      premByAgentMonth[row.agent_id][mk] = (premByAgentMonth[row.agent_id][mk] || 0) + amt;
      if (dtStr >= mtdStart) {
        premByAgentMtd[row.agent_id] = (premByAgentMtd[row.agent_id] || 0) + amt;
      }
    }
  }

  // Build goal actuals by agent — goals active today (or recurring → effective current window)
  const goalsByAgent = {}; // agentId → [{ periodType, periodLabel, goals, actuals }]
  const allGoals = (goalsRes.data || []).filter(g => {
    if (g.is_recurring) return true; // always include; compute effective window below
    return g.period_start <= today && g.period_end >= today;
  });
  for (const goal of allGoals) {
    const aid      = goal.agent_id;
    const effStart = goal.is_recurring ? currentPeriodDates(goal.period_type, now).start : goal.period_start;
    const effEnd   = goal.is_recurring ? currentPeriodDates(goal.period_type, now).end   : goal.period_end;
    if (!goalsByAgent[aid]) goalsByAgent[aid] = [];

    let totPolicies = 0, totPremium = 0;
    const totByProduct = { wl:0, ul:0, term:0, health:0, auto:0, fire:0 };

    // Sum archived months that fall entirely within the effective goal period
    for (const h of (histWinsRes.data || []).filter(r => r.agent_id === aid)) {
      const normM  = normMonth(h.month);
      const mo0    = MONTH_ORDER[normM.split(' ')[0]] - 1;
      const yr0    = parseInt(normM.split(' ')[1]);
      const mStart = `${yr0}-${String(mo0 + 1).padStart(2, '0')}-01`;
      const mEnd   = new Date(Date.UTC(yr0, mo0 + 1, 0)).toISOString().slice(0, 10);
      if (mStart >= effStart && mEnd <= effEnd) {
        for (const p of POLICY_PRODUCTS) totByProduct[p] += h[p] || 0;
        totPolicies += POLICY_PRODUCTS.reduce((s, p) => s + (h[p] || 0), 0);
        if (premByAgentMonth[aid]?.[normM]) totPremium += premByAgentMonth[aid][normM];
      }
    }
    // Add current period (race_data) if it starts within the effective goal period
    if (mtdStart >= effStart && mtdStart <= effEnd) {
      const cur = raceMap[aid];
      if (cur) {
        for (const p of POLICY_PRODUCTS) totByProduct[p] += cur[p] || 0;
        totPolicies += POLICY_PRODUCTS.reduce((s, p) => s + (cur[p] || 0), 0);
        totPremium  += premByAgentMtd[aid] || 0;
      }
    }
    goalsByAgent[aid].push({
      periodType:  goal.period_type,
      periodLabel: goal.period_label,
      goals:       goal.goals,
      actuals:     { policies: totPolicies, premium: totPremium, ...totByProduct },
    });
  }

  // Build hours lookup: agentId → { normPeriod → hours }
  // Also track last uploaded period for the frontend label
  const hoursPeriodsRaw = hoursDataRaw?.periods || [];
  let hoursLastPeriod = null;
  if (hoursPeriodsRaw.length) {
    const sorted = [...hoursPeriodsRaw].sort((a, b) =>
      new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0));
    hoursLastPeriod = sorted[0].period;
  }
  // hoursByAgent[agentId][normPeriodLabel] = hours
  const hoursByAgent = {};
  for (const period of hoursPeriodsRaw) {
    const normLabel = normPeriodLabel(period.period);
    for (const row of (period.rows || [])) {
      const aid = row.agent_id;
      if (!aid) continue;
      if (!hoursByAgent[aid]) hoursByAgent[aid] = {};
      hoursByAgent[aid][normLabel] = (hoursByAgent[aid][normLabel] || 0) + row.hours;
    }
  }

  // compByAgent[agentId][normPeriodLabel] = compensation
  const compByAgent = {};
  for (const period of hoursPeriodsRaw) {
    const normLabel = normPeriodLabel(period.period);
    for (const row of (period.rows || [])) {
      const aid  = row.agent_id;
      const comp = row.compensation;
      if (!aid || comp == null || comp === 0) continue;
      if (!compByAgent[aid]) compByAgent[aid] = {};
      compByAgent[aid][normLabel] = (compByAgent[aid][normLabel] || 0) + comp;
    }
  }
  const hasCompData = Object.keys(compByAgent).length > 0;

  // Build per-agent data structures
  const agentData = {};
  for (const agentId of selectedIds) {
    const rd      = raceMap[agentId];
    const name    = rd?.name || nameFromRaw[agentId] || rosterMap[agentId] || agentId;
    const team    = rd?.team || 'sales';
    const agHours = hoursByAgent[agentId] || {};
    const agComp  = compByAgent[agentId]  || {};

    // Archived months sorted oldest→newest
    const histRows = (histWinsRes.data || [])
      .filter(r => r.agent_id === agentId)
      .map(r => ({ ...r, normMonth: normMonth(r.month) }))
      .sort((a, b) => monthCmp(a.normMonth, b.normMonth));

    const months = histRows.map(r => {
      const policies     = (r.wl||0)+(r.ul||0)+(r.term||0)+(r.health||0)+(r.auto||0)+(r.fire||0);
      const score        = calcScore(r, scoring, r.missed||0, r.voicemail||0);
      const premium      = premByAgentMonth[agentId]?.[r.normMonth] ?? null;
      const hours        = agHours[r.normMonth] ?? null;
      const compensation = agComp[r.normMonth]  ?? null;
      return {
        month:   r.normMonth,
        placed:  r.placed  || 0,
        answered:r.answered|| 0,
        talkMin: Math.round(r.talk_min || 0),
        policies,
        score,
        premium,
        hours,
        compensation,
        rank:    r.rank || null,
        byProduct: { wl:r.wl||0, ul:r.ul||0, term:r.term||0, health:r.health||0, auto:r.auto||0, fire:r.fire||0 },
      };
    });

    // Current period hours/comp: look up by curKey
    const curHours = agHours[curKey] ?? null;
    const curComp  = agComp[curKey]  ?? null;

    // Current period
    let current = null;
    if (rd) {
      const curPol   = (rd.wl||0)+(rd.ul||0)+(rd.term||0)+(rd.health||0)+(rd.auto||0)+(rd.fire||0);
      const curScore = calcScore({ ...rd }, scoring, raceWideMissed, raceWideVm);
      current = {
        placed:       rd.placed   || 0,
        answered:     rd.answered || 0,
        talkMin:      Math.round(rd.talk_min || 0),
        policies:     curPol,
        score:        curScore,
        premium:      premByAgentMtd[agentId] ?? null,
        hours:        curHours,
        compensation: curComp,
        daysElapsed,
        daysInMonth,
        byProduct: { wl:rd.wl||0, ul:rd.ul||0, term:rd.term||0, health:rd.health||0, auto:rd.auto||0, fire:rd.fire||0 },
      };
    }

    agentData[agentId] = { agentId, name, team, months, current };
  }

  // Group rankings (current period only) — computed within each team
  const activeIds  = selectedIds.filter(id => agentData[id].current);
  const salesIds   = activeIds.filter(id => agentData[id].team === 'sales');
  const serviceIds = activeIds.filter(id => agentData[id].team === 'service');
  const teamPool   = { sales: salesIds.length, service: serviceIds.length };

  const scoreRanks = {
    ...rankBy(salesIds,   id => agentData[id].current?.score    || 0),
    ...rankBy(serviceIds, id => agentData[id].current?.score    || 0),
  };
  const polRanks = {
    ...rankBy(salesIds,   id => agentData[id].current?.policies || 0),
    ...rankBy(serviceIds, id => agentData[id].current?.policies || 0),
  };
  const answeredRanks = {
    ...rankBy(salesIds,   id => agentData[id].current?.answered || 0),
    ...rankBy(serviceIds, id => agentData[id].current?.answered || 0),
  };
  const premRanks = acct.has_sales_addon ? {
    ...rankBy(salesIds,   id => agentData[id].current?.premium || 0),
    ...rankBy(serviceIds, id => agentData[id].current?.premium || 0),
  } : null;

  // Cost-per-policy ranking within same team — lower cost = better (negate for rankBy)
  const cppEligibleSales   = hasCompData ? salesIds.filter(id => {
    const ag = agentData[id].current;
    return ag?.compensation != null && ag.policies > 0;
  }) : [];
  const cppEligibleService = hasCompData ? serviceIds.filter(id => {
    const ag = agentData[id].current;
    return ag?.compensation != null && ag.policies > 0;
  }) : [];
  const cppPool  = { sales: cppEligibleSales.length, service: cppEligibleService.length };
  const cppRanks = (cppEligibleSales.length > 1 || cppEligibleService.length > 1) ? {
    ...rankBy(cppEligibleSales,   id => { const ag = agentData[id].current; return -(ag.compensation / ag.policies); }),
    ...rankBy(cppEligibleService, id => { const ag = agentData[id].current; return -(ag.compensation / ag.policies); }),
  } : null;

  // Build per-agent prompt blocks
  const agentBlocks = selectedIds.map(agentId => {
    const ag        = agentData[agentId];
    const isService = ag.team === 'service';
    const scoreRank = scoreRanks[agentId];
    const polRank   = polRanks[agentId];
    const ansRank   = answeredRanks[agentId];
    const premRank  = premRanks?.[agentId];
    const cppRank   = cppRanks?.[agentId];
    const n         = teamPool[ag.team] || activeIds.length;
    const nCpp      = cppPool[ag.team]  || 0;
    const teamLabel = ag.team;

    const standingLine = [
      scoreRank                                                          ? `Score #${scoreRank}/${n} ${teamLabel}`    : null,
      isService ? (ansRank ? `Answered #${ansRank}/${n} ${teamLabel}` : null)
               : (polRank  ? `Policies #${polRank}/${n} ${teamLabel}` : null),
      premRank  ? `Premium #${premRank}/${n} ${teamLabel}` : null,
      cppRank   ? `Cost/Policy #${cppRank}/${nCpp} ${teamLabel}` : null,
    ].filter(Boolean).join(', ');

    const histLines = ag.months.slice(-6).map(m => {
      const effParts = [];
      if (m.hours != null) {
        effParts.push(`${m.hours}hrs`);
        if (m.hours > 0) {
          effParts.push(`${(m.policies / m.hours).toFixed(2)}pol/hr`);
          if (m.premium != null) effParts.push(`$${Math.round(m.premium / m.hours)}/hr`);
        }
      }
      if (m.compensation != null) {
        effParts.push(`$${Math.round(m.compensation)}comp`);
        if (m.policies > 0) effParts.push(`$${Math.round(m.compensation / m.policies)}/pol-cost`);
        if (m.hours > 0)    effParts.push(`$${Math.round(m.compensation / m.hours)}/hr-cost`);
      }
      const parts = [
        `${m.placed}p`, `${m.answered}a`, `${m.talkMin}min`, `${m.policies}pol`,
        `score:${m.score}`,
        m.premium != null ? `$${Math.round(m.premium)}prem` : null,
        ...effParts,
        m.rank ? `#${m.rank}rank` : null,
      ].filter(Boolean).join(' ');
      return `  ${m.month}: ${parts}`;
    }).join('\n');

    const curEffParts = [];
    if (ag.current?.hours != null) {
      curEffParts.push(`${ag.current.hours}hrs`);
      if (ag.current.hours > 0) {
        curEffParts.push(`${(ag.current.policies / ag.current.hours).toFixed(2)}pol/hr`);
        if (ag.current.premium != null) curEffParts.push(`$${Math.round(ag.current.premium / ag.current.hours)}/hr`);
      }
    }
    if (ag.current?.compensation != null) {
      curEffParts.push(`$${Math.round(ag.current.compensation)}comp`);
      if (ag.current.policies > 0) curEffParts.push(`$${Math.round(ag.current.compensation / ag.current.policies)}/pol-cost`);
      if (ag.current.hours > 0)    curEffParts.push(`$${Math.round(ag.current.compensation / ag.current.hours)}/hr-cost`);
    }

    const curLine = ag.current ? [
      `${curKey} (day ${daysElapsed}/${daysInMonth}, ${pctElapsed}%):`,
      `${ag.current.placed}p`, `${ag.current.answered}a`,
      `${ag.current.talkMin}min`, `${ag.current.policies}pol`,
      `score:${ag.current.score}`,
      ag.current.premium != null ? `$${Math.round(ag.current.premium)}prem` : null,
      ...curEffParts,
    ].filter(Boolean).join(' ') : 'No current period data';

    // Build goal-vs-actual lines for this agent
    const agGoals = goalsByAgent[agentId] || [];
    const goalLines = agGoals.map(g => {
      const G = g.goals;
      const A = g.actuals;
      const parts = [];
      if (G.policies != null) {
        const pct = G.policies > 0 ? Math.round(A.policies / G.policies * 100) : 0;
        parts.push(`policies ${A.policies}/${G.policies} (${pct}%)`);
      }
      if (G.premium != null) {
        const pct = G.premium > 0 ? Math.round(A.premium / G.premium * 100) : 0;
        parts.push(`premium $${Math.round(A.premium)}/$${G.premium} (${pct}%)`);
      }
      for (const prod of POLICY_PRODUCTS) {
        if (G[prod] != null) {
          const pct = G[prod] > 0 ? Math.round((A[prod] || 0) / G[prod] * 100) : 0;
          parts.push(`${prod} ${A[prod] || 0}/${G[prod]} (${pct}%)`);
        }
      }
      return `Goals (${g.periodType}, ${g.periodLabel}): ${parts.join(' | ')}`;
    }).join('\n');

    return `AGENT: ${ag.name} (${ag.team})${standingLine ? ` | Team standing: ${standingLine}` : ''}
${goalLines ? goalLines + '\n' : ''}Archived history (oldest→newest, p=placed a=answered min=talk prem=written premium hrs=hours pol/hr=efficiency comp=compensation /pol-cost=cost per policy /hr-cost=labor cost per hour):
${histLines || '  No archived months'}
Current: ${curLine}`;
  }).join('\n\n');

  const hasPremium = !!acct.has_sales_addon;
  const hasHours   = hoursPeriodsRaw.length > 0;
  const groupSize  = selectedIds.length;
  const hoursNote  = hasHours
    ? `Hours data: available (${hoursPeriodsRaw.length} period${hoursPeriodsRaw.length !== 1 ? 's' : ''}). Agents without hours for a period are excluded from hour-efficiency comparisons.`
    : 'Hours data: not uploaded — skip hour-based efficiency metrics.';
  const compNote   = hasCompData
    ? 'Compensation data: available. comp=total paid that period, /pol-cost=cost per policy written (lower is more efficient), /hr-cost=labor cost per hour. Salary employees may have 0 hours but still have compensation — for them, cost per policy is the primary efficiency metric.'
    : 'Compensation data: not uploaded.';
  const teamNote = salesIds.length && serviceIds.length
    ? `Teams: ${salesIds.length} sales, ${serviceIds.length} service — all rankings are within-team only, do NOT cross-compare sales vs service agents`
    : salesIds.length ? `Team: ${salesIds.length} sales agents` : `Team: ${serviceIds.length} service agents`;

  const prompt = `You are a sales performance coach analyzing ${groupSize} individual team member${groupSize !== 1 ? 's' : ''} for ${acct.company_name || 'a team'}.

Context: ${curKey} (day ${daysElapsed} of ${daysInMonth}, ${pctElapsed}% elapsed) | Group size: ${groupSize} | ${teamNote} | Premium data: ${hasPremium ? 'yes' : 'no'} | ${hoursNote} | ${compNote}

${agentBlocks}

---

For EACH agent above, write an analysis starting with the exact header "AGENT: [name]".

Cover these points in 3–5 sentences per agent:
1. Month-over-month trend — improving, declining, or plateauing? Name specific months and numbers.
2. Strengths — where they lead within their own team. For sales agents: placed calls, policies, talk time, premium. For service agents: answered calls, handle rate, talk time. Do not evaluate service agents on placed calls or new policies — those are sales-team metrics.
3. Gaps/concerns — the single biggest metric holding them back compared to their same-team peers, with evidence from the data.
4. Team standing — their rank within their own team (sales or service) in score and key team metrics. For service agents, lead with answered and handle rate. For sales agents, lead with placed and policies. Be direct. Never compare a service agent's metrics against a sales agent's metrics.
5. Goal progress — if Goals lines are shown for this agent, assess their pace against each goal given the percent of period elapsed (${pctElapsed}% of the current month). State whether they are on track, ahead, or behind, and by how much. If no goals are shown, skip this point entirely.
6. Cost efficiency — if compensation data is available for this agent, comment on cost per policy trend and rank within their team. If the agent is salaried (0 hours but has compensation), focus on cost per policy as the key efficiency metric. Skip this point if no compensation data for this agent.

Rules: plain text only, no markdown, no bullets. Use agent names and real numbers. Separate agents with one blank line.`;

  const message = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: Math.min(400 * groupSize + 200, 2400),
    messages:   [{ role: 'user', content: prompt }],
  });

  const insights      = message.content[0]?.text || '';
  const nameList      = selectedIds.map(id => agentData[id].name);
  const agentSections = parseAgentSections(insights, nameList);

  // Attach rankings to agentData for the frontend
  for (const id of selectedIds) {
    agentData[id].scoreRank   = scoreRanks[id]     ?? null;
    agentData[id].polRank     = polRanks[id]       ?? null;
    agentData[id].answeredRank= answeredRanks[id]  ?? null;
    agentData[id].premRank    = premRanks?.[id]    ?? null;
    agentData[id].cppRank     = cppRanks?.[id]     ?? null;
    agentData[id].teamPoolSize= teamPool[agentData[id].team] || activeIds.length;
  }

  return {
    insights,
    agentSections,
    agentData,
    groupSize,
    curKey,
    hoursLastPeriod,
    hasCompData,
    generatedAt: new Date().toISOString(),
  };
}
