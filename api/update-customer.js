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

async function kitUpsert(email, name){
  if (!process.env.KIT_API_KEY || !email) return;
  try{
    await fetch(`${KIT_API_BASE}/subscribers`, {
      method:'POST', headers: KIT_HEADERS,
      body: JSON.stringify({ email_address: String(email), first_name: (name||'').split(' ')[0] || '' })
    });
  }catch(e){ console.warn('[UPDATE-CUSTOMER] Kit upsert skipped:', e.message); }
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const {
      customer_id,
      email,
      name,
      phone,
      address,   // { line1, line2, city, postal_code, country }
      shipping   // { name, phone, address: { line1, line2, city, postal_code, country } }
    } = req.body || {};

    if (!customer_id) return res.status(400).json({ error:'customer_id required' });

    // Build a "defined-only" payload so we never blank out existing fields.
    const payload = {};

    if (email) payload.email = String(email);
    if (name)  payload.name  = String(name);
    if (phone) payload.phone = String(phone);

    if (address && typeof address === 'object'){
      const a = {};
      if (address.line1)       a.line1 = String(address.line1);
      if (address.line2)       a.line2 = String(address.line2);
      if (address.city)        a.city = String(address.city);
      if (address.postal_code) a.postal_code = String(address.postal_code);
      if (address.country)     a.country = String(address.country).toUpperCase();
      if (Object.keys(a).length) payload.address = a;
    }

    if (shipping && typeof shipping === 'object'){
      const s = {};
      if (shipping.name)  s.name = String(shipping.name);
      if (shipping.phone) s.phone = String(shipping.phone);
      if (shipping.address && typeof shipping.address === 'object'){
        const sa = {};
        if (shipping.address.line1)       sa.line1 = String(shipping.address.line1);
        if (shipping.address.line2)       sa.line2 = String(shipping.address.line2);
        if (shipping.address.city)        sa.city = String(shipping.address.city);
        if (shipping.address.postal_code) sa.postal_code = String(shipping.address.postal_code);
        if (shipping.address.country)     sa.country = String(shipping.address.country).toUpperCase();
        if (Object.keys(sa).length) s.address = sa;
      }
      if (Object.keys(s).length) payload.shipping = s;
    }

    if (Object.keys(payload).length){
      await stripe.customers.update(customer_id, payload);
    }

    // Optional: keep Kit in sync with at least email/name.
    await kitUpsert(email, name);

    return res.status(200).json({ ok:true });
  }catch(e){
    console.error('[UPDATE-CUSTOMER] ERROR', e);
    return res.status(500).json({ error:e.message });
  }
};
