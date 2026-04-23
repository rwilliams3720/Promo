import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_INFO = {
  ashley:  { name:'Ashley McEniry',    team:'service' },
  fiona:   { name:'Fiona Rodriguez',   team:'service' },
  jocelyn: { name:'Jocelyn Hernandez', team:'service' },
  joseph:  { name:'Joseph Underwood',  team:'sales'   },
  peyton:  { name:'Peyton Tooze',      team:'sales'   },
  susan:   { name:'Susan Navarro',     team:'sales'   },
  tiffany: { name:'Tiffany Dabe',      team:'sales'   },
  tracy:   { name:'Tracy Ankrah',      team:'service' },
  amin:    { name:'Amin Kalas',        team:'sales'   },
  andy:    { name:'Andy Rose',         team:'service' },
  russel:  { name:'Russel Williams',   team:'service' },
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Fetch core account fields (always-present columns)
  const { data: acct, error: acctErr } = await supabase
    .from('accounts')
    .select('plan,status,trial_ends_at,company_name,is_admin')
    .eq('user_id', user.id)
    .single();

  if (acctErr || !acct) return res.status(500).json({ error: acctErr?.message || 'Account not found' });

  // Admins can always access analysis regardless of plan (for testing)
  if (!acct.is_admin) {
    if (acct.plan !== 'premium') return res.status(403).json({ error: 'Premium plan required' });
    if (acct.status === 'trial') return res.status(403).json({ error: 'Premium plan required' });
    if (!['paid','deferred'].includes(acct.status)) {
      return res.status(403).json({ error: 'Account inactive' });
    }
  }

  // Fetch cache columns separately — these may not exist if migration hasn't run yet
  const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
  const force = req.query?.force === '1';
  const { data: cacheRow } = await supabase
    .from('accounts')
    .select('ai_analysis_cache,ai_analysis_at')
    .eq('user_id', user.id)
    .single();

  if (!force && cacheRow?.ai_analysis_cache && cacheRow?.ai_analysis_at) {
    const age = Date.now() - new Date(cacheRow.ai_analysis_at).getTime();
    if (age < CACHE_TTL_MS) {
      return res.status(200).json({ ...cacheRow.ai_analysis_cache, cached: true, cachedAt: cacheRow.ai_analysis_at });
    }
  }

  try {
    // Fetch last 90 days of call_log
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const PAGE = 1000;
    const calls = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('call_log')
        .select('agent_id,disposition,talk_secs,call_dt')
        .eq('user_id', user.id)
        .gte('call_dt', cutoffStr)
        .not('disposition', 'in', '(internal,other,skip)')
        .range(from, from + PAGE - 1);
      if (error) return res.status(500).json({ error: error.message });
      if (data?.length) calls.push(...data);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    // Fetch sales for same window
    const { data: sales } = await supabase
      .from('sales_log')
      .select('agent_id,product,sale_date')
      .eq('user_id', user.id)
      .gte('sale_date', cutoffStr);

    // Aggregate monthly totals and per-agent totals
    const monthly = {};  // key → { placed, answered, talkMin, voicemail, missed, policies }
    const agents  = {};  // agentId → { placed, answered, talkMin, policies }

    for (const row of calls) {
      const dtStr = String(row.call_dt).includes('T') ? String(row.call_dt).split('T')[0] : String(row.call_dt);
      const d = new Date(dtStr + 'T12:00:00Z');
      if (isNaN(d.getTime())) continue;
      const monKey = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

      if (!monthly[monKey]) monthly[monKey] = { placed:0, answered:0, talkMin:0, voicemail:0, missed:0, policies:0 };
      const m = monthly[monKey];
      if (row.disposition === 'placed')    { m.placed++;   m.talkMin += (row.talk_secs||0)/60; }
      if (row.disposition === 'answered')  { m.answered++; m.talkMin += (row.talk_secs||0)/60; }
      if (row.disposition === 'voicemail') m.voicemail++;
      if (row.disposition === 'missed')    m.missed++;

      if (!AGENT_INFO[row.agent_id]) continue;
      if (!agents[row.agent_id]) agents[row.agent_id] = { placed:0, answered:0, talkMin:0, policies:0 };
      const a = agents[row.agent_id];
      if (row.disposition === 'placed')   { a.placed++;   a.talkMin += (row.talk_secs||0)/60; }
      if (row.disposition === 'answered') { a.answered++; a.talkMin += (row.talk_secs||0)/60; }
    }

    for (const row of (sales || [])) {
      if (!AGENT_INFO[row.agent_id]) continue;
      if (!agents[row.agent_id]) agents[row.agent_id] = { placed:0, answered:0, talkMin:0, policies:0 };
      agents[row.agent_id].policies++;
      // Also bucket into monthly
      const dtStr = String(row.sale_date).includes('T') ? String(row.sale_date).split('T')[0] : String(row.sale_date);
      const d = new Date(dtStr + 'T12:00:00Z');
      if (isNaN(d.getTime())) continue;
      const monKey = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      if (!monthly[monKey]) monthly[monKey] = { placed:0, answered:0, talkMin:0, voicemail:0, missed:0, policies:0 };
      monthly[monKey].policies++;
    }

    // Build sorted month list
    const monthOrder = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const sortedMonths = Object.keys(monthly).sort((a, b) => {
      const [am,ay] = [monthOrder[a.split(' ')[0]], parseInt(a.split(' ')[1])];
      const [bm,by] = [monthOrder[b.split(' ')[0]], parseInt(b.split(' ')[1])];
      return ay !== by ? ay - by : am - bm;
    });

    // Build chart data (returned to client for rendering)
    const chartData = sortedMonths.map(mon => ({
      period:    mon,
      placed:    monthly[mon].placed,
      answered:  monthly[mon].answered,
      talkMin:   Math.round(monthly[mon].talkMin),
      voicemail: monthly[mon].voicemail,
      missed:    monthly[mon].missed,
      policies:  monthly[mon].policies,
    }));

    // Build compact text for Claude
    const monthlyText = sortedMonths.map(mon => {
      const m = monthly[mon];
      const inbound = m.answered + m.voicemail + m.missed;
      const handleRate = inbound > 0 ? Math.round(m.answered/inbound*100) : 0;
      return `${mon}: ${m.placed} outbound placed, ${m.answered} inbound received (${handleRate}% inbound handle rate), ${Math.round(m.talkMin)}min talk, ${m.voicemail} voicemails, ${m.missed} missed`;
    }).join('\n');

    const agentText = Object.entries(agents)
      .filter(([id]) => AGENT_INFO[id])
      .sort((a, b) => b[1].placed - a[1].placed)
      .map(([id, s]) => {
        const info = AGENT_INFO[id];
        return `${info.name} (${info.team}): ${s.placed} outbound placed, ${s.answered} inbound received, ${Math.round(s.talkMin)}min talk, ${s.policies} policies`;
      }).join('\n');

    const company = acct.company_name || 'the team';
    const prompt = `You are a sales performance coach analyzing call center data for ${company}. Provide a concise, actionable analysis in plain text (no markdown headers or bullets).

MONTHLY TREND (last 90 days):
${monthlyText || 'No data'}

AGENT SUMMARY (last 90 days):
${agentText || 'No data'}

In 4-5 short paragraphs, cover: (1) overall trend and volume health, (2) top performers and what sets them apart, (3) agents who need coaching and why, (4) specific recommendations the manager can act on this week. Be direct and specific — use names and numbers.`;

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    });

    const insights = message.content[0]?.text || 'No insights generated.';
    const payload  = { insights, chartData };

    // Write cache — fire-and-forget, don't block the response
    supabase.from('accounts').update({
      ai_analysis_cache: payload,
      ai_analysis_at:    new Date().toISOString(),
    }).eq('user_id', user.id).then(() => {});

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
