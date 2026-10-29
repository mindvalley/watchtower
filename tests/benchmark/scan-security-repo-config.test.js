'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  gitleaksArgs, semgrepArgs, makeNeutralDir, neutraliseRepoConfig,
} = require('../../scripts/benchmark/scan-security');

const hasGitleaks = (() => {
  try { execFileSync('gitleaks', ['version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

// Built at runtime so this file does not itself look like a committed key.
const fakeKey = (c) => `AIza${'Sy'}${c.repeat(4)}9fK2mQ7xL3vB8nR1tW5zH0jD6pE4cG`;

function plantRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-config-'));
  fs.writeFileSync(path.join(dir, 'allowlisted.env'), `GCP_API_KEY=${fakeKey('a')}\n`);
  fs.writeFileSync(path.join(dir, 'inline.env'), `GCP_API_KEY=${fakeKey('b')} # gitleaks:allow\n`);
  fs.writeFileSync(path.join(dir, 'ignored.env'), `GCP_API_KEY=${fakeKey('c')}\n`);
  fs.writeFileSync(path.join(dir, 'control.env'), `GCP_API_KEY=${fakeKey('d')}\n`);
  fs.writeFileSync(path.join(dir, '.gitleaks.toml'),
    "[extend]\nuseDefault = true\n[allowlist]\npaths = ['''allowlisted\\.env''']\n");
  return dir;
}

function found(args, cwd) {
  const report = args[args.indexOf('--report-path') + 1];
  execFileSync('gitleaks', args, { stdio: 'ignore', cwd });
  return JSON.parse(fs.readFileSync(report, 'utf8')).map((f) => path.basename(f.File)).sort();
}

test('the scanned repository cannot suppress its own gitleaks findings', { skip: !hasGitleaks && !process.env.CI && 'gitleaks not installed' }, () => {
  const repo = plantRepo();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-config-out-'));
  const neutral = makeNeutralDir();

  const plain = ['detect', '--source', repo, '--no-git', '--report-format', 'json',
    '--report-path', path.join(out, 'plain.json'), '--exit-code', '0'];
  // Fingerprints carry the rule gitleaks chose, so take them from its own output.
  found(plain, repo);
  const ignored = JSON.parse(fs.readFileSync(path.join(out, 'plain.json'), 'utf8'))
    .filter((f) => path.basename(f.File) === 'ignored.env').map((f) => f.Fingerprint);
  assert.strictEqual(ignored.length, 1);
  fs.writeFileSync(path.join(repo, '.gitleaksignore'), `${ignored[0]}\n`);

  // The plants must work against plain gitleaks, or this test proves nothing.
  assert.deepStrictEqual(found(plain, repo), ['control.env']);

  assert.deepStrictEqual(neutraliseRepoConfig(repo), ['.gitleaks.toml', '.gitleaksignore']);
  assert.deepStrictEqual(found(gitleaksArgs(repo, out, neutral), repo),
    ['allowlisted.env', 'control.env', 'ignored.env', 'inline.env']);
});

test('semgrep does not honour nosemgrep comments in the scanned repository', () => {
  assert.ok(semgrepArgs('/repo', '/out').includes('--disable-nosem'));
});
