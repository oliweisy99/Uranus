// /api/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

module.exports = async (req, res) => {
  // CORS for wipeuranus.com (loosen to * if you like)
  res.setHeader('Access-Control-Allow-Origin', 'https://www.wipeuranus.com');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { priceId, packSize, mode, customerEmail, success_url, cancel_url } = req.body || {};

    // IMPORTANT: Checkout 'setup' mode does not support line_items.
    // Just create the session to save a card to a customer.
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      payment_method_types: ['card'],
      customer_creation: 'always',
      customer_email: customerEmail || undefined,
      success_url: success_url || 'https://www.wipeuranus.com/#success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancel_url  || 'https://www.wipeuranus.com/#cancel',
      metadata: {
        priceId: String(priceId || ''),
        packSize: String(packSize || ''),
        plan: String(mode || ''),
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
