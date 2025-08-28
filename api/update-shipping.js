const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const ALLOWED = new Set(['https://wipeuranus.com','https://www.wipeuranus.com','https://uranus-azure.vercel.app']);

module.exports = async (req,res)=>{
  const origin=req.headers.origin; if (ALLOWED.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin'); res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(204).end();
  if (req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });

  if (req.method==='OPTIONS') return res.status(204).end();
  if (req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });

  try {
    const { customer_id, shipping } = req.body || {};
    if (!customer_id || !shipping || !shipping.address) {
      return res.status(400).json({ error: 'Missing customer_id or shipping' });
    }
    const updated = await stripe.customers.update(customer_id, { shipping });
    res.status(200).json({ ok: true, customer: updated.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
