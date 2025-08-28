// /api/update-preorder.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { customer_id, packSize, peopleKey, shipDelay, priceId, notes } = req.body || {};
    if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });

    // Use the keys the UI reads; keep packSize too for backward compat.
    const metadata = {
      preorder_status: 'active',
      selectedPack: String(packSize || ''), // <-- UI expects selectedPack
      packSize:      String(packSize || ''), // (compat)
      peopleKey:     String(peopleKey || ''),
      shipDelay:     String(shipDelay || ''),
      priceId:       String(priceId || ''),
      order_notes:   String(notes || '')
    };

    await stripe.customers.update(customer_id, { metadata });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[update-preorder] ERROR', e);
    return res.status(500).json({ error: e.message || 'Failed to update preorder' });
  }
};
