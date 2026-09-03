import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DELETION_BLOCKED_BY, boundaryInvariantFindings, canonicalize, cleanupInvariantFindings, deletionAuthorizationFindings, deletionEligibility, deletionLogFindings, liveEligibility, loadCompletionSnapshot, prerequisiteFindings } from "../../scripts/branch-audit.mjs";
import { observationDigest } from "../../scripts/collect-branch-state.mjs";

// Phase B of #572 deletes refs. The issue names what must hold across that deletion -- main, dev,
// the release tags, branch protection, the rulesets, the open PR heads and the stable plugin/install
// source. The comparison is between two observations collected either side of the deletion, not
// against the Phase A snapshot: the repository goes on moving, and measuring Phase B against a
// Phase A baseline reports every legitimate advance of `dev` as damage. That is checked here in both
// directions -- an intervening advance must not fail, and a real change must.
//
// No deletion log is committed; it is the blocked phase's output. Every log below is constructed
// here, which is also the point: a stored artifact cannot authorize itself when there is none.

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

/** A well-formed observation, shaped as the collector emits one. */
const observation = (overrides = {}) => {
  const base = structuredClone(audit.live_observation);
  Object.assign(base, overrides);
  base.digest = observationDigest(base);
  return base;
};

const notYetLog = () => ({
  schema: "aos-branch-deletion-log.v1",
  status: "NOT_YET",
  blocked_by: [...DELETION_BLOCKED_BY],
  deleted: [],
  note: "Phase B is blocked on #578 and #588; nothing has been deleted, renamed or force-pushed."
});

const completedLog = (pre, post, overrides = {}) => ({
  ...notYetLog(),
  status: "COMPLETED",
  completed_at: "2026-09-10T00:00:30Z",
  deleted: deletionEligibility(audit).eligible.map((entry) => ({ name: entry.name, sha: entry.head_sha })),
  blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "closed" })),
  pre_observation: { digest: observationDigest(pre) },
  post_observation: { digest: observationDigest(post) },
  ...overrides
});

/** Pre/post pair for a deletion that removed exactly the eligible branches and nothing else. */
const boundaryPair = (postOverrides = {}) => {
  const pre = observation({ collected_at: "2026-09-10T00:00:00Z" });
  const deletedNames = new Set(deletionEligibility(audit).eligible.map((entry) => entry.name));
  const post = observation({
    collected_at: "2026-09-10T00:01:00Z",
    heads: pre.heads.filter((head) => !deletedNames.has(head.name)),
    rest_heads: pre.rest_heads.filter((head) => !deletedNames.has(head.name)),
    ...postOverrides
  });
  return { pre, post };
};

test("the audit records a historical baseline for every invariant family the issue names", () => {
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
  assert.ok(baseline.install_source.files.length >= 2, "the stable plugin/install source is not in the baseline");
  assert.equal(typeof baseline.install_source.package.name, "string", "the package identity is not in the baseline");
  assert.deepEqual(cleanupInvariantFindings(audit, notYetLog()), [], "the baseline disagrees with its own snapshot");
});

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

test("a baseline whose main SHA disagrees with the snapshot is refused", () => {
  const forged = { ...audit, invariant_baseline: { ...baseline, main_sha: "0".repeat(40) } };
  assert.notDeepEqual(cleanupInvariantFindings(forged, notYetLog()), [], "a baseline that disagrees with its own snapshot passed the check");
});

test("a baseline with no stable plugin/install source is refused", () => {
  const { install_source: _dropped, ...without } = baseline;
  assert.notDeepEqual(cleanupInvariantFindings({ ...audit, invariant_baseline: without }, notYetLog()), [], "a baseline with no install source passed the check");
});

// --- the deletion boundary ----------------------------------------------------------------------

test("a deletion that removed exactly the eligible branches and changed nothing else passes", () => {
  const { pre, post } = boundaryPair();
  assert.deepEqual(boundaryInvariantFindings(completedLog(pre, post), pre, post), [], "the deletion Phase B is supposed to be able to make was refused");
});

// The failure the previous version had: `dev` legitimately advancing between Phase A and Phase B
// made a no-damage deletion report "dev moved across the deletion". The baseline is history now.
test("the repository legitimately advancing since Phase A does not fail the boundary", () => {
  const advanced = { collected_at: "2026-09-10T00:00:00Z", heads: audit.live_observation.heads.map((head) => (head.name === "dev" ? { ...head, sha: "d".repeat(40) } : head)) };
  const pre = observation(advanced);
  const deletedNames = new Set(deletionEligibility(audit).eligible.map((entry) => entry.name));
  const post = observation({ ...advanced, collected_at: "2026-09-10T00:01:00Z", heads: pre.heads.filter((head) => !deletedNames.has(head.name)) });
  assert.notEqual(pre.heads.find((h) => h.name === "dev").sha, baseline.dev_sha, "the counterexample did not actually advance dev past the baseline");
  assert.deepEqual(boundaryInvariantFindings(completedLog(pre, post), pre, post), [], "a deletion after a normal dev advance was reported as damage");
});

test("dev or main moving across the deletion itself is refused", () => {
  for (const ref of ["main", "dev"]) {
    const { pre, post } = boundaryPair();
    post.heads = post.heads.map((head) => (head.name === ref ? { ...head, sha: "e".repeat(40) } : head));
    const findings = boundaryInvariantFindings(completedLog(pre, post), pre, post);
    assert.ok(findings.some((f) => f.startsWith(`${ref} moved across the deletion`)), `${ref} moving across the deletion passed: ${findings.join(" | ")}`);
  }
});

test("branch protection changed across the deletion is refused, in any field the API returns", () => {
  for (const [field, value] of [
    ["allow_deletions", { enabled: true }],
    ["required_linear_history", { enabled: true }],
    ["required_conversation_resolution", { enabled: false }],
    ["required_status_checks", { strict: true, contexts: ["something-new"] }]
  ]) {
    const { pre, post } = boundaryPair();
    post.protection = { ...post.protection, main: { ...post.protection.main, [field]: value } };
    const findings = boundaryInvariantFindings(completedLog(pre, post), pre, post);
    assert.ok(findings.some((f) => f.includes("main protection changed")), `changing main's ${field} across the deletion passed the check`);
  }
});

test("a ruleset replaced by a different one of the same count is refused", () => {
  const { pre, post } = boundaryPair();
  pre.rulesets = [{ id: 1, name: "protect-main", enforcement: "active" }];
  post.rulesets = [{ id: 2, name: "allow-everything", enforcement: "disabled" }];
  assert.equal(pre.rulesets.length, post.rulesets.length, "the counterexample did not keep the count equal");
  const findings = boundaryInvariantFindings(completedLog(pre, post), pre, post);
  assert.ok(findings.some((f) => f.includes("ruleset configuration changed")), `a same-count ruleset replacement passed: ${findings.join(" | ")}`);
});

test("the stable plugin/install source or the repository settings changing across the deletion is refused", () => {
  const { pre, post } = boundaryPair();
  post.install_source = { ...post.install_source, files: post.install_source.files.map((f, i) => (i === 0 ? { ...f, digest: `sha256:${"0".repeat(64)}` } : f)) };
  assert.ok(boundaryInvariantFindings(completedLog(pre, post), pre, post).some((f) => f.includes("install source changed")), "a changed install source passed");
  const two = boundaryPair();
  two.post.settings = { ...two.post.settings, delete_branch_on_merge: false };
  assert.ok(boundaryInvariantFindings(completedLog(two.pre, two.post), two.pre, two.post).some((f) => f.includes("settings changed")), "a changed repository setting passed");
});

test("an open PR head that is gone or moved across the deletion is refused", () => {
  const gone = boundaryPair();
  gone.post.open_prs = gone.post.open_prs.slice(1);
  assert.ok(boundaryInvariantFindings(completedLog(gone.pre, gone.post), gone.pre, gone.post).some((f) => f.includes("is gone after the deletion")), "an open PR disappearing passed");
  const moved = boundaryPair();
  moved.post.open_prs = moved.post.open_prs.map((pr, i) => (i === 0 ? { ...pr, head_sha: "0".repeat(40) } : pr));
  assert.ok(boundaryInvariantFindings(completedLog(moved.pre, moved.post), moved.pre, moved.post).some((f) => f.includes("moved across the deletion")), "an open PR head moving passed");
});

test("a tag replaced, moved, dropped or invented across the deletion is refused", () => {
  const annotated = baseline.tags.find((tag) => tag.ref_sha !== tag.commit_sha);
  const replaced = boundaryPair();
  replaced.post.tags = replaced.post.tags.map((tag) => (tag.name === annotated.name ? { ...tag, ref_sha: "0".repeat(40) } : tag));
  assert.ok(boundaryInvariantFindings(completedLog(replaced.pre, replaced.post), replaced.pre, replaced.post).some((f) => f.includes("was replaced")), "a tag re-pointed at a different tag object over the same commit passed");
  for (const [name, mutate] of [
    ["moved", (o) => { o.post.tags = o.post.tags.map((t, i) => (i === 0 ? { ...t, commit_sha: "0".repeat(40) } : t)); }],
    ["dropped", (o) => { o.post.tags = o.post.tags.slice(1); }],
    ["invented", (o) => { o.post.tags = [...o.post.tags, { name: "v9.9.9", ref_sha: "0".repeat(40), commit_sha: "0".repeat(40) }]; }]
  ]) {
    const pair = boundaryPair();
    mutate(pair);
    assert.notDeepEqual(boundaryInvariantFindings(completedLog(pair.pre, pair.post), pair.pre, pair.post), [], `a ${name} tag passed the check`);
  }
});

// The deletion did what it said and only what it said, in both directions.
test("a ref that vanished but was not claimed, or was claimed but did not vanish, is refused", () => {
  const extra = boundaryPair();
  // Derived, not named. This filtered a hardcoded branch until that branch merged and its head was
  // auto-deleted, at which point the filter removed nothing, the "vanished unclaimed" ref never
  // vanished, and the counterfactual asserted the refusal of a thing it had not built. The victim is
  // any surviving head the log does not claim, and the assertion below that one exists is what stops
  // this from going quiet the next time the repository moves.
  const unclaimed = extra.post.heads.find((head) => !completedLog(extra.pre, extra.post).deleted.some((one) => one.name === head.name));
  assert.ok(unclaimed, "no surviving head is unclaimed by the log, so this counterfactual has nothing to remove");
  extra.post.heads = extra.post.heads.filter((head) => head.name !== unclaimed.name);
  assert.ok(boundaryInvariantFindings(completedLog(extra.pre, extra.post), extra.pre, extra.post).some((f) => f.includes("but the log does not say it was deleted")), "a ref that vanished unclaimed passed");

  const pre = observation({ collected_at: "2026-09-10T00:00:00Z" });
  const post = observation({ collected_at: "2026-09-10T00:01:00Z" });
  assert.ok(boundaryInvariantFindings(completedLog(pre, post), pre, post).some((f) => f.includes("is still on the repository afterwards")), "a claimed deletion that did not happen passed");
});

test("a boundary with only one observation is refused", () => {
  const { pre, post } = boundaryPair();
  assert.notDeepEqual(boundaryInvariantFindings(completedLog(pre, post), pre, null), [], "a boundary with no post-deletion observation passed");
  assert.notDeepEqual(boundaryInvariantFindings(completedLog(pre, post), null, post), [], "a boundary with no pre-deletion observation passed");
});

// --- the deletion log ---------------------------------------------------------------------------

test("the deletion log is NOT_YET, records that it is blocked on both issues, and lists no deletion", () => {
  const log = notYetLog();
  assert.deepEqual(deletionLogFindings(log), [], "a well-formed NOT_YET log was refused");
  assert.deepEqual([...log.blocked_by].sort((a, b) => a - b), [578, 588]);
  assert.notDeepEqual(deletionLogFindings({ ...log, pre_observation: { digest: "x" } }), [], "a NOT_YET log citing boundary observations passed");
});

test("Phase A does not ship the deletion log, and the audit records the contract instead", () => {
  assert.equal(audit.phase_b_contract.deletion_log_status, "NOT_YET");
  assert.match(audit.phase_b_contract.prerequisite_authority, /github-state\.json/u);
});

test("a completed deletion log filled in as the contract prescribes passes", () => {
  const { pre, post } = boundaryPair();
  const log = completedLog(pre, post);
  assert.ok(log.deleted.length > 0, "nothing was eligible, so this test would check nothing");
  assert.deepEqual(deletionLogFindings(log, { completion: clearedCompletion(), pre, post }), [], "a correctly completed log was refused");
});

test("a completed deletion log that deleted nothing because nothing was eligible is accepted", () => {
  const { pre, post } = boundaryPair();
  const log = completedLog(pre, post, { deleted: [], no_op_reason: "the fresh audit found no eligible stale ref: both candidates had already been removed by delete_branch_on_merge" });
  assert.deepEqual(deletionLogFindings(log, { completion: clearedCompletion(), pre, post }), [], "an honest no-op completion was refused");
});

test("a completed deletion log that deleted nothing and does not say why is refused", () => {
  const { pre, post } = boundaryPair();
  assert.notDeepEqual(deletionLogFindings(completedLog(pre, post, { deleted: [] }), { completion: clearedCompletion(), pre, post }), [], "an unexplained empty completion passed");
  assert.notDeepEqual(deletionLogFindings(completedLog(pre, post, { deleted: [], no_op_reason: "none" }), { completion: clearedCompletion(), pre, post }), [], "an empty completion with a token reason passed");
});

test("a COMPLETED deletion log that cites no boundary observation digests is refused", () => {
  const { pre, post } = boundaryPair();
  for (const field of ["pre_observation", "post_observation"]) {
    const findings = deletionLogFindings(completedLog(pre, post, { [field]: undefined }), { completion: clearedCompletion(), pre, post });
    assert.ok(findings.some((f) => f.includes(field.replace("_", "-"))), `a COMPLETED log with no ${field} digest passed: ${findings.join(" | ")}`);
  }
  assert.notDeepEqual(deletionLogFindings(completedLog(pre, post, { completed_at: "whenever" }), { completion: clearedCompletion(), pre, post }), [], "a COMPLETED log with a malformed instant passed");
});

test("a NOT_YET deletion log that nevertheless lists a deleted branch is refused", () => {
  assert.notDeepEqual(deletionLogFindings({ ...notYetLog(), deleted: [{ name: "tmp/read-claude-artifact", sha: "2d6392f578dd2667d5f1f6ba5073a2c4311430eb" }] }), [], "a NOT_YET log that claims a deletion passed");
});

test("a deletion log that drops one of the blocking issues is refused while NOT_YET", () => {
  assert.notDeepEqual(deletionLogFindings({ ...notYetLog(), blocked_by: [578] }), [], "a NOT_YET log that forgot #588 passed");
});

test("a COMPLETED deletion log cannot clear its own prerequisites: the canonical snapshot decides", () => {
  const { pre, post } = boundaryPair();
  const open = completion.issues.filter((issue) => DELETION_BLOCKED_BY.includes(issue.number) && issue.state !== "closed");
  assert.ok(open.length > 0, "no blocker is open in the canonical snapshot, so this test would check nothing");
  const findings = deletionLogFindings(completedLog(pre, post), { completion, pre, post });
  for (const issue of open) {
    assert.ok(findings.some((f) => f.includes(`#${issue.number}`) && f.includes("still blocked")), `the refusal does not name #${issue.number}: ${findings.join(" | ")}`);
  }
  const insistent = completedLog(pre, post, { blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "closed", evidence: "this definitely cleared, trust me" })) });
  assert.notDeepEqual(deletionLogFindings(insistent, { completion, pre, post }), [], "a log asserting its own clearance passed");
});

test("a COMPLETED deletion log with no canonical snapshot to check against is refused", () => {
  const { pre, post } = boundaryPair();
  assert.ok(deletionLogFindings(completedLog(pre, post), { completion: null, pre, post }).some((f) => f.includes("no canonical issue-state snapshot")), "a completed log with no authority passed");
});

test("a blocker closed without close evidence does not clear it", () => {
  const { pre, post } = boundaryPair();
  const half = { ...completion, issues: completion.issues.map((issue) => (DELETION_BLOCKED_BY.includes(issue.number) ? { ...issue, state: "closed", close_evidence: null } : issue)) };
  assert.ok(deletionLogFindings(completedLog(pre, post), { completion: half }).some((f) => f.includes("no close evidence")), "a blocker closed with no evidence cleared");
});

test("a deletion log whose account of a blocker disagrees with the canonical snapshot is refused", () => {
  const { pre, post } = boundaryPair();
  const log = completedLog(pre, post, { blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "open" })) });
  assert.notDeepEqual(deletionLogFindings(log, { completion: clearedCompletion(), pre, post }), [], "a log disagreeing with the canonical snapshot passed");
});

// --- the record is bound to the evidence it cites -------------------------------------------------
//
// A `sha256:` followed by 64 hex characters is a well-formed citation of nothing. The bindings that
// make a citation evidence -- recomputing each observation's digest, and the 900-second window that
// makes "immediately beforehand" a condition -- lived only in `deletionAuthorizationFindings`, which
// no contract, document or verifier list named. Every check below therefore ran, and none of them
// had been handed the thing it was supposed to compare against.

/** The exact composition `audit.phase_b_contract.verifiers` and the document's steps 1-7 name. */
const contractNamedComposition = ({ audit: subject, log, pre, post, completion: snapshot }) => [
  ...prerequisiteFindings(snapshot),
  ...liveEligibility(subject, pre).findings,
  ...boundaryInvariantFindings(log, pre, post),
  ...deletionLogFindings(log, { completion: snapshot, pre, post })
];

test("the composition the Phase B contract names refuses a record citing evidence it was never checked against", () => {
  const { pre, post } = boundaryPair();
  const forged = completedLog(pre, post, {
    // Well-formed and matching nothing, stamped forty days after the observation the record calls
    // the one collected immediately beforehand.
    completed_at: "2026-10-20T00:00:00Z",
    pre_observation: { digest: `sha256:${"a".repeat(64)}` },
    post_observation: { digest: `sha256:${"b".repeat(64)}` }
  });
  const findings = contractNamedComposition({ audit, log: forged, pre, post, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("does not cite the digest of the pre-deletion observation")), `the documented path accepted a fabricated pre-observation digest: ${findings.join(" | ")}`);
  assert.ok(findings.some((f) => f.includes("does not cite the digest of the post-deletion observation")), `the documented path accepted a fabricated post-observation digest: ${findings.join(" | ")}`);
  assert.ok(findings.some((f) => f.includes("this gate allows")), `the freshness window was never applied on the documented path: ${findings.join(" | ")}`);
  // And the gate the contract now names refuses it too, so the two paths do not diverge again.
  assert.notDeepEqual(deletionAuthorizationFindings({ audit, log: forged, pre, post, completion: clearedCompletion() }), [], "the composed gate accepted the forged record");
});

test("the composition the Phase B contract names accepts the record Phase B is supposed to be able to write", () => {
  const { pre, post } = boundaryPair();
  const log = completedLog(pre, post);
  assert.ok(log.deleted.length > 0, "nothing was eligible, so this test would check nothing");
  const findings = contractNamedComposition({ audit, log, pre, post, completion: clearedCompletion() });
  // liveEligibility is measured against the committed observation, which is a snapshot of a moving
  // repository, so it is allowed to disagree about heads that appeared since. What may not happen is
  // the binding refusing an honest record.
  const bindings = findings.filter((f) => f.includes("observation") && (f.includes("cite the digest") || f.includes("this gate allows") || f.includes("no pre-deletion observation") || f.includes("no post-deletion observation")));
  assert.deepEqual(bindings, [], `an honest completed record was refused by the evidence binding: ${bindings.join(" | ")}`);
});

test("a deletion log citing a well-formed digest of no observation is refused by the function the contract names", () => {
  const { pre, post } = boundaryPair();
  for (const field of ["pre_observation", "post_observation"]) {
    const log = completedLog(pre, post, { [field]: { digest: `sha256:${"9".repeat(64)}` } });
    const findings = deletionLogFindings(log, { completion: clearedCompletion(), pre, post });
    assert.ok(findings.some((f) => f.includes(`does not cite the digest of the ${field.replace("_observation", "")}-deletion observation`)), `a log citing a wrong ${field} digest passed: ${findings.join(" | ")}`);
  }
});

test("a deletion log checked without the observations it cites reports that rather than passing", () => {
  const { pre, post } = boundaryPair();
  const log = completedLog(pre, post);
  for (const [supplied, missing] of [[{ post }, "pre-deletion"], [{ pre }, "post-deletion"]]) {
    const findings = deletionLogFindings(log, { completion: clearedCompletion(), ...supplied });
    assert.ok(findings.some((f) => f.includes(`no ${missing} observation was supplied`)), `a record whose ${missing} evidence was never supplied passed: ${findings.join(" | ")}`);
  }
});

test("an observation stale past the window, or from the wrong side of the deletion, is refused by the function the contract names", () => {
  const { pre, post } = boundaryPair();
  const log = completedLog(pre, post);
  const stale = observation({ collected_at: "2026-09-09T00:00:00Z" });
  const staleLog = completedLog(stale, post);
  assert.ok(deletionLogFindings(staleLog, { completion: clearedCompletion(), pre: stale, post }).some((f) => f.includes("this gate allows")), "a day-old pre-observation passed the log check");
  const early = observation({ collected_at: "2026-09-10T00:00:10Z", heads: post.heads, rest_heads: post.rest_heads });
  const earlyLog = completedLog(pre, early);
  assert.ok(deletionLogFindings(earlyLog, { completion: clearedCompletion(), pre, post: early }).some((f) => f.includes("collected before the deletion")), "a post-observation from before the deletion passed the log check");
  assert.deepEqual(deletionLogFindings(log, { completion: clearedCompletion(), pre, post }), [], "the honest pair was refused");
});

test("canonicalization compares content rather than key order or cardinality", () => {
  assert.equal(canonicalize({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalize({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.notEqual(canonicalize({ a: 1 }), canonicalize({ a: 2 }));
  assert.notEqual(canonicalize([{ id: 1 }]), canonicalize([{ id: 2 }]));
});

// Absent on both sides digests the same as equal on both sides, so a pair that never recorded
// protection at all would report it unchanged.
test("protection absent from both boundary observations is not protection unchanged", () => {
  const { pre, post } = boundaryPair();
  delete pre.protection;
  delete post.protection;
  const findings = boundaryInvariantFindings(completedLog(pre, post), pre, post);
  assert.ok(findings.some((f) => f.includes("not recorded on both sides")), `two observations with no protection reported it unchanged: ${findings.join(" | ")}`);
});

test("a family absent from both boundary observations is not that family unchanged", () => {
  for (const family of ["rulesets", "install_source", "settings"]) {
    const { pre, post } = boundaryPair();
    delete pre[family];
    delete post[family];
    const findings = boundaryInvariantFindings(completedLog(pre, post), pre, post);
    assert.ok(findings.some((f) => f.includes("not recorded on both sides")), `two observations with no ${family} reported it unchanged: ${findings.join(" | ")}`);
  }
});
