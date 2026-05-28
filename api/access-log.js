import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: acct } = await supabase.from('accounts').select('is_admin').eq('user_id', user.id).single();
  if (!acct?.is_admin) return res.status(403).json({ error: 'Forbidden' });

  const { action, actor, days = '30', limit: limitStr = '200' } = req.query;
  const limit = Math.min(parseInt(limitStr) || 200, 500);

  let q = supabase.from('access_log')
    .select('id,user_id,actor_user_id,actor_email,action,resource,record_hash,row_count,metadata,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (action && action !== 'all') q = q.eq('action', action);
  if (actor) q = q.ilike('actor_email', `%${actor}%`);
  if (days !== 'all') {
    const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();
    q = q.gte('created_at', since);
  }

  const { data: logs, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Fetch account info for all unique owner user_ids
  const userIds = [...new Set((logs || []).map(l => l.user_id).filter(Boolean))];
  let accountMap = {};
  if (userIds.length) {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('user_id,company_name,email')
      .in('user_id', userIds);
    for (const a of (accounts || [])) accountMap[a.user_id] = a;
  }

  const entries = (logs || []).map(l => ({
    ...l,
    account_company: accountMap[l.user_id]?.company_name || null,
    account_email:   accountMap[l.user_id]?.email        || null,
  }));

  return res.status(200).json({ entries });
}
