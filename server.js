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

// ─── Route: Create Stripe Checkout Session ────────────────────────────────────
app.post('/api/create-checkout-session', async (req, res) => {
  const { planId } = req.body;
  const plan = PLANS[planId];

  // Safety check: ensure keys are configured
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('PASTE_YOUR_FULL')) {
    return res.status(400).json({
      error: 'Stripe keys are not configured. Please open the `.env` file in the project folder and paste your actual Stripe API keys.'
    });
  }

  if (!plan) {
    return res.status(400).json({ error: `Unknown plan: ${planId}` });
  }

  // Build the line item for this session
  const lineItem = {
    price_data: {
      currency:     plan.currency,
      product_data: {
        name:        plan.name,
        description: plan.description,
        images: [],  // add a coach photo URL here if desired
      },
      unit_amount: plan.price,
    },
    quantity: 1,
  };

  // Subscriptions need recurring data on the price_data
  if (plan.mode === 'subscription') {
    lineItem.price_data.recurring = { interval: 'month' };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode:                  plan.mode,
      line_items:           [lineItem],
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`,
      cancel_url:  `${req.headers.origin}/#pricing`,
      metadata: {
        planId,
        planName: plan.name,
      },
      // Collect billing address for compliance
      billing_address_collection: 'auto',
      // Allow promo codes
      allow_promotion_codes: true,
    });

    res.json({ url: session.url, sessionId: session.id });
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
