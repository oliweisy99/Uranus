// /api/cancel-preorder.js
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
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Max-Age','86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error:'Method not allowed' });

  try {
    const { customer_id, detach_payment_method_id } = req.body || {};
    if (!customer_id) return res.status(400).json({ error: 'Missing customer_id' });

    // Try to detach (not fatal if it fails)
    let detached = false;
    if (detach_payment_method_id) {
      try {
        const pm = await stripe.paymentMethods.retrieve(detach_payment_method_id);
        const pmCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
        if (!pmCustomer || pmCustomer === customer_id) {
          await stripe.paymentMethods.detach(detach_payment_method_id);
          detached = true;
        }
      } catch (err) {
        console.warn('[CANCEL] detach failed:', err.message);
      }
    }

    // Mark preorder as cancelled (and clear your preference metadata)
    await stripe.customers.update(customer_id, {
      metadata: {
        preorder_status: 'cancelled',
        preorder_cancelled_at: new Date().toISOString(),
        packSize: '',
        peopleKey: '',
        shipDelay: '',
        notes: ''
      }
    });

    return res.status(200).json({ ok: true, detached });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
