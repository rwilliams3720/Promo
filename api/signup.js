import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

const ADMIN_EMAIL   = 'russelsaiassistant@gmail.com';
const FROM_EMAIL    = 'Boat Race <reports@the-boat-race.com>';
const PLAN_LABELS   = { basic: 'Basic ($25)', pro: 'Pro ($35)', premium: 'Premium ($50)' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, company_name, contact_name, phone, plan, agent_count, referral_source } = req.body || {};

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  // Create auth user via Admin API so metadata is set before the trigger fires
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { company_name, contact_name, phone, plan: plan || 'basic', agent_count: agent_count || 1, referral_source },
  });

  if (error) {
    // Surface duplicate-email as a friendly message matching the old client-side check
    if (error.message?.toLowerCase().includes('already') || error.status === 422) {
      return res.status(409).json({ error: 'already_exists' });
    }
    return res.status(400).json({ error: error.message });
  }

  // Fire-and-forget admin notification — never block signup on email failure
  resend.emails.send({
    from:    FROM_EMAIL,
    to:      ADMIN_EMAIL,
    subject: `New Boat Race signup — ${company_name || email}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 16px;font-size:20px;">New Account Registered</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:6px 0;color:#666;width:140px;">Company</td><td style="padding:6px 0;font-weight:600;">${company_name || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Contact</td><td style="padding:6px 0;">${contact_name || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Email</td><td style="padding:6px 0;">${email}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Phone</td><td style="padding:6px 0;">${phone || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Plan</td><td style="padding:6px 0;">${PLAN_LABELS[plan] || plan || 'Basic'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Agents</td><td style="padding:6px 0;">${agent_count || 1}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Referral</td><td style="padding:6px 0;">${referral_source || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#666;">Signed up</td><td style="padding:6px 0;">${new Date().toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'})}</td></tr>
        </table>
      </div>
    `,
  }).catch(e => console.error('[signup] Resend error:', e?.message));

  return res.status(200).json({ ok: true });
}
