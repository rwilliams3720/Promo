import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { verifyChartParams } from './_lib/chart-sign.js';
import { renderChartPng, CHART_DATASETS } from './_lib/chart-render.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ENCRYPTION_KEY = process.env.CUSTOMER_ENCRYPTION_KEY
  ? Buffer.from(process.env.CUSTOMER_ENCRYPTION_KEY, 'hex')
  : null;

function decryptField(ciphertext) {
  if (!ciphertext) return null;
  if (!ENCRYPTION_KEY || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivB64, encB64, tagB64] = ciphertext.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return decipher.update(Buffer.from(encB64, 'base64')) + decipher.final('utf8');
  } catch {
    return ciphertext;
  }
}

const SALES_PRODUCTS = ['wl', 'ul', 'term', 'health', 'auto', 'fire'];
const PRODUCT_LABELS = { wl: 'Whole Life', ul: 'Universal Life', term: 'Term', health: 'Health', auto: 'Auto', fire: 'Home/Fire' };

// Rendered on demand — the moment the recipient's email client actually loads the <img>
// tag, not pre-generated at send time. See CLAUDE.md "Agent Performance Charts" for why:
// no storage bucket, no cleanup job, and every image reflects live data anchored to the
// report's date (the `date` param), not "today" (which could be days after send if the
// recipient opens the email late).
export default async function handler(req, res) {
  try {
    const { u, a, d, t, date, sig } = req.query || {};
    if (!u || !a || !d || !t || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).end();
    }
    if (!verifyChartParams({ u, a, d, t, date, sig })) {
      return res.status(403).end();
    }
    const spec = CHART_DATASETS[d];
    if (!spec) return res.status(400).end();
    const type = ['bar', 'line', 'scatter'].includes(t) ? t : 'bar';

    // Cosmetic overrides — not part of the HMAC-signed tuple (u,a,d,t,date). Tampering
    // with display color/opacity/outline has no data-access implications, so these are
    // read directly off the query string rather than round-tripped through chart-sign.js.
    const color = /^#[0-9a-fA-F]{3,8}$/.test(req.query?.color || '') ? req.query.color : spec.color;
    const opacity = (() => {
      const n = parseFloat(req.query?.opacity);
      return Number.isFinite(n) ? Math.min(1, Math.max(0.1, n)) : 1;
    })();
    const outline = /^#[0-9a-fA-F]{3,8}$/.test(req.query?.outline || '') ? req.query.outline : null;

    let labels = [], values = [], title;

    if (spec.teamWide) {
      // One bar/line/point per agent for the report's own date — the same per-agent
      // numbers already shown in the "Agent Breakdown" table, not a 14-day trend.
      const { data: rows, error: rowErr } = await supabase
        .from('call_log')
        .select('agent_id, disposition, talk_secs')
        .eq('user_id', u).eq('call_dt', date)
        .not('disposition', 'in', '(internal,other,skip)');
      if (rowErr) throw new Error(`call_log read failed: ${rowErr.message}`);

      const { data: rosterRows } = await supabase
        .from('agent_roster')
        .select('agent_id, name')
        .eq('user_id', u).eq('active', true);
      const nameById = {};
      for (const r of (rosterRows || [])) nameById[r.agent_id] = r.name;

      const perAgent = {};
      for (const row of (rows || [])) {
        if (row.disposition === 'voicemail') continue;
        const agentId = decryptField(row.agent_id);
        if (!agentId) continue;
        if (!perAgent[agentId]) perAgent[agentId] = { answered: 0, talkSecs: 0 };
        if (row.disposition === 'answered') perAgent[agentId].answered++;
        perAgent[agentId].talkSecs += row.talk_secs || 0;
      }

      const agentIds = Object.keys(perAgent).sort((idA, idB) =>
        (nameById[idA] || idA).localeCompare(nameById[idB] || idB));
      labels = agentIds.map(id => nameById[id] || id);
      values = agentIds.map(id =>
        d === 'team_talk' ? Math.round(perAgent[id].talkSecs / 60) : perAgent[id].answered);
      title = spec.label;
    } else {

    const { data: rosterRow } = await supabase
      .from('agent_roster')
      .select('name')
      .eq('user_id', u).eq('agent_id', a)
      .maybeSingle();
    const agentName = rosterRow?.name || a;
    title = `${agentName} — ${spec.label}`;

    if (d.startsWith('trend_')) {
      const end = new Date(date + 'T12:00:00Z');
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 13);
      const startStr = start.toISOString().split('T')[0];

      // Real pagination, not a single .limit() call — a busy account can easily clear
      // 1000+ call_log rows across a 14-day window (confirmed against this app's own
      // production data: 2866 rows for one agent's account in one such window), and
      // Supabase's default row cap silently truncates any single unpaginated query at
      // 1000 regardless of a higher .limit() — the exact bug already fixed in
      // api/upload.js's fetchAllPages (see CLAUDE.md "Pagination bug"); same fix here.
      // .order('hash') for a stable sort — hash is part of call_log's (user_id, hash)
      // primary key, so it's always present and unique per user.
      const PAGE = 1000;
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error: pageErr } = await supabase
          .from('call_log')
          .select('agent_id, disposition, talk_secs, call_dt')
          .eq('user_id', u)
          .gte('call_dt', startStr).lte('call_dt', date)
          .not('disposition', 'in', '(internal,other,skip)')
          .order('hash', { ascending: true })
          .range(from, from + PAGE - 1);
        if (pageErr) throw new Error(`call_log read failed: ${pageErr.message}`);
        if (page?.length) rows.push(...page);
        if (!page || page.length < PAGE) break;
      }

      const byDay = {};
      for (let i = 0; i < 14; i++) {
        const dt = new Date(start);
        dt.setUTCDate(dt.getUTCDate() + i);
        byDay[dt.toISOString().split('T')[0]] = { placed: 0, answered: 0, talkSecs: 0 };
      }
      for (const row of (rows || [])) {
        if (row.disposition === 'voicemail') continue;
        const agentId = decryptField(row.agent_id);
        if (agentId !== a) continue;
        // Supabase returns call_dt as a full timestamptz string ("2026-07-23T00:00:00+00:00"),
        // not the bare "YYYY-MM-DD" the byDay keys use — normalize before the lookup, or
        // every row silently misses its bucket and the trend renders as a flat zero line.
        const bucket = byDay[String(row.call_dt).slice(0, 10)];
        if (!bucket) continue;
        if (row.disposition === 'placed')   bucket.placed++;
        if (row.disposition === 'answered') bucket.answered++;
        bucket.talkSecs += row.talk_secs || 0;
      }
      labels = Object.keys(byDay).map(k => {
        const dt = new Date(k + 'T12:00:00Z');
        return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
      });
      values = Object.values(byDay).map(b =>
        d === 'trend_placed' ? b.placed : d === 'trend_answered' ? b.answered : Math.round(b.talkSecs / 60)
      );
    } else {
      const isDollar = !!spec.dollar;
      const isYtd = d.startsWith('ytd_');
      const dt = new Date(date + 'T12:00:00Z');
      const periodStart = isYtd
        ? `${dt.getUTCFullYear()}-01-01`
        : `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`;

      const { data: rows } = await supabase
        .from('sales_log')
        .select('product, written_premium')
        .eq('user_id', u).eq('agent_id', a)
        .gte('sale_date', periodStart).lte('sale_date', date)
        .eq('is_cancelled', false)
        .limit(5000);

      const totals = {};
      for (const p of SALES_PRODUCTS) totals[p] = 0;
      for (const row of (rows || [])) {
        if (!SALES_PRODUCTS.includes(row.product)) continue;
        totals[row.product] += isDollar ? (parseFloat(row.written_premium) || 0) : 1;
      }
      labels = SALES_PRODUCTS.map(p => PRODUCT_LABELS[p].split('/')[0]);
      values = SALES_PRODUCTS.map(p => totals[p]);
    }

    } // end else (per-agent datasets)

    const png = await renderChartPng({
      title, labels, values, color, opacity, outline, type, dollar: !!spec.dollar,
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(png);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
