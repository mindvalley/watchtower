'use strict';

// Pure orchestration: for each system, read its three scanner reports (via the
// injected readReport), normalize, score C9, and assemble the contract. No I/O
// here — readReport is supplied by the edge (real) or a fake (tests).

const {
  parseGitleaks, parseTrivy, parseSast, parseDuplication, complexityParser,
} = require('./parse-reports');
const { scoreSecurity } = require('./score-security');
const { scoreSimplicity } = require('./score-simplicity');
const { scoreObservability } = require('./score-observability');
const { scoreDeployment } = require('./score-deployment');
const { scoreDocumentedApis } = require('./score-documented-apis');
const { scoreTestCoverage } = require('./score-test-coverage');
const { scoreBoundaries } = require('./score-boundaries');
const { boundaryGraphDisposition } = require('./criterion-stacks');
const { buildSystemEntry, assembleBenchmark } = require('./assemble-benchmark');
const { createAllowanceSet } = require('./allowances');

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
