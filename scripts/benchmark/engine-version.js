'use strict';

/*
 * Which ruler produced a number.
 *
 * Every organisation runs this engine by following a tag, and a tag moves. It
 * has moved three times, and the action carries the six pinned scanner versions
 * as well as the scoring code — so a score can change because the instrument
 * changed rather than because the code did. That has really happened: the
 * corrected complexity scanner moved six systems by about a point in one day.
 * A trend line with no way to mark those moments is misleading exactly where it
 * matters most.
 *
 * Two parts, and the second is the load-bearing one:
 *
 *   ref     what the caller ASKED for — `v1`, from the workflow. Readable, and
 *           worthless on its own, because `v1` meant three different things in
 *           August.
 *   digest  what actually RAN — a hash over the engine's own source and its
 *           action definition. Two commits behind the same tag produce
 *           different digests, which is the whole point.
 *
 * A committed VERSION file was the obvious alternative and was rejected: it
 * records what somebody remembered to bump, and the failure mode is silent
 * agreement between two things that have drifted. A digest cannot drift from
 * the thing it describes.
 *
 * WHAT IS HASHED: every file in the engine directory that can change a score —
 * the scan and scoring programs, the two Elixir AST helpers, and
 * scanner-pins.json, which is where the outside tool versions live. Tests are
 * excluded because they change no measurement, and including them would report
 * a new ruler every time somebody adds one.
 *
 * The pins were originally literals in action.yml, one directory up, and
 * hashing them there broke the rule that nothing in this directory may read
 * above itself — the rule that makes the engine extractable at all. The right
 * fix was to move the pins in, not to widen the hash: the boundary check says
 * plainly that a failure means "does this belong in a shared engine", and the
 * pins do.
 *
 * WHAT THIS CANNOT CAPTURE: three tools resolve their version at run time —
 * rubocop, jscpd and credo. Two runs of the same digest can therefore measure
 * Ruby complexity, duplication or Elixir complexity slightly differently. That
 * is recorded in scanner-pins.json under `floating`; the digest is honest about
 * the engine and the five pinned scanners and cannot speak for the rest.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE_DIR = __dirname;

// Sorted, so the digest does not depend on the order the filesystem hands them
// back. Content and path both go in: a renamed file is a different engine even
// when every byte is otherwise the same.
function sourceFiles() {
  return fs.readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.js') || f.endsWith('.exs') || f === 'scanner-pins.json')
    .filter((f) => !f.endsWith('.test.js'))
    .sort()
    .map((f) => path.join(SOURCE_DIR, f));
}

function digest() {
  const h = crypto.createHash('sha256');
  for (const file of sourceFiles()) {
    // Relative to the engine directory, so two organisations running the same
    // tag from different runner paths agree.
    h.update(path.relative(SOURCE_DIR, file));
    h.update('\0');
    h.update(fs.readFileSync(file));
    h.update('\0');
  }
  // Twelve hex characters. Long enough that a collision is not a practical
  // worry across the handful of engine versions that will ever exist, short
  // enough to sit in a log line or a chart annotation.
  return h.digest('hex').slice(0, 12);
}

// The ref is what the caller wrote after the @.
//
// WATCHTOWER_ENGINE_REF is exported by the action's locate step, and it has to
// come from there. GITHUB_ACTION_REF exists only inside the action's own steps,
// while the programs that record a version run as ordinary steps in the
// caller's workflow, where it is simply absent. Reading it directly made every
// CI run record itself as `local` — shipped, reviewed, and caught only by
// running a real scan and looking at what it wrote.
//
// GITHUB_ACTION_REF is still consulted for anything invoked inside the action.
//
// The three-way fallback is the point. `local` is honest on a laptop and FALSE
// in CI, so it is unreachable there; a CI run that somehow has no ref says
// `unknown`, which is true and visible. Quietly claiming to be a laptop run is
// the failure this removes.
function engineVersion() {
  const ref = process.env.WATCHTOWER_ENGINE_REF
    || process.env.GITHUB_ACTION_REF
    || (process.env.GITHUB_ACTIONS === 'true' ? 'unknown' : 'local');
  return `${ref}@${digest()}`;
}

module.exports = { engineVersion, digest, sourceFiles };
