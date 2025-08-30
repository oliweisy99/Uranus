// /api/cancel-preorder.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

// ----- Kit API -----
const KIT_API_BASE = 'https://api.kit.com/v4';
const KIT_HEADERS = {
  'Content-Type': 'application/json',
  'X-Kit-Api-Key': process.env.KIT_API_KEY || ''
};

function rid(){ return Math.random().toString(36).slice(2,10); }

async function kitEnsureCustomField(label){
  const resp = await fetch(`${KIT_API_BASE}/custom_fields`,{
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ label })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit ensure custom field "${label}" failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.custom_field?.key; // e.g. "preorder_status"
}

async function kitCreateOrUpdateSubscriber({ email, first_name, fields }){
  const resp = await fetch(`${KIT_API_BASE}/subscribers`,{
    method:'POST', headers: KIT_HEADERS,
    body: JSON.stringify({ first_name: first_name || '', email_address: email, fields })
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
  return (json?.subscribers || [])[0] || null;
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

// ----- Handler -----
module.exports = async (req,res)=>{
  const _rid = rid();
  const origin = req.headers.origin;

  if (ALLOWED.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');

  if (req.method==='OPTIONS') return res.status(204).end();
  if (req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });

  try {
    const { customer_id, detach_payment_method_id, cancel_note } = req.body || {};
    if (!customer_id) return res.status(400).json({ error:'Missing customer_id' });

    console.log(`[CANCEL][${_rid}] start customer=${customer_id}`);

    // Get Stripe customer (for email + name + last stored "intended price" etc.)
    const customer = await stripe.customers.retrieve(customer_id);
    const email = customer?.email;
    const firstName = (customer?.name || '').split(' ')[0] || '';
    const orderLabel =
      (customer?.metadata?.last_intended_price_display
        ? `Intended: ${customer.metadata.last_intended_price_display} (${(customer.metadata.last_intended_price_currency || 'gbp').toUpperCase()})`
        : 'Intended: n/a');

    // 1) Flag as cancelled in Stripe (source of truth for gating)
    await stripe.customers.update(customer_id, {
      metadata: { ...(customer.metadata || {}), preorder_status: 'cancelled' }
    });

    // 2) Detach the saved card, if provided
    if (detach_payment_method_id) {
      try { await stripe.paymentMethods.detach(detach_payment_method_id); }
      catch(e){ console.warn(`[CANCEL][${_rid}] detach pm failed: ${e.message}`); }
    }

    // 3) Attempt to delete the customer (non-fatal if it fails)
    let deleted = false;
    try {
      const del = await stripe.customers.del(customer_id);
      deleted = !!(del && del.deleted === true);
    } catch (e) {
      console.warn(`[CANCEL][${_rid}] stripe delete failed: ${e.message}`);
    }

    // 4) Update Kit + send cancellation confirmation via sequence
    if (process.env.KIT_API_KEY && email) {
      // Ensure fields exist (get their KEYS)
      const LABELS = ['Preorder Status', 'Cancelled At', 'Order Label', 'Cancel Note'];
      const [STATUS_KEY, CANCELLED_AT_KEY, ORDER_LABEL_KEY, CANCEL_NOTE_KEY] =
        await Promise.all(LABELS.map(kitEnsureCustomField));

      const cancelledAtISO = new Date().toISOString();
      const fieldsByKey = {
        [STATUS_KEY]: 'cancelled',
        [CANCELLED_AT_KEY]: cancelledAtISO,
        [ORDER_LABEL_KEY]: orderLabel,
        [CANCEL_NOTE_KEY]: cancel_note ? String(cancel_note).slice(0, 500) : ''
      };

      // Upsert then force PUT (covers existing contacts)
      const createdId = await kitCreateOrUpdateSubscriber({
        email,
        first_name: firstName,
        fields: fieldsByKey
      });
      const subId = createdId || (await kitGetSubscriberIdByEmail(email));
      if (subId) {
        await kitUpdateSubscriber(subId, { fields: fieldsByKey });
      }

      // Enroll in "Cancelled" sequence to send the confirmation email
      const SEQ = process.env.KIT_SEQUENCE_ID_CANCELLED;
      if (SEQ) {
        await kitAddToSequence({ sequenceId: SEQ, email });
        console.log(`[CANCEL][${_rid}] added ${email} to cancelled sequence ${SEQ}`);
      } else {
        console.warn(`[CANCEL][${_rid}] skipped sequence (no KIT_SEQUENCE_ID_CANCELLED set)`);
      }
    } else {
      console.warn(`[CANCEL][${_rid}] Skipped Kit update — missing KIT_API_KEY or email`);
    }

    console.log(`[CANCEL][${_rid}] done ok deleted=${deleted}`);
    return res.status(200).json({ ok: true, deleted });
  } catch (e) {
    console.error(`[CANCEL][${_rid}] error ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
};
