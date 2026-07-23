import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Sanitizes threshold_tiers input into a clean array of { count, bonus, repeat }.
// count must be a positive integer, bonus a non-negative number; invalid/empty rows
// are dropped. Capped at 20 tiers per type — plenty for any real bonus structure,
// guards against unbounded payload growth.
function sanitizeThresholdTiers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(t => ({
      count:  parseInt(t?.count, 10),
      bonus:  parseFloat(t?.bonus),
      repeat: !!t?.repeat,
    }))
    .filter(t => Number.isInteger(t.count) && t.count > 0 && !isNaN(t.bonus) && t.bonus >= 0)
    .slice(0, 20);
}

// Sanitizes assigned_agent_ids into a clean array of unique, non-empty agent_id strings.
// Not validated against the roster here (the frontend only offers real roster agents,
// and quick_adjust separately checks membership before letting anyone log against a
// type) — this just guards the column shape.
function sanitizeAgentIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(a => String(a || '').trim()).filter(Boolean))].slice(0, 200);
}

async function resolveUser(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: acct } = await supabase
    .from('accounts')
    .select('has_commissions_addon, is_admin, self_report_config')
    .eq('user_id', user.id)
    .single();

  if (acct) {
    return {
      userId: user.id, dataUserId: user.id,
      hasAddon: acct.has_commissions_addon || acct.is_admin || false,
      isMember: false, memberRole: null, memberAgentId: null,
      canApprove: true, selfReportConfig: acct.self_report_config || {},
    };
  }

  const { data: member } = await supabase
    .from('account_members')
    .select('owner_user_id, role, roster_agent_id')
    .eq('member_user_id', user.id)
    .eq('status', 'active')
    .single();
  if (!member) return null;

  const { data: ownerAcct } = await supabase
    .from('accounts')
    .select('has_commissions_addon, is_admin, self_report_config')
    .eq('user_id', member.owner_user_id)
    .single();

  const cfg = ownerAcct?.self_report_config || {};
  const isCapOrCO = ['captain', 'chief_officer'].includes(member.role);
  const hasAddon  = ownerAcct?.has_commissions_addon || ownerAcct?.is_admin || false;

  // Block access entirely if: not a captain/CO AND activities not enabled
  if (!isCapOrCO && !cfg.activities_enabled) return null;

  return {
    userId: user.id,
    dataUserId: member.owner_user_id,
    hasAddon: hasAddon || cfg.activities_enabled, // self-reporters get access even without addon
    isMember: true,
    memberRole: member.role,
    memberAgentId: member.roster_agent_id || null,
    canApprove: isCapOrCO,
    selfReportConfig: cfg,
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
        .select('id, name, category, subcategory, source, call_disposition, active, sort_order, payment, threshold_tiers, assigned_agent_ids, include_in_analysis, analysis_description, analysis_direction')
        .eq('user_id', dataUserId)
        .order('sort_order')
        .order('created_at');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    }

    if (req.query.resource === 'pending') {
      if (!ctx.canApprove) return res.status(403).json({ error: 'Approver access required' });
      const { data, error } = await supabase
        .from('bonus_activities')
        .select('id, activity_type_id, agent_id, activity_date, count, notes, status, approval_note, submitted_by')
        .eq('user_id', dataUserId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    }

    const month   = parseInt(req.query.month) || new Date().getMonth() + 1;
    const year    = parseInt(req.query.year)  || new Date().getFullYear();
    const from    = `${year}-${String(month).padStart(2,'0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to      = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    let q = supabase.from('bonus_activities')
      .select('id, activity_type_id, agent_id, activity_date, count, notes, status')
      .eq('user_id', dataUserId)
      .gte('activity_date', from)
      .lte('activity_date', to)
      .order('activity_date', { ascending: false });
    if (ctx.isMember && !ctx.canApprove && ctx.memberAgentId) {
      q = q.eq('agent_id', ctx.memberAgentId);
    }
    const { data: entries, error: eErr } = await q;
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
      const { name, category, subcategory, source, call_disposition, payment, threshold_tiers, assigned_agent_ids, include_in_analysis, analysis_description, analysis_direction } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      if (include_in_analysis && !String(analysis_description || '').trim()) {
        return res.status(400).json({ error: 'A short description is required to include this in analysis' });
      }
      const { data, error } = await supabase
        .from('bonus_activity_types')
        .insert({
          user_id:              dataUserId,
          name,
          category:             category         || 'custom',
          subcategory:          subcategory       || null,
          source:                source            || 'manual',
          call_disposition:     call_disposition  || null,
          payment:               parseFloat(payment) || 0,
          threshold_tiers:       sanitizeThresholdTiers(threshold_tiers),
          assigned_agent_ids:    sanitizeAgentIds(assigned_agent_ids),
          include_in_analysis:   !!include_in_analysis,
          analysis_description:  (analysis_description || '').trim() || null,
          analysis_direction:    analysis_direction === 'lower_better' ? 'lower_better' : 'higher_better',
        })
        .select('id, name, category, subcategory, source, call_disposition, active, sort_order, payment, threshold_tiers, assigned_agent_ids, include_in_analysis, analysis_description, analysis_direction')
        .single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'An activity type with that name already exists' });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json(data);
    }

    if (action === 'add_entry') {
      let { activity_type_id, agent_id, activity_date, count, notes } = req.body;
      // Members can only submit for themselves
      if (ctx.isMember && !ctx.canApprove) {
        if (!ctx.memberAgentId) return res.status(400).json({ error: 'No roster agent linked to your account' });
        agent_id = ctx.memberAgentId;
      }
      if (!activity_type_id || !agent_id || !activity_date) {
        return res.status(400).json({ error: 'activity_type_id, agent_id, and activity_date required' });
      }
      const status = (ctx.isMember && !ctx.canApprove && ctx.selfReportConfig?.requires_approval)
        ? 'pending' : 'approved';
      const { data, error } = await supabase
        .from('bonus_activities')
        .insert({
          user_id: dataUserId,
          activity_type_id,
          agent_id,
          activity_date,
          count: parseInt(count) || 1,
          notes: notes || null,
          status,
          submitted_by: ctx.userId,
        })
        .select('id, activity_type_id, agent_id, activity_date, count, notes, status')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data);
    }

    // Quick-count round button: +1/-1 (or a bulk delta) against a single running-total
    // row per (agent, type, current calendar month) instead of one row per press — a
    // month of clicking would otherwise create hundreds of bonus_activities rows. The
    // stable key (first of the current month) falls inside whatever range any date-range
    // consumer (Commissions, Goals — monthly/quarterly/annual) queries for "now", so no
    // other code needs to know this exists. entry_source distinguishes these rows from
    // the pre-existing one-row-per-submission manual Activity Log so the two never
    // collide/overwrite each other, while still summing together naturally everywhere
    // bonus_activities.count is totaled (they represent the same underlying activity).
    if (action === 'quick_adjust') {
      const { activity_type_id } = req.body;
      const deltaNum = parseInt(req.body.delta, 10);
      if (!activity_type_id || !Number.isInteger(deltaNum) || deltaNum === 0) {
        return res.status(400).json({ error: 'activity_type_id and a non-zero integer delta are required' });
      }
      if (Math.abs(deltaNum) > 500) return res.status(400).json({ error: 'delta too large' });

      let agentId;
      if (ctx.isMember && !ctx.canApprove) {
        if (!ctx.memberAgentId) return res.status(400).json({ error: 'No roster agent linked to your account' });
        agentId = ctx.memberAgentId;
      } else {
        agentId = req.body.agent_id;
        if (!agentId) return res.status(400).json({ error: 'agent_id required' });
      }

      const { data: type } = await supabase
        .from('bonus_activity_types')
        .select('id, assigned_agent_ids, active')
        .eq('user_id', dataUserId).eq('id', activity_type_id).single();
      if (!type || type.active === false) return res.status(404).json({ error: 'Activity type not found' });
      // Defense in depth — the frontend only ever shows assigned counters, but never
      // trust the client alone. Approvers (owner/captain/CO) can adjust any agent's
      // counter on their behalf even if not formally "assigned" to them.
      if (!ctx.canApprove && !(type.assigned_agent_ids || []).includes(agentId)) {
        return res.status(403).json({ error: 'This counter is not assigned to you' });
      }

      const now = new Date();
      const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

      // Read-modify-write with an optimistic-concurrency retry loop — a bare
      // SELECT-then-UPDATE loses increments under rapid presses (two requests both
      // read count=2, both write count=3, one +1 vanishes). The .eq('count', ...)
      // guard on the UPDATE only succeeds if nobody else changed the row since we
      // read it; a 0-row update means we lost the race, so re-read and retry. No new
      // migration needed for this — genuinely simultaneous first-ever presses (no row
      // yet, both INSERT) are a separate, much narrower race; the duplicate-row
      // consolidation check just below self-heals that case on the very next press.
      let newCount;
      for (let attempt = 0; attempt < 8; attempt++) {
        const { data: existingRows, error: selErr } = await supabase
          .from('bonus_activities')
          .select('id, count')
          .eq('user_id', dataUserId).eq('activity_type_id', activity_type_id).eq('agent_id', agentId)
          .eq('activity_date', periodStart).eq('entry_source', 'quick_count');
        if (selErr) return res.status(500).json({ error: selErr.message });

        if (existingRows && existingRows.length > 1) {
          // Extremely rare: two simultaneous first-presses both inserted. Consolidate
          // into one row now so future presses have a single source of truth again.
          const total = existingRows.reduce((s, r) => s + r.count, 0);
          const keep  = existingRows[0];
          await supabase.from('bonus_activities').delete().in('id', existingRows.slice(1).map(r => r.id));
          await supabase.from('bonus_activities').update({ count: total }).eq('id', keep.id);
          existingRows.length = 1;
          existingRows[0] = { id: keep.id, count: total };
        }
        const existing = existingRows?.[0] || null;

        if (existing) {
          newCount = Math.max(0, existing.count + deltaNum);
          const { data: updated, error } = await supabase
            .from('bonus_activities')
            .update({ count: newCount })
            .eq('id', existing.id).eq('count', existing.count)
            .select('id');
          if (error) return res.status(500).json({ error: error.message });
          if (updated && updated.length) break; // won the race
          continue; // someone else updated it first — re-read and retry
        } else {
          newCount = Math.max(0, deltaNum);
          const { error } = await supabase.from('bonus_activities').insert({
            user_id: dataUserId, activity_type_id, agent_id: agentId, activity_date: periodStart,
            count: newCount, status: 'approved', submitted_by: ctx.userId, entry_source: 'quick_count',
          });
          if (!error) break; // succeeded (or lost an insert-race, self-heals via the consolidation check above on the next press)
          continue;
        }
      }
      return res.status(200).json({ ok: true, count: newCount });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── PATCH ───────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { action, id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });

    if (action === 'update_type') {
      // Activity-type config is account-wide (incl. payout rate) — owner/captain/CO only.
      if (!ctx.canApprove) return res.status(403).json({ error: 'Approver access required' });
      const { name, category, subcategory, source, call_disposition, active, payment, threshold_tiers, assigned_agent_ids, include_in_analysis, analysis_description, analysis_direction } = req.body;
      const update = {};
      if (name                  !== undefined) update.name                  = name;
      if (category              !== undefined) update.category              = category;
      if (subcategory           !== undefined) update.subcategory           = subcategory || null;
      if (source                !== undefined) update.source                = source;
      if (call_disposition      !== undefined) update.call_disposition      = call_disposition || null;
      if (active                !== undefined) update.active                = !!active;
      if (payment               !== undefined) update.payment               = parseFloat(payment) || 0;
      if (threshold_tiers       !== undefined) update.threshold_tiers       = sanitizeThresholdTiers(threshold_tiers);
      if (assigned_agent_ids    !== undefined) update.assigned_agent_ids    = sanitizeAgentIds(assigned_agent_ids);
      if (include_in_analysis   !== undefined) update.include_in_analysis   = !!include_in_analysis;
      if (analysis_description  !== undefined) update.analysis_description  = (analysis_description || '').trim() || null;
      if (analysis_direction    !== undefined) update.analysis_direction    = analysis_direction === 'lower_better' ? 'lower_better' : 'higher_better';
      if (update.include_in_analysis && !(update.analysis_description ?? '').toString().trim()) {
        return res.status(400).json({ error: 'A short description is required to include this in analysis' });
      }
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
      // Non-approver members may only edit their OWN, not-yet-approved entries.
      if (!ctx.canApprove) {
        if (!ctx.memberAgentId) return res.status(403).json({ error: 'No roster agent linked to your account' });
        const { data: existing } = await supabase
          .from('bonus_activities')
          .select('agent_id, status')
          .eq('user_id', dataUserId).eq('id', id).single();
        if (!existing || existing.agent_id !== ctx.memberAgentId) {
          return res.status(403).json({ error: 'You can only edit your own entries' });
        }
        if (existing.status === 'approved') {
          return res.status(403).json({ error: 'Approved entries cannot be edited' });
        }
      }
      const { count, notes, activity_date, agent_id, activity_type_id } = req.body;
      const update = {};
      if (count !== undefined) update.count = parseInt(count) || 1;
      if (notes !== undefined) update.notes = notes || null;
      // Approvers (owners/managers) may also change date, agent, and type
      if (ctx.canApprove) {
        if (activity_date    !== undefined) update.activity_date    = activity_date    || null;
        if (agent_id         !== undefined) update.agent_id         = agent_id         || null;
        if (activity_type_id !== undefined) update.activity_type_id = activity_type_id || null;
      }
      if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
      const { error } = await supabase
        .from('bonus_activities')
        .update(update)
        .eq('user_id', dataUserId)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (action === 'set_status') {
      if (!ctx.canApprove) return res.status(403).json({ error: 'Approver access required' });
      const { status, approval_note } = req.body;
      if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const { error } = await supabase
        .from('bonus_activities')
        .update({ status, approval_note: approval_note || null })
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
      // Deleting a type cascades to all its entries — owner/captain/CO only.
      if (!ctx.canApprove) return res.status(403).json({ error: 'Approver access required' });
      const { error } = await supabase
        .from('bonus_activity_types')
        .delete()
        .eq('user_id', dataUserId)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (resource === 'entries') {
      // Non-approver members may only delete their OWN, not-yet-approved entries.
      if (!ctx.canApprove) {
        if (!ctx.memberAgentId) return res.status(403).json({ error: 'No roster agent linked to your account' });
        const { data: existing } = await supabase
          .from('bonus_activities')
          .select('agent_id, status')
          .eq('user_id', dataUserId).eq('id', id).single();
        if (!existing || existing.agent_id !== ctx.memberAgentId) {
          return res.status(403).json({ error: 'You can only delete your own entries' });
        }
        if (existing.status === 'approved') {
          return res.status(403).json({ error: 'Approved entries cannot be deleted' });
        }
      }
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
