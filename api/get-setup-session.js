// /api/get-setup-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

function rid() { return Math.random().toString(36).slice(2, 10); }

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id || req.query.session_id;
  if (!id) return res.status(400).json({ error: 'Missing session id' });

  try {
    console.log(`[GETSESSION][${_rid}] Retrieving session id=${id}`);

    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ['customer', 'setup_intent.payment_method']
    });

    // Customer object or string
    const custRaw = session.customer || null;
    const customer_id = typeof custRaw === 'string' ? custRaw : (custRaw?.id || null);

    // Prefer customer_details from the session
    const cd = session.customer_details || {};
    const custObj = (typeof custRaw === 'object' && custRaw) ? custRaw : {};

    const shipping = cd.address
      ? { name: cd.name, phone: cd.phone, address: cd.address }
      : (custObj.shipping || null);

    const billing = cd.address
      ? { name: cd.name, address: cd.address }
      : (custObj.address || null);

    const md = session.metadata || {};

    // Saved payment method (include id!)
    const pm = session.setup_intent?.payment_method;
    const saved_card = (pm && pm.type === 'card') ? {
      id: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
      exp_month: pm.card.exp_month,
      exp_year: pm.card.exp_year
    } : null;

    res.status(200).json({
      id: session.id,
      mode: session.mode,                  // 'setup'
      status: session.status,
      email: cd.email || custObj.email || null,
      customer_name: cd.name || custObj.name || null,
      customer_id,                         // <-- add this
      shipping,
      billing,
      currency: session.currency || 'gbp',
      order_summary: md.order_summary || null,
      selectedPack: md.selectedPack || null,
      planMode: md.mode || null,
      peopleKey: md.peopleKey || null,
      shipDelay: md.shipDelay || null,
      priceId: md.priceId || null,
      saved_card                            // includes id/brand/last4/exp
    });
  } catch (e) {
    console.error(`[GETSESSION][${_rid}] ERROR ${e.message}`);
    console.error(`[GETSESSION][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error: e.message });
  } finally {
    console.log(`[GETSESSION][${_rid}] END`);
  }
};
