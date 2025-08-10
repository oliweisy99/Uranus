// /api/create-portal-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

module.exports = async (req, res) => {
  try {
    const { session_id } = req.query || {};
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

    const checkoutSession = await stripe.checkout.sessions.retrieve(session_id);
    const portal = await stripe.billingPortal.sessions.create({
      customer: checkoutSession.customer,
      return_url: 'https://wipeuranus.com/#account'
    });
    res.status(200).json({ url: portal.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
