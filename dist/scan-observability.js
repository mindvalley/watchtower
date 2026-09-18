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

/***/ 170:
/***/ ((module) => {

// scripts/benchmark/observability-signals.js


// Detection signals for C4 observability readiness, per stack × pillar.
// deps  — library names to match in the manifest (declared rung)
// config — regexes to match in config files (configured rung)
// usage  — regexes to match in source files (exercised rung)
// Approximate by design; validated against real repos before publish and
// tuned there. Adding a library = edit a list here, no logic change.

module.exports = {
  elixir: {
    logging: {
      deps: ['logger_json', 'ink', 'logfmt'],
      config: [/LoggerJSON/, /:logger_json/, /format:\s*\{/, /metadata:\s*\[/],
      usage: [/\bLogger\.(debug|info|warn|warning|error)\b/],
    },
    tracing: {
      deps: ['opentelemetry', 'opentelemetry_api', 'mv_opentelemetry', 'spandex', 'tapper'],
      config: [/:opentelemetry/, /otlp/i, /MvOpentelemetry/, /:spandex/],
      usage: [/OpenTelemetry|OpenTelemetry\.Tracer|MvOpentelemetry|Spandex/],
    },
    errors: {
      deps: ['sentry', 'appsignal', 'rollbax', 'honeybadger'],
      config: [/:sentry|dsn:/i, /:appsignal/, /:rollbax/, /:honeybadger/],
      usage: [/Sentry\.(capture|set_context)|Appsignal\.|Rollbax\.|PlugCapture/],
    },
  },
  ruby: {
    logging: {
      deps: ['lograge', 'semantic_logger', 'ougai'],
      config: [/lograge/i, /SemanticLogger/, /Ougai/],
      usage: [/lograge|SemanticLogger|Rails\.logger/],
    },
    tracing: {
      deps: ['opentelemetry-sdk', 'opentelemetry-instrumentation-all', 'ddtrace'],
      config: [/OpenTelemetry|Datadog|ddtrace/],
      usage: [/OpenTelemetry|Datadog::Tracing|Tracer/],
    },
    errors: {
      deps: ['sentry-ruby', 'sentry-rails', 'rollbar', 'bugsnag', 'honeybadger', 'appsignal'],
      // AppSignal configures via config/appsignal.yml (lowercase keys, no "Appsignal"
      // string) — match its push_api_key marker as well as the initializer patterns.
      config: [/Sentry\.init|Rollbar\.configure|Bugsnag\.configure|Honeybadger|Appsignal|push_api_key/],
      // AppSignal auto-instruments Rails (config in config/appsignal.yml, few explicit
      // calls), so match its namespace as well as the classic explicit trackers.
      usage: [/Sentry\.capture|Rollbar\.|Bugsnag\.|Honeybadger\.notify|Appsignal[.:]/],
    },
  },
  js: {
    logging: {
      deps: ['pino', 'pino-http', 'pino-pretty', 'nestjs-pino', 'winston', 'bunyan'],
      // config markers are library-specific only. `createLogger(` is generic (any
      // hand-rolled console wrapper has it) so it lives in `usage`, where the
      // exercised-requires-declared gate protects it — it must NOT sit here or a
      // custom createLogger in a config file would forge a rung-2/3 score.
      config: [/nestjs-pino|LoggerModule/, /new winston/],
      // Anchored to library fingerprints, not a bare logger.info (any console
      // wrapper has that -> false green).
      usage: [/\bpino\(/, /PinoLogger/, /nestjs-pino/, /createLogger\(/, /\bLoggerModule\b/],
    },
    tracing: {
      deps: ['@opentelemetry/api', '@opentelemetry/sdk', '@vercel/otel', 'dd-trace',
        'langfuse', 'langsmith', '@arizeai/openinference'],
      config: [/registerOTel|@vercel\/otel/, /NodeSDK|BasicTracerProvider/, /LANGFUSE_|LANGSMITH_|LANGCHAIN_TRACING/],
      usage: [/registerOTel|@vercel\/otel/, /trace\.getTracer/, /\bLangfuse\(/, /CallbackHandler/,
        /langsmith|LangSmith/, /openinference|OpenInference/],
    },
    errors: {
      deps: ['@sentry/node', '@sentry/nextjs', '@sentry/bun', 'rollbar', '@bugsnag/js', 'bugsnag'],
      config: [/Sentry\.init\(/, /new Rollbar\(/, /Bugsnag\.start\(/],
      usage: [/captureException|Sentry\.capture/, /Rollbar\.(error|warning|critical)/, /Bugsnag\.notify/],
    },
  },
  python: {
    logging: {
      deps: ['structlog', 'loguru', 'python-json-logger'],
      config: [/structlog\.configure/, /logging\.config\.(dictConfig|fileConfig)/, /loguru/],
      // Structured-logger fingerprints only; bare stdlib logging.getLogger is not
      // "structured logging" and must not count.
      usage: [/structlog\.(get_logger|configure)/, /from loguru/, /loguru\.logger/],
    },
    tracing: {
      deps: ['opentelemetry', 'opentelemetry-sdk', 'opentelemetry-instrumentation',
        'ddtrace', 'langfuse', 'langsmith', 'openinference-instrumentation', 'openinference'],
      config: [/TracerProvider|set_tracer_provider/, /OTEL_|otlp/i, /LANGFUSE_|LANGSMITH_|LANGCHAIN_TRACING/],
      usage: [/\bLangfuse\(|langfuse/, /CallbackHandler/, /langsmith|LangSmith/,
        /trace\.get_tracer/, /openinference|OpenInference/, /@observe\b/],
    },
    errors: {
      deps: ['sentry-sdk', 'rollbar', 'bugsnag', 'honeybadger'],
      config: [/sentry_sdk\.init/, /rollbar\.init|ROLLBAR/, /Bugsnag\.configure/],
      usage: [/sentry_sdk\.(capture|init)/, /capture_exception/, /rollbar\.(report|error)/, /\bbugsnag\./],
    },
  },
  frontend: {
    errors: {
      deps: ['@sentry/vue', '@sentry/browser', '@sentry/react', '@bugsnag/js', 'bugsnag', 'rollbar'],
      config: [/Sentry\.init\(/, /Bugsnag\.start\(/, /Rollbar\(/],
      // Real error-tracker call sites only. A bare Vue `app.config.errorHandler`
      // is error HANDLING, not error TRACKING — excluded to avoid false greens on
      // systems with no reporting library (Sentry.init-with-app still counts as it
      // IS the Vue integration).
      usage: [/Sentry\.init\([^)]*[Aa]pp|captureException|Bugsnag\.notify|Rollbar\.(error|warning|critical|log)/],
    },
    frameworks: ['vue', '@vue/runtime-core', 'react', 'nuxt'],
  },
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

/***/ 286:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {

// scripts/benchmark/scan-observability.js


/*
 * Observability readiness scan (C4) — I/O entrypoint (the black-box edge). The
 * pure per-repo logic lives in scanRepo(repoDir, stack) and is exported so the
 * parity gate can run the real pipeline on the five pilots. main() clones ONE
 * repo (shallow, by SYSTEM env) and writes reports/<system>/observability.json:
 * per pillar { declared[], configured[], exercised[] } (+ applicable for FE).
 *
 * declared   — signal lib appears in a manifest (mix.exs / Gemfile / package.json / pyproject)
 * configured — a config file matches the pillar's config regex
 * exercised  — a source file matches the pillar's usage regex
 *
 * Agnostic-first: backend pillars (logging/tracing/backend_errors) apply to every
 * stack (all systems in scope run servers); vendor recognition is a per-stack
 * superset in observability-signals.js. Absent instrumentation scores an honest
 * rung 0 in the scorer — never a false green. No stack guard: every system is
 * scanned and scored. Reads source only, no compile.
 *
 * Env: SYSTEM (key in benchmark.overrides.json), GH_TOKEN (clone auth).
 */

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const SIGNALS = __nccwpck_require__(170);

const { systemConfig, reportsDir, systemTarget } = __nccwpck_require__(880);
const { materialise } = __nccwpck_require__(639);
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

const SKIP_DIRS = new Set(['node_modules', 'deps', '_build', '.git', '.elixir_ls', 'priv', 'tmp']);
const MAX_HITS = 5; // cap evidence samples per pillar rung

// overrides stack -> backend signal key in observability-signals.js
const BACKEND_KEY = {
  elixir: 'elixir', ruby: 'ruby', ts: 'js', js: 'js', python: 'python',
};
// backend source extensions per signal key
const SOURCE_EXTS = {
  elixir: ['.ex', '.exs'],
  ruby: ['.rb'],
  js: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
};
// backend manifest filename predicate per signal key. elixir/ruby use the SAME
// union the pre-refactor scan collected (mix + Gemfile), so the pilot manifest
// blob is byte-identical; js/python add their own.
const MANIFEST_MATCH = {
  elixir: (n) => n === 'mix.exs' || n === 'mix.lock' || n === 'Gemfile' || n === 'Gemfile.lock',
  ruby: (n) => n === 'mix.exs' || n === 'mix.lock' || n === 'Gemfile' || n === 'Gemfile.lock',
  js: (n) => n === 'package.json',
  python: (n) => n === 'pyproject.toml' || /^requirements.*\.txt$/.test(n),
};

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

// Walk the tree collecting file paths (absolute) whose name/full-path matches.
function collect(rootDir, matchFn) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (matchFn(e.name, full)) {
        out.push(full);
      }
    }
  };
  walk(rootDir, 0);
  return out;
}

const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const rel = (repoDir, f) => path.relative(repoDir, f);

// Does any file match any regex? Return matching rel paths (capped at MAX_HITS).
function hits(repoDir, files, patterns) {
  const found = [];
  for (const f of files) {
    const text = readText(f);
    if (patterns.some((re) => re.test(text))) {
      found.push(rel(repoDir, f));
      if (found.length >= MAX_HITS) break;
    }
  }
  return found;
}

// declared: which signal libs appear anywhere in the manifest blob.
function declaredLibs(manifestBlob, libs) {
  return libs.filter((lib) => manifestBlob.includes(lib));
}

function scanPillar({ manifestBlob, configFiles, sourceFiles, repoDir }, sig) {
  return {
    declared: declaredLibs(manifestBlob, sig.deps),
    configured: hits(repoDir, configFiles, sig.config),
    exercised: hits(repoDir, sourceFiles, sig.usage),
  };
}

// Build the full observability report for an ALREADY-CLONED repo. Pure w.r.t.
// the filesystem at repoDir (no network). Exported so the parity gate runs the
// real pipeline on the five.
function scanRepo(repoDir, stack) {
  // Fail loud on an unmapped stack rather than defaulting to elixir — a future
  // stack (go/php/…) must land as Pending ("not measured"), never be scored with
  // the wrong stack's signals and skip the honesty gate.
  const backendKey = BACKEND_KEY[stack];
  if (!backendKey) throw new Error(`C4: no observability signal set for stack '${stack}' — add it to BACKEND_KEY/SIGNALS or leave the system Pending`);
  const isPilot = backendKey === 'elixir' || backendKey === 'ruby';

  const manifestFiles = collect(repoDir, MANIFEST_MATCH[backendKey]);
  const manifestBlob = manifestFiles.map(readText).join('\n');

  // Config files. Pilots keep the EXACT original collection (/config/ + exs|rb|yml)
  // so the pilot config set is byte-identical. js/python additively include their
  // config conventions — the five carry none of these files.
  const configFiles = collect(repoDir, (n, full) => {
    const inConfigDir = /\/config\//.test(full) && /\.(exs?|rb|ya?ml)$/.test(n);
    if (isPilot) return inConfigDir;
    return inConfigDir
      || /\.config\.(ts|js|mjs|cjs)$/.test(n)
      || /^instrumentation\.(ts|js)$/.test(n)
      || /^sentry\..*\.config\./.test(n)
      || n === 'settings.py'
      || (/\/config\//.test(full) && /\.(ts|js|py|ya?ml)$/.test(n));
  });

  const exts = SOURCE_EXTS[backendKey];
  const sourceFiles = collect(repoDir, (n) => exts.some((x) => n.endsWith(x)));

  const be = SIGNALS[backendKey];
  const ctx = { manifestBlob, configFiles, sourceFiles, repoDir };
  const report = {
    logging: scanPillar(ctx, be.logging),
    tracing: scanPillar(ctx, be.tracing),
    backend_errors: scanPillar(ctx, be.errors),
  };

  // Recognition-based stacks (js/python) only credit `exercised` when the library
  // is actually declared or configured. Elixir/Ruby have an implicit blessed
  // logger (Logger / Rails.logger) so a usage hit alone is meaningful there; in
  // JS/Python a usage-regex hit with NO declaration is a string coincidence —
  // posthog's `captureException` (excluded by decision), a custom `createLogger`,
  // etc. — and would false-green a pillar the system doesn't really instrument.
  if (!isPilot) {
    for (const key of ['logging', 'tracing', 'backend_errors']) {
      const p = report[key];
      if (!p.declared.length && !p.configured.length) p.exercised = [];
    }
  }

  // --- Frontend errors pillar (unchanged logic) ---
  const pkgFiles = collect(repoDir, (n) => n === 'package.json');
  const pkgBlob = pkgFiles.map(readText).join('\n');
  const feFrameworks = SIGNALS.frontend.frameworks;
  const vueTsxCount = collect(repoDir, (n) => n.endsWith('.vue') || n.endsWith('.tsx')).length;
  const applicable = feFrameworks.some((fw) => pkgBlob.includes(`"${fw}"`)) || vueTsxCount >= 10;

  if (applicable) {
    const feEntry = collect(repoDir, (n, full) => (
      /\.(js|ts)$/.test(n) && /(assets|src)\//.test(full) && /(app|main|index|entry)\./.test(n)
    ));
    const feAll = collect(repoDir, (n, full) => /\.(js|ts|vue)$/.test(n) && /(assets|src)\//.test(full));
    const feDeclared = declaredLibs(pkgBlob, SIGNALS.frontend.errors.deps);
    let feExercised = hits(repoDir, feAll, SIGNALS.frontend.errors.usage);
    // A framework errorHandler forwarding to a DECLARED tracker is a real
    // integration; a bare errorHandler with no tracker library is just error
    // handling (false green). So errorHandler counts only when a tracker is declared.
    if (feDeclared.length && !feExercised.length) {
      feExercised = hits(repoDir, feAll, [/errorHandler/]);
    }
    // Same honesty gate as the backend pillars, for the recognition-based stacks:
    // a frontend `captureException` with no declared tracker is posthog/custom,
    // not real error tracking. Pilots (elixir/ruby) keep the original behavior.
    if (!isPilot && !feDeclared.length) feExercised = [];
    report.frontend_errors = {
      applicable: true,
      declared: feDeclared,
      configured: hits(repoDir, feEntry.length ? feEntry : feAll, SIGNALS.frontend.errors.config),
      exercised: feExercised,
    };
  } else {
    report.frontend_errors = {
      applicable: false, declared: [], configured: [], exercised: [],
    };
  }

  return report;
}

function main() {
  const cfg = systemConfig(SYSTEM);
  const outDir = reportsDir(SYSTEM);
  const tree = materialise(systemTarget(SYSTEM), { prefix: `c4-${SYSTEM}`, token: GH_TOKEN });

  // The tree used to be left on disk after every run, token and all. Removed in
  // a `finally` now, which also matters for a local target: nothing here may
  // touch the source folder, and the only thing it can remove is its own copy.
  try {
    for (const note of tree.notes) console.log(`  ${note}`);
    const report = scanRepo(tree.dir, cfg.stack);
    writeJson(outDir, 'observability', report);
    const fe = report.frontend_errors.applicable ? 'FE:on' : 'FE:N/A';
    console.log(`Scanned C4 ${SYSTEM} (${tree.label}, ${cfg.stack}->${BACKEND_KEY[cfg.stack]}, ${fe}) -> ${outDir}`);
  } finally {
    tree.cleanup();
  }
}

if (require.main === require.cache[eval('__filename')]) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { main, scanRepo, collect };


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
/******/ 	var __webpack_exports__ = __nccwpck_require__(286);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;