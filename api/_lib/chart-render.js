// Hand-rolled SVG bar/line/scatter renderer, converted to PNG via sharp — same SVG→PNG
// pipeline already proven working on Vercel by api/og.js. No chart library dependency;
// our needs are simple (a handful of categories/points per image) so a small generator
// is easier to keep dark-theme-consistent with the email than fighting a library's
// theming API. Native size is 2x the <img> display size in the email so charts stay
// sharp on retina displays.
import sharp from 'sharp';

const W = 720, H = 340;
const PAD_L = 64, PAD_R = 24, PAD_T = 34, PAD_B = 54;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const FONT = 'Helvetica,Arial,sans-serif';

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
  const n = Math.round(v);
  return dollar ? '$' + n.toLocaleString('en-US') : n.toLocaleString('en-US');
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
  const svg = renderChartSvg(opts);
  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
}
