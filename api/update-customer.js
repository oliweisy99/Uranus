// /api/update-customer.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const KIT_API_BASE = 'https://api.kit.com/v4';
const KIT_HEADERS = {
  'Content-Type': 'application/json',
  'X-Kit-Api-Key': process.env.KIT_API_KEY || ''
};

const ALLOWED = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

function cors(res, origin){
  if (ALLOWED.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Max-Age','86400');
}
function rid(){ return Math.random().toString(36).slice(2,10); }
const pick = v => (typeof v === 'string' && v.trim()) ? v.trim() : undefined;

// ---------- Kit helpers ----------
async function kitEnsureCustomField(label){
  const resp = await fetch(`${KIT_API_BASE}/custom_fields`,{
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ label })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit ensure "${label}" failed: ${txt}`);
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
async function kitGetSubscriberIdByEmail(email){
  const url = `${KIT_API_BASE}/subscribers?email_address=${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: KIT_HEADERS });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit get by email failed: ${txt}`);
  const json = JSON.parse(txt);
  return (json?.subscribers?.[0]?.id) || null;
}
async function kitUpdateSubscriber(id, payload){
  const resp = await fetch(`${KIT_API_BASE}/subscribers/${id}`,{
    method:'PUT', headers: KIT_HEADERS, body: JSON.stringify(payload)
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit update failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.subscriber;
}
async function kitEnsureTag(name){
  if (process.env.KIT_TAG_ID_CUSTOMER && name.toLowerCase() === 'customer') {
    return process.env.KIT_TAG_ID_CUSTOMER;
  }
  const resp = await fetch(`${KIT_API_BASE}/tags`, {
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ name })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit ensure tag "${name}" failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.tag?.id;
}
async function kitTagSubscriber({ tagId, email }){
  if (!tagId) return;
  const resp = await fetch(`${KIT_API_BASE}/tags/${tagId}/subscribers`, {
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ email_address: email })
  });
  if (!resp.ok) throw new Error(`Kit tag subscriber failed: ${await resp.text()}`);
}

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  console.log(`[UPDATE-CUSTOMER][${_rid}] START method=${req.method} origin=${origin}`);
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const {
      customer_id,               // optional now
      email, name, phone,
      address,                   // { line1, line2, city, postal_code, country }
      shipping,                  // { name, phone, address: { ... } }
      order_ref,                 // SetupIntent id (e.g., si_...)
      intended_price_display,    // e.g., "£26.21"
      intended_price_currency,   // e.g., "gbp"
      meta,                      // { selectedPack, mode, subscriber_yes_no, subscription_freq, delivery_label }
      payment_method_id          // REQUIRED to attach as default
    } = req.body || {};

    // We'll create a customer on demand if one wasn't provided.
    let cid = customer_id;

    // Build Stripe customer payload from provided fields
    const payload = {};
    if (pick(email)) payload.email = pick(email);
    if (pick(name))  payload.name  = pick(name);
    if (pick(phone)) payload.phone = pick(phone);

    if (address && typeof address === 'object'){
      const a = {};
      if (pick(address.line1))       a.line1 = pick(address.line1);
      if (pick(address.line2))       a.line2 = pick(address.line2);
      if (pick(address.city))        a.city = pick(address.city);
      if (pick(address.postal_code)) a.postal_code = pick(address.postal_code);
      if (pick(address.country))     a.country = pick(address.country).toUpperCase();
      if (Object.keys(a).length) payload.address = a;
    }
    if (shipping && typeof shipping === 'object'){
      const s = {};
      if (pick(shipping.name))  s.name = pick(shipping.name);
      if (pick(shipping.phone)) s.phone = pick(shipping.phone);
      if (shipping.address && typeof shipping.address === 'object'){
        const sa = {};
        if (pick(shipping.address.line1))       sa.line1 = pick(shipping.address.line1);
        if (pick(shipping.address.line2))       sa.line2 = pick(shipping.address.line2);
        if (pick(shipping.address.city))        sa.city = pick(shipping.address.city);
        if (pick(shipping.address.postal_code)) sa.postal_code = pick(shipping.address.postal_code);
        if (pick(shipping.address.country))     sa.country = pick(shipping.address.country).toUpperCase();
        if (Object.keys(sa).length) s.address = sa;
      }
      if (Object.keys(s).length) payload.shipping = s;
    }

    if (!cid) {
      // Create the real customer now that the user actually submitted details
      const created = await stripe.customers.create({
        ...(Object.keys(payload).length ? payload : {}),
        metadata: {
          ...(meta || {}),
          created_via: 'carrd-elements',
        }
      });
      cid = created.id;
    } else if (Object.keys(payload).length){
      await stripe.customers.update(cid, payload);
    }

    // Attach + set default payment method
    if (payment_method_id) {
      try {
        await stripe.paymentMethods.attach(payment_method_id, { customer: cid });
      }  catch (e) {
        if (e?.code !== 'resource_already_exists') throw e;
      }
      await stripe.customers.update(cid, {
        invoice_settings: { default_payment_method: payment_method_id }
      });
    } else {
      return res.status(400).json({ error: 'payment_method_id is required' });
    }

    // --- Derive Kit field values ---
    const selectedPack = pick(meta?.selectedPack) || '';
    const mode = pick(meta?.mode) || '';
    const subscriberYesNo = pick(meta?.subscriber_yes_no) || (mode === 'subscription' ? 'Yes' : 'No');
    const subscriptionFreq = pick(meta?.subscription_freq) || '';
    const fullName = pick(name) || pick(shipping?.name) || '';
    const priceDisplay = pick(intended_price_display);
    const priceCurrency = (pick(intended_price_currency) || 'gbp').toUpperCase();
    const orderLabel = priceDisplay ? `Intended: ${priceDisplay} (${priceCurrency})` : 'Intended: n/a';
    const orderLink = order_ref ? `https://wipeuranus.com/?order_ref=${encodeURIComponent(order_ref)}#success` : '';
    const preorderStatus = 'Ordered';
    const customerFlag = 'Yes'; // mark as real customer after successful save

    // Create a Billing Portal session for "Portal Link"
    let portalUrl = '';
    try{
      const portal = await stripe.billingPortal.sessions.create({
        customer: cid,
        return_url: 'https://wipeuranus.com/#success'
      });
      portalUrl = portal?.url || '';
    }catch(e){
      console.warn(`[UPDATE-CUSTOMER][${_rid}] Billing Portal create failed: ${e.message}`);
    }

    // --- Update Kit (only if email & KIT key present) ---
    if (process.env.KIT_API_KEY && pick(email)){
      try{
        const LABELS = [
          'Customer',
          'Full Name',
          'Order Label',
          'Order Link',
          'Pack',
          'Portal Link',
          'Preorder Status',
          'Subscriber',
          'SubscriptionFreq'
        ];
        const [
          CUSTOMER_KEY,
          FULLNAME_KEY,
          ORDERLABEL_KEY,
          ORDERLINK_KEY,
          PACK_KEY,
          PORTAL_KEY,
          PREORDER_KEY,
          SUBSCRIBER_KEY,
          SUBFREQ_KEY
        ] = await Promise.all(LABELS.map(kitEnsureCustomField));

        const fieldsByKey = {
          [CUSTOMER_KEY]: customerFlag,
          [FULLNAME_KEY]: fullName || '',
          [ORDERLABEL_KEY]: orderLabel,
          [ORDERLINK_KEY]: orderLink,
          [PACK_KEY]: String(selectedPack || ''),
          [PORTAL_KEY]: portalUrl || '',
          [PREORDER_KEY]: preorderStatus,
          [SUBSCRIBER_KEY]: subscriberYesNo || '',
          [SUBFREQ_KEY]: subscriptionFreq || ''
        };

        const createdId = await kitCreateOrUpdateSubscriber({
          email: pick(email),
          first_name: (fullName || '').split(' ')[0] || '',
          fields: fieldsByKey
        });

        const subId = createdId || (await kitGetSubscriberIdByEmail(pick(email)));
        if (subId) await kitUpdateSubscriber(subId, { fields: fieldsByKey });

        // ensure + apply "customer" tag
        try{
          const tagName = 'customer';
          const tagId = process.env.KIT_TAG_ID_CUSTOMER || await kitEnsureTag(tagName);
          console.log(`[UPDATE-CUSTOMER][${_rid}] applying tag "${tagName}" (id=${tagId}) to ${email}`);
          await kitTagSubscriber({ tagId, email: pick(email) });
        }catch(tagErr){
          console.warn(`[UPDATE-CUSTOMER][${_rid}] Tag step skipped: ${tagErr.message}`);
        }

      }catch(e){
        console.warn(`[UPDATE-CUSTOMER][${_rid}] Kit update skipped: ${e.message}`);
      }
    } else {
      if (!process.env.KIT_API_KEY) console.warn(`[UPDATE-CUSTOMER][${_rid}] No KIT_API_KEY set`);
      if (!email) console.warn(`[UPDATE-CUSTOMER][${_rid}] No email provided; cannot update Kit`);
    }

    console.log(`[UPDATE-CUSTOMER][${_rid}] OK`);
    return res.status(200).json({ ok:true, portal_url: portalUrl, customer_id: cid });

  }catch(e){
    console.error(`[UPDATE-CUSTOMER][${_rid}] ERROR`, e);
    return res.status(500).json({ error:e.message });
  }
};
