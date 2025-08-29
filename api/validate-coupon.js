// /api/validate-coupon.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app'
]);

function cors(res, origin) {
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

module.exports = async (req, res) => {
  const _rid = rid();
  const origin = req.headers.origin || '';
  cors(res, origin);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ valid: false, message: 'Method not allowed' });

  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ valid: false, message: 'Missing code' });
    }

    // Find active promotion code with this exact code
    const promos = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
      expand: ['data.coupon']
    });

    const promo = promos.data[0];
    if (!promo) {
      return res.status(200).json({ valid: false, message: 'Code not found or inactive' });
    }

    const coupon = promo.coupon;
    // Build normalized response
    if (coupon.percent_off) {
      return res.status(200).json({
        valid: true,
        code: promo.code,
        type: 'percent',
        percent_off: coupon.percent_off
      });
    }

    if (coupon.amount_off) {
      // amount_off is in smallest unit. Convert to decimal GBP if currency is gbp.
      const curr = (coupon.currency || 'gbp').toLowerCase();
      const factor = 100; // gbp minor units
      const amountDecimal = curr === 'gbp' ? (coupon.amount_off / factor) : (coupon.amount_off / factor);
      return res.status(200).json({
        valid: true,
        code: promo.code,
        type: 'amount',
        amount_off: amountDecimal,
        currency: curr
      });
    }

    // Fallback (no discount?!)
    return res.status(200).json({ valid: false, message: 'Coupon has no discount configured' });

  } catch (e) {
    console.error(`[VALIDATE][${_rid}] ERROR`, e);
    return res.status(500).json({ valid: false, message: 'Server error' });
  }
};
