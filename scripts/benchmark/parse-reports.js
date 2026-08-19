'use strict';

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
    const item = { description: f?.Description, file: f?.File, rule: f?.RuleID };
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
