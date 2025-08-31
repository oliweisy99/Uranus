// /api/create-portal-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { customer_id, setup_intent, session_id } = req.query || {};
    let customer;

    if (customer_id) {
      customer = customer_id;
    } else if (setup_intent) {
      const si = await stripe.setupIntents.retrieve(setup_intent, { expand: ['customer'] });
      customer = typeof si.customer === 'string' ? si.customer : si.customer?.id;
    } else if (session_id) {
      const cs = await stripe.checkout.sessions.retrieve(session_id);
      customer = typeof cs.customer === 'string' ? cs.customer : cs.customer?.id;
    } else {
      return res.status(400).json({ error: 'Provide customer_id or setup_intent' });
    }

    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const portal = await stripe.billingPortal.sessions.create({
      customer,
      return_url: 'https://wipeuranus.com/#account'
    });

    res.status(200).json({ url: portal.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
