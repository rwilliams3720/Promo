import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  try {
    // Resolve data owner — if requester is a team member, use the owner's user_id
    let dataUserId = user.id;
    const { data: memberRow } = await supabase
      .from('account_members')
      .select('owner_user_id')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .single();
    if (memberRow) dataUserId = memberRow.owner_user_id;

    // Fetch agent name/team from race_data for this account
    const { data: raceRows } = await supabase
      .from('race_data')
      .select('agent_id,name,team')
      .eq('user_id', dataUserId);
    const agentMeta = {};
    for (const r of (raceRows || [])) agentMeta[r.agent_id] = { name: r.name, team: r.team };

    const PAGE = 1000;
    const logs = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('call_log')
        .select('agent_id,disposition,talk_secs,call_dt,call_slot')
        .eq('user_id', dataUserId)
        .not('disposition', 'in', '(internal,other,skip)')
        .range(from, from + PAGE - 1);
      if (error) return res.status(500).json({ error: error.message });
      if (data?.length) logs.push(...data);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    const daily   = {};
    const weekly  = {};
    const monthly = {};
    const yearly  = {};
    const vmMap   = {};

    for (const row of (logs || [])) {
      const { agent_id, disposition, talk_secs, call_dt, call_slot } = row;
      if (!call_dt) continue;

      const dtStr = String(call_dt).includes('T') ? String(call_dt).split('T')[0] : String(call_dt);
      const d = new Date(dtStr + 'T12:00:00Z');
      if (isNaN(d.getTime())) continue;

      const dayKey  = `${d.getUTCMonth()+1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
      const weekKey = `${d.getUTCFullYear()} Week ${String(isoWeek(d)).padStart(2,'0')}`;
      const monKey  = `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
      const yearKey = `${d.getUTCFullYear()}`;

      const talkMin    = (talk_secs || 0) / 60;
      const isPlaced   = disposition === 'placed';
      const isAnswered = disposition === 'answered';
      const isVm       = disposition === 'voicemail';
      const isMissed   = disposition === 'missed';

      if (isVm && call_slot != null) {
        if (!vmMap[dayKey]) vmMap[dayKey] = new Array(48).fill(0);
        const slot = Math.max(0, Math.min(47, call_slot));
        vmMap[dayKey][slot]++;
      }

      if (isVm || isMissed) {
        for (const [map, key] of [[daily,dayKey],[weekly,weekKey],[monthly,monKey],[yearly,yearKey]]) {
          if (!map[key]) map[key] = {};
          if (!map[key].__race) map[key].__race = { voicemail:0, missed:0 };
          if (isVm)     map[key].__race.voicemail++;
          if (isMissed) map[key].__race.missed++;
        }
        continue;
      }

      if (!isPlaced && !isAnswered) continue;
      if (!agent_id) continue;

      for (const [map, key] of [[daily,dayKey],[weekly,weekKey],[monthly,monKey],[yearly,yearKey]]) {
        if (!map[key]) map[key] = {};
        if (!map[key][agent_id]) map[key][agent_id] = { placed:0, answered:0, talkMin:0, talkCalls:0, maxSecs:0 };
        const s = map[key][agent_id];
        if (isPlaced)   s.placed++;
        if (isAnswered) s.answered++;
        s.talkMin += talkMin;
        if ((talk_secs || 0) >= 10) s.talkCalls++;
        if ((talk_secs || 0) > s.maxSecs) s.maxSecs = talk_secs || 0;
      }
    }

    function mapToRows(periodMap) {
      const rows = [];
      for (const [period, agents] of Object.entries(periodMap)) {
        const race = agents.__race || { voicemail:0, missed:0 };
        let totPlaced = 0, totAnswered = 0, totTalkMin = 0;
        for (const [id, s] of Object.entries(agents)) {
          if (id === '__race') continue;
          const info   = agentMeta[id] || { name: id, team: 'sales' };
          const avgMin = s.talkCalls > 0 ? Math.round((s.talkMin/s.talkCalls)*100)/100 : 0;
          const maxMin = Math.round(s.maxSecs/60*100)/100;
          totPlaced   += s.placed;
          totAnswered += s.answered;
          totTalkMin  += s.talkMin;
          rows.push([period, info.name, info.team, s.placed, s.answered, 0, 0,
                     Math.round(s.talkMin*10)/10, avgMin, maxMin]);
        }
        rows.push([period, '— TEAM TOTAL —', '', totPlaced, totAnswered,
                   race.voicemail, race.missed, Math.round(totTalkMin*10)/10, 0, 0]);
      }
      return rows;
    }

    const vmSlots = Object.entries(vmMap).map(([date, counts]) => [date, ...counts]);

    res.status(200).json({
      daily:   mapToRows(daily),
      weekly:  mapToRows(weekly),
      monthly: mapToRows(monthly),
      yearly:  mapToRows(yearly),
      vmSlots,
      _debug: { rowCount: (logs || []).length },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}
