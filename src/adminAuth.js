import crypto from 'node:crypto';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function protectAdmin(req, res, next) {
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword) return next();

  const authorization = req.get('authorization') || '';
  const encoded = authorization.startsWith('Basic ') ? authorization.slice(6) : '';
  let credentials = '';
  try {
    credentials = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    // Invalid credentials are handled by the response below.
  }

  const separator = credentials.indexOf(':');
  const username = separator >= 0 ? credentials.slice(0, separator) : '';
  const password = separator >= 0 ? credentials.slice(separator + 1) : '';
  const expectedUser = process.env.ADMIN_USER || 'admin';

  if (safeEqual(username, expectedUser) && safeEqual(password, expectedPassword)) return next();

  res.set('WWW-Authenticate', 'Basic realm="La traversée des Alpes RAID 2026 - organisateur", charset="UTF-8"');
  return res.status(401).send('Authentification organisateur requise.');
}
