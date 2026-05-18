import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

  const { data: acct } = await supabase
    .from('accounts')
    .select('is_admin, has_member_analysis, has_sales_addon, plan, status, trial_ends_at, member_hours_data')
    .eq('user_id', dataUserId)
    .single();

  if (!acct) return res.status(500).json({ error: 'Account not found' });

  const trialExpired = acct.status === 'trial' && acct.trial_ends_at && new Date(acct.trial_ends_at) < new Date();
  const isPro = ['pro', 'premium'].includes(acct.plan) && !trialExpired && ['paid', 'deferred'].includes(acct.status);
  const allowed = acct.is_admin || acct.has_member_analysis || acct.has_sales_addon || isPro;
  if (!allowed) return res.status(403).json({ error: 'Feature not available on current plan' });

  // ── GET: return hours data ────────────────────────────────────────────────
  if (req.method === 'GET') {
    return res.status(200).json({ periods: acct.member_hours_data?.periods || [] });
  }

  // ── POST: save a period ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { period, rows } = req.body || {};
    if (!period?.trim()) return res.status(400).json({ error: 'Period label required' });
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows provided' });

    const cleaned = rows
      .map(r => ({
        agent_name: (r.agent_name || '').trim(),
        agent_id:   r.agent_id || null,
        hours:      parseFloat(r.hours) || 0,
      }))
      .filter(r => r.agent_name && r.hours > 0);

    if (!cleaned.length) return res.status(400).json({ error: 'No valid rows after filtering' });

    const existing = acct.member_hours_data?.periods || [];
    const filtered = existing.filter(p => p.period !== period.trim());
    const newPeriod = {
      period:      period.trim(),
      uploaded_at: new Date().toISOString(),
      rows:        cleaned,
    };
    const updated = [...filtered, newPeriod].sort((a, b) => a.period.localeCompare(b.period));

    const { error: updateErr } = await supabase
      .from('accounts')
      .update({
        member_hours_data:      { periods: updated },
        member_analysis_cache:  null,
        member_analysis_at:     null,
      })
      .eq('user_id', dataUserId);

    if (updateErr) return res.status(500).json({ error: updateErr.message });
    return res.status(200).json({ ok: true, periods: updated });
  }

  // ── DELETE: remove a period ───────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const period = req.query.period;
    if (!period) return res.status(400).json({ error: 'Period required' });
    const existing = acct.member_hours_data?.periods || [];
    const updated  = existing.filter(p => p.period !== period);

    const { error } = await supabase
      .from('accounts')
      .update({
        member_hours_data:      { periods: updated },
        member_analysis_cache:  null,
        member_analysis_at:     null,
      })
      .eq('user_id', dataUserId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, periods: updated });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
