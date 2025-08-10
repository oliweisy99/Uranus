// /api/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_TEST, { apiVersion: '2024-06-20' });
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { priceId, packSize, mode, customerEmail, success_url, cancel_url, peopleKey } = req.body || {};

    const metadata = {
      priceId: String(priceId || ''),
      packSize: String(packSize || ''),
      plan: String(mode || ''),
      peopleKey: String(peopleKey || ''),
    };

    const base = {
      customer_creation: 'always',
      customer_email: customerEmail || undefined,
      success_url: success_url || 'https://wipeuranus.com/#success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancel_url  || 'https://wipeuranus.com/#cancel',
      metadata,
      custom_text: { submit: { message: `Uranus – ${packSize || ''} rolls (${mode}${peopleKey ? `, ${peopleKey}` : ''})` } },
    };

    const params = mode === 'payment'
      ? {
          ...base,
          mode: 'payment',
          line_items: [{ price: priceId, quantity: 1 }],
          payment_intent_data: { setup_future_usage: 'off_session', metadata },
        }
      : {
          ...base,
          mode: 'subscription',
          line_items: [{ price: priceId, quantity: 1 }],
          subscription_data: { metadata },
        };
    
    // Build ONLY setup-safe params
    // const params = {
    //   mode: 'setup',
    //   payment_method_types: ['card'],  
    //   customer_creation: 'always',
    //   customer_email: customerEmail || undefined,
    //   success_url: success_url || 'https://wipeuranus.com/#success?session_id={CHECKOUT_SESSION_ID}',
    //   cancel_url:  cancel_url  || 'https://wipeuranus.com/#cancel',
    //   custom_text: {
    //     submit: {
    //       message: `Saving a card for Uranus – ${packSize || ''} rolls (${mode || 'setup'}${mode === 'subscription' && peopleKey ? `, ${peopleKey}` : ''}).`
    //     }
    //   },
    //   metadata,
    //   setup_intent_data: { metadata }, 
    // };

    console.log('Creating setup Checkout Session with params:', params); // helpful sanity log

    const session = await stripe.checkout.sessions.create(params);

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
};
