import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  try {
    // Resolve data owner — if requester is a team member, use the owner's user_id
    let dataUserId = user.id;
    const { data: memberRow } = await supabase
      .from('account_members')
      .select('owner_user_id')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .single();
    if (memberRow) dataUserId = memberRow.owner_user_id;

    const { data, error } = await supabase
      .from('historical_wins')
      .select('month,rank,agent_id,name,team,total_score,gross_score,deductions,wl,ul,term,health,auto,fire,placed,answered,talk_min')
      .eq('user_id', dataUserId)
      .order('month', { ascending: false })
      .order('rank',  { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({ wins: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
