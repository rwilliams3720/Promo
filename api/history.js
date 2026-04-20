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
    const { data, error } = await supabase
      .from('historical_wins')
      .select('month,rank,agent_id,name,team,total_score,gross_score,deductions')
      .eq('user_id', user.id)
      .order('month', { ascending: false })
      .order('rank',  { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const header = ['Month','Rank','AgentID','Name','Team','TotalScore','Gross','Deductions'];
    const rows   = (data || []).map(r => [
      r.month, r.rank, r.agent_id, r.name, r.team,
      r.total_score, r.gross_score, r.deductions,
    ]);

    res.status(200).json([header, ...rows]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
