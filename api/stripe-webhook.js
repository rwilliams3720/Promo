import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe   = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PLAN_BY_PRICE = {
  [process.env.STRIPE_PRICE_BASIC]:   'basic',
  [process.env.STRIPE_PRICE_PRO]:     'pro',
  [process.env.STRIPE_PRICE_PREMIUM]: 'premium',
};

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig     = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId  = session.client_reference_id;
        if (!userId) break;
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = sub.items.data[0]?.price?.id;
        const plan    = PLAN_BY_PRICE[priceId] || 'basic';
        const paidThrough = new Date(sub.current_period_end * 1000).toISOString();
        await supabase.from('accounts').update({
          status:             'paid',
          plan,
          stripe_customer_id: session.customer,
          paid_through:       paidThrough,
        }).eq('user_id', userId);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        const priceId    = sub.items.data[0]?.price?.id;
        const plan       = PLAN_BY_PRICE[priceId] || 'basic';
        const paidThrough = new Date(sub.current_period_end * 1000).toISOString();
        await supabase.from('accounts').update({
          status: 'paid',
          plan,
          paid_through: paidThrough,
        }).eq('stripe_customer_id', customerId);
        break;
      }

      case 'invoice.payment_failed': {
        const customerId = event.data.object.customer;
        await supabase.from('accounts')
          .update({ status: 'past_due' })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'customer.subscription.updated': {
        const sub        = event.data.object;
        const customerId = sub.customer;
        const priceId    = sub.items.data[0]?.price?.id;
        const plan       = PLAN_BY_PRICE[priceId] || 'basic';
        const paidThrough = new Date(sub.current_period_end * 1000).toISOString();
        const status = sub.status === 'active' ? 'paid'
                     : sub.status === 'past_due' ? 'past_due'
                     : 'deferred';
        await supabase.from('accounts').update({ status, plan, paid_through: paidThrough })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'customer.subscription.deleted': {
        const customerId = event.data.object.customer;
        // Don't override 'deferred' — admin set it intentionally to preserve access after cancel
        await supabase.from('accounts')
          .update({ status: 'cancelled' })
          .eq('stripe_customer_id', customerId)
          .neq('status', 'deferred');
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
