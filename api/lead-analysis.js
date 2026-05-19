import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

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
    .select('is_admin,has_sales_addon,plan,status,trial_ends_at,company_name,lead_analysis_cache,lead_analysis_at')
    .eq('user_id', dataUserId)
    .single();

  if (acctErr || !acct) return res.status(500).json({ error: 'Account not found' });

  const trialExpired = acct.status === 'trial' && acct.trial_ends_at && new Date(acct.trial_ends_at) < new Date();
  const allowed = acct.is_admin || (acct.has_sales_addon && !trialExpired && ['paid','deferred','trial'].includes(acct.status));
  if (!allowed) return res.status(403).json({ error: 'Sales add-on required' });

  const force = req.query?.force === '1';

  if (!force && acct.lead_analysis_cache && acct.lead_analysis_at) {
    const age = Date.now() - new Date(acct.lead_analysis_at).getTime();
    if (age < CACHE_TTL_MS) {
      return res.status(200).json({ ...acct.lead_analysis_cache, cached: true, cachedAt: acct.lead_analysis_at });
    }
  }

  try {
    const now     = new Date();
    const cutoff  = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Fetch manual + checklist entries from last 90 days
    const PAGE = 1000;
    const entries = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('sales_log')
        .select('agent_id,product,lead_source,written_premium,sale_date,subcategory,is_cancelled')
        .eq('user_id', dataUserId)
        .in('source', ['manual', 'checklist'])
        .gte('sale_date', cutoffStr)
        .range(from, from + PAGE - 1);
      if (error) return res.status(500).json({ error: error.message });
      if (data?.length) entries.push(...data);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    // Fetch agent names
    const { data: rosterRows } = await supabase
      .from('agent_roster')
      .select('agent_id,name')
      .eq('user_id', dataUserId);
    const agentNames = {};
    for (const r of (rosterRows || [])) agentNames[r.agent_id] = r.name;

    if (!entries.length) {
      return res.status(200).json({ insights: 'No manual or checklist sales entries found in the last 90 days. Add lead sources to your entries to unlock marketing analysis.', chartData: null });
    }

    // Split 90-day window into thirds for trend context
    const mid1 = new Date(now); mid1.setUTCDate(mid1.getUTCDate() - 60);
    const mid2 = new Date(now); mid2.setUTCDate(mid2.getUTCDate() - 30);

    // Aggregate by lead source
    const sources = {};
    for (const e of entries) {
      if (e.is_cancelled) continue;
      const src  = e.lead_source || '(None)';
      const prem = parseFloat(e.written_premium) || 0;
      const date = new Date(e.sale_date);

      if (!sources[src]) sources[src] = { count: 0, premium: 0, products: {}, agents: {}, early: 0, mid: 0, recent: 0 };
      const s = sources[src];
      s.count++;
      s.premium += prem;
      s.products[e.product] = (s.products[e.product] || 0) + 1;
      if (e.agent_id) s.agents[e.agent_id] = (s.agents[e.agent_id] || 0) + 1;
      if      (date >= mid2)  s.recent++;
      else if (date >= mid1)  s.mid++;
      else                    s.early++;
    }

    const totalCount = Object.values(sources).reduce((s, v) => s + v.count, 0);
    const sortedSrcs = Object.entries(sources).sort((a, b) => b[1].count - a[1].count);

    // Build compact text blocks for Claude
    const sourceLines = sortedSrcs.map(([src, s]) => {
      const avgPrem  = s.count ? (s.premium / s.count).toFixed(0) : 0;
      const pct      = ((s.count / totalCount) * 100).toFixed(1);
      const topProds = Object.entries(s.products).sort((a,b) => b[1]-a[1]).slice(0,3).map(([p,n]) => `${p}:${n}`).join(', ');
      const topAgents= Object.entries(s.agents).sort((a,b) => b[1]-a[1]).slice(0,3)
        .map(([id,n]) => `${agentNames[id] || id}:${n}`).join(', ');
      const trend    = `early:${s.early} mid:${s.mid} recent:${s.recent}`;
      const premLine = s.premium > 0 ? ` | total_prem:$${Math.round(s.premium)} avg_prem:$${avgPrem}` : '';
      return `${src}: ${s.count} sales (${pct}%)${premLine} | trend(30d windows) ${trend} | products [${topProds}] | agents [${topAgents}]`;
    }).join('\n');

    // Agent×source cross-tab (which agents use which sources most)
    const agentSources = {};
    for (const e of entries) {
      if (e.is_cancelled || !e.agent_id) continue;
      const name = agentNames[e.agent_id] || e.agent_id;
      if (!agentSources[name]) agentSources[name] = {};
      const src = e.lead_source || '(None)';
      agentSources[name][src] = (agentSources[name][src] || 0) + 1;
    }
    const agentSourceLines = Object.entries(agentSources)
      .sort((a,b) => Object.values(b[1]).reduce((s,v)=>s+v,0) - Object.values(a[1]).reduce((s,v)=>s+v,0))
      .map(([name, srcs]) => {
        const top = Object.entries(srcs).sort((a,b)=>b[1]-a[1]).map(([s,n])=>`${s}:${n}`).join(', ');
        return `${name}: ${top}`;
      }).join('\n');

    const companyLabel = acct.company_name || 'this agency';
    const dateRange = `${cutoffStr} to ${now.toISOString().split('T')[0]}`;

    const prompt = `You are a marketing performance analyst reviewing lead source data for ${companyLabel} over the last 90 days (${dateRange}). The trend columns show sales volume in three consecutive 30-day windows (oldest to most recent).

LEAD SOURCE PERFORMANCE:
${sourceLines}

AGENT × LEAD SOURCE BREAKDOWN:
${agentSourceLines}

Write exactly 4 paragraphs — no headings, no bullet points:

1. VOLUME & MIX — Which sources dominate by count and what percentage of total volume do the top 2–3 sources represent? Is the agency over-reliant on any single source?

2. REVENUE QUALITY — Which sources produce the highest average premium? Which produce volume but low avg premium? Name specific sources and dollar figures.

3. TRENDS & MOMENTUM — Using the 30-day window data, which sources are growing, declining, or stalling? Name sources with clear directional momentum and flag any sharp drops.

4. AGENT-SOURCE FIT & ACTIONS — Which agents are concentrated in high-performing sources vs. low-yield ones? Give the manager 2–3 specific, actionable steps: channels to invest in, sources to investigate or cut, or agent-source pairings to leverage.

End with ONE sentence naming the single highest-leverage change the agency could make to improve lead quality.`;

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages:   [{ role: 'user', content: prompt }],
    });

    const insights = message.content[0]?.text || 'No insights generated.';

    // Build chart data for frontend display
    const chartData = {
      sources: sortedSrcs.map(([src, s]) => ({
        source:    src,
        count:     s.count,
        premium:   Math.round(s.premium),
        avgPremium: s.count ? Math.round(s.premium / s.count) : 0,
        pct:       parseFloat(((s.count / totalCount) * 100).toFixed(1)),
        trend:     [s.early, s.mid, s.recent],
        topProduct: Object.entries(s.products).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—',
      })),
      totalCount,
      dateRange,
    };

    const payload = { insights, chartData };
    const nowIso  = new Date().toISOString();

    supabase.from('accounts').update({
      lead_analysis_cache: payload,
      lead_analysis_at:    nowIso,
    }).eq('user_id', dataUserId).then(() => {});

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
