import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

  const priceId = process.env.STRIPE_PRICE_MEMBER_ANALYSIS;
  if (!priceId) return res.status(500).json({ error: 'Member analysis price not configured' });

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: acct } = await supabase
    .from('accounts')
    .select('email, company_name, stripe_customer_id, has_member_analysis, member_analysis_count')
    .eq('user_id', user.id)
    .single();
  if (!acct) return res.status(500).json({ error: 'Account not found' });

  const stripe = new Stripe(stripeKey, { maxNetworkRetries: 1 });

  // ── DELETE: cancel subscription ────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!acct.has_member_analysis) return res.status(400).json({ error: 'Add-on not active' });

    if (acct.stripe_customer_id) {
      try {
        for (const status of ['active', 'past_due', 'trialing']) {
          const { data: subs } = await stripe.subscriptions.list({
            customer: acct.stripe_customer_id, status, limit: 10,
          });
          for (const sub of (subs || [])) {
            if (sub.items?.data?.some(item => item.price?.id === priceId)) {
              await stripe.subscriptions.cancel(sub.id);
            }
          }
        }
      } catch (err) {
        console.error('Stripe member analysis cancel error:', err.message);
      }
    }

    await supabase.from('accounts').update({
      has_member_analysis:           false,
      member_analysis_count:         0,
      member_analysis_stripe_sub_id: null,
    }).eq('user_id', user.id);

    return res.status(200).json({ ok: true });
  }

  // ── PATCH: activate after checkout OR update quantity ──────────────────────
  if (req.method === 'PATCH') {
    const { action, count } = req.body || {};
    const parsedCount = Math.max(1, parseInt(count) || 1);

    if (action === 'activate') {
      // SECURITY: never trust the client to self-activate or set the seat count.
      // Verify a real, paid subscription exists for the member-analysis price and
      // derive the seat count from the subscription quantity itself.
      if (!acct.stripe_customer_id) {
        return res.status(402).json({ error: 'No payment on file' });
      }
      let verifiedQty = 0;
      try {
        for (const status of ['active', 'trialing', 'past_due']) {
          const { data: subs } = await stripe.subscriptions.list({
            customer: acct.stripe_customer_id, status, limit: 10,
          });
          for (const sub of (subs || [])) {
            const item = sub.items?.data?.find(i => i.price?.id === priceId);
            if (item) verifiedQty = Math.max(verifiedQty, item.quantity || 1);
          }
        }
      } catch (err) {
        console.error('Stripe member analysis verify error:', err.message);
        return res.status(500).json({ error: 'Could not verify subscription' });
      }
      if (verifiedQty < 1) {
        return res.status(402).json({ error: 'No active member-analysis subscription found' });
      }
      await supabase.from('accounts').update({
        has_member_analysis:   true,
        member_analysis_count: verifiedQty,
      }).eq('user_id', user.id);
      return res.status(200).json({ ok: true, count: verifiedQty });
    }

    if (action === 'update') {
      if (!acct.has_member_analysis) return res.status(400).json({ error: 'Add-on not active' });

      // Only persist the new count after Stripe confirms the quantity change on a
      // real subscription item — never write an unverified count to the DB.
      let applied = false;
      if (acct.stripe_customer_id) {
        try {
          for (const status of ['active', 'past_due', 'trialing']) {
            const { data: subs } = await stripe.subscriptions.list({
              customer: acct.stripe_customer_id, status, limit: 10,
            });
            for (const sub of (subs || [])) {
              const item = sub.items?.data?.find(i => i.price?.id === priceId);
              if (item) {
                await stripe.subscriptionItems.update(item.id, { quantity: parsedCount });
                applied = true;
              }
            }
          }
        } catch (err) {
          console.error('Stripe member analysis update error:', err.message);
          return res.status(500).json({ error: err.message });
        }
      }
      if (!applied) return res.status(402).json({ error: 'No active subscription to update' });

      await supabase.from('accounts').update({
        member_analysis_count: parsedCount,
      }).eq('user_id', user.id);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  }

  // ── POST: create subscription via Stripe Checkout ─────────────────────────
  if (req.method === 'POST') {
    const { count } = req.body || {};
    const parsedCount = Math.max(1, parseInt(count) || 1);

    if (acct.has_member_analysis) return res.status(400).json({ error: 'Add-on already active' });

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
        line_items:           [{ price: priceId, quantity: parsedCount }],
        client_reference_id:  user.id,
        success_url:          `${baseUrl}/app?member_analysis=success&ma_count=${parsedCount}`,
        cancel_url:           `${baseUrl}/app?member_analysis=cancel`,
        subscription_data: {
          metadata: { supabase_user_id: user.id, addon: 'member_analysis', count: String(parsedCount) },
        },
      });

      return res.status(200).json({ url: session.url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
