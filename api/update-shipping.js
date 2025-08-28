const Stripe = require('stripe');
const { applyCors } = require('./_utils/cors');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

module.exports = async (req, res) => {
  if (applyCors(req, res, ['POST','OPTIONS'])) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { customer_id, shipping } = req.body || {};
    if (!customer_id || !shipping || !shipping.address) {
      return res.status(400).json({ error: 'Missing customer_id or shipping' });
    }
    const updated = await stripe.customers.update(customer_id, { shipping });
    res.status(200).json({ ok: true, customer: updated.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
