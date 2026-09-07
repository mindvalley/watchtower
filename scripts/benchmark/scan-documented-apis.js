// scripts/benchmark/scan-documented-apis.js
'use strict';

/*
 * C2 (Documented APIs) scan — I/O entrypoint (black-box edge). NOT unit-tested;
 * testable logic is the readers (openapi-reader / graphql-sdl-reader) +
 * documented-apis-signals.js + score-documented-apis.js. Clones ONE repo (shallow,
 * by SYSTEM env) and writes reports/<system>/documented-apis.json.
 *
 * Agnostic-first: C2 measures description coverage of a system's public API
 * surface, whatever serialization carries it. Dispositions (criterion-stacks.js):
 *   elixir-ast — in-code Elixir schemas via the no-compile Absinthe + phoenix_swagger
 *                AST helpers (unchanged pilot path).
 *   na         — ruby: declared N/A (unchanged for parity).
 *   artifact   — any other stack: recognize a committed API artifact (OpenAPI
 *                JSON/YAML or GraphQL SDL) and measure it with the same pooled
 *                coverage. No artifact -> no report -> honest Pending (never false green).
 *
 * Reads files only, no compile — same private-dep sidestep as C4/C7/C8/C9.
 * Env: SYSTEM (key in benchmark.overrides.json), GH_TOKEN (clone auth).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { isAbsintheModule, isRestApiDoc, isPhoenixSwaggerModule, buildReport } = require('./documented-apis-signals');
const { documentedApisDisposition } = require('./criterion-stacks');
const { parseOpenApi, parseOpenApiText } = require('./openapi-reader');
const { parseGraphqlSdl } = require('./graphql-sdl-reader');

const { systemConfig, reportsDir, systemTarget } = require('./engine-config');
const { materialise } = require('./target-tree');
const SYSTEM = process.env.SYSTEM;
const { GH_TOKEN } = process.env;
const HELPER = path.join(__dirname, 'absinthe_desc_parse.exs');
const SWAGGER_HELPER = path.join(__dirname, 'phoenix_swagger_desc_parse.exs');

// Also skip non-API-surface trees: `.agents` (Claude skill example schemas),
// `test`/`spec` (test-support schemas). These are not the system's public API —
// counting them poisons the coverage denominator.
const SKIP_DIRS = new Set([
  'node_modules', 'deps', '_build', '.git', '.elixir_ls', 'tmp', 'vendor',
  '.agents', 'test', 'spec',
]);

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function writeJson(dir, name, obj) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

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

// --- Elixir AST path (unchanged pilot behavior) ---
function scanElixirAst(repoDir, work) {
  const mixFiles = collect(repoDir, (n) => n === 'mix.exs');
  const restApiDetected = mixFiles.some((f) => isRestApiDoc(readText(f)));

  const exFiles = collect(repoDir, (n) => n.endsWith('.ex'));
  const absintheFiles = exFiles.filter((f) => isAbsintheModule(readText(f)));

  let records = [];
  if (absintheFiles.length > 0) {
    const listFile = path.join(work, 'files.txt');
    fs.writeFileSync(listFile, `${absintheFiles.join('\n')}\n`);
    records = JSON.parse(sh('elixir', [HELPER, listFile], { encoding: 'utf8' }));
  }

  let restRecords;
  let restFilesParsed = 0;
  if (restApiDetected) {
    const swaggerFiles = exFiles.filter((f) => isPhoenixSwaggerModule(readText(f)));
    restFilesParsed = swaggerFiles.length;
    if (swaggerFiles.length > 0) {
      const restList = path.join(work, 'swagger-files.txt');
      fs.writeFileSync(restList, `${swaggerFiles.join('\n')}\n`);
      restRecords = JSON.parse(sh('elixir', [SWAGGER_HELPER, restList], { encoding: 'utf8' }));
    } else {
      restRecords = [];
    }
  }

  return buildReport({
    applicable: true, records, filesParsed: absintheFiles.length, restApiDetected, restRecords, restFilesParsed,
  });
}

// --- Agnostic artifact path (OpenAPI JSON/YAML + GraphQL SDL) ---
// Returns a report, or null when no artifact is present (-> Pending, no report written).
function scanArtifacts(repoDir) {
  // OpenAPI/Swagger: json/yaml files whose path or name signals a spec, confirmed
  // by content (parseOpenApiText returns null unless it parses to a real spec).
  const specCandidates = collect(repoDir, (n, full) => (
    /\.(json|ya?ml)$/i.test(n) && /(openapi|swagger)/i.test(full)
  ));
  const openapiRecords = [];
  let openapiFiles = 0;
  for (const f of specCandidates) {
    const spec = parseOpenApiText(readText(f), f);
    if (!spec) continue;
    openapiFiles += 1;
    openapiRecords.push(...parseOpenApi(spec));
  }

  // GraphQL SDL.
  const sdlFiles = collect(repoDir, (n) => /\.(graphql|gql)$/i.test(n));
  const sdlRecords = [];
  for (const f of sdlFiles) sdlRecords.push(...parseGraphqlSdl(readText(f)));

  if (openapiFiles === 0 && sdlFiles.length === 0) return null; // no artifact -> Pending

  // Gate rest_api_detected on ACTUAL REST records, not merely a spec file being
  // present: an empty/stub OpenAPI (valid header, no operations) must not trip the
  // scorer's `rest_api_detected && restTotal===0 -> null` guard and discard a valid
  // co-present GraphQL score. An empty OpenAPI with no SDL still falls to Pending
  // via the scorer's total===0 guard.
  const hasRest = openapiRecords.length > 0;
  return buildReport({
    applicable: true,
    records: sdlRecords,
    filesParsed: sdlFiles.length,
    restApiDetected: hasRest,
    restRecords: hasRest ? openapiRecords : undefined,
    restFilesParsed: openapiFiles,
  });
}

function main() {
  const cfg = systemConfig(SYSTEM);
  const outDir = reportsDir(SYSTEM);
  const disposition = documentedApisDisposition(cfg.stack);

  if (disposition === 'na') {
    writeJson(outDir, 'documented-apis', buildReport({ applicable: false }));
    return;
  }

  const tree = materialise(systemTarget(SYSTEM), { prefix: `c2-${SYSTEM}`, token: GH_TOKEN });
  try {
    for (const note of tree.notes) console.log(`  ${note}`);
    scanTree(tree, outDir, cfg, disposition);
  } finally {
    // Previously never removed. The Elixir path also writes its AST extraction
    // into this same directory, so it was the larger of the two leaks.
    tree.cleanup();
  }
}

function scanTree(tree, outDir, cfg, disposition) {
  const repoDir = tree.dir;
  const work = path.dirname(repoDir);

  let report;
  if (disposition === 'elixir-ast') {
    report = scanElixirAst(repoDir, work);
  } else { // 'artifact'
    report = scanArtifacts(repoDir);
    if (!report) {
      // No committed API artifact to read. That is a real answer — the scan ran
      // and there was nothing to measure — and it used to be recorded by writing
      // nothing at all, which made it indistinguishable from the scan dying
      // before it wrote anything. Downstream, both look like an absent report.
      //
      // A report with no records scores exactly as an absent one did (zero total
      // is Pending, never a full-marks zero-over-zero), so nothing about the
      // score changes. What changes is that a missing file now means failure
      // again, which is the only thing that lets anything upstream check.
      report = buildReport({ applicable: true, records: [], filesParsed: 0 });
      console.log(`C2 ${SYSTEM} (${tree.label}, stack=${cfg.stack}) — no committed API artifact (-> Pending)`);
    }
  }

  writeJson(outDir, 'documented-apis', report);
  console.log(`Scanned C2 ${SYSTEM} (${tree.label}, stack=${cfg.stack}, disposition=${disposition}) -> ${outDir}`);
}

if (require.main === module) main();

module.exports = { main, scanElixirAst, scanArtifacts, collect };
