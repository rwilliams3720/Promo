import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'Boat Race <reports@the-boat-race.com>';


const SALES_PRODUCTS = ['wl','ul','term','health','auto','fire'];
const PRODUCT_LABELS = { wl:'Whole Life', ul:'Universal Life', term:'Term', health:'Health', auto:'Auto', fire:'Home/Fire' };

// Return yesterday's date string (YYYY-MM-DD) and label in the given IANA timezone.
function yesterdayInTz(timezone) {
  const tz = timezone || 'UTC';
  const now = new Date();
  // Get today's date in the user's timezone as YYYY-MM-DD (en-CA locale gives ISO format).
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const [y, m, d] = todayStr.split('-').map(Number);
  const yest = new Date(Date.UTC(y, m - 1, d - 1));
  const dateStr   = yest.toISOString().split('T')[0];
  const dateLabel = yest.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  return { dateStr, dateLabel };
}

// Return the current hour (0–23) in the given IANA timezone.
function currentHourInTz(timezone) {
  const tz = timezone || 'UTC';
  const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date());
  return parseInt(h, 10) % 24; // Intl can return "24" for midnight in some runtimes
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow Vercel cron, external cron secret, or admin JWT
  const token      = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron   = req.headers['x-vercel-cron'] === '1';
  const isExternalCron = cronSecret && req.headers['x-cron-secret'] === cronSecret;
  const isCron = isVercelCron || isExternalCron;

  if (!isCron) {
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });
    const { data: adminRow } = await supabase.from('accounts').select('is_admin').eq('user_id', user.id).single();
    if (!adminRow?.is_admin) return res.status(403).json({ error: 'Forbidden' });
  }

  // ?date=YYYY-MM-DD override for admin testing (skips delivery-hour check)
  const override = (req.query?.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? req.query.date : null;

  // Fetch all eligible accounts (pro or premium, active)
  const { data: accounts, error: acctErr } = await supabase
    .from('accounts')
    .select('user_id,email,company_name,plan,status,trial_ends_at,timezone,report_hour,last_report_date')
    .in('plan', ['pro','premium'])
    .in('status', ['paid','deferred']);
  if (acctErr) return res.status(500).json({ error: acctErr.message });

  const results = [];
  for (const acct of (accounts || [])) {
    // Skip expired trials
    if (acct.status === 'trial' && acct.trial_ends_at && new Date(acct.trial_ends_at) < new Date()) continue;

    const tz         = acct.timezone    || 'America/Los_Angeles';
    const reportHour = acct.report_hour ?? 7;

    // Calculate target date first (needed for dupe check)
    const { dateStr, dateLabel } = override
      ? { dateStr: override, dateLabel: new Date(override + 'T12:00:00Z').toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric', timeZone:'UTC' }) }
      : yesterdayInTz(tz);

    // Skip if this date was already delivered (guards against cron retries and hour-change resends).
    // Admin ?date= override bypasses this so manual test sends always go through.
    const lastSent = acct.last_report_date ? String(acct.last_report_date).split('T')[0] : null;
    if (!override && lastSent === dateStr) {
      results.push({ email: acct.email, status: 'skipped', reason: `already delivered for ${dateStr}` });
      continue;
    }

    // When running as a cron (hourly), skip accounts whose delivery hour hasn't arrived yet.
    // Admin ?date= override bypasses this check to allow on-demand testing.
    if (!override && isCron) {
      const userHour = currentHourInTz(tz);
      if (userHour !== reportHour) {
        results.push({ email: acct.email, status: 'skipped', reason: `delivery hour ${reportHour}, current ${userHour} ${tz}` });
        continue;
      }
    }

    try {
      const report = await buildReport(acct.user_id, dateStr, dateLabel, acct);
      if (!report.hasData) {
        results.push({ email: acct.email, status: 'skipped', reason: 'no activity' });
        continue;
      }
      const { error: sendErr } = await resend.emails.send({
        from:    FROM_EMAIL,
        to:      acct.email,
        subject: `Boat Race Daily Report — ${dateLabel}`,
        html:    report.html,
      });
      if (!sendErr) {
        // Record delivery so this date is never resent
        await supabase.from('accounts').update({ last_report_date: dateStr }).eq('user_id', acct.user_id);
      }
      results.push({ email: acct.email, status: sendErr ? 'error' : 'sent', error: sendErr?.message });
    } catch (e) {
      results.push({ email: acct.email, status: 'error', error: e.message });
    }
  }

  return res.status(200).json({ results });
}

async function buildReport(userId, dateStr, dateLabel, acct) {
  const isPremium = acct.plan === 'premium' && ['paid','deferred'].includes(acct.status);

  // Date range helpers
  const d = new Date(dateStr + 'T12:00:00Z');
  const mtdStart = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const ytdStart = `${d.getUTCFullYear()}-01-01`;

  // Fetch race_data for live team assignments alongside all data queries
  const [callsRes, salesRes, mtdSalesRes, ytdSalesRes, raceRes] = await Promise.all([
    supabase.from('call_log')
      .select('agent_id,disposition,talk_secs')
      .eq('user_id', userId).eq('call_dt', dateStr)
      .not('disposition', 'in', '(internal,other,skip)'),
    supabase.from('sales_log')
      .select('agent_id,product')
      .eq('user_id', userId).eq('sale_date', dateStr),
    isPremium
      ? supabase.from('sales_log').select('agent_id,product,written_premium')
          .eq('user_id', userId).gte('sale_date', mtdStart).lte('sale_date', dateStr)
      : Promise.resolve({ data: null }),
    isPremium
      ? supabase.from('sales_log').select('agent_id,product,written_premium')
          .eq('user_id', userId).gte('sale_date', ytdStart).lte('sale_date', dateStr)
      : Promise.resolve({ data: null }),
    supabase.from('race_data').select('agent_id,name,team').eq('user_id', userId),
  ]);

  const calls = callsRes.data;
  const sales = salesRes.data;

  // Build agent info from live race_data — source of truth for name and team
  const agentInfo = {};
  for (const row of (raceRes.data || [])) {
    agentInfo[row.agent_id] = { name: row.name, team: row.team };
  }

  const hasData = (calls?.length || 0) > 0 || (sales?.length || 0) > 0;

  // Aggregate daily calls per agent
  const callStats = {};
  for (const id of Object.keys(agentInfo)) callStats[id] = { placed: 0, answered: 0, talkSecs: 0 };
  let totalCalls = 0, totalAnswered = 0, totalTalkSecs = 0, totalVoicemails = 0;
  for (const row of (calls || [])) {
    if (row.disposition === 'voicemail') { totalVoicemails++; continue; }
    if (!row.agent_id || !callStats[row.agent_id]) continue;
    const s = callStats[row.agent_id];
    if (row.disposition === 'placed')   { s.placed++;  totalCalls++; }
    if (row.disposition === 'answered') { s.answered++; totalAnswered++; }
    s.talkSecs    += row.talk_secs || 0;
    totalTalkSecs += row.talk_secs || 0;
  }

  // Aggregate daily sales per agent
  const salesStats = {};
  for (const id of Object.keys(agentInfo)) salesStats[id] = {};
  let totalPolicies = 0;
  for (const row of (sales || [])) {
    if (!row.agent_id || !salesStats[row.agent_id]) continue;
    salesStats[row.agent_id][row.product] = (salesStats[row.agent_id][row.product] || 0) + 1;
    totalPolicies++;
  }

  // Aggregate MTD/YTD sales per agent per product (premium only)
  const mtdStats   = aggregateSalesByAgentProduct(mtdSalesRes.data);
  const ytdStats   = aggregateSalesByAgentProduct(ytdSalesRes.data);
  const mtdPremium = aggregatePremiumByAgentProduct(mtdSalesRes.data);
  const ytdPremium = aggregatePremiumByAgentProduct(ytdSalesRes.data);

  const html = buildHtml(acct, dateLabel, dateStr, agentInfo, callStats, salesStats, totalCalls, totalAnswered, totalTalkSecs, totalPolicies, totalVoicemails, mtdStats, ytdStats, mtdStart, ytdStart, mtdPremium, ytdPremium);
  return { hasData, html };
}

function aggregateSalesByAgentProduct(rows) {
  if (!rows) return null;
  const stats = {};
  for (const row of rows) {
    if (!row.agent_id || !row.product) continue;
    if (!stats[row.agent_id]) stats[row.agent_id] = {};
    stats[row.agent_id][row.product] = (stats[row.agent_id][row.product] || 0) + 1;
  }
  return stats;
}

function aggregatePremiumByAgentProduct(rows) {
  if (!rows) return null;
  const stats = {};
  for (const row of rows) {
    if (!row.agent_id || !row.product) continue;
    const amt = parseFloat(row.written_premium) || 0;
    if (!amt) continue;
    if (!stats[row.agent_id]) stats[row.agent_id] = {};
    stats[row.agent_id][row.product] = (stats[row.agent_id][row.product] || 0) + amt;
  }
  return stats;
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function agentSalesTable(title, agentInfo, stats, periodStart, dateStr) {
  const headerCols = SALES_PRODUCTS.map(p =>
    `<th style="padding:6px 8px;text-align:center;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;white-space:nowrap;">${PRODUCT_LABELS[p].split('/')[0]}</th>`
  ).join('');

  const bodyRows = Object.entries(agentInfo)
    .sort((a, b) => a[1].team.localeCompare(b[1].team) || a[1].name.localeCompare(b[1].name))
    .map(([id, info]) => {
      const s = stats[id] || {};
      const rowTotal = SALES_PRODUCTS.reduce((n, p) => n + (s[p] || 0), 0);
      const teamColor = info.team === 'sales' ? '#00d4ff' : '#00ff94';
      const cells = SALES_PRODUCTS.map(p =>
        `<td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;text-align:center;font-size:12px;color:${s[p] ? '#e8f4fd' : '#3a5a7a'};">${s[p] || '—'}</td>`
      ).join('');
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;font-size:12px;white-space:nowrap;">${info.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;">
          <span style="background:${teamColor}22;color:${teamColor};padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase;">${info.team}</span>
        </td>
        ${cells}
        <td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;text-align:center;font-size:12px;font-weight:700;color:${rowTotal ? '#ff8c42' : '#3a5a7a'};">${rowTotal || '—'}</td>
      </tr>`;
    }).join('');

  const totalCols = SALES_PRODUCTS.map(p => {
    const col = Object.values(stats).reduce((n, s) => n + (s[p] || 0), 0);
    return `<td style="padding:6px 8px;text-align:center;font-size:12px;font-weight:700;color:#ff8c42;">${col || '—'}</td>`;
  }).join('');
  const grandTotal = Object.values(stats).reduce((n, s) => n + SALES_PRODUCTS.reduce((m, p) => m + (s[p] || 0), 0), 0);

  const periodLabel = periodStart === dateStr
    ? 'No prior sales in period'
    : `${new Date(periodStart + 'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  return `
  <tr><td style="background:#132744;padding:0 32px 24px;">
    <div style="font-size:13px;font-weight:700;color:#ff8c42;text-transform:uppercase;letter-spacing:.06em;padding:20px 0 4px;">${title}</div>
    <div style="font-size:11px;color:#6b8db5;margin-bottom:10px;">${periodLabel}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr style="background:#060e1c;">
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Agent</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Team</th>
          ${headerCols}
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Total</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>
        <tr style="background:#060e1c;">
          <td colspan="2" style="padding:6px 8px;font-size:11px;color:#6b8db5;font-weight:700;">Total</td>
          ${totalCols}
          <td style="padding:6px 8px;text-align:center;font-size:12px;font-weight:700;color:#ff8c42;">${grandTotal || '—'}</td>
        </tr>
      </tfoot>
    </table>
  </td></tr>`;
}

function fmtCurrency(n) {
  if (!n) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function agentPremiumTable(title, agentInfo, stats, periodStart, dateStr) {
  const headerCols = SALES_PRODUCTS.map(p =>
    `<th style="padding:6px 8px;text-align:center;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;white-space:nowrap;">${PRODUCT_LABELS[p].split('/')[0]}</th>`
  ).join('');

  const bodyRows = Object.entries(agentInfo)
    .sort((a, b) => a[1].team.localeCompare(b[1].team) || a[1].name.localeCompare(b[1].name))
    .map(([id, info]) => {
      const s = stats[id] || {};
      const rowTotal = SALES_PRODUCTS.reduce((n, p) => n + (s[p] || 0), 0);
      const teamColor = info.team === 'sales' ? '#00d4ff' : '#00ff94';
      const cells = SALES_PRODUCTS.map(p =>
        `<td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;text-align:center;font-size:11px;color:${s[p] ? '#e8f4fd' : '#3a5a7a'};">${fmtCurrency(s[p])}</td>`
      ).join('');
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;font-size:12px;white-space:nowrap;">${info.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;">
          <span style="background:${teamColor}22;color:${teamColor};padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase;">${info.team}</span>
        </td>
        ${cells}
        <td style="padding:6px 8px;border-bottom:1px solid #1e3a5f;text-align:center;font-size:11px;font-weight:700;color:${rowTotal ? '#ff8c42' : '#3a5a7a'};">${fmtCurrency(rowTotal)}</td>
      </tr>`;
    }).join('');

  const totalCols = SALES_PRODUCTS.map(p => {
    const col = Object.values(stats).reduce((n, s) => n + (s[p] || 0), 0);
    return `<td style="padding:6px 8px;text-align:center;font-size:11px;font-weight:700;color:#ff8c42;">${fmtCurrency(col)}</td>`;
  }).join('');
  const grandTotal = Object.values(stats).reduce((n, s) => n + SALES_PRODUCTS.reduce((m, p) => m + (s[p] || 0), 0), 0);

  const periodLabel = `${new Date(periodStart + 'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  return `
  <tr><td style="background:#132744;padding:0 32px 24px;">
    <div style="font-size:13px;font-weight:700;color:#ff8c42;text-transform:uppercase;letter-spacing:.06em;padding:20px 0 4px;">${title}</div>
    <div style="font-size:11px;color:#6b8db5;margin-bottom:10px;">${periodLabel}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr style="background:#060e1c;">
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Agent</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Team</th>
          ${headerCols}
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.05em;font-weight:600;">Total</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>
        <tr style="background:#060e1c;">
          <td colspan="2" style="padding:6px 8px;font-size:11px;color:#6b8db5;font-weight:700;">Total</td>
          ${totalCols}
          <td style="padding:6px 8px;text-align:center;font-size:11px;font-weight:700;color:#ff8c42;">${fmtCurrency(grandTotal)}</td>
        </tr>
      </tfoot>
    </table>
  </td></tr>`;
}

function agentRows(agentInfo, callStats, salesStats) {
  return Object.entries(agentInfo)
    .sort((a, b) => a[1].team.localeCompare(b[1].team) || a[1].name.localeCompare(b[1].name))
    .map(([id, info]) => {
      const c = callStats[id];
      const s = salesStats[id];
      const policies = SALES_PRODUCTS.map(p => s[p] ? `${s[p]} ${PRODUCT_LABELS[p]}` : '').filter(Boolean).join(', ') || '—';
      const teamColor = info.team === 'sales' ? '#00d4ff' : '#00ff94';
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;font-size:13px;">${info.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;font-size:12px;">
            <span style="background:${teamColor}22;color:${teamColor};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;">${info.team}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;text-align:center;font-size:13px;">${c.placed}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;text-align:center;font-size:13px;">${c.answered}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;text-align:center;font-size:13px;">${c.talkSecs > 0 ? fmtTime(c.talkSecs) : '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e3a5f;font-size:12px;color:#a0b4c8;">${policies}</td>
        </tr>`;
    }).join('');
}

function buildHtml(acct, dateLabel, dateStr, agentInfo, callStats, salesStats, totalCalls, totalAnswered, totalTalkSecs, totalPolicies, totalVoicemails, mtdStats, ytdStats, mtdStart, ytdStart, mtdPremium, ytdPremium) {
  const company = acct.company_name || 'Your Team';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a1628;font-family:'Helvetica Neue',Arial,sans-serif;color:#e8f4fd;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a1628;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr><td style="background:#060e1c;border-radius:16px 16px 0 0;padding:28px 32px;border-bottom:1px solid #1e3a5f;">
    <div style="font-size:28px;font-weight:900;letter-spacing:.04em;color:#e8f4fd;">BOAT <span style="color:#00d4ff;">RACE</span></div>
    <div style="font-size:13px;color:#6b8db5;margin-top:4px;">Daily Performance Report — ${dateLabel}</div>
    <div style="font-size:13px;color:#6b8db5;margin-top:2px;">${company}</div>
  </td></tr>

  <!-- Summary cards — row 1: Placed | Received | Voicemails -->
  <tr><td style="background:#132744;padding:24px 32px 12px;border-bottom:none;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="33%" style="text-align:center;padding:0 6px;">
          <div style="background:#060e1c;border-radius:10px;padding:14px 8px;border:1px solid #1e3a5f;">
            <div style="font-size:11px;color:#6b8db5;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Placed</div>
            <div style="font-size:28px;font-weight:700;color:#00d4ff;">${totalCalls}</div>
          </div>
        </td>
        <td width="33%" style="text-align:center;padding:0 6px;">
          <div style="background:#060e1c;border-radius:10px;padding:14px 8px;border:1px solid #1e3a5f;">
            <div style="font-size:11px;color:#6b8db5;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Received</div>
            <div style="font-size:28px;font-weight:700;color:#00ff94;">${totalAnswered}</div>
          </div>
        </td>
        <td width="33%" style="text-align:center;padding:0 6px;">
          <div style="background:#060e1c;border-radius:10px;padding:14px 8px;border:1px solid #1e3a5f;">
            <div style="font-size:11px;color:#6b8db5;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Voicemails</div>
            <div style="font-size:28px;font-weight:700;color:#ff4d6d;">${totalVoicemails}</div>
          </div>
        </td>
      </tr>
    </table>
  </td></tr>
  <!-- Summary cards — row 2: Talk Time | Policies -->
  <tr><td style="background:#132744;padding:12px 32px 24px;border-bottom:1px solid #1e3a5f;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" style="text-align:center;padding:0 6px;">
          <div style="background:#060e1c;border-radius:10px;padding:14px 8px;border:1px solid #1e3a5f;">
            <div style="font-size:11px;color:#6b8db5;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Talk Time</div>
            <div style="font-size:22px;font-weight:700;color:#ffd166;">${fmtTime(totalTalkSecs)}</div>
          </div>
        </td>
        <td width="50%" style="text-align:center;padding:0 6px;">
          <div style="background:#060e1c;border-radius:10px;padding:14px 8px;border:1px solid #1e3a5f;">
            <div style="font-size:11px;color:#6b8db5;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Policies</div>
            <div style="font-size:28px;font-weight:700;color:#ff8c42;">${totalPolicies}</div>
          </div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Agent table -->
  <tr><td style="background:#132744;padding:0 32px 24px;">
    <div style="font-size:13px;font-weight:700;color:#00d4ff;text-transform:uppercase;letter-spacing:.06em;padding:20px 0 12px;">Agent Breakdown</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <thead>
        <tr style="background:#060e1c;">
          <th style="padding:8px 12px;text-align:left;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">Agent</th>
          <th style="padding:8px 12px;text-align:left;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">Team</th>
          <th style="padding:8px 12px;text-align:center;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">Placed</th>
          <th style="padding:8px 12px;text-align:center;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">Received</th>
          <th style="padding:8px 12px;text-align:center;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">Talk Time</th>
          <th style="padding:8px 12px;text-align:left;font-size:10px;color:#6b8db5;text-transform:uppercase;letter-spacing:.06em;font-weight:600;">Policies Issued</th>
        </tr>
      </thead>
      <tbody>${agentRows(agentInfo, callStats, salesStats)}</tbody>
    </table>
  </td></tr>

  ${mtdStats ? agentSalesTable('Month-to-Date Policies by Agent &amp; Product', agentInfo, mtdStats, mtdStart, dateStr) : ''}
  ${ytdStats ? agentSalesTable('Year-to-Date Policies by Agent &amp; Product', agentInfo, ytdStats, ytdStart, dateStr) : ''}
  ${mtdPremium ? agentPremiumTable('Month-to-Date Written Premium by Agent &amp; Product', agentInfo, mtdPremium, mtdStart, dateStr) : ''}
  ${ytdPremium ? agentPremiumTable('Year-to-Date Written Premium by Agent &amp; Product', agentInfo, ytdPremium, ytdStart, dateStr) : ''}

  <!-- Footer -->
  <tr><td style="background:#060e1c;border-radius:0 0 16px 16px;padding:20px 32px;border-top:1px solid #1e3a5f;">
    <div style="font-size:11px;color:#3a5a7a;text-align:center;">
      Boat Race Daily Report · West Alpha LLC · 6105 West A St, Ste C, West Linn, OR 97068<br>
      This report was automatically generated for ${acct.email}
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
