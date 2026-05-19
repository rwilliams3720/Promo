import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

  const priceId = process.env.STRIPE_PRICE_COMMISSIONS_ADDON;
  if (!priceId) return res.status(500).json({ error: 'Commissions add-on price not configured' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: acct } = await supabase
    .from('accounts')
    .select('email, company_name, stripe_customer_id, has_commissions_addon')
    .eq('user_id', user.id)
    .single();
  if (!acct) return res.status(500).json({ error: 'Account not found' });

  const stripe = new Stripe(stripeKey, { maxNetworkRetries: 1 });

  // DELETE — cancel commissions add-on subscription
  if (req.method === 'DELETE') {
    if (!acct.has_commissions_addon) return res.status(400).json({ error: 'Add-on not active' });
    if (acct.stripe_customer_id) {
      try {
        for (const status of ['active', 'past_due', 'trialing']) {
          const { data: subs } = await stripe.subscriptions.list({ customer: acct.stripe_customer_id, status, limit: 10 });
          for (const sub of (subs || [])) {
            const subPriceId = sub.items?.data?.[0]?.price?.id;
            if (subPriceId === process.env.STRIPE_PRICE_COMMISSIONS_ADDON) {
              await stripe.subscriptions.cancel(sub.id);
            }
          }
        }
      } catch (err) {
        console.error('Stripe commissions addon cancel error:', err.message);
      }
    }
    await supabase.from('accounts').update({ has_commissions_addon: false }).eq('user_id', user.id);
    return res.status(200).json({ ok: true });
  }

  if (acct.has_commissions_addon) return res.status(400).json({ error: 'Add-on already active' });
  const baseUrl = 'https://the-boat-race.com';

  try {
    let customerId = acct.stripe_customer_id || undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    acct.email || user.email,
        name:     acct.company_name || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase.from('accounts').update({ stripe_customer_id: customerId }).eq('user_id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      client_reference_id:  user.id,
      success_url:          `${baseUrl}/app?addon=commissions_success`,
      cancel_url:           `${baseUrl}/app?addon=commissions_cancel`,
      subscription_data: {
        metadata: { supabase_user_id: user.id, addon: 'commissions' },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
