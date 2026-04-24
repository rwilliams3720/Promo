import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function deleteUserData(targetId) {
  await Promise.all([
    supabase.from('call_log').delete().eq('user_id', targetId),
    supabase.from('sales_log').delete().eq('user_id', targetId),
    supabase.from('historical_wins').delete().eq('user_id', targetId),
    supabase.from('historical_months').delete().eq('user_id', targetId),
    supabase.from('race_config').delete().eq('user_id', targetId),
    supabase.from('scoring_config').delete().eq('user_id', targetId),
  ]);
  await supabase.from('race_data').delete().eq('user_id', targetId);
  await supabase.from('accounts').delete().eq('user_id', targetId);
  const { error } = await supabase.auth.admin.deleteUser(targetId);
  return error;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: callerAcct } = await supabase
    .from('accounts')
    .select('is_admin, stripe_customer_id')
    .eq('user_id', user.id)
    .single();

  const { targetUserId } = req.body || {};

  // Admin deleting another user's account
  if (targetUserId && targetUserId !== user.id) {
    if (!callerAcct?.is_admin) return res.status(403).json({ error: 'Admin only' });

    // Prevent deleting another admin account
    const { data: targetAcct } = await supabase
      .from('accounts')
      .select('is_admin, stripe_customer_id')
      .eq('user_id', targetUserId)
      .single();
    if (!targetAcct) return res.status(404).json({ error: 'User not found' });
    if (targetAcct.is_admin) return res.status(403).json({ error: 'Cannot delete an admin account' });

    await cancelStripeSubscriptions(targetAcct.stripe_customer_id);
    const err = await deleteUserData(targetUserId);
    if (err) return res.status(500).json({ error: 'Data deleted but auth removal failed: ' + err.message });
    return res.status(200).json({ success: true });
  }

  // User deleting their own account — admins cannot self-delete
  if (callerAcct?.is_admin) return res.status(403).json({ error: 'Admin accounts cannot be self-deleted' });

  await cancelStripeSubscriptions(callerAcct?.stripe_customer_id);
  const err = await deleteUserData(user.id);
  if (err) {
    console.error('Auth delete error:', err.message);
    return res.status(500).json({ error: 'Data deleted but auth removal failed: ' + err.message });
  }

  return res.status(200).json({ success: true });
}

async function cancelStripeSubscriptions(customerId) {
  if (!customerId || !process.env.STRIPE_SECRET_KEY) return;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    for (const status of ['active', 'past_due', 'trialing']) {
      const { data: subs } = await stripe.subscriptions.list({ customer: customerId, status, limit: 10 });
      for (const sub of (subs || [])) await stripe.subscriptions.cancel(sub.id);
    }
  } catch (err) {
    console.error('Stripe cancellation error:', err.message);
  }
}
