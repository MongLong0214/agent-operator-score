import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DELETION_BLOCKED_BY, deletionAuthorizationFindings, deletionEligibility, derivationFindings, liveEligibility, loadCompletionSnapshot, openPrHeadDeletionFindings } from "../../scripts/branch-audit.mjs";
import { collect, observationDigest } from "../../scripts/collect-branch-state.mjs";
import { auditFor, buildFixtureRepository, withFakeGitHub } from "./branch-state-fixture.mjs";

// The prohibition in #572 that cannot be walked back: deleting the head branch of an open pull
// request destroys its diff. It has to hold in three directions -- an open PR head may never be
// eligible in the committed audit, a proposed deletion may never name one, and neither may a pull
// request opened *after* the audit was written. The third is why `liveEligibility` exists and why the
// tests below collect from a real repository rather than composing an observation.

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

/** A well-formed observation, shaped as the collector emits one. */
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

// --- driven against a real repository -------------------------------------------------------------
//
// These do not hand the verifier a hand-written observation. `branch-state-fixture.mjs` builds a bare
// origin with branches, an annotated tag and commits, and puts a `gh` on PATH that answers from a
// table built after the commits exist, so the collector runs for real and `liveEligibility` is asked
// about a repository rather than about a literal.

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

/** Re-collect after changing what the fake GitHub says, which is what Phase B would see. */
const recollect = (fixture) => {
  const observation = collect({ repository: fixture.repository, cwd: fixture.work });
  observation.digest = observationDigest(observation);
  return observation;
};

const setResponses = (fixture, mutate) => {
  const responses = JSON.parse(readFileSync(fixture.responses, "utf8"));
  mutate(responses);
  writeFileSync(fixture.responses, JSON.stringify(responses));
};

test("a live observation of a real repository finds exactly the eligible branch", () => {
  drive({}, (fixture, audit, observation) => {
    const { eligible, refused, findings } = liveEligibility(audit, observation);
    assert.deepEqual(findings, [], `the audit did not hold against its own repository: ${findings.join(" | ")}`);
    assert.deepEqual(eligible.map((entry) => entry.name), ["tmp/merged-thing"]);
    assert.deepEqual(refused, []);
  });
});

test("nothing is found eligible without a live observation", () => {
  drive({}, (_fixture, audit) => {
    const { eligible, findings } = liveEligibility(audit, null);
    assert.deepEqual(eligible, []);
    assert.ok(findings.some((f) => f.includes("no live observation")), `stored facts alone produced an eligible set: ${findings.join(" | ")}`);
  });
});

// --- absence is not an empty list, and one source agreeing is not every source --------------------
//
// Each of these produced an eligible open-PR head before the fix.

test("a list endpoint that succeeds and returns nothing is not an empty list", () => {
  drive({}, (fixture) => {
    setResponses(fixture, (responses) => {
      responses[`repos/${fixture.repository}/pulls?state=all&head=fixture-owner:tmp/merged-thing&per_page=100`]
        .push({ number: 2, state: "open", merged_at: null, base: { ref: "dev" }, head: { ref: "tmp/merged-thing", sha: fixture.shas.main } });
      responses[`repos/${fixture.repository}/pulls?state=open&per_page=100`] = "__EMPTY__";
    });
    assert.throws(() => recollect(fixture), /returned nothing/u, "a command that returned nothing was read as an empty list");
  });
});

test("an open pull request visible only in the collected history still refuses the branch", () => {
  drive({}, (fixture, audit) => {
    setResponses(fixture, (responses) => {
      responses[`repos/${fixture.repository}/pulls?state=all&head=fixture-owner:tmp/merged-thing&per_page=100`]
        .push({ number: 2, state: "open", merged_at: null, base: { ref: "dev" }, head: { ref: "tmp/merged-thing", sha: fixture.shas.main } });
    });
    // Two independent refusals now: the fresh derivations disagree with the stored record, and the
    // per-branch check sees the pull request. Either is enough; both naming it is better.
    const { eligible, refused, findings } = liveEligibility(audit, recollect(fixture));
    assert.deepEqual(eligible, [], "an open PR the open-list did not mention left the branch eligible");
    const said = [...findings, ...refused.map((one) => `${one.name}: ${one.reason}`)];
    assert.ok(said.some((one) => one.includes("tmp/merged-thing") && one.includes("#2")), `the refusal does not name the pull request: ${said.join(" | ")}`);
  });
});

test("protection turned on after the audit refuses the branch", () => {
  drive({}, (fixture, audit) => {
    setResponses(fixture, (responses) => {
      for (const branch of responses[`repos/${fixture.repository}/branches?per_page=100`]) {
        if (branch.name === "tmp/merged-thing") branch.protected = true;
      }
    });
    const { eligible, refused } = liveEligibility(audit, recollect(fixture));
    assert.deepEqual(eligible, [], "a branch protected since the audit stayed eligible on the stored flag");
    assert.ok(refused.some((one) => one.reason.includes("protected")), `the protection change was not the reason: ${JSON.stringify(refused)}`);
  });
});

// `null` is not `false`. A branch the observation says nothing usable about is not a branch known to
// be unprotected, and treating the two the same is the absence-as-success shape on the last check
// standing between an audit and a deletion.
test("an unreadable protection state refuses the branch rather than passing it", () => {
  drive({}, (fixture, audit) => {
    setResponses(fixture, (responses) => {
      for (const branch of responses[`repos/${fixture.repository}/branches?per_page=100`]) {
        if (branch.name === "tmp/merged-thing") branch.protected = "false";
      }
    });
    const { eligible, refused } = liveEligibility(audit, recollect(fixture));
    assert.deepEqual(eligible, [], "a branch whose protection state was not a boolean stayed eligible");
    assert.ok(refused.some((one) => one.reason.includes("no protection state")), `the unreadable state was not the reason: ${JSON.stringify(refused)}`);
  });
});

test("a branch that moved since the audit is refused at the commit the audit judged", () => {
  drive({}, (fixture, audit) => {
    execFileSync("git", ["checkout", "-q", "tmp/merged-thing"], { cwd: fixture.work });
    writeFileSync(join(fixture.work, "late.txt"), "after the audit\n");
    execFileSync("git", ["add", "-A"], { cwd: fixture.work });
    execFileSync("git", ["commit", "-qm", "late work"], { cwd: fixture.work });
    execFileSync("git", ["push", "-q", "origin", "tmp/merged-thing"], { cwd: fixture.work });
    setResponses(fixture, (responses) => {
      const moved = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.work, encoding: "utf8" }).trim();
      for (const branch of responses[`repos/${fixture.repository}/branches?per_page=100`]) {
        if (branch.name === "tmp/merged-thing") branch.commit.sha = moved;
      }
    });
    const { eligible, refused, findings } = liveEligibility(audit, recollect(fixture));
    assert.deepEqual(eligible, [], "a branch that moved after the audit stayed eligible");
    const said = [...findings, ...refused.map((one) => `${one.name}: ${one.reason}`)];
    assert.ok(said.some((one) => one.includes("tmp/merged-thing")), `nothing named the branch that moved: ${said.join(" | ")}`);
  });
});

// --- the derivations answer about the repository, not about this checkout ------------------------

test("tag containment reports the repository's tags, not whatever this checkout carries", () => {
  drive({}, (fixture, _audit, observation) => {
    assert.deepEqual(observation.derivations["tmp/merged-thing"].tags_containing.value, ["v0.1.0"], "the fixture's annotated tag was not derived");
    execFileSync("git", ["tag", "local-only", fixture.shas.main], { cwd: fixture.work });
    execFileSync("git", ["tag", "-d", "v0.1.0"], { cwd: fixture.work });
    assert.deepEqual(recollect(fixture).derivations["tmp/merged-thing"].tags_containing.value, ["v0.1.0"], "tag containment followed the local tag set rather than the repository's");
  });
});

test("the tree scan reads the integration line, not the branch the collector happens to be on", () => {
  drive({}, (fixture) => {
    execFileSync("git", ["checkout", "-q", "dev"], { cwd: fixture.work });
    writeFileSync(join(fixture.work, "notes.md"), "see tmp/merged-thing before deleting\n");
    execFileSync("git", ["add", "-A"], { cwd: fixture.work });
    execFileSync("git", ["commit", "-qm", "reference the branch"], { cwd: fixture.work });
    execFileSync("git", ["push", "-q", "origin", "dev"], { cwd: fixture.work });
    execFileSync("git", ["checkout", "-q", "task/active-work"], { cwd: fixture.work });
    const again = recollect(fixture);
    assert.ok(
      again.derivations["tmp/merged-thing"].tree_scan.value.some((hit) => hit.includes("notes.md")),
      `the tree scan missed a reference that is on dev: ${JSON.stringify(again.derivations["tmp/merged-thing"].tree_scan.value)}`
    );
  });
});

// The collector's own errors are where the path actually leaked: an ENOENT carries the absolute path
// it tried, and these messages end up in findings that get committed and rendered.
test("a collector error names a repository-relative path, not the checkout it ran in", () => {
  drive({}, (fixture, audit) => {
    rmSync(join(fixture.work, ".claude-plugin", "marketplace.json"));
    let message = null;
    try { recollect(fixture); } catch (error) { message = error.message; }
    assert.ok(message, "the collector did not fail when the install source went missing");
    assert.ok(message.includes(".claude-plugin/marketplace.json"), `the error does not say which file: ${message}`);
    assert.ok(!message.includes(fixture.work), `the error names the checkout path: ${message}`);
    assert.ok(!/(?:\/[\w.@%+-]+){3,}/u.test(message), `the error carries an absolute path: ${message}`);
    for (const finding of liveEligibility(audit, null).findings) {
      assert.ok(!/(?:\/[\w.@%+-]+){3,}/u.test(finding), `a finding carries an absolute path: ${finding}`);
    }
  });
});

// The receipt, not only its name. A record collected by an older collector carries a command this
// one would not run, and comparing source names alone cannot see it.
test("a tree scan run against something other than the observed dev commit is refused", () => {
  drive({}, (_fixture, audit, observation) => {
    const forged = structuredClone(observation);
    const scan = forged.receipts.find((one) => one.source === forged.derivations["tmp/merged-thing"].tree_scan.source);
    scan.command = scan.command.replace(/[0-9a-f]{40}/u, "HEAD");
    forged.digest = observationDigest(forged);
    const findings = derivationFindings(audit, forged);
    assert.ok(findings.some((one) => one.includes("about a different tree")), `a scan of another tree passed: ${findings.join(" | ")}`);
  });
});
