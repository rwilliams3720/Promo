import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const WRITE_ROLES = ['captain', 'chief_officer'];
const POLICY_PRODUCTS = ['wl', 'ul', 'term', 'health', 'auto', 'fire'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  let dataUserId = user.id;
  let isMember   = false;
  let memberRole = null;
  let memberAgentId = null;
  let isAdmin    = false;

  const { data: acctRow } = await supabase
    .from('accounts').select('is_admin').eq('user_id', user.id).single();

  if (!acctRow) {
    const { data: memberRow } = await supabase
      .from('account_members')
      .select('owner_user_id, role, roster_agent_id')
      .eq('member_user_id', user.id).eq('status', 'active').single();
    if (!memberRow) return res.status(403).json({ error: 'No account found' });
    dataUserId    = memberRow.owner_user_id;
    isMember      = true;
    memberRole    = memberRow.role;
    memberAgentId = memberRow.roster_agent_id;
  } else {
    isAdmin = !!acctRow.is_admin;
  }

  const canWrite = !isMember || WRITE_ROLES.includes(memberRole) || isAdmin;

  // GET — list goals
  if (req.method === 'GET') {
    let q = supabase.from('agent_goals')
      .select('*').eq('user_id', dataUserId)
      .order('period_start', { ascending: false });

    // Members who can't write only see their own agent's goals
    if (isMember && !canWrite && memberAgentId) {
      q = q.eq('agent_id', memberAgentId);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    if (req.query.withActuals === '1') {
      return res.status(200).json(await computeActuals(data || [], dataUserId));
    }
    return res.status(200).json(data || []);
  }

  // POST — create / upsert
  if (req.method === 'POST') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const { agent_id, period_type, period_label, period_start, period_end, goals, is_public } = req.body || {};
    if (!agent_id || !period_type || !period_label || !period_start || !period_end) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const valid = ['monthly', 'quarterly', 'semi_annual', 'annual'];
    if (!valid.includes(period_type)) return res.status(400).json({ error: 'Invalid period_type' });

    const { is_recurring } = req.body || {};
    const { data, error } = await supabase.from('agent_goals').upsert({
      user_id: dataUserId,
      agent_id, period_type, period_label,
      period_start, period_end,
      goals: goals || {},
      is_public:     !!is_public,
      is_recurring:  !!is_recurring,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,agent_id,period_type,period_label' }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // PATCH — update fields
  if (req.method === 'PATCH') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const { id, goals, is_public, is_recurring, period_start, period_end } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const update = { updated_at: new Date().toISOString() };
    if (goals        !== undefined) update.goals       = goals;
    if (is_public    !== undefined) update.is_public   = !!is_public;
    if (is_recurring !== undefined) update.is_recurring = !!is_recurring;
    if (period_start)               update.period_start = period_start;
    if (period_end)                 update.period_end   = period_end;
    const { error } = await supabase.from('agent_goals')
      .update(update).eq('id', id).eq('user_id', dataUserId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // DELETE
  if (req.method === 'DELETE') {
    if (!canWrite) return res.status(403).json({ error: 'Insufficient role' });
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase.from('agent_goals')
      .delete().eq('id', id).eq('user_id', dataUserId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function currentPeriodDates(periodType) {
  const now = new Date();
  const yr  = now.getUTCFullYear();
  const mo  = now.getUTCMonth();
  if (periodType === 'monthly') {
    const s = new Date(Date.UTC(yr, mo, 1)), e = new Date(Date.UTC(yr, mo + 1, 0));
    return { start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10) };
  }
  if (periodType === 'quarterly') {
    const q = Math.floor(mo / 3);
    const s = new Date(Date.UTC(yr, q*3, 1)), e = new Date(Date.UTC(yr, q*3+3, 0));
    return { start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10) };
  }
  if (periodType === 'semi_annual') {
    const h = mo < 6 ? 0 : 1;
    const s = new Date(Date.UTC(yr, h*6, 1)), e = new Date(Date.UTC(yr, h*6+6, 0));
    return { start: s.toISOString().slice(0,10), end: e.toISOString().slice(0,10) };
  }
  const s = `${yr}-01-01`, e = `${yr}-12-31`;
  return { start: s, end: e };
}

async function computeActuals(goals, dataUserId) {
  if (!goals.length) return goals;

  // Recurring goals use the current period's date range for actuals
  const effective = goals.map(g => {
    if (!g.is_recurring) return g;
    const curr = currentPeriodDates(g.period_type);
    return { ...g, _eff_start: curr.start, _eff_end: curr.end };
  });

  const minStart = effective.reduce((m, g) => (g._eff_start||g.period_start) < m ? (g._eff_start||g.period_start) : m, effective[0]._eff_start||effective[0].period_start);
  const maxEnd   = effective.reduce((m, g) => (g._eff_end  ||g.period_end  ) > m ? (g._eff_end  ||g.period_end  ) : m, effective[0]._eff_end  ||effective[0].period_end  );

  const [salesRes, actRes] = await Promise.all([
    supabase.from('sales_log')
      .select('agent_id, product, written_premium, sale_date, is_cancelled')
      .eq('user_id', dataUserId)
      .gte('sale_date', minStart)
      .lte('sale_date', maxEnd),
    supabase.from('bonus_activities')
      .select('agent_id, activity_type_id, count, activity_date')
      .eq('user_id', dataUserId)
      .eq('status', 'approved')
      .gte('activity_date', minStart)
      .lte('activity_date', maxEnd),
  ]);

  const salesRows = (salesRes.data || []).filter(s => !s.is_cancelled);
  const actRows   = actRes.data || [];

  return effective.map(goal => {
    const pStart  = goal._eff_start || goal.period_start;
    const pEnd    = goal._eff_end   || goal.period_end;
    const agSales = salesRows.filter(s => s.agent_id === goal.agent_id && s.sale_date >= pStart && s.sale_date <= pEnd);
    const agActs  = actRows.filter(a => a.agent_id === goal.agent_id && a.activity_date >= pStart && a.activity_date <= pEnd);

    const actuals = {};
    for (const prod of POLICY_PRODUCTS) {
      if (goal.goals[prod] !== undefined) {
        actuals[prod] = agSales.filter(s => s.product === prod).length;
      }
    }
    if (goal.goals.policies !== undefined) {
      actuals.policies = agSales.filter(s => POLICY_PRODUCTS.includes(s.product)).length;
    }
    if (goal.goals.premium !== undefined) {
      actuals.premium = agSales.reduce((s, r) => s + (parseFloat(r.written_premium) || 0), 0);
    }
    for (const key of Object.keys(goal.goals)) {
      if (!key.startsWith('activity_')) continue;
      const typeId = key.replace('activity_', '');
      actuals[key] = agActs.filter(a => a.activity_type_id === typeId).reduce((s, a) => s + (a.count || 0), 0);
    }
    return { ...goal, actuals };
  });
}
