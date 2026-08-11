'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractScript } = require('../../scripts/benchmark/vue-sfc');

test('extracts a plain script block', () => {
  const sfc = ['<template>', '  <div/>', '</template>', '', '<script>', 'export default {};', '</script>'].join('\n');
  const r = extractScript(sfc);
  assert.strictEqual(r.lang, 'js');
  assert.strictEqual(r.code.trim(), 'export default {};');
});

test('line offset points at the first line of code in the original file', () => {
  const sfc = ['<template>', '  <div/>', '</template>', '', '<script>', 'const a = 1;', '</script>'].join('\n');
  const r = extractScript(sfc);
  // <script> is line 5, so the first code line is line 6.
  assert.strictEqual(r.lineOffset, 6);
});

test('a lang="ts" attribute selects the typescript extension', () => {
  const r = extractScript('<script lang="ts">\nconst a: number = 1;\n</script>');
  assert.strictEqual(r.lang, 'ts');
  assert.strictEqual(r.lineOffset, 2);
});

test('setup and other attributes do not confuse the lang detection', () => {
  assert.strictEqual(extractScript('<script setup lang="ts">\nconst a = 1;\n</script>').lang, 'ts');
  assert.strictEqual(extractScript('<script setup>\nconst a = 1;\n</script>').lang, 'js');
});

test('single quotes on the lang attribute are accepted', () => {
  assert.strictEqual(extractScript("<script lang='ts'>\nlet x = 1;\n</script>").lang, 'ts');
});

test('a file with no script block returns null', () => {
  assert.strictEqual(extractScript('<template><div/></template>'), null);
});

test('an unterminated script block returns null rather than the rest of the file', () => {
  assert.strictEqual(extractScript('<template/>\n<script>\nconst a = 1;'), null);
});

test('the template block is never included in the extracted code', () => {
  const sfc = '<template>\n  <button @click="go">{{ label }}</button>\n</template>\n<script>\nfunction go() {}\n</script>';
  const r = extractScript(sfc);
  assert.ok(!r.code.includes('button'), 'template markup must not reach the complexity analyzer');
});

test('a script block appearing before the template is handled', () => {
  const sfc = '<script>\nfunction a() {}\n</script>\n<template><div/></template>';
  const r = extractScript(sfc);
  assert.strictEqual(r.lineOffset, 2);
  assert.ok(r.code.includes('function a'));
});

test('same-line content: code on the same line as the opening tag returns the tag line, not tag+1', () => {
  // Source is one line: '<script>const x = 1</script>'
  // <script> is on line 1, and the code begins on that same line, so lineOffset must be 1.
  const r = extractScript('<script>const x = 1</script>');
  assert.strictEqual(r.lineOffset, 1);
});

test('same-line content preceded by a template: non-trivial line count is correct', () => {
  // Lines: 1='<template>', 2='</template>', 3='<script>const x = 1</script>'
  // The code sits on the same line as the tag (line 3), so lineOffset must be 3 — not 4.
  const sfc = '<template>\n</template>\n<script>const x = 1</script>';
  const r = extractScript(sfc);
  assert.strictEqual(r.lineOffset, 3);
});
