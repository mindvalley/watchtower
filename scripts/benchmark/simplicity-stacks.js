'use strict';

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
