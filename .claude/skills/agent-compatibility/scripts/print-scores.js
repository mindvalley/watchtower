'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Pure: render a readable summary. Criterion display names live in the dashboard;
// here we show the criterion id and score, which cannot drift out of sync.
function formatSummary(benchmark) {
  const systems = benchmark && benchmark.systems;
  if (!systems || Object.keys(systems).length === 0) {
    return 'No systems in benchmark.json — run the scans and assemble-scores.js first.';
  }
  const sample = benchmark.example ? '  (sample data — not real measurements)' : '';
  const blocks = Object.entries(systems).map(([key, s]) => {
    const head = `${key} — ${s.score}/100 (${s.colour})   ${s.coverage || ''}`.trimEnd();
    const ids = Object.keys(s.criteria || {}).sort((a, b) => Number(a) - Number(b));
    const crit = ids
      .map((id) => {
        const c = s.criteria[id];
        const v = c && c.score != null ? c.score : '—';
        return `C${id} ${v}`;
      })
      .join('   ');
    return `${head}\n  ${crit}`;
  });
  return `Agentic Compatibility scores${sample}\n\n${blocks.join('\n\n')}`;
}

function main() {
  const dataDir = process.env.WATCHTOWER_DATA || 'data';
  const file = path.resolve(dataDir, 'benchmark.json');
  if (!fs.existsSync(file)) {
    console.error(`No benchmark.json at ${file}. Run the scans and assemble-scores.js first.`);
    process.exit(1);
  }
  console.log(formatSummary(JSON.parse(fs.readFileSync(file, 'utf8'))));
  console.log(`\n→ ${file}`);
}

if (require.main === module) main();
module.exports = { formatSummary };
