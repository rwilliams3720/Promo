import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Only account owners can manage members
  const { data: ownerAcct } = await supabase.from('accounts').select('user_id').eq('user_id', user.id).single();
  if (!ownerAcct) return res.status(403).json({ error: 'Only account owners can manage team members.' });

  // ── GET — list members ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('account_members')
      .select('id, email, role, custom_tabs, status, created_at, member_user_id')
      .eq('owner_user_id', user.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  // ── PATCH — update role ──────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { memberId, role, custom_tabs } = req.body || {};
    if (!memberId || !role) return res.status(400).json({ error: 'memberId and role required.' });
    if (!['captain','chief_officer','bosun','custom'].includes(role))
      return res.status(400).json({ error: 'Invalid role.' });

    const { error } = await supabase
      .from('account_members')
      .update({ role, custom_tabs: custom_tabs || null })
      .eq('id', memberId)
      .eq('owner_user_id', user.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // ── DELETE — remove member ───────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const memberId = (req.query?.memberId || '').trim();
    if (!memberId) return res.status(400).json({ error: 'memberId required.' });

    // Mark removed and clear member_user_id so the auth user can no longer log in as member
    const { error } = await supabase
      .from('account_members')
      .update({ status: 'removed', member_user_id: null })
      .eq('id', memberId)
      .eq('owner_user_id', user.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
