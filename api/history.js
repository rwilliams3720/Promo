import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { data, error } = await supabase
      .from('historical_wins')
      .select('month,rank,agent_id,name,team,total_score,gross_score,deductions')
      .order('month', { ascending: false })
      .order('rank',  { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Return same 2-D array format the frontend expects:
    // rows[0] = header, rows[1..] = [Month, Rank, AgentID, Name, Team, TotalScore, Gross, Deductions]
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
