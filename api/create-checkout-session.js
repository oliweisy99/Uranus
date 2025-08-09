// /api/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  // during testing you can add your preview domains:
  'https://uranus-azure.vercel.app'
]);

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  // (or use '*' while testing if you’re not sending credentials)

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { priceId, packSize, mode, customerEmail, success_url, cancel_url } = req.body || {};

    const session = await stripe.checkout.sessions.create({
      mode: 'setup', // saving a card only
      customer_creation: 'always',
      customer_email: customerEmail || undefined,
      success_url: success_url || 'https://wipeuranus.com/#success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  cancel_url  || 'https://wipeuranus.com/#cancel',
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
