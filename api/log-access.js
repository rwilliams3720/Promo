import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Resolve data owner — members log against the owner's account
  let dataUserId = user.id;
  const { data: memberRow } = await supabase
    .from('account_members')
    .select('owner_user_id')
    .eq('member_user_id', user.id)
    .eq('status', 'active')
    .single();
  if (memberRow) dataUserId = memberRow.owner_user_id;

  const { action, resource, record_hash, row_count, metadata } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action required' });

  try {
    await supabase.from('access_log').insert({
      user_id:       dataUserId,
      actor_user_id: user.id,
      actor_email:   user.email || null,
      action,
      resource:      resource    || 'sales_log',
      record_hash:   record_hash || null,
      row_count:     row_count   || null,
      metadata:      metadata    || null,
    });
  } catch {
    // log failure is intentionally non-fatal
  }

  return res.status(200).json({ ok: true });
}
