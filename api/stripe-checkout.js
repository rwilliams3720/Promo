import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PRICES = {
  basic:   process.env.STRIPE_PRICE_BASIC,
  pro:     process.env.STRIPE_PRICE_PRO,
  premium: process.env.STRIPE_PRICE_PREMIUM,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: acct, error: acctErr } = await supabase
    .from('accounts')
    .select('plan, status, stripe_customer_id, email, company_name')
    .eq('user_id', user.id)
    .single();
  if (acctErr || !acct) return res.status(500).json({ error: 'Account not found' });

  const { plan } = req.body || {};
  const priceId = PRICES[plan];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan' });

  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://the-boat-race.com';

  try {
    // Reuse existing Stripe customer if present
    let customerId = acct.stripe_customer_id || undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: acct.email || user.email,
        name:  acct.company_name || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase.from('accounts').update({ stripe_customer_id: customerId }).eq('user_id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id:  user.id,
      success_url: `${baseUrl}/app?billing=success`,
      cancel_url:  `${baseUrl}/app?billing=cancel`,
      subscription_data: {
        metadata: { supabase_user_id: user.id, plan },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
