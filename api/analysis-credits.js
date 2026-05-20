import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CREDIT_COST   = 3.00;
const VALID_AMOUNTS = [5, 10, 20];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: acct } = await supabase.from('accounts')
    .select('user_id, credit_balance, stripe_customer_id, is_admin')
    .eq('user_id', user.id)
    .single();
  if (!acct) return res.status(403).json({ error: 'Owner access required' });

  const userId = user.id;

  if (req.method === 'GET') {
    return res.status(200).json({ balance: Number(acct.credit_balance) || 0 });
  }

  if (req.method === 'POST') {
    const { action, amount } = req.body || {};

    if (action === 'charge_run') {
      const balance = Number(acct.credit_balance) || 0;
      if (balance < CREDIT_COST) {
        return res.status(402).json({ error: 'Insufficient credits', balance });
      }
      const newBalance = Math.round((balance - CREDIT_COST) * 100) / 100;
      const { error } = await supabase.from('accounts')
        .update({ credit_balance: newBalance })
        .eq('user_id', userId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, balance: newBalance });
    }

    if (action === 'checkout') {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });
      const stripe  = new Stripe(stripeKey, { maxNetworkRetries: 1 });
      const dollars = VALID_AMOUNTS.includes(Number(amount)) ? Number(amount) : 10;
      const appUrl  = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      const params = {
        mode: 'payment',
        client_reference_id: userId,
        metadata: { type: 'analysis_credit', credits: String(dollars) },
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `Analysis Credits — $${dollars}` },
            unit_amount: dollars * 100,
          },
          quantity: 1,
        }],
        success_url: `${appUrl}/?billing=credit_success&amount=${dollars}`,
        cancel_url:  `${appUrl}/?billing=credit_cancel`,
      };

      if (acct.stripe_customer_id) {
        params.customer = acct.stripe_customer_id;
      }

      try {
        const session = await stripe.checkout.sessions.create(params);
        return res.status(200).json({ url: session.url });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
