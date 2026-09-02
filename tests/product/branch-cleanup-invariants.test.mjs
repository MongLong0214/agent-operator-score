import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { cleanupInvariantFindings, deletionEligibility, deletionLogFindings } from "../../lib/branch-audit.mjs";

// Phase B of #572 deletes refs. The issue names what must hold across that deletion -- main, dev,
// the release tags, branch protection and the open PR heads all unchanged -- and the only way to
// check any of it afterwards is to have written down what it was before. This file checks the
// baseline while the log still says NOT_YET, and checks that a well-formed COMPLETED log can pass,
// because a verifier Phase B cannot satisfy is a verifier Phase B will delete.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audit = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "audit.json"), "utf8"));
const deletionLog = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "deletion-log.json"), "utf8"));
const baseline = audit.invariant_baseline;

/** The log Phase B is supposed to be able to write: everything deleted was eligible, nothing moved. */
const completedLog = (overrides = {}, stateOverrides = {}) => ({
  ...deletionLog,
  status: "COMPLETED",
  deleted: deletionEligibility(audit).eligible.map((entry) => ({ name: entry.name, sha: entry.head_sha })),
  blockers_cleared: [
    { issue: 578, evidence: "final release/E2E evidence bundle captured at <sha>" },
    { issue: 588, evidence: "close-evidence confirmation bound to that work at <sha>" }
  ],
  post_delete_state: {
    main_sha: baseline.main_sha,
    dev_sha: baseline.dev_sha,
    tags: baseline.tags,
    protection: baseline.protection,
    rulesets: baseline.rulesets,
    open_pr_heads: baseline.open_pr_heads,
    ...stateOverrides
  },
  ...overrides
});

test("the audit records a pre-deletion baseline for every invariant the issue names", () => {
  assert.match(baseline.main_sha, /^[0-9a-f]{40}$/u, "no baseline main SHA");
  assert.match(baseline.dev_sha, /^[0-9a-f]{40}$/u, "no baseline dev SHA");
  assert.ok(Array.isArray(baseline.tags) && baseline.tags.length > 0, "no baseline tag list");
  for (const tag of baseline.tags) {
    assert.equal(typeof tag.name, "string");
    assert.match(tag.ref_sha, /^[0-9a-f]{40}$/u, `tag ${tag.name}: no ref object id`);
    assert.match(tag.commit_sha, /^[0-9a-f]{40}$/u, `tag ${tag.name}: no commit id`);
  }
  for (const ref of ["main", "dev"]) {
    assert.equal(baseline.protection[ref].allow_deletions, false, `${ref} is recorded as deletable`);
    assert.equal(baseline.protection[ref].allow_force_pushes, false, `${ref} is recorded as force-pushable`);
    assert.equal(typeof baseline.protection[ref].enforce_admins, "boolean", `${ref} does not record enforce_admins`);
  }
  assert.ok(Array.isArray(baseline.rulesets), "no baseline ruleset list");
  assert.ok(Array.isArray(baseline.open_pr_heads) && baseline.open_pr_heads.length > 0, "no baseline list of open PR heads");
  for (const entry of baseline.open_pr_heads) {
    assert.equal(typeof entry.pr, "number");
    assert.match(entry.sha, /^[0-9a-f]{40}$/u, `PR #${entry.pr}: no head SHA to compare after the deletion`);
  }
});

// An annotated tag has two object ids: the ref points at the tag object, which peels to the commit.
// Recording only the commit would let a tag be replaced by a different tag object -- a different
// annotation, a different signature -- over the same commit, with nothing to notice.
test("the baseline records both halves of each tag's identity, not only the commit it peels to", () => {
  const annotated = baseline.tags.filter((tag) => tag.ref_sha !== tag.commit_sha);
  assert.ok(annotated.length > 0, "no annotated tag in the baseline, so this distinction would go unexercised");
});

test("the baseline main and dev SHAs are the ones in the ls-remote snapshot", () => {
  assert.deepEqual(cleanupInvariantFindings(audit, deletionLog), [], "the baseline disagrees with its own snapshot");
});

test("a baseline whose main SHA disagrees with the snapshot is refused", () => {
  const forged = { ...audit, invariant_baseline: { ...baseline, main_sha: "0".repeat(40) } };
  assert.notDeepEqual(cleanupInvariantFindings(forged, deletionLog), [], "a baseline that disagrees with its own snapshot passed the check");
});

test("the deletion log is NOT_YET, records that it is blocked on #578 and #588, and lists no deletion", () => {
  assert.deepEqual(deletionLogFindings(deletionLog), [], "the committed deletion log does not hold its own shape");
  assert.equal(deletionLog.status, "NOT_YET");
  assert.deepEqual(deletionLog.deleted, []);
  assert.deepEqual([...deletionLog.blocked_by].sort((a, b) => a - b), [578, 588]);
  assert.equal(deletionLog.post_delete_state, null);
});

// A verifier Phase B cannot satisfy is a verifier Phase B deletes. This is the positive case: the
// log filled in exactly as docs/STALE_BRANCH_AUDIT.md instructs has to pass both checks.
test("a completed deletion log filled in as the document prescribes passes both checks", () => {
  const log = completedLog();
  assert.ok(log.deleted.length > 0, "nothing was eligible, so this test would check nothing");
  assert.deepEqual(deletionLogFindings(log), [], "a correctly completed log was refused");
  assert.deepEqual(cleanupInvariantFindings(audit, log), [], "a deletion that moved nothing reported invariant findings");
});

test("a COMPLETED deletion log with no post-delete state read back is refused", () => {
  assert.notDeepEqual(deletionLogFindings(completedLog({ post_delete_state: null })), [], "a COMPLETED log with no post-delete state passed the check");
});

test("a NOT_YET deletion log that nevertheless lists a deleted branch is refused", () => {
  const forged = { ...deletionLog, deleted: [{ name: "tmp/read-claude-artifact", sha: "2d6392f578dd2667d5f1f6ba5073a2c4311430eb" }] };
  assert.notDeepEqual(deletionLogFindings(forged), [], "a NOT_YET log that claims a deletion passed the check");
});

test("a deletion log that drops #578 or #588 from what blocks it is refused while NOT_YET", () => {
  assert.notDeepEqual(deletionLogFindings({ ...deletionLog, blocked_by: [578] }), [], "a NOT_YET log that forgot #588 passed the check");
});

// The prohibition the whole issue is built on: deletion happens only after the evidence is
// preserved. Without this, flipping the status is the entire cost of deleting early.
test("a COMPLETED deletion log that does not record #578 and #588 as cleared is refused", () => {
  assert.notDeepEqual(deletionLogFindings(completedLog({ blockers_cleared: [] })), [], "a COMPLETED log with no cleared blockers passed the check");
  assert.notDeepEqual(
    deletionLogFindings(completedLog({ blockers_cleared: [{ issue: 578, evidence: "final release/E2E evidence bundle captured at <sha>" }] })),
    [],
    "a COMPLETED log that cleared only #578 passed the check"
  );
  assert.notDeepEqual(
    deletionLogFindings(completedLog({ blockers_cleared: [{ issue: 578, evidence: "ok" }, { issue: 588, evidence: "ok" }] })),
    [],
    "a COMPLETED log citing nothing substantive for either blocker passed the check"
  );
});

test("branch protection loosened across the deletion is refused", () => {
  const forged = completedLog({}, { protection: { ...baseline.protection, main: { ...baseline.protection.main, allow_deletions: true } } });
  const findings = cleanupInvariantFindings(audit, forged);
  assert.notDeepEqual(findings, [], "main becoming deletable across the deletion passed the check");
  assert.ok(findings.some((finding) => finding.includes("allow_deletions")), `the finding does not name the setting that changed: ${findings.join(" | ")}`);
});

test("a post-delete state that simply omits protection, rulesets or the open PR heads is refused", () => {
  for (const field of ["protection", "rulesets", "open_pr_heads"]) {
    const forged = completedLog({}, { [field]: undefined });
    assert.notDeepEqual(cleanupInvariantFindings(audit, forged), [], `a post-delete state with no ${field} passed the check`);
  }
});

test("an open PR head that is gone or moved across the deletion is refused", () => {
  const gone = completedLog({}, { open_pr_heads: baseline.open_pr_heads.slice(1) });
  assert.notDeepEqual(cleanupInvariantFindings(audit, gone), [], "an open PR head disappearing across the deletion passed the check");
  const moved = completedLog({}, {
    open_pr_heads: baseline.open_pr_heads.map((entry, index) => (index === 0 ? { ...entry, sha: "0".repeat(40) } : entry))
  });
  assert.notDeepEqual(cleanupInvariantFindings(audit, moved), [], "an open PR head moving across the deletion passed the check");
});

// The tag case the peeled commit cannot see: the same commit, a different tag object.
test("a tag replaced by another tag object over the same commit is refused", () => {
  const annotated = baseline.tags.find((tag) => tag.ref_sha !== tag.commit_sha);
  const forged = completedLog({}, {
    tags: baseline.tags.map((tag) => (tag.name === annotated.name ? { ...tag, ref_sha: "0".repeat(40) } : tag))
  });
  const findings = cleanupInvariantFindings(audit, forged);
  assert.notDeepEqual(findings, [], "a tag re-pointed at a different tag object over the same commit passed the check");
  assert.ok(findings.some((finding) => finding.includes("was replaced")), `the finding does not say the tag was replaced: ${findings.join(" | ")}`);
});

test("a tag whose commit moved, or which disappeared, across the deletion is refused", () => {
  const moved = completedLog({}, { tags: baseline.tags.map((tag, index) => (index === 0 ? { ...tag, commit_sha: "0".repeat(40) } : tag)) });
  assert.notDeepEqual(cleanupInvariantFindings(audit, moved), [], "a moved tag passed the check");
  const dropped = completedLog({}, { tags: baseline.tags.slice(1) });
  assert.notDeepEqual(cleanupInvariantFindings(audit, dropped), [], "a deleted tag passed the check");
});
