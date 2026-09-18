/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 868:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Findings a watchtower has already judged acceptable.
//
// Without this, every scan re-reports the same false positives — a public
// reCAPTCHA site key read as a secret, a CVE in a package that is only ever
// loaded in development — with no way to say so. Re-reporting a judgement that
// has already been made erodes trust in the whole report.
//
// An allowance REMOVES the finding from the score and keeps it visible in the
// report, marked, with the reason it was allowed. Nothing disappears: a page can
// always say "3 findings, 1 allowed". That is deliberate — a mechanism that
// deleted findings would be indistinguishable from a scan that never ran, which
// is the failure this engine guards against everywhere else.
//
// WHERE THE LIST LIVES is the caller's business, exactly like the list of systems
// to scan (see engine-config.js). Two shapes, one file format:
//
//   local   the engine repo is also the runner, so the file sits beside the
//           config in that same repo
//   remote  a private watchtower repo holds the file; the engine is pulled in as
//           a pinned action and holds nobody's allowances
//
// FILE FORMAT
//
//   { "allowances": [
//       { "criterion": "security", "sub": "secrets",
//         "system": "billing-api",
//         "file": "config/dev.exs", "rule": "generic-api-key",
//         "reason": "Public reCAPTCHA site key, not a secret",
//         "allowed_by": "a.engineer@example.com", "allowed_on": "2026-01-31T09:32:00.000Z" }
//   ] }
//
// An entry matches a finding when EVERY field it names is equal. Leave a field
// out and it broadens: drop `file` and the rule is allowed anywhere. That is the
// intended way to write a general allowance, and it is also the danger, so the
// run reports how many findings each entry absorbed and which absorbed none.
//
// Deliberately NOT supported, each for a reason:
//
//   globs          an allowance is an audit record; listing the files you mean
//                  is tedious and honest, where a pattern quietly widens over
//                  time. Add on evidence, not in advance.
//   duplication    C8's percentage comes from jscpd's own totals, not from the
//                  list of duplicated blocks, so filtering that list would not
//                  move the score — and subtracting each pair's lines
//                  double-counts a block cloned three times. Out until it can be
//                  done correctly.
//   absences       "no rollback configured" is not a false positive. Allowing it
//                  would be accepting a risk, which is a different feature.

const { relativize } = __nccwpck_require__(754);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches the output of new Date().toISOString(): YYYY-MM-DDTHH:mm:ss.sssZ
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// What may be matched on, per criterion and sub-metric. Keyed to the item shapes
// the parsers in parse-reports.js actually emit.
//
// This table exists so a typo fails loudly. Without it, `{ "fle": "x.ex" }`
// would simply never match, and an allowance that does nothing looks identical
// to a feature that is broken. If a parser gains a field and this table goes
// stale, the failure is a refused allowance — a finding stays counted, which is
// the safe direction.
const MATCHABLE = {
  'security:secrets': ['file', 'rule', 'line'],
  'security:deps': ['package', 'id', 'severity', 'installed', 'bucket', 'target'],
  'security:sast': ['id', 'path', 'severity'],
  'simplicity:complexity': ['file', 'scope', 'language'],
};

// Fields that describe the allowance rather than the finding it matches.
const META = new Set(['criterion', 'sub', 'system', 'reason', 'allowed_by', 'allowed_on', 'note']);

// Fields holding a path, which arrives from a scanner prefixed with the throwaway
// clone directory and has to be shortened on both sides before comparing.
const PATH_FIELDS = new Set(['file', 'path', 'target']);

// A Vue single-file component's script block is extracted to `<name>.vue.ts`
// before the complexity linter can read it, so that is the path the linter
// reports. Nobody writing an allowance knows or should care about the extraction
// tree — and the two places this matters would otherwise disagree, because the
// findings report maps the location back to the .vue file while the scorer does
// not. Collapsing the extension on both sides makes one allowance cover both.
const VUE_EXTRACTED = /\.vue\.(ts|js)$/;

function subjectKey(criterion, sub) {
  return `${criterion}:${sub}`;
}

function normalisePath(value) {
  return relativize(String(value)).replace(VUE_EXTRACTED, '.vue');
}

function normaliseValue(field, value) {
  return PATH_FIELDS.has(field) ? normalisePath(value) : String(value);
}

function describe(entry, index) {
  const where = entry && entry.criterion && entry.sub
    ? `${entry.criterion}/${entry.sub}`
    : 'unknown subject';
  return `allowance ${index + 1} (${where})`;
}

function normaliseEntry(entry, index, source) {
  const at = `${source}: ${describe(entry, index)}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${at} is not an object.`);
  }

  const key = subjectKey(entry.criterion, entry.sub);
  const matchable = MATCHABLE[key];
  if (!matchable) {
    throw new Error(
      `${at} names a criterion and sub-metric that cannot carry allowances. ` +
      `Allowances apply to: ${Object.keys(MATCHABLE).sort().join(', ')}.`,
    );
  }

  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    throw new Error(`${at} has no reason. An allowance without a reason is not an audit record.`);
  }

  const match = {};
  for (const [field, value] of Object.entries(entry)) {
    if (META.has(field)) continue;
    if (!matchable.includes(field)) {
      throw new Error(
        `${at} matches on '${field}', which is not part of a ${key} finding. ` +
        `Available: ${matchable.join(', ')}.`,
      );
    }
    if (value == null || value === '') {
      throw new Error(`${at} leaves '${field}' empty. Remove the field to broaden the allowance deliberately.`);
    }
    if (typeof value === 'object') {
      throw new Error(`${at} gives '${field}' an object. Allowance fields are single values.`);
    }
    match[field] = normaliseValue(field, value);
  }

  // An entry naming nothing matches every finding in its sub-metric. That is
  // never what someone means to write, and it would zero a whole facet behind
  // one line of JSON.
  if (Object.keys(match).length === 0) {
    throw new Error(
      `${at} names no fields, so it would allow every ${key} finding. ` +
      `Name at least one of: ${matchable.join(', ')}.`,
    );
  }

  if (entry.system != null && (typeof entry.system !== 'string' || entry.system === '')) {
    throw new Error(`${at} has an empty system. Remove it to apply the allowance to every system.`);
  }

  if (entry.allowed_by != null && !EMAIL_RE.test(entry.allowed_by)) {
    throw new Error(`${at} has 'allowed_by' "${entry.allowed_by}" which is not an email address.`);
  }

  if (entry.allowed_on != null && !ISO_TIMESTAMP_RE.test(entry.allowed_on)) {
    throw new Error(`${at} has 'allowed_on' "${entry.allowed_on}" which is not a JavaScript timestamp (expected YYYY-MM-DDTHH:mm:ss.sssZ).`);
  }

  return {
    key,
    criterion: entry.criterion,
    sub: entry.sub,
    system: entry.system == null ? null : entry.system,
    match,
    reason: entry.reason,
    allowed_by: entry.allowed_by == null ? null : entry.allowed_by,
    allowed_on: entry.allowed_on == null ? null : entry.allowed_on,
  };
}

// Accepts either { allowances: [...] } or a bare list. Missing is normal — most
// watchtowers allow nothing, and an empty list must behave exactly as no file at
// all so that shipping this mechanism cannot move a single score.
function parseAllowances(raw, { source = 'allowances' } = {}) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : raw.allowances;
  if (list == null) return [];
  if (!Array.isArray(list)) {
    throw new Error(`${source}: "allowances" must be a list.`);
  }
  return list.map((entry, i) => normaliseEntry(entry, i, source));
}

function itemMatches(allowance, item) {
  for (const [field, want] of Object.entries(allowance.match)) {
    const got = item ? item[field] : undefined;
    if (got == null) return false;
    if (normaliseValue(field, got) !== want) return false;
  }
  return true;
}

// One of these per system, because the tallies are per system and because an
// allowance may be scoped to a single system.
//
// `matcherFor` returns null when nothing is allowed for that sub-metric. Callers
// treat null as "no allowances", which keeps the untouched path free of any
// wrapper — the reason an empty list is provably identical to today.
function createAllowanceSet(allowances, systemKey) {
  const scoped = allowances.filter((a) => a.system == null || a.system === systemKey);
  const matched = new Map(scoped.map((a) => [a, 0]));

  function matcherFor(criterion, sub) {
    const key = subjectKey(criterion, sub);
    const relevant = scoped.filter((a) => a.key === key);
    if (relevant.length === 0) return null;
    return (item) => {
      for (const a of relevant) {
        if (itemMatches(a, item)) {
          matched.set(a, matched.get(a) + 1);
          return a;
        }
      }
      return null;
    };
  }

  // Every allowance in scope with the number of findings it absorbed on this
  // run. Two readings matter and both need the whole list, not just the hits:
  // an entry whose count climbs is quietly swallowing new problems, and an entry
  // at zero is either fixed — delete it — or never matched anything and was
  // wrong when it was written.
  function summary() {
    return [...matched.entries()].map(([a, count]) => ({
      criterion: a.criterion,
      sub: a.sub,
      system: a.system,
      match: a.match,
      reason: a.reason,
      allowed_by: a.allowed_by,
      allowed_on: a.allowed_on,
      matched: count,
    }));
  }

  function unmatched() {
    return summary().filter((a) => a.matched === 0);
  }

  return { matcherFor, summary, unmatched };
}

module.exports = {
  MATCHABLE, parseAllowances, createAllowanceSet, subjectKey,
};


/***/ }),

/***/ 880:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// scripts/benchmark/engine-config.js
//
// The engine's only link to whoever is running it.
//
// Before this file existed, every scan program worked out two locations by
// counting directories upwards from itself — the list of systems to scan, and
// the folder to write results into. That silently tied the engine to one repo's
// layout: move the directory and nothing starts. Two programs did the read at
// import time, so even loading them failed.
//
// Both locations are now passed in. Nothing is discovered by walking upwards.
//
//   WATCHTOWER_CONFIG   path to the file listing the systems to scan
//                       (default: ./watchtower.config.json, so a standalone
//                       copy works from a project root with no setup)
//   WATCHTOWER_REPORTS  folder to write raw scan output into
//                       (default: ./reports)
//   WATCHTOWER_DATA     folder holding the assembled scores, which the publish
//                       step reads back to send to a dashboard
//                       (default: ./data)
//   WATCHTOWER_ALLOWANCES
//                       path to the file listing findings already judged
//                       acceptable (default: ./watchtower.allowances.json).
//                       Unlike the others, ABSENCE IS NORMAL — most watchtowers
//                       allow nothing, and no file behaves exactly like an empty
//                       list. See allowances.js.
//
// The list itself stays private and is never part of the engine: it names real
// repositories, which is the caller's business, not the tool's. The same is true
// of the allowances: the engine carries the mechanism, never anyone's judgements.
//
// Everything here fails loudly. A scan that cannot find its list must stop, not
// carry on with nothing to scan — an empty run reports no problems, which reads
// exactly like a clean result.



const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const { parseAllowances } = __nccwpck_require__(868);

const DEFAULT_CONFIG = 'watchtower.config.json';
const DEFAULT_REPORTS = 'reports';
const DEFAULT_DATA = 'data';
const DEFAULT_ALLOWANCES = 'watchtower.allowances.json';

function configPath() {
  return path.resolve(process.env.WATCHTOWER_CONFIG || DEFAULT_CONFIG);
}

function allowancesPath() {
  return path.resolve(process.env.WATCHTOWER_ALLOWANCES || DEFAULT_ALLOWANCES);
}

function reportsRoot() {
  return path.resolve(process.env.WATCHTOWER_REPORTS || DEFAULT_REPORTS);
}

function dataDir() {
  return path.resolve(process.env.WATCHTOWER_DATA || DEFAULT_DATA);
}

// Read lazily, never at import time. Importing a scan program should not
// require the caller's configuration to exist — that is what made three test
// files fail to load rather than fail an assertion.
function loadConfig() {
  const file = configPath();

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read the watchtower config at ${file}. ` +
      `Set WATCHTOWER_CONFIG to the file listing the systems to scan. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The watchtower config at ${file} is not valid JSON: ${err.message}`);
  }

  const systems = parsed && parsed.systems;
  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) {
    throw new Error(`The watchtower config at ${file} has no "systems" object.`);
  }
  // An empty list is refused rather than treated as "nothing to do". A caller
  // who meant to scan nothing does not run a scanner.
  if (Object.keys(systems).length === 0) {
    throw new Error(`The watchtower config at ${file} lists no systems.`);
  }

  return parsed;
}

// The allowances file, parsed and validated. Read lazily for the same reason as
// the config.
//
// Absence is handled asymmetrically on purpose:
//
//   no WATCHTOWER_ALLOWANCES set, default file not there
//       -> [] . Allowing nothing is the ordinary state of a watchtower, and this
//          is the case that makes shipping the mechanism provably score-neutral.
//   WATCHTOWER_ALLOWANCES set, file not there
//       -> throw. The caller said where the list is; if it is not there, a typo
//          in the path would otherwise swallow every allowance in silence and
//          look exactly like a list that legitimately matches nothing.
function loadAllowances() {
  const file = allowancesPath();
  const explicit = Boolean(process.env.WATCHTOWER_ALLOWANCES);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && !explicit) return [];
    throw new Error(
      `Cannot read the allowances file at ${file}. ` +
      `WATCHTOWER_ALLOWANCES points here, so an unreadable file is an error, not an empty list. (${err.code})`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`The allowances file at ${file} is not valid JSON: ${err.message}`);
  }

  return parseAllowances(parsed, { source: file });
}

// Credentials are supplied through the environment, never through this file.
// The config is the one thing that gets committed to a repository.
const CREDENTIAL_LOOKING = /^(token|password|secret|key|private_key|credential)$/i;

function systemConfig(systemKey) {
  if (!systemKey) {
    throw new Error('No system named. Set SYSTEM to a key from the watchtower config.');
  }

  const { systems } = loadConfig();
  const cfg = systems[systemKey];
  if (!cfg) {
    const known = Object.keys(systems).sort().join(', ');
    throw new Error(`Unknown system '${systemKey}'. The config lists: ${known}`);
  }

  const leaked = Object.keys(cfg).filter((k) => CREDENTIAL_LOOKING.test(k));
  if (leaked.length > 0) {
    throw new Error(
      `System '${systemKey}' has ${leaked.join(', ')} in the watchtower config. ` +
      'Credentials belong in the environment, not in a committed file.',
    );
  }

  return cfg;
}

// Results for one system. Created on demand so a caller does not have to
// prepare the tree.
function reportsDir(systemKey) {
  const dir = path.join(reportsRoot(), systemKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// What one system's code IS: a GitHub repository, or a folder on this machine.
//
// Here rather than in each scan program because a relative path is resolved
// against the directory holding the config, and this is the only file that
// knows where that is. Every scan program asking the same question has to get
// the same answer — the alternative is seven of them each deciding for
// themselves what a relative path is relative to.
function systemTarget(systemKey) {
  const { targetOf } = __nccwpck_require__(639);
  return targetOf(systemConfig(systemKey), systemKey, path.dirname(configPath()));
}

module.exports = {
  configPath, reportsRoot, dataDir, allowancesPath,
  loadConfig, loadAllowances, systemConfig, reportsDir, systemTarget,
};


/***/ }),

/***/ 874:
/***/ ((module) => {



// Pure normalization: each scanner's raw JSON → severity counts.
// Inputs come from scan-security.js (the I/O edge); these functions never throw
// so a malformed or missing report degrades to zeros rather than failing a run.

const ZERO = () => ({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });

// Minimal glob → RegExp for path allowlisting. Supports `**/` (any leading
// dirs, incl. none), `**` (any chars), and `*` (any chars except `/`).
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function pathMatchesAny(file, patterns) {
  if (!file) return false;
  return patterns.some((p) => globToRegExp(p).test(file));
}

// `allow` is the watchtower's list of findings already judged acceptable (see
// allowances.js). It is applied HERE, inside the counting loop, rather than by
// filtering the item list afterwards — because several of these parsers derive
// their counts as they go, and a separate recount is a second place for the
// count and the list to disagree. An allowed finding is never counted and is
// kept in `allowed_items` so the report can still show it.
//
// `allow` is null when nothing is allowed for that sub-metric, which is the
// ordinary case and leaves the loop exactly as it was.
function checkAllowed(allow, item) {
  return allow ? allow(item) : null;
}

// Gitleaks findings in test/mock/seed/cassette paths are ~99% false positives
// (fixtures, VCR recordings, seed data); `excludePaths` removes them. Of what
// remains, low-precision rules (`reviewRules`, e.g. generic-api-key) match
// public IDs / GA tags / UUIDs as often as real secrets, so they go to a REVIEW
// bucket that is surfaced but does NOT hard-cap; high-precision rules (private
// keys, provider tokens) are CONFIRMED and drive the hard-cap. `secrets` is the
// confirmed count. All buckets are preserved for the audit trail.
function parseGitleaks(report, { excludePaths = [], reviewRules = [], allow = null } = {}) {
  const findings = Array.isArray(report) ? report : [];
  const reviewSet = new Set(reviewRules);
  const confirmed = [];
  const review = [];
  const allowed = [];
  let excludedByPath = 0;
  for (const f of findings) {
    if (pathMatchesAny(f?.File, excludePaths)) { excludedByPath += 1; continue; }
    const item = { description: f?.Description, file: f?.File, rule: f?.RuleID, line: f?.StartLine != null ? f.StartLine : null };
    // Allowed before bucketing: a review-bucket match is still re-reported every
    // scan, and being able to settle those is most of why this exists.
    const a = checkAllowed(allow, item);
    if (a) { allowed.push({ ...item, allowed_reason: a.reason }); continue; }
    (reviewSet.has(f?.RuleID) ? review : confirmed).push(item);
  }
  return {
    secrets: confirmed.length,
    raw_secrets: findings.length,
    triaged_secrets: confirmed.length + review.length,
    confirmed_secrets: confirmed.length,
    review_secrets: review.length,
    excluded_by_path: excludedByPath,
    allowed: allowed.length,
    items: confirmed,
    review_items: review,
    allowed_items: allowed,
  };
}

const TRIVY_BAND = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

function bump(counts, band) {
  counts[band] += 1;
  counts.total += 1;
}

// Extract DIRECT dependencies, split prod vs dev, so trivy CVEs can be scored by
// attributable environment. Hex: a dep is dev when it declares `only:` restricted
// to :dev/:test (a list including :prod, or no `only:`, is prod). npm:
// `dependencies` are prod, `devDependencies` are dev. Transitive deps appear in
// neither set and are treated as unattributable (informational, not scored).
function extractDeps({ mixExs = null, packageJsons = [] } = {}) {
  const prod = new Set();
  const dev = new Set();

  if (typeof mixExs === 'string') {
    const depRe = /\{:([a-z_][a-z0-9_]*)\s*,([^}]*)\}/g;
    let m;
    while ((m = depRe.exec(mixExs)) !== null) {
      const [, name, opts] = m;
      const only = opts.match(/only:\s*(:\w+|\[[^\]]*\])/);
      const envs = only ? (only[1].match(/:\w+/g) || []).map((e) => e.slice(1)) : [];
      const devOnly = envs.length > 0 && envs.every((e) => e === 'dev' || e === 'test');
      (devOnly ? dev : prod).add(name);
    }
  }

  for (const pkg of packageJsons || []) {
    for (const name of Object.keys((pkg && pkg.dependencies) || {})) prod.add(name);
    for (const name of Object.keys((pkg && pkg.devDependencies) || {})) dev.add(name);
  }

  return { prod: [...prod], dev: [...dev] };
}

// Classify each CVE by its package's DIRECT-dependency environment. A finding
// whose PkgName is a direct dev dep is `dev` (discounted downstream); a direct
// prod dep is `prod` (scored); everything else — transitive deps and findings
// with no PkgName — is `transitive` (informational, NOT scored: we can't action
// a transitive CVE without its direct parent). `raw` is the untriaged tally.
function parseTrivy(report, { prodDeps = [], devDeps = [], allow = null } = {}) {
  const raw = ZERO(); const prod = ZERO(); const dev = ZERO(); const transitive = ZERO();
  const prodSet = new Set(prodDeps); const devSet = new Set(devDeps);
  const items = [];
  const allowed = [];
  const results = report && Array.isArray(report.Results) ? report.Results : [];
  for (const res of results) {
    const vulns = Array.isArray(res.Vulnerabilities) ? res.Vulnerabilities : [];
    for (const v of vulns) {
      const band = TRIVY_BAND[v.Severity];
      if (!band) continue;
      let bucket;
      if (v.PkgName && devSet.has(v.PkgName)) bucket = 'dev';
      else if (v.PkgName && prodSet.has(v.PkgName)) bucket = 'prod';
      else bucket = 'transitive';
      const item = {
        package: v.PkgName || null, id: v.VulnerabilityID || null, severity: band,
        installed: v.InstalledVersion || null, fixed: v.FixedVersion || null,
        target: res.Target || null, bucket,
      };
      // `bucket` is decided before the allowance check so an allowance can name
      // it ("all transitive CVEs in this package"), and the raw count is bumped
      // only for what remains — `raw` is the pre-triage total, and an allowed
      // finding has been triaged by a person.
      const a = checkAllowed(allow, item);
      if (a) { allowed.push({ ...item, allowed_reason: a.reason }); continue; }
      bump(raw, band);
      if (bucket === 'dev') bump(dev, band);
      else if (bucket === 'prod') bump(prod, band);
      else bump(transitive, band);
      items.push(item);
    }
  }
  return { raw, prod, dev, transitive, items, allowed: allowed.length, allowed_items: allowed };
}

const SEMGREP_BAND = { ERROR: 'high', WARNING: 'medium', INFO: 'low' };
const BRAKEMAN_BAND = { High: 'high', Medium: 'medium', Weak: 'low' };

// Semgrep severity token for a result (metadata CRITICAL wins over extra.severity).
function semgrepToken(r) {
  const extra = r.extra || {};
  if (extra.metadata && extra.metadata.severity === 'CRITICAL') return 'CRITICAL';
  return extra.severity;
}

function tokenBand(token) {
  return token === 'CRITICAL' ? 'critical' : SEMGREP_BAND[token];
}

// Resolve a remap for a semgrep result. `--config auto` emits ids shaped like
// `<path>.<leaf>.<leaf>`, so the config is keyed by leaf; we also honour an
// exact check_id match. Returns the override token or undefined.
function remapToken(checkId, severityRemap) {
  if (!checkId) return undefined;
  if (Object.prototype.hasOwnProperty.call(severityRemap, checkId)) return severityRemap[checkId];
  const leaf = checkId.split('.').pop();
  if (Object.prototype.hasOwnProperty.call(severityRemap, leaf)) return severityRemap[leaf];
  return undefined;
}

// Triage semgrep two ways before banding: (1) drop findings under excluded paths
// (same test/fixture noise gitleaks filters — semgrep scans the whole tree), and
// (2) demote noisy rules via `severityRemap` (e.g. the github-actions hardening
// rules that dominate raw HIGH). `raw` keeps everything; `triaged` reflects both
// filters; excluded_by_path + remapped are surfaced for the audit trail.
function parseSemgrep(report, { severityRemap = {}, excludePaths = [], allow = null } = {}) {
  const raw = ZERO(); const triaged = ZERO();
  let remapped = 0; let excludedByPath = 0;
  const items = [];
  const allowed = [];
  const results = report && Array.isArray(report.results) ? report.results : [];
  for (const r of results) {
    const token = semgrepToken(r);
    const rawBand = tokenBand(token);
    const line = (r.start && r.start.line) || null;
    const base = { id: r.check_id || null, path: r.path || null, line, severity: rawBand || null };
    // Checked before the raw bump, so an allowed finding is absent from the
    // audit trail's raw count too. `line` travels on the item for the report but
    // is never matchable — allowances.js refuses it.
    const a = checkAllowed(allow, base);
    if (a) {
      allowed.push({ ...base, disposition: 'allowed', allowed_reason: a.reason });
      continue;
    }
    if (rawBand) bump(raw, rawBand);
    if (pathMatchesAny(r.path, excludePaths)) {
      excludedByPath += 1;
      items.push({ ...base, disposition: 'excluded' });
      continue;
    }
    const override = remapToken(r.check_id, severityRemap);
    let disposition = 'triaged';
    if (override !== undefined) { remapped += 1; disposition = 'remapped'; }
    const triagedBand = tokenBand(override !== undefined ? override : token);
    if (triagedBand) bump(triaged, triagedBand);
    items.push({ ...base, severity: triagedBand || rawBand || null, disposition });
  }
  return {
    raw, triaged, remapped, excluded_by_path: excludedByPath, items,
    allowed: allowed.length, allowed_items: allowed,
  };
}

function parseBrakeman(report) {
  const counts = ZERO();
  const warnings = report && Array.isArray(report.warnings) ? report.warnings : [];
  for (const w of warnings) {
    const band = BRAKEMAN_BAND[w.confidence];
    if (!band) continue;
    counts[band] += 1;
    counts.total += 1;
  }
  return counts;
}

function parseSobelow(report) {
  const counts = ZERO();
  const f = (report && report.findings) || {};
  counts.high = (f.high_confidence || []).length;
  counts.medium = (f.medium_confidence || []).length;
  counts.low = (f.low_confidence || []).length;
  counts.total = counts.high + counts.medium + counts.low;
  return counts;
}

// All SAST tools return a uniform { raw, triaged, remapped } so the scorer reads
// `.triaged` regardless of tool. Only semgrep applies a remap today; brakeman
// and sobelow pass through (raw === triaged).
function passthrough(c) {
  return {
    raw: c, triaged: { ...c }, remapped: 0, excluded_by_path: 0, items: [],
    allowed: 0, allowed_items: [],
  };
}

function parseSast(report, tool, opts = {}) {
  if (tool === 'semgrep') return parseSemgrep(report, opts);
  // brakeman and sobelow produce counts with no per-finding list, so there is
  // nothing for an allowance to match against. All eleven systems run semgrep
  // today, so this is unreachable — but silently ignoring the caller's
  // allowances would leave findings counted with no sign the entries did
  // nothing, which is the shape of every quiet failure in this engine's history.
  if (opts.allow) {
    throw new Error(
      `SAST allowances were supplied for a system scanned with '${tool}', which reports counts only. ` +
      'Individual findings can only be allowed on semgrep output.',
    );
  }
  if (tool === 'brakeman') return passthrough(parseBrakeman(report));
  if (tool === 'sobelow') return passthrough(parseSobelow(report));
  return passthrough(ZERO());
}

// ---- C8 Codebase Simplicity parsers -------------------------------------
// Complexity: count functions that VIOLATE the McCabe <= 10 anchor. Each stack
// has its own linter with a different raw JSON shape, so there is one parser per
// tool, all normalizing to { tool, violations, items:[{scope,file,cc}] }. LOC is
// supplied separately by the scan edge (a filesystem walk, not pure) so the
// scorer can compute a size-normalized density.

// Credo `mix credo --format json`: { issues: [{ check, message, filename,
// line_no, scope, ... }] }. CyclomaticComplexity messages read
// "...(cyclomatic complexity is 13, max is 10)."
function parseCredo(report, { allow = null } = {}) {
  const issues = (report && Array.isArray(report.issues)) ? report.issues : [];
  const items = [];
  const allowed = [];
  for (const i of issues) {
    if (!i || !/CyclomaticComplexity/.test(i.check || '')) continue;
    const m = /complexity is (\d+)/.exec(i.message || '');
    const item = { scope: i.scope || null, file: i.filename || null, line: i.line_no != null ? i.line_no : null, cc: m ? Number(m[1]) : null };
    const a = checkAllowed(allow, item);
    if (a) { allowed.push({ ...item, allowed_reason: a.reason }); continue; }
    items.push(item);
  }
  return { tool: 'credo', violations: items.length, items, allowed: allowed.length, allowed_items: allowed };
}

// Rubocop `rubocop --format json`: { files: [{ path, offenses: [{ cop_name,
// message, location:{ line } }] }], summary }. CyclomaticComplexity messages
// read "Cyclomatic complexity for method is too high. [12/10]".
function parseRubocop(report, { allow = null } = {}) {
  const files = (report && Array.isArray(report.files)) ? report.files : [];
  const items = [];
  const allowed = [];
  for (const f of files) {
    const offenses = (f && Array.isArray(f.offenses)) ? f.offenses : [];
    for (const o of offenses) {
      if (!o || o.cop_name !== 'Metrics/CyclomaticComplexity') continue;
      const m = /\[(\d+)\/\d+\]/.exec(o.message || '');
      const locLine = o.location && (o.location.start_line != null ? o.location.start_line : o.location.line != null ? o.location.line : null);
      const item = {
        scope: locLine != null ? `line ${locLine}` : null,
        file: f.path || null,
        line: locLine,
        cc: m ? Number(m[1]) : null,
      };
      const a = checkAllowed(allow, item);
      if (a) { allowed.push({ ...item, allowed_reason: a.reason }); continue; }
      items.push(item);
    }
  }
  return { tool: 'rubocop', violations: items.length, items, allowed: allowed.length, allowed_items: allowed };
}

// jscpd `--reporters json`: { statistics: { total: { percentage,
// duplicatedLines, lines, clones } } }. Elixir is tokenized via the ruby
// tokenizer (formats-exts ex,exs -> ruby) at the scan edge — jscpd has no native
// Elixir tokenizer; the ruby lexer handles do/end block structure well enough for
// copy-paste detection. Approximate for Elixir; documented in criteria-docs.
function parseDuplication(report) {
  const total = (report && report.statistics && report.statistics.total) || {};
  const dups = (report && Array.isArray(report.duplicates)) ? report.duplicates : [];
  const clone_items = dups.map((d) => ({
    fileA: (d.firstFile && d.firstFile.name) || null,
    fileB: (d.secondFile && d.secondFile.name) || null,
    lines: d.lines != null ? d.lines : null,
  }));
  return {
    percentage: Math.round((total.percentage || 0) * 10) / 10,
    duplicated_lines: total.duplicatedLines || 0,
    total_lines: total.lines || 0,
    clones: total.clones || 0,
    clone_items,
  };
}

// ---- C8 JS/TS complexity (lizard) ---------------------------------------
// lizard `--csv` has NO header row; fields may be double-quoted and contain
// commas (function long names like "f ( a , b )", and paths). Column layout
// (lizard 1.23): 0 NLOC, 1 CCN, 2 token, 3 params, 4 length, 5 location,
// 6 file, 7 name, 8 long-name, 9 start-line, 10 end-line.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else { inQuotes = false; }
      } else { cur += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
}

// Count functions whose cyclomatic complexity (CCN) exceeds the anchor (10).
// Mirrors parseCredo/parseRubocop shape. Tolerant: malformed/empty -> zeros
// (the scan edge throws on a truly failed lizard run, so a clean-looking empty
// here can only mean genuinely no violations, not a broken scan).
function parseLizard(report, { threshold = 10, allow = null } = {}) {
  const text = (report && typeof report.text === 'string') ? report.text : '';
  const items = [];
  const allowed = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 8) continue;
    const cc = Number(cols[1]);
    if (!Number.isFinite(cc) || cc <= threshold) continue;
    const item = { scope: cols[7] || null, file: cols[6] || null, line: cols[9] ? Number(cols[9]) : null, cc };
    const a = checkAllowed(allow, item);
    if (a) { allowed.push({ ...item, allowed_reason: a.reason }); continue; }
    items.push(item);
  }
  return { tool: 'lizard', violations: items.length, items, allowed: allowed.length, allowed_items: allowed };
}

// Single source of truth for tool -> complexity parser. Fail loud on an unknown
// tool rather than defaulting to any parser (the false-green trap this fix closes).
function complexityParser(tool) {
  const map = Object.assign(Object.create(null), { credo: parseCredo, rubocop: parseRubocop, lizard: parseLizard });
  const parser = map[tool];
  if (!parser) throw new Error(`C8: no parser for complexity tool '${tool}'`);
  return parser;
}

// A linter driven through `mix` (Credo) auto-compiles its deps on first task run,
// prepending chatter ("==> file_system", "Compiling N files (.ex)", "Generated
// credo app") to stdout around the JSON. `--format json` emits a single top-level
// value; slice from the first opening bracket to the last matching closing one so
// JSON.parse sees only the payload. No bracket at all = a crash / empty output,
// not a clean scan — throw so a broken leg can't parse to an empty "green" report
// (the C9 false-green rule). Pairs with a pre-compile at the scan edge, which keeps
// brace-bearing compile warnings out of the captured Credo call in the first place.
function extractLinterJson(stdout) {
  const s = String(stdout == null ? '' : stdout);
  const objAt = s.indexOf('{');
  const arrAt = s.indexOf('[');
  let start = -1;
  let close = '}';
  if (objAt !== -1 && (arrAt === -1 || objAt < arrAt)) { start = objAt; close = '}'; }
  else if (arrAt !== -1) { start = arrAt; close = ']'; }
  const end = s.lastIndexOf(close);
  if (start === -1 || end < start) {
    throw new Error(`no JSON payload in linter output: ${s.slice(0, 200)}`);
  }
  return s.slice(start, end + 1);
}

module.exports = {
  parseGitleaks, parseTrivy, parseSast, extractDeps,
  parseCredo, parseRubocop, parseDuplication, parseLizard, complexityParser, extractLinterJson,
};


/***/ }),

/***/ 754:
/***/ ((module) => {



// Turning a scanner's path back into a repo-relative one.
//
// Third-party scanners (gitleaks/trivy/semgrep/credo/rubocop/jscpd) report paths
// absolute to the per-run clone dir — <tmp>/scan-<sys>-<rand>/repo/ or
// <tmp>/scan-c8-<sys>-<rand>/repo/. That random suffix would render as garbage in
// the UI and, worse, make findings-*.json churn on every scan (defeating the
// data-PR change gate). Our own walkers (C4/C6/C7) already emit relative paths,
// which don't match and pass through untouched.
//
// This lives in its own file because two callers need the SAME definition: the
// findings report, which shortens paths on the way out, and the allowances
// matcher, which has to shorten them on the way IN — a person writing an
// allowance knows `config/dev.exs`, never `/tmp/scan-billing-api-a1b2c3/repo/
// config/dev.exs`. Two copies of this rule drifting apart would make allowances
// silently match nothing, which reads exactly like a feature that was never
// wired up.

const CLONE_ROOT = /^.*?\/scan-[^/]*\/repo\//;

function relativize(s) {
  if (typeof s !== 'string') return s;
  return s.replace(CLONE_ROOT, '');
}

function relativizePaths(node) {
  if (Array.isArray(node)) return node.map(relativizePaths);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = relativizePaths(v);
    return out;
  }
  return relativize(node);
}

module.exports = { relativize, relativizePaths };


/***/ }),

/***/ 345:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



/*
 * Security scan — I/O entrypoint (the black-box edge). NOT unit-tested; the
 * testable logic is in scripts/benchmark/*. Clones ONE repo (shallow) and runs
 * the three scanners to reports/<system>/{gitleaks,trivy,<sast_tool>}.json.
 *
 * None of these scanners compile the target app — they read the working tree and
 * lockfiles only, so this runs headless on any clone (sidesteps the Credo/Sobelow
 * private-dep compile barrier; see reference-credo-runner).
 *
 * Env:
 *   SYSTEM    system key (must exist in the watchtower config)
 *   GH_TOKEN  token with read on the target repo (clone auth). Not needed when
 *             the system declares a local path instead of a repo.
 */

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const { execFileSync } = __nccwpck_require__(317);
const { extractDeps } = __nccwpck_require__(874);

const { reportsDir, systemTarget } = __nccwpck_require__(880);
const { materialise } = __nccwpck_require__(639);
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

// Collect dependency manifests from the clone so CVEs can be split prod/dev.
// Bounded walk that skips vendored/build trees (never contain first-party deps).
const SKIP_DIRS = new Set(['node_modules', 'deps', '_build', '.git', '.elixir_ls', 'priv']);

function collectManifests(rootDir) {
  const mixParts = [];
  const packageJsons = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else if (e.name === 'mix.exs') {
        try { mixParts.push(fs.readFileSync(path.join(dir, e.name), 'utf8')); } catch { /* skip */ }
      } else if (e.name === 'package.json') {
        try { packageJsons.push(JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8'))); } catch { /* skip */ }
      }
    }
  };
  walk(rootDir, 0);
  return { mixExs: mixParts.join('\n'), packageJsons };
}

// Run a scanner that writes its own JSON file; tolerate non-zero exit (these
// tools exit non-zero when they FIND issues — that is a successful scan).
// All three C9 scanners write their own report file. A scanner that exits
// non-zero BECAUSE IT FOUND SOMETHING still writes it — that is the case this
// swallows, and it must keep swallowing it.
//
// A scanner that failed to RUN writes nothing, and the previous version then
// fabricated `{}` — which every downstream parser reads as "no findings", i.e. a
// clean security score for a scan that never happened. Reachable in CI without
// anyone touching the code: semgrep's `--config auto` and trivy's DB download
// both need the network. This exact vector was caught once already, as a
// fabricated trivy report on the local-scan path (2026-07-27); the data was
// corrected then but this helper, the actual cause, was not.
//
// A missing report now throws. Failing the scan is always better than scoring a
// system green for secrets and CVEs it was never checked for.
function runToFile(cmd, args, outFile) {
  let runError;
  try { sh(cmd, args); } catch (e) { runError = e; }
  if (!fs.existsSync(outFile)) {
    throw new Error(
      `${cmd} produced no report at ${outFile} — refusing to write an empty one. `
      + `A scanner that fails must fail the scan, not score the system clean.`
      + (runError ? ` Underlying error: ${runError.message}` : ''),
    );
  }
}

function main() {
  const tree = materialise(systemTarget(SYSTEM), { prefix: SYSTEM, token: GH_TOKEN });
  const outDir = reportsDir(SYSTEM);

  // The tree was previously left behind on every run of this program — and it
  // holds a .git/config with the token in plaintext. Harmless on a runner that
  // is destroyed afterwards; not harmless on the laptop this now also serves.
  try {
    for (const note of tree.notes) console.log(`  ${note}`);
    const repoDir = tree.dir;

    // Dependency manifests → direct prod/dev dep lists, so trivy CVEs can be scored
    // by attributable environment at parse time (prod scored, dev discounted,
    // transitive shown for info).
    const directDeps = extractDeps(collectManifests(repoDir));
    writeJson(outDir, 'direct-deps', directDeps);

    // Secrets — gitleaks over the working tree (no git history needed with --no-git).
    runToFile('gitleaks', ['detect', '--source', repoDir, '--no-git', '--report-format', 'json', '--report-path', path.join(outDir, 'gitleaks.json'), '--exit-code', '0'], path.join(outDir, 'gitleaks.json'));

    // Dependency CVEs — trivy fs, vuln scanner only (reads mix.lock/Gemfile.lock/package-lock.json).
    runToFile('trivy', ['fs', '--scanners', 'vuln', '--format', 'json', '--output', path.join(outDir, 'trivy.json'), repoDir], path.join(outDir, 'trivy.json'));

    // SAST — semgrep --config auto over source (no compile; multi-language incl. Elixir/Ruby/JS/Vue).
    runToFile('semgrep', ['--config', 'auto', '--json', '--output', path.join(outDir, 'semgrep.json'), repoDir], path.join(outDir, 'semgrep.json'));

    console.log(`Scanned ${SYSTEM} (${tree.label}) -> ${outDir}`);
  } finally {
    tree.cleanup();
  }
}

if (require.main === require.cache[eval('__filename')]) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

// runToFile is exported for its no-false-green guard, which is worth a test even
// though the rest of this edge is validated by running it.
module.exports = { main, runToFile };


/***/ }),

/***/ 639:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



/*
 * Where a scan's working tree comes from.
 *
 * Every scan program used to do the same two lines: make a temp directory,
 * shallow-clone `cfg.repo` into `<tmp>/repo`. That is the only thing a target
 * could be, so running the scanner on a laptop scored whatever was on the
 * remote's default branch rather than the code in front of you — the check you
 * wanted to run before opening the pull request measured the branch you were
 * about to change.
 *
 * A system now declares `repo` OR `path`. Exactly one.
 *
 *   "billing": { "repo": "org/billing",   "stack": "elixir" }
 *   "billing": { "path": "code/billing",  "stack": "elixir" }
 *
 * A relative `path` is resolved against the DIRECTORY HOLDING THE CONFIG, not
 * the working directory. The config sits beside the projects it describes, and
 * resolving against the shell's cwd would make the same config mean different
 * things depending on where you happened to run it from. Nothing in this engine
 * is discovered by walking upwards, and this keeps it that way.
 *
 * A LOCAL TARGET IS COPIED, NOT SCANNED IN PLACE, and there are three separate
 * reasons — any one of them enough:
 *
 *   1. The scan writes into the tree it is reading. graphify drops a
 *      `graphify-out/` directory into the repo root. Scanning in place would
 *      leave build output inside somebody's working copy.
 *   2. Third-party scanners report absolute paths, and repo-paths.js turns them
 *      back into repo-relative ones by matching a `scan-<something>/repo/`
 *      prefix under the temp directory. That rule
 *      is shared with the allowances matcher, so a target outside that shape
 *      would make every allowance silently match nothing — which reads exactly
 *      like a feature nobody wired up. Materialising into the SAME shape means
 *      neither of those files has to learn about local targets at all.
 *   3. A working copy is not a clone. It holds `node_modules`, `_build`,
 *      coverage output and whatever else is gitignored, and gitleaks, jscpd and
 *      the LOC walk would all read them. The copy carries what git carries:
 *      tracked files plus untracked ones that are not ignored — which is to say
 *      the code you are about to push, uncommitted edits included. That is the
 *      thing you wanted measured.
 *
 * HISTORY IS READ FROM THE ORIGINAL. The copy has no `.git`, and C1's change
 * coupling needs a commit log. Rather than copy the object store, the scan is
 * handed a separate `historyDir` pointing at the source. It is only ever read
 * from — `git log`, nothing else. When the source is not a git repository at
 * all, `historyDir` is null and coupling reports itself unmeasured, which it
 * already knew how to do.
 *
 * NOTHING HERE EVER DELETES A DIRECTORY IT DID NOT CREATE. `cleanup()` removes
 * the temp directory and only the temp directory. The clone path relies on that
 * to shred a `.git/config` holding a plaintext token; the local path must never
 * be able to do the same thing to somebody's project.
 */

const fs = __nccwpck_require__(896);
const os = __nccwpck_require__(857);
const path = __nccwpck_require__(928);
const { execFileSync } = __nccwpck_require__(317);

// Only consulted when the source is not a git repository, and it is a guess by
// construction — without git there is no ignore file to obey. Kept deliberately
// short: these are directories that are build output or a package cache in
// every ecosystem that has them, and a wrong entry silently removes real source
// from a measurement. Anything doubtful is left in, because too much is a
// visible score and too little is an invisible one.
const NON_SOURCE_DIRS = new Set([
  '.git', 'node_modules', '_build', 'deps', '.venv', 'venv',
  '__pycache__', '.tox', '.gradle', '.terraform', 'graphify-out',
  '.next', '.nuxt', '.turbo', 'coverage', '.elixir_ls',
]);

/*
 * What a system config says its target is. Pure; no filesystem.
 *
 * configDir is where a relative path is resolved from — see the note above.
 */
function targetOf(cfg, systemKey, configDir) {
  const hasRepo = typeof cfg.repo === 'string' && cfg.repo !== '';
  const hasPath = typeof cfg.path === 'string' && cfg.path !== '';

  // Both is not a preference to resolve, it is two different answers to one
  // question. Silently choosing either would make a stale entry score the wrong
  // code, and the report would name the system, not the source.
  if (hasRepo && hasPath) {
    throw new Error(
      `System '${systemKey}' declares both repo and path. A target is one or the other — `
      + 'remove whichever is not the code you mean to measure.',
    );
  }
  if (!hasRepo && !hasPath) {
    throw new Error(
      `System '${systemKey}' declares neither repo nor path. `
      + 'Set repo to "owner/name" for a GitHub repository, or path to a folder on this machine.',
    );
  }

  if (hasRepo) return { kind: 'repo', repo: cfg.repo, label: cfg.repo };

  const resolved = path.resolve(configDir || process.cwd(), cfg.path);
  return { kind: 'path', path: resolved, label: resolved };
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
});

// The files git would carry: tracked, plus untracked ones no ignore rule
// covers. Returns null when the directory is not a git repository — the caller
// falls back to a walk and says that it did.
//
// `run` is injected so the listing can be tested without a git repository.
function gitFiles(srcDir, run = sh) {
  let out;
  try {
    out = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: srcDir });
  } catch {
    return null;
  }
  return out.split('\0').filter(Boolean);
}

function walkFiles(srcDir) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (NON_SOURCE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        found.push(path.relative(srcDir, path.join(dir, e.name)));
      }
    }
  };
  walk(srcDir, 0);
  return found;
}

/*
 * Copy a list of repo-relative paths from src into dest.
 *
 * Only regular files travel. A symlink is skipped and counted rather than
 * followed: following one would read a file outside the tree being measured and
 * attribute whatever it found to this system, and `git ls-files` lists symlinks
 * like anything else. The count is reported so a repository that leans on them
 * does not look like one that simply has fewer files.
 */
function copyFiles(src, dest, files) {
  let copied = 0;
  let symlinks = 0;
  let unreadable = 0;
  for (const rel of files) {
    // A path escaping the source is not something git or the walk produces, so
    // reaching this means the input is not what it claims to be.
    const from = path.resolve(src, rel);
    if (from !== src && !from.startsWith(src + path.sep)) continue;

    let st;
    try { st = fs.lstatSync(from); } catch { unreadable += 1; continue; }
    if (st.isSymbolicLink()) { symlinks += 1; continue; }
    if (!st.isFile()) continue;

    const to = path.join(dest, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    } catch { unreadable += 1; }
  }
  return { copied, symlinks, unreadable };
}

/*
 * Produce a working tree for one system and say where it is.
 *
 * Returns { dir, historyDir, label, kind, cleanup, notes }.
 *
 *   dir         the tree to scan, always <tmp>/scan-<prefix>-<rand>/repo
 *   historyDir  where to run `git log` for change coupling, or null
 *   cleanup()   removes the temp directory and nothing else
 *   notes       lines worth printing; how the tree was assembled
 */
function materialise(target, {
  prefix, token, tmpRoot = os.tmpdir(), run = sh,
} = {}) {
  const work = fs.mkdtempSync(path.join(tmpRoot, `scan-${prefix}-`));
  const dir = path.join(work, 'repo');
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true });
  const notes = [];

  try {
    if (target.kind === 'repo') {
      const url = token
        ? `https://x-access-token:${token}@github.com/${target.repo}.git`
        : `https://github.com/${target.repo}.git`;
      // Caught, because the URL carries the token and git writes it to its own
      // stderr on failure. Only the repo name is safe to put in the message.
      try {
        run('git', ['clone', '--depth', '1', url, dir]);
      } catch (err) {
        throw new Error(`git clone failed for ${target.repo} — check network and credentials (exit ${err.status})`);
      }
      return {
        dir, historyDir: dir, label: target.repo, kind: 'repo', cleanup, notes,
      };
    }

    let stat;
    try { stat = fs.statSync(target.path); } catch (err) {
      throw new Error(`target path for this system does not exist: ${target.path} (${err.code})`);
    }
    if (!stat.isDirectory()) throw new Error(`target path is not a directory: ${target.path}`);

    fs.mkdirSync(dir, { recursive: true });

    const tracked = gitFiles(target.path, run);
    const files = tracked || walkFiles(target.path);
    const historyDir = tracked ? target.path : null;
    if (!tracked) {
      notes.push(
        `${target.path} is not a git repository: copying everything outside a fixed list of `
        + 'build directories, and change coupling will be unmeasured',
      );
    }

    const { copied, symlinks, unreadable } = copyFiles(target.path, dir, files);

    // An empty tree measures clean on every criterion. That is the one outcome
    // a scanner must never produce quietly.
    if (copied === 0) {
      throw new Error(
        `no files to scan under ${target.path} — refusing to run, because an empty tree `
        + 'scores clean on every criterion',
      );
    }

    notes.push(
      `${copied} files copied from ${target.path}`
      + (tracked ? ' (tracked and untracked, ignore rules applied)' : '')
      + (symlinks ? `; ${symlinks} symlinks skipped` : '')
      + (unreadable ? `; ${unreadable} unreadable` : ''),
    );

    return {
      dir, historyDir, label: target.path, kind: 'path', cleanup, notes,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = {
  targetOf, materialise, gitFiles, walkFiles, copyFiles, NON_SOURCE_DIRS,
};


/***/ }),

/***/ 317:
/***/ ((module) => {

module.exports = require("child_process");

/***/ }),

/***/ 896:
/***/ ((module) => {

module.exports = require("fs");

/***/ }),

/***/ 857:
/***/ ((module) => {

module.exports = require("os");

/***/ }),

/***/ 928:
/***/ ((module) => {

module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/asset-relocator-loader */
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __nccwpck_require__(345);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;