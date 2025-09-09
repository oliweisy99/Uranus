const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

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

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  cors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });

  try {
    const { customer_id, setup_intent_id } = req.body || {};
    if (!customer_id && !setup_intent_id) {
      return res.status(400).json({ error: 'customer_id or setup_intent_id required' });
    }

    // 1) Cancel the SetupIntent if it exists and didn’t succeed
    if (setup_intent_id) {
      try {
        const si = await stripe.setupIntents.retrieve(setup_intent_id);
        if (si && si.status !== 'succeeded' && si.status !== 'canceled') {
          await stripe.setupIntents.cancel(setup_intent_id);
        }
      } catch (e) {
        console.warn('[TEARDOWN] SI cancel skipped:', e.message);
      }
    }

    // 2) Delete provisional customer only if unused (no PMs/invoices/subs/PIs)
    if (customer_id) {
      const cust = await stripe.customers.retrieve(customer_id);
      const isProvisional = cust?.metadata?.provisional === 'true';
      if (isProvisional) {
        const [pms, invs, subs, pis] = await Promise.all([
          stripe.paymentMethods.list({ customer: customer_id, type: 'card', limit: 1 }),
          stripe.invoices.list({ customer: customer_id, limit: 1 }),
          stripe.subscriptions.list({ customer: customer_id, limit: 1 }),
          stripe.paymentIntents.list({ customer: customer_id, limit: 1 })
        ]);
        const hasObjects = (pms.data.length + invs.data.length + subs.data.length + pis.data.length) > 0;
        if (!hasObjects) {
          await stripe.customers.del(customer_id);
          return res.status(200).json({ ok: true, deleted_customer: true, canceled_setup_intent: !!setup_intent_id });
        }
      }
    }

    return res.status(200).json({ ok: true, deleted_customer: false, canceled_setup_intent: !!setup_intent_id });
  } catch (e) {
    console.error('[TEARDOWN] ERROR', e);
    return res.status(500).json({ error: e.message });
  }
};
