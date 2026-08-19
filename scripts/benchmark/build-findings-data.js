'use strict';

// Pure builder: read a system's scanner reports and emit the per-finding
// locations envelope (findings-<system>.json). Mirrors build-benchmark-data.js
// (pure over an injected readReport). SECURITY: emits paths/rules/ids/severities
// only — never a matched secret value (the parsers already drop them; we only
// ever copy the whitelisted fields below).

const {
  parseGitleaks, parseTrivy, parseSast, parseDuplication, complexityParser,
} = require('./parse-reports');
const { createAllowanceSet } = require('./allowances');
// Shared with the allowances matcher, which has to shorten a scanner path on the
// way IN for the same reason this shortens it on the way out. See repo-paths.js.
const { relativizePaths } = require('./repo-paths');

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
  for (const [stack, s] of Object.entries(r.stacks)) {
    for (const f of (s.untested_samples || [])) untested.push({ file: f, stack });
    const t = s.tooling || {};
    const status = t.enforced ? `enforced (${(t.thresholds || []).join('/')})` : (t.present ? 'configured, no gate' : 'no coverage tool');
    if (!t.enforced) discipline.push({ stack, status });
  }
  return [group('breadth', 'Untested source files', null, untested), group('discipline', 'Coverage enforcement', null, discipline)];
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
