// /api/create-checkout-session.js
const Stripe = require('stripe');
// const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_TEST, { apiVersion: '2024-06-20' });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

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
    
    if (!['payment', 'subscription'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode (expected "payment" or "subscription")' });
    }
    if (!priceId) {
      return res.status(400).json({ error: 'Missing priceId' });
    }
    
    const metadata = {
      priceId: String(priceId || ''),
      packSize: String(packSize || ''),
      plan: String(mode || ''),
      peopleKey: String(peopleKey || ''),
    };

// pick the same domain the request came from (handles www vs non-www)
    const siteOrigin = (ALLOWED_ORIGINS.has(origin) ? origin : 'https://wipeuranus.com').replace(/\/$/, '');
    
    const DEFAULT_SUCCESS = `${siteOrigin}/?session_id={CHECKOUT_SESSION_ID}#success`;
    const DEFAULT_CANCEL  = `${siteOrigin}/#cancel`;
    
    // force a success url that contains the token, even if client sends one
    const successUrl = (success_url && success_url.includes('{CHECKOUT_SESSION_ID}'))
      ? success_url
      : DEFAULT_SUCCESS;
    
    const cancelUrl = cancel_url || DEFAULT_CANCEL;
    
    const base = {
      customer_email: customerEmail || undefined,
      success_url: successUrl,
      cancel_url:  cancelUrl,
      allow_promotion_codes: true,
      shipping_address_collection: { allowed_countries: ['GB'] },
      billing_address_collection: 'required',
      metadata,
      custom_text: { submit: { message: `Uranus – ${packSize || ''} rolls (${mode}${peopleKey ? `, ${peopleKey}` : ''})` } },
    };

    let params;
    if (mode === 'payment') {
      params = {
        ...base,
        mode: 'payment',
        customer_creation: 'always', // ensure a Customer exists so PM is saved
        line_items: [{ price: priceId, quantity: 1 }],
        payment_intent_data: { setup_future_usage: 'off_session', metadata },
      };
    } else {
      // subscription
      params = {
        ...base,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata },
      };
    }
    
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

    const session = await stripe.checkout.sessions.create(params);

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
};
