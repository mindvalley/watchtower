'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  toolForExtension, discoverLanguages, MATERIALITY_FLOOR_LOC,
  lizardInvocation, LIZARD_READER_BY_EXT, LANGUAGE_TOOLS,
} = require('../../scripts/benchmark/simplicity-stacks');

test('extensions map to their complexity tool', () => {
  assert.strictEqual(toolForExtension('.ex').tool, 'credo');
  assert.strictEqual(toolForExtension('.exs').tool, 'credo');
  assert.strictEqual(toolForExtension('.rb').tool, 'rubocop');
  assert.strictEqual(toolForExtension('.ts').tool, 'lizard');
  assert.strictEqual(toolForExtension('.tsx').tool, 'lizard');
  assert.strictEqual(toolForExtension('.py').tool, 'lizard');
  assert.strictEqual(toolForExtension('.vue').tool, 'lizard');
});

test('an unmapped extension returns null rather than a default tool', () => {
  assert.strictEqual(toolForExtension('.sql'), null);
  assert.strictEqual(toolForExtension('.nope'), null);
});

test('sibling extensions merge into one language entry', () => {
  const { measured } = discoverLanguages({ '.js': 4000, '.jsx': 2000 });
  assert.strictEqual(measured.length, 1);
  assert.strictEqual(measured[0].language, 'javascript');
  assert.strictEqual(measured[0].loc, 6000);
  assert.deepStrictEqual(measured[0].exts.sort(), ['.js', '.jsx']);
});

test('several languages are all measured, not just the largest', () => {
  const { measured } = discoverLanguages({ '.ex': 180000, '.ts': 90000, '.vue': 40000 });
  assert.deepStrictEqual(measured.map((m) => m.language).sort(), ['elixir', 'typescript', 'vue']);
});

test('a language under the materiality floor is skipped and named', () => {
  const { measured, skippedImmaterial } = discoverLanguages({ '.ex': 90000, '.py': 120 });
  assert.deepStrictEqual(measured.map((m) => m.language), ['elixir']);
  assert.deepStrictEqual(skippedImmaterial, [{ language: 'python', loc: 120 }]);
});

test('the floor is inclusive at its boundary', () => {
  const { measured } = discoverLanguages({ '.py': MATERIALITY_FLOOR_LOC });
  assert.deepStrictEqual(measured.map((m) => m.language), ['python']);
});

test('an unmapped extension is published as unmeasured with its line count', () => {
  const { measured, unmeasured } = discoverLanguages({ '.ex': 90000, '.sql': 8800 });
  assert.deepStrictEqual(measured.map((m) => m.language), ['elixir']);
  assert.deepStrictEqual(unmeasured, [{ extension: '.sql', loc: 8800, reason: 'no mapped tool' }]);
});

test('an unmapped extension below the floor is still reported, never dropped', () => {
  const { unmeasured } = discoverLanguages({ '.sql': 12 });
  assert.strictEqual(unmeasured.length, 1, 'no-silent-caps: an unmapped extension is always named');
});

test('the lookup table has a null prototype so inherited keys cannot resolve', () => {
  assert.strictEqual(toolForExtension('constructor'), null);
  assert.strictEqual(toolForExtension('__proto__'), null);
});

test('a zero-LOC unmapped extension is still reported in unmeasured, never dropped', () => {
  const { unmeasured } = discoverLanguages({ '.sql': 0 });
  assert.strictEqual(unmeasured.length, 1, 'zero-loc unmapped extension must appear in unmeasured');
  assert.strictEqual(unmeasured[0].extension, '.sql');
  assert.strictEqual(unmeasured[0].loc, 0);
  assert.strictEqual(unmeasured[0].reason, 'no mapped tool');
});

// ---------------------------------------------------------------------------
// lizard reader resolution (C1 / C2)
//
// lizard's `-l` selects a READER, not a language family. `-l javascript` reads
// .js/.cjs/.mjs and nothing else; `-l typescript` reads .ts and nothing else;
// .tsx and .jsx belong to a third reader. Mapping one lizard language name per
// benchmark language meant .tsx and .jsx were never analysed while their lines
// stayed in the density denominator — worst on React repos, where .tsx holds the
// branchiest code.
// ---------------------------------------------------------------------------

test('every extension mapped to lizard has a lizard reader', () => {
  for (const [language, cfg] of Object.entries(LANGUAGE_TOOLS)) {
    if (cfg.tool !== 'lizard') continue;
    const exts = cfg.extractionExts || cfg.exts;
    const { uncovered } = lizardInvocation(exts, cfg.extractionOwnedExts || cfg.exts);
    assert.deepStrictEqual(uncovered, [], `${language} has extensions no lizard reader reads`);
  }
});

test('the javascript pass enables the jsx-capable reader and .jsx is not left unread', () => {
  const inv = lizardInvocation(['.js', '.jsx'], LANGUAGE_TOOLS.javascript.exts);
  assert.ok(inv.readers.includes('javascript'), '.js needs the javascript reader');
  assert.ok(inv.readers.includes('tsx'), '.jsx is only read by the tsx/jsx reader');
  assert.deepStrictEqual(inv.uncovered, []);
});

test('the typescript pass enables the tsx reader so .tsx is analysed', () => {
  const inv = lizardInvocation(['.ts', '.tsx'], LANGUAGE_TOOLS.typescript.exts);
  assert.deepStrictEqual(inv.readers, ['tsx', 'typescript']);
  assert.deepStrictEqual(inv.uncovered, []);
});

test('the shared tsx/jsx reader cannot double-count across the two passes', () => {
  // The tsx reader answers to BOTH .tsx and .jsx, so each pass must exclude the
  // extension it does not own or the same file is counted twice.
  const js = lizardInvocation(['.js', '.jsx'], LANGUAGE_TOOLS.javascript.exts);
  const ts = lizardInvocation(['.ts', '.tsx'], LANGUAGE_TOOLS.typescript.exts);
  assert.deepStrictEqual(js.excludeExts, ['.tsx']);
  assert.deepStrictEqual(ts.excludeExts, ['.jsx']);
});

test('an extension present but owned by neither pass is never silently excluded', () => {
  // .mjs is javascript's own, just absent from this repo: excluding it would be
  // noise, and it must not be reported as foreign.
  const inv = lizardInvocation(['.js'], LANGUAGE_TOOLS.javascript.exts);
  assert.strictEqual(inv.excludeExts.includes('.mjs'), false);
  assert.strictEqual(inv.excludeExts.includes('.cjs'), false);
});

test('the Vue extraction tree is read by BOTH the javascript and typescript readers', () => {
  // vue-sfc writes a lang="ts" block to <name>.vue.ts. Running the extraction
  // tree as javascript alone read only the .vue.js half — 135 of alpha's 222
  // extracted SFCs produced no rows while all 41,446 Vue lines stayed in the
  // denominator.
  const { measured } = discoverLanguages({ '.vue': 41446 });
  const vue = measured.find((m) => m.language === 'vue');
  assert.deepStrictEqual(vue.lizardReaders, ['javascript', 'typescript']);
  assert.deepStrictEqual(vue.lizardExcludeExts, [], 'the extraction tree owns .js and .ts outright');
});

test('an extension with no lizard reader is moved out of the denominator and reported', () => {
  // Structural guarantee: a mapped extension that lizard cannot read must never
  // inflate the denominator for free. Simulate one by mapping a language whose
  // extension lizard has no reader for.
  const saved = LIZARD_READER_BY_EXT['.jsx'];
  delete LIZARD_READER_BY_EXT['.jsx'];
  try {
    const { measured, unmeasured } = discoverLanguages({ '.js': 5000, '.jsx': 3000 });
    const js = measured.find((m) => m.language === 'javascript');
    assert.strictEqual(js.loc, 5000, '.jsx lines must leave the denominator');
    const lost = unmeasured.find((u) => u.extension === '.jsx');
    assert.ok(lost, 'the unreadable extension must be counted and reported');
    assert.strictEqual(lost.loc, 3000);
    assert.match(lost.reason, /no lizard reader/);
  } finally {
    LIZARD_READER_BY_EXT['.jsx'] = saved;
  }
});

test('discoverLanguages resolves readers per measured language', () => {
  const { measured } = discoverLanguages({
    '.ts': 20000, '.tsx': 30000, '.js': 9000, '.jsx': 8000,
  });
  const byLang = Object.fromEntries(measured.map((m) => [m.language, m]));
  assert.deepStrictEqual(byLang.typescript.lizardReaders, ['tsx', 'typescript']);
  assert.deepStrictEqual(byLang.javascript.lizardReaders, ['javascript', 'tsx']);
});

// ---------------------------------------------------------------------------
// Deterministic ordering: unmeasured / skipped_immaterial are written verbatim
// into findings-*.json, so filesystem walk order would churn the file between
// runs and defeat the data-PR change gate.
// ---------------------------------------------------------------------------

test('unmeasured is sorted by extension so the report does not churn between runs', () => {
  const a = discoverLanguages({
    '.zsh': 10, '.sql': 20, '.ex': 90000, '.awk': 30,
  }).unmeasured;
  const b = discoverLanguages({
    '.awk': 30, '.ex': 90000, '.zsh': 10, '.sql': 20,
  }).unmeasured;
  assert.deepStrictEqual(a.map((u) => u.extension), ['.awk', '.sql', '.zsh']);
  assert.deepStrictEqual(a, b, 'same inputs in a different walk order must produce identical output');
});

test('skipped_immaterial is sorted by language', () => {
  const { skippedImmaterial } = discoverLanguages({
    '.py': 10, '.rb': 20, '.ex': 30, '.ts': 40,
  });
  assert.deepStrictEqual(
    skippedImmaterial.map((s) => s.language),
    ['elixir', 'python', 'ruby', 'typescript'],
  );
});
