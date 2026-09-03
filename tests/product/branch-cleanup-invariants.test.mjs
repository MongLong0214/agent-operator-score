import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DELETION_BLOCKED_BY, canonicalize, cleanupInvariantFindings, deletionEligibility, deletionLogFindings, loadCompletionSnapshot } from "../../scripts/branch-audit.mjs";

// Phase B of #572 deletes refs. The issue names what must hold across that deletion -- main, dev,
// the release tags, branch protection, the rulesets, the open PR heads and the stable plugin/install
// source -- and the only way to check any of it afterwards is to have written down what it was
// before. This file checks the baseline now, and checks that a well-formed COMPLETED log can pass,
// because a verifier Phase B cannot satisfy is a verifier Phase B deletes.
//
// The deletion log itself is not committed: it is the blocked phase's output. Every log below is
// constructed here, which is also the point -- a stored artifact that authorizes itself is the
// failure this gate exists to prevent, and there is no stored artifact to do it.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audit = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "audit.json"), "utf8"));
const baseline = audit.invariant_baseline;
const completion = loadCompletionSnapshot();

const notYetLog = () => ({
  schema: "aos-branch-deletion-log.v1",
  status: "NOT_YET",
  blocked_by: [...DELETION_BLOCKED_BY],
  deleted: [],
  post_delete_state: null,
  note: "Phase B is blocked on #578 and #588; nothing has been deleted, renamed or force-pushed."
});

/** A canonical snapshot in which both blockers have genuinely cleared. */
const clearedCompletion = () => ({
  ...completion,
  issues: completion.issues.map((issue) =>
    DELETION_BLOCKED_BY.includes(issue.number)
      ? { ...issue, state: "closed", close_evidence: { audit_report_digest: "sha256:" + "a".repeat(64) } }
      : issue
  )
});

/** The log Phase B is supposed to be able to write: everything deleted was eligible, nothing moved. */
const completedLog = (overrides = {}, stateOverrides = {}) => ({
  ...notYetLog(),
  status: "COMPLETED",
  completed_at: "2026-09-10T00:00:00Z",
  deleted: deletionEligibility(audit).eligible.map((entry) => ({ name: entry.name, sha: entry.head_sha })),
  blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "closed" })),
  live_observation: { digest: "sha256:" + "b".repeat(64) },
  post_delete_state: {
    main_sha: baseline.main_sha,
    dev_sha: baseline.dev_sha,
    tags: baseline.tags,
    protection: baseline.protection,
    rulesets: baseline.rulesets,
    install_source: baseline.install_source,
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
    assert.match(tag.ref_sha, /^[0-9a-f]{40}$/u, `tag ${tag.name}: no ref object id`);
    assert.match(tag.commit_sha, /^[0-9a-f]{40}$/u, `tag ${tag.name}: no commit id`);
  }
  for (const ref of ["main", "dev"]) {
    assert.equal(baseline.protection[ref].allow_deletions.enabled, false, `${ref} is recorded as deletable`);
    assert.equal(baseline.protection[ref].allow_force_pushes.enabled, false, `${ref} is recorded as force-pushable`);
  }
  assert.ok(Array.isArray(baseline.rulesets), "no baseline ruleset list");
  assert.ok(Array.isArray(baseline.open_pr_heads) && baseline.open_pr_heads.length > 0, "no baseline list of open PR heads");
  for (const entry of baseline.open_pr_heads) assert.match(entry.sha, /^[0-9a-f]{40}$/u, `PR #${entry.pr}: no head SHA to compare after the deletion`);
  assert.ok(baseline.install_source.files.length >= 2, "the stable plugin/install source is not in the baseline");
  for (const file of baseline.install_source.files) assert.match(file.digest, /^sha256:[0-9a-f]{64}$/u, `${file.path}: no digest`);
  assert.equal(typeof baseline.install_source.package.name, "string", "the package identity is not in the baseline");
});

// The protection object GitHub returns has a dozen fields. A three-boolean projection cannot report
// that a fourth changed, so the whole object is stored and compared.
test("the baseline stores the whole protection object, not a three-boolean projection", () => {
  for (const ref of ["main", "dev"]) {
    const keys = Object.keys(baseline.protection[ref]);
    assert.ok(keys.length >= 8, `${ref}: only ${keys.length} protection fields stored`);
    for (const key of ["required_status_checks", "required_pull_request_reviews", "required_linear_history", "required_conversation_resolution", "lock_branch", "block_creations"]) {
      assert.ok(keys.includes(key), `${ref}: protection baseline omits ${key}`);
    }
  }
});

test("the baseline records both halves of each tag's identity, not only the commit it peels to", () => {
  assert.ok(baseline.tags.some((tag) => tag.ref_sha !== tag.commit_sha), "no annotated tag in the baseline, so this distinction would go unexercised");
});

test("the baseline main and dev SHAs are the ones in the ls-remote snapshot", () => {
  assert.deepEqual(cleanupInvariantFindings(audit, notYetLog()), [], "the baseline disagrees with its own snapshot");
});

test("a baseline whose main SHA disagrees with the snapshot is refused", () => {
  const forged = { ...audit, invariant_baseline: { ...baseline, main_sha: "0".repeat(40) } };
  assert.notDeepEqual(cleanupInvariantFindings(forged, notYetLog()), [], "a baseline that disagrees with its own snapshot passed the check");
});

test("a baseline with no stable plugin/install source is refused", () => {
  const { install_source: _dropped, ...without } = baseline;
  assert.notDeepEqual(cleanupInvariantFindings({ ...audit, invariant_baseline: without }, notYetLog()), [], "a baseline with no install source passed the check");
});

test("the deletion log is NOT_YET, records that it is blocked on both issues, and lists no deletion", () => {
  const log = notYetLog();
  assert.deepEqual(deletionLogFindings(log), [], "a well-formed NOT_YET log was refused");
  assert.deepEqual(log.deleted, []);
  assert.deepEqual([...log.blocked_by].sort((a, b) => a - b), [578, 588]);
});

test("Phase A does not ship the deletion log, and the audit records the contract instead", () => {
  assert.equal(audit.phase_b_contract.deletion_log_status, "NOT_YET");
  assert.match(audit.phase_b_contract.prerequisite_authority, /github-state\.json/u);
});

// A verifier Phase B cannot satisfy is a verifier Phase B deletes. This is the positive case.
test("a completed deletion log filled in as the contract prescribes passes both checks", () => {
  const log = completedLog();
  assert.ok(log.deleted.length > 0, "nothing was eligible, so this test would check nothing");
  assert.deepEqual(deletionLogFindings(log, { completion: clearedCompletion() }), [], "a correctly completed log was refused");
  assert.deepEqual(cleanupInvariantFindings(audit, log), [], "a deletion that moved nothing reported invariant findings");
});

// Auto-delete is on in this repository, so a fresh audit finding nothing eligible is ordinary.
// Requiring at least one deletion would make an honest no-op impossible to record.
test("a completed deletion log that deleted nothing because nothing was eligible is accepted", () => {
  const log = completedLog({ deleted: [], no_op_reason: "the fresh audit found no eligible stale ref: both candidates had already been removed by delete_branch_on_merge" });
  assert.deepEqual(deletionLogFindings(log, { completion: clearedCompletion() }), [], "an honest no-op completion was refused");
});

test("a completed deletion log that deleted nothing and does not say why is refused", () => {
  assert.notDeepEqual(deletionLogFindings(completedLog({ deleted: [] }), { completion: clearedCompletion() }), [], "an unexplained empty completion passed the check");
  assert.notDeepEqual(deletionLogFindings(completedLog({ deleted: [], no_op_reason: "none" }), { completion: clearedCompletion() }), [], "an empty completion with a token reason passed the check");
});

test("a COMPLETED deletion log with no post-delete state read back is refused", () => {
  assert.notDeepEqual(deletionLogFindings(completedLog({ post_delete_state: null }), { completion: clearedCompletion() }), [], "a COMPLETED log with no post-delete state passed the check");
});

test("a NOT_YET deletion log that nevertheless lists a deleted branch is refused", () => {
  assert.notDeepEqual(deletionLogFindings({ ...notYetLog(), deleted: [{ name: "tmp/read-claude-artifact", sha: "2d6392f578dd2667d5f1f6ba5073a2c4311430eb" }] }), [], "a NOT_YET log that claims a deletion passed the check");
});

test("a deletion log that drops one of the blocking issues is refused while NOT_YET", () => {
  assert.notDeepEqual(deletionLogFindings({ ...notYetLog(), blocked_by: [578] }), [], "a NOT_YET log that forgot #588 passed the check");
});

// The prerequisite is not the log's to clear. Free text saying #578 passed used to be accepted,
// which made "only after #578" a sentence rather than a condition.
test("a COMPLETED deletion log cannot clear its own prerequisites: the canonical snapshot decides", () => {
  const log = completedLog();
  // The real snapshot has both issues open.
  const open = completion.issues.filter((issue) => DELETION_BLOCKED_BY.includes(issue.number) && issue.state !== "closed");
  assert.ok(open.length > 0, "no blocker is open in the canonical snapshot, so this test would check nothing");
  const findings = deletionLogFindings(log, { completion });
  assert.notDeepEqual(findings, [], "a completed log passed while a blocker is still open in the canonical snapshot");
  for (const issue of open) {
    assert.ok(findings.some((f) => f.includes(`#${issue.number}`) && f.includes("still blocked")), `the refusal does not name #${issue.number} as still blocking: ${findings.join(" | ")}`);
  }

  // No amount of text inside the log changes that.
  const insistent = completedLog({ blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "closed", evidence: "this definitely cleared, trust me" })) });
  assert.notDeepEqual(deletionLogFindings(insistent, { completion }), [], "a log asserting its own clearance passed the check");
});

test("a COMPLETED deletion log with no canonical snapshot to check against is refused", () => {
  const findings = deletionLogFindings(completedLog(), { completion: null });
  assert.ok(findings.some((f) => f.includes("no canonical issue-state snapshot")), `a completed log with no authority to check against passed: ${findings.join(" | ")}`);
});

test("a blocker closed without close evidence does not clear it", () => {
  const half = { ...completion, issues: completion.issues.map((issue) => (DELETION_BLOCKED_BY.includes(issue.number) ? { ...issue, state: "closed", close_evidence: null } : issue)) };
  const findings = deletionLogFindings(completedLog(), { completion: half });
  assert.ok(findings.some((f) => f.includes("no close evidence")), `a blocker closed with no evidence cleared: ${findings.join(" | ")}`);
});

test("a deletion log whose account of a blocker disagrees with the canonical snapshot is refused", () => {
  const log = completedLog({ blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "open" })) });
  assert.notDeepEqual(deletionLogFindings(log, { completion: clearedCompletion() }), [], "a log disagreeing with the canonical snapshot passed the check");
});

test("branch protection changed across the deletion is refused, in any field the API returns", () => {
  for (const [field, value] of [
    ["allow_deletions", { enabled: true }],
    ["required_linear_history", { enabled: true }],
    ["required_conversation_resolution", { enabled: false }],
    ["required_status_checks", { strict: true, contexts: ["something-new"] }]
  ]) {
    const forged = completedLog({}, { protection: { ...baseline.protection, main: { ...baseline.protection.main, [field]: value } } });
    const findings = cleanupInvariantFindings(audit, forged);
    assert.ok(findings.some((f) => f.includes("main protection changed")), `changing main's ${field} across the deletion passed the check`);
  }
});

test("a ruleset replaced by a different one of the same count is refused", () => {
  const before = { ...audit, invariant_baseline: { ...baseline, rulesets: [{ id: 1, name: "protect-main", enforcement: "active" }] } };
  const same = completedLog({}, { rulesets: [{ id: 2, name: "allow-everything", enforcement: "disabled" }] });
  const findings = cleanupInvariantFindings(before, same);
  assert.ok(findings.some((f) => f.includes("ruleset configuration changed")), `a same-count ruleset replacement passed the check: ${findings.join(" | ")}`);
  assert.equal(before.invariant_baseline.rulesets.length, same.post_delete_state.rulesets.length, "the counterexample did not actually keep the count equal");
});

test("the stable plugin/install source changed across the deletion is refused", () => {
  const forged = completedLog({}, { install_source: { ...baseline.install_source, files: baseline.install_source.files.map((f, i) => (i === 0 ? { ...f, digest: "sha256:" + "0".repeat(64) } : f)) } });
  assert.ok(cleanupInvariantFindings(audit, forged).some((f) => f.includes("install source changed")), "a changed install source passed the check");
  const dropped = completedLog({}, { install_source: undefined });
  assert.notDeepEqual(cleanupInvariantFindings(audit, dropped), [], "a post-delete state with no install source passed the check");
});

test("a post-delete state that simply omits protection, rulesets or the open PR heads is refused", () => {
  for (const field of ["protection", "rulesets", "open_pr_heads"]) {
    assert.notDeepEqual(cleanupInvariantFindings(audit, completedLog({}, { [field]: undefined })), [], `a post-delete state with no ${field} passed the check`);
  }
});

test("an open PR head that is gone or moved across the deletion is refused", () => {
  assert.notDeepEqual(cleanupInvariantFindings(audit, completedLog({}, { open_pr_heads: baseline.open_pr_heads.slice(1) })), [], "an open PR head disappearing passed the check");
  const moved = completedLog({}, { open_pr_heads: baseline.open_pr_heads.map((e, i) => (i === 0 ? { ...e, sha: "0".repeat(40) } : e)) });
  assert.notDeepEqual(cleanupInvariantFindings(audit, moved), [], "an open PR head moving passed the check");
});

test("a tag replaced by another tag object over the same commit is refused", () => {
  const annotated = baseline.tags.find((tag) => tag.ref_sha !== tag.commit_sha);
  const forged = completedLog({}, { tags: baseline.tags.map((tag) => (tag.name === annotated.name ? { ...tag, ref_sha: "0".repeat(40) } : tag)) });
  const findings = cleanupInvariantFindings(audit, forged);
  assert.ok(findings.some((f) => f.includes("was replaced")), `a tag re-pointed at a different tag object over the same commit passed: ${findings.join(" | ")}`);
});

test("a tag whose commit moved, or which disappeared or appeared, across the deletion is refused", () => {
  assert.notDeepEqual(cleanupInvariantFindings(audit, completedLog({}, { tags: baseline.tags.map((t, i) => (i === 0 ? { ...t, commit_sha: "0".repeat(40) } : t)) })), [], "a moved tag passed the check");
  assert.notDeepEqual(cleanupInvariantFindings(audit, completedLog({}, { tags: baseline.tags.slice(1) })), [], "a deleted tag passed the check");
  assert.notDeepEqual(cleanupInvariantFindings(audit, completedLog({}, { tags: [...baseline.tags, { name: "v9.9.9", ref_sha: "0".repeat(40), commit_sha: "0".repeat(40) }] })), [], "an invented tag passed the check");
});

// Content, not key order: two objects that differ only in how they were assembled are the same
// configuration, and two that differ in a value are not.
test("canonicalization compares content rather than key order or cardinality", () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalize({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 2 }));
  assert.notEqual(canonicalize([{ id: 1 }]), canonicalize([{ id: 2 }]));
});
