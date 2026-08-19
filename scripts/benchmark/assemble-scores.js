'use strict';

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

const fs = require('fs');
const path = require('path');
const { buildBenchmarkData } = require('./build-benchmark-data');
const { buildFindingsForSystem } = require('./build-findings-data');
const { loadConfig, loadAllowances, reportsRoot, dataDir } = require('./engine-config');
const { writeManifest } = require('./run-manifest');

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
if (require.main === module) {
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
      return JSON.parse(fs.readFileSync(path.join(__dirname, 'triage-config.json'), 'utf8'));
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
