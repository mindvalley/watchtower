'use strict';

// ONE definition of what the C8 complexity scan does not look at.
//
// Why this module exists: the LOC walk (the denominator) and each linter runner
// (the numerator) used to keep their own hand-maintained exclusion lists, and they
// had drifted. The LOC walk skipped `vendor/`, `test/`, `priv/` and minified
// bundles; lizard excluded only `node_modules/dist/build/coverage` plus test-name
// globs; rubocop excluded nothing at all. The result was violations counted out of
// files whose lines were NOT in the denominator — in one Elixir umbrella 22 of 57
// violations came from vendored assets (`assets/vendor/js/calendar.js`, a
// fine-uploader bundle, `jquery.minicolors.js`) and a Playwright test file, and in
// another both violations came from a `calendar.min.js`. The density was arithmetic over two different populations,
// and the findings told those teams to refactor vendored jQuery.
//
// Every consumer now derives its exclusions from here:
//   countLocByExtension -> shouldSkipDir / shouldSkipFile
//   lizard              -> lizardExcludeArgs()
//   rubocop             -> rubocopExcludeGlobs()
//   credo               -> credoExcludedRegexes()
//   the Vue SFC walk    -> shouldSkipDir
//
// Adding an exclusion in one place therefore moves the numerator and the
// denominator together, by construction.

const path = require('path');

// Directory NAMES skipped anywhere in the tree. Vendored, generated, dependency
// and test trees: not the team's code to simplify, and (for tests) not code the
// complexity anchor is about.
const SKIP_DIR_NAMES = [
  '.git',
  '.elixir_ls',
  '__mocks__',
  '__pycache__',
  '_build',
  'build',
  'cassette_library',
  'coverage',
  'deps',
  'dist',
  'fixtures',
  'node_modules',
  'spec',
  'test',
  'tests',
  'vendor',
];

// Directory paths (repo-relative, POSIX separators) skipped only where they match.
//
// `priv/` as a whole is NOT skipped. Elixir projects keep real source there:
// Ecto migrations and PL/pgSQL functions live in `priv/repo/`, and the criterion
// page promises a repo's PL/pgSQL line count is reported as unmeasured with a
// line count. Skipping all of `priv/` made that promise false — no `.sql` entry
// could ever appear. Only the genuinely generated or fixture subtrees go.
//
// `priv/**/seed(s)/` generalises triage-config.json's `**/priv/data/seed/**`,
// which spec §3.5 names as part of this exclusion set: seed generators commonly
// live at `priv/repo/seeds/`, same category, different path. Seed scripts are
// development fixtures, not code an agent is asked to safely change.
// Matched anywhere in the tree, not only at the repo root: in an umbrella the
// paths read `apps/<app>/priv/repo/seeds`.
const SKIP_DIR_PATH_RES = [
  /(^|\/)priv\/static(\/|$)/,
  /(^|\/)priv\/gettext(\/|$)/,
  /(^|\/)priv\/(.*\/)?seeds?(\/|$)/,
];

// The same three, as path fragments for the linters' own glob/regex excludes.
// `**` stands in for the "any depth under priv" segment.
const SKIP_DIR_PATH_GLOBS = [
  'priv/static',
  'priv/gettext',
  'priv/seed',
  'priv/seeds',
  'priv/*/seed',
  'priv/*/seeds',
];

// Generated / non-source artefacts: minified bundles, source maps, and TypeScript
// declaration files (no executable branches).
const GENERATED_RE = /\.min\.(js|css)$|\.(js|css|mjs|cjs)\.map$|\.d\.ts$/;

// Test and fixture FILES identified by name rather than by directory, matching the
// shared allowlist convention in triage-config.json. Excluded from the LOC walk and
// from every runner alike — previously lizard dropped `*.test.*` / `*.spec.*`
// violations while the LOC walk still counted those files' lines.
const TEST_FILE_RE = /\.(test|spec)\.[a-z]+$/i;

// Non-code text formats: data, documentation, lockfiles and assets that carry no
// cyclomatic complexity. Mirrors the exclusion list runJscpd applies, so both scans
// treat the same files as non-code.
// `.pot` is the gettext TEMPLATE alongside `.po`, same category.
const NONCODE_EXTS = new Set(['.md', '.json', '.yaml', '.yml', '.lock', '.txt', '.csv', '.po', '.pot', '.svg']);

// relPath is the directory's path relative to the repo root, POSIX separators,
// e.g. 'apps/catalog/assets/vendor'.
function shouldSkipDir(name, relPath) {
  if (SKIP_DIR_NAMES.includes(name)) return true;
  const rel = String(relPath || '').split(path.sep).join('/').replace(/^\.\//, '');
  return SKIP_DIR_PATH_RES.some((re) => re.test(rel));
}

// Files excluded from both numerator and denominator for reasons other than being
// an unmapped language (generated artefacts and test files).
function shouldSkipFile(name) {
  return GENERATED_RE.test(name) || TEST_FILE_RE.test(name);
}

// lizard filters with fnmatch over the FULL pathname, so directory patterns need
// wildcards on both sides. Returns a flat argv fragment: ['-x', pat, '-x', pat, ...].
function lizardExcludePatterns() {
  const pats = [];
  for (const d of SKIP_DIR_NAMES) pats.push(`*/${d}/*`);
  for (const d of SKIP_DIR_PATH_GLOBS) pats.push(`*/${d}/*`);
  pats.push('*.min.js', '*.min.css', '*.js.map', '*.css.map', '*.mjs.map', '*.cjs.map', '*.d.ts');
  pats.push('*.test.*', '*.spec.*');
  return pats;
}

function lizardExcludeArgs() {
  return lizardExcludePatterns().flatMap((p) => ['-x', p]);
}

// Rubocop's AllCops.Exclude takes globs; with an absolute scan target the reliable
// form is a leading `**/`.
function rubocopExcludeGlobs() {
  const globs = [];
  for (const d of SKIP_DIR_NAMES) globs.push(`**/${d}/**/*`);
  for (const d of SKIP_DIR_PATH_GLOBS) globs.push(`**/${d}/**/*`);
  globs.push('**/*.min.js', '**/*_test.rb', '**/*_spec.rb');
  return globs;
}

// Credo's files.excluded takes Elixir regex sigils; emit the inner pattern text.
// The path globs carry a `*` segment, which in a regex would mean "zero or more
// slashes" rather than "one path segment" — translate it.
function credoExcludedRegexes() {
  const out = [];
  for (const d of SKIP_DIR_NAMES) out.push(`/${d}/`);
  for (const d of SKIP_DIR_PATH_GLOBS) out.push(`/${d.split('*').join('[^/]+')}/`);
  return out;
}

module.exports = {
  SKIP_DIR_NAMES,
  SKIP_DIR_PATH_RES,
  SKIP_DIR_PATH_GLOBS,
  GENERATED_RE,
  TEST_FILE_RE,
  NONCODE_EXTS,
  shouldSkipDir,
  shouldSkipFile,
  lizardExcludePatterns,
  lizardExcludeArgs,
  rubocopExcludeGlobs,
  credoExcludedRegexes,
};
