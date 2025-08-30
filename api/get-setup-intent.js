// /api/get-setup-intent.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

function cors(res, origin){
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Max-Age','86400');
}

function rid(){ return Math.random().toString(36).slice(2,10); }

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const id = req.query.id || req.query.setup_intent;
  if (!id) return res.status(400).json({ error: 'Missing setup_intent id' });

  try {
    console.log(`[GET-SETUPINTENT][${_rid}] Retrieving si=${id}`);

    // Expand customer & payment_method to surface details
    const si = await stripe.setupIntents.retrieve(id, {
      expand: ['customer', 'payment_method']
    });

    const custRaw     = si.customer || null;
    const customer_id = typeof custRaw === 'string' ? custRaw : (custRaw?.id || null);
    const custObj     = (typeof custRaw === 'object' && custRaw) ? custRaw : {};
    const pm          = si.payment_method && typeof si.payment_method === 'object' ? si.payment_method : null;

    // Prefer customer metadata (persistent) then SI metadata
    const mdC = custObj.metadata || {};
    const mdS = si.metadata || {};

    const selectedPack    = mdC.selectedPack || mdC.packSize || mdS.selectedPack || mdS.packSize || null;
    const peopleKey       = mdC.peopleKey    || mdS.peopleKey    || null;
    const shipDelay       = mdC.shipDelay    || mdS.shipDelay    || null;
    const planMode        = mdS.mode || 'subscription';
    const preorder_status = mdC.preorder_status || null;

    // Intended price (post-coupon), currency and display
    const intended_price_pence = (mdS.intended_price_pence && Number.isFinite(+mdS.intended_price_pence))
      ? +mdS.intended_price_pence
      : (mdC.last_intended_price_pence && Number.isFinite(+mdC.last_intended_price_pence))
        ? +mdC.last_intended_price_pence
        : undefined;

    const intended_price_display = mdS.intended_price_display || mdC.last_intended_price_display || undefined;
    const intended_price_currency = (mdS.intended_price_currency || mdC.last_intended_price_currency || si.currency || 'gbp').toLowerCase();
    const coupon_code = mdS.coupon || undefined;

    // Saved card summary
    let saved_card = null;
    if (pm && pm.type === 'card') {
      const c = pm.card;
      saved_card = { id: pm.id, brand: c.brand, last4: c.last4, exp_month: c.exp_month, exp_year: c.exp_year };
    } else if (customer_id) {
      // Fallback: get the first attached card
      const cards = await stripe.paymentMethods.list({ customer: customer_id, type: 'card', limit: 1 });
      if (cards.data[0]) {
        const c = cards.data[0].card;
        saved_card = { id: cards.data[0].id, brand: c.brand, last4: c.last4, exp_month: c.exp_month, exp_year: c.exp_year };
      }
    }

    // Shipping/billing best-effort (SI itself doesn’t carry shipping)
    const shipping = custObj.shipping || null;
    const billing  = custObj.address  || null;

    res.status(200).json({
      id: si.id,
      status: si.status,         // e.g. 'succeeded'
      customer_id,
      email: custObj.email || null,
      customer_name: custObj.name || null,
      shipping,
      billing,
      currency: intended_price_currency,
      order_summary: mdS.order_summary || mdC.order_summary || null,

      // preferences
      selectedPack,
      peopleKey,
      shipDelay,
      planMode,
      preorder_status,

      // price override
      intended_price_pence,
      intended_price_display,
      coupon_code,

      saved_card
    });
  } catch (e) {
    console.error(`[GET-SETUPINTENT][${_rid}] ERROR ${e.message}`);
    console.error(`[GET-SETUPINTENT][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error: e.message });
  } finally {
    console.log(`[GET-SETUPINTENT][${_rid}] END`);
  }
};
