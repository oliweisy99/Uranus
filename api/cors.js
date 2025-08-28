// /api/_utils/cors.js
const ALLOWED_ORIGINS = new Set([
  'https://wipeuranus.com',
  'https://www.wipeuranus.com',
  'https://uranus-azure.vercel.app', // your function host
  // Add preview/staging origins if you ever need them
  // 'https://preview.carrd.co'  // (only if you test in Carrd preview)
]);

function applyCors(req, res, methods = ['GET', 'POST', 'OPTIONS']) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Only add credentials if you actually use cookies/Authorization with credentials
  // res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true; // handled preflight
  }
  return false;
}

module.exports = { applyCors, ALLOWED_ORIGINS };
