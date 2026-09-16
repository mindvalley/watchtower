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

/***/ 571:
/***/ ((module) => {



// Does this repo ENFORCE a complexity limit, and at what number?
//
// This is the breadcrumb half of C8's complexity facet, and it exists because the
// direct measurement is censored on gated repos: one pilot runs credo as a failing
// CI step with the cyclomatic check on at its default of 9, so no function above 9
// can merge and its zero violations restate the gate rather than describe the code.
// Scoring the gate turns that from a false green into an honest finding.
//
// Detection is per language. A repo that gates its Elixir says nothing about its
// TypeScript, and treating one gate as repo-wide would hand full marks to a repo
// that leaves its largest language open.
//
// GitHub Actions only, matching C6's shipped scope. Enforcement we cannot see reads
// `configured`, which understates rather than false-greens.

const LINTER_DEFAULT_THRESHOLD = Object.assign(Object.create(null), {
  credo: 9, rubocop: 7, eslint: 20,
});

// Which linters can gate which language, in precedence order.
const LANGUAGE_LINTERS = Object.assign(Object.create(null), {
  elixir: ['credo'],
  ruby: ['rubocop'],
  javascript: ['eslint', 'lizard'],
  typescript: ['eslint', 'lizard'],
  vue: ['eslint'],
  python: ['lizard'],
});

// A CI step that runs the linter in a way that fails the build. The step must not
// be marked continue-on-error — that is a report, not a gate.
const CI_INVOCATION = Object.assign(Object.create(null), {
  credo: /\bmix\s+credo\b/,
  rubocop: /\brubocop\b/,
  eslint: /\beslint\b|\brun\s+lint\b|\bnpm\s+run\s+lint\b|\byarn\s+lint\b|\bpnpm\s+lint\b/,
  lizard: /\blizard\b|\bxenon\b/,
});

function isEnforcedInCi(linter, workflowText) {
  if (!workflowText) return false;
  const re = CI_INVOCATION[linter];
  if (!re) return false;
  // Scope the continue-on-error check to the YAML step block that contains the
  // matched run: line. A step block runs from its opening "- " list item to the
  // next list item at the same (or lower) indent. This handles:
  //   - continue-on-error appearing BEFORE run: in the same step
  //   - a neighbouring step's continue-on-error being falsely attributed here
  const lines = String(workflowText).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!re.test(lines[i])) continue;
    const runIndent = lines[i].match(/^(\s*)/)[1].length;

    // Scan backward to the nearest "- " list item at a lower or equal indent.
    // Default to i (the invocation line itself) when none is found — this happens
    // when the linter step is the first step in a job and the workflow header
    // (jobs:, on:, etc.) precedes it at indent 0. Falling back to i gives
    // stepIndent = runIndent, so the forward scan uses the run: line's own indent
    // as the boundary, which correctly terminates at the next same-level step.
    let stepStart = i;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (/^\s*-\s/.test(lines[j])) {
        const itemIndent = lines[j].match(/^(\s*)/)[1].length;
        if (itemIndent <= runIndent) { stepStart = j; break; }
      }
    }

    const stepIndent = lines[stepStart].match(/^(\s*)/)[1].length;

    // Scan forward to the next "- " at the same or lower indent — that is the
    // opening of the following step and the end of this one.
    let stepEnd = lines.length;
    for (let j = stepStart + 1; j < lines.length; j += 1) {
      if (/^\s*-\s/.test(lines[j])) {
        const itemIndent = lines[j].match(/^(\s*)/)[1].length;
        if (itemIndent <= stepIndent) { stepEnd = j; break; }
      }
    }

    const stepBlock = lines.slice(stepStart, stepEnd).join('\n');
    if (/continue-on-error\s*:\s*true/i.test(stepBlock)) continue;
    return true;
  }
  return false;
}

// Strip JS-style comments before any pattern matching so that rule names appearing
// in comments (// complexity: ...) do not produce false positives. JSON and YAML
// configs have no valid `//` comments, so this is a no-op for them; YAML `#`
// comments are left alone because `#` is legal inside JS strings.
function stripJsComments(text) {
  return String(text)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

// Strip Elixir comments (`#` to end of line) before reading a credo config, for
// the same reason stripJsComments exists — except the credo branch read raw text
// at three decision points, and `mix credo.gen.config` emits a long check list
// that people routinely comment entries out of. Commented text reaching the
// detector is the normal case here.
//
// Quoted strings are honoured because credo configs carry globs and regex sigils
// (`~r"/_build/"`, `files: %{included: ["lib/"]}`) whose delimiter is `"`, and a
// `#` can legally sit inside one. A naive strip-to-end-of-line would swallow the
// rest of the config.
//
// Where this parser is imperfect — an exotic sigil delimiter, a quote nested in
// `#{}` interpolation — it over-strips, which loses the check name and reads
// `enabled: false`: gate rung none, a lower score. The failure mode errs to a
// false RED, never a false green, which is the direction this module must fail in.
//
// Newlines are preserved so the enabled:/disabled: recency comparison below still
// sees the config's real line structure.
function stripElixirComments(text) {
  const s = String(text);
  let out = '';
  let inString = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < s.length) {
        out += s[i + 1];
        i += 1;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '#') {
      while (i < s.length && s[i] !== '\n') i += 1;
      if (i < s.length) out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

// The ESLint `complexity` rule key, in both spellings a real config uses.
//
// Quoted (`"complexity":`) covers JSON and legacy .eslintrc. Unquoted covers
// ESLint v9 flat config and YAML. The unquoted form previously required the key to
// start a line, which missed the perfectly ordinary single-line
// `{ complexity: ['error', 15] }` — so the negative lookbehind replaces the
// line-start anchor. It rejects `maxComplexity:`, `sonarjs/cognitive-complexity:`
// and `obj.complexity:` (the character before must not be a word char, `$`, `.`
// or `-`) while accepting the key after `{`, `,`, a newline or indentation.
const ESLINT_QUOTED_KEY = /["']complexity["']\s*:/;
const ESLINT_UNQUOTED_KEY_SOURCE = '(?<![\\w$.\\-])complexity';
const eslintUnquotedKeyRe = () => new RegExp(`${ESLINT_UNQUOTED_KEY_SOURCE}\\s*:`);

// Does this config text mention the ESLint complexity rule at all (on or off)?
//
// The scan edge must use THIS to pick which candidate config file to hand to
// readConfig. It previously used its own `/["']complexity["']/` test, which
// accepted only the quoted spelling — so the unquoted branch below was reachable
// from unit tests calling readConfig directly and from nowhere else. A repo with
// the canonical flat config `complexity: ["error", 10]` read `rung: none`, gate 0,
// costing about a full point of C8: a false RED, publish-blocking in exactly the
// way a false green is. Exported so there is one spelling of the question.
function mentionsEslintComplexityRule(text) {
  if (!text) return false;
  const stripped = stripJsComments(text);
  return ESLINT_QUOTED_KEY.test(stripped) || eslintUnquotedKeyRe().test(stripped);
}

// Every file an ESLint complexity rule can legally live in, in the order the scan
// edge should try them.
const ESLINT_CONFIG_CANDIDATES = [
  '.eslintrc.json',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'package.json',
];

// Returns {enabled, threshold} for a linter's own config text, or null when that
// linter's config is absent. threshold null means "enabled at the linter default".
function readConfig(linter, text) {
  if (!text) return null;
  if (linter === 'credo') {
    // Every read below is against the stripped text: the check-name lookup, the
    // enabled:/disabled: recency test and the max_complexity read were all being
    // answered by commented-out config.
    const stripped = stripElixirComments(text);
    const checkName = 'Credo.Check.Refactor.CyclomaticComplexity';
    const checkIdx = stripped.indexOf(checkName);
    if (checkIdx === -1) return { enabled: false, threshold: null };

    const before = stripped.slice(0, checkIdx);
    const lastEnabled = before.lastIndexOf('enabled:');
    const lastDisabled = before.lastIndexOf('disabled:');

    if (lastEnabled !== -1 || lastDisabled !== -1) {
      // Map form: checks: %{enabled: [...], disabled: [...]}.
      // The check is disabled when disabled: was seen more recently than enabled:
      // (or when only disabled: appears before the check, with no enabled:).
      if (lastEnabled === -1 || lastDisabled > lastEnabled) {
        return { enabled: false, threshold: null };
      }
    } else {
      // Flat list form: checks: [...].
      // Every entry in the list is active unless its second argument is the
      // atom `false`, e.g. {Credo.Check.Refactor.CyclomaticComplexity, false}.
      // A keyword list ([], [max_complexity: N]) means the check is enabled.
      const after = stripped.slice(checkIdx + checkName.length);
      if (/^\s*,\s*false\b/.test(after)) {
        return { enabled: false, threshold: null };
      }
    }

    const m = /max_complexity\s*:\s*(\d+)/.exec(stripped);
    return { enabled: true, threshold: m ? Number(m[1]) : null };
  }
  if (linter === 'rubocop') {
    if (!/Metrics\/CyclomaticComplexity/.test(text)) return { enabled: false, threshold: null };
    const block = text.slice(text.indexOf('Metrics/CyclomaticComplexity'));
    if (/Enabled\s*:\s*false/i.test(block.split(/\n(?=\S)/)[0])) return { enabled: false, threshold: null };
    const m = /Max\s*:\s*(\d+)/.exec(block.split(/\n(?=\S)/)[0]);
    return { enabled: true, threshold: m ? Number(m[1]) : null };
  }
  if (linter === 'eslint') {
    const stripped = stripJsComments(text);

    const hasQ = ESLINT_QUOTED_KEY.test(stripped);
    const hasU = eslintUnquotedKeyRe().test(stripped);
    if (!hasQ && !hasU) return { enabled: false, threshold: null };

    const U = ESLINT_UNQUOTED_KEY_SOURCE;
    const re = (tail, flags) => new RegExp(`${U}\\s*:\\s*${tail}`, flags);

    // Rule is off when severity is 0 / "off" as a scalar value…
    const offScalar = (hasQ && /["']complexity["']\s*:\s*(?:["']off["']|\b0\b)/.test(stripped))
      || (hasU && re('(?:["\']off["\']|\\b0\\b)').test(stripped));
    // …or when the first element of the array form is 0 / "off" / 'off'.
    const offArray = (hasQ && /["']complexity["']\s*:\s*\[\s*(?:["']off["']|0)\s*[,\]]/.test(stripped))
      || (hasU && re('\\[\\s*(?:["\']off["\']|0)\\s*[,\\]]').test(stripped));
    if (offScalar || offArray) return { enabled: false, threshold: null };

    // Extract numeric threshold from array form: ["error", N], [2, N], or { max: N }.
    const m = (hasQ
        ? /["']complexity["']\s*:\s*\[[^\]]*?(\d+)\s*\]/.exec(stripped)
          || /["']complexity["']\s*:\s*\[[^\]]*?\{\s*["']?max["']?\s*:\s*(\d+)/.exec(stripped)
        : null)
      || (hasU
        ? re('\\[[^\\]]*?(\\d+)\\s*\\]').exec(stripped)
          || re('\\[[^\\]]*?\\{\\s*["\']?max["\']?\\s*:\\s*(\\d+)').exec(stripped)
        : null);
    return { enabled: true, threshold: m ? Number(m[1]) : null };
  }
  if (linter === 'lizard') {
    const m = /-C\s*(\d+)/.exec(text);
    return { enabled: /\blizard\b/.test(text), threshold: m ? Number(m[1]) : null };
  }
  return null;
}

function detectGate({ language, configs = {}, workflowText = '' }) {
  const linters = LANGUAGE_LINTERS[language] || [];
  let best = { rung: 'none', threshold: null, evidence: 'no complexity check found' };

  for (const linter of linters) {
    const cfg = readConfig(linter, configs[linter]);
    if (!cfg || !cfg.enabled) continue;
    const threshold = cfg.threshold != null ? cfg.threshold : (LINTER_DEFAULT_THRESHOLD[linter] || null);
    const enforced = isEnforcedInCi(linter, workflowText);
    const rung = enforced ? 'enforced' : 'configured';
    const evidence = enforced
      ? `${linter} enforced in CI at complexity ${threshold}`
      : `${linter} complexity rule configured but no failing CI step found`;
    // Prefer an enforced finding over a configured one; among enforced, keep the
    // WEAKEST threshold, since that is what actually determines what can merge.
    const better = rung === 'enforced' && best.rung !== 'enforced'
      ? true
      : rung === best.rung && threshold != null && best.threshold != null && threshold > best.threshold;
    if (best.rung === 'none' || better) best = { rung, threshold, evidence };
  }
  return best;
}

module.exports = {
  detectGate,
  readConfig,
  isEnforcedInCi,
  mentionsEslintComplexityRule,
  stripJsComments,
  ESLINT_CONFIG_CANDIDATES,
  LINTER_DEFAULT_THRESHOLD,
  LANGUAGE_LINTERS,
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

/***/ 763:
/***/ ((module) => {



/*
 * Which language toolchains an install has to provide, read from the
 * configuration the run is about to obey.
 *
 * The action used to install Elixir, OTP and Ruby unconditionally while the
 * scanner it was installing them for already consulted the declared stack to
 * decide whether to use them. So an organisation with no Elixir systems paid
 * for the whole BEAM toolchain on every run and then never invoked it. The
 * configuration was already the answer; nothing was asking it.
 *
 * Derived from the stack each system already declares rather than from a new
 * "enable Elixir" switch. Two fields that have to agree about the same fact is
 * how this project got a score scale that disagreed with its own badge.
 *
 * WHAT THE TOOLCHAINS ARE FOR, and it is a shorter list than the install
 * suggests:
 *
 *   elixir + otp  Credo, which measures complexity on Elixir source (C8), and
 *                 the two AST helpers the C2 reader uses on Elixir systems.
 *   ruby          Rubocop, which measures complexity on Ruby source (C8).
 *
 * Everything else the action installs — gitleaks, trivy, semgrep, lizard,
 * graphify — is language-agnostic and runs on every scan.
 *
 * TWO WAYS THIS DELIBERATELY OVER-INSTALLS, because the failure it is avoiding
 * is worse than the minute it costs:
 *
 *   1. No readable configuration. The caller may keep it somewhere this action
 *      was not told about, and an unreadable file must not quietly become "no
 *      toolchains" — the scan would then fail deep inside C8 with an ENOENT on
 *      `mix`, which reads as a broken engine rather than a missing input.
 *   2. A system with no declared stack. Absent is not evidence of absence. The
 *      C8 scanner also defaults an undeclared stack to Elixir, so guessing the
 *      other way would break exactly the configs that are least specific.
 *
 * In both cases the result is what happens today, plus a line saying why.
 *
 * WHAT THIS CANNOT SEE, and callers should know it. C8 does not measure the
 * declared stack — it measures every language it finds material in the tree
 * (>=500 LOC), because scoring one language and skipping the rest published a
 * complexity number over a subset of the code. So a repository declared
 * `typescript` that also carries 2,000 lines of Ruby needs Rubocop, and no
 * amount of reading the config will say so. That scan fails loudly rather than
 * scoring the Ruby green — see scan-simplicity's missing-tool check — and the
 * install-elixir / install-ruby inputs exist to force the toolchain in without
 * having to misdeclare the stack.
 */

// The stacks that need a language runtime installed before they can be
// measured. Every other stack is read by tools that carry their own.
const TOOLCHAIN_BY_STACK = Object.assign(Object.create(null), {
  elixir: 'elixir',
  ruby: 'ruby',
});

const TOOLCHAINS = ['elixir', 'ruby'];

const ALL = () => Object.fromEntries(TOOLCHAINS.map((t) => [t, true]));

// `auto` (the default) derives from the config. `true` and `false` are for the
// case the config cannot express: a repository whose material languages are not
// the stack it is declared as.
function applyOverrides(decided, overrides = {}) {
  const out = { ...decided };
  const notes = [];
  for (const toolchain of TOOLCHAINS) {
    const raw = overrides[toolchain];
    if (raw === undefined || raw === null || raw === '' || raw === 'auto') continue;
    if (raw !== 'true' && raw !== 'false' && typeof raw !== 'boolean') {
      throw new Error(
        `install-${toolchain} must be 'auto', 'true' or 'false' — got '${raw}'`,
      );
    }
    const forced = raw === true || raw === 'true';
    if (forced !== out[toolchain]) {
      notes.push(`${toolchain} forced ${forced ? 'on' : 'off'} by install-${toolchain}`);
    }
    out[toolchain] = forced;
  }
  return { toolchains: out, notes };
}

/*
 * config   the parsed watchtower configuration, or null when it could not be
 *          read. Null is a legitimate input, not an error: see (1) above.
 * overrides  { elixir, ruby } each 'auto' | 'true' | 'false'.
 *
 * Returns { toolchains: { elixir, ruby }, why: [lines] }. `why` is printed by
 * the caller — an install decision nobody can see the reasoning for is the kind
 * that gets blamed for an unrelated failure a year later.
 */
function requiredToolchains(config, overrides = {}) {
  const why = [];
  let decided;

  const systems = config && config.systems;
  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) {
    decided = ALL();
    why.push('no readable system list — installing every toolchain, which is what happened before this step existed');
  } else {
    const keys = Object.keys(systems);
    if (keys.length === 0) {
      decided = ALL();
      why.push('the system list is empty — installing every toolchain');
    } else {
      decided = Object.fromEntries(TOOLCHAINS.map((t) => [t, false]));
      const undeclared = [];
      const declared = new Map();

      for (const key of keys) {
        const stack = systems[key] && systems[key].stack;
        if (typeof stack !== 'string' || !stack) {
          undeclared.push(key);
          continue;
        }
        const toolchain = TOOLCHAIN_BY_STACK[stack];
        if (!toolchain) continue;
        decided[toolchain] = true;
        if (!declared.has(toolchain)) declared.set(toolchain, []);
        declared.get(toolchain).push(key);
      }

      if (undeclared.length > 0) {
        // Absent is not evidence of absence, and C8 reads an undeclared stack as
        // Elixir. Installing everything is the only answer that cannot turn a
        // vague config into a scan that dies two steps later.
        Object.assign(decided, ALL());
        why.push(`no stack declared for ${undeclared.sort().join(', ')} — installing every toolchain rather than guessing`);
      }

      for (const toolchain of TOOLCHAINS) {
        const systemsFor = declared.get(toolchain);
        if (systemsFor) {
          why.push(`${toolchain}: declared by ${systemsFor.sort().join(', ')}`);
        } else if (!decided[toolchain]) {
          why.push(`${toolchain}: no system declares it — skipped`);
        }
      }
    }
  }

  const { toolchains, notes } = applyOverrides(decided, overrides);
  why.push(...notes);
  return { toolchains, why };
}

// --- the other end of the same problem ------------------------------------
//
// The install is decided from the declared stack; C8 is not. It measures every
// language it finds material in the tree, because scoring one language and
// silently skipping the rest published a complexity number over a subset of the
// code while duplication covered all of it.
//
// So the two can disagree, and only the scan is in a position to notice. When
// they do, the binary is simply absent and execFileSync raises ENOENT on `mix`
// — which reads as a broken engine rather than a missing declaration. These
// turn that into a sentence naming both the cause and the two ways out.
//
// It fails the scan either way. That is the point: a repository with 2,000
// lines of unmeasured Ruby must not be scored as though the Ruby were clean.
const BINARY_FOR_TOOL = Object.assign(Object.create(null), {
  credo: 'mix',
  rubocop: 'rubocop',
  lizard: 'lizard',
});

// Only these two are gated on a declared stack; lizard is always installed, so
// its absence means a broken install rather than a missing declaration.
const STACK_FOR_TOOL = Object.assign(Object.create(null), {
  credo: 'elixir',
  rubocop: 'ruby',
});

// languages    the measured languages discoverLanguages returned
// isInstalled  binary name -> boolean. Injected so this is testable without a
//              toolchain, which is the only environment it will ever be tested in.
function missingToolchains(languages, isInstalled) {
  const seen = new Set();
  const missing = [];
  for (const lang of languages || []) {
    const binary = BINARY_FOR_TOOL[lang.tool];
    if (!binary || seen.has(binary)) continue;
    seen.add(binary);
    if (isInstalled(binary)) continue;
    missing.push({
      language: lang.language, tool: lang.tool, binary, stack: STACK_FOR_TOOL[lang.tool] || null, loc: lang.loc,
    });
  }
  return missing;
}

function missingToolchainMessage(missing, { systemKey, declaredStack } = {}) {
  const parts = missing.map((m) => (
    `${m.language} (${m.loc} lines) needs ${m.tool}, and ${m.binary} is not installed`
  ));
  const gated = missing.filter((m) => m.stack);
  const fix = gated.length === 0
    ? 'This tool is installed unconditionally, so its absence means a broken install rather than a missing declaration.'
    : `C8 measures every material language in the tree, not the declared stack`
      + `${declaredStack ? ` (this system declares '${declaredStack}')` : ''}. `
      + `Either declare the stack that matches, or set `
      + `${gated.map((m) => `install-${m.stack}: true`).join(' and ')} on the action.`;
  return `C8 ${systemKey || ''}: ${parts.join('; ')}. `
    + `Refusing to score ${missing.length === 1 ? 'this language' : 'these languages'} as clean. ${fix}`;
}

module.exports = {
  requiredToolchains,
  TOOLCHAINS,
  TOOLCHAIN_BY_STACK,
  BINARY_FOR_TOOL,
  STACK_FOR_TOOL,
  missingToolchains,
  missingToolchainMessage,
};

// --- I/O edge -------------------------------------------------------------
// Run by action.yml from the caller's workspace. Writes `elixir=true|false`
// lines to $GITHUB_OUTPUT (or stdout when it is unset, so it is runnable by
// hand) and the reasoning to stderr.
//
// It reads the config directly rather than through engine-config.loadConfig,
// which throws on a missing or malformed file. Here that is not an error: it is
// case (1), and the answer is to install everything and say so.
if (false) {}


/***/ }),

/***/ 674:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



/*
 * Codebase Simplicity scan (C8) — I/O entrypoint (the black-box edge). NOT
 * unit-tested; the testable logic is in scripts/benchmark/* (parseCredo /
 * parseRubocop / parseDuplication / scoreSimplicity). Clones ONE repo (shallow,
 * by SYSTEM env) and produces, under reports/<system>/:
 *
 *   complexity-<language>.json   raw complexity linter output (one per measured language)
 *   vue-offsets.json             line-offset map for Vue <script> extraction (vue repos only)
 *   jscpd.json                   raw jscpd duplication report
 *   simplicity-meta.json         new shape: { stack, tool, languages, unmeasured,
 *                                  skipped_immaterial, generated_files_skipped,
 *                                  vue_extraction_failures, loc }
 *
 * Complexity linters read SOURCE only (no target compile / deps.get), so this
 * runs headless on any clone — the same private-dep sidestep C9 relies on:
 *   Elixir -> Credo via a standalone runner project (its OWN mix deps, not the
 *             target's), pointed at the clone via files.included.
 *   Ruby   -> Rubocop with a minimal config, Metrics/CyclomaticComplexity only.
 *   JS/TS/Vue/Python -> lizard (language-agnostic CCN analyser, source-only).
 *     Vue single-file components need <script> extraction first (lizard cannot
 *     parse .vue directly). A failed extraction is counted; if ALL fail, throw.
 * Duplication -> jscpd. jscpd has no native Elixir tokenizer, so .ex/.exs are
 *   mapped to the ruby tokenizer (handles do/end block structure); approximate
 *   for Elixir, and stated as such in the C8 criterion documentation.
 *
 * Env:
 *   SYSTEM    system key (must exist in benchmark.overrides.json)
 *   GH_TOKEN  token with read on the target repo (clone auth)
 */

const fs = __nccwpck_require__(896);
const path = __nccwpck_require__(928);
const os = __nccwpck_require__(857);
const { execFileSync, spawnSync } = __nccwpck_require__(317);
const { extractLinterJson } = __nccwpck_require__(874);
const { discoverLanguages } = __nccwpck_require__(930);
const { missingToolchains, missingToolchainMessage } = __nccwpck_require__(763);
const { extractScript } = __nccwpck_require__(888);
const { detectGate, mentionsEslintComplexityRule, ESLINT_CONFIG_CANDIDATES } = __nccwpck_require__(571);
const {
  NONCODE_EXTS, shouldSkipDir, shouldSkipFile, GENERATED_RE, TEST_FILE_RE,
  lizardExcludeArgs, rubocopExcludeGlobs, credoExcludedRegexes,
} = __nccwpck_require__(966);

const { systemConfig, reportsDir, systemTarget } = __nccwpck_require__(880);
const { materialise } = __nccwpck_require__(639);
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;

const COMPLEXITY_THRESHOLD = 10; // McCabe convention anchor (all adapters pinned)
const CREDO_VERSION = '~> 1.7';

function sh(cmd, args, opts = {}) {
  // 64MB — lizard emits one CSV row per function to stdout; a large TS/JS repo can
  // exceed execFileSync's 1MB default maxBuffer (child gets SIGTERM, no report).
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024, ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

// Capture stdout of a linter that exits non-zero WHEN IT FINDS violations (that
// is a successful scan, not an error). A finding-exit still yields stdout; a real
// failure (crash, no output) yields none — throw so the leg fails loudly rather
// than emitting an empty "clean" report that scores a false green (the C9 lesson).
function captureAllowFindings(cmd, args, opts = {}) {
  try {
    return sh(cmd, args, opts).toString();
  } catch (e) {
    if (e.stdout && e.stdout.length) return e.stdout.toString();
    throw new Error(`${cmd} produced no output (real failure): ${e.message}`);
  }
}

// Line count per extension. What it skips comes from simplicity-exclusions.js,
// the SAME definition every linter runner below derives its excludes from, so the
// numerator and the denominator can no longer drift apart.

// Standard binary-detection heuristic: a NUL byte in the first 8 KB. Catches
// images, fonts, archives, certificates, and compiled artefacts without requiring
// an unbounded extension allowlist that would rot. Real source files are text and
// never contain NUL bytes.
function isBinaryFile(filePath) {
  try {
    const buf = Buffer.allocUnsafe(8192);
    const fd = fs.openSync(filePath, 'r');
    const n = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).includes(0);
  } catch {
    return false; // unreadable — countLocByExtension's readFileSync will also skip it
  }
}

function countLocByExtension(rootDir) {
  const loc = Object.create(null);
  let generatedSkipped = 0;
  let binarySkipped = 0;
  let testFilesSkipped = 0;
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name, path.relative(rootDir, path.join(dir, e.name)))) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        if (GENERATED_RE.test(e.name)) { generatedSkipped += 1; continue; }
        if (TEST_FILE_RE.test(e.name)) { testFilesSkipped += 1; continue; }
        const ext = path.extname(e.name);
        if (!ext) continue;
        if (NONCODE_EXTS.has(ext)) continue; // data/docs, not code — omit silently
        const full = path.join(dir, e.name);
        if (isBinaryFile(full)) { binarySkipped += 1; continue; }
        try {
          const n = fs.readFileSync(full, 'utf8').split('\n').length;
          loc[ext] = (loc[ext] || 0) + n;
        } catch { /* unreadable — skip */ }
      }
    }
  };
  walk(rootDir, 0);
  return {
    loc, generatedSkipped, binarySkipped, testFilesSkipped,
  };
}

// Elixir complexity via a standalone Credo project (credo is its only dep, so
// mix deps.get pulls only public Hex — the target is never built). Credo's
// files.included must be the absolute clone path or external files are silently
// skipped (verified: default included is the runner's own lib/).
function runCredo(repoDir, outDir, reportName) {
  const runner = fs.mkdtempSync(path.join(os.tmpdir(), 'credo-runner-'));
  fs.writeFileSync(path.join(runner, 'mix.exs'), `defmodule CredoRunner.MixProject do
  use Mix.Project
  def project, do: [app: :credo_runner, version: "0.1.0", elixir: "~> 1.14", deps: [{:credo, "${CREDO_VERSION}"}]]
end
`);
  // Excludes derived from the shared definition, not hand-listed here: credo used
  // to exclude a different set from the one the LOC walk applied, so credo
  // violations and credo lines came from different populations.
  const excluded = credoExcludedRegexes().map((p) => `~r"${p}"`).join(', ');
  fs.writeFileSync(path.join(runner, '.credo.exs'), `%{configs: [%{name: "default", strict: false,
  files: %{included: ["${repoDir}/"], excluded: [${excluded}]},
  checks: %{enabled: [{Credo.Check.Refactor.CyclomaticComplexity, [max_complexity: ${COMPLEXITY_THRESHOLD}]}], disabled: []}}]}
`);
  const opts = { cwd: runner };
  sh('mix', ['local.hex', '--force'], opts);
  sh('mix', ['local.rebar', '--force'], opts);
  sh('mix', ['deps.get'], opts);
  // Pre-compile so mix's dep-compile chatter ("==> file_system", "Compiling…")
  // lands in this discarded-output call, not mixed into the captured Credo JSON
  // below. Warm build first, then the credo run emits only its report.
  sh('mix', ['compile'], opts);
  const out = captureAllowFindings('mix', ['credo', '--config-file', '.credo.exs', '--format', 'json'], opts);
  const parsed = JSON.parse(extractLinterJson(out)); // slice payload; non-JSON -> throw, no false green
  writeJson(outDir, reportName, parsed);
}

// Ruby complexity via Rubocop, Metrics/CyclomaticComplexity only, Max pinned.
// Runs on source (no bundle). Writes a scoped config to avoid inheriting the
// target's .rubocop.yml (which could disable the cop or change Max).
function runRubocop(repoDir, outDir, reportName) {
  const cfg = path.join(os.tmpdir(), `rubocop-c8-${process.pid}.yml`);
  // Rubocop excluded NOTHING before this, so it counted offences in vendored and
  // test Ruby whose lines the LOC walk had already thrown away. Excludes now come
  // from the same shared definition as the walk's.
  const excludes = rubocopExcludeGlobs().map((g) => `    - '${g}'`).join('\n');
  fs.writeFileSync(cfg, `AllCops:
  DisabledByDefault: true
  Exclude:
${excludes}
Metrics/CyclomaticComplexity:
  Enabled: true
  Max: ${COMPLEXITY_THRESHOLD}
`);
  const json = captureAllowFindings('rubocop', [
    '--config', cfg, '--force-exclusion', '--only', 'Metrics/CyclomaticComplexity',
    '--format', 'json', repoDir,
  ]);
  const parsed = JSON.parse(json); // throws on non-JSON -> leg fails, no false green
  writeJson(outDir, reportName, parsed);
}

// JS/TS/Python/Vue complexity via lizard (a language-agnostic CCN analyzer;
// source-only, no compile, no per-project config).
//
// `readers` is the LIST of lizard reader names to enable, resolved by
// simplicity-stacks.lizardInvocation from the extensions actually present. It is a
// list and not a single string because lizard's `-l` selects a reader, not a family:
// `-l javascript` reads .js/.cjs/.mjs and nothing else, `-l typescript` reads .ts
// and nothing else, and .tsx/.jsx belong to a third reader. Passing one name per
// language left those files unread while their lines stayed in the denominator.
//
// `excludeExts` closes the other half of that: the tsx reader answers to both .tsx
// and .jsx, so enabling it for typescript would also pull in javascript's .jsx and
// double-count it. Each pass excludes the extensions it does not own.
//
// `targetDir` defaults to repoDir but is the extraction dir for Vue.
function runLizard(repoDir, outDir, reportName, readers, targetDir, excludeExts = []) {
  if (!Array.isArray(readers) || readers.length === 0) {
    throw new Error(`lizard invoked for ${reportName} with no reader — a mapped extension would go unread`);
  }
  const args = ['--csv'];
  for (const r of readers) args.push('-l', r);
  args.push(...lizardExcludeArgs());
  for (const ext of excludeExts) args.push('-x', `*${ext}`);
  args.push(targetDir || repoDir);
  const csv = sh('lizard', args).toString();
  // A scan that finds zero functions is a misconfiguration (wrong stack /
  // empty clone), not a legitimately clean scan — throw rather than emit a report
  // that would score a false green (the C9/C8 never-false-green rule).
  const rows = csv.split('\n').map((s) => s.trim()).filter(Boolean);
  if (rows.length === 0) {
    throw new Error(`lizard produced no functions for ${repoDir} (misconfigured ${readers.join('+')} scan?)`);
  }
  writeJson(outDir, reportName, { format: 'csv', text: csv });
}

// lizard cannot parse .vue. Extract each <script> block into a mirror tree, run
// lizard over that, and record the offsets so reported lines can be mapped back to
// the .vue file. A finding pointing at a temp file is worse than no finding.
function extractVueTree(repoDir, workDir) {
  const outRoot = path.join(workDir, 'vue-extract');
  const offsets = {}; // extracted relative path -> { source: '<repo-relative>.vue', lineOffset }
  let failed = 0;
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name, path.relative(repoDir, full))) continue;
        walk(full, depth + 1);
      } else if (e.name.endsWith('.vue') && !shouldSkipFile(e.name)) {
        let block = null;
        try { block = extractScript(fs.readFileSync(full, 'utf8')); } catch { block = null; }
        if (!block) { failed += 1; continue; }
        const rel = path.relative(repoDir, full);
        const target = path.join(outRoot, `${rel}.${block.lang}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, block.code);
        offsets[path.relative(outRoot, target)] = { source: rel, lineOffset: block.lineOffset };
      }
    }
  };
  walk(repoDir, 0);
  return { outRoot, offsets, failed };
}

// Config text for each linter that could gate complexity, plus every GitHub
// Actions workflow concatenated. Detection itself is pure (complexity-gate.js).
function readGateInputs(repoDir) {
  const read = (p) => { try { return fs.readFileSync(path.join(repoDir, p), 'utf8'); } catch { return null; } };
  // The candidate list and the "does this file mention the rule" test both come
  // from complexity-gate.js. They used to be a private, quoted-keys-only regex
  // here, which meant the unquoted flat-config branch in readConfig could only
  // ever be reached from unit tests: a repo with `complexity: ["error", 10]` read
  // as ungated. One spelling of the question, used by the detector and the edge.
  let eslint = null;
  for (const c of ESLINT_CONFIG_CANDIDATES) {
    const t = read(c);
    if (t && mentionsEslintComplexityRule(t)) { eslint = t; break; }
  }

  let workflowText = '';
  const wfDir = path.join(repoDir, '.github', 'workflows');
  try {
    for (const f of fs.readdirSync(wfDir)) {
      if (/\.ya?ml$/.test(f)) workflowText += `${fs.readFileSync(path.join(wfDir, f), 'utf8')}\n`;
    }
  } catch { /* no workflows */ }

  return {
    configs: { credo: read('.credo.exs'), rubocop: read('.rubocop.yml'), eslint, lizard: workflowText },
    workflowText,
  };
}

// Duplication via jscpd. Map ex/exs to the ruby tokenizer (jscpd has no Elixir
// support); keep rb explicit so ruby repos still tokenize .rb. Native tokenizers
// cover js/ts/vue/etc. Output file is jscpd-report.json in the given dir.
function runJscpd(repoDir, outDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-'));
  try {
    // Ignore non-code so duplication measures CODE, not data/i18n/docs. Without
    // this, translation (.po) and locale/data (.json) files dominate — one repo
    // reads 14.99% raw but 5.89% code-only. See criteria-docs.json (C8).
    sh('npx', ['--yes', 'jscpd', repoDir,
      '--reporters', 'json', '--output', tmp, '--silent',
      '--formats-exts', 'ruby:rb,ex,exs',
      '--ignore', [
        '**/deps/**', '**/_build/**', '**/node_modules/**', '**/priv/static/**',
        '**/test/**', '**/spec/**',
        '**/*.po', '**/*.json', '**/*.csv', '**/*.svg', '**/*.md', '**/*.mdx', '**/*.lock',
        '**/priv/gettext/**', '**/locales/**', '**/locale/**',
      ].join(',')]);
  } catch (e) { console.error(`  jscpd exit: ${e.message}`); }
  // A missing report is a real failure — throw rather than write a 0% "clean"
  // duplication result that would score a false green.
  const report = JSON.parse(fs.readFileSync(path.join(tmp, 'jscpd-report.json'), 'utf8'));
  writeJson(outDir, 'jscpd', report);
}

function main() {
  const cfg = systemConfig(SYSTEM);
  const stack = cfg.stack || 'elixir';
  const outDir = reportsDir(SYSTEM);

  // The tree must be removed in a finally: a clone's .git/config holds the token
  // in plaintext. target-tree also keeps the clone's stderr out of the log for
  // the same reason — the URL carrying the token reaches it before any catch
  // here would run — and removes only what it created, so a local target's
  // source folder is never touched.
  const tree = materialise(systemTarget(SYSTEM), { prefix: `c8-${SYSTEM}`, token: GH_TOKEN });
  const work = path.dirname(tree.dir);
  const repoDir = tree.dir;

  try {
    for (const note of tree.notes) console.log(`  ${note}`);

    const {
      loc: locByExt, generatedSkipped, binarySkipped, testFilesSkipped,
    } = countLocByExtension(repoDir);
    const { measured, unmeasured, skippedImmaterial } = discoverLanguages(locByExt);
    if (measured.length === 0) {
      throw new Error(`no material language found in ${tree.label} — refusing to write a meta that would score 0/0`);
    }

    // Check every complexity tool is present BEFORE running any of them. Since
    // the action installs Elixir and Ruby only when a system declares those
    // stacks, a repository whose material languages differ from its declared
    // stack now arrives without the tool it needs — and the bare ENOENT that
    // produces names `mix`, not the declaration that is missing.
    //
    // Up front rather than at each call so a repo missing two toolchains is told
    // about both, and so it fails before ten minutes of jscpd and lizard.
    const absent = missingToolchains(
      measured,
      (binary) => spawnSync(binary, ['--version'], { stdio: 'ignore' }).error === undefined,
    );
    if (absent.length > 0) {
      throw new Error(missingToolchainMessage(absent, { systemKey: SYSTEM, declaredStack: stack }));
    }

    const gateInputs = readGateInputs(repoDir);
    let vue = null;

    const languages = [];
    for (const lang of measured) {
      const reportName = `complexity-${lang.language}`;
      if (lang.requiresSfcExtraction) {
        vue = extractVueTree(repoDir, work);
        // If Vue is material but every extraction failed, the extractor is broken —
        // do not silently write a meta claiming Vue was measured when nothing was.
        if (Object.keys(vue.offsets).length === 0) {
          throw new Error(`Vue was discovered as material in ${tree.label} but zero <script> blocks could be extracted — extractor broken, refusing to write a false meta`);
        }
        writeJson(outDir, 'vue-offsets', vue.offsets);
        // The extraction tree is MIXED: a `lang="ts"` block is written as
        // `<name>.vue.ts` and a plain one as `<name>.vue.js`. Running it under the
        // javascript reader alone read only the `.vue.js` half — in one repo that
        // silently dropped 135 of 222 extracted SFCs while all 41,446 Vue lines
        // stayed in the denominator. Both readers are enabled; they partition the
        // tree by extension with no overlap.
        runLizard(repoDir, outDir, reportName, lang.lizardReaders, vue.outRoot, lang.lizardExcludeExts);
      } else if (lang.tool === 'credo') {
        runCredo(repoDir, outDir, reportName);
      } else if (lang.tool === 'rubocop') {
        runRubocop(repoDir, outDir, reportName);
      } else {
        runLizard(repoDir, outDir, reportName, lang.lizardReaders, repoDir, lang.lizardExcludeExts);
      }
      const gate = detectGate({ language: lang.language, ...gateInputs });
      languages.push({
        language: lang.language,
        tool: lang.tool,
        loc: lang.loc,
        exts: lang.exts,
        report: reportName,
        gate,
      });
    }

    runJscpd(repoDir, outDir);

    writeJson(outDir, 'simplicity-meta', {
      stack,
      // Retained for consumers not yet iterating `languages`: the tool for the
      // largest measured language. Degrades to a partial reading, never an exception.
      tool: languages[0].tool,
      languages,
      unmeasured,
      skipped_immaterial: skippedImmaterial,
      generated_files_skipped: generatedSkipped,
      binary_files_skipped: binarySkipped,
      test_files_skipped: testFilesSkipped,
      vue_extraction_failures: vue ? vue.failed : 0,
      loc: languages.reduce((a, l) => a + l.loc, 0),
    });
    console.log(`Scanned C8 ${SYSTEM} (${tree.label}) — ${languages.map((l) => `${l.language}:${l.tool}`).join(' ')} + jscpd`);
  } finally {
    tree.cleanup();
  }
}

if (require.main === require.cache[eval('__filename')]) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}

module.exports = { main };


/***/ }),

/***/ 966:
/***/ ((module, __unused_webpack_exports, __nccwpck_require__) => {



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

const path = __nccwpck_require__(928);

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


/***/ }),

/***/ 930:
/***/ ((module) => {



// Single source of truth for how C8 (Codebase Simplicity) maps SOURCE FILES to
// complexity tools. Keyed on file extension, never on a "primary stack": a repo
// is measured in every material language it contains, because scoring one
// language and silently skipping the rest published a complexity number over a
// subset of the code while duplication covered all of it.
//
// An unmapped extension is reported as unmeasured with its line count. It is
// never dropped and never routed to a default linter — that silent default was
// the false-green this table exists to prevent.

// Convention, not an anchor: below this many lines a language's violations swing
// the pooled density wildly, so it is skipped and named in the report. Chosen by
// us; the criterion page says so.
const MATERIALITY_FLOOR_LOC = 500;

// Which lizard READER reads which extension. This is lizard's own table
// (`lizard_languages.languages()`, verified against lizard 1.23.0), not a guess,
// and it is the thing that made `.tsx` and `.jsx` disappear: lizard's `-l` flag
// filters by reader, `-l javascript` enables ONLY the JavaScriptReader (.js/.cjs/
// .mjs) and `-l typescript` only the TypeScriptReader (.ts). `.tsx` and `.jsx`
// belong to a third reader (`tsx`, aliased `jsx`) that neither pass enabled — so
// those files' lines sat in the denominator while contributing zero violations.
//
// One reader can serve several extensions across two of OUR languages: the tsx
// reader covers both `.tsx` (our `typescript`) and `.jsx` (our `javascript`).
// lizardInvocation below resolves that overlap explicitly rather than letting one
// pass silently swallow the other's files and double-count them.
const LIZARD_READER_BY_EXT = Object.assign(Object.create(null), {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.jsx': 'tsx',
  '.py': 'python',
});

// The inverse: every extension a given reader will pick up once enabled.
const LIZARD_READER_EXTS = Object.create(null);
for (const [ext, reader] of Object.entries(LIZARD_READER_BY_EXT)) {
  (LIZARD_READER_EXTS[reader] || (LIZARD_READER_EXTS[reader] = [])).push(ext);
}

const LANGUAGE_TOOLS = Object.assign(Object.create(null), {
  elixir: { tool: 'credo', exts: ['.ex', '.exs'] },
  ruby: { tool: 'rubocop', exts: ['.rb'] },
  javascript: { tool: 'lizard', exts: ['.js', '.jsx', '.mjs', '.cjs'] },
  typescript: { tool: 'lizard', exts: ['.ts', '.tsx'] },
  python: { tool: 'lizard', exts: ['.py'] },
  // Vue single-file components are not parseable by lizard directly; the scan
  // edge extracts each <script> block first and runs lizard over the extraction.
  // A block declaring lang="ts" is written as `<name>.vue.ts`, so the extraction
  // tree is mixed and BOTH readers must be enabled — running it as javascript
  // alone silently dropped every TypeScript SFC (135 of 222 in one repo).
  // extractionOwnedExts is what the Vue pass is ENTITLED to read: the extractor
  // only ever writes .js or .ts, but the javascript reader also answers to
  // .mjs/.cjs, and those belong to this pass too rather than to another language's.
  vue: {
    tool: 'lizard',
    exts: ['.vue'],
    requiresSfcExtraction: true,
    extractionExts: ['.js', '.ts'],
    extractionOwnedExts: ['.js', '.mjs', '.cjs', '.ts'],
  },
});

// Resolve the lizard invocation for one language: which readers to enable, and
// which extensions to exclude because an enabled reader would otherwise reach into
// another language's files. Also reports, structurally, any extension of this
// language that no lizard reader covers — the caller must publish those as
// unmeasured rather than let them inflate the denominator for free.
//
// `presentExts` are the extensions actually found in the repo (they decide which
// readers to enable); `ownedExts` are every extension this pass is entitled to
// read (they decide what counts as foreign). They differ because a repo with .js
// but no .mjs still owns .mjs — excluding it would be meaningless noise — whereas
// .tsx genuinely belongs to another pass.
function lizardInvocation(presentExts = [], ownedExts = null) {
  const readers = [];
  const uncovered = [];
  for (const ext of presentExts) {
    const reader = LIZARD_READER_BY_EXT[ext];
    if (!reader) { uncovered.push(ext); continue; }
    if (!readers.includes(reader)) readers.push(reader);
  }
  const own = new Set(ownedExts && ownedExts.length ? ownedExts : presentExts);
  const foreign = [];
  for (const reader of readers) {
    for (const ext of LIZARD_READER_EXTS[reader]) {
      if (!own.has(ext) && !foreign.includes(ext)) foreign.push(ext);
    }
  }
  readers.sort();
  foreign.sort();
  uncovered.sort();
  return { readers, excludeExts: foreign, uncovered };
}

const EXT_INDEX = Object.create(null);
for (const [language, cfg] of Object.entries(LANGUAGE_TOOLS)) {
  for (const ext of cfg.exts) {
    EXT_INDEX[ext] = { language, tool: cfg.tool };
  }
}

function toolForExtension(ext) {
  return EXT_INDEX[ext] || null;
}

// locByExtension: { '.ts': 90000, '.sql': 8800, ... }
function discoverLanguages(locByExtension = {}) {
  const byLanguage = Object.create(null);
  const unmeasured = [];

  for (const [ext, loc] of Object.entries(locByExtension)) {
    const hit = toolForExtension(ext);
    if (!hit) {
      // Unmapped extensions are always published in unmeasured regardless of
      // line count. Dropping them here was the false-green this module exists
      // to prevent.
      unmeasured.push({ extension: ext, loc: loc || 0, reason: 'no mapped tool' });
      continue;
    }
    // For mapped languages, only accumulate if there are real lines.
    const lineCount = typeof loc === 'number' && loc > 0 ? loc : 0;
    if (!lineCount) continue;
    const entry = byLanguage[hit.language] || (byLanguage[hit.language] = {
      language: hit.language,
      tool: hit.tool,
      requiresSfcExtraction: !!LANGUAGE_TOOLS[hit.language].requiresSfcExtraction,
      exts: [],
      locByExt: Object.create(null),
      loc: 0,
    });
    entry.exts.push(ext);
    entry.locByExt[ext] = (entry.locByExt[ext] || 0) + lineCount;
    entry.loc += lineCount;
  }

  const measured = [];
  const skippedImmaterial = [];
  for (const entry of Object.values(byLanguage)) {
    entry.exts.sort();
    if (entry.tool === 'lizard') {
      // Which lizard readers cover the extensions actually PRESENT in this repo.
      // The SFC languages are analysed over an extraction tree, so their readers
      // come from the extensions the extractor emits, not from `.vue`.
      const cfg = LANGUAGE_TOOLS[entry.language];
      const invocationExts = cfg.extractionExts || entry.exts;
      const ownedExts = cfg.extractionOwnedExts || cfg.exts;
      const inv = lizardInvocation(invocationExts, ownedExts);
      entry.lizardReaders = inv.readers;
      entry.lizardExcludeExts = inv.excludeExts;
      // No reader for a mapped extension is a scope loss, not a rounding error:
      // its lines would sit in the denominator producing zero violations. Move
      // those lines out of the measured language and into `unmeasured` so the
      // density is honest and the reader can see what was dropped.
      for (const ext of inv.uncovered) {
        const lost = entry.locByExt[ext] || 0;
        entry.loc -= lost;
        delete entry.locByExt[ext];
        entry.exts = entry.exts.filter((e) => e !== ext);
        unmeasured.push({ extension: ext, loc: lost, reason: 'no lizard reader for this extension' });
      }
    }
    if (entry.loc < MATERIALITY_FLOOR_LOC) skippedImmaterial.push({ language: entry.language, loc: entry.loc });
    else measured.push(entry);
  }

  // Deterministic order: largest language first, so the report and the retained
  // top-level `tool` key are stable across runs. `unmeasured` and
  // `skippedImmaterial` are sorted too — they are written verbatim into
  // findings-*.json, and an ordering that follows filesystem walk order churns the
  // file between runs and defeats the data-PR change gate build-findings-data.js
  // exists to protect.
  measured.sort((a, b) => b.loc - a.loc || a.language.localeCompare(b.language));
  unmeasured.sort((a, b) => a.extension.localeCompare(b.extension));
  skippedImmaterial.sort((a, b) => a.language.localeCompare(b.language));
  return { measured, unmeasured, skippedImmaterial };
}

module.exports = {
  LANGUAGE_TOOLS,
  EXT_INDEX,
  LIZARD_READER_BY_EXT,
  LIZARD_READER_EXTS,
  lizardInvocation,
  toolForExtension,
  discoverLanguages,
  MATERIALITY_FLOOR_LOC,
};


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

/***/ 888:
/***/ ((module) => {



// Vue single-file components are not parseable by lizard, so the <script> block
// is extracted and analysed on its own. The line offset is not a nicety: findings
// carry file paths and line numbers into the report UI, and a location pointing
// at a temp file is worse than no location at all — it looks actionable and is
// not. The caller maps reported lines back with (line - 1) + lineOffset.
//
// Deliberately a scanner, not a Vue parser. We take the first <script> block and
// bail on anything malformed rather than guessing, because a wrong offset is a
// silently wrong location.

const OPEN_RE = /<script\b([^>]*)>/i;
const CLOSE = '</script>';

function extractScript(source) {
  if (typeof source !== 'string') return null;
  const open = OPEN_RE.exec(source);
  if (!open) return null;

  const attrs = open[1] || '';
  const langMatch = /\blang\s*=\s*["']([^"']+)["']/i.exec(attrs);
  const declared = langMatch ? langMatch[1].toLowerCase() : 'js';
  const lang = declared === 'ts' || declared === 'typescript' ? 'ts' : 'js';

  const bodyStart = open.index + open[0].length;
  const closeIdx = source.indexOf(CLOSE, bodyStart);
  if (closeIdx === -1) return null; // unterminated — never fall through to EOF

  const code = source.slice(bodyStart, closeIdx).replace(/^\r?\n/, '');

  // Lines before the opening tag, plus the tag's own line. The body conventionally
  // starts on the line after <script>; if content sits on the same line as the tag
  // the offset is that line instead.
  const beforeTag = source.slice(0, open.index + open[0].length);
  const tagLine = beforeTag.split('\n').length;
  const sameLineContent = /^[^\r\n]*\S/.test(source.slice(bodyStart, closeIdx));
  const lineOffset = sameLineContent ? tagLine : tagLine + 1;

  return { lang, code, lineOffset };
}

module.exports = { extractScript };


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
/******/ 	var __webpack_exports__ = __nccwpck_require__(674);
/******/ 	module.exports = __webpack_exports__;
/******/ 	
/******/ })()
;