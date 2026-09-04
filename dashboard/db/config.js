'use strict';
const fs = require('fs');

// Everything the operator supplies, read from the environment.
//
// WHY THE ENVIRONMENT AND NOT A FILE IN THIS FOLDER. Two reasons, and the
// second is the one that forces it.
//
//   1. A stranger cloning this has no allowlist, no organisation and no fleet.
//      Anything the package reads from a path inside itself is a thing they
//      have to create before it will start, and the package should start.
//
//   2. This folder is going to be REPLACED WHOLESALE, on every release, by
//      whatever the public repository contains. Anything of ours living inside
//      it disappears the first time that happens. Configuration therefore has
//      to arrive from outside the folder, and the environment is the one place
//      every host already has — a container runtime, a systemd unit, a
//      .env file on a laptop, all the same interface.
//
// Each value accepts EITHER inline JSON or a path to a JSON file, because those
// are the two shapes hosts actually offer: a secret manager hands you a string,
// a mounted volume hands you a file.

// Distinguishing the two without guessing at file extensions: JSON documents
// start with { or [ once trimmed, and no filesystem path does.
function readJsonSetting(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();
  const source = value.startsWith('{') || value.startsWith('[') ? 'inline' : 'file';
  try {
    return {
      source,
      name,
      data: source === 'inline' ? JSON.parse(value) : JSON.parse(fs.readFileSync(value, 'utf8')),
    };
  } catch (err) {
    // Never echo `value` — for a file this is a path, but for inline JSON it is
    // the document itself, and one of these documents says who may write to the
    // database.
    throw new Error(
      `${name} is set but could not be read as JSON (${source}): ${err.message}`,
    );
  }
}

// The ingest endpoint is off unless BOTH of these are supplied, and that is the
// safe default: an installation nobody has configured should not be accepting
// authenticated writes from anywhere.
//
// It is also why they are read together rather than one each. The audience is
// half of the OIDC contract and the allowlist is the other half; a deployment
// that sets one and forgets the other would otherwise come up rejecting every
// publish in the fleet for a reason nothing states. This way it comes up with
// ingest visibly off and says so at boot.
function ingestConfig(env = process.env) {
  const audience = (env.WATCHTOWER_INGEST_AUDIENCE || '').trim();
  const allowlist = readJsonSetting('WATCHTOWER_INGEST_ALLOWLIST');
  if (!audience && !allowlist) {
    return { enabled: false, reason: 'neither WATCHTOWER_INGEST_AUDIENCE nor WATCHTOWER_INGEST_ALLOWLIST is set' };
  }
  if (!audience) {
    return { enabled: false, reason: 'WATCHTOWER_INGEST_ALLOWLIST is set but WATCHTOWER_INGEST_AUDIENCE is not' };
  }
  if (!allowlist) {
    return { enabled: false, reason: 'WATCHTOWER_INGEST_AUDIENCE is set but WATCHTOWER_INGEST_ALLOWLIST is not' };
  }
  return { enabled: true, audience, allowlist: allowlist.data, source: allowlist.source };
}

// Display casing for organisations and systems — "ACME Web" rather than
// "acme-web".
// Optional by design: without it the pages title-case the keys, which is what
// makes this shippable to somebody whose fleet we know nothing about.
function displayNames() {
  const setting = readJsonSetting('WATCHTOWER_DISPLAY_NAMES');
  return setting ? setting.data : null;
}

module.exports = { ingestConfig, displayNames, readJsonSetting };
