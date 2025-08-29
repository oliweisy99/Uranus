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
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id || req.query.session_id;
  if (!id) return res.status(400).json({ error: 'Missing session id' });

  try {
    console.log(`[GETSESSION][${_rid}] Retrieving session id=${id}`);

    // IMPORTANT: expand setup_intent so we can read its metadata
    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ['setup_intent', 'customer']
    });

    const custRaw     = session.customer || null;
    const customer_id = typeof custRaw === 'string' ? custRaw : (custRaw?.id || null);
    const custObj     = (typeof custRaw === 'object' && custRaw) ? custRaw : {};
    const cd          = session.customer_details || {};

    // Prefer customer metadata for persistent prefs; fall back to session
    const mdC = custObj.metadata || {};
    const mdS = session.metadata || {};
    const selectedPack    = mdC.selectedPack || mdC.packSize || mdS.selectedPack || mdS.packSize || null;
    const peopleKey       = mdC.peopleKey    || mdS.peopleKey    || null;
    const shipDelay       = mdC.shipDelay    || mdS.shipDelay    || null;
    const planMode        = mdS.mode || 'subscription';
    const preorder_status = mdC.preorder_status || null;

    // If cancelled/deleted, short-circuit
    if (preorder_status === 'cancelled' || custObj.deleted === true) {
      return res.status(410).json({ cancelled:true, reason: 'preorder_cancelled' });
    }

    // Pull intended price (prefer Session metadata; fall back to SetupIntent metadata)
    const si = (typeof session.setup_intent === 'object' && session.setup_intent) ? session.setup_intent : null;
    const mdSI = (si && si.metadata) ? si.metadata : {};

    const intended_price_pence = (mdS.intended_price_pence && Number.isFinite(+mdS.intended_price_pence))
      ? +mdS.intended_price_pence
      : (mdSI.intended_price_pence && Number.isFinite(+mdSI.intended_price_pence))
        ? +mdSI.intended_price_pence
        : undefined;

    const intended_price_display = mdS.intended_price_display || mdSI.intended_price_display || undefined;
    const intended_price_currency = (mdS.intended_price_currency || mdSI.intended_price_currency || session.currency || 'gbp').toLowerCase();
    const coupon_code = mdS.coupon || mdSI.coupon || undefined;

    // Current saved card (if any)
    let saved_card = null;
    if (customer_id) {
      const cards = await stripe.paymentMethods.list({ customer: customer_id, type: 'card', limit: 1 });
      if (cards.data[0]) {
        const c = cards.data[0].card;
        saved_card = { id: cards.data[0].id, brand: c.brand, last4: c.last4, exp_month: c.exp_month, exp_year: c.exp_year };
      }
    }

    const shipping = cd.address
      ? { name: cd.name, phone: cd.phone, address: cd.address }
      : (custObj.shipping || null);

    const billing = cd.address
      ? { name: cd.name, address: cd.address }
      : (custObj.address || null);

    res.status(200).json({
      id: session.id,
      mode: session.mode,           // 'setup'
      status: session.status,
      customer_id,
      email: cd.email || custObj.email || null,
      customer_name: cd.name || custObj.name || null,
      shipping,
      billing,
      currency: intended_price_currency,
      order_summary: mdS.order_summary || mdSI.order_summary || null,

      // preferences
      selectedPack,
      peopleKey,
      shipDelay,
      planMode,
      preorder_status,

      // 💸 intended price (post-coupon)
      intended_price_pence,
      intended_price_display,
      coupon_code,

      saved_card
    });
  } catch (e) {
    console.error(`[GETSESSION][${_rid}] ERROR ${e.message}`);
    console.error(`[GETSESSION][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error: e.message });
  } finally {
    console.log(`[GETSESSION][${_rid}] END`);
  }
};
