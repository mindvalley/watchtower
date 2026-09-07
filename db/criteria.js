'use strict';

// The criterion namespace, read from the one file that defines it.
//
// `public/data/criteria-docs.json` is what the pages render and what /ingest
// validates against, and it was read in one place by one line. A second reader
// wanting the same set — the results loader — is the moment to give it a name
// instead of a second copy of the line: a payload the endpoint accepts and the
// loader rejects, or the other way round, would be two definitions of what a
// criterion is with nothing to notice the difference.

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'public', 'data', 'criteria-docs.json');

function criteriaDocs() {
  return JSON.parse(fs.readFileSync(DOCS, 'utf8')).criteria || [];
}

function criteriaIds() {
  return new Set(criteriaDocs().map((c) => c.id));
}

function criteriaSlugs() {
  return new Set(criteriaDocs().map((c) => c.slug));
}

module.exports = { criteriaDocs, criteriaIds, criteriaSlugs, DOCS };
