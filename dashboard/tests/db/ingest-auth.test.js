'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { makeVerifier } = require('../../db/ingest-auth');

const ISSUER = 'https://token.actions.githubusercontent.com';
const AUD = 'watchtower-ingest';

// Build a signer + a verifier that share one in-memory RSA keypair (no network).
async function harness() {
  const jose = await import('jose');
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
  const sign = (claims, over = {}) => {
    const jwt = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(over.issuer ?? ISSUER)
      .setAudience(over.audience ?? AUD)
      .setIssuedAt();
    jwt.setExpirationTime(over.exp ?? '5m');
    return jwt.sign(privateKey);
  };
  const verifier = makeVerifier({ audience: AUD, issuer: ISSUER, keySet: publicKey });
  return { sign, verifier };
}

test('accepts a valid token and returns the repository claim', async () => {
  const { sign, verifier } = await harness();
  const token = await sign({ repository: 'some-org/alpha' });
  const claims = await verifier.verify(token);
  assert.strictEqual(claims.repository, 'some-org/alpha');
});

test('rejects an expired token', async () => {
  const { sign, verifier } = await harness();
  const token = await sign({ repository: 'org/repo' }, { exp: Math.floor(Date.now() / 1000) - 60 });
  await assert.rejects(() => verifier.verify(token));
});

test('rejects a wrong-issuer token', async () => {
  const { sign, verifier } = await harness();
  const token = await sign({ repository: 'org/repo' }, { issuer: 'https://evil.example' });
  await assert.rejects(() => verifier.verify(token));
});

test('rejects a wrong-audience token', async () => {
  const { sign, verifier } = await harness();
  const token = await sign({ repository: 'org/repo' }, { audience: 'some-other-service' });
  await assert.rejects(() => verifier.verify(token));
});

test('rejects a non-RS256 token even with a valid signature (algorithm pin)', async () => {
  // A properly PS256-signed token, verified against its own matching public key,
  // must still be rejected: jose checks the pinned algorithms list before key
  // material, so PS256 ∉ ['RS256'] closes any algorithm-substitution gap.
  const jose = await import('jose');
  const { publicKey, privateKey } = await jose.generateKeyPair('PS256');
  const token = await new jose.SignJWT({ repository: 'org/repo' })
    .setProtectedHeader({ alg: 'PS256' })
    .setIssuer(ISSUER)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  const verifier = makeVerifier({ audience: AUD, issuer: ISSUER, keySet: publicKey });
  await assert.rejects(() => verifier.verify(token));
});
