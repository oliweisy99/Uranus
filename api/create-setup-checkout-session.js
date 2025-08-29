// /api/create-setup-checkout-session-and-kit.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const KIT_API_BASE = 'https://api.kit.com/v4';
const KIT_HEADERS = {
  'Content-Type': 'application/json',
  'X-Kit-Api-Key': process.env.KIT_API_KEY || ''
};

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

function rid() { return Math.random().toString(36).slice(2, 10); }
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
    if (typeof v === 'object') continue;
    out[String(k)] = String(v).slice(0, 500);
  }
  return out;
}

async function kitCreateOrUpdateSubscriber({ email, first_name, fields }) {
  const resp = await fetch(`${KIT_API_BASE}/subscribers`, {
    method: 'POST',
    headers: KIT_HEADERS,
    body: JSON.stringify({
      first_name: first_name || '',
      email_address: email,
      fields: fields || {}
    })
  });
  if (!resp.ok) throw new Error(`Kit create/update subscriber failed: ${await resp.text()}`);
  const json = await resp.json();
  return json?.subscriber?.id;
}

async function kitAddToSequence({ sequenceId, email }) {
  if (!sequenceId) return;
  const resp = await fetch(`${KIT_API_BASE}/sequences/${sequenceId}/subscribers`, {
    method: 'POST',
    headers: KIT_HEADERS,
    body: JSON.stringify({ email_address: email })
  });
  if (!resp.ok) throw new Error(`Kit add-to-sequence failed: ${await resp.text()}`);
}

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  console.log(`[SETUP+KIT][${_rid}] START method=${req.method} origin=${origin}`);
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      email,
      name,
      shipping,
      orderSummary,
      success_url,
      cancel_url,
      metadata,
      intended_price_pence,
      intended_price_currency,
      intended_price_display
    } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const safeMeta = sanitizeMetadata(metadata);
    const pricePence = Number.isFinite(+intended_price_pence) ? Math.max(0, Math.floor(+intended_price_pence)) : 0;
    const priceCurrency = (intended_price_currency || 'gbp').toLowerCase();
    const priceDisplay = intended_price_display ? String(intended_price_display) : '';

    const billingAddress = shipping?.address
      ? {
          line1: shipping.address.line1,
          line2: shipping.address.line2 || null,
          city: shipping.address.city,
          postal_code: shipping.address.postal_code,
          country: shipping.address.country
        }
      : undefined;

    const CANONICAL_ORIGIN = 'https://wipeuranus.com';
    const DEFAULT_SUCCESS = `${CANONICAL_ORIGIN}/?session_id={CHECKOUT_SESSION_ID}#success`;
    const DEFAULT_CANCEL  = `${CANONICAL_ORIGIN}/#cancel`;
    const successUrl = success_url && success_url.includes('{CHECKOUT_SESSION_ID}') ? success_url : DEFAULT_SUCCESS;
    const cancelUrl  = cancel_url || DEFAULT_CANCEL;

    // Reuse or create Stripe Customer
    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer =
      data[0] ||
      (await stripe.customers.create({
        email,
        name,
        address: billingAddress,
        shipping,
        metadata: safeMeta
      }));

    const meta = {
      ...safeMeta,
      order_summary: orderSummary || 'We’ll charge this card when your order ships.',
      intended_price_pence: String(pricePence),
      intended_price_currency: priceCurrency,
      intended_price_display: priceDisplay,
      manual_charge_amount_pence: String(pricePence),
      manual_charge_currency: priceCurrency,
      manual_charge_display: priceDisplay || '',
      manual_charge_note: 'Paste amount (pence) into a PaymentIntent when charging later.'
    };

    await stripe.customers.update(customer.id, {
      name,
      address: billingAddress,
      shipping,
      metadata: {
        ...(customer.metadata || {}),
        last_intended_price_pence: String(pricePence),
        last_intended_price_currency: priceCurrency,
        last_intended_price_display: priceDisplay || '',
        manual_charge_amount_pence: String(pricePence),
        manual_charge_currency: priceCurrency,
        manual_charge_display: priceDisplay || ''
      }
    });

    const submitMessage =
      orderSummary
        ? `${orderSummary} ${priceDisplay ? `You’ll be charged ${priceDisplay} when it ships.` : ''}`
        : `You’ll be charged ${priceDisplay || 'the shown amount'} when your order ships.`;

    const label = priceDisplay
      ? `Intended: ${priceDisplay} (${priceCurrency.toUpperCase()})`
      : 'Intended: n/a';

    // 1) Create the Setup Session
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customer.id,
      currency: 'gbp',
      client_reference_id: label,
      shipping_address_collection: { allowed_countries: ['GB'] },
      billing_address_collection: 'required',
      customer_update: { address: 'never', shipping: 'never', name: 'never' },
      consent_collection: { payment_method_reuse_agreement: { position: 'hidden' } },
      custom_text: {
        submit: { message: submitMessage },
        after_submit: {
          message:
            'You’re saving a card for future charges per our ' +
            '[Terms](https://wipeuranus.com/terms) and ' +
            '[Privacy](https://wipeuranus.com/privacy). ' +
            'You can manage your order on our site any time.'
        }
      },
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: meta,
      setup_intent_data: {
        description: label,
        metadata: meta
      }
    });

    // 2) Use YOUR success page as the “portal” link
    // If successUrl contains the placeholder, replace with the real id so your page can fetch the Session.
    // If not, just use the raw successUrl.
    const portalUrl = successUrl.includes('{CHECKOUT_SESSION_ID}')
      ? successUrl.replace('{CHECKOUT_SESSION_ID}', session.id)
      : successUrl;

    // ----- KIT INTEGRATION -----
    const fields = {
      // Make sure these custom fields exist in Kit first.
      'Order Link': session.url,  // the Checkout link to save card
      'Portal Link': portalUrl,   // your site’s manage/edit page (success page)
      'Order Label': label
    };

    await kitCreateOrUpdateSubscriber({
      email,
      first_name: (name || '').split(' ')[0] || '',
      fields
    });

    const SEQUENCE_ID = process.env.KIT_SEQUENCE_ID_ORDERLINK;
    if (SEQUENCE_ID && process.env.KIT_API_KEY) {
      await kitAddToSequence({ sequenceId: SEQUENCE_ID, email });
    } else {
      console.warn(`[SETUP+KIT][${_rid}] Skipped sequence: missing KIT_SEQUENCE_ID_ORDERLINK or KIT_API_KEY`);
    }

    console.log(`[SETUP+KIT][${_rid}] Session created id=${session.id} url_present=${!!session.url}`);
    return res.status(200).json({
      id: session.id,
      url: session.url,          // Checkout link (card collection)
      portal_url: portalUrl      // Your success/manage page
    });
  } catch (e) {
    console.error(`[SETUP+KIT][${_rid}] ERROR ${e.type || ''} ${e.message}`);
    if (e.raw && e.raw.param) console.error(`[SETUP+KIT][${_rid}] Stripe param error -> ${e.raw.param}`);
    console.error(`[SETUP+KIT][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error: e.message, rid: _rid });
  } finally {
    console.log(`[SETUP+KIT][${_rid}] END`);
  }
};
