import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Parse "April 2025" → Date representing the first of that month
function parseMonthStr(str) {
  if (!str) return null;
  const s = String(str).trim();
  const yearMatch = s.match(/\d{4}/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[0]);
  const idx   = MONTH_NAMES.findIndex(m => s.toLowerCase().includes(m.toLowerCase()));
  if (idx === -1) return null;
  return new Date(Date.UTC(year, idx, 1));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Accept Vercel cron (no auth header) or admin JWT
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const isCron = req.headers['x-vercel-cron'] === '1';

  if (!isCron) {
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });
    const { data: adminRow } = await supabase.from('accounts').select('is_admin').eq('user_id', user.id).single();
    if (!adminRow?.is_admin) return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Fetch all distinct (user_id, month) pairs from historical_wins
    const { data: rows, error } = await supabase
      .from('historical_wins')
      .select('user_id,month');
    if (error) return res.status(500).json({ error: error.message });

    const cutoff = new Date();
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 12);

    let deleted = 0;
    const seen  = new Set();
    for (const row of (rows || [])) {
      const key = row.user_id + '|' + row.month;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = parseMonthStr(row.month);
      if (d && d < cutoff) {
        await supabase.from('historical_wins')
          .delete()
          .eq('user_id', row.user_id)
          .eq('month', row.month);
        deleted++;
      }
    }

    return res.status(200).json({ success: true, deleted, cutoff: cutoff.toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
