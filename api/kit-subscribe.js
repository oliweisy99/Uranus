// api/kit-subscribe.js
// Vercel Serverless Function (Node 18+ has fetch built-in)

const API_BASE = 'https://api.kit.com/v4';
const ALLOWED_ORIGINS = [
  'https://wipeuranus.com',        // your live site
  'https://*.carrd.co',            // preview on Carrd (wildcard is fine)
  'http://localhost:3000'          // local testing
];

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.some(o =>
    o.startsWith('http') ? origin === o : origin.endsWith(o.replace('*', ''))
  );
  cors(res, allowed ? origin : '');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const API_KEY = process.env.KIT_API_KEY;
  const FORM_ID = process.env.KIT_FORM_ID;
  const TAG_ID  = process.env.KIT_TAG_ID || ''; // optional

  if (!API_KEY || !FORM_ID) {
    return res.status(500).json({ error: 'Server not configured (missing env vars)' });
  }

  try {
    const { name = '', tree_name = '', email = '' } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email required' });

    const headers = {
      'Content-Type': 'application/json',
      'X-Kit-Api-Key': API_KEY
    };

    // 1) Create/Update subscriber
    const subRes = await fetch(`${API_BASE}/subscribers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        first_name: name,
        email_address: email,
        fields: {
          'Tree name': tree_name,
          'Source': 'wipeuranus.com/plant-tree'
        }
      })
    });

    if (!subRes.ok) {
      const t = await subRes.text();
      return res.status(502).json({ error: 'Kit subscriber create failed', details: t });
    }
    const json = await subRes.json();
    const subscriberId = json?.subscriber?.id;

    // 2) Add to the specific form (by email is simplest)
    const formRes = await fetch(`${API_BASE}/forms/${FORM_ID}/subscribers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email_address: email })
    });
    if (!formRes.ok) {
      const t = await formRes.text();
      return res.status(502).json({ error: 'Add to form failed', details: t });
    }

    // 3) Optional: tag them for automations/segmentation
    if (TAG_ID) {
      await fetch(`${API_BASE}/tags/${TAG_ID}/subscribers`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email_address: email })
      });
    }

    // (Optional) generate per-user code here and return it to the front-end
    // const uniqueCode = 'URANUS15-' + Math.random().toString(36).slice(2, 6).toUpperCase();

    return res.status(200).json({ ok: true /*, discount_code: uniqueCode */ });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
