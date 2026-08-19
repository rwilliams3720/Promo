// Hand-rolled SVG bar/line/scatter renderer, converted to PNG via @resvg/resvg-js. No
// chart library dependency; our needs are simple (a handful of categories/points per
// image) so a small generator is easier to keep dark-theme-consistent with the email
// than fighting a library's theming API. Native size is 2x the <img> display size in
// the email so charts stay sharp on retina displays.
//
// Renderer choice (2026-08-06): originally used `sharp`, same as api/og.js, with the
// font embedded as a base64 @font-face data URI. That doesn't work — Vercel's
// serverless runtime has no system fonts installed, and sharp's SVG renderer
// (librsvg, via fontconfig) does NOT reliably resolve fonts embedded as data URIs; it
// needs an actual font file it can point fontconfig at. This shipped invisible in
// production for weeks because og.js has the identical bug — its embedded-font SVG
// also renders blank text on Vercel, just never scrutinized closely (an OG preview
// image, not something a user stares at) — so "proven working" was never actually
// true. Confirmed by testing api/og.js in production directly: same blank-box text.
// @resvg/resvg-js (Rust, via napi-rs, same category of prebuilt-native-binary
// dependency sharp already is) accepts an explicit font FILE PATH and does not depend
// on system fontconfig at all, so this is the fix, not the previous embedding trick.
import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'fs';
import path from 'path';

const W = 720, H = 340;
const PAD_L = 64, PAD_R = 24, PAD_T = 34, PAD_B = 54;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const FONT = 'BebasNeue';
// Must also be listed under `config.includeFiles` on the api/chart.js build entry in
// vercel.json — @vercel/node's file tracer can't statically detect a `path.join(process.cwd(), …)`
// argument, so without that explicit entry this file silently isn't bundled into the
// deployed function even though it exists in the repo and works fine under `vercel dev`
// (which just reads straight off the working directory, no bundling step at all). This
// exact gap is why the very first attempt at this fix passed local testing and did
// nothing in production.
const FONT_PATH = path.join(process.cwd(), 'BebasNeue.ttf');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Per-agent chart colors deliberately avoid the report's existing chrome colors
// (summary stat cards / team badges: #00d4ff, #00ff94, #ff4d6d, #ffd166, #ff8c42) so
// these charts read as their own visual layer instead of blending into the rest of
// the email. Team-wide comparison charts (below) get their own distinct pair too.
export const CHART_DATASETS = {
  trend_placed:   { label: 'Placed Calls — 14-Day Trend',    color: '#2dd4bf' },
  trend_answered: { label: 'Answered Calls — 14-Day Trend',  color: '#c084fc' },
  trend_talk:     { label: 'Talk Time (min) — 14-Day Trend', color: '#f472b6' },
  mtd_policies:   { label: 'MTD Policies by Product',        color: '#84cc16' },
  ytd_policies:   { label: 'YTD Policies by Product',        color: '#84cc16' },
  mtd_premium:    { label: 'MTD Written Premium by Product', color: '#6366f1', dollar: true, premiumOnly: true },
  ytd_premium:    { label: 'YTD Written Premium by Product', color: '#6366f1', dollar: true, premiumOnly: true },
  // Team-wide: one chart total (not per agent), every agent's name along the x-axis,
  // scoped to the report's own date — same numbers as the "Agent Breakdown" table.
  team_talk:      { label: 'Talk Time by Agent (min)',       color: '#fbbf24', teamWide: true },
  team_answered:  { label: 'Answered Calls by Agent',        color: '#38bdf8', teamWide: true },
};

function scaleY(v, max) {
  if (max <= 0) return PAD_T + PLOT_H;
  return PAD_T + PLOT_H - (Math.max(0, v) / max) * PLOT_H;
}

function niceMax(max) {
  if (max <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / magnitude;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * magnitude;
}

function fmtVal(v, dollar) {
  if (dollar) return '$' + Math.round(v).toLocaleString('en-US');
  // Policy-count values are sale_weight-weighted (0.5 per side of a split sale, see
  // CLAUDE.md "Cross-report consistency") and can legitimately be a half-integer —
  // rounding here would print "12" for a chart whose bar height, and every other report's
  // number for the same agent/period, is actually 11.5, reintroducing the exact
  // cross-report mismatch this consistency pass was meant to eliminate. Round only to
  // avoid floating-point noise (e.g. 11.499999999998), not to the nearest whole number.
  const n = Math.round(v * 100) / 100;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function buildAxes(max, dollar) {
  const steps = 4;
  let out = '';
  for (let i = 0; i <= steps; i++) {
    const v = (max / steps) * i;
    const y = scaleY(v, max);
    out += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#1e3a5f" stroke-width="1"/>`;
    out += `<text x="${PAD_L - 10}" y="${y + 4}" text-anchor="end" font-size="13" fill="#6b8db5" font-family="${FONT}">${fmtVal(v, dollar)}</text>`;
  }
  return out;
}

function xPos(i, n) {
  return n === 1 ? PAD_L + PLOT_W / 2 : PAD_L + (PLOT_W / (n - 1)) * i;
}

export function renderChartSvg({ title, labels, values, color, opacity, outline, type, dollar }) {
  const n = labels.length;
  const max = niceMax(Math.max(1, ...values.map(v => v || 0)));
  const axes = buildAxes(max, dollar);
  // Thin out category labels along the x-axis so they never overlap when there are many
  // points (e.g. 14 daily trend labels) — always keep the first and last.
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const showLabel = i => i === 0 || i === n - 1 || i % labelEvery === 0;

  const fillOpacity = Number.isFinite(opacity) ? opacity : 1;
  const outlineAttr = outline ? ` stroke="${outline}" stroke-width="1.5"` : '';

  let body = '';
  if (type === 'bar') {
    const slot = PLOT_W / n;
    const bw = Math.min(64, slot * 0.6);
    body = labels.map((lab, i) => {
      const cx = PAD_L + slot * (i + 0.5);
      const y  = scaleY(values[i] || 0, max);
      const h  = (PAD_T + PLOT_H) - y;
      return `<rect x="${cx - bw / 2}" y="${y}" width="${bw}" height="${Math.max(0, h)}" rx="3" fill="${color}" fill-opacity="${fillOpacity}"${outlineAttr}/>
        <text x="${cx}" y="${PAD_T + PLOT_H + 22}" text-anchor="middle" font-size="12" fill="#8fa8c4" font-family="${FONT}">${esc(lab)}</text>
        <text x="${cx}" y="${y - 8}" text-anchor="middle" font-size="12" fill="#e8f4fd" font-family="${FONT}">${fmtVal(values[i] || 0, dollar)}</text>`;
    }).join('');
  } else if (type === 'line') {
    const pts = labels.map((lab, i) => ({ cx: xPos(i, n), y: scaleY(values[i] || 0, max), lab }));
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx},${p.y}`).join(' ');
    body = `<path d="${path}" fill="none" stroke="${color}" stroke-opacity="${fillOpacity}" stroke-width="3"/>` +
      pts.map((p, i) => `<circle cx="${p.cx}" cy="${p.y}" r="4" fill="${color}" fill-opacity="${fillOpacity}"${outlineAttr}/>` +
        (showLabel(i) ? `<text x="${p.cx}" y="${PAD_T + PLOT_H + 22}" text-anchor="middle" font-size="11" fill="#8fa8c4" font-family="${FONT}">${esc(p.lab)}</text>` : '')
      ).join('');
  } else { // scatter
    body = labels.map((lab, i) => {
      const cx = xPos(i, n);
      const y  = scaleY(values[i] || 0, max);
      return `<circle cx="${cx}" cy="${y}" r="6" fill="${color}" fill-opacity="${fillOpacity}"${outlineAttr}/>` +
        (showLabel(i) ? `<text x="${cx}" y="${PAD_T + PLOT_H + 22}" text-anchor="middle" font-size="11" fill="#8fa8c4" font-family="${FONT}">${esc(lab)}</text>` : '');
    }).join('');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" rx="12" fill="#060e1c"/>
    <text x="${PAD_L}" y="24" font-size="15" font-weight="700" fill="#e8f4fd" font-family="${FONT}">${esc(title)}</text>
    ${axes}
    ${body}
  </svg>`;
}

export async function renderChartPng(opts) {
  // Fail loud, not silent: resvg-js doesn't error on a missing font file, it just quietly
  // renders no text (same "blank box" symptom the last two bugs shipped as). Throwing here
  // surfaces as a 500 on the chart <img> — an obviously broken image — instead of a
  // plausible-looking chart with invisible labels nobody notices until a report gets sent.
  if (!existsSync(FONT_PATH)) {
    throw new Error(`Chart font missing at ${FONT_PATH} — check vercel.json includeFiles for api/chart.js`);
  }
  const svg = renderChartSvg(opts);
  // density-equivalent scaling: SVG is authored at native W×H (see top of file — already
  // 2x the <img> display size for retina), so no extra fitTo scaling needed here, just a
  // straight render at the SVG's own declared width/height.
  const resvg = new Resvg(svg, {
    font: { fontFiles: [FONT_PATH], loadSystemFonts: false, defaultFontFamily: FONT },
  });
  return resvg.render().asPng();
}
