'use strict';

// Pure C9 scoring. Consumes normalized counts from parse-reports.js and applies
// the fixed convention anchors: 0 secrets, 0 Critical/High dependency CVEs (CIS v8),
// OWASP/CWE SAST severities. Any critical sub-metric flags the hard-cap.

function round1(n) {
  return Math.round(n * 10) / 10;
}

function colourFor(score) {
  if (score <= 2.0) return 'red';
  if (score <= 3.5) return 'amber';
  return 'green';
}

function scoreSecrets(count) {
  return count > 0
    ? { score: 0.0, colour: 'red', critical: true }
    : { score: 5.0, colour: 'green', critical: false };
}

function scoreSeverity(counts) {
  if (counts.critical > 0) return { score: 1.0, colour: 'red', critical: true };
  if (counts.high > 0) return { score: 2.5, colour: 'amber', critical: false };
  if (counts.medium > 0) return { score: 3.5, colour: 'amber', critical: false };
  return { score: 5.0, colour: 'green', critical: false };
}

function severityParts(c) {
  const parts = [];
  if (c.critical) parts.push(`${c.critical} Critical`);
  if (c.high) parts.push(`${c.high} High`);
  if (c.medium) parts.push(`${c.medium} Medium`);
  return parts;
}

// Only DIRECT deps are scored: prod CVEs carry production risk (full weight,
// can hard-cap); dev-only CVEs are discounted (folded into medium, never
// hard-cap). Transitive CVEs are excluded from scoring entirely — they're
// unactionable without their direct parent and are surfaced as informational.
function effectiveDeps({ prod, dev }) {
  return {
    critical: prod.critical,
    high: prod.high,
    medium: prod.medium + dev.critical + dev.high + dev.medium,
    low: prod.low + dev.low,
  };
}

function secretsFinding(secrets) {
  const confirmed = secrets.confirmed_secrets != null ? secrets.confirmed_secrets : secrets.secrets;
  const review = secrets.review_secrets || 0;
  const excluded = secrets.excluded_by_path || 0;
  const base = confirmed > 0
    ? `${confirmed} confirmed exposed secret(s) (gitleaks)`
    : 'No confirmed exposed secrets (gitleaks)';
  const extras = [];
  if (review > 0) extras.push(`${review} key-like string(s) to review`);
  if (excluded > 0) extras.push(`${excluded} test/fixture match(es) excluded`);
  return extras.length ? `${base} · ${extras.join(' · ')}` : base;
}

function depsFinding(deps) {
  const parts = severityParts(deps.prod);
  let text = parts.length === 0
    ? 'No Critical/High CVEs in direct production dependencies (trivy)'
    : `${parts.join(', ')} direct production dependency CVEs (trivy)`;
  if (deps.dev.total > 0) text += `; ${deps.dev.total} dev-only CVE(s) discounted`;
  if (deps.transitive.total > 0) text += `; ${deps.transitive.total} transitive CVE(s) shown for info`;
  return text;
}

function sastFinding(sast) {
  const parts = severityParts(sast.triaged);
  let text = parts.length === 0
    ? 'No high-severity SAST findings (semgrep)'
    : `${parts.join(', ')} SAST findings (semgrep)`;
  if (sast.remapped > 0) text += `; ${sast.remapped} supply-chain-tag finding(s) remapped to info`;
  return text;
}

function scoreSecurity({ secrets, deps, sast, assessedAt }) {
  const eff = effectiveDeps(deps);
  const sub = {
    secrets: scoreSecrets(secrets.secrets),
    deps: scoreSeverity(eff),
    sast: scoreSeverity(sast.triaged),
  };
  const score = round1((sub.secrets.score + sub.deps.score + sub.sast.score) / 3);
  const critical = sub.secrets.critical || sub.deps.critical || sub.sast.critical;
  const colour = critical ? 'red' : colourFor(score);

  const findings = [secretsFinding(secrets), depsFinding(deps), sastFinding(sast)];

  const actions = [];
  if (secrets.secrets > 0) actions.push('Remove the exposed secret(s) and rotate the credentials; add a pre-commit gitleaks hook.');
  if ((secrets.review_secrets || 0) > 0) actions.push('Review the key-like strings flagged by the gitleaks generic rule — rotate any real secrets, allowlist confirmed false positives (public IDs, GA tags).');
  if (eff.critical > 0 || eff.high > 0) actions.push('Upgrade or patch dependencies with Critical/High CVEs (trivy) to a fixed version.');
  if (sast.triaged.critical > 0 || sast.triaged.high > 0) actions.push('Triage and fix the high-severity SAST findings (semgrep); add the rules to CI.');

  const audit = {
    secrets: {
      raw: secrets.raw_secrets || 0,
      triaged: secrets.triaged_secrets != null ? secrets.triaged_secrets : secrets.secrets,
      confirmed: secrets.confirmed_secrets != null ? secrets.confirmed_secrets : secrets.secrets,
      review: secrets.review_secrets || 0,
      excluded_by_path: secrets.excluded_by_path || 0,
    },
    deps: {
      raw: deps.raw, prod: deps.prod, dev: deps.dev, transitive: deps.transitive,
    },
    sast: {
      raw: sast.raw,
      triaged: sast.triaged,
      remapped: sast.remapped || 0,
      excluded_by_path: sast.excluded_by_path || 0,
    },
  };

  return {
    score, colour, critical, assessed: true, assessed_at: assessedAt,
    source: 'gitleaks + trivy (vuln, prod/dev split) + semgrep (--config auto, triaged)',
    sub, findings, actions, audit,
  };
}

module.exports = {
  round1, colourFor, scoreSecrets, scoreSeverity, scoreSecurity, effectiveDeps,
};
