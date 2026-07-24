// Shared by api/email-report.js (which mints chart image URLs when building the email)
// and api/chart.js (which verifies them before rendering). Charts are NOT pre-rendered
// and stored — each <img> tag points at api/chart.js, which renders the PNG on demand
// the moment the recipient's email client actually loads the image. That means no
// storage bucket, no cleanup/retention job, and the chart always reflects live data as
// of open-time — but since email <img> tags can't carry auth headers, the URL itself
// must prove it was minted by our own send process for this exact (account, agent,
// dataset, chart type, report date) tuple, not tampered into pulling a different
// agent's or account's numbers.
import crypto from 'crypto';

function keyFromEnv() {
  const hex = process.env.CUSTOMER_ENCRYPTION_KEY;
  if (!hex) return null;
  try { return Buffer.from(hex, 'hex'); } catch { return null; }
}

export function signChartParams({ u, a, d, t, date }) {
  const key = keyFromEnv();
  if (!key) return null; // encryption key not configured — caller must skip charts entirely
  const payload = `${u}|${a}|${d}|${t}|${date}`;
  return crypto.createHmac('sha256', key).update(payload).digest('hex');
}

export function verifyChartParams({ u, a, d, t, date, sig }) {
  const expected = signChartParams({ u, a, d, t, date });
  if (!expected || !sig) return false;
  const buf1 = Buffer.from(expected, 'hex');
  const buf2 = Buffer.from(String(sig), 'hex');
  if (buf1.length !== buf2.length) return false;
  return crypto.timingSafeEqual(buf1, buf2);
}
