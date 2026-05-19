import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function resolveUser(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: acct } = await supabase
    .from('accounts')
    .select('has_commissions_addon, is_admin')
    .eq('user_id', user.id)
    .single();

  if (acct) {
    return { userId: user.id, dataUserId: user.id, hasAddon: acct.has_commissions_addon || acct.is_admin || false };
  }

  const { data: member } = await supabase
    .from('account_members')
    .select('owner_user_id, role')
    .eq('member_user_id', user.id)
    .eq('status', 'active')
    .single();

  if (!member || !['captain', 'chief_officer'].includes(member.role)) return null;

  const { data: ownerAcct } = await supabase
    .from('accounts')
    .select('has_commissions_addon, is_admin')
    .eq('user_id', member.owner_user_id)
    .single();

  return {
    userId: user.id,
    dataUserId: member.owner_user_id,
    hasAddon: ownerAcct?.has_commissions_addon || ownerAcct?.is_admin || false,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const ctx = await resolveUser(token);
  if (!ctx) return res.status(401).json({ error: 'Invalid token' });
  if (!ctx.hasAddon) return res.status(403).json({ error: 'Commissions add-on required' });

  const { dataUserId } = ctx;

  // ── GET ─────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (req.query.resource === 'types') {
      const { data, error } = await supabase
        .from('bonus_activity_types')
        .select('id, name, category, subcategory, source, call_disposition, active, sort_order, payment')
        .eq('user_id', dataUserId)
        .order('sort_order')
        .order('created_at');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    }

    const month   = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year    = parseInt(req.query.year)  || new Date().getFullYear();
    const from    = `${year}-${String(month).padStart(2,'0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to      = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    const { data: entries, error: eErr } = await supabase
      .from('bonus_activities')
      .select('id, activity_type_id, agent_id, activity_date, count, notes')
      .eq('user_id', dataUserId)
      .gte('activity_date', from)
      .lte('activity_date', to)
      .order('activity_date', { ascending: false });
    if (eErr) return res.status(500).json({ error: eErr.message });

    // Auto-aggregate call-type activities from call_log
    const { data: callTypes } = await supabase
      .from('bonus_activity_types')
      .select('id, name, call_disposition')
      .eq('user_id', dataUserId)
      .eq('source', 'call_log')
      .eq('active', true);

    const callTotals = [];
    if (callTypes?.length) {
      const { data: calls } = await supabase
        .from('call_log')
        .select('agent_id, disposition')
        .eq('user_id', dataUserId)
        .gte('call_dt', from)
        .lte('call_dt', to);

      for (const ct of callTypes) {
        const byAgent = {};
        for (const c of (calls || [])) {
          if (!c.agent_id) continue;
          if (ct.call_disposition && c.disposition !== ct.call_disposition) continue;
          byAgent[c.agent_id] = (byAgent[c.agent_id] || 0) + 1;
        }
        for (const [agentId, count] of Object.entries(byAgent)) {
          callTotals.push({ activity_type_id: ct.id, agent_id: agentId, count });
        }
      }
    }

    return res.status(200).json({ entries: entries || [], callTotals });
  }

  // ── POST ────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'add_type') {
      const { name, category, subcategory, source, call_disposition, payment } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      const { data, error } = await supabase
        .from('bonus_activity_types')
        .insert({
          user_id:          dataUserId,
          name,
          category:         category         || 'custom',
          subcategory:      subcategory       || null,
          source:           source            || 'manual',
          call_disposition: call_disposition  || null,
          payment:          parseFloat(payment) || 0,
        })
        .select('id, name, category, subcategory, source, call_disposition, active, sort_order, payment')
        .single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'An activity type with that name already exists' });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data);
    }

    if (action === 'add_entry') {
      const { activity_type_id, agent_id, activity_date, count, notes } = req.body;
      if (!activity_type_id || !agent_id || !activity_date) {
        return res.status(400).json({ error: 'activity_type_id, agent_id, and activity_date required' });
      }
      const { data, error } = await supabase
        .from('bonus_activities')
        .insert({
          user_id: dataUserId,
          activity_type_id,
          agent_id,
          activity_date,
          count: parseInt(count) || 1,
          notes: notes || null,
        })
        .select('id, activity_type_id, agent_id, activity_date, count, notes')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── PATCH ───────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { action, id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    if (action === 'update_type') {
      const { name, category, subcategory, source, call_disposition, active, payment } = req.body;
      const update = {};
      if (name             !== undefined) update.name             = name;
      if (category         !== undefined) update.category         = category;
      if (subcategory      !== undefined) update.subcategory      = subcategory || null;
      if (source           !== undefined) update.source           = source;
      if (call_disposition !== undefined) update.call_disposition = call_disposition || null;
      if (active           !== undefined) update.active           = !!active;
      if (payment          !== undefined) update.payment          = parseFloat(payment) || 0;
      if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
      const { error } = await supabase
        .from('bonus_activity_types')
        .update(update)
        .eq('user_id', dataUserId)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (action === 'update_entry') {
      const { count, notes } = req.body;
      const update = {};
      if (count !== undefined) update.count = parseInt(count) || 1;
      if (notes !== undefined) update.notes = notes || null;
      if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
      const { error } = await supabase
        .from('bonus_activities')
        .update(update)
        .eq('user_id', dataUserId)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { resource, id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    if (resource === 'types') {
      const { error } = await supabase
        .from('bonus_activity_types')
        .delete()
        .eq('user_id', dataUserId)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (resource === 'entries') {
      const { error } = await supabase
        .from('bonus_activities')
        .delete()
        .eq('user_id', dataUserId)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown resource' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
