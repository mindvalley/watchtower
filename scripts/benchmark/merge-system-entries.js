'use strict';

// Additive merge of per-system scorecard entries. Every existing system is
// preserved unchanged; incoming (locally-rescanned) systems are added, and on a
// key collision the incoming entry wins. Used by the local cross-org refresh so
// onboarding new systems never drops or mutates the existing ones.
function mergeSystemEntries(existing, incoming) {
  return Object.assign({}, existing, incoming);
}

module.exports = { mergeSystemEntries };
