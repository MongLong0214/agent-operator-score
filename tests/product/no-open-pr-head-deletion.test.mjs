import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DELETION_BLOCKED_BY, deletionAuthorizationFindings, deletionEligibility, deletionLogFindings, loadCompletionSnapshot, openPrHeadDeletionFindings, runDeletion } from "../../scripts/branch-audit.mjs";
import { collect, observationDigest } from "../../scripts/collect-branch-state.mjs";
import { auditFor, buildFixtureRepository, withFakeGitHub } from "./branch-state-fixture.mjs";

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

// --- the gate, driven against a real repository ---------------------------------------------------
//
// These do not inject anything. The module exposes no collector, no observation and no factory that
// takes them, so the only way to drive `runDeletion` is to give it a repository to look at:
// `branch-state-fixture.mjs` builds one, with a `gh` on PATH that answers from a table built after
// the commits exist. Slower than a seam, and it leaves nothing to step through.

const drive = (options, body) => {
  const fixture = buildFixtureRepository(options);
  try {
    return withFakeGitHub(fixture, () => {
      const observation = collect({ repository: fixture.repository, cwd: fixture.work });
      observation.digest = observationDigest(observation);
      return body(fixture, auditFor(observation, { repository: fixture.repository }), observation);
    });
  } finally {
    fixture.cleanup();
  }
};

const liveHeads = (fixture) =>
  execFileSync("git", ["ls-remote", "--heads", "origin"], { cwd: fixture.work, encoding: "utf8" })
    .split("\n").filter(Boolean).map((line) => line.split(/\s+/u)[1].replace("refs/heads/", ""));

test("the gate collects both boundary observations itself, around a real deletion", () => {
  drive({}, (fixture, audit) => {
    let performedWith = null;
    const run = runDeletion({
      audit,
      repository: fixture.repository,
      cwd: fixture.work,
      perform: (list) => {
        performedWith = list;
        for (const entry of list) fixture.deleteBranch(entry.name);
      }
    });
    assert.deepEqual(performedWith.map((entry) => entry.name), ["tmp/merged-thing"], "the gate did not act on exactly the eligible set");
    assert.deepEqual(run.findings, [], `a correct deletion was refused: ${run.findings.join(" | ")}`);
    assert.equal(run.authorized, true);
    assert.equal(run.log.status, "COMPLETED");
    assert.match(run.log.pre_observation.digest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(run.log.post_observation.digest, /^sha256:[0-9a-f]{64}$/u);
    assert.notEqual(run.log.pre_observation.digest, run.log.post_observation.digest, "the two boundary observations are the same record, so one of them was not collected");
    // The branch is really gone, and the one with a pull request on it really is not.
    const remaining = liveHeads(fixture);
    assert.equal(remaining.includes("tmp/merged-thing"), false, "the eligible branch was not actually deleted");
    assert.ok(remaining.includes("task/active-work"), "the open PR's head branch was deleted");
    assert.ok(remaining.includes("main") && remaining.includes("dev"));
    assert.deepEqual(deletionLogFindings(run.log, { completion: loadCompletionSnapshot(join(fixture.work, "fixtures", "execution-plan", "github-state.json")) }), [], "the emitted log does not hold its own shape");
  });
});

// The reviewer's reproduction, and the reason the factory is gone: composed observations and a
// composed prerequisite snapshot used to authorize a deletion. There is no longer an argument for
// any of them, which is asserted rather than described.
test("the gate has no parameter through which composed state reaches the decision", () => {
  drive({}, (fixture, audit, observation) => {
    const forged = structuredClone(observation);
    forged.heads = forged.heads.filter((head) => head.name !== "task/active-work");
    forged.open_prs = [];
    let performedWith = null;
    const run = runDeletion({
      audit,
      repository: fixture.repository,
      cwd: fixture.work,
      perform: (list) => { performedWith = list; for (const entry of list) fixture.deleteBranch(entry.name); },
      // Every input the previous entry point and its factory accepted.
      collect: () => structuredClone(forged),
      loadCompletion: () => ({ issues: [] }),
      pre: structuredClone(forged),
      post: structuredClone(forged),
      completion: { issues: [] },
      maxAgeSeconds: 10 ** 9
    });
    assert.deepEqual(performedWith.map((entry) => entry.name), ["tmp/merged-thing"], "a supplied observation displaced the one the gate collected");
    assert.equal(run.authorized, true, `the gate's own collection was not used: ${run.findings.join(" | ")}`);
    assert.ok(liveHeads(fixture).includes("task/active-work"), "the forged observation reached the decision and the open PR's head was deleted");
  });
});

test("the gate does not act on a branch the live repository no longer agrees about", () => {
  drive({}, (fixture, audit) => {
    // A pull request opens on the eligible branch between the audit and the deletion.
    const responses = JSON.parse(readFileSync(fixture.responses, "utf8"));
    const late = { number: 2, state: "open", merged_at: null, base: { ref: "dev" }, head: { ref: "tmp/merged-thing", sha: fixture.shas.main } };
    responses[`repos/${fixture.repository}/pulls?state=open&per_page=100`].push(late);
    responses[`repos/${fixture.repository}/pulls?state=all&head=fixture-owner:tmp/merged-thing&per_page=100`].push(late);
    writeFileSync(fixture.responses, JSON.stringify(responses));

    let performedWith = null;
    const run = runDeletion({ audit, repository: fixture.repository, cwd: fixture.work, perform: (list) => { performedWith = list; } });
    assert.deepEqual(performedWith, [], "the gate deleted a branch that had a pull request opened on it after the audit");
    assert.deepEqual(run.deleted, []);
    assert.ok(liveHeads(fixture).includes("tmp/merged-thing"));
  });
});

test("the prerequisites are read from the operated repository, before anything is collected or deleted", () => {
  drive({ blockersCleared: false }, (fixture, audit) => {
    let performed = false;
    const run = runDeletion({ audit, repository: fixture.repository, cwd: fixture.work, perform: () => { performed = true; } });
    assert.equal(performed, false, "the gate deleted before checking whether Phase B may start");
    assert.equal(run.log, null);
    assert.ok(run.findings.some((f) => f.includes("still blocked")), `the refusal does not name the open blocker: ${run.findings.join(" | ")}`);
  });
});

test("a repository with no governance record authorizes nothing", () => {
  drive({}, (fixture, audit) => {
    rmSync(join(fixture.work, "fixtures", "execution-plan", "github-state.json"));
    let performed = false;
    const run = runDeletion({ audit, repository: fixture.repository, cwd: fixture.work, perform: () => { performed = true; } });
    assert.equal(performed, false, "the gate deleted from a repository whose prerequisite snapshot it could not read");
    assert.equal(run.log, null);
    assert.ok(run.findings.some((f) => f.includes("could not be read")), `an unreadable snapshot did not block: ${run.findings.join(" | ")}`);
  });
});

// The second collection is the witness. Losing it after the refs are gone is the one moment where a
// self-reported after-state would be most tempting and least checkable.
test("a deletion whose after-state cannot be read emits no record", () => {
  drive({}, (fixture, audit) => {
    const run = runDeletion({
      audit,
      repository: fixture.repository,
      cwd: fixture.work,
      perform: (list) => {
        for (const entry of list) fixture.deleteBranch(entry.name);
        writeFileSync(fixture.responses, "{}");
      }
    });
    assert.ok(run.findings.some((f) => f.includes("post-deletion observation could not be collected")), `a deletion with no witness passed: ${run.findings.join(" | ")}`);
    assert.equal(run.log, null, "a deletion with no witness still emitted a record");
    assert.equal(run.authorized, false);
    assert.deepEqual(run.deleted.map((entry) => entry.name), ["tmp/merged-thing"], "the record does not say what was deleted before the witness was lost");
  });
});

test("a collector that cannot reach the repository authorizes nothing", () => {
  drive({}, (fixture, audit) => {
    // Take the fake GitHub away: the collector's first API call fails.
    writeFileSync(fixture.responses, "{}");
    let performed = false;
    const run = runDeletion({ audit, repository: fixture.repository, cwd: fixture.work, perform: () => { performed = true; } });
    assert.equal(performed, false, "the gate deleted without a usable observation");
    assert.equal(run.log, null);
    assert.ok(run.findings.some((f) => f.includes("could not be collected")), `a failed collection did not block: ${run.findings.join(" | ")}`);
  });
});

test("a deletion action that throws is still witnessed and reported", () => {
  drive({}, (fixture, audit) => {
    const run = runDeletion({
      audit,
      repository: fixture.repository,
      cwd: fixture.work,
      perform: () => { throw new Error("push --delete refused"); }
    });
    assert.ok(run.findings.some((f) => f.includes("did not complete")), `a failed deletion was not reported: ${run.findings.join(" | ")}`);
    assert.equal(run.authorized, false);
    // It was still witnessed: the branch is still there, and the boundary says so.
    assert.ok(liveHeads(fixture).includes("tmp/merged-thing"));
    assert.ok(run.findings.some((f) => f.includes("still on the repository afterwards")), "the boundary did not notice the claimed deletion had not happened");
  });
});

test("a deletion that takes an extra ref with it is refused", () => {
  drive({}, (fixture, audit) => {
    const run = runDeletion({
      audit,
      repository: fixture.repository,
      cwd: fixture.work,
      perform: (list) => {
        for (const entry of list) fixture.deleteBranch(entry.name);
        fixture.deleteBranch("task/active-work");
      }
    });
    assert.ok(run.findings.some((f) => f.includes("task/active-work") && f.includes("does not say it was deleted")), `an extra ref taken by the deletion passed: ${run.findings.join(" | ")}`);
    assert.equal(run.authorized, false);
  });
});
