import express from 'express';
import Stripe from 'stripe';
import jwt from 'jsonwebtoken';
import { getTokenFromRequest } from './auth.js';
import { getUserById, updateUserStripe, getDB } from '../db/index.js';

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
}

// ── GET /api/stripe/config ─────────────────────────────────
// Returns the publishable key for Stripe.js (safe to expose)
router.get('/config', (_req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) return res.status(500).json({ error: 'STRIPE_PUBLISHABLE_KEY not set in .env' });
  res.json({ publishableKey });
});

// ── GET /api/stripe/checkout-success ──────────────────────
// Stripe redirects here after embedded checkout completes.
// Retrieves the session directly from Stripe (bypasses webhook timing),
// updates the DB immediately, then redirects to the correct success page.
router.get('/checkout-success', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/index.html');

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const userId = parseInt(session.metadata?.user_id, 10);
    const type   = session.metadata?.type;

    // For subscriptions, payment_status can be 'no_payment_required' even on first charge;
    // use session.subscription presence as the reliable "paid" signal instead.
    const isPaid = session.payment_status === 'paid' ||
                   (session.mode === 'subscription' && !!session.subscription);

    if (isPaid && userId) {
      const updates = {};
      if (session.customer)   updates.stripe_customer_id = session.customer;
      if (type === 'book')    updates.has_book = true;
      if (type === 'premium') updates.subscription_status = 'premium';
      if (Object.keys(updates).length > 0) await updateUserStripe(userId, updates);
    }

    if (type === 'book') return res.redirect('/book-download.html');
    return res.redirect('/premium-hub.html');

  } catch (err) {
    console.error('checkout-success error:', err.message);
    res.redirect('/my-account.html');
  }
});

// ── POST /api/stripe/create-checkout ──────────────────────
// Requires auth. Body: { type: 'book' | 'premium_monthly' | 'premium_lifetime', embedded?: boolean }
router.post('/create-checkout', async (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({ error: 'Please sign in before purchasing.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    const user = await getUserById(decoded.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { type, embedded } = req.body;
    const stripe = getStripe();
    const origin = `${req.protocol}://${req.get('host')}`;

    let sessionParams;

    if (type === 'book') {
      const price = process.env.STRIPE_PRICE_BOOK;
      if (!price) return res.status(500).json({ error: 'Book price not configured (STRIPE_PRICE_BOOK missing from .env)' });
      sessionParams = {
        mode: 'payment',
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        customer_email: user.email,
        metadata: { user_id: String(user.id), type: 'book' },
        ...(embedded
          ? { ui_mode: 'embedded', return_url: `${origin}/api/stripe/checkout-success?session_id={CHECKOUT_SESSION_ID}` }
          : { success_url: `${origin}/book-download.html`, cancel_url: `${origin}/index.html` }),
      };

    } else if (type === 'premium_monthly') {
      const price = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
      if (!price) return res.status(500).json({ error: 'Monthly price not configured (STRIPE_PRICE_PREMIUM_MONTHLY missing from .env)' });
      sessionParams = {
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        customer_email: user.email,
        metadata: { user_id: String(user.id), type: 'premium' },
        ...(embedded
          ? { ui_mode: 'embedded', return_url: `${origin}/api/stripe/checkout-success?session_id={CHECKOUT_SESSION_ID}` }
          : { success_url: `${origin}/premium-hub.html`, cancel_url: `${origin}/index.html#pricing` }),
      };

    } else if (type === 'premium_lifetime') {
      const price = process.env.STRIPE_PRICE_PREMIUM_LIFETIME;
      if (!price) return res.status(500).json({ error: 'Lifetime price not configured (STRIPE_PRICE_PREMIUM_LIFETIME missing from .env)' });
      sessionParams = {
        mode: 'payment',
        line_items: [{ price, quantity: 1 }],
        allow_promotion_codes: true,
        customer_email: user.email,
        metadata: { user_id: String(user.id), type: 'premium' },
        ...(embedded
          ? { ui_mode: 'embedded', return_url: `${origin}/api/stripe/checkout-success?session_id={CHECKOUT_SESSION_ID}` }
          : { success_url: `${origin}/premium-hub.html`, cancel_url: `${origin}/index.html#pricing` }),
      };

    } else {
      return res.status(400).json({ error: 'Invalid type. Use: book, premium_monthly, or premium_lifetime' });
    }

    // Reuse existing Stripe customer if available (avoids duplicate customers)
    if (user.stripe_customer_id) {
      sessionParams.customer = user.stripe_customer_id;
      delete sessionParams.customer_email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (embedded) {
      res.json({ clientSecret: session.client_secret });
    } else {
      res.json({ url: session.url });
    }

  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session: ' + err.message });
  }
});

// ── POST /api/stripe/webhook ───────────────────────────────
// IMPORTANT: Mounted in server.js with express.raw() BEFORE express.json()
// so Stripe's signature verification works on the raw body.
export async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set — cannot verify webhook');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = parseInt(session.metadata?.user_id, 10);
        const type = session.metadata?.type;

        if (!userId) {
          console.warn('Webhook: checkout.session.completed — missing user_id in metadata');
          break;
        }

        const updates = {};
        if (session.customer) updates.stripe_customer_id = session.customer;
        if (type === 'book')    updates.has_book = true;
        if (type === 'premium') updates.subscription_status = 'premium';

        await updateUserStripe(userId, updates);
        console.log(`Stripe: checkout completed — user ${userId}, type ${type}`);
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription fully cancelled
        const sub = event.data.object;
        const sql = getDB();
        await sql`
          UPDATE users SET subscription_status = 'free'
          WHERE stripe_customer_id = ${sub.customer}
        `;
        console.log(`Stripe: subscription cancelled — customer ${sub.customer}`);
        break;
      }

      case 'customer.subscription.updated': {
        // Could be a renewal, upgrade, downgrade, or cancellation at period end
        const sub = event.data.object;
        const isActive = sub.status === 'active' || sub.status === 'trialing';
        const sql = getDB();
        await sql`
          UPDATE users SET subscription_status = ${isActive ? 'premium' : 'free'}
          WHERE stripe_customer_id = ${sub.customer}
        `;
        console.log(`Stripe: subscription updated — customer ${sub.customer}, status ${sub.status}`);
        break;
      }

      case 'invoice.payment_failed': {
        console.log(`Stripe: payment failed — customer ${event.data.object.customer}`);
        // You could add email notification logic here
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    // Return 200 anyway so Stripe doesn't keep retrying
  }

  res.json({ received: true });
}

export default router;
