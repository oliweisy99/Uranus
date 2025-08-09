const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

module.exports = async (req, res) => {
  // Basic CORS so Carrd can POST to this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { priceId, packSize, mode, customerEmail } = req.body || {};

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',                       // <-- saves card, does NOT charge
      payment_method_types: ['card'],
      customer_creation: 'always',
      customer_email: customerEmail || undefined,
      success_url: 'https://wipeUranus.com/#success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://wipeUranus.com/#cancel',
      metadata: {
        priceId: String(priceId || ''),
        packSize: String(packSize || ''),
        plan: String(mode || ''),
      },
      // Optional: show what they picked in Checkout (visual only; £0.00)
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: { name: `Uranus – ${packSize || ''} rolls (${mode || 'preorder'})` },
          unit_amount: 0,
        },
        quantity: 1,
      }],
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
