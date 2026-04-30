import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend   = new Resend(process.env.RESEND_API_KEY);
const FROM     = 'Boat Race <reports@the-boat-race.com>';
const BASE_URL = 'https://the-boat-race.com';

const ROLE_LABELS = {
  captain:       'Captain',
  chief_officer: 'Chief Officer',
  bosun:         'Bosun',
  custom:        'Team Member',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ?token= — validate invite before showing the accept screen ──────────
  if (req.method === 'GET') {
    const token = (req.query?.token || '').trim();
    if (!token) return res.status(400).json({ valid: false, error: 'Token required.' });

    const { data: member } = await supabase
      .from('account_members')
      .select('email, role, custom_tabs, status, invite_expires_at, owner_user_id')
      .eq('invite_token', token)
      .single();

    if (!member)
      return res.status(404).json({ valid: false, error: 'Invalid or expired invite link.' });
    if (member.status !== 'invited')
      return res.status(409).json({ valid: false, error: 'This invite has already been used.' });
    if (member.invite_expires_at && new Date(member.invite_expires_at) < new Date())
      return res.status(410).json({ valid: false, error: 'This invite link has expired. Ask the account owner to send a new one.' });

    const { data: ownerAcct } = await supabase
      .from('accounts').select('company_name').eq('user_id', member.owner_user_id).single();

    return res.status(200).json({
      valid:      true,
      email:      member.email,
      role:       member.role,
      roleLabel:  ROLE_LABELS[member.role] || member.role,
      customTabs: member.custom_tabs || [],
      company:    ownerAcct?.company_name || 'your team',
    });
  }

  // ── POST ?action=accept — create sub-user account and link it ───────────────
  if (req.method === 'POST' && req.query?.action === 'accept') {
    const { token, name, password } = req.body || {};
    if (!token || !name || !password)
      return res.status(400).json({ error: 'Token, name, and password are required.' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const { data: member } = await supabase
      .from('account_members')
      .select('id, email, status, invite_expires_at')
      .eq('invite_token', token)
      .single();

    if (!member)
      return res.status(404).json({ error: 'Invalid invite link.' });
    if (member.status !== 'invited')
      return res.status(409).json({ error: 'This invite has already been used.' });
    if (member.invite_expires_at && new Date(member.invite_expires_at) < new Date())
      return res.status(410).json({ error: 'This invite link has expired.' });

    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email:         member.email,
      password,
      email_confirm: true,
      user_metadata: { contact_name: name.trim(), is_member: true },
    });

    if (createErr) {
      if (createErr.message?.toLowerCase().includes('already') || createErr.status === 422)
        return res.status(409).json({ error: 'already_exists' });
      return res.status(400).json({ error: createErr.message });
    }

    const { error: linkErr } = await supabase
      .from('account_members')
      .update({ member_user_id: newUser.user.id, status: 'active', invite_token: null, invite_expires_at: null })
      .eq('id', member.id);

    if (linkErr)
      return res.status(500).json({ error: 'Account created but linking failed: ' + linkErr.message });

    return res.status(200).json({ ok: true, email: member.email });
  }

  // ── POST — create or re-send invite (account owner only) ────────────────────
  if (req.method === 'POST') {
    const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!authToken) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const { data: ownerAcct } = await supabase
      .from('accounts').select('company_name, plan, status').eq('user_id', user.id).single();
    if (!ownerAcct)
      return res.status(403).json({ error: 'Only account owners can invite team members.' });

    const { email, role, custom_tabs } = req.body || {};
    if (!email || !role) return res.status(400).json({ error: 'Email and role are required.' });
    if (!['captain','chief_officer','bosun','custom'].includes(role))
      return res.status(400).json({ error: 'Invalid role.' });

    const inviteToken = crypto.randomUUID();
    const expiresAt   = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const normalEmail = email.toLowerCase().trim();

    const { error: upsertErr } = await supabase.from('account_members').upsert({
      owner_user_id:    user.id,
      email:            normalEmail,
      role,
      custom_tabs:      custom_tabs || null,
      status:           'invited',
      member_user_id:   null,
      invite_token:     inviteToken,
      invite_expires_at: expiresAt,
    }, { onConflict: 'owner_user_id,email' });

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    const company   = ownerAcct.company_name || 'your team';
    const roleLabel = ROLE_LABELS[role] || role;
    const inviteUrl = `${BASE_URL}/?invite=${inviteToken}`;

    const { error: emailErr } = await resend.emails.send({
      from:    FROM,
      to:      normalEmail,
      subject: `You've been invited to view ${company}'s Boat Race dashboard`,
      html: `
        <div style="font-family:sans-serif;max-width:460px;margin:0 auto;padding:28px;background:#0a1628;color:#e8f4fd;border-radius:14px;">
          <div style="font-family:monospace;font-size:26px;font-weight:900;letter-spacing:.04em;margin-bottom:18px;">
            BOAT <span style="color:#00d4ff;">RACE</span>
          </div>
          <h2 style="font-size:17px;margin:0 0 10px;color:#e8f4fd;">You've been invited</h2>
          <p style="font-size:14px;color:#a0b4c8;margin-bottom:22px;line-height:1.5;">
            <strong style="color:#e8f4fd;">${company}</strong> has invited you to view their
            Boat Race sales dashboard as <strong style="color:#00d4ff;">${roleLabel}</strong>.
          </p>
          <a href="${inviteUrl}"
             style="display:inline-block;background:#00d4ff;color:#060e1c;font-weight:700;
                    padding:12px 28px;border-radius:8px;text-decoration:none;font-size:15px;">
            Accept Invite &amp; Set Up Access
          </a>
          <p style="font-size:12px;color:#6b8db5;margin-top:22px;">This link expires in 7 days.</p>
        </div>`,
    });

    if (emailErr)
      return res.status(200).json({ ok: true, emailWarning: 'Invite saved but email failed: ' + emailErr.message });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
