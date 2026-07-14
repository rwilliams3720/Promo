import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function slugify(name) {
  return String(name).toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'').replace(/^_+|_+$/g,'');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: acct } = await supabase.from('accounts').select('user_id').eq('user_id', user.id).single();

  let userId;
  let isCaptainMember = false;
  if (acct) {
    userId = user.id;
  } else {
    const { data: memberRow } = await supabase
      .from('account_members')
      .select('owner_user_id, role')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .single();
    if (!memberRow || memberRow.role !== 'captain') return res.status(403).json({ error: 'Owner access required' });
    userId = memberRow.owner_user_id;
    isCaptainMember = true;
  }

  if (req.method === 'GET') {
    if (isCaptainMember) return res.status(403).json({ error: 'Owner access required' });
    const { data, error } = await supabase
      .from('agent_roster')
      .select('id, agent_id, name, active, commission_structure_id, commission_all_must_qualify, commission_cap_total, team, created_at')
      .eq('user_id', userId)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    if (isCaptainMember) return res.status(403).json({ error: 'Owner access required' });
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const agent_id = slugify(name);
    if (!agent_id) return res.status(400).json({ error: 'Invalid name' });
    const { data, error } = await supabase
      .from('agent_roster')
      .insert({ user_id: userId, agent_id, name })
      .select('id, agent_id, name, active, created_at')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Agent already exists' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    if (req.body.action === 'set_team') {
      const { agent_id, team } = req.body;
      if (!agent_id || !['sales', 'service'].includes(team)) return res.status(400).json({ error: 'agent_id and team required' });
      const { error } = await supabase.from('agent_roster').update({ team }).eq('user_id', userId).eq('agent_id', agent_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (isCaptainMember) return res.status(403).json({ error: 'Owner access required' });

    if (req.body.action === 'add_commission_structure') {
      const { agent_id, commission_structure_id } = req.body;
      if (!agent_id || !commission_structure_id) return res.status(400).json({ error: 'agent_id and commission_structure_id required' });
      const { data: existingRows } = await supabase.from('agent_commission_structures').select('sort_order').eq('user_id', userId).eq('agent_id', agent_id).order('sort_order', { ascending: false }).limit(1);
      const nextOrder = existingRows?.length ? (existingRows[0].sort_order + 1) : 0;
      const { error } = await supabase.from('agent_commission_structures').upsert({ user_id: userId, agent_id, commission_structure_id, sort_order: nextOrder }, { onConflict: 'user_id,agent_id,commission_structure_id' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.body.action === 'remove_commission_structure') {
      const { agent_id, commission_structure_id } = req.body;
      if (!agent_id || !commission_structure_id) return res.status(400).json({ error: 'agent_id and commission_structure_id required' });
      const { error } = await supabase.from('agent_commission_structures').delete().eq('user_id', userId).eq('agent_id', agent_id).eq('commission_structure_id', commission_structure_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.body.action === 'update_qualifier') {
      const { id, commission_all_must_qualify } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await supabase.from('agent_roster').update({ commission_all_must_qualify: !!commission_all_must_qualify }).eq('user_id', userId).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.body.action === 'update_cap_total') {
      const { agent_id, commission_cap_total } = req.body;
      if (!agent_id) return res.status(400).json({ error: 'agent_id required' });
      const { error } = await supabase.from('agent_roster')
        .update({ commission_cap_total: commission_cap_total ?? null })
        .eq('user_id', userId).eq('agent_id', agent_id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    const { id, name, active, commission_structure_id, agent_id: bodyAgentId } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const update = {};
    if (name !== undefined) update.name = name;
    if (active !== undefined) update.active = active;
    if ('commission_structure_id' in (req.body || {})) update.commission_structure_id = commission_structure_id || null;
    const { error } = await supabase
      .from('agent_roster')
      .update(update)
      .eq('user_id', userId)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    if (name !== undefined && bodyAgentId) {
      await supabase.from('race_data').update({ name }).eq('user_id', userId).eq('agent_id', bodyAgentId);
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (isCaptainMember) return res.status(403).json({ error: 'Owner access required' });
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase
      .from('agent_roster')
      .delete()
      .eq('user_id', userId)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
