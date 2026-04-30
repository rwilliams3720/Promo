import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });


const MONTH_ABBR   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Resolve data owner — if requester is a team member, use the owner's user_id
  let dataUserId = user.id;
  const { data: memberRow } = await supabase
    .from('account_members')
    .select('owner_user_id, role')
    .eq('member_user_id', user.id)
    .eq('status', 'active')
    .single();
  if (memberRow) dataUserId = memberRow.owner_user_id;

  const { data: acct, error: acctErr } = await supabase
    .from('accounts')
    .select('plan,status,trial_ends_at,company_name,is_admin,email,ai_analysis_cache,ai_analysis_at,ai_history_key')
    .eq('user_id', dataUserId)
    .single();

  if (acctErr || !acct) return res.status(500).json({ error: acctErr?.message || 'Account not found' });

  // Members can access AI analysis if owner's plan qualifies; admin flag is owner's
  if (!acct.is_admin) {
    if (acct.plan !== 'premium') return res.status(403).json({ error: 'Premium plan required' });
    if (acct.status === 'trial')  return res.status(403).json({ error: 'Premium plan required' });
    if (!['paid','deferred'].includes(acct.status)) return res.status(403).json({ error: 'Account inactive' });
  }

  // Email current analysis
  if (req.query?.action === 'email') {
    return handleEmailAnalysis(req, res, acct, dataUserId);
  }

  const force = req.query?.force === '1';

  // Return cache if still fresh
  if (!force && acct.ai_analysis_cache && acct.ai_analysis_at) {
    const age = Date.now() - new Date(acct.ai_analysis_at).getTime();
    if (age < CACHE_TTL_MS) {
      return res.status(200).json({ ...acct.ai_analysis_cache, cached: true, cachedAt: acct.ai_analysis_at });
    }
  }

  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Paginated call_log fetch
    const PAGE = 1000;
    const calls = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('call_log')
        .select('agent_id,disposition,talk_secs,call_dt')
        .eq('user_id', dataUserId)
        .gte('call_dt', cutoffStr)
        .not('disposition', 'in', '(internal,other,skip)')
        .range(from, from + PAGE - 1);
      if (error) return res.status(500).json({ error: error.message });
      if (data?.length) calls.push(...data);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const [{ data: sales }, { data: raceRows }, { data: histMonths }, { data: histWins }] = await Promise.all([
      supabase.from('sales_log')
        .select('agent_id,product,sale_date')
        .eq('user_id', dataUserId)
        .gte('sale_date', cutoffStr),
      supabase.from('race_data')
        .select('agent_id,name,team')
        .eq('user_id', dataUserId),
      supabase.from('historical_months')
        .select('month,placed,answered,talk_min,voicemail,missed,policies')
        .eq('user_id', dataUserId),
      supabase.from('historical_wins')
        .select('month,agent_id,name,team,placed,answered,talk_min,wl,ul,term,health,auto,fire,missed,voicemail,rank')
        .eq('user_id', dataUserId),
    ]);
    const agentMeta = {};
    for (const r of (raceRows || [])) agentMeta[r.agent_id] = { name: r.name, team: r.team };
    // Fill in names for archived agents no longer in race_data
    for (const r of (histWins || [])) {
      if (!agentMeta[r.agent_id]) agentMeta[r.agent_id] = { name: r.name, team: r.team };
    }

    // Aggregate into monthly, weekly, agent, and rolling-90 buckets
    // Seed monthly from historical_months (archived data that no longer exists in call_log)
    const monthly  = {};
    const weekly   = {};
    const agents   = {};
    const r90      = { p:0, a:0, tk:0, vm:0, ms:0 };

    const monthNameToNum = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

    // Full month names written by older versions of confirmArchive — normalize to abbreviated
    const FULL_TO_ABBR = {
      January:'Jan',February:'Feb',March:'Mar',April:'Apr',May:'May',June:'Jun',
      July:'Jul',August:'Aug',September:'Sep',October:'Oct',November:'Nov',December:'Dec',
    };
    for (const hm of (histMonths || [])) {
      const rawParts = hm.month.split(' ');
      const normMonth = (rawParts.length === 2 && FULL_TO_ABBR[rawParts[0]])
        ? FULL_TO_ABBR[rawParts[0]] + ' ' + rawParts[1]
        : hm.month;
      monthly[normMonth] = {
        placed:   hm.placed   || 0,
        answered: hm.answered || 0,
        talkMin:  hm.talk_min || 0,
        voicemail:hm.voicemail|| 0,
        missed:   hm.missed   || 0,
        policies: hm.policies || 0,
      };
      // Add historical months within the 90-day window to r90 rolling totals.
      const parts = normMonth.split(' ');
      if (parts.length === 2) {
        const mo = monthNameToNum[parts[0]];
        const yr = parseInt(parts[1]);
        if (!isNaN(mo) && !isNaN(yr)) {
          const lastDayOfMonth = new Date(Date.UTC(yr, mo + 1, 0));
          if (lastDayOfMonth >= cutoff) {
            r90.p  += hm.placed   || 0;
            r90.a  += hm.answered || 0;
            r90.tk += hm.talk_min || 0;
            r90.vm += hm.voicemail|| 0;
            r90.ms += hm.missed   || 0;
          }
        }
      }
    }

    for (const row of calls) {
      const dtStr = String(row.call_dt).includes('T') ? String(row.call_dt).split('T')[0] : String(row.call_dt);
      const d = new Date(dtStr + 'T12:00:00Z');
      if (isNaN(d.getTime())) continue;
      const monKey  = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      const wkKey   = isoWeek(d);

      if (!monthly[monKey]) monthly[monKey] = { placed:0, answered:0, talkMin:0, voicemail:0, missed:0, policies:0 };
      if (!weekly[wkKey])   weekly[wkKey]   = { p:0, a:0, tk:0, vm:0, ms:0 };
      const m = monthly[monKey];
      const w = weekly[wkKey];

      if (row.disposition === 'placed')    { m.placed++;   m.talkMin += (row.talk_secs||0)/60; w.p++; w.tk += (row.talk_secs||0)/60; r90.p++; r90.tk += (row.talk_secs||0)/60; }
      if (row.disposition === 'answered')  { m.answered++; m.talkMin += (row.talk_secs||0)/60; w.a++; w.tk += (row.talk_secs||0)/60; r90.a++; r90.tk += (row.talk_secs||0)/60; }
      if (row.disposition === 'voicemail') { m.voicemail++; w.vm++; r90.vm++; }
      if (row.disposition === 'missed')    { m.missed++; w.ms++; r90.ms++; }

      if (!row.agent_id) continue;
      if (!agents[row.agent_id]) agents[row.agent_id] = { placed:0, answered:0, talkMin:0, policies:0 };
      const ag = agents[row.agent_id];
      if (row.disposition === 'placed')   { ag.placed++;   ag.talkMin += (row.talk_secs||0)/60; }
      if (row.disposition === 'answered') { ag.answered++; ag.talkMin += (row.talk_secs||0)/60; }
    }

    const r90pol = { pol: 0 };
    for (const row of (sales || [])) {
      if (!row.agent_id) continue;
      if (!agents[row.agent_id]) agents[row.agent_id] = { placed:0, answered:0, talkMin:0, policies:0 };
      agents[row.agent_id].policies++;
      r90pol.pol++;
      const dtStr = String(row.sale_date).includes('T') ? String(row.sale_date).split('T')[0] : String(row.sale_date);
      const d = new Date(dtStr + 'T12:00:00Z');
      if (isNaN(d.getTime())) continue;
      const monKey = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      if (!monthly[monKey]) monthly[monKey] = { placed:0, answered:0, talkMin:0, voicemail:0, missed:0, policies:0 };
      monthly[monKey].policies++;
    }

    const monthOrder = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const sortedMonths = Object.keys(monthly).sort((a, b) => {
      const [am,ay] = [monthOrder[a.split(' ')[0]], parseInt(a.split(' ')[1])];
      const [bm,by] = [monthOrder[b.split(' ')[0]], parseInt(b.split(' ')[1])];
      return ay !== by ? ay - by : am - bm;
    });

    // Last 8 weeks sorted
    const sortedWeeks = Object.keys(weekly).sort();
    const recentWeeks = sortedWeeks.slice(-8);

    const chartData = sortedMonths.map(mon => ({
      period:    mon,
      placed:    monthly[mon].placed,
      answered:  monthly[mon].answered,
      talkMin:   Math.round(monthly[mon].talkMin),
      voicemail: monthly[mon].voicemail,
      missed:    monthly[mon].missed,
      policies:  monthly[mon].policies,
    }));

    // Build current metric text for Claude
    const monthlyText = sortedMonths.map(mon => {
      const m = monthly[mon];
      const inbound     = m.answered + m.voicemail + m.missed;
      const handleRate  = inbound > 0 ? Math.round(m.answered/inbound*100) : 0;
      return `${mon}: ${m.placed} placed, ${m.answered} answered (${handleRate}% handle rate), ${Math.round(m.talkMin)}min talk, ${m.voicemail} voicemails, ${m.missed} missed, ${m.policies} policies`;
    }).join('\n');

    const weeklyText = recentWeeks.map(wk => {
      const w = weekly[wk];
      return `${wk}: ${w.p} placed, ${w.a} answered, ${Math.round(w.tk)}min talk, ${w.vm} VM, ${w.ms} missed`;
    }).join('\n');

    const agentText = Object.entries(agents)
      .sort((a, b) => b[1].placed - a[1].placed)
      .map(([id, s]) => {
        const info = agentMeta[id] || { name: id, team: 'sales' };
        return `${info.name} (${info.team}): ${s.placed} placed, ${s.answered} answered, ${Math.round(s.talkMin)}min talk, ${s.policies} policies`;
      }).join('\n');

    // Build per-agent historical breakdown from historical_wins (one row per agent per archived month)
    const agentHistory = {};
    for (const row of (histWins || [])) {
      if (!agentHistory[row.agent_id]) {
        agentHistory[row.agent_id] = { name: row.name, team: row.team, months: {} };
      }
      const policies = (row.wl||0) + (row.ul||0) + (row.term||0) + (row.health||0) + (row.auto||0) + (row.fire||0);
      // Normalize "January 2026" → "Jan 2026" so lookups against sortedMonths always match
      const normalizedMonth = row.month.slice(0, 3) + ' ' + row.month.split(' ')[1];
      agentHistory[row.agent_id].months[normalizedMonth] = {
        placed:   row.placed   || 0,
        answered: row.answered || 0,
        talkMin:  Math.round(row.talk_min || 0),
        policies,
        rank:     row.rank || 0,
      };
    }

    const agentHistoryText = Object.entries(agentHistory)
      .map(([id, ag]) => {
        const monthLines = sortedMonths
          .filter(m => ag.months[m])
          .map(m => {
            const v = ag.months[m];
            return `${m}: ${v.placed}p ${v.answered}a ${v.talkMin}min ${v.policies}pol #${v.rank}`;
          }).join(' | ');
        return monthLines ? `${ag.name} (${ag.team}): ${monthLines}` : null;
      })
      .filter(Boolean)
      .join('\n');

    // Build history comparison context from prior AI snapshot
    let historyContext = '';
    const prevKey = acct.ai_history_key;
    if (prevKey?.ts) {
      const daysAgo = Math.round((Date.now() - new Date(prevKey.ts).getTime()) / 86400000);
      const prevR90 = prevKey.r90 || {};
      const prevNote = prevKey.note || '';
      const prevAgLines = Object.entries(prevKey.ag || {}).slice(0, 8)
        .map(([id, v]) => {
          const name = agentMeta[id]?.name || id;
          return `${name}: ${v.p} placed, ${v.a} answered, ${v.pol} policies`;
        }).join('\n');
      const prevMonthLines = Object.entries(prevKey.m || {})
        .map(([mon, v]) => `${mon}: ${v.p} placed, ${v.a} answered, ${v.pol} policies, ${v.vm} VM, ${v.ms} missed`).join('\n');
      historyContext = `

PRIOR SNAPSHOT (${daysAgo} days ago):
Team rolling 90-day then: ${prevR90.p||0} placed, ${prevR90.a||0} answered, ${Math.round(prevR90.tk||0)}min talk, ${prevR90.vm||0} VM, ${prevR90.ms||0} missed, ${prevR90.pol||0} policies
Monthly breakdown then:
${prevMonthLines || 'none'}
Individual agents then:
${prevAgLines || 'none'}
Prior AI assessment: ${prevNote}`;
    }

    const dataRange = sortedMonths.length > 0
      ? `${sortedMonths[0]} through ${sortedMonths[sortedMonths.length - 1]} (${sortedMonths.length} month${sortedMonths.length !== 1 ? 's' : ''})`
      : 'no historical data';

    const company = acct.company_name || 'the team';
    const prompt = `You are a sales performance coach analyzing call center data for ${company}. Write in plain text — no markdown headers, no bullet points.

DATA RANGE: ${dataRange}

MONTHLY TREND (all available history, oldest to newest):
${monthlyText || 'No data'}

WEEKLY TREND (last 8 weeks):
${weeklyText || 'No data'}

AGENT DETAIL — current active period (placed, answered, talk min, policies):
${agentText || 'No data'}

AGENT HISTORICAL BREAKDOWN — archived months (placed p, answered a, talk min, policies pol, team rank #):
${agentHistoryText || 'No archived agent data yet'}
${historyContext}

Write exactly 5 paragraphs:

1. TEAM TRENDS — Scan all available months and explicitly call out: (a) what is IMPROVING (rising placed/answered/policies, improving handle rate, falling VM/missed), (b) what is a CONCERN (declining volume, rising missed or voicemail, shrinking talk time), and (c) what to MONITOR (mixed or inconsistent signals). Name specific months and numbers.

2. INDIVIDUAL STANDOUTS — Using both current and archived months, name the top 2-3 performers. Call out specific month-over-month improvements by name and number (e.g. "Tracy grew from 31 placed in Mar to 44 in Apr"). How do they compare to the rest of the team?

3. COACHING PRIORITIES — Using both current and archived months, name the bottom 2-3 agents. For each, show their trend across months — are they declining, flat, or recovering? Name the single metric most holding them back.

4. WEEKLY SIGNALS — What does the week-over-week data reveal that the monthly view masks? Call out any sharp drops, recovery trends, or outlier weeks by name.

5. THIS WEEK'S ACTIONS — Give the manager 2-3 concrete, specific actions to take this week. Use agent names and target numbers where possible.${prevKey ? '\n\nWhere the prior snapshot is available, explicitly compare current vs. prior figures for both team and individual agents — name who improved, who declined, and who needs watching.' : ''}

End with ONE sentence (no heading) naming the single most critical finding for the record.`;

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const insights = message.content[0]?.text || 'No insights generated.';
    const payload  = { insights, chartData };
    const now      = new Date().toISOString();

    // Build compact history key for next analysis comparison
    const histKey = {
      ts:   now,
      m:    Object.fromEntries(sortedMonths.slice(-6).map(mon => {
        const v = monthly[mon];
        return [mon, { p: v.placed, a: v.answered, tk: Math.round(v.talkMin), vm: v.voicemail, ms: v.missed, pol: v.policies }];
      })),
      w:    Object.fromEntries(recentWeeks.slice(-4).map(wk => {
        const v = weekly[wk];
        return [wk, { p: v.p, a: v.a, tk: Math.round(v.tk), vm: v.vm, ms: v.ms }];
      })),
      r90:  { p: r90.p, a: r90.a, tk: Math.round(r90.tk), vm: r90.vm, ms: r90.ms, pol: r90pol.pol },
      ag:   Object.fromEntries(
        Object.entries(agents)
          .map(([id, v]) => [id, { p: v.placed, a: v.answered, pol: v.policies }])
      ),
      note: insights.split(/(?<=[.!?])\s+/).filter(Boolean).slice(-1)[0]?.slice(0, 200) || '',
    };

    supabase.from('accounts').update({
      ai_analysis_cache: payload,
      ai_analysis_at:    now,
      ai_history_key:    histKey,
    }).eq('user_id', dataUserId).then(() => {});

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function handleEmailAnalysis(req, res, acct, userId) {
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  if (!acct.ai_analysis_cache?.insights) {
    return res.status(400).json({ error: 'No analysis available to email. Run an analysis first.' });
  }

  const insights  = acct.ai_analysis_cache.insights;
  const generatedAt = acct.ai_analysis_at
    ? new Date(acct.ai_analysis_at).toLocaleString('en-US', { month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' })
    : 'recently';
  const company   = acct.company_name || 'Your Team';
  const toEmail   = acct.email;

  const paragraphs = insights.split(/\n\n+/).filter(Boolean)
    .map(p => `<p style="margin:0 0 14px;line-height:1.7;">${p.trim()}</p>`).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f9;padding:24px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;padding:32px;">
  <h2 style="margin:0 0 4px;font-size:20px;color:#111;">${company} — AI Coaching Insights</h2>
  <p style="margin:0 0 24px;font-size:12px;color:#888;">Generated ${generatedAt}</p>
  ${paragraphs}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:11px;color:#aaa;">Sent from Boat Race Dashboard</p>
</div></body></html>`;

  try {
    await resend.emails.send({
      from:    'Boat Race <reports@the-boat-race.com>',
      to:      toEmail,
      subject: `${company} — AI Coaching Insights`,
      html,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
