// /api/get-setup-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

module.exports = async (req, res) => {
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

    // Expand to fetch customer + saved payment method details
    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ['customer', 'setup_intent.payment_method']
    });
    console.log(`[GETSESSION][${_rid}] status=${session.status} mode=${session.mode} customer=${session.customer?.id || session.customer || 'n/a'}`);

    // Prefer customer_details from the session; fall back to customer object
    const cd = session.customer_details || {};
    const cust = session.customer || {};
    const shipping = cd.address
      ? { name: cd.name, phone: cd.phone, address: cd.address }
      : (cust.shipping || null);
    const billing = cd.address ? { name: cd.name, address: cd.address } : (cust.address || null);

    // Pull through your metadata that you set when creating the session
    const md = session.metadata || {};

    // Card summary (if a card was saved)
    const pm = session.setup_intent?.payment_method;
    const card = (pm && pm.type === 'card') ? {
      brand: pm.card.brand, last4: pm.card.last4,
      exp_month: pm.card.exp_month, exp_year: pm.card.exp_year
    } : null;

    // Build a minimal, safe payload for the browser
    res.status(200).json({
      id: session.id,
      mode: session.mode,                  // 'setup'
      status: session.status,              // 'complete' if finished
      email: cd.email || cust.email || null,
      customer_name: cd.name || cust.name || null,
      shipping,
      billing,
      currency: session.currency || 'gbp',
      order_summary: md.order_summary || null,
      selectedPack: md.selectedPack || null,
      planMode: md.mode || null,           // 'subscription' or 'payment'
      peopleKey: md.peopleKey || null,
      shipDelay: md.shipDelay || null,
      priceId: md.priceId || null,
      saved_card: card
    });
  } catch (e) {
    console.error(`[GETSESSION][${_rid}] ERROR ${e.message}`);
    console.error(`[GETSESSION][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error: e.message });
  } finally {
    console.log(`[GETSESSION][${_rid}] END`);
  }
};
