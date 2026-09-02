import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { deletionEligibility, openPrHeadDeletionFindings } from "../../lib/branch-audit.mjs";

// The single prohibition in #572 that cannot be walked back: deleting the head branch of an open
// pull request destroys the PR's diff. This file is the check that stands between the audit and
// that outcome, and it has to hold in both directions -- an open PR head may never be marked
// deletable in the audit, and the deletion log may never name one.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audit = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "audit.json"), "utf8"));
const deletionLog = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "deletion-log.json"), "utf8"));

test("no branch with an open PR on it is deletion-eligible", () => {
  const { eligible } = deletionEligibility(audit);
  for (const entry of eligible) {
    assert.equal(entry.open_pr, null, `${entry.name}: deletion-eligible while PR #${entry.open_pr?.number} is open on it`);
  }
});

test("every branch with an open PR is classified ACTIVE and recommended for preservation", () => {
  let exercised = false;
  for (const entry of audit.branches) {
    if (!entry.open_pr) continue;
    exercised = true;
    assert.equal(entry.open_pr.state, "OPEN", `${entry.name}: open_pr is recorded but its state is ${entry.open_pr.state}`);
    assert.equal(entry.classification, "ACTIVE", `${entry.name}: has open PR #${entry.open_pr.number} but is classified ${entry.classification}`);
    assert.equal(entry.recommendation, "must_be_preserved", `${entry.name}: has open PR #${entry.open_pr.number} but is recommended "${entry.recommendation}"`);
  }
  assert.ok(exercised, "no audited branch is the head of an open PR -- this test would otherwise pass without checking anything");
});

// The recorded open PR head SHA has to be the branch head the audit recorded. If they disagree the
// audit read the branch at one moment and the PR at another, and neither number can be trusted for
// a deletion decision.
test("an open PR's recorded head SHA is the branch head the audit recorded", () => {
  for (const entry of audit.branches) {
    if (!entry.open_pr) continue;
    assert.equal(entry.open_pr.head_sha, entry.head_sha, `${entry.name}: PR #${entry.open_pr.number} head ${entry.open_pr.head_sha} is not the branch head ${entry.head_sha} this audit recorded`);
  }
});

test("the deletion log names no branch that the audit records as an open PR head", () => {
  const findings = openPrHeadDeletionFindings(audit, deletionLog);
  assert.deepEqual(findings, [], `open-PR-head deletion findings: ${findings.join(" | ")}`);
});

// A deletion log that names a branch the audit never audited is a deletion nobody reviewed, whether
// or not that branch happened to have a PR open.
test("a deletion log entry for a branch outside the audit is refused", () => {
  const forged = { ...deletionLog, status: "COMPLETED", deleted: [{ name: "task/issue-999-never-audited", sha: "0".repeat(40) }] };
  const findings = openPrHeadDeletionFindings(audit, forged);
  assert.notDeepEqual(findings, [], "a deletion of a branch this audit never covered passed the check");
});

test("a deletion log entry for a branch the audit records as an open PR head is refused", () => {
  const active = audit.branches.find((entry) => entry.open_pr);
  assert.ok(active, "the fixture has no open PR head to build the counterfactual from");
  const forged = { ...deletionLog, status: "COMPLETED", deleted: [{ name: active.name, sha: active.head_sha }] };
  const findings = openPrHeadDeletionFindings(audit, forged);
  assert.notDeepEqual(findings, [], `deleting open PR head ${active.name} passed the check`);
  assert.ok(
    findings.some((finding) => finding.includes("was open on it")),
    `the refusal does not say the branch had a PR open on it, only that it was not eligible: ${findings.join(" | ")}`
  );
});
