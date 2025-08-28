// /api/create-setup-checkout-session.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, name, shipping, orderSummary, metadata } = req.body;
    // Build a "billing address = shipping address" object for the Customer
    const billingAddress = shipping?.address ? {
      line1: shipping.address.line1,
      line2: shipping.address.line2 || null,
      city: shipping.address.city,
      postal_code: shipping.address.postal_code,
      country: shipping.address.country,
      // region/state optional: shipping.address.state && { state: shipping.address.state }
    } : undefined;

    const siteOrigin = (ALLOWED_ORIGINS.has(origin) ? origin : 'https://wipeuranus.com').replace(/\/$/, '');

    const DEFAULT_SUCCESS = `${siteOrigin}/?session_id={CHECKOUT_SESSION_ID}#success`;
    const DEFAULT_CANCEL  = `${siteOrigin}/#cancel`;
        // force a success url that contains the token, even if client sends one
    const successUrl = (success_url && success_url.includes('{CHECKOUT_SESSION_ID}')) ? success_url : DEFAULT_SUCCESS;
    const cancelUrl  = cancel_url || DEFAULT_CANCEL;

    // 1) Ensure a Customer with your order details stored
    const { data } = await stripe.customers.list({ email, limit: 1 });
    const customer = data[0] || await stripe.customers.create({
      email,
      name,
      address: billingAddress,    // <-- billing prefill
      shipping,                   // <-- keep shipping on customer too
      metadata
    });

    // keep details fresh
    await stripe.customers.update(customer.id, {
      name,
      address: billingAddress,    // <-- keep in sync
      shipping
    });

    // 2) Create Checkout Session in SETUP mode
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      customer: customer.id,
      currency: 'gbp', 
      shipping_address_collection: { allowed_countries: ['GB'] },
      billing_address_collection: 'required',
      customer_update: { address: 'never', shipping: 'never', name: 'never' }, // optional
      // You can let Stripe send customer comms and show your copy:
      custom_text: {
        submit: { message: (orderSummary || 'We’ll charge this card when your order ships.') }
      },
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata: {
        ...metadata,
        // helpful for reconciling the saved payment method with your order
        order_summary: orderSummary || 'We’ll charge this card when your order ships.'
      }
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
