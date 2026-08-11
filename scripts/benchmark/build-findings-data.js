'use strict';

// Pure builder: read a system's scanner reports and emit the per-finding
// locations envelope (findings-<system>.json). Mirrors build-benchmark-data.js
// (pure over an injected readReport). SECURITY: emits paths/rules/ids/severities
// only — never a matched secret value (the parsers already drop them; we only
// ever copy the whitelisted fields below).

const {
  parseGitleaks, parseTrivy, parseSast, parseDuplication, complexityParser,
} = require('./parse-reports');

// Third-party scanners (gitleaks/trivy/semgrep/credo/rubocop/jscpd) report paths
// absolute to the per-run clone dir — <tmp>/scan-<sys>-<rand>/repo/ or
// <tmp>/scan-c8-<sys>-<rand>/repo/. That random suffix would render as garbage in
// the UI and, worse, make findings-*.json churn on every scan (defeating the
// data-PR change gate). Strip the clone-root prefix to repo-relative. Our own
// walkers (C4/C6/C7) already emit relative paths, which don't match and pass through.
function relativize(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/^.*?\/scan-[^/]*\/repo\//, '');
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

async function c9Groups(sys, readReport, sastTool, triageConfig) {
  const excludePaths = triageConfig.exclude_paths || [];
  const reviewRules = triageConfig.gitleaks_review_rules || [];
  const severityRemap = triageConfig.semgrep_severity_remap || {};
  const dd = (await readReport(sys.name, 'direct-deps')) || {};
  const secrets = parseGitleaks(await readReport(sys.name, 'gitleaks'), { excludePaths, reviewRules });
  const deps = parseTrivy(await readReport(sys.name, 'trivy'), { prodDeps: dd.prod || [], devDeps: dd.dev || [] });
  const sast = parseSast(await readReport(sys.name, sys.sast_tool || sastTool), sys.sast_tool || sastTool, { severityRemap, excludePaths });
  return [
    group('secrets', 'Secrets', 'confirmed', (secrets.items || []).map((s) => ({ file: s.file, rule: s.rule }))),
    group('secrets', 'Secrets', 'review', (secrets.review_items || []).map((s) => ({ file: s.file, rule: s.rule }))),
    group('deps', 'Dependency CVEs', null, deps.items),
    group('sast', 'SAST', null, sast.items),
  ];
}

async function c8Groups(sys, readReport) {
  const meta = await readReport(sys.name, 'simplicity-meta');
  if (!meta) return [];
  const entries = Array.isArray(meta.languages) && meta.languages.length
    ? meta.languages
    : (meta.tool ? [{ language: meta.stack, tool: meta.tool, report: meta.tool }] : []);
  if (!entries.length) return [];

  const offsets = (await readReport(sys.name, 'vue-offsets')) || {};
  const items = [];
  for (const entry of entries) {
    const reportName = entry.report || entry.tool;
    const raw = await readReport(sys.name, reportName);
    // Same rule as scoreC8: a report the meta names but that is missing is a
    // broken leg. Tolerating it here would quietly publish a findings file with a
    // whole language's violations absent.
    if (raw == null) {
      throw new Error(`C8 ${sys.name}: simplicity-meta names report '${reportName}' for ${entry.language}, but it is missing — refusing to emit findings with that language silently absent`);
    }
    const cx = complexityParser(entry.tool)(raw);
    for (const it of (cx.items || [])) {
      // Map an extracted Vue script location back to its .vue file and original
      // line. A location pointing at the extraction tree is unactionable.
      // Use longest-match so that two offset keys sharing a suffix (e.g.
      // "src/Login.vue.ts" and "components/src/Login.vue.ts") never collide.
      const matches = it.file ? Object.entries(offsets).filter(([k]) => it.file.endsWith(k)) : [];
      const hit = matches.length ? matches.reduce((a, b) => a[0].length >= b[0].length ? a : b) : null;
      if (hit) {
        const [, { source, lineOffset }] = hit;
        items.push({ ...it, file: source, line: it.line != null ? (it.line - 1) + lineOffset : it.line, language: entry.language });
      } else {
        items.push({ ...it, language: entry.language });
      }
    }
  }
  const dup = parseDuplication(await readReport(sys.name, 'jscpd'));
  return [
    group('complexity', 'Cyclomatic complexity', null, items),
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

async function buildFindingsForSystem({ sys, readReport, sastTool, triageConfig = {}, generatedAt }) {
  const criteria = {};
  const add = (key, label, groups) => { const c = criterion(label, groups); if (c) criteria[key] = c; };
  add('2', 'Documented APIs', await c2Groups(sys, readReport));
  add('4', 'Observable State', await c4Groups(sys, readReport));
  add('6', 'Test Coverage', await c6Groups(sys, readReport));
  add('7', 'Deployment Safety', await c7Groups(sys, readReport));
  add('8', 'Codebase Simplicity', await c8Groups(sys, readReport));
  add('9', 'Security Posture', await c9Groups(sys, readReport, sastTool, triageConfig));
  return { system: sys.name, generated_at: generatedAt, criteria: relativizePaths(criteria) };
}

module.exports = { buildFindingsForSystem };
