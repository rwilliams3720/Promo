import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify requesting user is an admin
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: adminRow } = await supabase
    .from('accounts').select('is_admin').eq('user_id', user.id).single();
  if (!adminRow?.is_admin) return res.status(403).json({ error: 'Forbidden' });

  // GET — list all accounts
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('user_id,email,company_name,contact_name,phone,plan,agent_count,referral_source,status,is_admin,notes,trial_ends_at,paid_through,stripe_customer_id,created_at,last_login')
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PATCH — update an account
  if (req.method === 'PATCH') {
    const { userId, ...fields } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const allowed = ['status','notes','paid_through','is_admin','plan','agent_count','trial_ends_at','stripe_customer_id','timezone','report_hour'];
    const update  = {};
    for (const key of allowed) {
      if (fields[key] !== undefined) update[key] = fields[key];
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No updatable fields provided' });

    try {
      const { error } = await supabase.from('accounts').update(update).eq('user_id', userId);
      if (error) return res.status(500).json({ error: error.message });

      // When setting status to 'deferred', cancel any active Stripe subscriptions immediately.
      // The subscription.deleted webhook is protected from overriding 'deferred' back to 'cancelled'.
      if (update.status === 'deferred') {
        const { data: acct } = await supabase
          .from('accounts').select('stripe_customer_id').eq('user_id', userId).single();
        if (acct?.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
          try {
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 1 });
            const subs = await stripe.subscriptions.list({ customer: acct.stripe_customer_id, status: 'active' });
            for (const sub of subs.data) {
              await stripe.subscriptions.cancel(sub.id);
            }
          } catch (stripeErr) {
            // Log but don't fail the admin save if Stripe cancel errors
            console.error('Stripe cancel error on deferred:', stripeErr.message);
          }
        }
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
