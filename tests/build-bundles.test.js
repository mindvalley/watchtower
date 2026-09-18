'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  isProgram, programs, bundleTargets,
} = require('../scripts/build-bundles');

test('a file is a program when running it with node does something', () => {
  assert.equal(isProgram('#!/usr/bin/env node\nconsole.log(1);\n'), true);
  assert.equal(isProgram('if (require.main === module) { main(); }\n'), true);
  assert.equal(isProgram('if (require.main===module) main();\n'), true);
});

test('a module that only exports is not a program', () => {
  assert.equal(isProgram("'use strict';\nmodule.exports = { bandFor };\n"), false);
});

test('the scan programs are bundled and the modules they require are not', () => {
  const found = programs();

  assert.ok(found.includes('scan-security.js'));
  assert.ok(found.includes('scan-boundaries.js'));
  assert.ok(found.includes('required-toolchains.js'));
  assert.ok(!found.includes('assemble-benchmark.js'));
  assert.ok(!found.includes('criterion-stacks.js'));
});

test('a program keeps its filename in dist', () => {
  const target = bundleTargets().find((t) => t.program === 'scan-security.js');

  assert.match(target.source, /scripts\/benchmark\/scan-security\.js$/);
  assert.match(target.bundle, /dist\/scan-security\.js$/);
});
