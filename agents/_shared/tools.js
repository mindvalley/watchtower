'use strict';

/*
 * The only things an agent can do to a codebase: list, read, search.
 *
 * Read-only by construction — there is no write tool, and the tree is the copy
 * or clone target-tree.js made, never the caller's working copy. Every path an
 * agent sends is model output and therefore untrusted: it is resolved against
 * the tree root and refused if it escapes it, through `..`, an absolute path or
 * a symlink.
 *
 * Results are capped so one careless call cannot fill an agent's context; a
 * capped result says so, so the agent narrows its request instead of assuming
 * it saw everything.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '_build', 'deps', 'vendor']);
// Every result stays in the conversation and is re-read on each later turn, so
// these limits are as much about cost as about context.
const LIMITS = { listEntries: 300, readLines: 300, readBytes: 60_000, searchLines: 80, searchTimeoutMs: 20_000 };

class ToolInputError extends Error {}

function resolveInside(root, rel = '.') {
  if (typeof rel !== 'string') throw new ToolInputError('path must be a string');
  const target = path.resolve(root, rel);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ToolInputError(`path escapes the repository: ${rel}`);
  }
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    const realRoot = fs.realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new ToolInputError(`path leaves the repository through a symlink: ${rel}`);
    }
  }
  return target;
}

function listFiles(root, { path: rel = '.', depth = 2 } = {}) {
  const start = resolveInside(root, rel);
  if (!fs.existsSync(start)) throw new ToolInputError(`no such directory: ${rel}`);
  const out = [];
  let capped = false;
  const walk = (dir, d) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_DIRS.has(ent.name)) continue;
      if (out.length >= LIMITS.listEntries) { capped = true; return; }
      const full = path.join(dir, ent.name);
      const shown = path.relative(root, full) + (ent.isDirectory() ? '/' : '');
      out.push(shown);
      if (ent.isDirectory() && d < depth) walk(full, d + 1);
    }
  };
  walk(start, 1);
  return out.join('\n') + (capped ? `\n[capped at ${LIMITS.listEntries} entries — list a narrower path]` : '');
}

function readFile(root, { path: rel, start_line: startLine = 1, end_line: endLine } = {}) {
  const file = resolveInside(root, rel);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ToolInputError(`no such file: ${rel}`);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const from = Math.max(1, Number(startLine) || 1);
  const to = Math.min(lines.length, Number(endLine) || from + LIMITS.readLines - 1, from + LIMITS.readLines - 1);
  let body = '';
  for (let i = from; i <= to; i += 1) {
    const line = `${i}\t${lines[i - 1]}\n`;
    if (body.length + line.length > LIMITS.readBytes) break;
    body += line;
  }
  const shownTo = from + body.split('\n').length - 2;
  const more = shownTo < lines.length ? `[lines ${from}-${shownTo} of ${lines.length} — read on with start_line ${shownTo + 1}]` : `[end of file, ${lines.length} lines]`;
  return `${body}${more}`;
}

function search(root, { pattern, path: rel = '.', glob } = {}) {
  if (!pattern || typeof pattern !== 'string') throw new ToolInputError('pattern is required');
  const target = resolveInside(root, rel);
  const args = ['-rnIE', '--color=never'];
  for (const d of SKIP_DIRS) args.push(`--exclude-dir=${d}`);
  if (glob) args.push(`--include=${glob}`);
  args.push('-e', pattern, path.relative(root, target) || '.');
  let stdout = '';
  try {
    stdout = execFileSync('grep', args, {
      cwd: root, encoding: 'utf8', timeout: LIMITS.searchTimeoutMs, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err.status === 1) return 'no matches';
    if (err.status === 2) throw new ToolInputError(`search failed (bad pattern?): ${String(err.stderr).slice(0, 200)}`);
    throw err;
  }
  const lines = stdout.split('\n').filter(Boolean).map((l) => l.replace(/^\.\//, '').slice(0, 400));
  const shown = lines.slice(0, LIMITS.searchLines);
  return shown.join('\n') + (lines.length > shown.length ? `\n[${lines.length} matches, first ${shown.length} shown — narrow the pattern, path or glob]` : '');
}

const DEFS = [
  {
    name: 'list_files',
    description: 'List files and directories under a path in the repository (directories end with /). Skips .git, node_modules and build output.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory relative to the repository root. Default: the root.' },
        depth: { type: 'integer', description: 'How many levels to descend (1-4). Default 2.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the repository, with line numbers. Up to 300 lines per call; use start_line and end_line to read the part you need.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File relative to the repository root.' },
        start_line: { type: 'integer' },
        end_line: { type: 'integer' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search',
    description: 'Search file contents with an extended regular expression (grep -E). Returns path:line:text. Use glob to limit file types, e.g. "*.ts".',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: 'Directory or file to search under. Default: the root.' },
        glob: { type: 'string', description: 'Only files whose name matches, e.g. "*.yml".' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
];

const RUNNERS = { list_files: listFiles, read_file: readFile, search };

// Returns the tool definitions and a runner that never throws for bad input:
// a bad call becomes an error result the agent can read and correct.
function treeTools(root) {
  return {
    defs: DEFS,
    has: (name) => Object.prototype.hasOwnProperty.call(RUNNERS, name),
    run(name, input) {
      try {
        return { output: RUNNERS[name](root, input || {}), isError: false };
      } catch (err) {
        if (err instanceof ToolInputError) return { output: err.message, isError: true };
        return { output: `tool failed: ${err.message}`, isError: true };
      }
    },
  };
}

module.exports = { treeTools, resolveInside, LIMITS, ToolInputError };
