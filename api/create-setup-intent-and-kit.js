// /api/create-setup-intent-and-kit.js
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

// ----- Kit helpers -----
async function kitEnsureCustomField(label){
  const resp = await fetch(`${KIT_API_BASE}/custom_fields`,{
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ label })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit ensure custom field "${label}" failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.custom_field?.key;
}
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
async function kitGetSubscriberByEmail(email){
  const url = `${KIT_API_BASE}/subscribers?email_address=${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: KIT_HEADERS });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit get subscriber by email failed: ${txt}`);
  const json = JSON.parse(txt);
  return (json?.subscribers||[])[0] || null;
}
async function kitGetSubscriberIdByEmail(email){
  const sub = await kitGetSubscriberByEmail(email);
  return sub?.id || null;
}
async function kitUpdateSubscriber(id, payload){
  const resp = await fetch(`${KIT_API_BASE}/subscribers/${id}`,{
    method:'PUT', headers: KIT_HEADERS, body: JSON.stringify(payload)
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit update subscriber failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.subscriber;
}
async function kitAddToSequence({ sequenceId, email }){
  if (!sequenceId) return;
  const resp = await fetch(`${KIT_API_BASE}/sequences/${sequenceId}/subscribers`,{
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ email_address: email })
  });
  if (!resp.ok) throw new Error(`Kit add-to-sequence failed: ${await resp.text()}`);
}

module.exports = async (req,res)=>{
  const _rid = rid();
  const origin = req.headers.origin || '';
  console.log(`[SETUP-EMBED+KIT][${_rid}] START method=${req.method} origin=${origin}`);
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const {
      email, name, shipping, orderSummary, metadata,
      intended_price_pence, intended_price_currency, intended_price_display
    } = req.body || {};

    // NOTE: email is OPTIONAL now (to allow immediate PE mount)
    const safeMeta = sanitizeMetadata(metadata);
    const pricePence = Number.isFinite(+intended_price_pence) ? Math.max(0, Math.floor(+intended_price_pence)) : 0;
    const priceCurrency = (intended_price_currency || 'gbp').toLowerCase();
    const priceDisplay = intended_price_display ? String(intended_price_display) : '';

    const billingAddress = shipping?.address ? {
      line1: shipping.address.line1 || null,
      line2: shipping.address.line2 || null,
      city: shipping.address.city || null,
      postal_code: shipping.address.postal_code || null,
      country: shipping.address.country || 'GB'
    } : undefined;

    // Stripe customer: find by email if provided, else create anonymous
    let customer = null;
    if (email){
      const { data } = await stripe.customers.list({ email, limit: 1 });
      customer = data[0] || (await stripe.customers.create({
        email, name, address: billingAddress, shipping, metadata: safeMeta
      }));
    } else {
      customer = await stripe.customers.create({
        name: name || null, address: billingAddress, shipping,metadata: { ...safeMeta, provisional: 'true' }
      });
    }

    // store intended price info on customer
    await stripe.customers.update(customer.id, {
      name: name || undefined,
      address: billingAddress,
      shipping,
      metadata: {
        ...(customer.metadata || {}),
        last_intended_price_pence: String(pricePence),
        last_intended_price_currency: priceCurrency,
        last_intended_price_display: priceDisplay || ''
      }
    });

    const meta = {
      ...safeMeta,
      order_summary: orderSummary || 'We’ll charge this card when your order ships.',
      intended_price_pence: String(pricePence),
      intended_price_currency: priceCurrency,
      intended_price_display: priceDisplay
    };

    // Create SetupIntent
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      usage: 'off_session',
      payment_method_types: ['card','link'],
      metadata: meta
    });

    // ---- KIT (only if email present) ----
    if (email && process.env.KIT_API_KEY){
      try{
        const LABELS = ['Portal Link','Order Label'];
        const [PORTAL_KEY, ORDERLABEL_KEY] = await Promise.all(LABELS.map(kitEnsureCustomField));
        const label = priceDisplay ? `Intended: ${priceDisplay} (${priceCurrency.toUpperCase()})` : 'Intended: n/a';
        const fieldsByKey = {
          [PORTAL_KEY]: 'https://wipeuranus.com/#success',
          [ORDERLABEL_KEY]: label
        };

        const createdId = await kitCreateOrUpdateSubscriber({
          email,
          first_name: (name || '').split(' ')[0] || '',
          fields: fieldsByKey
        });

        const subId = createdId || (await kitGetSubscriberIdByEmail(email));
        if (subId){ await kitUpdateSubscriber(subId, { fields: fieldsByKey }); }

        const SEQUENCE_ID = process.env.KIT_SEQUENCE_ID_ORDERLINK;
        if (SEQUENCE_ID){
          await kitAddToSequence({ sequenceId: SEQUENCE_ID, email });
        } else {
          console.warn(`[SETUP-EMBED+KIT][${_rid}] Skipped sequence: missing KIT_SEQUENCE_ID_ORDERLINK`);
        }
      }catch(e){
        console.warn(`[SETUP-EMBED+KIT][${_rid}] KIT step skipped: ${e.message}`);
      }
    }

    console.log(`[SETUP-EMBED+KIT][${_rid}] SetupIntent created id=${setupIntent.id}`);
    return res.status(200).json({ client_secret: setupIntent.client_secret, customer_id: customer.id, setup_intent_id: setupIntent.id });

  }catch(e){
    console.error(`[SETUP-EMBED+KIT][${_rid}] ERROR ${e.type || ''} ${e.message}`);
    if (e.raw && e.raw.param) console.error(`[SETUP-EMBED+KIT][${_rid}] Stripe param error -> ${e.raw.param}`);
    console.error(`[SETUP-EMBED+KIT][${_rid}] STACK\n${e.stack}`);
    return res.status(500).json({ error:e.message, rid:_rid });
  }finally{
    console.log(`[SETUP-EMBED+KIT][${_rid}] END`);
  }
};
