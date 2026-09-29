---
name: agent-compatibility
description: Score a repository against the Agentic Compatibility Benchmark — install/verify the scanners, scan a folder or repo, print the numbers. No dashboard, no Docker. Runs from a clone of mindvalley/watchtower.
---

## When to use / assumptions

Use this skill to score any repository or local folder against the Agentic Compatibility Benchmark. Run it from the root of a `mindvalley/watchtower` clone. This skill is **self-sufficient**: it installs and verifies its own tools and does not require `/setup` to have been run first.

---

## Step 1 — Preflight: verify Node

Run:

```
node --version
```

The version must be **24 or higher**. If Node is absent or older, stop now and tell the user to install Node 24+ (via their version manager or the official installer) before continuing. Do not proceed until this check passes.

---

## Step 2 — Verify the scanners

Run:

```
node .claude/skills/agent-compatibility/scripts/tool-versions.js
```

This is the single source of truth for scanner versions. Review the output carefully.

**If any tool is reported as `missing` or `mismatch`, do not scan.** A wrong version is a changed ruler: results would be incomparable across runs. Instead:

1. Explain to the user which tool is missing or at the wrong version and why this matters.
2. **Offer to install or switch to the pinned version** into a managed, non-system location. Detect the user's OS and architecture at runtime and adapt the instructions accordingly (macOS and Linux are fully supported; Windows is best-effort). Do not hard-code asset URLs or platform tables here — resolve them from what is available at the time.

   **Python-based tools — semgrep, lizard, graphifyy:**
   - Create a dedicated venv: `python3 -m venv ~/.watchtower-tools`
   - Install into it: `~/.watchtower-tools/bin/pip install "semgrep==<pin>" "lizard==<pin>" "graphifyy==<pin>"`
   - Add `~/.watchtower-tools/bin` to `PATH` for the session (and advise the user to add it to their shell profile).
   - Never use `pip install --user` (violates PEP 668 on modern systems).
   - Read the exact pin versions from `scripts/benchmark/scanner-pins.json`.

   **gitleaks, trivy:**
   - Download the pinned release for the detected OS/arch directly from the tool's GitHub releases page (prefer a direct binary download over any `install.sh` script — installer scripts silently 404 on purged releases).
   - Install into a directory already on `PATH`, or a new directory like `~/.local/bin` that the user adds to `PATH`.

   **jscpd:**
   - No installation needed — it runs via `npx` on demand. Network access is required at scan time.

3. **Do not clobber a system-wide install without the user's explicit consent.** If the tool exists but is the wrong version, ask before replacing it.
4. After any installation, re-run `node .claude/skills/agent-compatibility/scripts/tool-versions.js` and confirm every tool is green before proceeding. Do not skip this re-check.

---

## Step 3 — Configuration

**If `watchtower.config.json` already exists in the repo root**, display its contents and ask the user to confirm it is correct before continuing.

**If it does not exist**, build it interactively. For each system the user wants to scan, collect:

- Either `path` (a local folder) **or** `repo` (a GitHub repository slug such as `owner/repo`) — exactly one of these per system entry.
- `stack` — one of: `elixir`, `ruby`, `ts`, `js`, `python`.

When the user provides a `path` value, echo the **resolved absolute path** back to them before writing the config. The path resolves relative to the config file's location, not relative to the current working directory. Confirm it points to the intended directory.

**Never write a credential, token, or secret into `watchtower.config.json`.** If a `repo` entry requires authentication, tell the user to ensure their environment has `GITHUB_TOKEN` set; do not put the token value in the file.

Example minimal config (replace `demo` with the real system key):

```json
{
  "systems": {
    "demo": {
      "path": "/absolute/path/to/repo",
      "stack": "ts"
    }
  }
}
```

After the config is saved, run:

```
WATCHTOWER_CONFIG=watchtower.config.json node scripts/benchmark/required-toolchains.js
```

If the output indicates that **elixir** or **ruby** toolchains are required, verify the corresponding language tools are available:

- Elixir: confirm `mix` and `credo` are on `PATH`.
- Ruby: confirm `rubocop` is on `PATH`.

Apply the same **refuse-then-offer** behaviour as Step 2 for any that are missing. Note: unlike the scanner tools, these language tools are **unpinned** — any recent version is accepted. Offer guidance on installing them via their standard installers (e.g. `asdf`, `mise`, or the language's official toolchain), adapting per detected OS.

---

## Step 4 — Scan

For each system key `<key>` in the config, run the seven scans in the following order. Set `SYSTEM=<key>`, `WATCHTOWER_CONFIG=watchtower.config.json`, and `WATCHTOWER_REPORTS=reports` for every command.

```
SYSTEM=<key> WATCHTOWER_CONFIG=watchtower.config.json WATCHTOWER_REPORTS=reports node scripts/benchmark/scan-security.js
SYSTEM=<key> WATCHTOWER_CONFIG=watchtower.config.json WATCHTOWER_REPORTS=reports node scripts/benchmark/scan-simplicity.js
SYSTEM=<key> WATCHTOWER_CONFIG=watchtower.config.json WATCHTOWER_REPORTS=reports node scripts/benchmark/scan-observability.js
SYSTEM=<key> WATCHTOWER_CONFIG=watchtower.config.json WATCHTOWER_REPORTS=reports node scripts/benchmark/scan-deployment.js
SYSTEM=<key> WATCHTOWER_CONFIG=watchtower.config.json WATCHTOWER_REPORTS=reports node scripts/benchmark/scan-documented-apis.js
SYSTEM=<key> WATCHTOWER_CONFIG=watchtower.config.json WATCHTOWER_REPORTS=reports node scripts/benchmark/scan-test-coverage.js
SYSTEM=<key> WATCHTOWER_CONFIG=watchtower.config.json WATCHTOWER_REPORTS=reports node scripts/benchmark/scan-boundaries.js
```

Do not reorder these. Capture each scan's output. If a scan exits with a non-zero status, surface its output and stop — do not continue to the next scan or to assembly.

---

## Step 5 — Assemble

Run:

```
WATCHTOWER_DATA=data node scripts/benchmark/assemble-scores.js
```

**If `assemble-scores.js` refuses because a report is missing**, do the following:

1. Surface the full output from the scan that was supposed to produce that report.
2. Stop. Do not continue.
3. **Never delete a criterion or omit a report to work around the refusal.** The assembler's refusal is a signal that a scan did not complete successfully; deleting a criterion would silently corrupt the benchmark score.

---

## Step 6 — Print

Run:

```
WATCHTOWER_DATA=data node .claude/skills/agent-compatibility/scripts/print-scores.js
```

This prints a console summary of the benchmark scores.

The outputs are:

- `data/benchmark.json` — the full machine-readable benchmark result.
- Per-system findings files in the `data/` directory (one per system key, named by the system).

Stop here. There is no dashboard step in this skill.
