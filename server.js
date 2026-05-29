/**
 * Apex Elite Coaching - Backend Server
 * Node.js + Express + Stripe Checkout Integration
 * 
 * SECURITY: The Stripe secret key only lives here, never in the browser.
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
// Stripe webhook needs the raw body BEFORE json() parses it
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors());
// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ─── Pricing Plans ────────────────────────────────────────────────────────────
// Each plan maps to a Stripe Price object.
// Mode: 'payment' = one-time  |  'subscription' = recurring monthly
const PLANS = {
  starter: {
    name:        'Starter Kickoff',
    description: 'Perfect for beginners. Core workouts, nutrition guide & machine blueprint.',
    price:        2900,        // $29.00 in cents
    currency:    'usd',
    mode:        'payment',    // one-time
    features: [
      'Beginner Workout Selector',
      'Daily Macro Calculator',
      'Gym Machine Blueprint',
      'Unlock Level-1 Finishers',
    ],
  },
  shred: {
    name:        'Apex Shred Program',
    description: 'Intermediate fat-loss plan with coach-designed high-intensity circuits.',
    price:        4900,
    currency:    'usd',
    mode:        'payment',
    features: [
      'Intermediate Workout Selector',
      'Fat-Loss Macro Protocols',
      'Gym Machine Blueprint',
      'Unlock ALL Premium Finishers',
      'PDF Shred Calendar (12-weeks)',
    ],
  },
  elite: {
    name:        'Elite Monthly Coaching',
    description: 'Monthly subscription. Full access + weekly check-ins with your coach.',
    price:        7900,
    currency:    'usd',
    mode:        'subscription',  // recurring monthly
    features: [
      'All Workout Levels Unlocked',
      'Personalised Meal Planning',
      'Weekly 1-on-1 Zoom Check-ins',
      'WhatsApp Direct Line',
      'Unlimited Plan Adjustments',
    ],
  },
  vip: {
    name:        'VIP Supreme Transformation',
    description: 'The complete package. Daily coaching, full nutrition tracking & priority support.',
    price:        19900,
    currency:    'usd',
    mode:        'subscription',
    features: [
      'Daily Coach Accountability',
      'Custom Hyper-Personalised Plan',
      'Priority WhatsApp & Video Calls',
      'Supplement & Diet Coaching',
      'Body Scan Analysis Reviews',
      'Lifetime Access to All Programs',
    ],
  },
};

// ─── Route: Expose Stripe Config (for publishable key) ────────────────────────
app.get('/api/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// ─── Cloudflare Turnstile Verification Helper ──────────────────────────────────
async function verifyTurnstile(token, ip) {
  if (!token) return false;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn('⚠️  TURNSTILE_SECRET_KEY not set — skipping verification in dev mode');
    return true; // skip verification if key not configured (dev only)
  }
  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: ip || '',
  });
  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const outcome = await verifyRes.json();
  return outcome.success === true;
}

// ─── Route: Get All Plans (for the frontend to render dynamically) ────────────
app.get('/api/plans', (req, res) => {
  const plansForClient = Object.entries(PLANS).map(([id, plan]) => ({
    id,
    name:        plan.name,
    description: plan.description,
    price:       plan.price,
    currency:    plan.currency,
    mode:        plan.mode,
    features:    plan.features,
  }));
  res.json(plansForClient);
});

// ─── Route: Create Stripe Payment Intent or Subscription ──────────────────────
app.post('/api/create-payment-intent', async (req, res) => {
  const { planId, email, turnstileToken } = req.body;
  const plan = PLANS[planId];

  // Safety check: ensure keys are configured
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('PASTE_YOUR_FULL')) {
    return res.status(400).json({
      error: 'Stripe keys are not configured. Please open the `.env` file in the project folder and paste your actual Stripe API keys.'
    });
  }

  // ── Cloudflare Turnstile verification ────────────────────────────────────────
  const clientIp = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const turnstileOk = await verifyTurnstile(turnstileToken, clientIp);
  if (!turnstileOk) {
    return res.status(403).json({ error: 'Bot verification failed. Please refresh and try again.' });
  }

  if (!plan) {
    return res.status(400).json({ error: `Unknown plan: ${planId}` });
  }

  if (!email) {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  try {
    if (plan.mode === 'subscription') {
      // 1. Create a Product & Price dynamically in Stripe
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.price,
        currency: plan.currency,
        recurring: { interval: 'month' },
      });

      // 2. Create the Customer
      const customer = await stripe.customers.create({
        email: email,
      });

      // 3. Create the Subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          planId,
          planName: plan.name,
        }
      });

      const paymentIntent = subscription.latest_invoice.payment_intent;

      res.json({
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        planId,
        mode: 'subscription'
      });

    } else {
      // One-time payment: Create a PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: plan.price,
        currency: plan.currency,
        automatic_payment_methods: { enabled: true },
        receipt_email: email,
        metadata: {
          planId,
          planName: plan.name,
        },
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        planId,
        mode: 'payment'
      });
    }
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ─── Route: Stripe Webhook (receives payment confirmations from Stripe) ────────
app.post('/webhook', (req, res) => {
  const sig     = req.headers['stripe-signature'];
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log(`✅ Payment successful: ${session.metadata.planName} | Customer: ${session.customer_email}`);
      // TODO: save to DB, send confirmation email, etc.
      break;
    }
    case 'invoice.payment_succeeded': {
      // Recurring subscription payment succeeded
      console.log('✅ Subscription renewal paid:', event.data.object.id);
      break;
    }
    case 'customer.subscription.deleted': {
      // Subscription cancelled
      console.log('❌ Subscription cancelled:', event.data.object.id);
      break;
    }
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// ─── Fallback: serve index.html for any unmatched route ──────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const hasSecret = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('PASTE_YOUR_FULL');
  const hasPub = process.env.STRIPE_PUBLISHABLE_KEY && !process.env.STRIPE_PUBLISHABLE_KEY.includes('PASTE_YOUR_FULL');

  console.log(`\n🔥 Apex Elite Server running at http://localhost:${PORT}`);
  
  if (!hasSecret || !hasPub) {
    console.log('\n=============================================================');
    console.log('⚠️  STRIPE API KEYS ARE NOT CONFIGURED');
    console.log('   Please open the .env file in the project folder and paste');
    console.log('   your complete Stripe Publishable and Secret Keys.');
    console.log('   Get them from: https://dashboard.stripe.com/test/apikeys');
    console.log('=============================================================\n');
  } else {
    console.log(`   Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? '🟢 LIVE' : '🟡 TEST'}\n`);
  }
});
