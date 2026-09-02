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

test("every open-PR-head exclusion names a real open PR", () => {
  const audit = loadAudit();
  for (const entry of audit.open_pr_heads_excluded) {
    assert.equal(entry.pr_state, "OPEN", `${entry.name} is excluded as an open PR head but pr_state is ${entry.pr_state}`);
    assert.equal(typeof entry.pr_number, "number");
    assert.ok(entry.reason.length > 20, `${entry.name}: no reason for the exclusion`);
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

// This is the guard tests/mutation/manifest.mjs exercises: flip a "must_be_preserved" branch to
// "safe_to_delete_after_578" and this test must be the one that notices.
test("a branch with unmerged work found nowhere else must be marked must be preserved", () => {
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
  // The fixture is expected to actually contain this case today; otherwise the assertion above
  // never runs and the guard is decorative.
  assert.ok(
    audit.branches.some((entry) => entry.merged_into_dev === false && entry.merged_into_main === false && entry.unmerged_commit_count > 0),
    "no branch in the fixture exercises the unmerged-work-must-be-preserved case"
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
