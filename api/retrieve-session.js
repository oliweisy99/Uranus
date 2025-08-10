const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

module.exports = async (req, res) => {
  try {
    const { session_id } = req.query || {};
    if (!session_id) return res.status(400).json({ error: 'Missing session_id' });

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items.data.price.product', 'subscription', 'payment_intent', 'customer']
    });

    // Return only what you need on the client
    res.status(200).json({
      id: session.id,
      mode: session.mode,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: session.customer_details?.email,
      shipping: session.shipping_details, // name + address
      line_items: session.line_items?.data?.map(li => ({
        quantity: li.quantity,
        price: li.price?.unit_amount,
        currency: li.price?.currency,
        product_name: li.price?.product?.name
      })),
      subscription_id: session.subscription || null,
      payment_intent_id: session.payment_intent || null,
      metadata: session.metadata || {}
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
