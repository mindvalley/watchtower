'use strict';

/*
 * A stable name for a finding, so the same agreement found in two runs — or by
 * two auditors in one run — is recognised as one.
 *
 * Findings are written by a model, so their wording changes from run to run.
 * The fingerprint therefore rests only on WHERE the agreement lives: the set of
 * files it names, with line numbers, symbols and commentary stripped. Two
 * findings naming the same files hash the same, whatever they say about them.
 *
 * Known limit, recorded in DESIGN.md: two different agreements between exactly
 * the same files share a fingerprint. The merge step keeps them apart within a
 * run; across runs they would be matched as one.
 */

const crypto = require('node:crypto');

// "apps/web/src/lib/api-client.ts:21 (NEXT_PUBLIC_API_URL)" -> "apps/web/src/lib/api-client.ts"
function placeFile(place) {
  const first = String(place).trim().split(/\s+/)[0] || '';
  return first.replace(/[:(].*$/, '').replace(/^\.\//, '').replace(/[,;]+$/, '');
}

function placeFiles(places) {
  return [...new Set((places || []).map(placeFile).filter(Boolean))].sort();
}

function fingerprint(places) {
  const files = placeFiles(places);
  return crypto.createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
}

module.exports = { fingerprint, placeFile, placeFiles };
