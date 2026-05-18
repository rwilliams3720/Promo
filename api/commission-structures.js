import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const SELECT = 'id, name, default_split_ratio, pay_on_issue, thresholds, rates, created_at';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: acct } = await supabase
    .from('accounts')
    .select('user_id, has_commissions_addon, is_admin')
    .eq('user_id', user.id)
    .single();
  if (!acct) return res.status(403).json({ error: 'Owner access required' });
  if (!acct.has_commissions_addon && !acct.is_admin) {
    return res.status(403).json({ error: 'Commissions add-on required' });
  }

  const userId = user.id;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('commission_structures')
      .select(SELECT)
      .eq('user_id', userId)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const { name, default_split_ratio, pay_on_issue, thresholds, rates } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabase
      .from('commission_structures')
      .insert({
        user_id: userId,
        name,
        default_split_ratio: default_split_ratio ?? 0.5,
        pay_on_issue: pay_on_issue ?? false,
        thresholds: thresholds || [],
        rates: rates || {},
      })
      .select(SELECT)
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A structure with that name already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { id, name, default_split_ratio, pay_on_issue, thresholds, rates } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const update = {};
    if (name !== undefined)                update.name = name;
    if (default_split_ratio !== undefined) update.default_split_ratio = default_split_ratio;
    if (pay_on_issue !== undefined)        update.pay_on_issue = !!pay_on_issue;
    if (thresholds !== undefined)          update.thresholds = thresholds;
    if (rates !== undefined)               update.rates = rates;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No updatable fields provided' });
    const { data, error } = await supabase
      .from('commission_structures')
      .update(update)
      .eq('user_id', userId)
      .eq('id', id)
      .select(SELECT)
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A structure with that name already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase
      .from('commission_structures')
      .delete()
      .eq('user_id', userId)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
