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

  // Owner
  const { data: ownerAcct } = await supabase.from('accounts').select('user_id').eq('user_id', user.id).single();
  if (ownerAcct) {
    const { data, error } = await supabase
      .from('account_members')
      .select('id, email, role, roster_agent_id, managed_by')
      .eq('owner_user_id', user.id)
      .eq('status', 'active');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  // Captain member
  const { data: myMember } = await supabase
    .from('account_members')
    .select('id, owner_user_id, role')
    .eq('member_user_id', user.id)
    .eq('status', 'active')
    .single();
  if (!myMember || myMember.role !== 'captain') return res.status(403).json({ error: 'Access denied' });

  const { data, error } = await supabase
    .from('account_members')
    .select('id, email, role, roster_agent_id, managed_by')
    .eq('owner_user_id', myMember.owner_user_id)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data || []);
}
