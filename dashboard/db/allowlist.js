'use strict';

/*
 * The repo -> permitted-systems allowlist, as the operator supplied it.
 *
 * It used to be read from a file inside this folder. It is now handed in
 * already parsed, from WATCHTOWER_INGEST_ALLOWLIST — see db/config.js for why
 * configuration cannot live in here.
 *
 * A repository maps to the SET of systems it may publish. That follows the
 * watchtower model: one repo per org scans every system in that org and posts
 * the results, rather than each target repo publishing itself. A central scan
 * cannot work under a one-repo-one-system rule.
 *
 * What changed, stated plainly: the system identity used to come entirely from
 * the verified `repository` claim, and the request body could not influence it.
 * Now the body names the system and the claim bounds which names are legal. The
 * property that has to hold is that a caller can never write outside its own
 * set — that is what resolve() enforces and what the tests pin.
 *
 * A malformed file throws here rather than resolving to nothing. Returning null
 * for everything is fail-safe in the sense that no bad data is written, but it
 * presents as every publish 403-ing for no visible reason. Refusing to boot is
 * the more honest failure.
 */

function buildAllowlist(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('ingest allowlist: expected an object of repository -> system entries');
  }

  for (const [repository, systems] of Object.entries(raw)) {
    if (!Array.isArray(systems)) {
      throw new Error(`ingest allowlist: '${repository}' must be an array of system entries`);
    }
    for (const entry of systems) {
      if (!entry || typeof entry.system_key !== 'string' || !entry.system_key) {
        throw new Error(`ingest allowlist: an entry under '${repository}' has no system_key`);
      }
    }
  }

  // Null-prototype index so a repository or system named after an Object
  // built-in cannot resolve through the prototype chain.
  const index = Object.create(null);
  for (const [repository, systems] of Object.entries(raw)) {
    const bySystem = Object.create(null);
    for (const entry of systems) bySystem[entry.system_key] = entry;
    index[repository] = bySystem;
  }

  return {
    // Returns the entry when `repository` is permitted to write `systemKey`,
    // otherwise null. Both arguments are untrusted input.
    resolve(repository, systemKey) {
      if (typeof repository !== 'string' || typeof systemKey !== 'string') return null;
      const bySystem = index[repository];
      if (!bySystem) return null;
      return bySystem[systemKey] || null;
    },

    // Every system a caller may write — used by the audit line and by tests.
    systemsFor(repository) {
      if (typeof repository !== 'string') return [];
      return Object.keys(index[repository] || {});
    },
  };
}

module.exports = { buildAllowlist };
