'use strict';

/*
 * Check an engine before it goes public.
 *
 * WHY THIS EXISTS, precisely.
 *
 * The disclosure check can only live here: the list of words it looks for IS
 * the private data, so it cannot travel to the public repo with the thing it
 * checks. That was a deliberate and correct decision. Its consequence was not
 * noticed until 2026-08-20 — the check only ever inspects the engine when THIS
 * repo's CI happens to run. On 19 August our CI ran at 06:55 and passed; the
 * engine commit that put one of our system names and a colleague's name into a
 * public repo merged at 07:46, and the tag moved to it. Nothing looked at it
 * for a day.
 *
 * A gap of 51 minutes on that occasion. It could be weeks, because nothing
 * connects an engine change to this repo running its tests.
 *
 * So the check becomes a command that is run as part of changing the engine,
 * rather than a thing that happens to run later somewhere else.
 *
 *   node scripts/check-engine.js ~/path/to/watchtower          # a working copy
 *   node scripts/check-engine.js --ref v1                      # what is public
 *   node scripts/check-engine.js --ref cato/some-branch
 *
 * IT MUST NOT PASS WITHOUT CHECKING SOMETHING. The underlying test file skips
 * silently when no engine is supplied — sensible for a laptop test run, and
 * exactly wrong for a gate. A gate that skips is not a gate, and "0 failures"
 * from a run that inspected nothing is the most dangerous output there is. So
 * this refuses to report success unless the checks actually executed against
 * real files.
 */

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'https://github.com/mindvalley/watchtower.git';
const CHECKS = ['tests/engine-disclosure.test.js'];

function usage(msg) {
  if (msg) console.error(`${msg}\n`);
  console.error('usage: check-engine.js <engine-dir>');
  console.error('       check-engine.js --ref <tag-or-branch>');
  process.exit(2);
}

// Fetching the ref rather than trusting a local working copy is the stronger
// check: a clean local tree can still differ from what was actually pushed, and
// what is public is the only thing that matters here.
function fetchRef(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-check-'));
  console.log(`fetching ${ref} from the public engine...`);
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, REPO, dir], { stdio: 'inherit' });
  return dir;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage('nothing to check');

  let dir;
  let temp = false;
  if (args[0] === '--ref') {
    if (!args[1]) usage('--ref needs a tag or branch');
    dir = fetchRef(args[1]);
    temp = true;
  } else {
    dir = path.resolve(args[0]);
  }

  // The engine has to actually be there. Pointing this at a wrong or empty path
  // and getting a pass is the failure this whole file exists to prevent.
  const marker = path.join(dir, 'scripts', 'benchmark', 'scan-security.js');
  if (!fs.existsSync(marker)) {
    console.error(`no engine at ${dir} — expected scripts/benchmark/scan-security.js`);
    process.exit(2);
  }

  const res = spawnSync(process.execPath, ['--test', ...CHECKS], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, WATCHTOWER_ENGINE: dir, CI: '1' },
    encoding: 'utf8',
  });
  process.stdout.write(res.stdout || '');
  process.stderr.write(res.stderr || '');

  if (temp) fs.rmSync(dir, { recursive: true, force: true });

  // Belt and braces on the vacuity point. CI=1 above makes the test file's own
  // "the engine must be there to inspect" assertion run rather than skip, and
  // this reads the summary too, because a run that skipped everything also
  // reports zero failures.
  const passed = Number((res.stdout.match(/^# pass (\d+)$/m) || [])[1] || 0);
  const failed = Number((res.stdout.match(/^# fail (\d+)$/m) || [])[1] || 0);
  const skipped = Number((res.stdout.match(/^# skipped (\d+)$/m) || [])[1] || 0);

  if (res.status !== 0 || failed > 0) {
    console.error(`\nFAILED — do not publish this engine. ${failed} check(s) failed.`);
    process.exit(1);
  }
  if (passed === 0 || skipped > 0) {
    console.error(`\nINCONCLUSIVE — ${passed} passed, ${skipped} skipped. A gate that skips is not a gate.`);
    process.exit(1);
  }
  console.log(`\nOK — ${passed} checks ran against ${args[0] === '--ref' ? args[1] : dir}.`);
}

main();
