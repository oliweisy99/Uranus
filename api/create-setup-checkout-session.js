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

function rid(){ return Math.random().toString(36).slice(2,10); }
function cors(res, origin){
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Max-Age','86400');
}
function sanitizeMetadata(md){
  const out={}; if(!md||typeof md!=='object') return out;
  for (const [k,v] of Object.entries(md)){
    if (v==null) continue;
    if (typeof v==='object') continue;
    out[String(k)] = String(v).slice(0,500);
  }
  return out;
}

// ---------- KIT helpers ----------

// Ensure a custom field with this label exists. Returns its key (e.g. "order_link")
async function kitEnsureCustomField(label){
  const resp = await fetch(`${KIT_API_BASE}/custom_fields`,{
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ label })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit ensure custom field "${label}" failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.custom_field?.key; // e.g. "order_link"
}

// Upsert by email (Kit will create or update)
async function kitCreateOrUpdateSubscriber({ email, first_name, fields }){
  const resp = await fetch(`${KIT_API_BASE}/subscribers`,{
    method:'POST', headers: KIT_HEADERS,
    body: JSON.stringify({ first_name: first_name||'', email_address: email, fields })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit create/update subscriber failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.subscriber?.id;
}

// Fetch the subscriber by email
async function kitGetSubscriberByEmail(email){
  const url = `${KIT_API_BASE}/subscribers?email_address=${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: KIT_HEADERS });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit get subscriber by email failed: ${txt}`);
  const json = JSON.parse(txt);
  return (json?.subscribers||[])[0] || null;
}

// Convenience: get ID by email
async function kitGetSubscriberIdByEmail(email){
  const sub = await kitGetSubscriberByEmail(email);
  return sub?.id || null;
}

// Force-set fields via PUT (reliable for existing contacts)
async function kitUpdateSubscriber(id, payload){
  const resp = await fetch(`${KIT_API_BASE}/subscribers/${id}`,{
    method:'PUT', headers: KIT_HEADERS, body: JSON.stringify(payload)
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit update subscriber failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.subscriber;
}

// Add subscriber to a sequence
async function kitAddToSequence({ sequenceId, email }){
  if (!sequenceId) return;
  const resp = await fetch(`${KIT_API_BASE}/sequences/${sequenceId}/subscribers`,{
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ email_address: email })
  });
  if (!resp.ok) throw new Error(`Kit add-to-sequence failed: ${await resp.text()}`);
}

// ---------------------------------

module.exports = async (req,res)=>{
  const _rid = rid();
  const origin = req.headers.origin || '';
  console.log(`[SETUP+KIT][${_rid}] START method=${req.method} origin=${origin}`);
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try {
    const {
      email, name, shipping, orderSummary, success_url, cancel_url, metadata,
      intended_price_pence, intended_price_currency, intended_price_display
    } = req.body || {};
    if (!email) return res.status(400).json({ error:'Email is required' });

    const safeMeta = sanitizeMetadata(metadata);
    const pricePence = Number.isFinite(+intended_price_pence) ? Math.max(0, Math.floor(+intended_price_pence)) : 0;
    const priceCurrency = (intended_price_currency || 'gbp').toLowerCase();
    const priceDisplay = intended_price_display ? String(intended_price_display) : '';

    const billingAddress = shipping?.address ? {
      line1: shipping.address.line1, line2: shipping.address.line2 || null,
      city: shipping.address.city, postal_code: shipping.address.postal_code, country: shipping.address.country
    } : undefined;

    const CANONICAL_ORIGIN = 'https://wipeuranus.com';
    const DEFAULT_SUCCESS = `${CANONICAL_ORIGIN}/?session_id={CHECKOUT_SESSION_ID}#success`;
    const DEFAULT_CANCEL  = `${CANONICAL_ORIGIN}/#cancel`;
    const successUrl = (success_url && success_url.includes('{CHECKOUT_SESSION_ID}')) ? success_url : DEFAULT_SUCCESS;
    const cancelUrl  = cancel_url || DEFAULT_CANCEL;

    // Stripe customer
    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0] || (await stripe.customers.create({
      email, name, address: billingAddress, shipping, metadata: safeMeta
    }));

    const label = priceDisplay ? `Intended: ${priceDisplay} (${priceCurrency.toUpperCase()})` : 'Intended: n/a';

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

    // Keep customer attrs fresh for manual-charge helpers
    await stripe.customers.update(customer.id, {
      name, address: billingAddress, shipping,
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

    // Stripe Setup session
    const session = await stripe.checkout.sessions.create({
      mode:'setup',
      customer: customer.id,
      currency:'gbp',
      client_reference_id: label,
      shipping_address_collection: { allowed_countries: ['GB'] },
      billing_address_collection: 'required',
      customer_update: { address:'never', shipping:'never', name:'never' },
      consent_collection: { payment_method_reuse_agreement: { position:'hidden' } },
      custom_text: {
        submit: { message: submitMessage },
        after_submit: { message:
          'You’re saving a card for future charges per our [Terms](https://wipeuranus.com/terms) and ' +
          '[Privacy](https://wipeuranus.com/privacy). You can manage your order on our site any time.'
        }
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: meta,
      setup_intent_data: { description: label, metadata: meta }
    });

    const portalUrl = successUrl.includes('{CHECKOUT_SESSION_ID}')
      ? successUrl.replace('{CHECKOUT_SESSION_ID}', session.id)
      : successUrl;

    // ---------- KIT: ensure fields, then write using KEYS ----------
    const LABELS = ['Order Link','Portal Link','Order Label'];
    const [ORDER_KEY, PORTAL_KEY, ORDERLABEL_KEY] = await Promise.all(LABELS.map(kitEnsureCustomField));
    console.log(`[SETUP+KIT][${_rid}] Kit field keys`, [ORDER_KEY, PORTAL_KEY, ORDERLABEL_KEY]);

    // IMPORTANT: map by KEY, not label
    const fieldsByKey = {
      [ORDER_KEY]: session.url,
      [PORTAL_KEY]: portalUrl,
      [ORDERLABEL_KEY]: label
    };

    // Upsert (create-or-update)
    const createdId = await kitCreateOrUpdateSubscriber({
      email,
      first_name: (name || '').split(' ')[0] || '',
      fields: fieldsByKey
    });

    // For existing contacts, force-set via PUT as well
    const subId = createdId || (await kitGetSubscriberIdByEmail(email));
    if (subId) {
      await kitUpdateSubscriber(subId, { fields: fieldsByKey });
    }

    // Verify (non-fatal if it fails)
    try {
      const sub = await kitGetSubscriberByEmail(email);
      console.log(`[SETUP+KIT][${_rid}] Kit subscriber verify`, {
        id: sub?.id,
        email: sub?.email_address,
        fields: sub?.fields || sub?.custom_fields || null
      });
    } catch (e) {
      console.warn(`[SETUP+KIT][${_rid}] Kit verify failed: ${e.message}`);
    }

    // Small delay before sequence enrollment
    await new Promise(r => setTimeout(r, 400));

    const SEQUENCE_ID = process.env.KIT_SEQUENCE_ID_ORDERLINK;
    if (SEQUENCE_ID && process.env.KIT_API_KEY) {
      await kitAddToSequence({ sequenceId: SEQUENCE_ID, email });
    } else {
      console.warn(`[SETUP+KIT][${_rid}] Skipped sequence: missing KIT_SEQUENCE_ID_ORDERLINK or KIT_API_KEY`);
    }

    console.log(`[SETUP+KIT][${_rid}] Session created id=${session.id} url_present=${!!session.url}`);
    return res.status(200).json({ id: session.id, url: session.url, portal_url: portalUrl });

  } catch (e) {
    console.error(`[SETUP+KIT][${_rid}] ERROR ${e.type || ''} ${e.message}`);
    if (e.raw && e.raw.param) console.error(`[SETUP+KIT][${_rid}] Stripe param error -> ${e.raw.param}`);
    console.error(`[SETUP+KIT][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error: e.message, rid: _rid });
  } finally {
    console.log(`[SETUP+KIT][${_rid}] END`);
  }
};
