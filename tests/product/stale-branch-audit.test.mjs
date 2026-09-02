import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CLASSIFICATIONS,
  RECOMMENDATIONS,
  auditCoverageFindings,
  classificationFindings,
  deletionEligibility,
  unestablishedFindings
} from "../../lib/branch-audit.mjs";

// #572 phase one is a read-only audit: no branch may be deleted, renamed, or force-pushed until
// #578 and #588 have preserved the evidence. An audit is only worth having if it is checkable
// rather than merely prose, so this file is the check -- it reads the committed snapshot the way a
// reviewer would and fails if the snapshot is incomplete, self-contradictory, or lets something it
// has no basis to delete read as deletable.
//
// Following the pattern in lib/github-state.mjs (see its header comment), the suite runs offline
// against a committed snapshot rather than a live `git ls-remote` / `gh pr list`. A live check here
// would go red every time another agent in this batch pushes or merges a branch, which is the exact
// "live path with looser rules" failure that file exists to avoid. What the snapshot cannot do is
// stay true, so it carries its own generation time, the `dev` SHA it was taken at, and a revision
// history -- and those are checked here, so the fixture can never quietly present itself as current.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const auditPath = join(root, "fixtures", "stale-branches", "audit.json");
const docPath = join(root, "docs", "STALE_BRANCH_AUDIT.md");

const loadAudit = () => JSON.parse(readFileSync(auditPath, "utf8"));
const isNonEmptyName = (value) => typeof value === "string" && value.trim().length > 0;

test("the audit file exists and parses", () => {
  assert.equal(existsSync(auditPath), true, `${auditPath} is missing`);
  assert.doesNotThrow(() => loadAudit());
});

test("the audit doc exists and is not a stub", () => {
  assert.equal(existsSync(docPath), true, `${docPath} is missing`);
  const doc = readFileSync(docPath, "utf8");
  assert.ok(doc.length > 200, "docs/STALE_BRANCH_AUDIT.md reads as a stub");
});

test("the audit declares the read-only phase, a method, and an ls-remote snapshot that excludes main and dev by name", () => {
  const audit = loadAudit();
  assert.equal(audit.schema, "aos-stale-branch-audit.v2");
  assert.equal(audit.phase, "read-only-audit");
  assert.equal(typeof audit.method, "string");
  assert.ok(audit.method.length > 20, "no method recorded");
  assert.ok(Array.isArray(audit.ls_remote_snapshot) && audit.ls_remote_snapshot.length > 0);
  assert.deepEqual(audit.excluded_refs, ["main", "dev"]);
});

test("the audit is explicit that it is a point-in-time snapshot, and states the dev SHA it was taken at", () => {
  const audit = loadAudit();
  assert.equal(typeof audit.snapshot_warning, "string");
  assert.ok(audit.snapshot_warning.length > 40, "snapshot_warning is too short to warn anyone");
  assert.match(audit.snapshot_warning, /Phase B/, "snapshot_warning must name Phase B as the re-collection point");
  assert.match(audit.snapshot_warning, /not a deletion list|do not act/i, "snapshot_warning must say this file is not to be acted on directly");

  assert.equal(typeof audit.generated_at, "string");
  assert.match(audit.invariant_baseline.dev_sha, /^[0-9a-f]{40}$/, "the baseline dev SHA is not a full SHA");
  const devEntry = audit.ls_remote_snapshot.find((entry) => entry.name === "dev");
  assert.ok(devEntry, "ls_remote_snapshot has no dev entry to cross-check the baseline against");
  assert.equal(devEntry.sha, audit.invariant_baseline.dev_sha, "the baseline dev SHA disagrees with the dev entry in ls_remote_snapshot");

  assert.ok(Array.isArray(audit.revision_history) && audit.revision_history.length > 0, "revision_history is empty");
  for (const rev of audit.revision_history) {
    assert.equal(typeof rev.generated_at, "string");
    assert.ok(typeof rev.note === "string" && rev.note.length > 10, "a revision_history entry has no substantive note");
  }
});

// The previous snapshot of this same fixture recorded seven heads, three of which had been merged
// and auto-deleted by the time this one was taken. A snapshot that silently drops them reads as if
// they never existed; the point of this issue is that a branch leaves a trace when it goes.
test("heads recorded by an earlier snapshot but absent from this one are accounted for by name, with the PR that consumed them", () => {
  const audit = loadAudit();
  const absent = audit.previously_recorded_heads_now_absent;
  assert.ok(Array.isArray(absent) && absent.length > 0, "no earlier heads are accounted for");
  for (const entry of absent) {
    assert.match(entry.prior_sha, /^[0-9a-f]{40}$/, `${entry.name}: prior_sha is not a full SHA`);
    assert.equal(entry.fate.state, "MERGED", `${entry.name}: a head that vanished without a merged PR is unexplained, not accounted for`);
    assert.equal(typeof entry.fate.pr, "number", `${entry.name}: no PR number for the merge that consumed it`);
    assert.match(entry.fate.merge_commit, /^[0-9a-f]{40}$/, `${entry.name}: no merge commit SHA`);
  }
});

test("every branch in the snapshot other than main and dev is audited exactly once", () => {
  const audit = loadAudit();
  const findings = auditCoverageFindings(audit);
  assert.deepEqual(findings, [], `coverage findings: ${findings.join(" | ")}`);
  const snapshotNames = audit.ls_remote_snapshot.map((entry) => entry.name);
  assert.ok(snapshotNames.includes("main"), "the snapshot must include main to prove it was excluded, not forgotten");
  assert.ok(snapshotNames.includes("dev"), "the snapshot must include dev to prove it was excluded, not forgotten");
});

test("every branch entry carries the fields the issue lists, a recognized classification and a recognized recommendation", () => {
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
      "classification",
      "merged_into_dev",
      "merged_into_main",
      "unique_commits_vs_dev",
      "unique_commits_vs_main",
      "release_tags_containing",
      "open_pr",
      "superseding",
      "preserve",
      "references",
      "branch_protected",
      "unestablished",
      "recommendation",
      "reason"
    ]) {
      assert.ok(field in entry, `${entry.name ?? "<unnamed>"} is missing "${field}"`);
    }
    assert.match(entry.head_sha, /^[0-9a-f]{40}$/u, `${entry.name}: head_sha is not a full SHA`);
    assert.equal(typeof entry.age_days, "number");
    assert.ok(entry.age_days >= 0, `${entry.name}: negative age`);
    assert.ok(CLASSIFICATIONS.has(entry.classification), `${entry.name}: unrecognized classification "${entry.classification}"`);
    assert.ok(RECOMMENDATIONS.has(entry.recommendation), `${entry.name}: unrecognized recommendation "${entry.recommendation}"`);
    assert.ok(Array.isArray(entry.release_tags_containing), `${entry.name}: release_tags_containing is not an array`);
    assert.ok(Array.isArray(entry.preserve), `${entry.name}: preserve is not an array`);
    assert.ok(Array.isArray(entry.unestablished), `${entry.name}: unestablished is not an array`);
  }
});

test("a classification and its recommendation agree: only MERGED or SUPERSEDED may read as deletable", () => {
  const audit = loadAudit();
  const findings = classificationFindings(audit);
  assert.deepEqual(findings, [], `classification findings: ${findings.join(" | ")}`);
});

// The instruction this issue exists to enforce: a fact the audit could not establish is named,
// not resolved into "safe to delete". An unestablished fact either blocks deletion or carries a
// written argument for why it does not bear on it -- silence is not an argument.
test("an unestablished fact is named and either blocks deletion or says in writing why it does not bear on deletion", () => {
  const audit = loadAudit();
  const findings = unestablishedFindings(audit);
  assert.deepEqual(findings, [], `unestablished findings: ${findings.join(" | ")}`);
  const named = audit.branches.flatMap((entry) => entry.unestablished);
  assert.ok(named.length > 0, "no branch names anything it could not establish -- an audit that established everything about every branch would be the first one");
});

test("a branch is deletion-eligible only when nothing on it is unique to it, no PR is open on it, and it is not protected", () => {
  const audit = loadAudit();
  const { eligible, ineligible, findings } = deletionEligibility(audit);
  assert.deepEqual(findings, [], `the audit carries findings, so eligibility is empty for a reason unrelated to this test: ${findings.join(" | ")}`);
  assert.ok(eligible.length > 0, "no branch is deletion-eligible, so the per-entry assertions below would check nothing");
  for (const entry of audit.branches) {
    const isEligible = eligible.some((candidate) => candidate.name === entry.name);
    if (!isEligible) continue;
    assert.equal(entry.merged_into_dev, true, `${entry.name}: eligible but not merged into dev`);
    assert.equal(entry.merged_into_main, true, `${entry.name}: eligible but not merged into main`);
    assert.equal(entry.unique_commits_vs_dev, 0, `${entry.name}: eligible while holding commits dev does not have`);
    assert.equal(entry.unique_commits_vs_main, 0, `${entry.name}: eligible while holding commits main does not have`);
    assert.equal(entry.open_pr, null, `${entry.name}: eligible while a PR is open on it`);
    assert.equal(entry.branch_protected, false, `${entry.name}: eligible while protected`);
    assert.ok(entry.reason.trim().length > 20, `${entry.name}: recommends deletion with no substantive reason`);
  }
  assert.ok(eligible.length + ineligible.length === audit.branches.length, "eligibility did not partition the audited branches");
});

test("a branch carrying commits that reach neither dev nor main is never recommended for deletion", () => {
  const audit = loadAudit();
  let exercised = false;
  for (const entry of audit.branches) {
    if (entry.merged_into_dev === false && entry.merged_into_main === false && entry.unique_commits_vs_dev > 0) {
      exercised = true;
      assert.notEqual(
        entry.recommendation,
        "safe_to_delete_after_578",
        `${entry.name}: carries ${entry.unique_commits_vs_dev} commit(s) that reach neither dev nor main, so it cannot read as deletable`
      );
      assert.ok(entry.preserve.length > 0, `${entry.name}: unmerged work with nothing recorded to preserve`);
    }
  }
  assert.ok(exercised, "no audited branch carries commits outside dev and main -- this test would otherwise pass without checking anything");
});

test("a fully merged branch does not also claim unique commits", () => {
  const audit = loadAudit();
  for (const entry of audit.branches) {
    if (entry.merged_into_dev === true && entry.merged_into_main === true) {
      assert.equal(entry.unique_commits_vs_dev, 0, `${entry.name}: claims merged into dev and main but also claims commits unique to it`);
      assert.equal(entry.unique_commits_vs_main, 0, `${entry.name}: claims merged into dev and main but also claims commits unique to it`);
    }
  }
});

// The audit cannot record the SHA of the branch it is being submitted from -- that commit is the
// one carrying this file. Naming the branch anyway is the difference between a snapshot a reader
// can reconcile against a live ls-remote and one that looks simply wrong.
test("the branch this audit is submitted from is named, even though its SHA cannot be recorded here", () => {
  const audit = loadAudit();
  const later = audit.heads_created_after_this_snapshot;
  assert.ok(Array.isArray(later) && later.length > 0, "the audit does not account for the branch it is submitted from");
  for (const entry of later) {
    assert.ok(isNonEmptyName(entry.name), "an entry in heads_created_after_this_snapshot has no branch name");
    assert.equal(entry.sha, null, `${entry.name}: a head created after the snapshot cannot carry a SHA the snapshot observed`);
    assert.equal(entry.classification, "ACTIVE", `${entry.name}: a branch created after the snapshot is in flight, not stale`);
    assert.ok(entry.note.length > 40, `${entry.name}: no explanation of why it is recorded outside the snapshot`);
  }
  assert.ok(
    later.every((entry) => !audit.ls_remote_snapshot.some((head) => head.name === entry.name)),
    "a head recorded as created after the snapshot is also in the snapshot"
  );
});

// The document is rendered from the fixture, so the two can only disagree by someone editing one of
// them. A reader who acts on the document rather than the JSON has to be reading the same audit.
test("the document names every branch the fixture audits, at the SHA the fixture recorded", () => {
  const audit = loadAudit();
  const doc = readFileSync(docPath, "utf8");
  for (const entry of audit.branches) {
    assert.ok(doc.includes(entry.name), `docs/STALE_BRANCH_AUDIT.md does not name ${entry.name}`);
    assert.ok(doc.includes(entry.head_sha), `docs/STALE_BRANCH_AUDIT.md does not carry ${entry.name}'s recorded SHA ${entry.head_sha}`);
    assert.ok(doc.includes(entry.recommendation), `docs/STALE_BRANCH_AUDIT.md does not state ${entry.name}'s recommendation`);
  }
  assert.ok(doc.includes(audit.invariant_baseline.main_sha), "the document does not state the baseline main SHA");
  assert.ok(doc.includes(audit.invariant_baseline.dev_sha), "the document does not state the baseline dev SHA");
});

test("no entry recommends deletion without a substantive reason", () => {
  const audit = loadAudit();
  let exercised = false;
  for (const entry of audit.branches) {
    if (entry.recommendation !== "safe_to_delete_after_578") continue;
    exercised = true;
    assert.ok(typeof entry.reason === "string" && entry.reason.trim().length > 20, `${entry.name}: recommends deletion with no substantive reason`);
  }
  assert.ok(exercised, "no entry recommends deletion -- this test would otherwise pass without checking anything");
  assert.deepEqual(classificationFindings(audit), [], "a deletion recommendation with an empty reason must also be a classification finding");
});

// --- counterfactuals -------------------------------------------------------------------------
//
// The fixture is a clean audit, so every rule below would pass vacuously against it. Each of these
// forges the exact shape the rule exists to refuse and asserts the refusal, so the rule is measured
// rather than assumed.

const withBranch = (audit, name, patch) => ({
  ...audit,
  branches: audit.branches.map((entry) => (entry.name === name ? { ...entry, ...patch } : entry))
});

test("a branch with an open PR that is nevertheless marked deletable is refused", () => {
  const audit = loadAudit();
  const active = audit.branches.find((entry) => entry.open_pr);
  const forged = withBranch(audit, active.name, { recommendation: "safe_to_delete_after_578" });
  assert.notDeepEqual(classificationFindings(forged), [], "an ACTIVE branch marked deletable passed the classification check");
  assert.deepEqual(deletionEligibility(forged).eligible, [], "an audit with a finding still produced deletion-eligible branches");
});

test("a branch classified UNIQUE_WORK is never deletion-eligible, however it is recommended", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, { classification: "UNIQUE_WORK" });
  assert.notDeepEqual(classificationFindings(forged), [], "UNIQUE_WORK with a deletion recommendation passed the classification check");
  assert.ok(!deletionEligibility(forged).eligible.some((entry) => entry.name === merged.name), "a UNIQUE_WORK branch was deletion-eligible");
});

test("a branch classified SUPERSEDED with nothing recorded that supersedes it is refused", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, { classification: "SUPERSEDED", superseding: null });
  assert.notDeepEqual(classificationFindings(forged), [], "SUPERSEDED with no superseding record passed the classification check");
});

test("a branch still carrying commits dev does not have is not deletion-eligible", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, { unique_commits_vs_dev: 1 });
  assert.ok(!deletionEligibility(forged).eligible.some((entry) => entry.name === merged.name), "a branch with a commit dev lacks was deletion-eligible");
});

test("a protected branch is not deletion-eligible", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, { branch_protected: true });
  assert.ok(!deletionEligibility(forged).eligible.some((entry) => entry.name === merged.name), "a protected branch was deletion-eligible");
});

test("an unestablished fact that blocks deletion cannot sit on a branch marked deletable", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, {
    unestablished: [{ fact: "whether a colleague is still working from this branch", bearing_on_deletion: "blocks_deletion" }]
  });
  assert.notDeepEqual(unestablishedFindings(forged), [], "a deletion-blocking unknown on a deletable branch passed the check");
  assert.deepEqual(deletionEligibility(forged).eligible, [], "an audit with a deletion-blocking unknown still produced eligible branches");
});

test("an unestablished fact dismissed as not bearing on deletion, with no argument, is refused", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, {
    unestablished: [{ fact: "what this branch was for", bearing_on_deletion: "none", why_it_does_not_bear: "" }]
  });
  assert.notDeepEqual(unestablishedFindings(forged), [], "an unargued dismissal passed the check");
});

// The dismissal argument here is deliberately substantial, so the only rule that can refuse this
// entry is the one that checks the bearing value itself. A short argument would be caught by the
// argument-length rule instead and this test would pass without measuring anything.
test("an unestablished fact whose bearing is neither none nor blocks_deletion is refused", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, {
    unestablished: [{ fact: "what this branch was for", bearing_on_deletion: "probably fine", why_it_does_not_bear: "nothing in the repository refers to this branch any more, so it looks abandoned" }]
  });
  assert.notDeepEqual(unestablishedFindings(forged), [], "an invented bearing value passed the check");
});

test("a branch on origin that the audit does not cover is refused, and a covered branch not on origin is too", () => {
  const audit = loadAudit();
  const uncovered = { ...audit, branches: audit.branches.slice(1) };
  assert.notDeepEqual(auditCoverageFindings(uncovered), [], "a branch on origin that nobody audited passed the coverage check");
  const phantom = { ...audit, branches: [...audit.branches, { ...audit.branches[0], name: "task/issue-000-not-on-origin" }] };
  assert.notDeepEqual(auditCoverageFindings(phantom), [], "an audited branch that is not on origin passed the coverage check");
});

// Findings do not stay local. An audit with a broken invariant anywhere is not a document to delete
// branches from, so one bad entry empties the whole eligible set rather than only itself.
test("a finding on one branch empties the deletion-eligible set entirely", () => {
  const audit = loadAudit();
  const active = audit.branches.find((entry) => entry.open_pr);
  const before = deletionEligibility(audit).eligible.map((entry) => entry.name);
  assert.ok(before.length > 0, "nothing was eligible to begin with, so this test would check nothing");
  const forged = withBranch(audit, active.name, { classification: "not-a-classification" });
  assert.deepEqual(deletionEligibility(forged).eligible, [], "a broken entry elsewhere left other branches eligible");
});

// The condition that has to hold independently of the classification: a branch someone has a PR
// open against is not deletable even when every containment fact says its content is elsewhere.
test("a branch recorded as MERGED while a PR is open on it is still not deletion-eligible", () => {
  const audit = loadAudit();
  const merged = audit.branches.find((entry) => entry.classification === "MERGED");
  const forged = withBranch(audit, merged.name, {
    open_pr: { number: 999, url: "https://example.invalid/999", state: "OPEN", base: "dev", head_sha: merged.head_sha, title: "a PR opened against a merged branch" }
  });
  const { eligible } = deletionEligibility(forged);
  assert.ok(!eligible.some((entry) => entry.name === merged.name), `${merged.name} was deletion-eligible while PR #999 was open on it`);
});
