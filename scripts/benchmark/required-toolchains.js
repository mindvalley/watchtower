'use strict';

/*
 * Which language toolchains an install has to provide, read from the
 * configuration the run is about to obey.
 *
 * The action used to install Elixir, OTP and Ruby unconditionally while the
 * scanner it was installing them for already consulted the declared stack to
 * decide whether to use them. So an organisation with no Elixir systems paid
 * for the whole BEAM toolchain on every run and then never invoked it. The
 * configuration was already the answer; nothing was asking it.
 *
 * Derived from the stack each system already declares rather than from a new
 * "enable Elixir" switch. Two fields that have to agree about the same fact is
 * how this project got a score scale that disagreed with its own badge.
 *
 * WHAT THE TOOLCHAINS ARE FOR, and it is a shorter list than the install
 * suggests:
 *
 *   elixir + otp  Credo, which measures complexity on Elixir source (C8), and
 *                 the two AST helpers the C2 reader uses on Elixir systems.
 *   ruby          Rubocop, which measures complexity on Ruby source (C8).
 *
 * Everything else the action installs — gitleaks, trivy, semgrep, lizard,
 * graphify — is language-agnostic and runs on every scan.
 *
 * TWO WAYS THIS DELIBERATELY OVER-INSTALLS, because the failure it is avoiding
 * is worse than the minute it costs:
 *
 *   1. No readable configuration. The caller may keep it somewhere this action
 *      was not told about, and an unreadable file must not quietly become "no
 *      toolchains" — the scan would then fail deep inside C8 with an ENOENT on
 *      `mix`, which reads as a broken engine rather than a missing input.
 *   2. A system with no declared stack. Absent is not evidence of absence. The
 *      C8 scanner also defaults an undeclared stack to Elixir, so guessing the
 *      other way would break exactly the configs that are least specific.
 *
 * In both cases the result is what happens today, plus a line saying why.
 *
 * WHAT THIS CANNOT SEE, and callers should know it. C8 does not measure the
 * declared stack — it measures every language it finds material in the tree
 * (>=500 LOC), because scoring one language and skipping the rest published a
 * complexity number over a subset of the code. So a repository declared
 * `typescript` that also carries 2,000 lines of Ruby needs Rubocop, and no
 * amount of reading the config will say so. That scan fails loudly rather than
 * scoring the Ruby green — see scan-simplicity's missing-tool check — and the
 * install-elixir / install-ruby inputs exist to force the toolchain in without
 * having to misdeclare the stack.
 */

// The stacks that need a language runtime installed before they can be
// measured. Every other stack is read by tools that carry their own.
const TOOLCHAIN_BY_STACK = Object.assign(Object.create(null), {
  elixir: 'elixir',
  ruby: 'ruby',
});

const TOOLCHAINS = ['elixir', 'ruby'];

const ALL = () => Object.fromEntries(TOOLCHAINS.map((t) => [t, true]));

// `auto` (the default) derives from the config. `true` and `false` are for the
// case the config cannot express: a repository whose material languages are not
// the stack it is declared as.
function applyOverrides(decided, overrides = {}) {
  const out = { ...decided };
  const notes = [];
  for (const toolchain of TOOLCHAINS) {
    const raw = overrides[toolchain];
    if (raw === undefined || raw === null || raw === '' || raw === 'auto') continue;
    if (raw !== 'true' && raw !== 'false' && typeof raw !== 'boolean') {
      throw new Error(
        `install-${toolchain} must be 'auto', 'true' or 'false' — got '${raw}'`,
      );
    }
    const forced = raw === true || raw === 'true';
    if (forced !== out[toolchain]) {
      notes.push(`${toolchain} forced ${forced ? 'on' : 'off'} by install-${toolchain}`);
    }
    out[toolchain] = forced;
  }
  return { toolchains: out, notes };
}

/*
 * config   the parsed watchtower configuration, or null when it could not be
 *          read. Null is a legitimate input, not an error: see (1) above.
 * overrides  { elixir, ruby } each 'auto' | 'true' | 'false'.
 *
 * Returns { toolchains: { elixir, ruby }, why: [lines] }. `why` is printed by
 * the caller — an install decision nobody can see the reasoning for is the kind
 * that gets blamed for an unrelated failure a year later.
 */
function requiredToolchains(config, overrides = {}) {
  const why = [];
  let decided;

  const systems = config && config.systems;
  if (!systems || typeof systems !== 'object' || Array.isArray(systems)) {
    decided = ALL();
    why.push('no readable system list — installing every toolchain, which is what happened before this step existed');
  } else {
    const keys = Object.keys(systems);
    if (keys.length === 0) {
      decided = ALL();
      why.push('the system list is empty — installing every toolchain');
    } else {
      decided = Object.fromEntries(TOOLCHAINS.map((t) => [t, false]));
      const undeclared = [];
      const declared = new Map();

      for (const key of keys) {
        const stack = systems[key] && systems[key].stack;
        if (typeof stack !== 'string' || !stack) {
          undeclared.push(key);
          continue;
        }
        const toolchain = TOOLCHAIN_BY_STACK[stack];
        if (!toolchain) continue;
        decided[toolchain] = true;
        if (!declared.has(toolchain)) declared.set(toolchain, []);
        declared.get(toolchain).push(key);
      }

      if (undeclared.length > 0) {
        // Absent is not evidence of absence, and C8 reads an undeclared stack as
        // Elixir. Installing everything is the only answer that cannot turn a
        // vague config into a scan that dies two steps later.
        Object.assign(decided, ALL());
        why.push(`no stack declared for ${undeclared.sort().join(', ')} — installing every toolchain rather than guessing`);
      }

      for (const toolchain of TOOLCHAINS) {
        const systemsFor = declared.get(toolchain);
        if (systemsFor) {
          why.push(`${toolchain}: declared by ${systemsFor.sort().join(', ')}`);
        } else if (!decided[toolchain]) {
          why.push(`${toolchain}: no system declares it — skipped`);
        }
      }
    }
  }

  const { toolchains, notes } = applyOverrides(decided, overrides);
  why.push(...notes);
  return { toolchains, why };
}

// --- the other end of the same problem ------------------------------------
//
// The install is decided from the declared stack; C8 is not. It measures every
// language it finds material in the tree, because scoring one language and
// silently skipping the rest published a complexity number over a subset of the
// code while duplication covered all of it.
//
// So the two can disagree, and only the scan is in a position to notice. When
// they do, the binary is simply absent and execFileSync raises ENOENT on `mix`
// — which reads as a broken engine rather than a missing declaration. These
// turn that into a sentence naming both the cause and the two ways out.
//
// It fails the scan either way. That is the point: a repository with 2,000
// lines of unmeasured Ruby must not be scored as though the Ruby were clean.
const BINARY_FOR_TOOL = Object.assign(Object.create(null), {
  credo: 'mix',
  rubocop: 'rubocop',
  lizard: 'lizard',
});

// Only these two are gated on a declared stack; lizard is always installed, so
// its absence means a broken install rather than a missing declaration.
const STACK_FOR_TOOL = Object.assign(Object.create(null), {
  credo: 'elixir',
  rubocop: 'ruby',
});

// languages    the measured languages discoverLanguages returned
// isInstalled  binary name -> boolean. Injected so this is testable without a
//              toolchain, which is the only environment it will ever be tested in.
function missingToolchains(languages, isInstalled) {
  const seen = new Set();
  const missing = [];
  for (const lang of languages || []) {
    const binary = BINARY_FOR_TOOL[lang.tool];
    if (!binary || seen.has(binary)) continue;
    seen.add(binary);
    if (isInstalled(binary)) continue;
    missing.push({
      language: lang.language, tool: lang.tool, binary, stack: STACK_FOR_TOOL[lang.tool] || null, loc: lang.loc,
    });
  }
  return missing;
}

function missingToolchainMessage(missing, { systemKey, declaredStack } = {}) {
  const parts = missing.map((m) => (
    `${m.language} (${m.loc} lines) needs ${m.tool}, and ${m.binary} is not installed`
  ));
  const gated = missing.filter((m) => m.stack);
  const fix = gated.length === 0
    ? 'This tool is installed unconditionally, so its absence means a broken install rather than a missing declaration.'
    : `C8 measures every material language in the tree, not the declared stack`
      + `${declaredStack ? ` (this system declares '${declaredStack}')` : ''}. `
      + `Either declare the stack that matches, or set `
      + `${gated.map((m) => `install-${m.stack}: true`).join(' and ')} on the action.`;
  return `C8 ${systemKey || ''}: ${parts.join('; ')}. `
    + `Refusing to score ${missing.length === 1 ? 'this language' : 'these languages'} as clean. ${fix}`;
}

module.exports = {
  requiredToolchains,
  TOOLCHAINS,
  TOOLCHAIN_BY_STACK,
  BINARY_FOR_TOOL,
  STACK_FOR_TOOL,
  missingToolchains,
  missingToolchainMessage,
};

// --- I/O edge -------------------------------------------------------------
// Run by action.yml from the caller's workspace. Writes `elixir=true|false`
// lines to $GITHUB_OUTPUT (or stdout when it is unset, so it is runnable by
// hand) and the reasoning to stderr.
//
// It reads the config directly rather than through engine-config.loadConfig,
// which throws on a missing or malformed file. Here that is not an error: it is
// case (1), and the answer is to install everything and say so.
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');

  const file = path.resolve(
    process.env.WATCHTOWER_CONFIG_INPUT
    || process.env.WATCHTOWER_CONFIG
    || 'watchtower.config.json',
  );

  let config = null;
  let readNote = null;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    config = null;
    readNote = `could not read ${file}: ${err.message}`;
  }

  const { toolchains, why } = requiredToolchains(config, {
    elixir: process.env.INSTALL_ELIXIR,
    ruby: process.env.INSTALL_RUBY,
  });

  console.error(`watchtower: toolchain install decided from ${file}`);
  if (readNote) console.error(`  ${readNote}`);
  for (const line of why) console.error(`  ${line}`);

  const out = TOOLCHAINS.map((t) => `${t}=${toolchains[t]}`).join('\n');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${out}\n`);
  } else {
    console.log(out);
  }
}
