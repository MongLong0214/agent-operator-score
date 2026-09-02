import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { cleanupInvariantFindings, deletionLogFindings } from "../../lib/branch-audit.mjs";

// Phase B of #572 deletes refs. The issue names the invariants that must hold across that deletion
// -- main, dev, the release tags, branch protection and the open PR heads all unchanged -- and the
// only way to check them afterwards is to have written down what they were before. This file checks
// that the baseline exists and is internally consistent now, while the log still says NOT_YET, so
// that a Phase B agent has something to compare against rather than a blank page.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audit = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "audit.json"), "utf8"));
const deletionLog = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "deletion-log.json"), "utf8"));

test("the audit records a pre-deletion baseline for every invariant the issue names", () => {
  const baseline = audit.invariant_baseline;
  assert.match(baseline.main_sha, /^[0-9a-f]{40}$/u, "no baseline main SHA");
  assert.match(baseline.dev_sha, /^[0-9a-f]{40}$/u, "no baseline dev SHA");
  assert.ok(Array.isArray(baseline.tags) && baseline.tags.length > 0, "no baseline tag list");
  for (const tag of baseline.tags) {
    assert.equal(typeof tag.name, "string");
    assert.match(tag.sha, /^[0-9a-f]{40}$/u, `tag ${tag.name}: not a full SHA`);
  }
  assert.equal(baseline.protection.main.allow_deletions, false, "main is recorded as deletable");
  assert.equal(baseline.protection.dev.allow_deletions, false, "dev is recorded as deletable");
  assert.equal(baseline.protection.main.allow_force_pushes, false, "main is recorded as force-pushable");
  assert.equal(baseline.protection.dev.allow_force_pushes, false, "dev is recorded as force-pushable");
  assert.ok(Array.isArray(baseline.open_pr_heads), "no baseline list of open PR heads");
});

test("the baseline main and dev SHAs are the ones in the ls-remote snapshot", () => {
  const findings = cleanupInvariantFindings(audit, deletionLog);
  assert.deepEqual(findings, [], `invariant findings: ${findings.join(" | ")}`);
});

test("a baseline whose main SHA disagrees with the snapshot is refused", () => {
  const forged = { ...audit, invariant_baseline: { ...audit.invariant_baseline, main_sha: "0".repeat(40) } };
  const findings = cleanupInvariantFindings(forged, deletionLog);
  assert.notDeepEqual(findings, [], "a baseline that disagrees with its own snapshot passed the check");
});

test("the deletion log is NOT_YET, records that it is blocked on #578 and #588, and lists no deletion", () => {
  const findings = deletionLogFindings(deletionLog);
  assert.deepEqual(findings, [], `deletion log findings: ${findings.join(" | ")}`);
  assert.equal(deletionLog.status, "NOT_YET");
  assert.deepEqual(deletionLog.deleted, []);
  assert.deepEqual([...deletionLog.blocked_by].sort((a, b) => a - b), [578, 588]);
  assert.equal(deletionLog.post_delete_state, null);
});

// The failure this guards is the cheap one: flipping the status to COMPLETED while nothing was
// actually deleted and no post-delete state was ever read back.
test("a COMPLETED deletion log with no post-delete state read back is refused", () => {
  const forged = { ...deletionLog, status: "COMPLETED", deleted: [{ name: "tmp/read-claude-artifact", sha: "2d6392f578dd2667d5f1f6ba5073a2c4311430eb" }] };
  const findings = deletionLogFindings(forged);
  assert.notDeepEqual(findings, [], "a COMPLETED log with no post-delete state passed the check");
});

test("a NOT_YET deletion log that nevertheless lists a deleted branch is refused", () => {
  const forged = { ...deletionLog, deleted: [{ name: "tmp/read-claude-artifact", sha: "2d6392f578dd2667d5f1f6ba5073a2c4311430eb" }] };
  const findings = deletionLogFindings(forged);
  assert.notDeepEqual(findings, [], "a NOT_YET log that claims a deletion passed the check");
});

test("a deletion log that drops #578 or #588 from what blocks it is refused while NOT_YET", () => {
  const forged = { ...deletionLog, blocked_by: [578] };
  const findings = deletionLogFindings(forged);
  assert.notDeepEqual(findings, [], "a NOT_YET log that forgot #588 passed the check");
});
