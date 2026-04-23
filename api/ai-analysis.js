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

  const { data: acct, error: acctErr } = await supabase
    .from('accounts')
    .select('plan,status,trial_ends_at,company_name,is_admin,email,ai_analysis_cache,ai_analysis_at,ai_history_key')
    .eq('user_id', user.id)
    .single();

  if (acctErr || !acct) return res.status(500).json({ error: acctErr?.message || 'Account not found' });

  if (!acct.is_admin) {
    if (acct.plan !== 'premium') return res.status(403).json({ error: 'Premium plan required' });
    if (acct.status === 'trial')  return res.status(403).json({ error: 'Premium plan required' });
    if (!['paid','deferred'].includes(acct.status)) return res.status(403).json({ error: 'Account inactive' });
  }

  // Email current analysis
  if (req.query?.action === 'email') {
    return handleEmailAnalysis(req, res, acct, user.id);
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
        .eq('user_id', user.id)
        .gte('call_dt', cutoffStr)
        .not('disposition', 'in', '(internal,other,skip)')
        .range(from, from + PAGE - 1);
      if (error) return res.status(500).json({ error: error.message });
      if (data?.length) calls.push(...data);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const [{ data: sales }, { data: raceRows }] = await Promise.all([
      supabase.from('sales_log')
        .select('agent_id,product,sale_date')
        .eq('user_id', user.id)
        .gte('sale_date', cutoffStr),
      supabase.from('race_data')
        .select('agent_id,name,team')
        .eq('user_id', user.id),
    ]);
    const agentMeta = {};
    for (const r of (raceRows || [])) agentMeta[r.agent_id] = { name: r.name, team: r.team };

    // Aggregate into monthly, weekly, agent, and rolling-90 buckets
    const monthly  = {};
    const weekly   = {};
    const agents   = {};
    const r90      = { p:0, a:0, tk:0, vm:0, ms:0 };

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

    // Build history comparison context
    let historyContext = '';
    const prevKey = acct.ai_history_key;
    if (prevKey?.ts) {
      const daysAgo = Math.round((Date.now() - new Date(prevKey.ts).getTime()) / 86400000);
      const prevR90 = prevKey.r90 || {};
      const prevNote = prevKey.note || '';
      const prevMonthLines = Object.entries(prevKey.m || {}).slice(-3)
        .map(([mon, v]) => `${mon}: ${v.p} placed, ${v.a} answered, ${v.pol} policies`).join('\n');
      historyContext = `
PREVIOUS ANALYSIS CONTEXT (${daysAgo} days ago):
Rolling 90-day at that time: ${prevR90.p||0} placed, ${prevR90.a||0} answered, ${Math.round(prevR90.tk||0)}min talk, ${prevR90.vm||0} voicemails, ${prevR90.ms||0} missed, ${prevR90.pol||0} policies
Recent months at that time:
${prevMonthLines || 'none'}
Previous AI assessment: ${prevNote}

Using this history, identify: areas of improvement, areas of decline, and areas for monitoring (week-over-week, month-over-month, and rolling 90-day trends).`;
    }

    const company = acct.company_name || 'the team';
    const prompt = `You are a sales performance coach analyzing call center data for ${company}. Provide a concise, actionable analysis in plain text (no markdown headers or bullets).

MONTHLY TREND (last 90 days):
${monthlyText || 'No data'}

WEEKLY TREND (last 8 weeks):
${weeklyText || 'No data'}

AGENT SUMMARY (last 90 days):
${agentText || 'No data'}
${historyContext}

In 4-5 short paragraphs, cover: (1) overall trend and volume health${prevKey ? ', including improvements and declines vs previous analysis' : ''}, (2) top performers and what sets them apart, (3) agents who need coaching and why, (4) specific recommendations the manager can act on this week. Be direct and specific — use names and numbers.

End with ONE sentence (no heading) summarizing the single most important finding for the record.`;

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 700,
      messages:   [{ role: 'user', content: prompt }],
    });

    const insights = message.content[0]?.text || 'No insights generated.';
    const payload  = { insights, chartData };
    const now      = new Date().toISOString();

    // Build compact history key — abbreviated keys to minimize storage
    const histKey = {
      ts:   now,
      m:    Object.fromEntries(sortedMonths.slice(-3).map(mon => {
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
      // Extract the last sentence as the note (the "single most important finding" sentence)
      note: insights.split(/(?<=[.!?])\s+/).filter(Boolean).slice(-1)[0]?.slice(0, 200) || '',
    };

    supabase.from('accounts').update({
      ai_analysis_cache: payload,
      ai_analysis_at:    now,
      ai_history_key:    histKey,
    }).eq('user_id', user.id).then(() => {});

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
