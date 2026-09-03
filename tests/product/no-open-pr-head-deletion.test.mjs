import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DELETION_BLOCKED_BY, deletionAuthorizationFindings, deletionEligibility, loadCompletionSnapshot, makeDeletionRunner, openPrHeadDeletionFindings, runDeletion } from "../../scripts/branch-audit.mjs";
import { observationDigest } from "../../scripts/collect-branch-state.mjs";

// The prohibition in #572 that cannot be walked back: deleting the head branch of an open pull
// request destroys its diff. It has to hold in three directions -- an open PR head may never be
// eligible in the audit, the deletion record may never name one, and neither may a pull request
// opened *after* the audit was written. Only the third can be checked against something other than
// the author's own record, which is why the gate collects its own observation rather than taking one.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audit = JSON.parse(readFileSync(join(root, "fixtures", "stale-branches", "audit.json"), "utf8"));
const completion = loadCompletionSnapshot();

const clearedCompletion = () => ({
  ...completion,
  issues: completion.issues.map((issue) =>
    DELETION_BLOCKED_BY.includes(issue.number)
      ? { ...issue, state: "closed", close_evidence: { audit_report_digest: `sha256:${"a".repeat(64)}` } }
      : issue
  )
});

const observation = (overrides = {}) => {
  const base = structuredClone(audit.live_observation);
  Object.assign(base, overrides);
  base.digest = observationDigest(base);
  return base;
};

const deletedNames = () => new Set(deletionEligibility(audit).eligible.map((entry) => entry.name));

const boundaryPair = () => {
  const pre = observation({ collected_at: "2026-09-10T00:00:00Z" });
  const gone = deletedNames();
  const post = observation({
    collected_at: "2026-09-10T00:01:00Z",
    heads: pre.heads.filter((head) => !gone.has(head.name)),
    rest_heads: pre.rest_heads.filter((head) => !gone.has(head.name))
  });
  return { pre, post };
};

/**
 * The same pair, stamped around the real clock. The runner takes `completed_at` from the wall clock
 * between its two collections, so a pair fixed at some other date fails the freshness window for a
 * reason that has nothing to do with what is being tested.
 */
const iso = (offsetSeconds) => new Date(Date.now() + offsetSeconds * 1000).toISOString().replace(/\.\d{3}Z$/u, "Z");
const livePair = () => {
  const pre = observation({ collected_at: iso(-5) });
  const gone = deletedNames();
  const post = observation({
    collected_at: iso(5),
    heads: pre.heads.filter((head) => !gone.has(head.name)),
    rest_heads: pre.rest_heads.filter((head) => !gone.has(head.name))
  });
  return { pre, post };
};

const completedLog = (pre, post, overrides = {}) => ({
  schema: "aos-branch-deletion-log.v1",
  status: "COMPLETED",
  completed_at: "2026-09-10T00:00:30Z",
  blocked_by: [...DELETION_BLOCKED_BY],
  blockers_cleared: DELETION_BLOCKED_BY.map((issue) => ({ issue, canonical_state: "closed" })),
  deleted: deletionEligibility(audit).eligible.map((entry) => ({ name: entry.name, sha: entry.head_sha })),
  pre_observation: { digest: observationDigest(pre) },
  post_observation: { digest: observationDigest(post) },
  note: "Phase B.",
  ...overrides
});

const authorize = ({ pre, post, log, completion: snapshot } = {}) => {
  const pair = pre && post ? { pre, post } : boundaryPair();
  const usePre = pre ?? pair.pre;
  const usePost = post === null ? null : post ?? pair.post;
  return deletionAuthorizationFindings({
    audit,
    log: log ?? completedLog(usePre, usePost ?? pair.post),
    pre: usePre,
    post: usePost,
    completion: snapshot ?? clearedCompletion()
  });
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
  assert.notDeepEqual(openPrHeadDeletionFindings(audit, { deleted: [{ name: "task/issue-999-never-audited", sha: "0".repeat(40) }] }), [], "a deletion of a branch this audit never covered passed");
});

test("a deletion log entry for a branch the audit records as an open PR head is refused", () => {
  const active = audit.branches.find((entry) => entry.open_pr);
  const findings = openPrHeadDeletionFindings(audit, { deleted: [{ name: active.name, sha: active.head_sha }] });
  assert.ok(findings.some((f) => f.includes("was open on it")), `the refusal does not say the branch had a PR open on it: ${findings.join(" | ")}`);
});

test("a deletion log that names an eligible branch at a commit the audit did not judge is refused", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  assert.ok(eligible, "nothing is eligible, so this test would check nothing");
  assert.ok(openPrHeadDeletionFindings(audit, { deleted: [{ name: eligible.name, sha: "f".repeat(40) }] }).some((f) => f.includes("this audit judged it at")), "deleting at an unaudited commit passed");
});

test("a deletion log that names an eligible branch at the commit the audit judged is accepted", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  assert.deepEqual(openPrHeadDeletionFindings(audit, { deleted: [{ name: eligible.name, sha: eligible.head_sha }] }), [], "the deletion Phase B is supposed to be able to make was refused");
});

// --- the live boundary ---------------------------------------------------------------------------

test("a deletion authorized only from stored facts is refused outright", () => {
  const { pre, post } = boundaryPair();
  const findings = deletionAuthorizationFindings({ audit, log: completedLog(pre, post), pre: null, post, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("no pre-deletion observation was supplied")), `a deletion with no observation was authorized: ${findings.join(" | ")}`);
});

test("a completed deletion with no post-deletion observation is refused", () => {
  const { pre, post } = boundaryPair();
  const findings = deletionAuthorizationFindings({ audit, log: completedLog(pre, post), pre, post: null, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("no post-deletion observation was supplied")), `a completed deletion with no witness was authorized: ${findings.join(" | ")}`);
});

test("a complete record with both boundary observations authorizes the deletion", () => {
  assert.deepEqual(authorize(), [], "the deletion Phase B is supposed to be able to make was refused");
});

test("a pull request opened after the audit was written blocks the deletion, whatever the audit says", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  const { post } = boundaryPair();
  const pre = observation({
    collected_at: "2026-09-10T00:00:00Z",
    open_prs: [...audit.live_observation.open_prs, { number: 999, head_branch: eligible.name, head_sha: eligible.head_sha, base: "dev", state: "OPEN" }]
  });
  const findings = deletionAuthorizationFindings({ audit, log: completedLog(pre, post), pre, post, completion: clearedCompletion() });
  assert.ok(findings.some((f) => f.includes("reads as eligible in the audit but PR #999")), `the eligible set was not re-checked against the live PR list: ${findings.join(" | ")}`);
  // The stored-only check cannot see it, which is the whole reason the observation exists.
  assert.deepEqual(openPrHeadDeletionFindings(audit, completedLog(pre, post)), [], "the stored check saw the live PR, so this test measures nothing");
});

test("a deletion at a commit the branch no longer points at, or of a branch that is gone, is refused", () => {
  const eligible = deletionEligibility(audit).eligible[0];
  const moved = observation({ collected_at: "2026-09-10T00:00:00Z", heads: audit.live_observation.heads.map((h) => (h.name === eligible.name ? { ...h, sha: "e".repeat(40) } : h)) });
  assert.ok(authorize({ pre: moved, post: boundaryPair().post }).some((f) => f.includes("but live it points at")), "deleting a moved branch was authorized");
  const absent = observation({ collected_at: "2026-09-10T00:00:00Z", heads: audit.live_observation.heads.filter((h) => h.name !== eligible.name) });
  assert.ok(authorize({ pre: absent, post: boundaryPair().post }).some((f) => f.includes("does not show it on the repository")), "deleting an absent branch was authorized");
});

test("a deletion record that does not cite both observation digests is refused", () => {
  const { pre, post } = boundaryPair();
  const wrongPre = completedLog(pre, post, { pre_observation: { digest: `sha256:${"9".repeat(64)}` } });
  assert.ok(authorize({ pre, post, log: wrongPre }).some((f) => f.includes("does not cite the digest of the pre-deletion observation")), "a record citing a different pre-observation was authorized");
  const wrongPost = completedLog(pre, post, { post_observation: { digest: `sha256:${"9".repeat(64)}` } });
  assert.ok(authorize({ pre, post, log: wrongPost }).some((f) => f.includes("does not cite the digest of the post-deletion observation")), "a record citing a different post-observation was authorized");
});

test("observations collected on the wrong side of the deletion, or too far from it, are refused", () => {
  const { post } = boundaryPair();
  const late = observation({ collected_at: "2026-09-10T00:02:00Z" });
  assert.ok(authorize({ pre: late, post }).some((f) => f.includes("collected after the deletion")), "a pre-observation from after the deletion was accepted");
  const stale = observation({ collected_at: "2026-09-09T00:00:00Z" });
  assert.ok(authorize({ pre: stale, post }).some((f) => f.includes("past the")), "a day-old pre-observation was accepted");
  const { pre } = boundaryPair();
  const early = observation({ collected_at: "2026-09-10T00:00:10Z", heads: post.heads, rest_heads: post.rest_heads });
  assert.ok(authorize({ pre, post: early }).some((f) => f.includes("collected before the deletion")), "a post-observation from before the deletion was accepted");
  const veryLate = observation({ collected_at: "2026-09-11T00:00:00Z", heads: post.heads, rest_heads: post.rest_heads });
  assert.ok(authorize({ pre, post: veryLate }).some((f) => f.includes("past the")), "a post-observation taken a day later was accepted");
});

// A syntactically shaped instant that no calendar has is not an instant. `Date.UTC` rolls
// 2026-02-30 forward into March rather than refusing it, so the freshness window would be measured
// against a day that never happened.
test("a calendar-impossible instant is refused rather than normalized", () => {
  const { post } = boundaryPair();
  for (const impossible of ["2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-04-31T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z"]) {
    const pre = observation({ collected_at: impossible });
    const findings = authorize({ pre, post });
    assert.ok(findings.some((f) => f.includes("no well-formed collection instant")), `${impossible} was accepted as a collection instant: ${findings.join(" | ")}`);
  }
  const { pre } = boundaryPair();
  assert.ok(authorize({ pre, post, log: completedLog(pre, post, { completed_at: "2026-02-30T00:00:00Z" }) }).some((f) => f.includes("without a well-formed instant")), "a calendar-impossible completion instant was accepted");
  // A real leap day still works.
  const leap = observation({ collected_at: "2028-02-29T00:00:00Z" });
  assert.ok(!authorize({ pre: leap, post }).some((f) => f.includes("no well-formed collection instant")), "a real leap day was refused");
});

test("an observation with no receipts, or whose derivations cite receipts it does not carry, is refused", () => {
  const { post } = boundaryPair();
  const bare = observation({ collected_at: "2026-09-10T00:00:00Z", receipts: [] });
  assert.ok(authorize({ pre: bare, post }).some((f) => f.includes("no command receipts")), "an observation with no receipts was accepted");
  const unsourced = observation({ collected_at: "2026-09-10T00:00:00Z", receipts: audit.live_observation.receipts.slice(0, 2) });
  assert.ok(authorize({ pre: unsourced, post }).some((f) => f.includes("which the observation does not carry")), "an observation whose derivations cite absent receipts was accepted");
  const wrongSchema = observation({ collected_at: "2026-09-10T00:00:00Z", schema: "something-else" });
  assert.ok(authorize({ pre: wrongSchema, post }).some((f) => f.includes("not aos-branch-live-observation.v2")), "an observation of the wrong schema was accepted");
});

// An unpaginated list turns a pull request on the second page into an absent pull request, and the
// gate reads absence as "no PR open". The completeness flag is what makes a truncated sweep visible.
test("a truncated reference sweep is refused rather than read as nothing found", () => {
  const { post } = boundaryPair();
  const truncated = observation({
    collected_at: "2026-09-10T00:00:00Z",
    reference_sweep: audit.live_observation.reference_sweep.map((sweep, index) => (index === 0 ? { ...sweep, complete: false, total_count: 250 } : sweep))
  });
  const findings = authorize({ pre: truncated, post });
  assert.ok(findings.some((f) => f.includes("was not established")), `a truncated sweep passed as a complete one: ${findings.join(" | ")}`);
});

test("a capped pull request history blocks the deletion", () => {
  const { post } = boundaryPair();
  const pre = observation({ collected_at: "2026-09-10T00:00:00Z" });
  const branch = Object.keys(pre.derivations)[0];
  pre.derivations[branch].pr_history.complete = false;
  pre.digest = observationDigest(pre);
  const findings = authorize({ pre, post });
  assert.ok(findings.some((f) => f.includes("bounded slice")), `a capped PR history authorized a deletion: ${findings.join(" | ")}`);
});

test("a live head the audit never covered blocks the deletion", () => {
  const { post } = boundaryPair();
  const pre = observation({ collected_at: "2026-09-10T00:00:00Z" });
  pre.heads = [...pre.heads, { name: "task/issue-000-unaudited", sha: "a".repeat(40) }];
  pre.rest_heads = pre.heads;
  pre.digest = observationDigest(pre);
  assert.ok(authorize({ pre, post }).some((f) => f.includes("appears nowhere in this audit")), "an unaudited live head did not block the deletion");
});

test("the deletion is refused while the canonical snapshot still shows a blocker open", () => {
  assert.ok(authorize({ completion }).some((f) => f.includes("still blocked")), "a deletion ran while a blocker was open");
});

// The gate collects both observations around the caller's action. Recollecting one side and
// accepting the other closes nothing: the invariants are a comparison, and a comparison is only as
// trustworthy as its worse operand.
test("the gate collects both boundary observations itself, around the deletion", () => {
  const { pre, post } = livePair();
  const collected = [];
  const gone = deletedNames();
  let performedWith = null;
  // The first call is before the deletion and the second after it, so the fake collector returns the
  // state that actually corresponds to each moment.
  const collect = () => { collected.push(1); return structuredClone(collected.length === 1 ? pre : post); };
  const run = makeDeletionRunner(collect, clearedCompletion)({ audit, perform: (list) => { performedWith = list; } });
  assert.equal(collected.length, 2, "the gate did not collect on both sides of the deletion");
  assert.deepEqual(performedWith.map((entry) => entry.name).sort(), [...gone].sort(), "the gate did not act on exactly the eligible set");
  assert.equal(run.authorized, true, `a correct deletion was refused: ${run.findings.join(" | ")}`);
  assert.equal(run.log.status, "COMPLETED");
  assert.equal(run.log.pre_observation.digest, observationDigest(pre), "the emitted log does not cite the observation the gate collected first");
  assert.equal(run.log.post_observation.digest, observationDigest(post), "the emitted log does not cite the observation the gate collected last");
});

// The reviewer's reproduction: a caller-composed pre observation from an injected collector plus a
// caller-composed post observation used to authorize with no findings. Neither is a parameter now,
// so passing them has no effect at all.
// The set the gate acts on is the audit's eligible set narrowed by what is true right now. A branch
// that moved, or picked up a pull request, after the audit was written is eligible on paper and must
// not be touched.
test("the gate does not act on a branch the live repository no longer agrees about", () => {
  const eligible = deletionEligibility(audit).eligible;
  assert.ok(eligible.length >= 2, "fewer than two eligible branches, so this test could not tell narrowing from refusal");
  const moved = eligible[0].name;
  const claimed = eligible[1].name;
  const pre = observation({
    collected_at: iso(-5),
    heads: audit.live_observation.heads.map((head) => (head.name === moved ? { ...head, sha: "c".repeat(40) } : head)),
    open_prs: [...audit.live_observation.open_prs, { number: 999, head_branch: claimed, head_sha: eligible[1].head_sha, base: "dev", state: "OPEN" }]
  });
  pre.rest_heads = pre.heads;
  pre.digest = observationDigest(pre);
  const post = observation({ collected_at: iso(5), heads: pre.heads, rest_heads: pre.heads });
  let performedWith = null;
  let calls = 0;
  const collect = () => { calls += 1; return structuredClone(calls === 1 ? pre : post); };
  const run = makeDeletionRunner(collect, clearedCompletion)({ audit, perform: (list) => { performedWith = list; } });
  assert.deepEqual(performedWith, [], `the gate acted on a branch the live repository disagreed about: ${JSON.stringify(performedWith)}`);
  assert.deepEqual(run.deleted, [], "the record claims deletions the gate did not make");
});

test("the gate has no parameter through which a composed observation reaches the decision", () => {
  const { pre, post } = livePair();
  const forgedPost = structuredClone(post);
  forgedPost.protection = { main: { allow_deletions: { enabled: true } }, dev: post.protection.dev };
  let calls = 0;
  const honest = () => { calls += 1; return structuredClone(calls === 1 ? pre : forgedPost); };
  // Every one of these keys was accepted by the previous entry point.
  const run = makeDeletionRunner(honest, clearedCompletion)({
    audit,
    perform: () => {},
    collect: () => structuredClone(pre),
    pre: structuredClone(pre),
    post: structuredClone(post),
    completion: clearedCompletion(),
    maxAgeSeconds: 10 ** 9
  });
  assert.equal(calls, 2, "an injected collect/pre/post parameter displaced the gate's own collection");
  assert.ok(run.findings.some((f) => f.includes("main protection changed")), `the supplied post observation was used instead of the collected one: ${run.findings.join(" | ")}`);
  assert.equal(run.authorized, false, "a deletion that loosened main's protection was authorized");
});

test("the exported gate exposes no collector at all", () => {
  const { pre } = boundaryPair();
  let injected = 0;
  // `runDeletion` is bound to the real collector; passing one is inert. Offline it fails to collect,
  // which is itself the assertion: the parameter did not take.
  const run = runDeletion({ audit, perform: () => {}, collect: () => { injected += 1; return structuredClone(pre); } });
  assert.equal(injected, 0, "runDeletion used a collector handed to it");
  assert.equal(run.authorized, false, "runDeletion authorized a deletion without reaching the repository");
});

test("the prerequisites are read before anything is deleted, not after", () => {
  const { pre, post } = boundaryPair();
  let performed = false;
  let collected = 0;
  const collect = () => { collected += 1; return structuredClone(collected === 1 ? pre : post); };
  // The real canonical snapshot still has a blocker open.
  const run = makeDeletionRunner(collect)({ audit, perform: () => { performed = true; } });
  assert.equal(performed, false, "the gate deleted before checking whether Phase B may start");
  assert.equal(collected, 0, "the gate collected before checking whether Phase B may start");
  assert.ok(run.findings.some((f) => f.includes("still blocked")), `the refusal does not name the open blocker: ${run.findings.join(" | ")}`);
});

test("a collector that fails authorizes nothing, on either side of the deletion", () => {
  const { pre, post } = boundaryPair();
  const before = makeDeletionRunner(() => { throw new Error("github unreachable"); }, clearedCompletion)({ audit, perform: () => {} });
  assert.ok(before.findings.some((f) => f.includes("pre-deletion observation could not be collected")), `a failed first collection did not block: ${before.findings.join(" | ")}`);
  assert.equal(before.log, null);

  let calls = 0;
  const failsAfter = () => { calls += 1; if (calls === 2) throw new Error("github unreachable"); return structuredClone(pre); };
  const after = makeDeletionRunner(failsAfter, clearedCompletion)({ audit, perform: () => {} });
  assert.ok(after.findings.some((f) => f.includes("post-deletion observation could not be collected")), `a failed second collection did not block: ${after.findings.join(" | ")}`);
  assert.equal(after.log, null, "a deletion with no witness still emitted a record");
});

test("a deletion action that throws is still witnessed and reported", () => {
  const { pre, post } = livePair();
  let calls = 0;
  const collect = () => { calls += 1; return structuredClone(calls === 1 ? pre : post); };
  const run = makeDeletionRunner(collect, clearedCompletion)({ audit, perform: () => { throw new Error("push --delete refused"); } });
  assert.equal(calls, 2, "a failed deletion was not witnessed");
  assert.ok(run.findings.some((f) => f.includes("did not complete")), `a failed deletion was not reported: ${run.findings.join(" | ")}`);
  assert.equal(run.authorized, false);
});
