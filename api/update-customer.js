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
    // Create/update subscriber (no custom fields needed here)
    await fetch(`${KIT_API_BASE}/subscribers`, {
      method:'POST', headers: KIT_HEADERS,
      body: JSON.stringify({ email_address: email, first_name: (name||'').split(' ')[0] || '' })
    });
  }catch(e){ console.warn('[UPDATE-CUSTOMER] Kit upsert skipped:', e.message); }
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  cors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const { customer_id, email, name } = req.body || {};
    if (!customer_id) return res.status(400).json({ error:'customer_id required' });

    const payload = {};
    if (email) payload.email = String(email);
    if (name)  payload.name  = String(name);

    if (Object.keys(payload).length){
      await stripe.customers.update(customer_id, payload);
    }

    // keep Kit in sync (optional)
    await kitUpsert(email, name);

    return res.status(200).json({ ok:true });
  }catch(e){
    console.error('[UPDATE-CUSTOMER] ERROR', e.message);
    return res.status(500).json({ error:e.message });
  }
};
