import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// #572 phase one is a read-only audit: no branch may be deleted, renamed, or force-pushed until
// #578 has preserved the evidence. The audit is only worth having if it is checkable rather than
// merely prose, so this file is the check -- it reads the committed snapshot the same way a human
// reviewer would and fails if the snapshot is incomplete, self-contradictory, or recommends
// deletion for something it has no basis to delete.
//
// Following the pattern in lib/github-state.mjs (see its header comment): the suite runs offline
// against a committed snapshot, not a live `git ls-remote`/`gh pr list` call. A live check here
// would go red every time another agent in this batch pushes or merges a branch, which is the
// exact "live path with looser rules" failure mode that file was written to avoid. The snapshot's
// own recorded generation method is asserted below so the fixture cannot silently stop saying how
// it was produced.
//
// The fixture has already needed one correction: its first version classified
// task/issue-588-mark-done as must_be_preserved because no PR referenced it yet, and shortly after
// that snapshot was taken, PR #591 was opened against it. That is expected under a batch this size,
// not a bug -- which is why the fixture carries an explicit snapshot_warning, a dev_sha_at_snapshot,
// and a revision_history rather than presenting itself as current. Those are checked below too.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const auditPath = join(root, "fixtures", "stale-branches", "audit.json");
const docPath = join(root, "docs", "STALE_BRANCH_AUDIT.md");

const loadAudit = () => JSON.parse(readFileSync(auditPath, "utf8"));

const RECOMMENDATIONS = new Set(["safe_to_delete_after_578", "needs_decision", "must_be_preserved"]);

test("the audit file exists and parses", () => {
  assert.equal(existsSync(auditPath), true, `${auditPath} is missing`);
  assert.doesNotThrow(() => loadAudit());
});

test("the audit doc exists and is not empty", () => {
  assert.equal(existsSync(docPath), true, `${docPath} is missing`);
  const doc = readFileSync(docPath, "utf8");
  assert.ok(doc.length > 200, "docs/STALE_BRANCH_AUDIT.md reads as a stub");
});

test("the audit records how it was produced, and it was read-only", () => {
  const audit = loadAudit();
  assert.equal(audit.schema, "aos-stale-branch-audit.v1");
  assert.equal(audit.phase, "read-only-audit");
  assert.equal(typeof audit.method, "string");
  assert.ok(audit.method.length > 20, "no method recorded");
  assert.ok(Array.isArray(audit.ls_remote_snapshot) && audit.ls_remote_snapshot.length > 0);
  assert.deepEqual(audit.excluded_refs, ["main", "dev"]);
});

test("the audit is explicit that it is a stale Phase A snapshot, not a deletion list", () => {
  const audit = loadAudit();
  assert.equal(typeof audit.snapshot_warning, "string");
  assert.ok(audit.snapshot_warning.length > 40, "snapshot_warning is too short to actually warn anyone");
  assert.match(audit.snapshot_warning, /Phase B/, "snapshot_warning must name Phase B as the re-collection point");
  assert.match(audit.snapshot_warning, /not a deletion list|do not act/i, "snapshot_warning must say this file is not to be acted on directly");

  assert.equal(typeof audit.generated_at, "string");
  assert.equal(typeof audit.dev_sha_at_snapshot, "string");
  assert.match(audit.dev_sha_at_snapshot, /^[0-9a-f]{40}$/, "dev_sha_at_snapshot is not a full SHA");
  const devEntry = audit.ls_remote_snapshot.find((entry) => entry.name === "dev");
  assert.ok(devEntry, "ls_remote_snapshot has no dev entry to cross-check dev_sha_at_snapshot against");
  assert.equal(devEntry.sha, audit.dev_sha_at_snapshot, "dev_sha_at_snapshot disagrees with the dev entry in ls_remote_snapshot");

  assert.ok(Array.isArray(audit.revision_history) && audit.revision_history.length > 0, "revision_history is empty");
  for (const rev of audit.revision_history) {
    assert.equal(typeof rev.generated_at, "string");
    assert.ok(typeof rev.note === "string" && rev.note.length > 10, "a revision_history entry has no substantive note");
  }
});

test("drift observed while finalizing this correction is recorded rather than chased into another stale snapshot", () => {
  const audit = loadAudit();
  const drift = audit.drift_observed_while_finalizing_this_correction;
  assert.equal(typeof drift, "object");
  assert.equal(typeof drift.observed_at, "string");
  assert.ok(typeof drift.note === "string" && drift.note.length > 40, "the drift note is too short to be useful");
});

test("branches the coordinator reported but this audit could not find on origin are recorded, not silently assumed", () => {
  const audit = loadAudit();
  const record = audit.branches_reported_but_not_found_on_origin;
  assert.equal(typeof record, "object");
  assert.equal(typeof record.note, "string");
  assert.ok(record.note.length > 40, "the discrepancy note is too short to be useful");
  // Every branch name the coordinator raised needs to be named here, so the discrepancy is legible
  // without diffing this file against a chat log.
  for (const name of [
    "task/issue-553-work",
    "task/issue-554-work",
    "task/issue-555-work",
    "task/issue-556-work",
    "task/issue-565-work",
    "task/issue-567-work",
    "task/issue-582-work"
  ]) {
    assert.ok(record.note.includes(name), `branches_reported_but_not_found_on_origin does not mention ${name}`);
  }
});

test("every remote branch other than main/dev is covered exactly once: audited or recorded as an open PR head", () => {
  const audit = loadAudit();
  const snapshotNames = audit.ls_remote_snapshot.map((entry) => entry.name);
  assert.ok(snapshotNames.includes("main"), "the snapshot must include main to prove it was excluded, not forgotten");
  assert.ok(snapshotNames.includes("dev"), "the snapshot must include dev to prove it was excluded, not forgotten");

  const target = new Set(snapshotNames.filter((name) => !audit.excluded_refs.includes(name)));
  const openPrHeadNames = new Set(audit.open_pr_heads_excluded.map((entry) => entry.name));
  const auditedNames = new Set(audit.branches.map((entry) => entry.name));

  // Silence is not coverage: a branch must land in exactly one of "audited" or "open PR head",
  // never both and never neither.
  for (const name of target) {
    const inBranches = auditedNames.has(name);
    const inOpenPr = openPrHeadNames.has(name);
    assert.equal(inBranches || inOpenPr, true, `${name} is in ls_remote_snapshot but neither audited nor recorded as an open PR head`);
    assert.equal(inBranches && inOpenPr, false, `${name} is both audited and recorded as an open PR head`);
  }
  for (const name of auditedNames) assert.ok(target.has(name), `${name} is audited but not in the ls-remote snapshot`);
  for (const name of openPrHeadNames) assert.ok(target.has(name), `${name} is recorded as an open PR head but not in the ls-remote snapshot`);
});

test("every open-PR-head exclusion names a real open PR, with a recognized recommendation and a reason", () => {
  const audit = loadAudit();
  assert.ok(audit.open_pr_heads_excluded.length > 0);
  for (const entry of audit.open_pr_heads_excluded) {
    assert.equal(entry.pr_state, "OPEN", `${entry.name} is excluded as an open PR head but pr_state is ${entry.pr_state}`);
    assert.equal(typeof entry.pr_number, "number");
    assert.ok(RECOMMENDATIONS.has(entry.recommendation), `${entry.name}: unrecognized recommendation "${entry.recommendation}"`);
    assert.ok(entry.reason.length > 20, `${entry.name}: no reason for the exclusion`);
  }
});

// Deleting an open PR's head branch is explicitly on ISSUE.md's prohibited-actions list, so an
// open-PR-head exclusion may never itself read as deletable -- it is excluded from the stale-branch
// table precisely because it is active, not because someone decided it is safe.
test("no open-PR-head exclusion recommends deletion", () => {
  const audit = loadAudit();
  for (const entry of audit.open_pr_heads_excluded) {
    assert.notEqual(entry.recommendation, "safe_to_delete_after_578", `${entry.name}: an open PR head must never be recommended for deletion`);
  }
});

test("every branch entry has the fields the issue asks for, a reason, and a recognized recommendation", () => {
  const audit = loadAudit();
  assert.ok(audit.branches.length > 0);
  for (const entry of audit.branches) {
    for (const field of [
      "name",
      "head_sha",
      "author_name",
      "author_email",
      "last_commit_date",
      "age_days",
      "merged_into_dev",
      "merged_into_main",
      "unmerged_commit_count",
      "referenced_by_pr",
      "recommendation",
      "reason"
    ]) {
      assert.ok(field in entry, `${entry.name ?? "<unnamed>"} is missing "${field}"`);
    }
    assert.match(entry.head_sha, /^[0-9a-f]{40}$/, `${entry.name}: head_sha is not a full SHA`);
    assert.equal(typeof entry.age_days, "number");
    assert.ok(entry.age_days >= 0, `${entry.name}: negative age`);
    assert.ok(RECOMMENDATIONS.has(entry.recommendation), `${entry.name}: unrecognized recommendation "${entry.recommendation}"`);
    assert.ok(Array.isArray(entry.referenced_by_pr));
  }
});

test("an audited branch with unmerged work found nowhere else must be marked must be preserved", () => {
  const audit = loadAudit();
  for (const entry of audit.branches) {
    const unmergedAndOrphaned = entry.merged_into_dev === false && entry.merged_into_main === false && entry.unmerged_commit_count > 0;
    if (unmergedAndOrphaned) {
      assert.equal(
        entry.recommendation,
        "must_be_preserved",
        `${entry.name}: carries ${entry.unmerged_commit_count} unmerged commit(s) present on no other ref, so it must be preserved, not "${entry.recommendation}"`
      );
      assert.ok(entry.unmerged_summary && entry.unmerged_summary.length > 20, `${entry.name}: must_be_preserved with unmerged work needs a summary of what would be lost`);
    }
  }
  // No branch in the `branches` table happens to be unmerged-and-orphaned right now -- the three
  // branches that were in that state (#570, #572, #588) all picked up open PRs and moved to
  // open_pr_heads_excluded, which is exactly the outcome the rule exists to encourage. The rule is
  // still checked above; it is just not exercised from this side today. The next test exercises the
  // equivalent case on the other side of the coverage split, which the fixture does still contain.
});

// This is the guard tests/mutation/manifest.mjs exercises: flip task/issue-588-mark-done's
// "must_be_preserved" to "safe_to_delete_after_578" and this test must be the one that notices.
test("an open-PR-head branch with unmerged work found nowhere else must be marked must be preserved", () => {
  const audit = loadAudit();
  for (const entry of audit.open_pr_heads_excluded) {
    const unmergedAndOrphaned = entry.merged_into_dev === false && entry.merged_into_main === false && entry.unmerged_commit_count > 0;
    if (unmergedAndOrphaned) {
      assert.equal(
        entry.recommendation,
        "must_be_preserved",
        `${entry.name}: carries ${entry.unmerged_commit_count} unmerged commit(s), so it must be preserved, not "${entry.recommendation}"`
      );
    }
  }
  // The fixture is expected to actually contain this case today; otherwise the assertion above
  // never runs and the guard is decorative.
  assert.ok(
    audit.open_pr_heads_excluded.some((entry) => entry.merged_into_dev === false && entry.merged_into_main === false && entry.unmerged_commit_count > 0),
    "no open-PR-head entry in the fixture exercises the unmerged-work-must-be-preserved case"
  );
});

test("no entry recommends deletion without a reason", () => {
  const audit = loadAudit();
  for (const entry of audit.branches) {
    if (entry.recommendation === "safe_to_delete_after_578") {
      assert.ok(typeof entry.reason === "string" && entry.reason.trim().length > 20, `${entry.name}: recommends deletion with no substantive reason`);
    }
  }
});

test("a fully merged branch is not simultaneously recommended for preservation", () => {
  const audit = loadAudit();
  for (const entry of audit.branches) {
    if (entry.merged_into_dev === true && entry.merged_into_main === true) {
      assert.equal(entry.unmerged_commit_count, 0, `${entry.name}: claims merged into both dev and main but also claims unmerged commits`);
      assert.notEqual(entry.recommendation, "must_be_preserved", `${entry.name}: fully merged into dev and main, no reason to preserve it`);
    }
  }
});
