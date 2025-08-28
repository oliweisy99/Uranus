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
    // Be tolerant if some platforms send a string body
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { customer_id, packSize, peopleKey, shipDelay, priceId, notes } = body;

    if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });

    // Write to Customer.metadata (keys your UI reads)
    const meta = {
      preorder_status: 'active',
      selectedPack: String(packSize || ''), // UI expects selectedPack; we also keep packSize for compat
      packSize:      String(packSize || ''),
      peopleKey:     String(peopleKey || ''),
      shipDelay:     String(shipDelay || ''),
      priceId:       String(priceId || ''),
      order_notes:   String(notes || '')
    };

    await stripe.customers.update(customer_id, { metadata: meta });

    // Optional: read back for confidence
    const c = await stripe.customers.retrieve(customer_id);
    res.status(200).json({
      ok: true,
      saved: {
        selectedPack: c.metadata.selectedPack || c.metadata.packSize || null,
        peopleKey: c.metadata.peopleKey || null,
        shipDelay: c.metadata.shipDelay || null
      }
    });
  } catch (e) {
    console.error('[update-preorder] error:', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
};
