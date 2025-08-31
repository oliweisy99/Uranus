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
const pick = v => (typeof v === 'string' && v.trim()) ? v.trim() : undefined;

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const id = (req.query && req.query.id) ? String(req.query.id) : null;
  if (!id) return res.status(400).json({ error: 'Missing id (SetupIntent id)' });

  try{
    // Pull SI with expansions so we can show saved card + customer info
    const si = await stripe.setupIntents.retrieve(id, {
      expand: ['payment_method', 'customer']
    });

    // If user cancelled at Stripe, tell the UI via 410
    if (si.status === 'canceled') {
      return res.status(410).json({ error: 'SetupIntent cancelled' });
    }

    // Pull metadata you set during create
    const md = si.metadata || {};
    const selectedPack   = pick(md.selectedPack);
    const peopleKey      = pick(md.peopleKey);
    const shipDelay      = pick(md.shipDelay);
    const order_summary  = pick(md.order_summary);
    const coupon_code    = pick(md.coupon);

    // Intended price snapshot (you stored these on SI metadata)
    // Fallbacks in case they’re missing.
    const intended_price_pence   = Number.isFinite(+md.intended_price_pence)   ? +md.intended_price_pence   : undefined;
    const intended_price_display = pick(md.intended_price_display);
    const currency = pick(md.intended_price_currency) || 'gbp';

    // Plan mode
    const rawMode  = pick(md.mode) || '';
    const planMode = (rawMode === 'subscription' ? 'subscription'
                    : rawMode === 'payment'      ? 'payment'
                    : 'subscription');

    // Saved card details
    let saved_card = null;
    if (si.payment_method && si.payment_method.card) {
      const c = si.payment_method.card;
      saved_card = {
        id: si.payment_method.id,
        brand: c.brand,
        last4: c.last4,
        exp_month: c.exp_month,
        exp_year: c.exp_year
      };
    }

    // Customer info
    const customer_id = typeof si.customer === 'string' ? si.customer : si.customer?.id;
    // Try to build a shipping block.
    let shipping = undefined;
    let customer_name = undefined;

    // Prefer Customer’s shipping/name if present
    if (si.customer && typeof si.customer === 'object') {
      const cust = si.customer;
      customer_name = cust.name || undefined;
      if (cust.shipping) {
        shipping = {
          name: cust.shipping.name || cust.name || '',
          address: {
            line1: cust.shipping.address?.line1 || '',
            line2: cust.shipping.address?.line2 || '',
            city: cust.shipping.address?.city || '',
            postal_code: cust.shipping.address?.postal_code || '',
            country: cust.shipping.address?.country || ''
          }
        };
      } else if (cust.address) {
        shipping = {
          name: cust.name || '',
          address: {
            line1: cust.address?.line1 || '',
            line2: cust.address?.line2 || '',
            city: cust.address?.city || '',
            postal_code: cust.address?.postal_code || '',
            country: cust.address?.country || ''
          }
        };
      }
    }

    // Response in the exact shape the success page expects
    return res.status(200).json({
      id: si.id,
      status: si.status,
      currency,

      // selection & plan
      selectedPack: selectedPack || undefined,
      peopleKey: peopleKey || undefined,
      shipDelay: shipDelay || undefined,
      planMode,

      // labels / pricing snapshot
      order_summary: order_summary || undefined,
      intended_price_pence,
      intended_price_display,
      coupon_code,

      // customer + saved card
      customer_id: customer_id || undefined,
      customer_name: customer_name || undefined,
      shipping: shipping || undefined,
      saved_card: saved_card || undefined,

      // You can add preorder_status if you store it somewhere; default to pending
      preorder_status: 'pending'
    });

  }catch(e){
    console.error('[GET-SI]['+_rid+']', e);
    const code = (e && e.statusCode) || 500;
    return res.status(code).json({ error: e.message || 'Error' });
  }
};
