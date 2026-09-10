# Allowances

Some findings are not problems — the code is development-only or the finding is a false positive.

An allowance removes the finding from the score and keeps it in the report, marked with its reason. Nothing disappears: a report says "3 findings, 1 allowed" rather than "2 findings".

Each entry therefore changes a published number, so each one is worth its own review.

**Matched on a specific line:**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "secrets",
      "system": "platform",
      "file": "config/dev.exs",
      "rule": "generic-api-key",
      "line": 12,
      "reason": "Public reCAPTCHA site key, not a secret",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

**Matched anywhere in a file:**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "secrets",
      "system": "platform",
      "file": "config/dev.exs",
      "rule": "generic-api-key",
      "reason": "Public reCAPTCHA site key, not a secret",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

**Matched anywhere in the system:**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "secrets",
      "system": "platform",
      "rule": "generic-api-key",
      "reason": "Public reCAPTCHA site key, not a secret",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

Each field you add narrows the allowance — `rule` alone matches it anywhere in the codebase, `rule` + `file` only in that file. Paths are repo-relative.

**Deps — allow a CVE anywhere it appears:**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "deps",
      "system": "platform",
      "id": "CVE-2023-44487",
      "reason": "HTTP/2 rapid-reset — mitigated at the load balancer, not exploitable here",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

**Deps — allow a specific package (all CVEs for that package):**

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "deps",
      "system": "platform",
      "package": "storybook",
      "reason": "dev-only in practice — not installed in production",
      "allowed_by": "person@company.com",
      "allowed_on": "2026-08-19T09:32:00.000Z"
    }
  ]
}
```

Allowances apply to findings that were *found*:

**`security` / `secrets`**

| Field | Meaning |
|---|---|
| `file` | Repo-relative path of the file containing the secret |
| `rule` | Gitleaks rule ID, e.g. `generic-api-key` |
| `line` | Line number; omit to match the rule anywhere in the file |

**`security` / `deps`**

| Field | Meaning |
|---|---|
| `package` | Package name |
| `id` | CVE identifier, e.g. `CVE-2023-44487` |
| `severity` | Normalized severity: `critical`, `high`, `medium`, or `low` |
| `installed` | Installed version string |
| `bucket` | Dependency classification: `prod`, `dev`, or `transitive` |
| `target` | Lockfile the scanner read, e.g. `mix.lock` |

**`security` / `sast`**

| Field | Meaning |
|---|---|
| `id` | Rule ID as reported by the SAST tool |
| `path` | Repo-relative path of the file containing the finding |
| `severity` | Normalized severity: `high`, `medium`, or `low` |

**`simplicity` / `complexity`**

| Field | Meaning |
|---|---|
| `file` | Repo-relative path of the file containing the violation |
| `scope` | Function or method name the linter reported on |
| `language` | Language the linter runs against |

Allowances only apply to detected findings, not to absences like "no rollback configured".

Duplication cannot be allowed — the score is a percentage from the tool, not a count of individual blocks, so removing a block wouldn't move the number.

All unused allowances are reported after every run.
