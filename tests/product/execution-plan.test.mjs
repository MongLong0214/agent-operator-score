import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  CANONICAL_ISSUE_COUNT,
  EXCLUDED_ISSUES,
  auditCloseEvidence,
  auditSummary,
  checkGithubState,
  checkPlan,
  loadPlan,
  loadSchema,
  nextWork,
  MAX_REPORTED_CYCLES,
  REQUIRED_CONFIRMATIONS,
  planDigest,
  validateAgainstSchema
} from "../../lib/execution-plan.mjs";

const plan = () => loadPlan();
const clone = (value) => JSON.parse(JSON.stringify(value));
const entry = (doc, issue) => doc.issues.find((one) => one.issue === issue);
const failures = (report) => report.failures.map((one) => one.check);

const verified = () => ({ ...Object.fromEntries(REQUIRED_CONFIRMATIONS.map((key) => [key, true])), verified: true });

const state = () =>
  JSON.parse(readFileSync(new URL("../../fixtures/execution-plan/github-state.json", import.meta.url), "utf8"));

// --- the manifest itself -------------------------------------------------------------------

test("the shipped manifest validates against its own schema", () => {
  const report = validateAgainstSchema(plan(), loadSchema());
  assert.deepEqual(report.errors, [], "schema errors");
  assert.equal(report.ok, true);
});

test("the canonical scope is exactly the thirty-two issues, and the duplicates are named as excluded", () => {
  const doc = plan();
  assert.equal(doc.issues.length, CANONICAL_ISSUE_COUNT);
  assert.equal(CANONICAL_ISSUE_COUNT, 32);
  const numbers = doc.issues.map((one) => one.issue).sort((a, b) => a - b);
  const expected = [
    ...Array.from({ length: 26 }, (_, i) => 553 + i),
    582, 583, 584, 585, 586, 588
  ].sort((a, b) => a - b);
  assert.deepEqual(numbers, expected);
  assert.deepEqual([...EXCLUDED_ISSUES].sort((a, b) => a - b), [579, 580, 581]);
  for (const excluded of EXCLUDED_ISSUES) assert.equal(entry(doc, excluded), undefined);
});

test("the shipped manifest passes every static check", () => {
  const report = checkPlan(plan());
  assert.deepEqual(report.failures, [], JSON.stringify(report.failures, null, 2));
  assert.equal(report.ok, true);
});

// --- the checks are load-bearing -----------------------------------------------------------

test("a dependency cycle fails", () => {
  const doc = plan();
  // #562 waits on #564; making #564 wait on #562 closes the loop the epic calls out by name.
  entry(doc, 564).blocked_by.push(562);
  entry(doc, 562).blocks.push(564);
  assert.ok(failures(checkPlan(doc)).includes("dependency-cycle"));
});

test("a self dependency fails", () => {
  const doc = plan();
  entry(doc, 559).blocked_by.push(559);
  assert.ok(failures(checkPlan(doc)).includes("self-dependency"));
});

test("a ready issue with an unfinished predecessor fails", () => {
  const doc = plan();
  const one = entry(doc, 559);
  one.status = "ready";
  assert.ok(failures(checkPlan(doc)).includes("ready-with-unfinished-predecessor"));
});

test("a blocked issue whose predecessors all passed is stale and fails", () => {
  const doc = plan();
  for (const number of entry(doc, 559).blocked_by) entry(doc, number).status = "done";
  assert.ok(failures(checkPlan(doc)).includes("stale-blocked-status"));
});

test("two issues owning the same hot file fails", () => {
  const doc = plan();
  entry(doc, 560).owner_surfaces.push("result-schema");
  assert.ok(failures(checkPlan(doc)).includes("hot-file-owner-collision"));
});

test("blocked_by and blocks must agree in both directions", () => {
  const doc = plan();
  entry(doc, 559).blocked_by = entry(doc, 559).blocked_by.filter((n) => n !== 582);
  assert.ok(failures(checkPlan(doc)).includes("reverse-edge-inconsistent"));
});

test("a missing canonical issue and an unknown one both fail", () => {
  const missing = plan();
  missing.issues = missing.issues.filter((one) => one.issue !== 566);
  assert.ok(failures(checkPlan(missing)).includes("canonical-issue-set"));

  const unknown = plan();
  unknown.issues.push({ ...clone(entry(unknown, 566)), issue: 581 });
  assert.ok(failures(checkPlan(unknown)).includes("canonical-issue-set"));
});

test("a duplicated issue entry fails", () => {
  const doc = plan();
  doc.issues.push(clone(entry(doc, 567)));
  assert.ok(failures(checkPlan(doc)).includes("duplicate-issue"));
});

test("a release-critical issue without a close-evidence contract fails", () => {
  const doc = plan();
  entry(doc, 553).close_evidence_required = false;
  assert.ok(failures(checkPlan(doc)).includes("release-critical-needs-close-evidence"));
});

// --- phase-ready is not READY --------------------------------------------------------------

test("phase-ready is separate from issue ready", () => {
  const doc = plan();
  const feasibility = entry(doc, 556);
  assert.equal(feasibility.status, "blocked");
  const phase = feasibility.phases.find((one) => one.id === "feasibility-proof");
  assert.equal(phase.status, "ready");
  assert.equal(phase.code_integration_allowed, false);
});

test("a phase-ready phase that claims final integration exceeds its scope and fails", () => {
  const doc = plan();
  entry(doc, 556).phases.find((one) => one.id === "feasibility-proof").code_integration_allowed = true;
  assert.ok(failures(checkPlan(doc)).includes("phase-scope-exceeded"));
});

test("a phase output outside the declared vocabulary fails", () => {
  const doc = plan();
  entry(doc, 556).phases.find((one) => one.id === "feasibility-proof").allowed_outputs.push("final-integration");
  assert.ok(failures(checkPlan(doc)).includes("phase-output-not-allowed"));
});

// --- GitHub state --------------------------------------------------------------------------

test("the committed snapshot agrees with the manifest", () => {
  const report = checkGithubState(plan(), state());
  assert.deepEqual(report.failures, [], JSON.stringify(report.failures, null, 2));
  assert.equal(report.ok, true);
});

test("a status label that contradicts the manifest fails", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 559).labels = ["release:v0.2.0", "priority:P0", "area:measurement", "status:ready"];
  assert.ok(checkGithubState(plan(), snapshot).failures.some((one) => one.check === "status-label-mismatch"));
});

test("a wrong milestone fails", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 567).milestone = 13;
  assert.ok(checkGithubState(plan(), snapshot).failures.some((one) => one.check === "milestone-mismatch"));
});

test("a missing V3 body marker fails", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 582).body_marker = null;
  assert.ok(checkGithubState(plan(), snapshot).failures.some((one) => one.check === "body-marker-missing"));
});

test("an issue closed while the manifest still has it open fails", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 570).state = "closed";
  assert.ok(checkGithubState(plan(), snapshot).failures.some((one) => one.check === "open-state-mismatch"));
});

// --- close evidence ------------------------------------------------------------------------

test("#582 closed on a documentation PR with no implementation evidence fails", () => {
  // The regression the epic names: the issue was closed once by a docs-only PR reference.
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 582);
  issue.state = "closed";
  issue.close_evidence = null;
  issue.closing_references = ["#544 docs: measurement foundations"];
  const report = auditCloseEvidence(plan(), snapshot);
  assert.ok(report.failures.some((one) => one.check === "close-evidence-missing" && one.issue === 582));
  assert.equal(report.ok, false);
});

test("close evidence without CI run ids or a PASS verdict is not evidence", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 567);
  issue.state = "closed";
  issue.close_evidence = {
    schema: "aos-issue-completion.v1",
    author_trusted: true,
    issue: 567,
    final_sha: "0".repeat(40),
    pr: 601,
    ci_run_ids: [],
    verdict: "PASS",
    evidence: {}
  };
  assert.ok(auditCloseEvidence(plan(), snapshot).failures.some((one) => one.check === "close-evidence-incomplete"));

  const held = state();
  const other = held.issues.find((one) => one.number === 567);
  other.state = "closed";
  other.close_evidence = {
    schema: "aos-issue-completion.v1",
    author_trusted: true,
    issue: 567,
    final_sha: "0".repeat(40),
    pr: 601,
    ci_run_ids: [12345],
    verdict: "HOLD",
    evidence: { raw_byte_digest_api: "sha256:" + "0".repeat(64), mutation: "load-bearing" }
  };
  assert.ok(auditCloseEvidence(plan(), held).failures.some((one) => one.check === "close-evidence-not-pass"));
});

test("close evidence missing an issue-specific required field fails", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 567);
  issue.state = "closed";
  issue.close_evidence = {
    schema: "aos-issue-completion.v1",
    author_trusted: true,
    issue: 567,
    final_sha: "0".repeat(40),
    pr: 601,
    ci_run_ids: [12345],
    verdict: "PASS",
    evidence: { mutation: "load-bearing" }
  };
  issue.close_evidence_checked = verified();
  const report = auditCloseEvidence(plan(), snapshot);
  assert.ok(report.failures.some((one) => one.check === "close-evidence-field-missing"));
});

test("a complete completion record closes the issue", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 567);
  issue.state = "closed";
  issue.labels = ["release:v0.2.0", "priority:P0", "area:measurement", "status:done"];
  issue.close_evidence = {
    schema: "aos-issue-completion.v1",
    author_trusted: true,
    issue: 567,
    final_sha: "a".repeat(40),
    pr: 601,
    ci_run_ids: [12345, 12346],
    verdict: "PASS",
    evidence: {
      raw_byte_digest_api: "sha256:" + "b".repeat(64),
      mutation: "load-bearing"
    }
  };
  issue.close_evidence_checked = verified();
  assert.deepEqual(auditCloseEvidence(plan(), snapshot).failures, []);
});

// --- the manifest is the thing a lower-tier agent reads -------------------------------------

test("the next batch is decidable from the manifest alone", () => {
  const doc = plan();
  // Batch 0 is the set that starts with nothing to wait for. Stated as the invariant rather than
  // as a frozen list, so closing an issue does not require editing this assertion -- an assertion
  // that has to be edited on every merge stops being read.
  const batchZero = [553, 554, 555, 556, 565, 567, 570, 572, 582, 588];
  const ready = doc.issues.filter((one) => one.status === "ready").map((one) => one.issue).sort((a, b) => a - b);
  const expected = batchZero
    .filter((number) => entry(doc, number).blocked_by.length === 0)
    .filter((number) => entry(doc, number).status !== "done");
  assert.deepEqual(ready, expected);
  assert.ok(ready.length > 0, "the plan has run out of startable work");

  // #556 is the phase case: blocked as an issue, open as a probe. It must never appear as ready.
  assert.equal(ready.includes(556), false);
  const phaseReady = doc.issues
    .filter((one) => one.status !== "ready" && (one.phases ?? []).some((p) => p.status === "ready"))
    .map((one) => one.issue);
  assert.deepEqual(phaseReady, [556]);
});

test("a done issue is closed on GitHub and a not-done issue is open", () => {
  const doc = plan();
  const snapshot = state();
  for (const one of doc.issues) {
    const live = snapshot.issues.find((other) => other.number === one.issue);
    assert.equal(live.state, one.status === "done" ? "closed" : "open", `#${one.issue}`);
  }
  // Every issue already closed carries the record that closed it, checked rather than assumed.
  assert.deepEqual(auditCloseEvidence(doc, snapshot).failures, []);
});

test("the digest is stable and changes when the plan changes", () => {
  const a = planDigest(plan());
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
  assert.equal(a, planDigest(plan()));
  const doc = plan();
  entry(doc, 572).priority = "P1";
  assert.notEqual(a, planDigest(doc));
});

// --- the completion record is read exactly, not interpreted ---------------------------------

test("only a fenced record that names the schema counts as evidence, and the last one wins", async () => {
  const { parseCompletionRecord } = await import("../../lib/github-state.mjs");

  assert.equal(parseCompletionRecord(["Closes #582. Merged in #544."]), null);
  assert.equal(parseCompletionRecord(["```json\n{\"verdict\":\"PASS\"}\n```"]), null);
  assert.equal(parseCompletionRecord(["```\nnot json at all\n```"]), null);

  const first = "```json\n" + JSON.stringify({ schema: "aos-issue-completion.v1", issue: 567, verdict: "HOLD" }) + "\n```";
  const second = "```json\n" + JSON.stringify({ schema: "aos-issue-completion.v1", issue: 567, verdict: "PASS" }) + "\n```";
  assert.equal(parseCompletionRecord([first, second]).verdict, "PASS");
  assert.equal(parseCompletionRecord(["body", first]).verdict, "HOLD");
});

test("the audit summary carries no title, body or path, even when everything is failing", () => {
  // What the command prints is what goes into the release evidence bundle, and the bundle is
  // published. Built here with real failures in it, because a version of this test that asserted an
  // empty failure list was empty would have stayed green while a title was added to the output.
  const doc = plan();
  const snapshot = state();
  const broken = snapshot.issues.find((one) => one.number === 567);
  broken.labels = ["release:v0.2.0", "priority:P0", "area:measurement", "status:done"];
  broken.milestone = 13;
  entry(doc, 559).blocked_by.push(559);

  const summary = auditSummary(doc, snapshot, {
    plan: checkPlan(doc),
    state: checkGithubState(doc, snapshot),
    evidence: auditCloseEvidence(doc, snapshot)
  });

  assert.equal(summary.ok, false);
  assert.ok(summary.failures.length > 0, "the summary should be reporting failures here");
  for (const failure of summary.failures) {
    assert.deepEqual(Object.keys(failure).sort(), ["check", "issue", "lane"]);
  }

  const serialised = JSON.stringify(summary);
  for (const one of snapshot.issues) {
    assert.equal(serialised.includes(one.title), false, `the summary leaked the title of #${one.number}`);
  }
  assert.equal(/\/(Users|home|var|tmp)\//.test(serialised), false, "the summary leaked a path");
  assert.equal(/gh[pousr]_[A-Za-z0-9]/.test(serialised), false, "the summary leaked a token");
  assert.equal(serialised.includes(plan().body_marker) && !summary.ok ? false : true, true);
});

// --- what the final review broke, and what stops it now --------------------------------------

test("the excluded-issue check cannot be switched off from inside the plan", () => {
  const doc = plan();
  doc.excluded_issues = [];
  const report = checkPlan(doc);
  assert.ok(failures(report).includes("excluded-issue-dropped"));
  for (const number of [579, 580, 581]) {
    assert.ok(report.failures.some((one) => one.check === "excluded-issue-dropped" && one.issue === number));
  }
});

test("in-progress and done are constrained by predecessors, not just ready", () => {
  for (const status of ["in-progress", "done", "ready"]) {
    const doc = plan();
    entry(doc, 559).status = status;
    assert.ok(
      failures(checkPlan(doc)).includes("ready-with-unfinished-predecessor"),
      `#559 was allowed to be ${status} while #582 is unfinished`
    );
  }
});

test("a ready issue with a blocked phase is advertised as restricted, never as ready", () => {
  const work = nextWork(plan());
  // #572 may audit stale branches now and may not delete them until #578 has preserved the
  // evidence. Printing "ready now: #572" was an invitation to do the second thing.
  assert.equal(work.ready.includes(572), false);
  const restricted = work.ready_with_blocked_phases.find((one) => one.issue === 572);
  assert.deepEqual(restricted.open_phases, ["read-only-audit"]);
  assert.deepEqual(restricted.withheld_phases, [{ phase: "final-deletion", blocked_by: [578, 588] }]);
});

test("a phase left blocked after its predecessors landed is stale", () => {
  const doc = plan();
  for (const number of [578, 588]) entry(doc, number).status = "done";
  assert.ok(failures(checkPlan(doc)).includes("stale-blocked-phase"));
});

test("a batch that runs behind something it waits on fails", () => {
  const doc = plan();
  entry(doc, 578).batch = 0;
  assert.ok(failures(checkPlan(doc)).includes("batch-out-of-order"));
});

test("an issue cannot both wait on a peer and claim to run beside it", () => {
  const doc = plan();
  entry(doc, 559).allowed_parallel_with.push(582);
  entry(doc, 582).allowed_parallel_with.push(559);
  assert.ok(failures(checkPlan(doc)).includes("parallel-with-dependency"));
});

test("every release-critical issue is behind a gate, and gate names are fixed", () => {
  const doc = plan();
  doc.gates.S = doc.gates.S.filter((number) => number !== 553);
  assert.ok(failures(checkPlan(doc)).includes("release-critical-not-gated"));

  const renamed = plan();
  renamed.gates.Z = renamed.gates.S;
  delete renamed.gates.S;
  assert.ok(failures(checkPlan(renamed)).includes("gate-unknown-name"));
});

// --- the schema validator is sound about the constructs it accepts ---------------------------

test("the schema subset does not silently accept what a schema forbids", () => {
  const check = (schema, value) => validateAgainstSchema(value, schema).ok;

  // `false` is a schema meaning "nothing is allowed here", not an absent one.
  assert.equal(check({ type: "object", properties: { x: false } }, { x: 1 }), false);
  assert.equal(check({ type: "object", properties: { x: true } }, { x: 1 }), true);

  // Draft 2020-12 applies $ref's siblings.
  const withRef = { $defs: { n: { type: "integer" } }, $ref: "#/$defs/n", minimum: 5 };
  assert.equal(check(withRef, 3), false);
  assert.equal(check(withRef, 7), true);

  // Key order is not part of a JSON value's identity.
  assert.equal(check({ type: "array", uniqueItems: true }, [{ a: 1, b: 2 }, { b: 2, a: 1 }]), false);

  // An unsupported keyword is reported, not thrown: a crashed required check reads as
  // infrastructure trouble rather than as the schema saying something we cannot honour.
  const unsupported = validateAgainstSchema(1, { allOf: [{ type: "integer" }] });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.errors[0].message, /unsupported schema keyword "allOf"/);

  // An unresolvable reference fails rather than escaping as an exception.
  assert.equal(check({ $ref: "#/$defs/missing" }, 1), false);
});

// --- the snapshot has to say what it is -------------------------------------------------------

test("a snapshot that does not say what it is cannot be the comparison authority", () => {
  const doc = plan();
  const forged = { ...state(), schema: "anything", repository: "attacker/fork", source: "fabricated", captured_at: "1900-01-01T" };
  const report = checkGithubState(doc, forged);
  const names = report.failures.map((one) => one.check);
  assert.ok(names.includes("snapshot-not-a-snapshot"));
  assert.ok(names.includes("snapshot-wrong-repository"));
  assert.ok(names.includes("snapshot-unknown-source"));
  assert.ok(names.includes("snapshot-undated"));
});

test("the committed snapshot says it is a snapshot, so an offline run cannot read as a live audit", () => {
  assert.equal(state().source, "snapshot");
});

test("two contradictory status labels do not pass", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 559);
  issue.labels = [...issue.labels, "status:ready"];
  assert.ok(checkGithubState(plan(), snapshot).failures.some((one) => one.check === "status-label-mismatch"));
});

test("closed as not planned is not closed as done", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 588);
  issue.state_reason = "not_planned";
  assert.ok(checkGithubState(plan(), snapshot).failures.some((one) => one.check === "closed-not-planned"));
});

// --- a completion record is checked against the repository, not read ---------------------------

test("a record the repository does not confirm is not evidence", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 588);
  issue.close_evidence_checked = { commit_exists: true, commit_on_integration_branch: false, pr_merged: true, pr_closes_issue: true, ci_runs_succeeded: true, verified: false };
  const report = auditCloseEvidence(plan(), snapshot);
  assert.ok(report.failures.some((one) => one.check === "close-evidence-unverified" && one.issue === 588));
});

test("a record nobody ever checked is not evidence either", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 588).close_evidence_checked = null;
  assert.ok(auditCloseEvidence(plan(), snapshot).failures.some((one) => one.check === "close-evidence-unchecked"));
});

test("the shipped snapshot's own record was checked against the repository and holds", () => {
  const issue = state().issues.find((one) => one.number === 588);
  assert.equal(issue.state, "closed");
  assert.equal(issue.close_evidence.verdict, "PASS");
  assert.equal(issue.close_evidence.author_trusted, true);
  assert.deepEqual(issue.close_evidence_checked, verified());
});

test("a record from someone without write access is not an attestation", async () => {
  const { parseCompletionRecord } = await import("../../lib/github-state.mjs");
  const block = (verdict) => "```json\n" + JSON.stringify({ schema: "aos-issue-completion.v1", issue: 567, verdict }) + "\n```";

  const outsider = parseCompletionRecord([{ body: block("PASS"), author_trusted: false, author: "drive-by" }]);
  assert.equal(outsider.author_trusted, false);

  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 588);
  issue.close_evidence = { ...issue.close_evidence, author_trusted: false, author: "drive-by" };
  assert.ok(auditCloseEvidence(plan(), snapshot).failures.some((one) => one.check === "close-evidence-untrusted-author"));
});

test("an outsider cannot overwrite a maintainer's record, and the attempt is recorded", async () => {
  const { parseCompletionRecord } = await import("../../lib/github-state.mjs");
  const block = (verdict) => "```json\n" + JSON.stringify({ schema: "aos-issue-completion.v1", issue: 567, verdict }) + "\n```";

  const held = parseCompletionRecord([
    { body: block("HOLD"), author_trusted: true, author: "maintainer" },
    { body: block("PASS"), author_trusted: false, author: "drive-by" }
  ]);
  assert.equal(held.verdict, "HOLD");
  assert.equal(held.contested_by, "drive-by");

  // A maintainer's correction after a maintainer's pass does still supersede it.
  const corrected = parseCompletionRecord([
    { body: block("PASS"), author_trusted: true, author: "maintainer" },
    { body: block("HOLD"), author_trusted: true, author: "reviewer" }
  ]);
  assert.equal(corrected.verdict, "HOLD");
});

// --- the cycle diagnostic names every edge someone would have to remove ---------------------

test("every elementary cycle is reported, once each", () => {
  const doc = plan();
  // Three issues that all wait on each other. A depth-first search with one shared visited set
  // finds only some of these, and the one it drops is the edge the reader has to remove.
  entry(doc, 553).blocked_by = [554, 555];
  entry(doc, 554).blocked_by = [553, 555];
  entry(doc, 555).blocked_by = [553, 554];
  for (const number of [553, 554, 555]) entry(doc, number).status = "blocked";

  const reported = checkPlan(doc)
    .failures.filter((one) => one.check === "dependency-cycle")
    .map((one) => one.detail);

  // Six elementary cycles: three of length two, two of length three, and each named once.
  const canonical = (detail) => detail.replace(/#/g, "");
  assert.equal(reported.length, 5, reported.join(" | "));
  for (const expected of ["553 -> 554 -> 553", "553 -> 555 -> 553", "554 -> 555 -> 554"]) {
    assert.ok(reported.some((one) => canonical(one) === expected), `missing ${expected}: ${reported.join(" | ")}`);
  }
  assert.equal(new Set(reported).size, reported.length, "a cycle was reported twice");
});

// --- round two: the confirmation is one claim, not several true-but-unrelated ones -----------

test("three separately true facts are not a confirmation", async () => {
  const { verifyCompletionRecord } = await import("../../lib/github-state.mjs");
  const record = { issue: 588, final_sha: "a".repeat(40), pr: 589, ci_run_ids: [1] };

  // Everything the old version asked for, all of it real, none of it about the same work: an old
  // commit that happens to be on dev, a merged PR that happens to close the issue, a successful
  // run that happens to exist.
  const unrelated = async (path) => {
    if (path.includes("/commits/")) return { body: { sha: record.final_sha } };
    if (path.includes("/compare/")) return { body: { status: "ahead" } };
    if (path.includes("/pulls/")) {
      return { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "dev" }, head: { sha: "b".repeat(40) }, merge_commit_sha: "c".repeat(40), body: "Closes #588" } };
    }
    return { body: { conclusion: "success", head_sha: "d".repeat(40) } };
  };
  const loose = await verifyCompletionRecord("o/r", record, { get: unrelated });
  assert.equal(loose.verified, false);
  assert.equal(loose.pr_produced_the_commit, false);
  assert.equal(loose.ci_runs_ran_on_this_work, false);
  assert.equal(loose.commit_on_integration_branch, true, "the parts really are individually true");

  // The same shape, actually bound together.
  const bound = async (path) => {
    if (path.includes("/commits/")) return { body: { sha: record.final_sha } };
    if (path.includes("/compare/")) return { body: { status: "ahead" } };
    if (path.includes("/pulls/")) {
      return { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "dev" }, head: { sha: "b".repeat(40) }, merge_commit_sha: record.final_sha, body: "Closes #588" } };
    }
    return { body: { conclusion: "success", head_sha: "b".repeat(40) } };
  };
  assert.equal((await verifyCompletionRecord("o/r", record, { get: bound })).verified, true);

  // And a pull request aimed somewhere other than the branch that ships is not it either.
  const elsewhere = async (path) =>
    path.includes("/pulls/")
      ? { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "someone-elses-branch" }, head: { sha: "b".repeat(40) }, merge_commit_sha: record.final_sha, body: "Closes #588" } }
      : bound(path);
  assert.equal((await verifyCompletionRecord("o/r", record, { get: elsewhere })).verified, false);
});

test("a one-key forgery of the whole audit does not pass", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 588).close_evidence_checked = { verified: true };
  assert.ok(auditCloseEvidence(plan(), snapshot).failures.some((one) => one.check === "close-evidence-unverified"));

  const partial = state();
  partial.issues.find((one) => one.number === 588).close_evidence_checked = { ...verified(), pr_produced_the_commit: false };
  assert.ok(auditCloseEvidence(plan(), partial).failures.some((one) => one.check === "close-evidence-unverified"));
});

test("an omitted author_trusted is not a trusted author", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 588);
  delete issue.close_evidence.author_trusted;
  assert.ok(auditCloseEvidence(plan(), snapshot).failures.some((one) => one.check === "close-evidence-untrusted-author"));
});

test("an empty array is not a digest and false is not a count", () => {
  for (const value of [[], {}, false, 0, "", "   ", null]) {
    const snapshot = state();
    const issue = snapshot.issues.find((one) => one.number === 588);
    issue.close_evidence = { ...issue.close_evidence, evidence: { ...issue.close_evidence.evidence, manifest_digest: value } };
    assert.ok(
      auditCloseEvidence(plan(), snapshot).failures.some((one) => one.check === "close-evidence-field-missing"),
      `${JSON.stringify(value)} was accepted as evidence`
    );
  }
});

test("write access is asked of the repository, not inferred from an association", async () => {
  const { hasWriteAccess } = await import("../../lib/github-state.mjs");
  const withRole = (permission) => async () => ({ body: { permission } });
  assert.equal(await hasWriteAccess("o/r", "a", { get: withRole("admin") }), true);
  assert.equal(await hasWriteAccess("o/r", "a", { get: withRole("write") }), true);
  assert.equal(await hasWriteAccess("o/r", "a", { get: withRole("maintain") }), true);
  // A collaborator with the read or triage role would have attested to completed work.
  assert.equal(await hasWriteAccess("o/r", "a", { get: withRole("triage") }), false);
  assert.equal(await hasWriteAccess("o/r", "a", { get: withRole("read") }), false);
  // "Could not establish" is not "has it".
  assert.equal(await hasWriteAccess("o/r", "a", { get: async () => { throw new Error("403"); } }), false);
  assert.equal(await hasWriteAccess("o/r", null, { get: withRole("admin") }), false);
});

test("comments are read until GitHub says there is no next page", async () => {
  const { requestAll } = await import("../../lib/github-state.mjs");
  const pages = { 1: [1, 2], 2: [3, 4], 3: [5] };
  let asked = 0;
  const get = async (path) => {
    asked += 1;
    const page = Number(/[?&]page=(\d+)/.exec(path)[1]);
    return {
      body: pages[page] ?? [],
      link: pages[page + 1] ? `<https://api.github.com/x?page=${page + 1}>; rel="next"` : null
    };
  };
  // Three pages, not a fixed bound: a correction posted after the bound would never be read.
  assert.deepEqual(await requestAll("/x", null, get), [1, 2, 3, 4, 5]);
  assert.equal(asked, 3);
});

// --- round two: the snapshot's provenance, not just its shape --------------------------------

test("an offline snapshot cannot claim to be a live audit, or to be about another branch", () => {
  const doc = plan();
  const stamped = { ...state(), source: "live" };
  assert.ok(checkGithubState(doc, stamped).failures.some((one) => one.check === "snapshot-source-mismatch"));
  assert.deepEqual(checkGithubState(doc, stamped, { expectedSource: "live" }).failures, []);

  const elsewhere = { ...state(), integration_branch: "attacker" };
  assert.ok(checkGithubState(doc, elsewhere).failures.some((one) => one.check === "snapshot-wrong-branch"));

  for (const when of ["0", "1900-01-01", "yesterday", 0]) {
    assert.ok(
      checkGithubState(doc, { ...state(), captured_at: when }).failures.some((one) => one.check === "snapshot-undated"),
      `${JSON.stringify(when)} was accepted as a capture time`
    );
  }
});

test("an excluded issue missing from the snapshot is not a pass", () => {
  const snapshot = state();
  snapshot.issues = snapshot.issues.filter((one) => ![579, 580, 581].includes(one.number));
  const failed = checkGithubState(plan(), snapshot).failures.filter((one) => one.check === "excluded-issue-not-in-snapshot");
  assert.deepEqual(failed.map((one) => one.issue).sort((a, b) => a - b), [579, 580, 581]);
});

test("a done issue closed as a duplicate is not a done issue", () => {
  for (const reason of ["duplicate", "not_planned", null, "reopened"]) {
    const snapshot = state();
    snapshot.issues.find((one) => one.number === 588).state_reason = reason;
    assert.ok(
      checkGithubState(plan(), snapshot).failures.some((one) => one.check === "closed-not-planned"),
      `${reason} was accepted as completion`
    );
  }
});

// --- round two: done means done, gates exist, and the validator handles characters -------------

test("an issue is not done while one of its phases is withheld", () => {
  const doc = plan();
  // #572's withheld phase is the one that deletes branches, and it waits on #578.
  entry(doc, 572).status = "done";
  assert.ok(failures(checkPlan(doc)).includes("done-with-unfinished-phase"));
});

test("a gate cannot be deleted by folding its issues into another one", () => {
  const doc = plan();
  doc.gates.S = [...doc.gates.S, ...doc.gates.X];
  delete doc.gates.X;
  assert.ok(failures(checkPlan(doc)).includes("gate-missing"));
});

test("string length is counted in characters and patterns are matched in unicode mode", () => {
  const emoji = "\u{1F600}";
  assert.equal(validateAgainstSchema(emoji, { type: "string", minLength: 2 }).ok, false);
  assert.equal(validateAgainstSchema(emoji, { type: "string", maxLength: 1 }).ok, true);
  assert.equal(validateAgainstSchema(emoji, { type: "string", pattern: "^..$" }).ok, false);
  assert.equal(validateAgainstSchema(emoji, { type: "string", pattern: "^.$" }).ok, true);
});

test("the cycle report is bounded, so a dense graph fails rather than hangs", () => {
  const doc = plan();
  // Everything waits on everything. The elementary cycles of a complete graph on thirty-two nodes
  // outnumber anything worth enumerating; the answer needed is "this is cyclic, and here is where".
  const numbers = doc.issues.map((one) => one.issue);
  for (const one of doc.issues) {
    one.blocked_by = numbers.filter((number) => number !== one.issue);
    one.blocks = numbers.filter((number) => number !== one.issue);
  }
  const started = Date.now();
  const reported = checkPlan(doc).failures.filter((one) => one.check === "dependency-cycle");
  assert.ok(Date.now() - started < 10_000, "the cycle search did not finish quickly");
  assert.equal(reported.length, MAX_REPORTED_CYCLES);
});

test("the published summary keeps the key names its schema version promised", () => {
  const doc = plan();
  const snapshot = state();
  const summary = auditSummary(doc, snapshot, {
    plan: checkPlan(doc),
    state: checkGithubState(doc, snapshot),
    evidence: auditCloseEvidence(doc, snapshot)
  });
  assert.equal(summary.schema, "aos-execution-audit.v1");
  assert.deepEqual(Object.keys(summary.counts).sort(), ["blocked", "done", "in_progress", "ready", "tracking"]);
  assert.equal(summary.counts.in_progress, 0);
});
