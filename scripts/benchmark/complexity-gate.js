'use strict';

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
