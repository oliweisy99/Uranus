// /api/create-setup-checkout-session.js
const Stripe = require('stripe');
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
    const { email, name, shipping, orderSummary, metadata } = req.body;

    // 1) Ensure a Customer with your order details stored
    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0] || await stripe.customers.create({ email, name, shipping, metadata });

    // keep details fresh
    await stripe.customers.update(customer.id, { name, shipping });

    // 2) Create Checkout Session in SETUP mode
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customer.id,
      // Optionally ask Checkout to collect billing address during card entry:
      billing_address_collection: 'required',
      // You can let Stripe send customer comms and show your copy:
      custom_text: {
        submit: { message: (orderSummary || 'We’ll charge this card when your order ships.') }
      },
      success_url: 'https://wipeuranus.com/#card-saved',
      cancel_url:  'https://wipeuranus.com/#cancel',
      metadata: {
        ...metadata,
        // helpful for reconciling the saved payment method with your order
        order_summary: orderSummary || ''
      }
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
