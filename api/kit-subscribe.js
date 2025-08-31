// /api/kit-subscribe.js
// Vercel Serverless Function (Node 18+ has fetch built-in)

// ---------- Config ----------
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

// ---------- Utils ----------
function cors(res, origin){
  if (ALLOWED.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Max-Age','86400');
}
function rid(){ return Math.random().toString(36).slice(2,10); }
const pick = v => (typeof v === 'string' && v.trim()) ? v.trim() : undefined;

function splitName(full=''){
  const t = (full || '').trim();
  if (!t) return { first:'', full:'' };
  const parts = t.split(/\s+/);
  return { first: parts[0] || '', full: t };
}

// ---------- Kit helpers ----------
async function kitEnsureCustomField(label){
  const resp = await fetch(`${KIT_API_BASE}/custom_fields`,{
    method:'POST', headers: KIT_HEADERS, body: JSON.stringify({ label })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit ensure "${label}" failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.custom_field?.key; // return the field KEY to use in payloads
}

async function kitGetSubscriberByEmail(email){
  const url = `${KIT_API_BASE}/subscribers?email_address=${encodeURIComponent(email)}`;
  const resp = await fetch(url, { headers: KIT_HEADERS });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit get by email failed: ${txt}`);
  const json = JSON.parse(txt);
  return (json?.subscribers?.[0]) || null; // full object (id, first_name, fields, etc.)
}

async function kitCreateOrUpdateSubscriber({ email, first_name, fields }){
  // POST /subscribers acts like upsert on many Kit accounts
  const resp = await fetch(`${KIT_API_BASE}/subscribers`,{
    method:'POST', headers: KIT_HEADERS,
    body: JSON.stringify({ email_address: email, first_name: first_name || '', fields })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit create/update subscriber failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.subscriber?.id;
}

async function kitUpdateSubscriber(id, payload){
  // Use PUT for consistency with your other function
  const resp = await fetch(`${KIT_API_BASE}/subscribers/${id}`,{
    method:'PUT', headers: KIT_HEADERS, body: JSON.stringify(payload)
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Kit update failed: ${txt}`);
  const json = JSON.parse(txt);
  return json?.subscriber;
}

async function kitAddToForm(formId, email){
  const resp = await fetch(`${KIT_API_BASE}/forms/${formId}/subscribers`,{
    method:'POST', headers: KIT_HEADERS,
    body: JSON.stringify({ email_address: email })
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`Add to form failed: ${txt}`);
  return true;
}

async function kitTagSubscriber(tagId, email){
  const resp = await fetch(`${KIT_API_BASE}/tags/${tagId}/subscribers`,{
    method:'POST', headers: KIT_HEADERS,
    body: JSON.stringify({ email_address: email })
  });
  // Tagging failures shouldn't break the flow
  if (!resp.ok) {
    const txt = await resp.text();
    console.warn(`[KIT][tag] failed: ${txt}`);
  }
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  console.log(`[KIT-SUBSCRIBE][${_rid}] START method=${req.method} origin=${origin}`);
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try{
    const API_KEY = process.env.KIT_API_KEY;
    const FORM_ID = process.env.KIT_FORM_ID;
    const TAG_ID  = process.env.KIT_TAG_ID || '';

    if (!API_KEY || !FORM_ID){
      return res.status(500).json({ error:'Server not configured (missing KIT_API_KEY or KIT_FORM_ID)' });
    }

    const { name = '', tree_name = '', email = '' } = req.body || {};
    if (!pick(email)) return res.status(400).json({ error:'Email required' });

    const { first: firstName, full: fullName } = splitName(name);

    // Ensure custom fields exist & get their KEYS
    const [TREE_KEY, FULLNAME_KEY, SOURCE_KEY] = await Promise.all([
      kitEnsureCustomField('Tree Name'),
      kitEnsureCustomField('Full Name'),
      kitEnsureCustomField('Source')
    ]);

    // Fetch existing subscriber (if any)
    let existing = null;
    try{
      existing = await kitGetSubscriberByEmail(email);
    }catch(e){
      console.warn(`[KIT-SUBSCRIBE][${_rid}] Lookup by email failed (continuing as create): ${e.message}`);
    }

    // Build fields payload:
    // - Always set/overwrite Tree Name.
    // - Only set Full Name if blank/missing.
    // - Set Source if blank/missing (keeps original if already present).
    const existingFields = existing?.fields || {};
    const fieldsByKey = {
      [TREE_KEY]: pick(tree_name) || '', // refresh / overwrite
      ...(existingFields[SOURCE_KEY] ? {} : { [SOURCE_KEY]: 'wipeuranus.com/plant-tree' }),
      ...(existingFields[FULLNAME_KEY] ? {} : { [FULLNAME_KEY]: fullName || '' })
    };

    if (!existing){
      // Create or upsert (POST acts like upsert on many Kit accounts)
      await kitCreateOrUpdateSubscriber({
        email: pick(email),
        first_name: firstName || '', // set first name at create
        fields: fieldsByKey
      });
    } else {
      // Update existing: only set first_name if missing or empty
      const payload = {
        ...(existing.first_name ? {} : { first_name: firstName || '' }),
        fields: fieldsByKey
      };
      await kitUpdateSubscriber(existing.id, payload);
    }

    // Ensure they're added to the form
    await kitAddToForm(FORM_ID, pick(email));

    // Optional tag
    if (TAG_ID) await kitTagSubscriber(TAG_ID, pick(email));

    console.log(`[KIT-SUBSCRIBE][${_rid}] OK`);
    return res.status(200).json({ ok:true /* , discount_code: 'URANUS15-....' */ });

  }catch(e){
    console.error(`[KIT-SUBSCRIBE][${_rid}] ERROR`, e);
    return res.status(500).json({ error:e.message });
  }
};
