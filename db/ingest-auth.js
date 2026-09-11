'use strict';

// GitHub Actions OIDC verifier. jose is ESM-only, so it is loaded via dynamic
// import (never require) and cached, keeping this CommonJS module working.

const DEFAULT_ISSUER = 'https://token.actions.githubusercontent.com';
const DEFAULT_JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';

let josePromise;
async function loadJose() {
  if (!josePromise) josePromise = import('jose');
  return josePromise;
}

function makeVerifier({ audience, issuer = DEFAULT_ISSUER, jwksUrl = DEFAULT_JWKS_URL, keySet } = {}) {
  if (!audience) throw new Error('makeVerifier: audience is required');
  let remoteJwks;
  return {
    async verify(token) {
      const jose = await loadJose();
      const keys = keySet || (remoteJwks ||= jose.createRemoteJWKSet(new URL(jwksUrl)));
      const { payload } = await jose.jwtVerify(token, keys, { issuer, audience, algorithms: ['RS256'] });
      return payload;
    },
  };
}

module.exports = { makeVerifier, DEFAULT_ISSUER, DEFAULT_JWKS_URL };
