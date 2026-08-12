'use strict';

/*
 * What a single run actually measured.
 *
 * The config says which systems a watchtower is responsible for. That is not
 * the same set as the one a given run produced numbers for: a run can be
 * scoped to fewer, and a leg can fail. Publishing the config's list would
 * therefore post an older scan's numbers stamped with this run's date — a
 * board that looks freshly measured when nothing measured it.
 *
 * So the step that assembles scores records what it assembled, and the step
 * that publishes reads that. Neither infers it.
 *
 * The manifest lives with the raw reports rather than with the assembled
 * scores, because it describes this run and is thrown away with it. The scores
 * folder is the part a caller may well commit.
 */

const fs = require('fs');
const path = require('path');

const MANIFEST = 'assembled.json';

function manifestPath(reportsRoot) {
  return path.join(reportsRoot, MANIFEST);
}

function writeManifest(reportsRoot, systemKeys) {
  const keys = [...systemKeys].sort();
  fs.mkdirSync(reportsRoot, { recursive: true });
  fs.writeFileSync(manifestPath(reportsRoot), `${JSON.stringify({ systems: keys }, null, 2)}\n`);
  return keys;
}

// Absent is an error, not an empty list. "Nothing was assembled" and "the
// assemble step never ran" look identical to a caller that treats a missing
// file as zero systems, and the second one is a broken pipeline reporting
// success. The same distinction the scan edge has to make between finding
// nothing and running nothing.
function readManifest(reportsRoot) {
  const file = manifestPath(reportsRoot);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(
      `No run manifest at ${file}. It is written by the assemble step; ` +
      `if that did not run, there is nothing to publish. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The run manifest at ${file} is not valid JSON: ${err.message}`);
  }

  if (!parsed || !Array.isArray(parsed.systems)) {
    throw new Error(`The run manifest at ${file} has no "systems" array.`);
  }

  return parsed;
}

module.exports = { manifestPath, writeManifest, readManifest, MANIFEST };
