import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import crypto from 'crypto';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

async function fetchAllPages(client, table, columns, userId) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from(table)
      .select(columns).eq('user_id', userId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (data?.length) rows.push(...data);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// Agent IDs are slugs of the display name: "Jane Smith" → "jane_smith"
function slugify(name) {
  return String(name).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '');
}

// Synonyms for sales report column detection — ordered by priority
const SALES_COL_SYNONYMS = {
  product:         ['Product','Line of Business','LOB','Coverage','Policy Line','Insurance Type','Product Type'],
  written_by:      ['Written By','Agent','Producer','Rep','Sold By','CSR','Agent Name','Producer Name','Writing Agent','Advisor'],
  written_date:    ['Written Date','Sale Date','Effective Date','Policy Date','Issue Date','Date Written','Bind Date','Close Date'],
  policy_name:     ['Policy Name','Insured','Insured Name','Client Name','Customer','Policy #','Policy Number','Client','Member Name'],
  policy_type:     ['Policy Type','Sub Type','Plan Type','Coverage Type','Product Category','Type','Sub-Type'],
  written_premium: ['Written Premium','Written Prem','WP','Prem Written','Premium','Prem'],
  details:         ['Details','Vehicle','Vehicle Description','Description','Notes','Memo'],
};


// ─── HANDLER ────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });
  const userId = user.id;

  try {
    const body      = req.body || {};
    const fileType  = body.type  || body.fileType;
    const columnMap = body.columnMap || null;

    if (fileType === 'setteam') return res.json({ success: true });

    let rows;
    if (body.data != null) {
      rows = Array.isArray(body.data) ? body.data
           : typeof body.data === 'string' ? JSON.parse(body.data) : null;
    } else if (body.fileBase64) {
      const buffer = Buffer.from(body.fileBase64, 'base64');
      rows = parseFile(buffer);
    } else {
      return res.status(400).json({ error: 'No file data provided.' });
    }

    if (!rows || rows.length === 0) {
      return res.json({ success: false, error: 'Could not parse file. Ensure it is a valid .xlsx or .xls file.' });
    }

    const result = fileType === 'sales'
      ? await processSalesUpload(rows, userId, columnMap)
      : await processCallUpload(rows, userId);

    return res.json(result);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


// ─── XLSX PARSING ───────────────────────────────────────────────
function parseFile(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    let bestSheet = wb.Sheets[wb.SheetNames[0]];
    let bestLen   = 0;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
      if (rows.length > bestLen) { bestLen = rows.length; bestSheet = wb.Sheets[name]; }
    }
    return XLSX.utils.sheet_to_json(bestSheet, { header: 1, defval: '', raw: false });
  } catch (e) {
    console.error('parseFile error:', e.message);
    return [];
  }
}


// ─── CALL UPLOAD ────────────────────────────────────────────────
async function processCallUpload(rows, userId) {
  let hasHeader = false;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    if (rows[r].join('|').includes('Call Direction')) { hasHeader = true; break; }
  }
  if (!hasHeader) return { success: false, error: 'No "Call Direction" header found. Upload the Search Call Details report.' };

  const dataMonth = detectMonth(rows);
  const calMonth  = MONTH_NAMES[new Date().getMonth()] + ' ' + new Date().getFullYear();

  if (dataMonth && compareMonths(dataMonth, calMonth) > 0) {
    return { success: false, error: `File is for ${dataMonth} which hasn't started yet.` };
  }

  const { data: cfgRow } = await supabase.from('race_config')
    .select('value').eq('user_id', userId).eq('key', 'current_month').single();
  const storedMonth = cfgRow?.value || '';

  if (dataMonth && storedMonth) {
    const cmp = compareMonths(dataMonth, storedMonth);
    if (cmp > 0) {
      await archiveToHistorical(storedMonth, userId);
      await resetRaceScores(userId);
      await supabase.from('race_config').upsert(
        { user_id: userId, key: 'current_month', value: dataMonth },
        { onConflict: 'user_id,key' }
      );
    } else if (cmp < 0) {
      const hashes = await fetchAllPages(supabase, 'call_log', 'hash', userId);
      const known = Object.fromEntries(hashes.map(r => [r.hash, true]));
      const classified = classifyCalls(rows, known);
      if (!classified.newLogRows.length) {
        return { success: true, message: `No calls found in ${dataMonth}.`, new: 0, skipped: classified.duplicatesSkipped };
      }
      // Build agentMeta from race_data + newly discovered agents
      const { data: existingRD } = await supabase.from('race_data').select('agent_id,name,team').eq('user_id', userId);
      const agentMeta = {};
      for (const r of (existingRD || [])) agentMeta[r.agent_id] = { name: r.name, team: r.team };
      for (const [id, name] of Object.entries(classified.discoveredAgents)) {
        if (!agentMeta[id]) agentMeta[id] = { name, team: 'sales' };
      }
      const totals = aggregateFromLog(classified.newLogRows, agentMeta);
      await archiveCallStatsToHistorical(dataMonth, totals, userId);
      return { success: true, message: `${dataMonth} call data archived. Current race (${storedMonth}) unchanged.`, archived: true };
    }
  } else if (dataMonth && !storedMonth) {
    await supabase.from('race_config').upsert(
      { user_id: userId, key: 'current_month', value: dataMonth },
      { onConflict: 'user_id,key' }
    );
  }

  const hashRows = await fetchAllPages(supabase, 'call_log', 'hash', userId);
  const knownHashes = Object.fromEntries(hashRows.map(r => [r.hash, true]));

  const classified = classifyCalls(rows, knownHashes);

  if (classified.newLogRows.length) {
    const logInserts = classified.newLogRows.map(r => ({
      user_id:     userId,
      hash:        r[0],
      agent_id:    r[1] || null,
      disposition: r[2],
      talk_secs:   r[3] ? Math.round(r[3] * 60) : null,
      call_dt:     r[4] || null,
      call_slot:   r[5] != null ? r[5] : null,
    }));
    const { error: logErr } = await supabase.from('call_log').upsert(logInserts, { onConflict: 'user_id,hash', ignoreDuplicates: true });
    if (logErr) return { success: false, error: 'call_log write failed: ' + logErr.message };
  }

  // Seed race_data rows for any newly discovered agents
  const { error: seedErr } = await ensureRaceDataRows(userId, classified.discoveredAgents);
  if (seedErr) return { success: false, error: 'race_data seed failed: ' + seedErr.message };

  // Fetch race_data for agentMeta (name/team) after seeding
  const { data: raceRows } = await supabase.from('race_data').select('agent_id,name,team').eq('user_id', userId);
  const agentMeta = {};
  for (const r of (raceRows || [])) agentMeta[r.agent_id] = { name: r.name, team: r.team };

  const allLog = await fetchAllPages(supabase, 'call_log', 'agent_id,disposition,talk_secs,call_dt', userId);
  const allLogRows = allLog.map(r => [
    '', r.agent_id || '', r.disposition, r.talk_secs ? r.talk_secs / 60 : 0, r.call_dt || '', ''
  ]);
  const totals = aggregateFromLog(allLogRows, agentMeta);

  const now = new Date().toISOString();
  for (const id in totals.agents) {
    const s = totals.agents[id];
    await supabase.from('race_data').update({
      placed:       s.placed,
      answered:     s.answered,
      talk_min:     s.talkMin,
      avg_min:      s.avgMin,
      last_updated: now,
    }).eq('user_id', userId).eq('agent_id', id);
  }
  // Apply race-wide deductions to all agents for this account
  await supabase.from('race_data').update({
    race_wide_missed:    totals.raceWide.missed,
    race_wide_voicemail: totals.raceWide.voicemails,
    last_updated:        now,
  }).eq('user_id', userId);

  return {
    success:  true,
    message:  classified.newLogRows.length ? 'Call report processed successfully.' : 'No new calls — race data recalculated.',
    new:      classified.newLogRows.length,
    skipped:  classified.duplicatesSkipped,
    raceWide: totals.raceWide,
    _cols:    classified.colsFound,
  };
}


// ─── SALES UPLOAD ───────────────────────────────────────────────
async function processSalesUpload(rows, userId, columnMap) {
  // Auto-detect header row
  let headerIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const s = rows[r].join('|');
    if (s.includes('Product') || s.includes('Written By') || s.includes('Agent') ||
        s.includes('Producer') || s.includes('Line of Business')) {
      headerIdx = r; break;
    }
  }
  if (headerIdx === -1) return { success: false, error: 'No recognisable sales report header found.' };

  const headers = rows[headerIdx].map(h => String(h).trim());

  // Resolve column indices: use provided columnMap first, then auto-detect
  const colIdx = {};
  if (columnMap) {
    for (const [field, headerName] of Object.entries(columnMap)) {
      const idx = headers.findIndex(h => h.toLowerCase() === String(headerName).toLowerCase());
      if (idx !== -1) colIdx[field] = idx;
    }
  }
  for (const [field, synonyms] of Object.entries(SALES_COL_SYNONYMS)) {
    if (colIdx[field] !== undefined) continue;
    for (const syn of synonyms) {
      const idx = headers.findIndex(h => h.toLowerCase().includes(syn.toLowerCase()));
      if (idx !== -1) { colIdx[field] = idx; break; }
    }
  }

  const required = ['product', 'written_by', 'written_date'];
  const missing  = required.filter(f => colIdx[f] === undefined);
  if (missing.length > 0) {
    return { needsMapping: true, headers, missing };
  }

  // Remove any rows with malformed dates (pre-2000) caused by prior date-parsing bugs
  await supabase.from('sales_log').delete().eq('user_id', userId).lt('sale_date', '2000-01-01');

  const salesMonth = detectSalesMonth(rows, headerIdx, colIdx.written_date);

  if (salesMonth) {
    const [monthName, yearStr] = salesMonth.split(' ');
    const monthIdx = MONTH_NAMES.indexOf(monthName);
    if (monthIdx !== -1) {
      const year = parseInt(yearStr);
      const from = `${year}-${String(monthIdx + 1).padStart(2, '0')}-01`;
      const to   = monthIdx === 11
        ? `${year + 1}-01-01`
        : `${year}-${String(monthIdx + 2).padStart(2, '0')}-01`;
      await supabase.from('sales_log')
        .delete()
        .eq('user_id', userId)
        .gte('sale_date', from)
        .lt('sale_date', to);
    }
  }

  const classified = classifySales(rows, headerIdx, colIdx, {});

  if (classified.newLogRows.length > 0) {
    const logInserts = classified.newLogRows.map(r => ({
      user_id:         userId,
      hash:            r[0],
      agent_id:        r[1] !== 'skip' ? r[1] : null,
      product:         r[2],
      sale_date:       r[3] || null,
      written_premium: r[4] ?? null,
    }));
    const { error: sLogErr } = await supabase.from('sales_log').upsert(logInserts, { onConflict: 'user_id,hash', ignoreDuplicates: true });
    if (sLogErr) return { success: false, error: 'sales_log write failed: ' + sLogErr.message };
  }

  // Seed race_data rows for newly discovered agents before updating
  const { error: sSeedErr } = await ensureRaceDataRows(userId, classified.discoveredAgents);
  if (sSeedErr) return { success: false, error: 'race_data seed failed: ' + sSeedErr.message };

  const allSales = await fetchAllPages(supabase, 'sales_log', 'agent_id,product', userId);
  const allSalesRows = allSales.map(r => ['', r.agent_id || 'skip', r.product || 'other', '', '']);
  const agentTotals  = aggregateSalesFromLog(allSalesRows);

  const now = new Date().toISOString();
  for (const id in agentTotals) {
    const s = agentTotals[id];
    await supabase.from('race_data').update({
      wl: s.wl, ul: s.ul, term: s.term, health: s.health, auto: s.auto, fire: s.fire,
      last_updated: now,
    }).eq('user_id', userId).eq('agent_id', id);
  }

  return {
    success: true,
    message: classified.newLogRows.length === 0
      ? 'Sales processed — totals refreshed.'
      : 'Sales report processed successfully.',
    new:     classified.newLogRows.length,
    skipped: classified.duplicatesSkipped,
  };
}


// ─── RACE DATA SEED ─────────────────────────────────────────────
// discoveredAgents: { [agentId]: displayName }
// ignoreDuplicates preserves existing name/team set by prior uploads or user
async function ensureRaceDataRows(userId, discoveredAgents) {
  if (!discoveredAgents || !Object.keys(discoveredAgents).length) return { error: null };
  const rows = Object.entries(discoveredAgents).map(([id, name]) => ({
    user_id:             userId,
    agent_id:            id,
    name,
    team:                'sales',
    wl: 0, ul: 0, term: 0, health: 0, auto: 0, fire: 0,
    placed: 0, answered: 0, missed: 0, voicemail: 0,
    talk_min: 0, avg_min: 0,
    race_wide_missed: 0, race_wide_voicemail: 0,
  }));
  return supabase.from('race_data').upsert(rows, { onConflict: 'user_id,agent_id', ignoreDuplicates: true });
}


// ─── MONTH MANAGEMENT ───────────────────────────────────────────
async function fetchScoringConfig(userId) {
  const { data, error } = await supabase.from('scoring_config').select('config_key,config_value').eq('user_id', userId);
  if (error) console.warn('fetchScoringConfig: Supabase error, using defaults:', error.message);
  const cfg = {};
  if (data) for (const row of data) cfg[row.config_key] = parseFloat(row.config_value);
  return {
    wl:               cfg.wl               ?? 100,
    ul:               cfg.ul               ?? 75,
    term:             cfg.term             ?? 50,
    health:           cfg.health           ?? 30,
    auto:             cfg.auto             ?? 15,
    fire:             cfg.fire             ?? 10,
    placed_sales:     cfg.placed_sales     ?? 1,
    placed_service:   cfg.placed_service   ?? 0.25,
    answered_sales:   cfg.answered_sales   ?? 1,
    answered_service: cfg.answered_service ?? 5,
    talk_per_min:     cfg.talk_per_min     ?? 0.1,
    avg_min:          cfg.avg_min          ?? 2,
    missed_deduct:    cfg.missed_deduct    ?? -3,
    voicemail_deduct: cfg.voicemail_deduct ?? -2,
  };
}

async function archiveToHistorical(month, userId) {
  const { data: raceRows } = await supabase.from('race_data').select('*').eq('user_id', userId);
  if (!raceRows?.length) return;

  const sc     = await fetchScoringConfig(userId);
  const rwMissed = raceRows[0]?.race_wide_missed    || 0;
  const rwVm     = raceRows[0]?.race_wide_voicemail || 0;

  const scored = raceRows.map(r => {
    const svc    = r.team === 'service';
    const polPts  = (r.wl||0)*sc.wl + (r.ul||0)*sc.ul + (r.term||0)*sc.term + (r.health||0)*sc.health + (r.auto||0)*sc.auto + (r.fire||0)*sc.fire;
    const callPts = (r.placed||0)*(svc?sc.placed_service:sc.placed_sales) + (r.answered||0)*(svc?sc.answered_service:sc.answered_sales) + (+r.talk_min||0)*sc.talk_per_min + (+r.avg_min||0)*sc.avg_min;
    const gross  = Math.round(polPts + callPts);
    const deduct = Math.round(rwMissed*sc.missed_deduct + rwVm*sc.voicemail_deduct);
    return { ...r, gross, deduct, total: Math.max(0, gross + deduct) };
  }).sort((a, b) => b.total - a.total);

  await supabase.from('historical_wins').delete().eq('user_id', userId).eq('month', month);
  await supabase.from('historical_wins').insert(scored.map((s, i) => ({
    user_id: userId,
    month, rank: i+1, agent_id: s.agent_id, name: s.name, team: s.team,
    total_score: s.total, gross_score: s.gross, deductions: s.deduct,
    wl: s.wl||0, ul: s.ul||0, term: s.term||0, health: s.health||0,
    auto: s.auto||0, fire: s.fire||0,
    placed: s.placed||0, answered: s.answered||0, missed: s.missed||0,
    voicemail: s.voicemail||0, talk_min: s.talk_min||0, avg_min: s.avg_min||0,
    race_wide_missed: rwMissed, race_wide_voicemail: rwVm,
  })));
}

async function archiveCallStatsToHistorical(month, totals, userId) {
  const sc       = await fetchScoringConfig(userId);
  const rwMissed = totals.raceWide.missed;
  const rwVm     = totals.raceWide.voicemails;

  const scored = Object.values(totals.agents).map(s => {
    const svc    = s.team === 'service';
    const callPts = s.placed*(svc?sc.placed_service:sc.placed_sales)+s.answered*(svc?sc.answered_service:sc.answered_sales)+s.talkMin*sc.talk_per_min+s.avgMin*sc.avg_min;
    const gross  = Math.round(callPts);
    const deduct = Math.round(rwMissed*sc.missed_deduct + rwVm*sc.voicemail_deduct);
    return { ...s, gross, deduct, total: Math.max(0, gross + deduct) };
  }).sort((a, b) => b.total - a.total);

  await supabase.from('historical_wins').delete().eq('user_id', userId).eq('month', month);
  await supabase.from('historical_wins').insert(scored.map((s, i) => ({
    user_id: userId,
    month, rank: i+1, agent_id: s.id, name: s.name, team: s.team,
    total_score: s.total, gross_score: s.gross, deductions: s.deduct,
    wl:0, ul:0, term:0, health:0, auto:0, fire:0,
    placed: s.placed, answered: s.answered, missed: 0, voicemail: 0,
    talk_min: s.talkMin, avg_min: s.avgMin,
    race_wide_missed: rwMissed, race_wide_voicemail: rwVm,
  })));
}

async function resetRaceScores(userId) {
  await supabase.from('race_data').update({
    wl:0, ul:0, term:0, health:0, auto:0, fire:0,
    placed:0, answered:0, missed:0, voicemail:0,
    talk_min:0, avg_min:0, race_wide_missed:0, race_wide_voicemail:0,
  }).eq('user_id', userId);
  await supabase.from('call_log').delete().eq('user_id', userId);
  await supabase.from('sales_log').delete().eq('user_id', userId);
}


// ─── CALL CLASSIFICATION ────────────────────────────────────────
function classifyCalls(data, knownHashes) {
  const newLogRows = [];
  const discoveredAgents = {};
  let duplicatesSkipped = 0;

  let headerIdx = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].join('|').includes('Call Direction')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) return { newLogRows: [], duplicatesSkipped: 0, discoveredAgents: {}, colsFound: {} };

  const headers = data[headerIdx].map(h => String(h).trim());
  const dtCol   = findCol(headers, ['Origination Date','Start Time','Start Date','Call Date','Date/Time','Date Time','Timestamp','Call Start','Ring Time','DateTime','Date']);
  const extCol  = findCol(headers, ['Extension Description','Extension','Ext Description','Agent','User']);
  const dirCol  = findCol(headers, ['Call Direction','Direction']);
  const talkCol = findCol(headers, ['Talk Time','Talk','Connected Time','Connected']);
  const durCol  = findCol(headers, ['Duration','Total Duration']);
  const dispCol = findCol(headers, ['Call Disposition','Disposition','Result','Status']);

  for (let i = headerIdx + 1; i < data.length; i++) {
    const row  = data[i];
    const dir  = String(row[dirCol]  || '').trim().toUpperCase();
    const disp = String(row[dispCol] || '').trim();
    const ext  = String(row[extCol]  || '').trim();
    const dt   = String(row[dtCol]   || '').trim();
    const dur  = String(row[durCol]  || '0').trim();

    if (dir !== 'INBOUND' && dir !== 'OUTBOUND') continue;

    const talkSecs = secsFromStr(String(row[talkCol] || '0'));
    const isVm     = disp.includes('Voice Mail') || disp.includes('VM');
    let category   = null;

    if (isVm) {
      const isInternal = disp.includes('Internal') || disp.includes('Voice Mail Access');
      if (isInternal)           category = 'internal';
      else if (dir === 'INBOUND') category = 'voicemail';
      else                      category = 'placed';
    } else if (disp.includes('Abandon')) {
      category = 'missed';
    } else if (disp.includes('Internal')) {
      category = 'internal';
    } else if (dir === 'OUTBOUND') {
      category = 'placed';
    } else if (dir === 'INBOUND' && disp.includes('Handled')) {
      category = 'answered';
    } else {
      category = 'other';
    }

    const hashInput = (category === 'voicemail' || category === 'missed')
      ? [dt, dir, dur, disp].join('|')
      : [dt, ext, dir, dur, disp].join('|');
    const hash = sha256Short(hashInput);

    if (knownHashes[hash]) { duplicatesSkipped++; continue; }

    if (category === 'internal' || category === 'other') {
      newLogRows.push([hash, 'skip', category, 0, dateOnly(dt), null]);
      continue;
    }

    let agentId = '';
    if (category === 'placed' || category === 'answered') {
      const cleanName = cleanExtName(ext);
      if (!cleanName) continue;
      agentId = slugify(cleanName);
      if (!agentId) continue;
      discoveredAgents[agentId] = cleanName;
    }

    const talkMin = Math.round((talkSecs / 60) * 10) / 10;
    const slot    = category === 'voicemail' ? timeSlot(dt) : null;
    newLogRows.push([hash, agentId, category, talkMin, dateOnly(dt), slot]);
  }

  const colsFound = { dtCol, extCol, dirCol, talkCol, durCol, dispCol,
    dtHeader:  dtCol  !== -1 ? headers[dtCol]  : null,
    extHeader: extCol !== -1 ? headers[extCol] : null };
  return { newLogRows, duplicatesSkipped, discoveredAgents, colsFound };
}


// ─── CALL AGGREGATION ───────────────────────────────────────────
// agentMeta: { [agentId]: { name, team } } — from race_data
function aggregateFromLog(logRows, agentMeta = {}) {
  const agents   = {};
  const raceWide = { missed: 0, voicemails: 0 };

  for (const row of logRows) {
    const agentId  = row[1];
    const category = row[2];
    const talkMin  = parseFloat(row[3]) || 0;

    if (category === 'voicemail') { raceWide.voicemails++; continue; }
    if (category === 'missed')    { raceWide.missed++;     continue; }
    if (category === 'skip' || category === 'internal' || category === 'other') continue;

    if (!agentId || agentId === 'skip') continue;

    if (!agents[agentId]) {
      const meta = agentMeta[agentId] || {};
      agents[agentId] = {
        id: agentId, name: meta.name || agentId, team: meta.team || 'sales',
        placed: 0, answered: 0, talkMin: 0, talkCalls: 0,
      };
    }

    const s = agents[agentId];
    if (category === 'placed')        s.placed++;
    else if (category === 'answered') s.answered++;
    s.talkMin  += talkMin;
    if (talkMin * 60 >= 10) s.talkCalls++;
  }

  for (const id in agents) {
    const s   = agents[id];
    s.avgMin  = s.talkCalls > 0 ? Math.round((s.talkMin / s.talkCalls) * 100) / 100 : 0;
  }

  return { agents, raceWide };
}


// ─── SALES CLASSIFICATION ───────────────────────────────────────
function classifySales(data, headerIdx, colIdx, knownHashes) {
  const newLogRows = [];
  const discoveredAgents = {};
  let duplicatesSkipped = 0;

  const productCol  = colIdx.product         ?? -1;
  const nameCol     = colIdx.policy_name     ?? -1;
  const agentCol    = colIdx.written_by      ?? -1;
  const dateCol     = colIdx.written_date    ?? -1;
  const typeCol     = colIdx.policy_type     ?? -1;
  const premiumCol  = colIdx.written_premium ?? -1;
  const detailsCol  = colIdx.details         ?? -1;

  for (let i = headerIdx + 1; i < data.length; i++) {
    const row     = data[i];
    const product = String(row[productCol] || '').trim();
    const polName = nameCol !== -1 ? String(row[nameCol] || '').trim() : '';
    const agent   = String(row[agentCol]   || '').trim();
    const date    = String(row[dateCol]    || '').trim();
    const polType = typeCol !== -1 ? String(row[typeCol] || '').trim() : '';
    const rawPrem = premiumCol !== -1 ? String(row[premiumCol] || '').replace(/[$,\s]/g, '') : '';
    const writtenPremium = rawPrem ? (parseFloat(rawPrem) || null) : null;
    const details = detailsCol !== -1 ? String(row[detailsCol] || '').trim() : '';

    if (!product || !agent || !date) continue;

    const hashPrem = rawPrem || '';
    const hash = sha256Short([agent, polName, product, dateOnly(date), details, hashPrem].join('|'));
    if (knownHashes[hash]) { duplicatesSkipped++; continue; }

    const category = mapPolicyCategory(product, polType);
    if (category === 'other') {
      newLogRows.push([hash, 'skip', 'other', dateOnly(date), null]);
      continue;
    }

    const agentId = slugify(agent);
    if (!agentId) continue;
    discoveredAgents[agentId] = agent;

    newLogRows.push([hash, agentId, category, dateOnly(date), writtenPremium]);
  }

  return { newLogRows, duplicatesSkipped, discoveredAgents };
}


// ─── SALES AGGREGATION ──────────────────────────────────────────
function aggregateSalesFromLog(logRows) {
  const agents = {};
  for (const row of logRows) {
    const agentId  = String(row[1]);
    const category = String(row[2]);
    if (category === 'other' || category === 'skip' || agentId === 'skip' || !agentId) continue;
    if (!agents[agentId]) agents[agentId] = { id: agentId, wl:0, ul:0, term:0, health:0, auto:0, fire:0 };
    const s = agents[agentId];
    if (s[category] !== undefined) s[category]++;
  }
  return agents;
}


// ─── HELPERS ────────────────────────────────────────────────────
function sha256Short(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

function secsFromStr(val) {
  const s     = String(val).trim();
  const parts = s.split(':');
  if (parts.length === 3) return parseInt(parts[0])*3600 + parseInt(parts[1])*60 + parseInt(parts[2]);
  return parseFloat(s) || 0;
}

function timeSlot(dtStr) {
  try {
    const d = new Date(dtStr);
    if (isNaN(d.getTime())) return null;
    return d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
  } catch(e) { return null; }
}

function dateOnly(dtStr) {
  const s = String(dtStr).trim();
  // Handle M/D/YY short-year (e.g. "4/1/26" → "2026-04-01")
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdy) {
    return `${2000 + parseInt(mdy[3])}-${String(parseInt(mdy[1])).padStart(2,'0')}-${String(parseInt(mdy[2])).padStart(2,'0')}`;
  }
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.split(' ')[0] || s;
    return d.toISOString().split('T')[0];
  } catch(e) { return s.split(' ')[0] || s; }
}

function cleanExtName(ext) {
  if (!ext || ext === 'Not Applicable' || ext === 'Extension Description' || ext === 'Office Voicemail') return null;
  return ext.replace(/_[A-Za-z0-9]{3,}$/i, '').replace(/_/g, ' ').trim();
}

function findCol(headers, keywords) {
  const lowers = headers.map(h => String(h).toLowerCase());
  for (let i = 0; i < lowers.length; i++)
    for (const kw of keywords)
      if (lowers[i].includes(kw.toLowerCase())) return i;
  return -1;
}

function mapPolicyCategory(product, policyType) {
  const p = String(product    || '').toLowerCase().trim();
  const t = String(policyType || '').toLowerCase().trim();
  if (p.includes('whole') || p === 'wl')                                        return 'wl';
  if (p.includes('universal') || p === 'ul')                                    return 'ul';
  if (p.includes('term'))                                                        return 'term';
  if (p.includes('health') || p.includes('med'))                                return 'health';
  if (p.includes('auto') || p.includes('vehicle') || p.includes('car'))        return 'auto';
  if (p.includes('fire') || p.includes('home') || p.includes('property'))      return 'fire';
  if (t.includes('whole') || t === 'wl')                                        return 'wl';
  if (t.includes('universal') || t === 'ul')                                    return 'ul';
  if (t.includes('term'))                                                        return 'term';
  if (t.includes('health') || t.includes('med'))                                return 'health';
  if (t.includes('auto') || t.includes('vehicle'))                              return 'auto';
  if (t.includes('fire') || t.includes('home') || t.includes('property'))      return 'fire';
  return 'other';
}

function detectMonth(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const val = rows[r][c];
      if (!val) continue;
      let d = val instanceof Date ? val : new Date(val);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2020) {
        return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
      }
    }
  }
  return MONTH_NAMES[new Date().getMonth()] + ' ' + new Date().getFullYear();
}

function detectSalesMonth(rows, headerIdx, dateColIdx) {
  if (dateColIdx === undefined || dateColIdx === -1) return null;
  for (let r = headerIdx + 1; r < Math.min(rows.length, headerIdx + 50); r++) {
    const val = rows[r][dateColIdx];
    if (!val) continue;
    // Handle M/D/YY short-year (e.g. "4/1/26")
    const mdy = String(val).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (mdy) {
      return MONTH_NAMES[parseInt(mdy[1]) - 1] + ' ' + (2000 + parseInt(mdy[3]));
    }
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2020) {
      return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
    }
  }
  return null;
}

function compareMonths(a, b) {
  const idx = s => { const sl = String(s).toLowerCase(); return MONTH_NAMES.findIndex(m => sl.includes(m.toLowerCase())); };
  const yr  = s => { const m = String(s).match(/\d{4}/); return m ? +m[0] : 0; };
  const dy  = yr(a) - yr(b);
  return dy !== 0 ? dy : idx(a) - idx(b);
}
