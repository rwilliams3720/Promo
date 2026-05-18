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
    .select('is_admin, has_member_analysis, member_analysis_count, member_analysis_agents, member_analysis_cache, member_analysis_at, has_sales_addon, company_name, member_hours_data')
    .eq('user_id', dataUserId)
    .single();

  if (!acct) return res.status(500).json({ error: 'Account not found' });
  if (!acct.is_admin && !acct.has_member_analysis) {
    return res.status(403).json({ error: 'Team Member Analysis add-on required' });
  }

  // ── PATCH: save selected agents ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { agents } = req.body || {};
    if (!Array.isArray(agents)) return res.status(400).json({ error: 'agents array required' });

    const limit = acct.member_analysis_count || 0;
    if (!acct.is_admin && agents.length > limit) {
      return res.status(400).json({ error: `Seat limit is ${limit}. Remove ${agents.length - limit} agent(s).` });
    }

    const { error } = await supabase
      .from('accounts')
      .update({ member_analysis_agents: agents })
      .eq('user_id', dataUserId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
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

  // Parallel data fetch
  const [scoring, raceRes, histWinsRes, rosterRes, missedRes, vmRes] = await Promise.all([
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

  // Build per-agent data structures
  const agentData = {};
  for (const agentId of selectedIds) {
    const rd   = raceMap[agentId];
    const name = rd?.name || nameFromRaw[agentId] || rosterMap[agentId] || agentId;
    const team = rd?.team || 'sales';
    const agHours = hoursByAgent[agentId] || {};

    // Archived months sorted oldest→newest
    const histRows = (histWinsRes.data || [])
      .filter(r => r.agent_id === agentId)
      .map(r => ({ ...r, normMonth: normMonth(r.month) }))
      .sort((a, b) => monthCmp(a.normMonth, b.normMonth));

    const months = histRows.map(r => {
      const policies = (r.wl||0)+(r.ul||0)+(r.term||0)+(r.health||0)+(r.auto||0)+(r.fire||0);
      const score    = calcScore(r, scoring, r.missed||0, r.voicemail||0);
      const premium  = premByAgentMonth[agentId]?.[r.normMonth] ?? null;
      const hours    = agHours[r.normMonth] ?? null;
      return {
        month:   r.normMonth,
        placed:  r.placed  || 0,
        answered:r.answered|| 0,
        talkMin: Math.round(r.talk_min || 0),
        policies,
        score,
        premium,
        hours,
        rank:    r.rank || null,
        byProduct: { wl:r.wl||0, ul:r.ul||0, term:r.term||0, health:r.health||0, auto:r.auto||0, fire:r.fire||0 },
      };
    });

    // Current period hours: look up by curKey
    const curHours = agHours[curKey] ?? null;

    // Current period
    let current = null;
    if (rd) {
      const curPol   = (rd.wl||0)+(rd.ul||0)+(rd.term||0)+(rd.health||0)+(rd.auto||0)+(rd.fire||0);
      const curScore = calcScore({ ...rd }, scoring, raceWideMissed, raceWideVm);
      current = {
        placed:   rd.placed   || 0,
        answered: rd.answered || 0,
        talkMin:  Math.round(rd.talk_min || 0),
        policies: curPol,
        score:    curScore,
        premium:  premByAgentMtd[agentId] ?? null,
        hours:    curHours,
        daysElapsed,
        daysInMonth,
        byProduct: { wl:rd.wl||0, ul:rd.ul||0, term:rd.term||0, health:rd.health||0, auto:rd.auto||0, fire:rd.fire||0 },
      };
    }

    agentData[agentId] = { agentId, name, team, months, current };
  }

  // Group rankings (current period only)
  const activeIds = selectedIds.filter(id => agentData[id].current);
  const scoreRanks = rankBy(activeIds, id => agentData[id].current?.score    || 0);
  const polRanks   = rankBy(activeIds, id => agentData[id].current?.policies || 0);
  const premRanks  = acct.has_sales_addon
    ? rankBy(activeIds, id => agentData[id].current?.premium || 0)
    : null;

  // Build per-agent prompt blocks
  const agentBlocks = selectedIds.map(agentId => {
    const ag        = agentData[agentId];
    const scoreRank = scoreRanks[agentId];
    const polRank   = polRanks[agentId];
    const premRank  = premRanks?.[agentId];
    const n         = activeIds.length;

    const standingLine = [
      scoreRank ? `Score #${scoreRank}/${n}` : null,
      polRank   ? `Policies #${polRank}/${n}` : null,
      premRank  ? `Premium #${premRank}/${n}` : null,
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

    const curLine = ag.current ? [
      `${curKey} (day ${daysElapsed}/${daysInMonth}, ${pctElapsed}%):`,
      `${ag.current.placed}p`, `${ag.current.answered}a`,
      `${ag.current.talkMin}min`, `${ag.current.policies}pol`,
      `score:${ag.current.score}`,
      ag.current.premium != null ? `$${Math.round(ag.current.premium)}prem` : null,
      ...curEffParts,
    ].filter(Boolean).join(' ') : 'No current period data';

    return `AGENT: ${ag.name} (${ag.team})${standingLine ? ` | Group standing: ${standingLine}` : ''}
Archived history (oldest→newest, p=placed a=answered min=talk prem=written premium hrs=hours pol/hr=efficiency):
${histLines || '  No archived months'}
Current: ${curLine}`;
  }).join('\n\n');

  const hasPremium  = !!acct.has_sales_addon;
  const hasHours    = hoursPeriodsRaw.length > 0;
  const groupSize   = selectedIds.length;
  const hoursNote   = hasHours
    ? `Hours data: available (${hoursPeriodsRaw.length} period${hoursPeriodsRaw.length !== 1 ? 's' : ''}). Agents without hours for a period are excluded from efficiency comparisons.`
    : 'Hours data: not uploaded — skip efficiency metrics.';

  const prompt = `You are a sales performance coach analyzing ${groupSize} individual team member${groupSize !== 1 ? 's' : ''} for ${acct.company_name || 'a team'}.

Context: ${curKey} (day ${daysElapsed} of ${daysInMonth}, ${pctElapsed}% elapsed) | Group size: ${groupSize} | Premium data: ${hasPremium ? 'yes' : 'no'} | ${hoursNote}

${agentBlocks}

---

For EACH agent above, write an analysis starting with the exact header "AGENT: [name]".

Cover all four of these in 3–4 sentences per agent:
1. Month-over-month trend — improving, declining, or plateauing? Name specific months and numbers.
2. Strengths — where they lead in this group (calls, policies, talk time, premium, or efficiency if hours available).
3. Gaps/concerns — the single biggest metric holding them back, with evidence from the data.
4. Group standing — their rank vs peers in score, policies, premium (if available), and efficiency (if hours available). Be direct. If no hours for this agent, note that efficiency cannot be calculated.

Rules: plain text only, no markdown, no bullets. Use agent names and real numbers. Keep it tight — 3–4 sentences per agent. Separate agents with one blank line.`;

  const message = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: Math.min(350 * groupSize + 150, 2000),
    messages:   [{ role: 'user', content: prompt }],
  });

  const insights     = message.content[0]?.text || '';
  const nameList     = selectedIds.map(id => agentData[id].name);
  const agentSections = parseAgentSections(insights, nameList);

  // Attach rankings to agentData for the frontend
  for (const id of selectedIds) {
    agentData[id].scoreRank = scoreRanks[id] ?? null;
    agentData[id].polRank   = polRanks[id]   ?? null;
    agentData[id].premRank  = premRanks?.[id] ?? null;
  }

  return {
    insights,
    agentSections,
    agentData,
    groupSize,
    curKey,
    hoursLastPeriod,
    generatedAt: new Date().toISOString(),
  };
}
