// /api/create-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

module.exports = async (req, res) => {
  // Basic CORS (so Carrd / other origins can call this)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      priceId,          // your “display choice” – we store it as metadata (not charged in setup mode)
      packSize,
      mode,             // 'subscription' or 'payment' – informational only for setup
      delivery,         // e.g., "4 months: ~ 1–2 people"
      customerEmail,    // optional
      successUrl,       // optional override from client
      cancelUrl         // optional override from client
    } = req.body || {};

    // IMPORTANT: Checkout 'setup' mode doesn't accept line_items.
    // It's only for collecting a payment method.
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      payment_method_types: ['card'],
      customer_creation: 'always',
      customer_email: customerEmail || undefined,
      success_url: (successUrl || 'https://uranus-crwzp9r7l-oliweisy99s-projects.vercel.app') + '/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: (cancelUrl || 'https://uranus-crwzp9r7l-oliweisy99s-projects.vercel.app') + '/cancel',
      // Store what the user chose so you can fulfill later from your webhook/db
      metadata: {
        priceId: String(priceId || ''),
        packSize: String(packSize || ''),
        planMode: String(mode || ''),        // avoid 'mode' key name collision
        delivery: String(delivery || '')
      }
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
