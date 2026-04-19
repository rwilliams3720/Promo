import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const AGENT_INFO = {
  ashley:  { name:'Ashley McEniry',    team:'service' },
  fiona:   { name:'Fiona Rodriguez',   team:'service' },
  jocelyn: { name:'Jocelyn Hernandez', team:'service' },
  joseph:  { name:'Joseph Underwood',  team:'sales'   },
  peyton:  { name:'Peyton Tooze',      team:'sales'   },
  susan:   { name:'Susan Navarro',     team:'sales'   },
  tiffany: { name:'Tiffany Dabe',      team:'sales'   },
  tracy:   { name:'Tracy Ankrah',      team:'service' },
  amin:    { name:'Amin Kalas',        team:'sales'   },
  andy:    { name:'Andy Rose',         team:'service' },
  russel:  { name:'Russel Williams',   team:'service' },
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { data: logs, error } = await supabase
      .from('call_log')
      .select('agent_id,disposition,talk_secs,call_dt,call_slot')
      .not('disposition', 'in', '("internal","other","skip")');

    if (error) return res.status(500).json({ error: error.message });

    const daily   = {};
    const weekly  = {};
    const monthly = {};
    const yearly  = {};
    const vmMap   = {};

    for (const row of (logs || [])) {
      const { agent_id, disposition, talk_secs, call_dt, call_slot } = row;
      if (!call_dt) continue;

      // Parse as UTC date to avoid timezone-shifted day boundaries
      const d = new Date(call_dt + 'T12:00:00Z');
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

      // Heatmap: voicemail by date × half-hour slot
      if (isVm && call_slot != null) {
        if (!vmMap[dayKey]) vmMap[dayKey] = new Array(48).fill(0);
        const slot = Math.max(0, Math.min(47, call_slot));
        vmMap[dayKey][slot]++;
      }

      // Race-wide voicemail/missed — attach to each period under __race key
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
      if (!agent_id || !AGENT_INFO[agent_id]) continue;

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

    // Row format: [period, agentName, team, placed, answered, voicemail, missed, talkMin, avgMin, maxCall]
    // "— TEAM TOTAL —" row: [period, '— TEAM TOTAL —', '', 0, 0, raceVm, raceMissed, 0, 0, 0]
    function mapToRows(periodMap) {
      const rows = [];
      for (const [period, agents] of Object.entries(periodMap)) {
        const race = agents.__race || { voicemail:0, missed:0 };
        for (const [id, s] of Object.entries(agents)) {
          if (id === '__race') continue;
          const info   = AGENT_INFO[id];
          const avgMin = s.talkCalls > 0 ? Math.round((s.talkMin/s.talkCalls)*100)/100 : 0;
          const maxMin = Math.round(s.maxSecs/60*100)/100;
          rows.push([period, info.name, info.team, s.placed, s.answered, 0, 0,
                     Math.round(s.talkMin*10)/10, avgMin, maxMin]);
        }
        rows.push([period, '— TEAM TOTAL —', '', 0, 0, race.voicemail, race.missed, 0, 0, 0]);
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
