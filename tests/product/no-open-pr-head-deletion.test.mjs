import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DELETION_BLOCKED_BY, deletionAuthorizationFindings, deletionEligibility, loadCompletionSnapshot, openPrHeadDeletionFindings } from "../../scripts/branch-audit.mjs";
import { observationDigest } from "../../scripts/collect-branch-state.mjs";

// The prohibition in #572 that cannot be walked back: deleting the head branch of an open pull
// request destroys its diff. This file is the check standing between the audit and that outcome, and
// it has to hold in three directions -- an open PR head may never be eligible in the audit, the
// deletion record may never name one, and neither may a pull request that was opened *after* the
// audit was written. Only the third of those can be checked against something other than the
// author's own record, which is why `deletionAuthorizationFindings` takes a live observation and
// refuses without one.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audit = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "audit.json"), "utf8"));
const baseline = audit.invariant_baseline;
const completion = loadCompletionSnapshot();

const clearedCompletion = () => ({
  ...completion,
  issues: completion.issues.map((issue) =>
    DELETION_BLOCKED_BY.includes(issue.number)
      ? { ...issue, state: "closed", close_evidence: { audit_report_digest: `sha256:${"a".repeat(64)}` } }
      : issue
  )
});

/** An observation shaped exactly as the collector emits one, agreeing with the audit. */
const observation = (overrides = {}) => {
  const heads = audit.ls_remote_snapshot.map((entry) => ({ ...entry }));
  const base = {
    schema: "aos-branch-live-observation.v1",
    repository: audit.repository,
    collected_at: "2026-09-10T00:00:00Z",
    collector: "scripts/collect-branch-state.mjs",
    heads,
    rest_heads: heads,
    open_prs: baseline.open_pr_heads.map((entry) => ({ number: entry.pr, head_branch: entry.branch, head_sha: entry.sha, base: entry.base, state: "OPEN" })),
    receipts: [{ source: "git-ls-remote", command: "git ls-remote --heads origin", exit_code: 0, bytes: 1, digest: `sha256:${"c".repeat(64)}` }],
    ...overrides
  };
  return base;
};

const completedLog = (live, overrides = {}) => ({
  schema: "aos-branch-deletion-log.v1",
  status: "COMPLETED",
  completed_at: "2026-09-10T00:01:00Z",
  blocked_by: [...DELETION_BLOCKED_BY],
  blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "closed" })),
  deleted: deletionEligibility(audit).eligible.map((entry) => ({ name: entry.name, sha: entry.head_sha })),
  live_observation: { digest: observationDigest(live) },
  post_delete_state: {
    main_sha: baseline.main_sha,
    dev_sha: baseline.dev_sha,
    tags: baseline.tags,
    protection: baseline.protection,
    rulesets: baseline.rulesets,
    install_source: baseline.install_source,
    open_pr_heads: baseline.open_pr_heads
  },
  note: "Phase B.",
  ...overrides
});

const authorize = (extra = {}) => {
  const live = extra.live === undefined ? observation() : extra.live;
  const log = extra.log ?? completedLog(live ?? observation());
  return deletionAuthorizationFindings({ audit, log, live, completion: extra.completion ?? clearedCompletion() });
};

test("no branch with an open PR on it is deletion-eligible", () => {
  for (const entry of deletionEligibility(audit).eligible) assert.equal(entry.open_pr, null, `${entry.name}: deletion-eligible while a PR is open on it`);
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

test("an open PR's recorded head SHA is the branch head the audit recorded", () => {
  for (const entry of audit.branches) {
    if (!entry.open_pr) continue;
    assert.equal(entry.open_pr.head_sha, entry.head_sha, `${entry.name}: PR #${entry.open_pr.number} head is not the branch head this audit recorded`);
  }
});

test("a deletion log entry for a branch outside the audit is refused", () => {
  const forged = { deleted: [{ name: "task/issue-999-never-audited", sha: "0".repeat(40) }] };
  assert.notDeepEqual(openPrHeadDeletionFindings(audit, forged), [], "a deletion of a branch this audit never covered passed the check");
});

test("a deletion log entry for a branch the audit records as an open PR head is refused", () => {
  const active = audit.branches.find((entry) => entry.open_pr);
  const findings = openPrHeadDeletionFindings(audit, { deleted: [{ name: active.name, sha: active.head_sha }] });
  assert.notDeepEqual(findings, [], `deleting open PR head ${active.name} passed the check`);
  assert.ok(findings.some((f) => f.includes("was open on it")), `the refusal does not say the branch had a PR open on it: ${findings.join(" | ")}`);
});

test("a deletion log that names an eligible branch at a commit the audit did not judge is refused", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  assert.ok(eligible, "nothing is eligible, so this test would check nothing");
  const findings = openPrHeadDeletionFindings(audit, { deleted: [{ name: eligible.name, sha: "f".repeat(40) }] });
  assert.ok(findings.some((f) => f.includes("this audit judged it at")), `deleting at an unaudited commit passed: ${findings.join(" | ")}`);
});

test("a deletion log that names an eligible branch at the commit the audit judged is accepted", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  assert.deepEqual(openPrHeadDeletionFindings(audit, { deleted: [{ name: eligible.name, sha: eligible.head_sha }] }), [], "the deletion Phase B is supposed to be able to make was refused");
});

// --- the live boundary --------------------------------------------------------------------------
//
// Everything above reads only the stored audit, which is written by the party proposing the
// deletion. These are the checks that ask the repository instead.

test("a deletion authorized only from stored facts is refused outright", () => {
  const findings = authorize({ live: null });
  assert.ok(findings.some((f) => f.includes("no live observation was supplied")), `a deletion with no live observation was authorized: ${findings.join(" | ")}`);
});

test("a complete record with a matching live observation authorizes the deletion", () => {
  assert.deepEqual(authorize(), [], "the deletion Phase B is supposed to be able to make was refused");
});

test("a pull request opened after the audit was written blocks the deletion, whatever the audit says", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  const live = observation();
  live.open_prs = [...live.open_prs, { number: 999, head_branch: eligible.name, head_sha: eligible.head_sha, base: "dev", state: "OPEN" }];
  const findings = deletionAuthorizationFindings({ audit, log: completedLog(live), live, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("reads as eligible in the audit but PR #999")), `the audit's eligible set was not re-checked against the live PR list: ${findings.join(" | ")}`);
  // And the stored-only check cannot see it, which is the whole reason the live parameter exists.
  assert.deepEqual(openPrHeadDeletionFindings(audit, completedLog(live)), [], "the stored check unexpectedly saw the live PR, making this test measure nothing");
});

test("a deletion at a commit the branch no longer points at is refused", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  const live = observation();
  live.heads = live.heads.map((head) => (head.name === eligible.name ? { ...head, sha: "e".repeat(40) } : head));
  live.rest_heads = live.heads;
  const findings = deletionAuthorizationFindings({ audit, log: completedLog(live), live, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("but live it points at")), `deleting a moved branch was authorized: ${findings.join(" | ")}`);
});

test("a deletion of a branch the live repository does not have is refused", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  const live = observation();
  live.heads = live.heads.filter((head) => head.name !== eligible.name);
  live.rest_heads = live.heads;
  const findings = deletionAuthorizationFindings({ audit, log: completedLog(live), live, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("does not show it on the repository")), `deleting an absent branch was authorized: ${findings.join(" | ")}`);
});

// The record has to cite the observation it was actually checked against, or "we looked" is a claim
// about a different look.
test("a deletion record that does not cite the digest of the observation it was checked against is refused", () => {
  const live = observation();
  const log = completedLog(live, { live_observation: { digest: `sha256:${"9".repeat(64)}` } });
  const findings = deletionAuthorizationFindings({ audit, log, live, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("does not cite the digest")), `a record citing a different observation was authorized: ${findings.join(" | ")}`);
});

test("an observation collected after the deletion, or too long before it, is refused", () => {
  const late = observation({ collected_at: "2026-09-10T00:02:00Z" });
  assert.ok(deletionAuthorizationFindings({ audit, log: completedLog(late), live: late, completion: clearedCompletion() }).some((f) => f.includes("collected after the deletion")), "an observation from after the deletion was accepted");
  const stale = observation({ collected_at: "2026-09-09T00:00:00Z" });
  assert.ok(deletionAuthorizationFindings({ audit, log: completedLog(stale), live: stale, completion: clearedCompletion() }).some((f) => f.includes("past the")), "a day-old observation was accepted");
});

test("an observation with no command receipts, or of the wrong schema, is refused", () => {
  const bare = observation({ receipts: [] });
  assert.ok(deletionAuthorizationFindings({ audit, log: completedLog(bare), live: bare, completion: clearedCompletion() }).some((f) => f.includes("no command receipts")), "an observation with no receipts was accepted");
  const wrong = observation({ schema: "something-else" });
  assert.ok(deletionAuthorizationFindings({ audit, log: completedLog(wrong), live: wrong, completion: clearedCompletion() }).some((f) => f.includes("not aos-branch-live-observation.v1")), "an observation of the wrong schema was accepted");
});

test("a live head that the audit never covered blocks the deletion", () => {
  const live = observation();
  live.heads = [...live.heads, { name: "task/issue-000-unaudited", sha: "a".repeat(40) }];
  live.rest_heads = live.heads;
  const findings = deletionAuthorizationFindings({ audit, log: completedLog(live), live, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("appears nowhere in this audit")), `an unaudited live head did not block the deletion: ${findings.join(" | ")}`);
});

test("the deletion is refused while the canonical snapshot still shows a blocker open", () => {
  const findings = authorize({ completion });
  assert.ok(findings.some((f) => f.includes("still blocked")), `a deletion ran while a blocker was open: ${findings.join(" | ")}`);
});
