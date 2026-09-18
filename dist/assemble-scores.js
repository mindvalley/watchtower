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

/***/ 653:
/***/ ((module) => {



// Pure scorecard assembly: per-system criteria -> composite + coverage + hard-cap,
// then the full benchmark.json contract. Composite is the mean of SCORED criteria
// only (Planned/absent excluded); the coverage denominator is the fixed namespace.

// The benchmark namespace after removing the two dropped criteria (former C3, C5).
// Coverage is "N of TOTAL_CRITERIA assessed".
const TOTAL_CRITERIA = 7;

// The composite is out of 100. Per-criterion scores stay out of 5 — they answer a
// different question and are read next to their own anchors, so mixing the scales
// is deliberate rather than an oversight.
//
// Until 2026-08-27 the composite was a /5 mean and a Critical finding forced the
// colour red without touching the number, so a system could publish 4.3 in a red
// badge and the page had to explain the disagreement. Across the 115 published
// readings, 59 showed a colour their own number contradicted. There is now ONE
// rule: a Critical scales the mean into the red band, and the colour is read off
// the resulting number and nothing else.
//
// Scaling rather than clamping, so ordering survives among capped systems — a
// capped system that is otherwise sound still ranks above a capped one that is
// not, which is what tells you where to send someone next.
const CRITICAL_CEILING = 0.4; // lands a perfect-but-critical system at exactly 40

// The former 2.0 / 3.5 boundaries rescaled. No new anchor is being introduced.
const RED_MAX = 40;
const AMBER_MAX = 70;

function bandFor(score) {
  if (score <= RED_MAX) return 'red';
  if (score <= AMBER_MAX) return 'amber';
  return 'green';
}

function buildSystemEntry({ criteria, assessedAt }) {
  const entries = Object.values(criteria).filter((c) => c && c.score != null);
  const scoredCount = entries.length;
  // Binary: five Criticals score the same as one. No anchor exists for
  // compounding them, and inventing one would be gradation we cannot defend.
  const hardCapped = entries.some((c) => c.critical);
  const mean = scoredCount
    ? entries.reduce((s, c) => s + c.score, 0) / scoredCount
    : null;
  const composite = mean == null
    ? null
    : Math.round(mean * 20 * (hardCapped ? CRITICAL_CEILING : 1));
  return {
    score: composite,
    colour: composite == null ? null : bandFor(composite),
    // Still published: the expander names why a system is where it is, and the
    // audit trail needs to distinguish "scored 28" from "scored 70, then capped".
    // It is never rendered as a badge of its own.
    hard_capped: hardCapped,
    coverage: `${scoredCount} of ${TOTAL_CRITERIA} assessed`,
    assessed_at: assessedAt,
    criteria,
  };
}

function assembleBenchmark({ systems, lastUpdated }) {
  return { last_updated: lastUpdated, example: false, systems };
}

module.exports = {
  buildSystemEntry, assembleBenchmark, bandFor, TOTAL_CRITERIA, CRITICAL_CEILING, RED_MAX, AMBER_MAX,
};


/***/ }),

/***/ 171:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



/*
 * Turns one run's raw scanner output into scores.
 *
 * The seven scan programs each write reports for one system. This reads them
 * all back, runs the scorers, and writes the assembled scorecard plus a
 * findings file per system. It is the step between scanning and publishing,
 * and until now it did not exist inside the engine: the only implementation
 * lived in the repo the engine grew up in, shaped around that board's own
 * arrangements. A watchtower that could scan and score but not be *asked* to
 * score is not usable by anyone else.
 *
 * Locations come from the environment — see engine-config.js:
 *   WATCHTOWER_CONFIG   the systems this watchtower measures
 *   WATCHTOWER_REPORTS  where the scan programs wrote their output
 *   WATCHTOWER_DATA     where the assembled scores go
 *
 * Scope: every system in the config, unless SYSTEMS names a subset (space or
 * comma separated). A named system that is not in the config is an error
 * rather than a silent omission.
 */

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const { buildBenchmarkData } = __nccwpck_require__(846);
const { buildFindingsForSystem } = __nccwpck_require__(443);
const { loadConfig, loadAllowances, reportsRoot, dataDir } = __nccwpck_require__(880);
const { writeManifest } = __nccwpck_require__(762);

// Every report the scorers expect, and the reason this list is here rather
// than in a caller's pipeline.
//
// A missing report reads downstream as "no findings", which is indistinguishable
// from a clean result — a system nothing examined scores green. That guard
// existed, as a shell loop in one workflow, naming one board's systems. Anyone
// else running the engine inherited the failure mode and not the guard. The
// scan edge already refuses to write a report it could not produce; this is the
// same rule one level up, for a leg that died before writing anything at all.
//
// simplicity-meta is written last by its scan, only after the complexity linter
// succeeds, so its presence is what proves that scan finished.
const REQUIRED_REPORTS = [
  'gitleaks', 'trivy', 'semgrep',
  'jscpd', 'simplicity-meta',
  'observability',
  'deployment',
  'documented-apis',
  'test-coverage',
  'boundaries',
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Which systems this run is assembling. Defaults to the whole config, because
// the ordinary case is a watchtower measuring everything it is responsible for.
function selectSystems(config, requested) {
  const known = Object.keys(config.systems);
  if (!requested) return known.sort();

  const asked = requested.split(/[\s,]+/).filter(Boolean);
  const unknown = asked.filter((k) => !known.includes(k));
  if (unknown.length > 0) {
    throw new Error(
      `SYSTEMS names ${unknown.join(', ')}, which the watchtower config does not list. ` +
      `It lists: ${known.sort().join(', ')}`,
    );
  }
  return [...new Set(asked)].sort();
}

function assertReportsPresent(systemKeys, root) {
  const missing = [];
  for (const key of systemKeys) {
    for (const name of REQUIRED_REPORTS) {
      if (!fs.existsSync(path.join(root, key, `${name}.json`))) {
        missing.push(`${key}/${name}.json`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Refusing to assemble scores with ${missing.length} report(s) missing from ${root}:\n` +
      `${missing.map((m) => `  ${m}`).join('\n')}\n` +
      'A scan that did not run is not a system with nothing wrong with it.',
    );
  }
}

module.exports = { selectSystems, assertReportsPresent, REQUIRED_REPORTS };

// --- I/O edge -------------------------------------------------------------
if (require.main === require.cache[eval('__filename')]) {
  const REPORTS = reportsRoot();
  const DATA = dataDir();

  const readReport = async (name, kind) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(REPORTS, name, `${kind}.json`), 'utf8'));
    } catch (e) {
      // Reached only for reports outside the required list — a language-specific
      // complexity report the meta did not name, say. The required ones are
      // checked up front, so this cannot quietly swallow a dead scan leg.
      console.warn(`  ${name}/${kind}.json: ${e.message} (treated as absent)`);
      return null;
    }
  };

  function loadTriageConfig() {
    try {
      return JSON.parse(fs.readFileSync(__nccwpck_require__.ab + "triage-config.json", 'utf8'));
    } catch (e) {
      console.warn(`  triage-config.json: ${e.message} (no triage applied)`);
      return {};
    }
  }

  async function main() {
    const config = loadConfig();
    const keys = selectSystems(config, process.env.SYSTEMS);
    assertReportsPresent(keys, REPORTS);

    const systems = keys.map((name) => ({
      name,
      stack: config.systems[name].stack,
      sast_tool: config.systems[name].sast_tool,
    }));
    const triageConfig = loadTriageConfig();
    // Findings this watchtower has already judged acceptable. Absent is normal
    // and means an empty list, which changes nothing.
    const allowances = loadAllowances();
    const date = today();

    const built = await buildBenchmarkData({
      systems, readReport, sastTool: 'semgrep', assessedAt: date, lastUpdated: date, triageConfig, allowances,
    });

    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'benchmark.json'), `${JSON.stringify(built, null, 2)}\n`);

    // Totals per allowance ACROSS systems. A fleet-wide entry is reported once
    // per system it was in scope for, so counting the zeros directly would call
    // an entry idle when it matched on one system and not another.
    const absorbed = new Map();
    const entryKey = (a) => JSON.stringify([a.criterion, a.sub, a.system, a.match]);

    for (const sys of systems) {
      const env = await buildFindingsForSystem({
        sys, readReport, sastTool: 'semgrep', triageConfig, allowances, generatedAt: date,
      });
      fs.writeFileSync(path.join(DATA, `findings-${sys.name}.json`), `${JSON.stringify(env, null, 2)}\n`);
      for (const a of (env.allowances || [])) {
        const k = entryKey(a);
        const seen = absorbed.get(k) || { entry: a, total: 0 };
        seen.total += a.matched;
        absorbed.set(k, seen);
      }
    }

    // Said out loud rather than left in a file nobody opens. An allowance that
    // matched nothing across the whole run is either a finding since fixed —
    // delete the entry — or one that never matched and has been suppressing
    // nothing since the day it was written. Both are worth knowing; neither
    // fails the run, because a stale allowance is not a reason to stop
    // publishing scores.
    if (absorbed.size) {
      const idle = [...absorbed.values()].filter((a) => a.total === 0);
      const removed = [...absorbed.values()].reduce((n, a) => n + a.total, 0);
      console.log(
        `Allowances: ${absorbed.size} entr(ies) in scope, ` +
        `${absorbed.size - idle.length} active, ${removed} finding(s) removed from scoring.`,
      );
      for (const { entry } of idle) {
        console.log(`  matched nothing: ${entry.criterion}/${entry.sub} ${JSON.stringify(entry.match)}${entry.system ? ` [${entry.system}]` : ''}`);
      }
    }

    // Recorded before the process can exit successfully, so what gets published
    // is what got assembled and never the config's wider list.
    writeManifest(REPORTS, keys);

    const summary = Object.entries(built.systems)
      .map(([n, s]) => `${n}=${s.score == null ? 'NA' : s.score}${s.hard_capped ? '(capped)' : ''}`)
      .join(' ');
    console.log(`Assembled ${keys.length} system(s) into ${DATA} — ${summary}`);
  }

  main().catch((e) => { console.error(e.message); process.exit(1); });
}


/***/ }),

/***/ 846:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure orchestration: for each system, read its three scanner reports (via the
// injected readReport), normalize, score C9, and assemble the contract. No I/O
// here — readReport is supplied by the edge (real) or a fake (tests).

const {
  parseGitleaks, parseTrivy, parseSast, parseDuplication, complexityParser,
} = __nccwpck_require__(874);
const { scoreSecurity } = __nccwpck_require__(588);
const { scoreSimplicity } = __nccwpck_require__(327);
const { scoreObservability } = __nccwpck_require__(845);
const { scoreDeployment } = __nccwpck_require__(509);
const { scoreDocumentedApis } = __nccwpck_require__(126);
const { scoreTestCoverage } = __nccwpck_require__(985);
const { scoreBoundaries } = __nccwpck_require__(520);
const { boundaryGraphDisposition } = __nccwpck_require__(528);
const { buildSystemEntry, assembleBenchmark } = __nccwpck_require__(653);
const { createAllowanceSet } = __nccwpck_require__(868);

// Score C8 only when the simplicity scan actually ran for this system (its meta
// file is present). Otherwise return null so C8 stays Pending — never score an
// un-scanned system a false green (the same trap C9's CI "assert reports" guard
// closes on the pipeline side).
async function scoreC8({ sys, readReport, assessedAt, allowComplexity = null }) {
  const meta = await readReport(sys.name, 'simplicity-meta');
  if (!meta) return null;

  // Several languages, several reports. Sum violations across all of them; the LOC
  // denominator is already pooled in meta.loc. Parsing dispatches per language, so
  // a repo running credo and lizard together is parsed correctly by both.
  const entries = Array.isArray(meta.languages) && meta.languages.length
    ? meta.languages
    : [{ language: meta.stack, tool: meta.tool, report: meta.tool, loc: meta.loc, gate: null }];

  let violations = 0;
  let allowed = 0;
  const items = [];
  const perLanguage = [];
  for (const entry of entries) {
    const reportName = entry.report || entry.tool;
    const raw = await readReport(sys.name, reportName);
    // A report the meta SAYS was written but that reads null is a broken leg, not
    // a clean language. Every parser tolerates null and returns violations: 0
    // while the language's LOC stays in the denominator — losing one umbrella's
    // complexity-elixir.json (197k of its 298k lines) would still have produced a
    // plausible-looking 4.0. Spec §5 requires the leg to fail instead.
    if (raw == null) {
      throw new Error(`C8 ${sys.name}: simplicity-meta names report '${reportName}' for ${entry.language}, but it is missing — refusing to score ${entry.loc || 0} lines as zero violations`);
    }
    const cx = complexityParser(entry.tool)(raw, { allow: allowComplexity }); // throws on an unknown tool
    violations += cx.violations;
    allowed += cx.allowed || 0;
    for (const it of (cx.items || [])) items.push({ ...it, language: entry.language });
    perLanguage.push({
      language: entry.language, tool: entry.tool, loc: entry.loc || 0, violations: cx.violations,
    });
  }

  // LOC travels with each gate so the gate facet can weight by it: a gate covering
  // two-thirds of the code is more protective than one covering a twentieth.
  const gates = entries.filter((e) => e.gate).map((e) => ({ language: e.language, loc: e.loc || 0, ...e.gate }));
  const dup = parseDuplication(await readReport(sys.name, 'jscpd'));
  return scoreSimplicity({
    complexity: { violations, loc: meta.loc || 0, allowed },
    duplication: dup,
    tool: meta.tool,
    gates,
    languages: perLanguage,
    unmeasured: meta.unmeasured || [],
    skippedImmaterial: meta.skipped_immaterial || [],
    assessedAt,
  });
}

// Score C4 only when the observability scan ran (its report is present).
// Otherwise return null so C4 stays Pending — never a false green.
async function scoreC4({ sys, readReport, assessedAt }) {
  const report = await readReport(sys.name, 'observability');
  if (!report) return null;
  return scoreObservability(report, { assessedAt });
}

// Score C7 only when the deployment scan ran (its report is present).
// Otherwise return null so C7 stays Pending — never a false green.
async function scoreC7({ sys, readReport, assessedAt }) {
  const report = await readReport(sys.name, 'deployment');
  if (!report) return null;
  return scoreDeployment(report, { assessedAt });
}

// Score C2 only when the documented-apis scan ran (its report is present).
// N/A systems (applicable:false) and zero-field parses return null -> Pending.
async function scoreC2({ sys, readReport, assessedAt }) {
  const report = await readReport(sys.name, 'documented-apis');
  if (!report) return null;
  return scoreDocumentedApis(report, { assessedAt });
}

// Score C6 only when the test-coverage scan ran (its report is present).
// N/A systems (applicable:false) and zero-source parses return null -> Pending.
async function scoreC6({ sys, readReport, assessedAt }) {
  const report = await readReport(sys.name, 'test-coverage');
  if (!report) return null;
  return scoreTestCoverage(report, { assessedAt });
}

// Score C1 only when the boundary scan ran. An indeterminate discovery returns
// null from the scorer, so C1 stays unscored rather than reading a false green.
async function scoreC1({ sys, readReport, assessedAt }) {
  const report = await readReport(sys.name, 'boundaries');
  if (!report) return null;
  // The stack decides whether the code graph underneath C1 is trustworthy enough
  // to grade. It comes from the registry, not the report, so it has to be passed
  // in here -- an unwired stack silently publishes a graph-derived green.
  return scoreBoundaries(report, {
    assessedAt,
    graphDisposition: boundaryGraphDisposition(sys.stack),
  });
}

// `allowances` is the watchtower's list of findings already judged acceptable.
// It defaults to empty, and an empty list takes every parser down the path it
// took before this existed — which is what makes shipping the mechanism provably
// unable to move a score.
async function buildBenchmarkData({
  systems, readReport, sastTool, assessedAt, lastUpdated, triageConfig = {}, allowances = [],
}) {
  const excludePaths = triageConfig.exclude_paths || [];
  const reviewRules = triageConfig.gitleaks_review_rules || [];
  const severityRemap = triageConfig.semgrep_severity_remap || {};
  const out = {};
  for (const sys of systems) {
    const tool = sys.sast_tool || sastTool;
    const directDeps = await readReport(sys.name, 'direct-deps');
    const prodDeps = (directDeps && directDeps.prod) || [];
    const devDeps = (directDeps && directDeps.dev) || [];

    // Per system: an allowance may be scoped to one system, and an entry that
    // matched nothing here may have matched plenty on the next one.
    const allow = createAllowanceSet(allowances, sys.name);

    const secrets = parseGitleaks(await readReport(sys.name, 'gitleaks'), {
      excludePaths, reviewRules, allow: allow.matcherFor('security', 'secrets'),
    });
    const deps = parseTrivy(await readReport(sys.name, 'trivy'), {
      prodDeps, devDeps, allow: allow.matcherFor('security', 'deps'),
    });
    const sast = parseSast(await readReport(sys.name, tool), tool, {
      severityRemap, excludePaths, allow: allow.matcherFor('security', 'sast'),
    });
    const c9 = scoreSecurity({ secrets, deps, sast, assessedAt });

    const criteria = { 9: c9 };
    const c8 = await scoreC8({
      sys, readReport, assessedAt, allowComplexity: allow.matcherFor('simplicity', 'complexity'),
    });
    if (c8) criteria[8] = c8;

    const c4 = await scoreC4({ sys, readReport, assessedAt });
    if (c4) criteria[4] = c4;

    const c7 = await scoreC7({ sys, readReport, assessedAt });
    if (c7) criteria[7] = c7;

    const c2 = await scoreC2({ sys, readReport, assessedAt });
    if (c2) criteria[2] = c2;

    const c6 = await scoreC6({ sys, readReport, assessedAt });
    if (c6) criteria[6] = c6;

    const c1 = await scoreC1({ sys, readReport, assessedAt });
    if (c1) criteria[1] = c1;

    out[sys.name] = buildSystemEntry({ criteria, assessedAt });
  }
  return assembleBenchmark({ systems: out, lastUpdated });
}

module.exports = { buildBenchmarkData };


/***/ }),

/***/ 443:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure builder: read a system's scanner reports and emit the per-finding
// locations envelope (findings-<system>.json). Mirrors build-benchmark-data.js
// (pure over an injected readReport). SECURITY: emits paths/rules/ids/severities
// only — never a matched secret value (the parsers already drop them; we only
// ever copy the whitelisted fields below).

const {
  parseGitleaks, parseTrivy, parseSast, parseDuplication, complexityParser,
} = __nccwpck_require__(874);
const { createAllowanceSet } = __nccwpck_require__(868);
// Shared with the allowances matcher, which has to shorten a scanner path on the
// way IN for the same reason this shortens it on the way out. See repo-paths.js.
const { relativizePaths } = __nccwpck_require__(754);

const nonEmpty = (items) => (Array.isArray(items) ? items.filter(Boolean) : []);
function group(sub, label, disposition, items) {
  const list = nonEmpty(items);
  if (!list.length) return null;
  return disposition ? { sub, label, disposition, items: list } : { sub, label, items: list };
}
function criterion(label, groups) {
  const gs = groups.filter(Boolean);
  return gs.length ? { label, groups: gs } : null;
}

async function c9Groups(sys, readReport, sastTool, triageConfig, allow) {
  const excludePaths = triageConfig.exclude_paths || [];
  const reviewRules = triageConfig.gitleaks_review_rules || [];
  const severityRemap = triageConfig.semgrep_severity_remap || {};
  const dd = (await readReport(sys.name, 'direct-deps')) || {};
  const secrets = parseGitleaks(await readReport(sys.name, 'gitleaks'), {
    excludePaths, reviewRules, allow: allow.matcherFor('security', 'secrets'),
  });
  const deps = parseTrivy(await readReport(sys.name, 'trivy'), {
    prodDeps: dd.prod || [], devDeps: dd.dev || [], allow: allow.matcherFor('security', 'deps'),
  });
  const sast = parseSast(await readReport(sys.name, sys.sast_tool || sastTool), sys.sast_tool || sastTool, {
    severityRemap, excludePaths, allow: allow.matcherFor('security', 'sast'),
  });
  return [
    group('secrets', 'Secrets', 'confirmed', (secrets.items || []).map((s) => ({ file: s.file, rule: s.rule }))),
    group('secrets', 'Secrets', 'review', (secrets.review_items || []).map((s) => ({ file: s.file, rule: s.rule }))),
    // Allowed findings keep their place in the report — removed from the score,
    // not from the record. The secrets whitelist stays as tight as the confirmed
    // one: file and rule only, never a matched value.
    group('secrets', 'Secrets', 'allowed', (secrets.allowed_items || []).map((s) => ({ file: s.file, rule: s.rule, allowed_reason: s.allowed_reason }))),
    group('deps', 'Dependency CVEs', null, deps.items),
    group('deps', 'Dependency CVEs', 'allowed', deps.allowed_items),
    group('sast', 'SAST', null, sast.items),
    group('sast', 'SAST', 'allowed', sast.allowed_items),
  ];
}

async function c8Groups(sys, readReport, allow) {
  const meta = await readReport(sys.name, 'simplicity-meta');
  if (!meta) return [];
  const entries = Array.isArray(meta.languages) && meta.languages.length
    ? meta.languages
    : (meta.tool ? [{ language: meta.stack, tool: meta.tool, report: meta.tool }] : []);
  if (!entries.length) return [];

  const offsets = (await readReport(sys.name, 'vue-offsets')) || {};
  // Map an extracted Vue script location back to its .vue file and original
  // line. A location pointing at the extraction tree is unactionable.
  // Use longest-match so that two offset keys sharing a suffix (e.g.
  // "src/Login.vue.ts" and "components/src/Login.vue.ts") never collide.
  const toSource = (it, language) => {
    const matches = it.file ? Object.entries(offsets).filter(([k]) => it.file.endsWith(k)) : [];
    const hit = matches.length ? matches.reduce((a, b) => (a[0].length >= b[0].length ? a : b)) : null;
    if (!hit) return { ...it, language };
    const [, { source, lineOffset }] = hit;
    return { ...it, file: source, line: it.line != null ? (it.line - 1) + lineOffset : it.line, language };
  };

  const items = [];
  const allowedItems = [];
  for (const entry of entries) {
    const reportName = entry.report || entry.tool;
    const raw = await readReport(sys.name, reportName);
    // Same rule as scoreC8: a report the meta names but that is missing is a
    // broken leg. Tolerating it here would quietly publish a findings file with a
    // whole language's violations absent.
    if (raw == null) {
      throw new Error(`C8 ${sys.name}: simplicity-meta names report '${reportName}' for ${entry.language}, but it is missing — refusing to emit findings with that language silently absent`);
    }
    const cx = complexityParser(entry.tool)(raw, { allow: allow.matcherFor('simplicity', 'complexity') });
    // Allowed items get the same Vue remap as the rest. They are shown to the
    // same reader, so a location that is unactionable for one is unactionable
    // for the other.
    for (const it of (cx.items || [])) items.push(toSource(it, entry.language));
    for (const it of (cx.allowed_items || [])) allowedItems.push(toSource(it, entry.language));
  }
  const dup = parseDuplication(await readReport(sys.name, 'jscpd'));
  return [
    group('complexity', 'Cyclomatic complexity', null, items),
    group('complexity', 'Cyclomatic complexity', 'allowed', allowedItems),
    // Duplication carries no allowed group: its percentage comes from jscpd's own
    // totals rather than this list, so filtering here would show findings removed
    // while the score stayed put. See allowances.js.
    group('duplication', 'Duplication', null, dup.clone_items),
  ];
}

async function c6Groups(sys, readReport) {
  const r = await readReport(sys.name, 'test-coverage');
  if (!r || !r.stacks) return [];
  const untested = []; const discipline = [];
  let untestedTotal = 0;
  for (const [stack, s] of Object.entries(r.stacks)) {
    untestedTotal += (Number(s.source_files) || 0) - (Number(s.tested_files) || 0);
    for (const f of (s.untested_samples || [])) untested.push({ file: f, stack });
    const t = s.tooling || {};
    const status = t.enforced ? `enforced (${(t.thresholds || []).join('/')})` : (t.present ? 'configured, no gate' : 'no coverage tool');
    if (!t.enforced) discipline.push({ stack, status });
  }
  // The scan keeps 20 untested files per stack, so a two-stack repo shows 40 of
  // however many there are. Unlabelled, that reads as the whole list, and the cap
  // does not even land on a round number a reader would question.
  const breadthLabel = untested.length < untestedTotal
    ? `Untested source files — ${untested.length} of ${untestedTotal}`
    : 'Untested source files';
  return [group('breadth', breadthLabel, null, untested), group('discipline', 'Coverage enforcement', null, discipline)];
}

async function c7Groups(sys, readReport) {
  const r = await readReport(sys.name, 'deployment');
  if (!r) return [];
  const caps = ['progressive_delivery', 'automated_rollback', 'pipeline_safety'];
  const items = caps.map((k) => {
    const c = r[k] || {};
    const rung = (c.mature || []).length ? 'mature' : (c.basic || []).length ? 'basic' : 'none';
    return { sub: k, rung, evidence: [...(c.mature || []), ...(c.basic || [])] };
  });
  return [group('capabilities', 'Deployment capabilities', null, items)];
}

// Observability report is per-pillar { declared:[], configured:[], exercised:[] }
// (frontend_errors also carries applicable). Rung derives from array LENGTH (an
// empty [] is truthy — never test the array itself), and evidence is the highest
// non-empty rung's markers. A pillar N/A (frontend_errors applicable:false) is skipped.
const C4_PILLARS = {
  logging: 'Structured logging',
  tracing: 'Distributed tracing',
  backend_errors: 'Backend error tracking',
  frontend_errors: 'Frontend error tracking',
};
async function c4Groups(sys, readReport) {
  const r = await readReport(sys.name, 'observability');
  if (!r) return [];
  const items = [];
  for (const [pillar, label] of Object.entries(C4_PILLARS)) {
    const v = r[pillar];
    if (!v || v.applicable === false) continue;
    const exercised = Array.isArray(v.exercised) ? v.exercised : [];
    const configured = Array.isArray(v.configured) ? v.configured : [];
    const declared = Array.isArray(v.declared) ? v.declared : [];
    const rung = exercised.length ? 'exercised' : configured.length ? 'configured' : declared.length ? 'declared' : 'none';
    const evidence = (exercised.length ? exercised : configured.length ? configured : declared).slice(0, 5);
    items.push({ pillar: label, rung, evidence });
  }
  return [group('pillars', 'Observability pillars', null, items)];
}

async function c2Groups(sys, readReport) {
  const r = await readReport(sys.name, 'documented-apis');
  if (!r || !r.applicable) return [];
  const byType = Array.isArray(r.by_type) ? r.by_type : [];
  const items = byType.map((t) => ({ type: t.type, undescribed: (t.total || 0) - (t.described || 0) })).filter((t) => t.undescribed > 0);
  const byKind = r.rest && r.rest.by_kind ? r.rest.by_kind : null;
  const restItems = byKind
    ? ['operation', 'parameter', 'property']
        .map((kind) => ({ kind, undescribed: (byKind[kind] ? (byKind[kind].total || 0) - (byKind[kind].described || 0) : 0) }))
        .filter((k) => k.undescribed > 0)
    : [];
  const groups = [group('descriptions', 'Undescribed field types', null, items)];
  if (restItems.length) groups.push(group('rest-descriptions', 'Undescribed REST elements', null, restItems));
  return groups;
}

async function buildFindingsForSystem({
  sys, readReport, sastTool, triageConfig = {}, allowances = [], generatedAt,
}) {
  const allow = createAllowanceSet(allowances, sys.name);
  const criteria = {};
  const add = (key, label, groups) => { const c = criterion(label, groups); if (c) criteria[key] = c; };
  add('2', 'Documented APIs', await c2Groups(sys, readReport));
  add('4', 'Observable State', await c4Groups(sys, readReport));
  add('6', 'Test Coverage', await c6Groups(sys, readReport));
  add('7', 'Deployment Safety', await c7Groups(sys, readReport));
  add('8', 'Codebase Simplicity', await c8Groups(sys, readReport, allow));
  add('9', 'Security Posture', await c9Groups(sys, readReport, sastTool, triageConfig, allow));

  // Every allowance in scope for this system with the number of findings it
  // absorbed — including the zeros, which are the ones worth reading. An entry
  // at zero is either fixed (delete it) or never matched anything and was wrong
  // when it was written; without this it is indistinguishable from an entry
  // quietly doing its job.
  //
  // Sits OUTSIDE `criteria` deliberately: buildIngestPayload publishes
  // `findings.criteria` and nothing else, so a watchtower's list of judgements
  // stays in its own repo and never travels to the shared database.
  const allowanceSummary = allow.summary();
  const envelope = {
    system: sys.name,
    generated_at: generatedAt,
    criteria: relativizePaths(criteria),
  };
  if (allowanceSummary.length) envelope.allowances = allowanceSummary;
  return envelope;
}

module.exports = { buildFindingsForSystem };


/***/ }),

/***/ 528:
/***/ ((module) => {



// Which stacks each stack-bound criterion can honestly measure. A stack not
// handled here makes its scanner skip (emit no report), so the composition layer
// records Pending rather than a false green. C4 (observability) and C6 (test
// coverage) are now stack-agnostic and are NOT gated here — they scan every
// stack and let absent evidence score an honest low. Only C2 remains gated.

// C2 documented APIs dispositions:
//   'elixir-ast' — score in-code Elixir schemas (Absinthe + phoenix_swagger, AST
//                  parse via the elixir binary). The existing pilot path.
//   'na'         — ruby: declared N/A (the Ruby pilot's existing state; kept unchanged
//                  for parity — an apipie-emitted artifact re-score is a separate,
//                  deliberate step, not this agnostic slice).
//   'artifact'   — every other stack: recognize a committed API-description
//                  artifact (OpenAPI JSON/YAML or GraphQL SDL) and measure it. If
//                  no artifact is present, emit no report -> honest Pending (an
//                  in-code-only API is "not measured", never a false green).
function documentedApisDisposition(stack) {
  if (stack === 'elixir') return 'elixir-ast';
  if (stack === 'ruby') return 'na';
  return 'artifact';
}

// C1 domain boundaries: whether the tree-sitter code graph is trustworthy enough
// on this stack to grade cycles and module fan-out.
//
//   'ok'         — grade the graph-derived metrics.
//   'unreliable' — measure and report them, but do NOT grade them. The scorer
//                  drops these sub-metrics; if nothing else is scoreable the
//                  criterion is INDETERMINATE (not Pending — we are not promising
//                  to fix the extractor, and not a score we cannot defend).
//
// Measured against ground truth on 2026-07-29, not assumed:
//   elixir — graphify 0.9.28/0.9.29 resolves an `alias` only when the module name
//            is exactly two segments AND the file path is its literal lowercase
//            (Foo.Bar -> foo/bar.ex). Three-plus segments (Foo.Bar.Baz) and
//            snake_case (Foo.TwoWord -> two_word.ex) both silently fail, and
//            real Elixir is overwhelmingly one of those. In one umbrella that
//            produced 4 of 8 real cross-app dependencies, plus one edge pointing
//            the wrong way — a pair reported with zero references while the real
//            dependency in the opposite direction was missed. A cycle needs only
//            one missing edge to disappear, so "zero cycles" is uninformative.
//   js/ts  — 5 of 6 real code dependencies in a TypeScript monorepo; the misses
//            eslint-config/typescript-config, consumed via tsconfig `extends`
//            rather than imports, which a code graph is right to omit.
// Ruby and Python are not separately measured; they keep the default until they
// are, because withholding a grade needs evidence just as much as publishing one.
function boundaryGraphDisposition(stack) {
  return stack === 'elixir' ? 'unreliable' : 'ok';
}

module.exports = { documentedApisDisposition, boundaryGraphDisposition };


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

/***/ 762:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



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

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);

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


/***/ }),

/***/ 520:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure C1 (Clear Domain Boundaries) scoring, phase 1: circular dependencies and
// module fan-out. Anchors are the benchmark spec's own thresholds. Returns null
// whenever the criterion is indeterminate -- never a false green.

const { round1, colourFor } = __nccwpck_require__(588);

// Band -> score. Green = 5.0; amber grades linearly 3.5 -> 2.5 across the band;
// red decays from 2.0 to a 0.5 floor so a catastrophic system stays
// distinguishable from an unmeasured one. Within-band gradation is PROVISIONAL.
// greenBelow is the first AMBER value: cycles 1 (so 0 is green), fan-out 5.
// amberMax is the last amber value: cycles 3, fan-out 10.
// discrete: true means red starts at amberMax + 1 (integer count); false/omitted
// means red starts at amberMax (continuous metric).
function bandScore(value, { greenBelow, amberMax, discrete }) {
  const redOrigin = discrete ? amberMax + 1 : amberMax;
  if (value < greenBelow) return 5.0;
  if (value <= amberMax) {
    const span = amberMax - greenBelow;
    const pos = span === 0 ? 0 : (value - greenBelow) / span;
    return round1(3.5 - pos * 1.0);
  }
  return round1(Math.max(0.5, 2.0 - 0.1 * (value - redOrigin)));
}

// Indeterminate result. Returned as an OBJECT with score: null rather than a
// bare null, following score-observability.js: a bare null makes
// build-benchmark-data omit the criterion entirely and the site renders
// "pending — not yet assessed", which is wrong twice over. The spec says C1 does
// not use Pending at launch, and the real reason (module_discovery.reason, or
// the degenerate-graph reason) is the whole point of an indeterminate state.
// `measuredSub` carries anything the scan did manage to measure before the
// criterion fell to indeterminate, plus the per-metric withholding reason. An
// indeterminate criterion is not an empty one: "0 cycles measured, not scored,
// because the extractor under-counts" is far more useful to a reader than a
// blank, and dropping it hid real numbers on the Elixir systems.
function indeterminate(r, reason, assessedAt, extraFindings = [], measuredSub = {}) {
  const discovery = r.module_discovery || {};
  const findings = [`Indeterminate — ${reason}`, ...extraFindings];
  const g = r.graph || {};
  if (g.modules_declared != null && g.module_graph_coverage != null) {
    findings.push(
      `Module-graph coverage ${(Number(g.module_graph_coverage) * 100).toFixed(1)}% `
      + `(${g.modules_connected}/${g.modules_declared} declared modules in the graph); `
      + `threshold ${(Number(g.module_graph_coverage_threshold) * 100).toFixed(0)}%`
    );
  }
  return {
    score: null,
    colour: null,
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    indeterminate: reason,
    source: BOUNDARY_SOURCE,
    sub: {
      circular_dependencies: {
        score: null,
        colour: null,
        count: measuredSub.cycleCount != null ? measuredSub.cycleCount : null,
        withheld: measuredSub.cycleWithheld || reason,
      },
      module_fan_out: {
        score: null,
        colour: null,
        mean: measuredSub.meanFanOut != null ? round1(measuredSub.meanFanOut) : null,
        withheld: measuredSub.fanWithheld || reason,
      },
    },
    findings,
    actions: [],
    audit: {
      discovery,
      modules: (discovery.modules || []).length,
      graph: g,
    },
  };
}

const BOUNDARY_SOURCE = 'Domain-boundary health — circular dependencies and module fan-out over a tree-sitter code graph. Modules are discovered from the repo\'s own workspace declaration. External coupling is counted only at recognised client-construction and connection call sites. Static/headless; change-coupling and violation trend follow in phase 2.';

// Why a stack can be measured but not graded. Both C1 metrics shipped so far are
// derived from the code graph, so when the graph under-resolves a stack there is
// nothing left to grade and the criterion is indeterminate. This is deliberately
// NOT Pending: Pending promises the number is coming, and we are not committing
// to repair a third-party extractor. See criterion-stacks.boundaryGraphDisposition
// for the measurements behind the call.
const UNRELIABLE_GRAPH_REASON = (/* unused pure expression or super */ null && ('the code graph under-resolves this stack — on the reference repository it '
  + 'recovered 4 of 8 real cross-module dependencies and reported one of them backwards, and a cycle needs only '
  + 'one missing edge to vanish; cycles and fan-out are still measured and reported below, but not scored'));

// Withholding is ASYMMETRIC, because an under-counting extractor does not destroy
// information symmetrically. Every edge it misses pushes both graph metrics DOWN:
// a missed dependency lowers fan-out and can erase a cycle entirely. So a measured
// value is a FLOOR — the truth is at least this bad and possibly worse.
//
// That makes bad news credible and good news worthless. A measured 2 cycles means
// there really are at least 2; a measured 0 means nothing at all. A mean fan-out of
// 5.5 means the real figure is 5.5 or higher, so it is already outside the green
// band no matter what was missed; a mean of 2 could be anything.
//
// Grade the metric when the floor already breaches green. Withhold it when the
// floor sits inside green. Grading a floor yields the most generous score the
// evidence supports, which is the correct direction to err — it can never publish
// a system as worse than the measurement proves, and it can never publish a green
// the measurement cannot support. Without this, withholding the metric that read
// amber while scoring the one that read green published a full green and lifted
// the composite (observed on a real system, 2026-07-30).
const FLOOR_CREDIBLE_NOTE = 'the extractor under-counts dependencies on this stack, so the measured value is a '
  + 'floor — the real figure can only be higher, which means this grade is the most generous the evidence allows';
const FLOOR_INSIDE_GREEN_REASON = 'the code graph under-resolves this stack and every edge it misses pushes this '
  + 'metric down, so a reading inside the green band cannot be trusted — the missing dependencies could be the '
  + 'whole story. The value is measured and reported, but a clean result is not evidence of clean boundaries. '
  + 'Had the measurement already breached the threshold it would have been graded, since under-counting can '
  + 'only understate it';

// Everything that can stop the two graph-derived metrics from being graded, in
// one place. Returns a reason string when they cannot be graded, or null with the
// computed scores when they can. Separated out so a graph problem can no longer
// short-circuit the whole criterion -- change coupling does not use the graph and
// must survive its failure.
function evaluateGraphMetrics(r, graphDisposition) {
  const modules = (r.module_discovery && r.module_discovery.modules) || [];
  if (r.indeterminate) {
    return { blocked: (r.module_discovery && r.module_discovery.reason) || r.indeterminate };
  }
  if (modules.length < 2) {
    return { blocked: 'fewer than two modules discovered; cross-module coupling is undefined' };
  }
  // A graph with no dependency edges means the extractor missed the language.
  // That is not clean boundaries. Use positive-finite check.
  const edges = (r.graph && Number(r.graph.edges)) || 0;
  if (!Number.isFinite(edges) || edges <= 0) {
    return { blocked: 'no cross-module dependency edges resolved; the extractor did not understand this codebase' };
  }
  // Cycles block must be present and count must be a finite number, never omitted/null/non-number.
  const cycles = r.cycles || {};
  if (typeof cycles.count !== 'number' || !Number.isFinite(cycles.count)) {
    return { blocked: 'cycle count missing or not a number in the scan report' };
  }
  // Fan-out block must be present and mean must be a finite number, never omitted/null/non-number.
  const fanOut = r.fan_out || {};
  if (typeof fanOut.mean !== 'number' || !Number.isFinite(fanOut.mean)) {
    return { blocked: 'mean fan-out missing or not a number in the scan report' };
  }
  const CYCLE_BANDS = { greenBelow: 1, amberMax: 3, discrete: true };
  const FAN_BANDS = { greenBelow: 5, amberMax: 10, discrete: false };

  if (graphDisposition === 'unreliable') {
    // Per-metric, not per-criterion: grade whichever floor already breaches green.
    // See FLOOR_INSIDE_GREEN_REASON for why this asymmetry is the honest rule.
    const cycleBreaches = cycles.count >= CYCLE_BANDS.greenBelow;
    const fanBreaches = fanOut.mean >= FAN_BANDS.greenBelow;
    return {
      blocked: null,
      measured: true,
      floorGraded: cycleBreaches || fanBreaches,
      cycleCount: cycles.count,
      meanFanOut: fanOut.mean,
      cycleScore: cycleBreaches ? bandScore(cycles.count, CYCLE_BANDS) : null,
      cycleWithheld: cycleBreaches ? null : FLOOR_INSIDE_GREEN_REASON,
      fanScore: fanBreaches ? bandScore(fanOut.mean, FAN_BANDS) : null,
      fanWithheld: fanBreaches ? null : FLOOR_INSIDE_GREEN_REASON,
    };
  }
  return {
    blocked: null,
    measured: true,
    cycleCount: cycles.count,
    meanFanOut: fanOut.mean,
    cycleScore: bandScore(cycles.count, CYCLE_BANDS),
    cycleWithheld: null,
    fanScore: bandScore(fanOut.mean, FAN_BANDS),
    fanWithheld: null,
  };
}

// Change coupling reads git history, never the graph. Evaluated independently so
// a graph failure cannot take it down.
function evaluateCoupling(cc) {
  if (!cc) return { score: null, count: null, withheld: null };
  if (!cc.declarable) {
    return {
      score: null,
      count: null,
      withheld: 'this repo shape has no per-module dependency declaration to compare against, so '
        + '"co-changes with nothing declared" would be true of every pair and would mean nothing',
    };
  }
  if ((cc.qualifying_modules || 0) < 2) {
    return {
      score: null,
      count: null,
      withheld: `only ${cc.qualifying_modules || 0} module(s) reached the minimum revision count in the `
        + `last ${cc.window_days} days — too little history to tell coupling from coincidence`,
    };
  }
  const count = (cc.violations || []).length;
  return { score: bandScore(count, { greenBelow: 1, amberMax: 5, discrete: true }), count, withheld: null };
}

function scoreBoundaries(report, { assessedAt, graphDisposition = 'ok' } = {}) {
  const r = report || {};
  if (!r.applicable) return null;

  const modules = (r.module_discovery && r.module_discovery.modules) || [];
  const cycles = r.cycles || {};
  const cc = r.change_coupling || null;

  const graph = evaluateGraphMetrics(r, graphDisposition);
  // Each graph metric stands or falls on its own now. A hard block (no usable
  // graph at all) withholds both; an under-resolving extractor withholds only the
  // readings that landed inside green.
  const graphProduced = !!graph.measured;
  const cycleScore = graph.cycleScore != null ? graph.cycleScore : null;
  const fanScore = graph.fanScore != null ? graph.fanScore : null;
  const cycleWithheld = cycleScore === null ? (graph.cycleWithheld || graph.blocked) : null;
  const fanWithheld = fanScore === null ? (graph.fanWithheld || graph.blocked) : null;
  const cycleCount = graph.cycleCount;
  const meanFanOut = graph.meanFanOut;

  const coupling = evaluateCoupling(cc);
  const couplingScore = coupling.score;
  const couplingCount = coupling.count;
  const couplingWithheld = coupling.withheld;

  const findings = [];
  const actions = [];

  // Everything withheld is still surfaced, with the reason. Silence would read
  // as "nothing to see here", which is the opposite of the truth.
  // Only report a number when the graph actually produced it. A blocked graph
  // that produced nothing must not print "0 cycles".
  if (graphProduced) {
    if (cycleScore === null) {
      findings.push(
        `${cycleCount} circular dependenc${cycleCount === 1 ? 'y' : 'ies'} measured between the `
        + `${modules.length} declared modules (measured, not scored)`
      );
    }
    if (fanScore === null) {
      findings.push(`Mean module fan-out ${round1(meanFanOut)} measured across ${modules.length} modules (measured, not scored)`);
    }
    // The withholding reason is identical for both metrics, so say it once.
    const withheldReason = cycleWithheld || fanWithheld;
    if (withheldReason) findings.push(`Not scored on the code graph — ${withheldReason}`);
    if (graph.floorGraded) findings.push(`Graded on a lower bound — ${FLOOR_CREDIBLE_NOTE}`);
  } else {
    findings.push(`Not scored on the code graph — ${graph.blocked}`);
  }
  if (couplingWithheld) findings.push(`Hidden coupling not scored — ${couplingWithheld}`);

  const scoreable = [];
  if (cycleScore !== null) scoreable.push(cycleScore);
  if (fanScore !== null) scoreable.push(fanScore);
  if (couplingScore !== null) scoreable.push(couplingScore);

  // Nothing scoreable is indeterminate, never a default high mark.
  if (!scoreable.length) {
    return indeterminate(
      r,
      graph.blocked || cycleWithheld || fanWithheld || couplingWithheld || 'no sub-metric could be scored',
      assessedAt,
      findings,
      graphProduced ? { cycleCount, meanFanOut, cycleWithheld, fanWithheld } : {}
    );
  }

  const score = round1(scoreable.reduce((a, b) => a + b, 0) / scoreable.length);

  const ext = r.external_targets || {};
  const g = r.graph || {};
  const detect = r.external_target_detection;
  const weak = cycles.uncorroborated || [];

  if (cycleScore !== null) {
    if (cycleCount === 0) {
      findings.push(`No circular dependencies between the ${modules.length} declared modules`);
    } else {
      findings.push(`${cycleCount} circular dependenc${cycleCount === 1 ? 'y' : 'ies'} between modules`);
      const sourceArray = cycles.cycles || [];
      const cyclesToList = sourceArray.slice(0, 20);
      for (const c of cyclesToList) findings.push(`Cycle: ${c.join(' -> ')}`);
      // Fire truncation message only when the 20-item cap was hit, not when bounded enumeration cut cycles.
      if (sourceArray.length > 20) {
        findings.push(`(Listing truncated: ${sourceArray.length - 20} more cycles not shown)`);
      }
      actions.push('Break each module cycle by extracting the shared concern or inverting one dependency');
    }
    if (cycles.bounded) {
      findings.push(`Cycle enumeration was bounded: ${cycles.dropped} additional cycles not fully enumerated`);
    }

    // Cycles rejected by the corroboration rule are surfaced, never hidden: the
    // reader needs to know a cycle-shaped thing was seen and why it did not count.
    for (const u of weak.slice(0, 5)) {
      findings.push(
        `Uncorroborated cycle (not counted): ${u.cycle.join(' -> ')} — `
        + `${u.weak_directions.join(', ')} rests on a single link into a file whose name collides with a standard-library module, `
        + 'which is a known graphify misresolution'
      );
    }
    if (weak.length > 5) findings.push(`(${weak.length - 5} further uncorroborated cycles not listed)`);
  }

  if (fanScore !== null) {
    findings.push(`Mean module fan-out ${round1(meanFanOut)} across ${modules.length} modules`);
    if (meanFanOut > 5) actions.push('Reduce fan-out on the highest-degree modules — they are the widest blast radius for a change');
  }

  // Graph-quality evidence belongs to the reader whenever the graph produced
  // numbers, whether or not either metric was graded from them.
  if (graphProduced) {
    const extCount = new Set(Object.values(ext).flat()).size;
    if (extCount) findings.push(`${extCount} distinct external target(s) called from module code`);

    // No silent caps: the measured coverage and the threshold it passed are shown
    // even when the repo is scored, and so is the anchoring rejection count.
    if (g.module_graph_coverage != null) {
      findings.push(
        `Module-graph coverage ${(Number(g.module_graph_coverage) * 100).toFixed(1)}% `
        + `(${g.modules_connected}/${g.modules_declared} declared modules in the graph, `
        + `threshold ${(Number(g.module_graph_coverage_threshold) * 100).toFixed(0)}%)`
      );
    }
    if (g.skipped_stdlib_collision_edges) {
      findings.push(`${g.skipped_stdlib_collision_edges} import link(s) dropped as standard-library filename collisions`);
    }
    if (g.skipped_cross_language_edges) {
      findings.push(`${g.skipped_cross_language_edges} link(s) dropped as cross-language name collisions`);
    }
    if (detect && detect.unanchored_uri_literals_rejected != null) {
      findings.push(
        `External targets counted from ${detect.anchored_uri_literals} anchored call-site URI literal(s); `
        + `${detect.unanchored_uri_literals_rejected} unanchored literal(s) rejected`
      );
    }
  }

  // ─── Change coupling findings ──────────────────────────────────────────────
  if (couplingScore !== null) {
    if (couplingCount === 0) {
      findings.push(
        `No hidden couplings: every module pair that changes together in the last ${cc.window_days} days `
        + 'also declares a dependency'
      );
    } else {
      findings.push(
        `${couplingCount} module pair${couplingCount === 1 ? '' : 's'} change together without declaring a dependency`
      );
      for (const v of (cc.violations || []).slice(0, 10)) {
        findings.push(
          `Hidden coupling: ${v.a} and ${v.b} changed together in ${v.shared_revs} commits `
          + `(${v.degree}% coupling) with no declared dependency either way`
        );
      }
      if ((cc.violations || []).length > 10) {
        findings.push(`(Listing truncated: ${cc.violations.length - 10} more hidden couplings not shown)`);
      }
      actions.push('For each hidden coupling either declare the dependency or decouple the two modules');
    }
    // Bounds are always visible, per the no-silent-caps rule.
    if (cc.excluded_oversized_changesets) {
      findings.push(
        `${cc.excluded_oversized_changesets} sweeping changeset(s) excluded from the coupling signal `
        + '(more modules touched than the analysis cap)'
      );
    }
    if ((cc.unreadable_manifests || []).length) {
      findings.push(
        `${cc.unreadable_manifests.length} module manifest(s) could not be read, so their declared `
        + `dependencies are unknown: ${cc.unreadable_manifests.slice(0, 5).join(', ')}`
      );
    }
  }

  return {
    score,
    colour: colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: BOUNDARY_SOURCE,
    sub: {
      circular_dependencies: cycleScore !== null
        ? { score: cycleScore, colour: colourFor(cycleScore), count: cycleCount }
        : { score: null, colour: null, count: graphProduced ? cycleCount : null, withheld: cycleWithheld },
      module_fan_out: fanScore !== null
        ? { score: fanScore, colour: colourFor(fanScore), mean: round1(meanFanOut) }
        : { score: null, colour: null, mean: graphProduced ? round1(meanFanOut) : null, withheld: fanWithheld },
      cross_boundary_access: couplingScore !== null
        ? { score: couplingScore, colour: colourFor(couplingScore), count: couplingCount }
        : { score: null, colour: null, count: couplingCount, withheld: couplingWithheld },
    },
    findings,
    actions,
    audit: {
      discovery: r.module_discovery,
      modules: modules.length,
      cycles: {
        count: cycleCount,
        bounded: !!(r.cycles && r.cycles.bounded),
        dropped: (r.cycles && r.cycles.dropped) || 0,
        uncorroborated: weak,
      },
      fan_out: (r.fan_out && r.fan_out.per_module) || {},
      change_coupling: cc || null,
      external_targets: ext,
      external_target_detection: detect || null,
      graph: g,
    },
  };
}

module.exports = { scoreBoundaries, bandScore };


/***/ }),

/***/ 509:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// scripts/benchmark/score-deployment.js


// Pure C7 (Deployment Safety) scoring. Consumes the raw deployment report
// (per-capability evidence from scan-deployment.js) and applies a
// none->basic->mature rung ladder for the three tool capabilities plus a
// binary independent/coupled score for deployability. No hard-cap — an
// under-hardened deploy path is an operability risk, not a security emergency.

const { round1, colourFor } = __nccwpck_require__(588);

const CAPABILITIES = [
  { key: 'progressive_delivery', label: 'Progressive delivery', kind: 'ladder' },
  { key: 'automated_rollback', label: 'Automated rollback', kind: 'ladder' },
  { key: 'pipeline_safety', label: 'Pipeline safety', kind: 'ladder' },
  { key: 'independent_deployability', label: 'Independent deployability', kind: 'binary' },
];

const LADDER_SCORE = { none: 0.0, basic: 3.5, mature: 5.0 };
const arr = (x) => (Array.isArray(x) ? x : []);

function ladderRung(cap) {
  if (arr(cap.mature).length) return 'mature';
  if (arr(cap.basic).length) return 'basic';
  return 'none';
}

function ladderFinding(label, rung) {
  if (rung === 'mature') return `${label}: mature`;
  if (rung === 'basic') return `${label}: basic (present but not hardened)`;
  return `${label}: not detected in-repo`;
}

function ladderAction(label, rung) {
  const lower = label.toLowerCase();
  if (rung === 'mature') return null;
  if (rung === 'basic') return `Harden ${lower} — a basic mechanism exists; add the mature capability (see the criterion reference).`;
  return `Adopt ${lower} — no supported mechanism is declared in-repo. If it is handled by an external CD platform, surface it in-repo for agent visibility.`;
}

function scoreLadder(cap, capData, sub, audit, findings, actions, scored) {
  const c = capData || {};
  const rung = ladderRung(c);
  const score = LADDER_SCORE[rung];
  audit[cap.key] = { rung, mature: arr(c.mature), basic: arr(c.basic) };
  sub[cap.key] = { score, colour: colourFor(score), critical: false, rung };
  scored.push(score);
  findings.push(ladderFinding(cap.label, rung));
  const action = ladderAction(cap.label, rung);
  if (action) actions.push(action);
}

function scoreBinary(cap, capData, sub, audit, findings, actions, scored) {
  const c = capData || {};
  const independent = !!c.independent;
  const score = independent ? 5.0 : 2.0;
  const rung = independent ? 'independent' : 'coupled';
  audit[cap.key] = {
    rung,
    deployables: Number(c.deployables) || 0,
    deploy_paths: Number(c.deploy_paths) || 0,
  };
  sub[cap.key] = { score, colour: colourFor(score), critical: false, rung };
  scored.push(score);
  if (independent) {
    findings.push(`${cap.label}: independent`);
  } else {
    const n = audit[cap.key].deployables;
    findings.push(`${cap.label}: coupled${n ? ` (${n} deployables share a single deploy path)` : ''}`);
    actions.push('Make deployables independently releasable — give each unit its own deploy path so a change to one need not redeploy all.');
  }
}

function scoreDeployment(report, { assessedAt } = {}) {
  const r = report || {};
  const sub = {};
  const audit = {};
  const findings = [];
  const actions = [];
  const scored = [];

  for (const cap of CAPABILITIES) {
    if (cap.kind === 'binary') {
      scoreBinary(cap, r[cap.key], sub, audit, findings, actions, scored);
    } else {
      scoreLadder(cap, r[cap.key], sub, audit, findings, actions, scored);
    }
  }

  const score = scored.length ? round1(scored.reduce((a, s) => a + s, 0) / scored.length) : null;
  return {
    score,
    colour: score == null ? null : colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: 'deployment-safety readiness — progressive delivery / automated rollback / pipeline safety / independent deployability, from in-repo CI+IaC+Docker config (DORA capabilities)',
    sub,
    findings,
    actions,
    audit,
  };
}

module.exports = { scoreDeployment, CAPABILITIES };


/***/ }),

/***/ 126:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure C2 (Documented APIs) scoring. Pooled linear map over public GraphQL fields
// (Absinthe AST) and REST/OpenAPI operations/parameters/response-schema properties
// (phoenix_swagger AST): score = round1(5 * (gqlDescribed+restDescribed)/(gqlTotal+restTotal)).
// Returns null when the criterion does not apply (N/A), when REST is detected but
// produced zero parseable fields (detection failure), or when total is zero (Pending).
// Never a false green.

const { round1, colourFor } = __nccwpck_require__(588);

const TOP_UNDESCRIBED = 5;
const REST_LIMITATIONS = [
  'Shared parameter macros (e.g. CommonParameters.*) and compile-time param groups are not expanded — parameters they inject are not counted.',
  'Only the `parameters do`/`properties do` block forms are parsed; flat `parameter ...` calls, if any, are not counted.',
];

function facet(described, total) {
  const score = round1(5 * (described / total));
  return { score, colour: colourFor(score), pct: Math.round((described / total) * 100), described, total };
}

function scoreDocumentedApis(report, { assessedAt } = {}) {
  const r = report || {};
  if (!r.applicable) return null;                       // N/A (no machine API)

  const gqlTotal = Number(r.total) || 0;
  const gqlDescribed = Number(r.described) || 0;
  const rest = r.rest || null;
  const restTotal = rest ? Number(rest.total) || 0 : 0;
  const restDescribed = rest ? Number(rest.described) || 0 : 0;

  // REST tooling detected but the parse produced nothing -> detection failure.
  if (r.rest_api_detected && restTotal === 0) return null; // Pending, never false green

  const total = gqlTotal + restTotal;
  const described = gqlDescribed + restDescribed;
  if (total === 0) return null;                          // Pending (detection failure)

  const coverage = described / total;
  const score = round1(5 * coverage);
  const colour = colourFor(score);
  const pct = Math.round(coverage * 100);
  const multi = gqlTotal > 0 && restTotal > 0;

  const sub = {};
  if (gqlTotal > 0) sub.field_description_coverage = facet(gqlDescribed, gqlTotal);
  if (restTotal > 0) sub.rest_description_coverage = { ...facet(restDescribed, restTotal), by_kind: rest.by_kind };

  const findings = [];
  if (restTotal > 0) findings.push(`REST/OpenAPI descriptions: ${sub.rest_description_coverage.pct}% (${restDescribed} of ${restTotal})`);
  if (gqlTotal > 0) findings.push(`GraphQL field descriptions: ${sub.field_description_coverage.pct}% (${gqlDescribed} of ${gqlTotal})`);
  if (multi) findings.push(`Pooled documentation coverage: ${pct}% (${described} of ${total})`);

  const actions = [];
  const restUndesc = restTotal - restDescribed;
  const gqlUndesc = gqlTotal - gqlDescribed;
  if (restUndesc > 0) {
    actions.push(`Add descriptions to REST/OpenAPI (Swagger) operations, parameters, and response-schema properties — ${restUndesc} element${restUndesc === 1 ? '' : 's'} undescribed.`);
  }
  if (gqlUndesc > 0) {
    actions.push(`Add descriptions to public GraphQL fields — an agent reads names and types via introspection but relies on descriptions to use the API correctly. ${gqlUndesc} field${gqlUndesc === 1 ? '' : 's'} undescribed.`);
  }

  const byType = Array.isArray(r.by_type) ? r.by_type : [];
  const topUndescribed = byType
    .map((t) => ({ type: t.type, undescribed: (t.total || 0) - (t.described || 0) }))
    .filter((t) => t.undescribed > 0)
    .sort((a, b) => b.undescribed - a.undescribed)
    .slice(0, TOP_UNDESCRIBED);

  const audit = {
    files_parsed: Number(r.files_parsed) || 0,
    total: gqlTotal,
    described: gqlDescribed,
    top_undescribed_types: topUndescribed,
  };
  if (restTotal > 0) {
    audit.rest = { files_parsed: Number(rest.files_parsed) || 0, total: restTotal, described: restDescribed, by_kind: rest.by_kind };
    audit.pooled = { total, described };
    audit.limitations = REST_LIMITATIONS;
  }

  const source = multi
    ? 'API description coverage — pooled over public GraphQL fields (Absinthe AST) and REST/OpenAPI operations/parameters/response-schema properties (phoenix_swagger AST); anchor 100%'
    : (restTotal > 0
      ? 'API description coverage — REST/OpenAPI operations/parameters/response-schema properties (phoenix_swagger AST); anchor 100%'
      : 'API description coverage — non-empty description on public GraphQL fields (Absinthe schema, AST parse); anchor 100%');

  return { score, colour, critical: false, assessed: true, assessed_at: assessedAt, source, sub, findings, actions, audit };
}

module.exports = { scoreDocumentedApis };


/***/ }),

/***/ 845:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// scripts/benchmark/score-observability.js


// Pure C4 (Observable State) scoring. Consumes the raw observability report
// (per-pillar declared/configured/exercised evidence from scan-observability.js)
// and applies the "active not just present" rung ladder. No hard-cap — an
// under-instrumented system is an operability risk, not a security emergency.

const { round1, colourFor } = __nccwpck_require__(588);

const PILLARS = [
  { key: 'logging', label: 'Structured logging', tier: 'backend' },
  { key: 'tracing', label: 'Distributed tracing', tier: 'backend' },
  { key: 'backend_errors', label: 'Error tracking (backend)', tier: 'backend' },
  { key: 'frontend_errors', label: 'Error tracking (frontend)', tier: 'frontend' },
];

const RUNG_SCORE = { 0: 0.0, 1: 2.0, 2: 3.5, 3: 5.0 };
const RUNG_NAME = { 0: 'none', 1: 'declared', 2: 'configured', 3: 'exercised' };

const arr = (x) => (Array.isArray(x) ? x : []);

// Tracers that trace the app/LLM pipeline rather than cross-service infra
// requests. When a tracing pillar's declared set is ENTIRELY these, the finding
// is labeled so a green is not misread as APM-grade distributed tracing.
const LLM_TRACERS = ['langfuse', 'langsmith', 'openinference', '@arizeai/openinference', '@vercel/otel'];
const isLlmTracer = (lib) => LLM_TRACERS.some((t) => String(lib).includes(t));

// Highest evidence wins: exercised implies active regardless of the config heuristic.
function rungOf(p) {
  if (arr(p.exercised).length) return 3;
  if (arr(p.configured).length) return 2;
  if (arr(p.declared).length) return 1;
  return 0;
}

function pillarFinding(label, rung, libs) {
  const suffix = libs ? ` (${libs})` : '';
  if (rung === 3) return `${label}: active${suffix}`;
  if (rung === 2) return `${label}: configured but no usage detected${suffix}`;
  if (rung === 1) return `${label}: declared but not configured${suffix}`;
  return `${label}: not instrumented`;
}

function pillarAction(label, rung, libs) {
  const lower = label.toLowerCase();
  if (rung === 3) return null;
  if (rung === 2) return `Exercise ${lower} (${libs || 'the library'}) — add real call sites so it is active, not just configured.`;
  if (rung === 1) return `Configure and exercise ${lower} (${libs}) — it is declared but not wired up.`;
  return `Adopt ${lower} — no supported library is present.`;
}

function scoreObservability(report, { assessedAt } = {}) {
  const r = report || {};
  const sub = {};
  const audit = {};
  const findings = [];
  const actions = [];
  const scored = [];

  for (const pillar of PILLARS) {
    const p = r[pillar.key] || {};
    const applicable = pillar.tier === 'backend' ? true : !!p.applicable;
    audit[pillar.key] = {
      applicable,
      declared: arr(p.declared),
      configured: arr(p.configured),
      exercised: arr(p.exercised),
    };
    if (!applicable) {
      sub[pillar.key] = { applicable: false, score: null, colour: null };
      findings.push(`${pillar.label}: N/A (no frontend surface)`);
      continue;
    }
    const rung = rungOf(p);
    const score = RUNG_SCORE[rung];
    const libs = arr(p.declared).join(', ');
    audit[pillar.key].rung = RUNG_NAME[rung];
    sub[pillar.key] = {
      score, colour: colourFor(score), critical: false, applicable: true, rung: RUNG_NAME[rung],
    };
    scored.push(score);
    let finding = pillarFinding(pillar.label, rung, libs);
    if (pillar.key === 'tracing' && arr(p.declared).length && arr(p.declared).every(isLlmTracer)) {
      finding += ' — LLM/app-level tracing, not infra request tracing';
    }
    findings.push(finding);
    const action = pillarAction(pillar.label, rung, libs);
    if (action) actions.push(action);
  }

  const score = scored.length ? round1(scored.reduce((a, s) => a + s, 0) / scored.length) : null;
  return {
    score,
    colour: score == null ? null : colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: 'observability readiness — logs/traces/errors, declared→configured→exercised (deps + config + usage)',
    sub,
    findings,
    actions,
    audit,
  };
}

module.exports = { scoreObservability, PILLARS };


/***/ }),

/***/ 588:
/***/ ((module) => {



// Pure C9 scoring. Consumes normalized counts from parse-reports.js and applies
// the fixed convention anchors: 0 secrets, 0 Critical/High dependency CVEs (CIS v8),
// OWASP/CWE SAST severities. Any critical sub-metric flags the hard-cap.

function round1(n) {
  return Math.round(n * 10) / 10;
}

function colourFor(score) {
  if (score <= 2.0) return 'red';
  if (score <= 3.5) return 'amber';
  return 'green';
}

function scoreSecrets(count) {
  return count > 0
    ? { score: 0.0, colour: 'red', critical: true }
    : { score: 5.0, colour: 'green', critical: false };
}

function scoreSeverity(counts) {
  if (counts.critical > 0) return { score: 1.0, colour: 'red', critical: true };
  if (counts.high > 0) return { score: 2.5, colour: 'amber', critical: false };
  if (counts.medium > 0) return { score: 3.5, colour: 'amber', critical: false };
  return { score: 5.0, colour: 'green', critical: false };
}

function severityParts(c) {
  const parts = [];
  if (c.critical) parts.push(`${c.critical} Critical`);
  if (c.high) parts.push(`${c.high} High`);
  if (c.medium) parts.push(`${c.medium} Medium`);
  return parts;
}

// Only DIRECT deps are scored: prod CVEs carry production risk (full weight,
// can hard-cap); dev-only CVEs are discounted (folded into medium, never
// hard-cap). Transitive CVEs are excluded from scoring entirely — they're
// unactionable without their direct parent and are surfaced as informational.
function effectiveDeps({ prod, dev }) {
  return {
    critical: prod.critical,
    high: prod.high,
    medium: prod.medium + dev.critical + dev.high + dev.medium,
    low: prod.low + dev.low,
  };
}

// An allowed finding is stated alongside the count it was removed from, never
// silently dropped: "0 secrets" and "0 secrets, 2 allowed" are different claims
// and a reader is entitled to tell them apart.
function allowedNote(n) {
  return n > 0 ? `${n} allowed` : null;
}

function secretsFinding(secrets) {
  const confirmed = secrets.confirmed_secrets != null ? secrets.confirmed_secrets : secrets.secrets;
  const review = secrets.review_secrets || 0;
  const excluded = secrets.excluded_by_path || 0;
  const base = confirmed > 0
    ? `${confirmed} confirmed exposed secret(s) (gitleaks)`
    : 'No confirmed exposed secrets (gitleaks)';
  const extras = [];
  if (review > 0) extras.push(`${review} key-like string(s) to review`);
  if (excluded > 0) extras.push(`${excluded} test/fixture match(es) excluded`);
  const allowed = allowedNote(secrets.allowed || 0);
  if (allowed) extras.push(allowed);
  return extras.length ? `${base} · ${extras.join(' · ')}` : base;
}

function depsFinding(deps) {
  const parts = severityParts(deps.prod);
  let text = parts.length === 0
    ? 'No Critical/High CVEs in direct production dependencies (trivy)'
    : `${parts.join(', ')} direct production dependency CVEs (trivy)`;
  if (deps.dev.total > 0) text += `; ${deps.dev.total} dev-only CVE(s) discounted`;
  if (deps.transitive.total > 0) text += `; ${deps.transitive.total} transitive CVE(s) shown for info`;
  if (deps.allowed > 0) text += `; ${deps.allowed} allowed`;
  return text;
}

function sastFinding(sast) {
  const parts = severityParts(sast.triaged);
  let text = parts.length === 0
    ? 'No high-severity SAST findings (semgrep)'
    : `${parts.join(', ')} SAST findings (semgrep)`;
  if (sast.remapped > 0) text += `; ${sast.remapped} supply-chain-tag finding(s) remapped to info`;
  if (sast.allowed > 0) text += `; ${sast.allowed} allowed`;
  return text;
}

function scoreSecurity({ secrets, deps, sast, assessedAt }) {
  const eff = effectiveDeps(deps);
  const sub = {
    secrets: scoreSecrets(secrets.secrets),
    deps: scoreSeverity(eff),
    sast: scoreSeverity(sast.triaged),
  };
  const score = round1((sub.secrets.score + sub.deps.score + sub.sast.score) / 3);
  const critical = sub.secrets.critical || sub.deps.critical || sub.sast.critical;
  const colour = critical ? 'red' : colourFor(score);

  const findings = [secretsFinding(secrets), depsFinding(deps), sastFinding(sast)];

  const actions = [];
  if (secrets.secrets > 0) actions.push('Remove the exposed secret(s) and rotate the credentials; add a pre-commit gitleaks hook.');
  if ((secrets.review_secrets || 0) > 0) actions.push('Review the key-like strings flagged by the gitleaks generic rule — rotate any real secrets, allowlist confirmed false positives (public IDs, GA tags).');
  if (eff.critical > 0 || eff.high > 0) actions.push('Upgrade or patch dependencies with Critical/High CVEs (trivy) to a fixed version.');
  if (sast.triaged.critical > 0 || sast.triaged.high > 0) actions.push('Triage and fix the high-severity SAST findings (semgrep); add the rules to CI.');

  // `allowed` joins the raw -> filter -> triaged -> score trail as its own step,
  // so the chain stays inspectable: a reader can see that a number moved because
  // a person allowed something, not because a scanner stopped finding it.
  const audit = {
    secrets: {
      raw: secrets.raw_secrets || 0,
      triaged: secrets.triaged_secrets != null ? secrets.triaged_secrets : secrets.secrets,
      confirmed: secrets.confirmed_secrets != null ? secrets.confirmed_secrets : secrets.secrets,
      review: secrets.review_secrets || 0,
      excluded_by_path: secrets.excluded_by_path || 0,
      allowed: secrets.allowed || 0,
    },
    deps: {
      raw: deps.raw, prod: deps.prod, dev: deps.dev, transitive: deps.transitive,
      allowed: deps.allowed || 0,
    },
    sast: {
      raw: sast.raw,
      triaged: sast.triaged,
      remapped: sast.remapped || 0,
      excluded_by_path: sast.excluded_by_path || 0,
      allowed: sast.allowed || 0,
    },
  };

  return {
    score, colour, critical, assessed: true, assessed_at: assessedAt,
    source: 'gitleaks + trivy (vuln, prod/dev split) + semgrep (--config auto, triaged)',
    sub, findings, actions, audit,
  };
}

module.exports = {
  round1, colourFor, scoreSecrets, scoreSeverity, scoreSecurity, effectiveDeps,
};


/***/ }),

/***/ 327:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure C8 (Codebase Simplicity) scoring. Consumes normalized complexity +
// duplication counts (from parse-reports.js) and applies the fixed convention
// anchors: McCabe cyclomatic complexity <= 10 per function; code duplication < 5%.
// Unlike C9, C8 has NO hard-cap — over-complex code is a maintainability signal,
// not a security emergency, so it never forces the overall badge red on its own.

const { round1, colourFor } = __nccwpck_require__(588);

// Complexity sub-metric. The convention anchor is per-function (CC <= 10); the
// aggregate is the number of functions that VIOLATE it, normalized to a density
// per 1,000 lines of scanned source so systems of different sizes are comparable.
// 0 violations is the only unambiguous green (matches the original "0 violations
// = green" precedent). The density bands above 0 are a PROVISIONAL
// aggregation (no published anchor exists for "violations per KLOC") — flagged
// for review against the benchmark's scoring conventions.
function scoreComplexity({ violations = 0, loc = 0 } = {}) {
  if (violations === 0) return { score: 5.0, colour: 'green', critical: false };
  const density = violations / (Math.max(loc, 1) / 1000);
  let score;
  if (density <= 0.5) score = 4.0;
  else if (density <= 1.0) score = 3.0;
  else if (density <= 2.0) score = 2.5;
  else score = 1.5;
  return { score, colour: colourFor(score), critical: false };
}

// Duplication sub-metric. Anchor: jscpd duplication percentage < 5% (jscpd
// default). < 1% green, 1-5% amber (graded), > 5% red (graded). Scores land in
// the shared colour bands so colourFor stays consistent.
function scoreDuplication({ percentage = 0 } = {}) {
  let score;
  if (percentage < 1) score = 5.0;
  else if (percentage < 3) score = 3.5;
  else if (percentage <= 5) score = 2.8;
  else if (percentage <= 10) score = 2.0;
  else score = 1.0;
  return { score, colour: colourFor(score), critical: false };
}

// Name every tool that actually ran, and attribute the count to the tool that
// found it. The single top-level `tool` is the largest language's, so a
// per-language scan reported through it told one team that credo had found 57
// over-complex functions when credo found zero of them and lizard found all 57.
// `languages` is [{ language, tool, loc, violations }] when the builder supplies
// it; the flat form is retained for a consumer that has not been converted.
function toolAttribution(languages, fallbackTool) {
  const rows = (languages || []).filter((l) => l && l.tool);
  if (!rows.length) return { tools: fallbackTool ? [fallbackTool] : [], byTool: [] };
  const byTool = new Map();
  for (const l of rows) {
    const cur = byTool.get(l.tool) || { tool: l.tool, languages: [], violations: 0, loc: 0 };
    cur.languages.push(l.language);
    cur.violations += l.violations || 0;
    cur.loc += l.loc || 0;
    byTool.set(l.tool, cur);
  }
  const list = [...byTool.values()].sort((a, b) => b.loc - a.loc || a.tool.localeCompare(b.tool));
  return { tools: list.map((t) => t.tool), byTool: list };
}

function complexityFinding({
  violations, loc, tool, languages, allowed = 0,
}) {
  const { tools, byTool } = toolAttribution(languages, tool);
  const toolList = tools.length ? tools.join(' + ') : tool;
  // Stated in both branches. "No functions exceed 10" while three were allowed is
  // a materially different claim from the same sentence with nothing allowed, and
  // the zero case is exactly where a reader is least likely to go looking.
  const note = allowed > 0 ? ` · ${allowed} allowed` : '';
  if (violations === 0) {
    return `No functions exceed cyclomatic complexity 10 (${toolList}) across ${loc.toLocaleString()} lines${note}`;
  }
  const density = round1(violations / (Math.max(loc, 1) / 1000));
  // With more than one tool, say which one found what — otherwise the credit (or
  // the blame) lands on whichever language happened to be largest.
  const breakdown = byTool.length > 1
    ? ` — ${byTool.filter((t) => t.violations > 0).map((t) => `${t.violations} by ${t.tool} (${t.languages.join(', ')})`).join(', ')}`
    : ` (${toolList})`;
  return `${violations} function(s) over cyclomatic complexity 10${breakdown} — ${density} per 1k lines${note}`;
}

function duplicationFinding({ percentage, duplicated_lines, total_lines }) {
  if (percentage < 1) {
    return `Duplication ${percentage}% — below the 5% threshold (jscpd)`;
  }
  return `Duplication ${percentage}% (${duplicated_lines}/${total_lines} lines, jscpd)`;
}

// The enforcement facet. C8's direct measurement is censored on a gated repo — no
// function above the gate's threshold can merge — so a clean violation count there
// describes the gate, not the code. Scoring the gate makes that honest: an enforcing
// repo earns credit for enforcing, and an ungated repo is judged on its distribution.
//
// Rung -> score. The anchor of 10 is published (McCabe 1976); the LADDER is not.
// 0 / 2.0 / 3.5 / 5.0 is a convention this benchmark chose, and the 3.5
// above-anchor rung in particular is a judgement call marked as such on the
// criterion page rather than presented as fact beside the McCabe anchor. It takes
// the same shape as C6's configured-but-not-enforced rung. Grading the threshold
// rather than treating enforcement as binary follows from the anchor: we override
// ESLint's default of 20 down to 10 in our own measurement, so accepting a repo's
// 20 as full marks would contradict the standard we hold ourselves to.
const COMPLEXITY_ANCHOR = 10;

function gateRungScore({ rung, threshold }) {
  if (rung === 'enforced') return threshold != null && threshold <= COMPLEXITY_ANCHOR ? 5.0 : 3.5;
  if (rung === 'configured') return 2.0;
  return 0;
}

// Pooled over the same material languages the violations pool over, and weighted
// by each language's share of the measured LOC — the same weighting the density
// facet already gets for free by pooling violations and lines before dividing.
//
// Why weighted rather than a flat mean: a gate is protective in proportion to how
// much code it stands in front of. One umbrella enforces credo at 9 over 197k of
// its 298k measured lines and gates nothing else; an unweighted mean of
// [5.0, 0, 0, 0] reads 1.3, which describes a repo with essentially no complexity
// discipline. That is not that repo. Weighted, it reads 3.3. The same arithmetic
// runs the other way and is the more important half: a repo that gates only a
// twentieth of its code cannot buy a high gate score by having many tiny gated
// languages. Unweighted averaging flatters exactly the repo it should not.
//
// A gate entry with no loc falls back to equal weight, so a caller that has not
// been converted degrades to the previous behaviour rather than dividing by zero.
function scoreGate(gates = []) {
  if (!Array.isArray(gates) || gates.length === 0) return { score: null, colour: null, critical: false };
  const weights = gates.map((g) => (typeof g.loc === 'number' && g.loc > 0 ? g.loc : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const score = totalWeight > 0
    ? round1(gates.reduce((acc, g, i) => acc + gateRungScore(g) * weights[i], 0) / totalWeight)
    : round1(gates.reduce((acc, g) => acc + gateRungScore(g), 0) / gates.length);
  return {
    score, colour: colourFor(score), critical: false, weighted_by: totalWeight > 0 ? 'loc' : 'equal',
  };
}

function scoreSimplicity({
  complexity, duplication, tool, gates, languages, unmeasured, skippedImmaterial, assessedAt,
}) {
  const density = scoreComplexity(complexity);
  const gate = scoreGate(gates);
  // complexity = mean(measured density, enforcement) — mirrors C6's
  // mean(breadth, discipline). Where no gate could be determined the facet falls
  // back to the density alone rather than inventing a gate score.
  const cxParts = [density.score, gate.score].filter((s) => s != null);
  const cxScore = round1(cxParts.reduce((a, b) => a + b, 0) / cxParts.length);
  const cx = { score: cxScore, colour: colourFor(cxScore), critical: false, density, gate };
  const dup = scoreDuplication(duplication);
  const sub = { complexity: cx, duplication: dup };

  const scored = [cx, dup].filter((s) => s && s.score != null);
  const score = round1(scored.reduce((a, s) => a + s.score, 0) / scored.length);
  const colour = colourFor(score);

  const attribution = toolAttribution(languages, tool);
  const findings = [
    complexityFinding({ ...complexity, tool, languages }),
    duplicationFinding(duplication),
  ];
  for (const g of (gates || [])) {
    findings.push(g.rung === 'enforced'
      ? `${g.language}: complexity enforced in CI at ${g.threshold}`
      : g.rung === 'configured'
        ? `${g.language}: complexity rule configured but not enforced in CI`
        : `${g.language}: no complexity limit enforced`);
  }
  for (const u of (unmeasured || [])) {
    findings.push(`${u.loc.toLocaleString()} lines of ${u.extension} not measured for complexity — ${u.reason}`);
  }
  for (const s of (skippedImmaterial || [])) {
    findings.push(`${s.language} skipped for complexity: ${s.loc} lines is below the materiality floor`);
  }

  const gateList = gates || [];
  const enforcedLangs = gateList.filter((g) => g.rung === 'enforced').map((g) => g.language);
  const ungatedLangs = gateList.filter((g) => g.rung !== 'enforced').map((g) => g.language);

  const actions = [];
  if (complexity.violations > 0) {
    // The trailing clause used to assert "the complexity linter is already in CI to
    // hold the line" unconditionally — a false factual claim about another team's
    // pipeline whenever no gate was detected, and self-contradictory next to the
    // "make the linter step fail the build" advice appended below. Say only what
    // was actually detected.
    const base = 'Refactor the functions above cyclomatic complexity 10 (extract helpers, flatten branching)';
    if (enforcedLangs.length && !ungatedLangs.length) {
      actions.push(`${base}; the complexity linter is already in CI to hold the line.`);
    } else if (enforcedLangs.length) {
      actions.push(`${base}; CI already holds the line for ${enforcedLangs.join(', ')}, but not for ${ungatedLangs.join(', ')}.`);
    } else {
      actions.push(`${base}; no CI step currently enforces a complexity limit, so the count can grow unchecked.`);
    }
  }
  if (duplication.percentage >= 5) {
    actions.push('Extract the duplicated blocks (jscpd report lists locations) into shared modules; duplication above 5% makes the canonical pattern ambiguous for agents.');
  } else if (duplication.percentage >= 1) {
    actions.push('Review the duplicated blocks flagged by jscpd — consolidate where a single canonical implementation is clearer.');
  }
  if (ungatedLangs.length) {
    actions.push(`Add a cyclomatic-complexity limit of 10 to the linter config for ${ungatedLangs.join(', ')} and make the linter step fail the build.`);
  }

  const audit = {
    complexity: {
      // `tool` remains the largest language's, for consumers reading the scalar.
      // `tools` and `by_language` are the honest record: which tool measured what,
      // over how many lines, and how many violations it is responsible for.
      tool,
      tools: attribution.tools,
      by_language: (languages || []).filter((l) => l && l.tool).map((l) => ({
        language: l.language, tool: l.tool, loc: l.loc || 0, violations: l.violations || 0,
      })),
      threshold: 10,
      violations: complexity.violations || 0,
      loc: complexity.loc || 0,
      allowed: complexity.allowed || 0,
    },
    duplication: {
      tool: 'jscpd',
      threshold_pct: 5,
      percentage: duplication.percentage || 0,
      duplicated_lines: duplication.duplicated_lines || 0,
      total_lines: duplication.total_lines || 0,
      clones: duplication.clones || 0,
    },
  };

  return {
    score,
    colour,
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: `${(attribution.tools.length ? attribution.tools : [tool]).join(' + ')} (cyclomatic complexity, max 10) + jscpd (duplication, <5%)`,
    sub,
    findings,
    actions,
    audit,
  };
}

module.exports = {
  scoreComplexity, scoreDuplication, scoreGate, scoreSimplicity, toolAttribution,
};


/***/ }),

/***/ 985:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



// Pure C6 (Test Coverage) scoring. Static readiness/discipline only — no suite
// execution (actual coverage % is deferred to the Monitor layer). C6 = mean of
// two facets: Breadth (linear test<->source file-presence proxy, pooled across
// stacks) and Discipline (CI-enforced coverage rung ladder graded on Google
// 60/75/90 tiers, mean of applicable stacks). No hard-cap. Returns null when
// N/A or when there is nothing to score — never a false green.

const { round1, colourFor } = __nccwpck_require__(588);

const STACK_LABEL = {
  elixir: 'Elixir', ruby: 'Ruby', frontend: 'Frontend', python: 'Python',
};

// Enforced-threshold value -> Google tier score.
function tierScore(meanThreshold) {
  if (meanThreshold >= 90) return 5.0;
  if (meanThreshold >= 75) return 4.25;
  if (meanThreshold >= 60) return 3.5;
  return 2.5;
}

// One stack's discipline rung + score from its tooling block.
function disciplineForStack(tooling) {
  const t = tooling || {};
  const thresholds = (Array.isArray(t.thresholds) ? t.thresholds : []).filter((n) => Number(n) > 0);
  if (thresholds.length) {
    // Enforced thresholds imply the tool is present, regardless of the present flag
    // (a scan may detect a threshold without matching a tool-name string).
    const mean = thresholds.reduce((a, b) => a + b, 0) / thresholds.length;
    return { rung: 'enforced', score: tierScore(mean), thresholds };
  }
  if (t.present) return { rung: 'configured', score: 2.0, thresholds: [] };
  return { rung: 'none', score: 0.0, thresholds: [] };
}

function scoreTestCoverage(report, { assessedAt } = {}) {
  const r = report || {};
  if (!r.applicable) return null;
  const stacks = r.stacks || {};
  const keys = Object.keys(stacks);
  if (!keys.length) return null;

  // Breadth: pooled across all stacks.
  let totalSource = 0;
  let totalTested = 0;
  const byStackBreadth = {};
  for (const k of keys) {
    const s = stacks[k] || {};
    totalSource += Number(s.source_files) || 0;
    totalTested += Number(s.tested_files) || 0;
    byStackBreadth[k] = { source: Number(s.source_files) || 0, tested: Number(s.tested_files) || 0 };
  }
  if (totalSource === 0) return null;
  const breadthCoverage = totalTested / totalSource;
  const breadthScore = round1(5 * breadthCoverage);

  // Discipline: mean of applicable stacks.
  const byStackDiscipline = {};
  const disciplineScores = [];
  for (const k of keys) {
    const d = disciplineForStack((stacks[k] || {}).tooling);
    byStackDiscipline[k] = {
      tool: (stacks[k].tooling || {}).tool || null,
      present: !!(stacks[k].tooling || {}).present,
      rung: d.rung,
      score: d.score,
      thresholds: d.thresholds,
    };
    disciplineScores.push(d.score);
  }
  const disciplineScore = disciplineScores.reduce((a, b) => a + b, 0) / disciplineScores.length;

  const score = round1((breadthScore + disciplineScore) / 2);
  const pct = Math.round(breadthCoverage * 100);
  const untestedTotal = totalSource - totalTested;

  const findings = [
    `Test breadth: ${pct}% (${totalTested} of ${totalSource} source files have a paired test) — file-presence proxy, not line coverage`,
  ];

  // Discipline finding: summarise the enforcement picture across stacks.
  const enforcedBits = keys
    .filter((k) => byStackDiscipline[k].rung === 'enforced')
    .map((k) => `${STACK_LABEL[k] || k} ${byStackDiscipline[k].thresholds.join('/')}`);
  const configuredBits = keys.filter((k) => byStackDiscipline[k].rung === 'configured').map((k) => STACK_LABEL[k] || k);
  const noneBits = keys.filter((k) => byStackDiscipline[k].rung === 'none').map((k) => STACK_LABEL[k] || k);
  if (enforcedBits.length) findings.push(`Coverage enforced in CI: ${enforcedBits.join(', ')}`);
  if (configuredBits.length) findings.push(`Coverage tool configured but no threshold enforced: ${configuredBits.join(', ')}`);
  if (noneBits.length) findings.push(`No coverage tooling detected: ${noneBits.join(', ')}`);

  const actions = [];
  if (untestedTotal > 0) {
    actions.push(`Add tests for untested source files — ${untestedTotal} source file${untestedTotal === 1 ? ' has' : 's have'} no paired test file (file-presence proxy; a paired test does not guarantee line coverage).`);
  }
  if (noneBits.length) {
    actions.push(`Adopt a coverage tool and enforce a minimum threshold in CI for: ${noneBits.join(', ')} (Google acceptable floor is 60%).`);
  }
  if (configuredBits.length) {
    actions.push(`Enforce a minimum coverage threshold in CI for: ${configuredBits.join(', ')} — a tool is configured but no threshold gates the build (minimum_coverage 0 does not count).`);
  }

  return {
    score,
    colour: colourFor(score),
    critical: false,
    assessed: true,
    assessed_at: assessedAt,
    source: 'Test-coverage readiness — breadth (test↔source file-presence proxy, pooled full-stack) + discipline (CI-enforced coverage, Google 60/75/90 tiers). Static/headless; actual coverage % deferred to Monitor.',
    sub: {
      test_breadth: {
        score: breadthScore, colour: colourFor(breadthScore), pct, tested: totalTested, total: totalSource,
      },
      coverage_discipline: {
        score: disciplineScore, colour: colourFor(disciplineScore),
      },
    },
    findings,
    actions,
    audit: {
      breadth: { total_source: totalSource, total_tested: totalTested, by_stack: byStackBreadth },
      discipline: { by_stack: byStackDiscipline },
    },
  };
}

module.exports = { scoreTestCoverage };


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
/******/ 	var __webpack_exports__ = __nccwpck_require__(171);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;