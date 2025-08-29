// /api/create-setup-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

function cors(res, origin) {
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sanitizeMetadata(md) {
  const out = {};
  if (!md || typeof md !== 'object') return out;
  for (const [k, v] of Object.entries(md)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue; // drop objects/arrays
    out[String(k)] = String(v).slice(0, 500);
  }
  return out;
}

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  console.log(`[SETUP][${_rid}] START method=${req.method} origin=${origin} ua=${req.headers['user-agent'] || ''}`);

  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, name, shipping, orderSummary, success_url, cancel_url, metadata } = req.body || {};
    const safeMeta = sanitizeMetadata(metadata);

    const billingAddress = shipping?.address ? {
      line1: shipping.address.line1,
      line2: shipping.address.line2 || null,
      city: shipping.address.city,
      postal_code: shipping.address.postal_code,
      country: shipping.address.country,
    } : undefined;

    const CANONICAL_ORIGIN = 'https://wipeuranus.com';
    const DEFAULT_SUCCESS = `${CANONICAL_ORIGIN}/?session_id={CHECKOUT_SESSION_ID}#success`;
    const DEFAULT_CANCEL  = `${CANONICAL_ORIGIN}/#cancel`;

    const successUrl = (success_url && success_url.includes('{CHECKOUT_SESSION_ID}')) ? success_url : DEFAULT_SUCCESS;
    const cancelUrl  = cancel_url || DEFAULT_CANCEL;

    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0] || await stripe.customers.create({
      email,
      name,
      address: billingAddress,
      shipping,
      metadata: safeMeta
    });

    const siteOrigin = (ALLOWED_ORIGINS.has(origin) ? origin : 'https://wipeuranus.com').replace(/\/$/, '');

    const portal = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: `${siteOrigin}/#`
    });

    await stripe.customers.update(customer.id, {
      name,
      address: billingAddress,
      shipping
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customer.id,
      currency: 'gbp',
      consent_collection: {
        payment_method_reuse_agreement: { position: 'hidden' }
      },
      shipping_address_collection: { allowed_countries: ['GB'] },
      billing_address_collection: 'required',
      customer_update: { address: 'never', shipping: 'never', name: 'never' },
      custom_text: {
        submit: {
          message: orderSummary || 'We’ll charge this card when your order ships.'
        },
        after_submit: {
          message:
            'You’re saving a card for future charges per our ' +
            '[Terms](https://wipeuranus.com/terms) and ' +
            '[Privacy](https://wipeuranus.com/privacy). ' +
            'You can update or remove this card anytime in your ' +
            '[account portal](https://wipeuranus.com/#account).'
        }
      },
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: {
        ...safeMeta,
        order_summary: orderSummary || 'We’ll charge this card when your order ships.'
      }
    });

    console.log(`[SETUP][${_rid}] Session created id=${session.id} url_present=${!!session.url}`);
    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error(`[SETUP][${_rid}] ERROR ${e.type || ''} ${e.message}`);
    if (e.raw && e.raw.param) console.error(`[SETUP][${_rid}] Stripe param error -> ${e.raw.param}`);
    console.error(`[SETUP][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error: e.message, rid: _rid });
  } finally {
    console.log(`[SETUP][${_rid}] END`);
  }
};
