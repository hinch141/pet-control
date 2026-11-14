'use strict';
// Cloudflare Access JWT verification for the optional standalone listener.
// Reject unauthenticated requests; normal Home Assistant ingress remains separate.
const {createPublicKey, verify} = require('node:crypto');

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw Error('Invalid token encoding');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}
function createAccessVerifier({teamDomain, audience, allowedEmails, isEmailAllowed, fetchImpl=fetch, now=()=>Date.now()}) {
  const origin = new URL(teamDomain);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash)
    throw Error('Access team domain must be an HTTPS origin');
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/i.test(audience)) throw Error('Invalid Access application audience');
  const emails = new Set(allowedEmails.map(x=>String(x).trim().toLowerCase()));
  if (!emails.size || emails.has('')) throw Error('Allowed household emails required');
  const issuer = origin.origin;
  let cachedKeys = null, expiresAt = 0;
  async function getKeys() {
    if (cachedKeys && now() < expiresAt) return cachedKeys;
    const response = await fetchImpl(issuer + '/cdn-cgi/access/certs', {signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw Error('Access signing keys unavailable');
    const body = await response.json();
    if (!Array.isArray(body.keys) || !body.keys.length) throw Error('No Access signing keys');
    cachedKeys = body.keys;
    expiresAt = now() + 5*60*1000;
    return cachedKeys;
  }
  return async function verifyAccessJwt(token) {
    if (typeof token !== 'string' || token.length > 16000) throw Error('Missing or invalid Access token');
    const parts = token.split('.');
    if (parts.length !== 3) throw Error('Invalid Access token');
    const header = decodePart(parts[0]);
    const claims = decodePart(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw Error('Unsupported token signature');
    const keys = await getKeys();
    const jwk = keys.find(k=>k.kid === header.kid && k.kty === 'RSA');
    if (!jwk) throw Error('Unknown Access signing key');
    const key = createPublicKey({key:jwk,format:'jwk'});
    const valid = verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]), key, Buffer.from(parts[2],'base64url'));
    if (!valid) throw Error('Invalid Access signature');
    const t = Math.floor(now()/1000);
    if (claims.iss !== issuer || !(Array.isArray(claims.aud) ? claims.aud.includes(audience) : claims.aud === audience) || typeof claims.exp !== 'number' || claims.exp <= t ||
        typeof claims.iat !== 'number' || claims.iat > t + 60 ||
        (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > t)))
      throw Error('Access claims rejected');
    const email = String(claims.email || '').trim().toLowerCase();
    if (!(typeof isEmailAllowed==='function' ? isEmailAllowed(email) : emails.has(email))) throw Error('Household account not authorised');
    return {email,subject:claims.sub};
  };
}
module.exports={createAccessVerifier};
