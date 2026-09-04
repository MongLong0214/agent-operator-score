import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  CANONICAL_ISSUE_COUNT,
  EVIDENCE_CONTRACT,
  EXCLUDED_ISSUES,
  isRealInstant,
  auditCloseEvidence,
  auditSummary,
  checkGithubState,
  checkPlan,
  loadPlan,
  loadSchema,
  nextWork,
  MAX_REPORTED_CYCLES,
  NOT_CHECKED,
  REQUIRED_CONFIRMATIONS,
  planDigest,
  validateAgainstSchema
} from "../../lib/execution-plan.mjs";

const plan = () => loadPlan();
const clone = (value) => JSON.parse(JSON.stringify(value));
const entry = (doc, issue) => doc.issues.find((one) => one.issue === issue);
const failures = (report) => report.failures.map((one) => one.check);

// A snapshot the live path will accept. `{live: true}` alone is a caller's claim; the file has to
// agree, which is the point of the check being tested here.
const asLive = (snapshot) => ({ ...snapshot, source: "live" });

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

// Several tests need an issue that is still blocked behind unfinished work. #559 was that example
// until #582 and #588 were done and it became ready; the plan moves, so the example is taken from
// whatever it says today rather than from a number that was true when the test was written.
const blockedBehindUnfinished = (doc) => {
  const done = new Set(doc.issues.filter((one) => one.status === "done").map((one) => one.issue));
  const one = doc.issues.find((each) => each.status === "blocked" && each.blocked_by.some((number) => !done.has(number)));
  assert.ok(one, "the plan has no blocked issue left to serve as the example");
  return one;
};

test("a ready issue with an unfinished predecessor fails", () => {
  const doc = plan();
  blockedBehindUnfinished(doc).status = "ready";
  assert.ok(failures(checkPlan(doc)).includes("ready-with-unfinished-predecessor"));
});

test("a blocked issue whose predecessors all passed is stale and fails", () => {
  const doc = plan();
  for (const number of blockedBehindUnfinished(doc).blocked_by) entry(doc, number).status = "done";
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

// #556 was the shipped example of a blocked issue with one ready phase until its predecessors
// (#554, #555, #588) were all done, at which point the plan had to say it was ready. The rules these
// tests exercise are about the blocked state, so they put #556 back into it rather than depend on
// which day the plan is read.
const withFeasibilityBlocked = (doc) => {
  const feasibility = entry(doc, 556);
  feasibility.status = "blocked";
  feasibility.phases.find((one) => one.id === "final-integration").status = "blocked";
  return doc;
};

test("phase-ready is separate from issue ready", () => {
  const doc = plan();
  const done = new Set(doc.issues.filter((one) => one.status === "done").map((one) => one.issue));
  // Stated over every phased issue rather than over #556, which used to be the only one and has
  // since finished -- an assertion pinned to one issue's current status stops being true the moment
  // that issue advances, which is exactly when it should still be checked.
  const phased = doc.issues.filter((one) => (one.phases ?? []).length > 0);
  assert.ok(phased.length > 0, "the plan has no phased issue left to check");
  for (const one of phased) {
    const unblocked = one.blocked_by.every((number) => done.has(number));
    if (one.status === "done") {
      // Terminal: a finished issue's phases are finished too, including the integrating one.
      for (const phase of one.phases) assert.equal(phase.status, "done", `#${one.issue} phase ${phase.id}`);
      continue;
    }
    for (const phase of one.phases) {
      // A non-integrating phase may open on its own; an integrating one opens only with the issue.
      if (!phase.code_integration_allowed) continue;
      const phaseUnblocked = (phase.blocked_by ?? []).every((number) => done.has(number));
      assert.equal(phase.status, unblocked && phaseUnblocked ? "ready" : "blocked", `#${one.issue} ${phase.id}`);
    }
  }
});

test("a phase-ready phase that claims final integration exceeds its scope and fails", () => {
  const doc = withFeasibilityBlocked(plan());
  entry(doc, 556).phases.find((one) => one.id === "feasibility-proof").code_integration_allowed = true;
  assert.ok(failures(checkPlan(doc)).includes("phase-scope-exceeded"));
});

test("a finished code-integrating phase on a finished issue is the terminal state, not a scope violation", () => {
  // The rule read `STARTED`, which contains `done`, so an issue carrying a code-integrating phase
  // could never be recorded as finished: the phase reaches done, the issue reaches done, and the
  // check fired forever. #556 was the first such issue to complete and it could not be written down.
  const doc = plan();
  const one = entry(doc, 556);
  one.status = "done";
  for (const phase of one.phases) phase.status = "done";
  assert.ok(!failures(checkPlan(doc)).includes("phase-scope-exceeded"));
});

test("a running code-integrating phase on a finished issue still exceeds its scope", () => {
  const doc = plan();
  const one = entry(doc, 556);
  one.status = "done";
  const integration = one.phases.find((phase) => phase.code_integration_allowed);
  integration.status = "in-progress";
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
  const example = blockedBehindUnfinished(plan());
  const issue = snapshot.issues.find((one) => one.number === example.issue);
  issue.labels = issue.labels.map((label) => (label === "status:blocked" ? "status:ready" : label));
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
  // Any issue the plan still holds open; #570 was the example until it was done.
  const open = plan().issues.find((one) => one.status !== "done" && one.kind !== "epic");
  snapshot.issues.find((one) => one.number === open.issue).state = "closed";
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
  const report = auditCloseEvidence(plan(), asLive(snapshot), { live: true });
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
  assert.ok(auditCloseEvidence(plan(), asLive(snapshot), { live: true }).failures.some((one) => one.check === "close-evidence-incomplete"));

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
  assert.ok(auditCloseEvidence(plan(), asLive(held), { live: true }).failures.some((one) => one.check === "close-evidence-not-pass"));
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
  const report = auditCloseEvidence(plan(), asLive(snapshot), { live: true });
  assert.ok(report.failures.some((one) => one.check === "close-evidence-field-missing"));
});

test("a completion record with every part present and confirmed raises no audit failure", () => {
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
  assert.deepEqual(auditCloseEvidence(plan(), asLive(snapshot), { live: true }).failures, []);
});

// --- the manifest is the thing a lower-tier agent reads -------------------------------------

test("the next batch is decidable from the manifest alone", () => {
  const doc = plan();
  // Ready is exactly the set whose predecessors are all done and that is not done itself. Stated as
  // the invariant rather than as a frozen list, so closing an issue does not require editing this
  // assertion -- an assertion that has to be edited on every merge stops being read. The earlier
  // form enumerated batch 0, which was the same set until the first batch-1 issue came due.
  const done = new Set(doc.issues.filter((one) => one.status === "done").map((one) => one.issue));
  const ready = doc.issues.filter((one) => one.status === "ready").map((one) => one.issue).sort((a, b) => a - b);
  const expected = doc.issues
    .filter((one) => one.kind !== "epic" && one.status !== "done" && one.blocked_by.every((number) => done.has(number)))
    .map((one) => one.issue)
    .sort((a, b) => a - b);
  assert.deepEqual(ready, expected);
  assert.ok(ready.length > 0, "the plan has run out of startable work");
  // And batch 0 is the set that started with nothing to wait for: every one of them is done or ready.
  for (const one of doc.issues.filter((one) => one.batch === 0 && one.blocked_by.length === 0)) {
    assert.ok(one.status === "done" || one.status === "ready", `#${one.issue} is batch 0 and ${one.status}`);
  }

  // The phase case, stated as the property rather than as one issue's number: an issue that is
  // startable only through a phase is one that is not itself ready while carrying a ready phase, and
  // every such issue must still be waiting on a predecessor. Naming #556 here made this assertion
  // false the day #556 finished.
  const phaseOnly = doc.issues
    .filter((one) => one.status !== "ready" && (one.phases ?? []).some((phase) => phase.status === "ready"))
    .map((one) => one.issue);
  for (const number of phaseOnly) {
    const one = entry(doc, number);
    assert.notEqual(one.status, "done", `#${number} is done yet carries a ready phase`);
    assert.ok(!one.blocked_by.every((each) => done.has(each)), `#${number} is startable as itself, so it is not phase-only`);
  }
});

test("a done issue is closed on GitHub and a not-done issue is open", () => {
  const doc = plan();
  const snapshot = state();
  for (const one of doc.issues) {
    const live = snapshot.issues.find((other) => other.number === one.issue);
    assert.equal(live.state, one.status === "done" ? "closed" : "open", `#${one.issue}`);
  }
  // Every issue already closed carries the record that closed it, checked rather than assumed.
  assert.deepEqual(auditCloseEvidence(doc, asLive(snapshot), { live: true }).failures, []);
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

test("only a fenced record that names the schema counts, and a later trusted one supersedes an earlier", async () => {
  const { parseCompletionRecord } = await import("../../lib/github-state.mjs");

  assert.equal(parseCompletionRecord(["Closes #582. Merged in #544."]), null);
  assert.equal(parseCompletionRecord(["```json\n{\"verdict\":\"PASS\"}\n```"]), null);
  assert.equal(parseCompletionRecord(["```\nnot json at all\n```"]), null);

  const first = "```json\n" + JSON.stringify({ schema: "aos-issue-completion.v1", issue: 567, verdict: "HOLD" }) + "\n```";
  const second = "```json\n" + JSON.stringify({ schema: "aos-issue-completion.v1", issue: 567, verdict: "PASS" }) + "\n```";
  assert.equal(parseCompletionRecord([first, second]).verdict, "PASS");
  assert.equal(parseCompletionRecord(["body", first]).verdict, "HOLD");
});

test("the audit summary carries no issue title, and no absolute path or token in the forms this repository produces", () => {
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
    evidence: auditCloseEvidence(doc, asLive(snapshot), { live: true })
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
    const one = blockedBehindUnfinished(doc);
    one.status = status;
    assert.ok(
      failures(checkPlan(doc)).includes("ready-with-unfinished-predecessor"),
      `#${one.issue} was allowed to be ${status} while a predecessor is unfinished`
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

test("a phase blocked by a number outside the plan is refused like an issue would be", () => {
  const doc = plan();
  entry(doc, 572).phases[1].blocked_by = [999, 588];
  const report = checkPlan(doc);
  assert.ok(failures(report).includes("unknown-dependency"));
  assert.match(report.failures.find((one) => one.check === "unknown-dependency").detail, /phase "final-deletion".*#999/);
  // The counterfactual: the same phase naming only planned issues is not an unknown dependency.
  entry(doc, 572).phases[1].blocked_by = [578, 588];
  assert.equal(failures(checkPlan(doc)).includes("unknown-dependency"), false);
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

test("every release-critical issue except the epic is behind a gate, and the nine gate names are fixed", () => {
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
  const issue = snapshot.issues.find((one) => one.number === blockedBehindUnfinished(plan()).issue);
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
  const report = auditCloseEvidence(plan(), asLive(snapshot), { live: true });
  assert.ok(report.failures.some((one) => one.check === "close-evidence-unverified" && one.issue === 588));
});

test("a record nobody ever checked is not evidence either", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 588).close_evidence_checked = null;
  assert.ok(auditCloseEvidence(plan(), asLive(snapshot), { live: true }).failures.some((one) => one.check === "close-evidence-unchecked"));
});

test("the shipped snapshot records a live confirmation of every component, not a summary", async () => {
  // This asserts what the fixture *contains*, which is all a committed file can be asked. What it
  // does not do -- and its earlier name implied it did -- is re-establish those booleans; only a
  // live run does that, which is why the offline audit refuses to assert them at all.
  const issue = state().issues.find((one) => one.number === 588);
  assert.equal(issue.state, "closed");
  assert.equal(issue.close_evidence.verdict, "PASS");
  assert.equal(issue.close_evidence.author_trusted, true);

  // Every component, individually, and `=== true` rather than truthy. That distinction is the
  // point of the record now carrying three states: `NOT_CHECKED` is a non-empty string, so a
  // truthy test would read "nobody could ask" as a confirmation -- which is the shape of the
  // defect this whole file exists to refuse.
  for (const key of REQUIRED_CONFIRMATIONS) {
    assert.equal(issue.close_evidence_checked[key], true, `${key} is not confirmed in the shipped snapshot`);
  }
  assert.equal(issue.close_evidence_checked.verified, true);

  // And no key the live verifier does not write. Asked *of the verifier* rather than restated
  // here, because this assertion used to pin an exact key set: the documented way to refresh this
  // fixture is `--write-snapshot`, that writes whatever the verifier returns, and the moment the
  // record gained `resolution` and `unresolved` the refresh produced a file this very test
  // rejected -- turning the required `test` and `execution-plan` checks red on whoever next
  // refreshed a governance fixture, for a change they did not make. A subset rather than an
  // equality, so a snapshot captured before a widening still reads; what stays forbidden is a
  // confirmation nobody named, which would be a fact the audit never established.
  const { verifyCompletionRecord } = await import("../../lib/github-state.mjs");
  const refuse = async () => { const error = new Error("404"); error.status = 404; throw error; };
  const written = new Set(Object.keys(await verifyCompletionRecord("o/r", { issue: 588, final_sha: "a".repeat(40), pr: 1, ci_run_ids: [1] }, { get: refuse })));
  const unknown = Object.keys(issue.close_evidence_checked).filter((key) => !written.has(key));
  assert.deepEqual(unknown, [], `the snapshot carries ${unknown.join(", ")}, which no live run writes`);
});

test("a record from someone without write access is not an attestation", async () => {
  const { parseCompletionRecord } = await import("../../lib/github-state.mjs");
  const block = (verdict) => "```json\n" + JSON.stringify({ schema: "aos-issue-completion.v1", issue: 567, verdict }) + "\n```";

  const outsider = parseCompletionRecord([{ body: block("PASS"), author_trusted: false, author: "drive-by" }]);
  assert.equal(outsider.author_trusted, false);

  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 588);
  issue.close_evidence = { ...issue.close_evidence, author_trusted: false, author: "drive-by" };
  assert.ok(auditCloseEvidence(plan(), asLive(snapshot), { live: true }).failures.some((one) => one.check === "close-evidence-untrusted-author"));
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

test("the two-cycles a shared visited set used to drop are each reported once", () => {
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

  // Five elementary cycles: three of length two and two of length three. The three two-cycles are
  // named explicitly because those are the ones a single shared visited set used to drop.
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
  const record = { issue: 588, final_sha: "a".repeat(40), pr: 589, ci_run_ids: [1], evidence: { d: "sha256:" + "0".repeat(64) } };
  const owner = { issue: 588, owned_paths: ["lib/"], evidence_bindings: {} };

  // Everything the old version asked for, all of it real, none of it about the same work: an old
  // commit that happens to be on dev, a merged PR that happens to close the issue, a successful
  // run that happens to exist.
  const unrelated = async (path) => {
    if (path.includes("/files")) return { body: [{ filename: "lib/execution-plan.mjs" }], link: null };
    if (path.includes("/commits/")) return { body: { sha: record.final_sha } };
    if (path.includes("/compare/")) return { body: { status: "ahead" } };
    if (path.includes("/pulls/")) {
      return { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "dev" }, head: { sha: "b".repeat(40) }, merge_commit_sha: "c".repeat(40), body: "Closes #588" } };
    }
    return { body: { conclusion: "success", head_sha: "d".repeat(40) } };
  };
  const loose = await verifyCompletionRecord("o/r", record, { get: unrelated, issue: owner });
  assert.equal(loose.verified, false);
  assert.equal(loose.pr_produced_the_commit, false);
  assert.equal(loose.ci_runs_ran_on_this_work, false);
  // The parts really are individually true -- that is the whole point of the case.
  for (const part of ["commit_exists", "commit_on_integration_branch", "pr_merged", "pr_targets_integration_branch", "pr_closes_issue", "ci_runs_succeeded"]) {
    assert.equal(loose[part], true, `${part} should be independently true in this fixture`);
  }

  // The same shape, actually bound together.
  const bound = async (path) => {
    if (path.includes("/files")) return { body: [{ filename: "lib/execution-plan.mjs" }], link: null };
    if (path.includes("/commits/")) return { body: { sha: record.final_sha } };
    if (path.includes("/compare/")) return { body: { status: "ahead" } };
    if (path.includes("/pulls/")) {
      return { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "dev" }, head: { sha: "b".repeat(40) }, merge_commit_sha: record.final_sha, body: "Closes #588" } };
    }
    return { body: { conclusion: "success", head_sha: "b".repeat(40) } };
  };
  assert.equal((await verifyCompletionRecord("o/r", record, { get: bound, issue: owner })).verified, true);

  // And a pull request aimed somewhere other than the branch that ships is not it either.
  const elsewhere = async (path) =>
    path.includes("/pulls/")
      ? { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "someone-elses-branch" }, head: { sha: "b".repeat(40) }, merge_commit_sha: record.final_sha, body: "Closes #588" } }
      : bound(path);
  assert.equal((await verifyCompletionRecord("o/r", record, { get: elsewhere, issue: owner })).verified, false);

  // And a pull request that changed nothing this issue owns did not implement it, however green
  // everything else is. This is the documentation-PR close, reproduced at the source.
  const docsOnly = async (path) =>
    path.includes("/files") ? { body: [{ filename: "README.md" }], link: null } : bound(path);
  const noWork = await verifyCompletionRecord("o/r", record, { get: docsOnly, issue: owner });
  assert.equal(noWork.pr_changed_owned_files, false);
  assert.equal(noWork.verified, false);

  // And evidence that quotes a digest of something else is not evidence about this revision.
  const withBinding = { ...owner, evidence_bindings: { d: "governance/thing.json" } };
  const wrongDigest = async (path) =>
    path.includes("/contents/") ? { body: { content: Buffer.from("different bytes").toString("base64"), encoding: "base64" } } : bound(path);
  const stale = await verifyCompletionRecord("o/r", record, { get: wrongDigest, issue: withBinding });
  assert.equal(stale.evidence_digests_match, false);
  assert.equal(stale.verified, false);
});

test("a one-key forgery of the whole audit does not pass", () => {
  const snapshot = state();
  snapshot.issues.find((one) => one.number === 588).close_evidence_checked = { verified: true };
  assert.ok(auditCloseEvidence(plan(), asLive(snapshot), { live: true }).failures.some((one) => one.check === "close-evidence-unverified"));

  const partial = state();
  partial.issues.find((one) => one.number === 588).close_evidence_checked = { ...verified(), pr_produced_the_commit: false };
  assert.ok(auditCloseEvidence(plan(), asLive(partial), { live: true }).failures.some((one) => one.check === "close-evidence-unverified"));
});

test("an omitted author_trusted is not a trusted author", () => {
  const snapshot = state();
  const issue = snapshot.issues.find((one) => one.number === 588);
  delete issue.close_evidence.author_trusted;
  assert.ok(auditCloseEvidence(plan(), asLive(snapshot), { live: true }).failures.some((one) => one.check === "close-evidence-untrusted-author"));
});

test("an empty array is not a digest and false is not a count", () => {
  for (const [field, value] of [
    ["manifest_digest", []], ["manifest_digest", {}], ["manifest_digest", false], ["manifest_digest", ""],
    ["manifest_digest", "   "], ["manifest_digest", null],
    ["canonical_issue_count", false], ["canonical_issue_count", 0], ["canonical_issue_count", []]
  ]) {
    const snapshot = state();
    const issue = snapshot.issues.find((one) => one.number === 588);
    issue.close_evidence = { ...issue.close_evidence, evidence: { ...issue.close_evidence.evidence, [field]: value } };
    assert.ok(
      auditCloseEvidence(plan(), asLive(snapshot), { live: true }).failures.some((one) => one.check === "close-evidence-field-missing"),
      `${field}=${JSON.stringify(value)} was accepted as evidence`
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

test("comments are read until GitHub says there is no next page, and a runaway is refused", async () => {
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

  // A source that never stops is a failure, not a truncation: returning what fitted would be the
  // fixed-bound behaviour this replaced.
  const endless = async () => ({ body: [1], link: '<https://api.github.com/x?page=2>; rel="next"' });
  await assert.rejects(() => requestAll("/x", null, endless), /more pages than this audit will read/);
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
    evidence: auditCloseEvidence(doc, asLive(snapshot), { live: true })
  });
  assert.equal(summary.schema, "aos-execution-audit.v1");
  assert.deepEqual(Object.keys(summary.counts).sort(), ["blocked", "done", "in_progress", "ready", "tracking"]);
  assert.equal(summary.counts.in_progress, 0);
});

// --- round three: the offline audit does not get to assert a pass ---------------------------

test("offline, close evidence is reported as unestablished and never as a failure", () => {
  const doc = plan();
  const snapshot = state();
  // The confirmations live in a file the author of the change controls. A contributor who cannot
  // pass the live write-access check can still edit the fixture in their own pull request and set
  // every boolean to true, so an offline run must not say it established anything.
  const offline = auditCloseEvidence(doc, snapshot);
  assert.equal(offline.established, false);
  // Every issue the plan marks done, not a fixed list: the set grows by one each time an issue
  // lands, and a test pinned to #588 alone would fail on the first honest refresh.
  const closed = doc.issues.filter((one) => one.status === "done").map((one) => one.issue).sort((x, y) => x - y);
  assert.ok(closed.includes(588));
  assert.deepEqual(offline.unestablished, closed.map((issue) => ({ issue, reason: "close evidence is only established by a live audit" })));
  assert.deepEqual(offline.failures, []);

  const forged = state();
  const issue = forged.issues.find((one) => one.number === 588);
  issue.close_evidence = { ...issue.close_evidence, verdict: "HOLD" };
  issue.close_evidence_checked = { verified: true };
  // Offline says nothing about it either way; live is where it fails.
  assert.deepEqual(auditCloseEvidence(doc, forged).failures, []);
  assert.equal(auditCloseEvidence(doc, asLive(forged), { live: true }).ok, false);

  const established = auditCloseEvidence(doc, asLive(snapshot), { live: true });
  assert.equal(established.established, true);
  assert.deepEqual(established.unestablished, []);
});

test("the manifest edits that used to weaken a gate now fail", () => {
  // The whole bypass in one edit: mark it done, drop the phases, drop the evidence requirement.
  const doc = plan();
  const one = entry(doc, 572);
  one.status = "done";
  one.phases = [];
  one.close_evidence_required = false;
  one.required_evidence_fields = [];
  const names = failures(checkPlan(doc));
  assert.ok(names.includes("release-critical-needs-close-evidence"));
  assert.ok(names.includes("close-evidence-fields-empty"));
  assert.ok(names.includes("phases-do-not-match-contract"));

  // Each half fails on its own, so no single edit gets through either.
  for (const edit of [
    (d) => { entry(d, 553).close_evidence_required = false; },
    (d) => { entry(d, 553).required_evidence_fields = []; },
    (d) => { entry(d, 553).owned_paths = []; },
    (d) => { entry(d, 556).phases = []; }
  ]) {
    const doc2 = plan();
    edit(doc2);
    assert.equal(checkPlan(doc2).ok, false);
  }
});

test("an evidence binding must name a field the issue actually requires", () => {
  const doc = plan();
  entry(doc, 553).evidence_bindings = { not_a_field: "lib/verifier-run.mjs" };
  assert.ok(failures(checkPlan(doc)).includes("evidence-binding-unknown-field"));
});

test("the excluded list is exactly the contract's three, in both directions", () => {
  const dropped = plan();
  dropped.excluded_issues = [579, 580];
  assert.ok(failures(checkPlan(dropped)).includes("excluded-issue-dropped"));

  // An invented exclusion was a number nobody ever checked: the plan named it and the state check
  // looked only at the constants.
  const invented = plan();
  invented.excluded_issues = [...invented.excluded_issues, 999999];
  assert.ok(failures(checkPlan(invented)).includes("excluded-issue-invented"));
});

// --- round three: the search terminates on inputs it exists to reject ------------------------

test("a dense acyclic graph finishes quickly instead of exploring every path", () => {
  const doc = plan();
  // Zero cycles, exponentially many simple paths. The previous bound counted cycles, so it never
  // triggered here and the check hung on a graph whose answer is "nothing wrong".
  const numbers = doc.issues.map((one) => one.issue);
  for (const one of doc.issues) {
    one.blocked_by = numbers.filter((number) => number > one.issue);
    one.blocks = numbers.filter((number) => number < one.issue);
  }
  const started = Date.now();
  const report = checkPlan(doc);
  assert.ok(Date.now() - started < 5000, "the cycle search did not finish quickly on an acyclic graph");
  assert.equal(report.failures.filter((one) => one.check === "dependency-cycle").length, 0);
  assert.equal(report.failures.some((one) => one.check === "cycle-search-truncated"), false);
});

test("a truncated cycle search says so", () => {
  const doc = plan();
  const numbers = doc.issues.map((one) => one.issue);
  for (const one of doc.issues) {
    one.blocked_by = numbers.filter((number) => number !== one.issue);
    one.blocks = numbers.filter((number) => number !== one.issue);
  }
  const names = failures(checkPlan(doc));
  assert.ok(names.includes("dependency-cycle"));
  // A list that stopped early must not read like a complete one.
  assert.ok(names.includes("cycle-search-truncated"));
});

// --- round three: the remaining false accepts -------------------------------------------------

test("a date with the shape of an instant that is not one fails", () => {
  for (const when of ["2026-99-99T99:99:99+99:99", "2026-02-30T00:00:00Z", "0000-00-00T00:00:00Z"]) {
    const failed = checkGithubState(plan(), { ...state(), captured_at: when }).failures;
    assert.ok(failed.some((one) => one.check === "snapshot-undated"), `${when} was accepted`);
  }
  assert.deepEqual(checkGithubState(plan(), state()).failures, []);
});

test("a snapshot carrying an issue twice fails", () => {
  const snapshot = state();
  // A Map keeps the last entry, so the second copy answered for the first.
  snapshot.issues = [...snapshot.issues, { ...snapshot.issues.find((one) => one.number === 588), state: "open" }];
  assert.ok(checkGithubState(plan(), snapshot).failures.some((one) => one.check === "snapshot-duplicate-issue"));
});

test("a snapshot with no issues is reported by both readers rather than throwing in one", () => {
  const doc = plan();
  for (const broken of [{ ...state(), issues: null }, { ...state(), issues: undefined }]) {
    assert.equal(checkGithubState(doc, broken).ok, false);
    const audit = auditCloseEvidence(doc, asLive(broken), { live: true });
    assert.equal(audit.ok, false);
    assert.ok(audit.failures.some((one) => one.check === "snapshot-empty"));
  }
});

test("a pattern that is not a valid unicode regular expression is a schema error, not a fallback", () => {
  // `\8` is invalid under `u` and legal without it, so falling back quietly evaluated a different
  // pattern from the one the schema wrote down.
  const report = validateAgainstSchema("8", { type: "string", pattern: "\\8" });
  assert.equal(report.ok, false);
  assert.match(report.errors[0].message, /not a valid unicode regular expression/);
});

// --- round four: the command's own signals must agree with its verdict -----------------------

test("an offline run reports INCOMPLETE as its verdict while ok and the exit status stay true", () => {
  const script = new URL("../../scripts/verify-v020-execution-plan.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [script, "--json"], { encoding: "utf8", timeout: 120000 });
  const summary = JSON.parse(result.stdout);

  // `ok` and the exit status both mean "nothing this run could check was wrong", and both stay
  // true offline so CI can use them. The verdict is the field that answers the other question, and
  // the printed line must not begin with the word a reader scans for.
  assert.equal(summary.verdict, "INCOMPLETE");
  assert.equal(summary.close_evidence_established, false);
  const closed = plan().issues.filter((one) => one.status === "done").map((one) => one.issue).sort((x, y) => x - y);
  assert.ok(closed.includes(588));
  assert.deepEqual(summary.close_evidence_unestablished, closed);
  assert.equal(summary.ok, true);
  assert.equal(result.status, 0);

  const printed = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 120000 });
  assert.match(printed.stdout, /^INCOMPLETE /m);
  assert.equal(/^PASS /m.test(printed.stdout), false, "an offline run printed a PASS line");
  assert.match(printed.stdout, /verify:execution-plan:live/);
});

test("a live audit asked for over a committed snapshot is refused, not granted", () => {
  // `{live: true}` was a caller-supplied assertion that nothing checked -- the same shape as the
  // record it exists to distrust.
  const report = auditCloseEvidence(plan(), state(), { live: true });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((one) => one.check === "close-evidence-not-live"));
  assert.equal(auditCloseEvidence(plan(), asLive(state()), { live: true }).ok, true);
});

test("the live audit is a job in CI, not only a command in the documentation", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /execution-plan-live:/);
  assert.match(ci, /npm run verify:execution-plan:live/);
});

test("a plan far larger than the release is refused by the schema, quickly", () => {
  // Twelve thousand nodes in a directed ring. The previous implementation walked it recursively and
  // raised RangeError before any bound reported anything; a crash reads as the tool being broken
  // rather than the plan being wrong. It is now refused at the schema, which is the earliest place
  // that can say what is wrong with it, and the same bound stops the unbounded-edge case below.
  const doc = plan();
  const size = 12_000;
  doc.issues = Array.from({ length: size }, (_, index) => ({
    ...clone(doc.issues[0]),
    issue: index + 1,
    blocked_by: [((index + 1) % size) + 1],
    blocks: [((index - 1 + size) % size) + 1]
  }));
  const started = Date.now();
  const report = checkPlan(doc);
  assert.ok(Date.now() - started < 10_000, "the check did not finish on a long ring");
  assert.equal(report.ok, false);
  assert.ok(failures(report).includes("schema-invalid"));
});

test("a canonical-sized plan cannot carry unbounded edges, at the issue or the phase", () => {
  // Thirty-two entries and a hundred thousand references. The count check looks at entries, so this
  // stayed canonical-sized while forcing unbounded work below it -- and it made the reachability
  // search exhaust its budget before reaching the real edge.
  const doc = plan();
  entry(doc, 553).blocked_by = [...Array.from({ length: 100_001 }, (_, index) => 900_000 + index), 554];
  const started = Date.now();
  assert.ok(failures(checkPlan(doc)).includes("schema-invalid"));
  assert.ok(Date.now() - started < 10_000);

  // The same hole one level down: a phase's own blocked_by was unbounded while the issue's was not.
  const phased = plan();
  const phase = entry(phased, 556).phases.find((one) => one.id === "final-integration");
  phase.blocked_by = Array.from({ length: 100_001 }, (_, index) => 900_000 + index);
  assert.ok(failures(checkPlan(phased)).includes("schema-invalid"));
});

test("a reachability answer that ran out of budget is reported, not returned as no", () => {
  // The schema bounds the edges, so this cannot arise from a valid plan -- which is why the check
  // is run here against a permissive schema. The budget is defence for a caller that skips
  // validation, and what it must not do is answer: returning `false` when it gave up said "these
  // two do not depend on each other" about a pair that does.
  const doc = plan();
  const one = entry(doc, 559);
  one.blocked_by = [...Array.from({ length: 120_000 }, (_, index) => 800_000 + index), 582, 588];
  one.allowed_parallel_with = [...one.allowed_parallel_with, 582];
  entry(doc, 582).allowed_parallel_with = [...entry(doc, 582).allowed_parallel_with, 559];

  const names = failures(checkPlan(doc, { schema: true })).filter((check) => check.startsWith("parallel"));
  assert.ok(names.includes("parallel-check-truncated"), names.join(", "));
  // And it must not have quietly said "no": the relation is real, and the truncation is what is
  // reported instead of a wrong answer.
  assert.equal(names.includes("parallel-with-dependency"), false);
});

test("a non-canonical plan still reports the evidence, ownership and gate failures beside it", () => {
  // The early return suppressed the evidence, ownership, phase, status, batch and gate checks --
  // all answerable without the graph, and all needed in the same run. A verifier that reports one
  // problem when there are six sends someone back five times.
  const doc = plan();
  doc.issues = doc.issues.filter((each) => each.issue !== 566);
  entry(doc, 553).close_evidence_required = false;
  entry(doc, 553).owner_surfaces = [];
  delete doc.gates.X;

  const names = failures(checkPlan(doc));
  assert.ok(names.includes("canonical-issue-set"));
  assert.ok(names.includes("graph-checks-skipped"));
  assert.ok(names.includes("release-critical-needs-close-evidence"), "the evidence check was skipped");
  assert.ok(names.includes("gate-missing"), "the gate check was skipped");
  // Owning no surface is its own defect: nothing then protects that surface from a second writer.
  assert.ok(names.includes("owner-surfaces-empty"), "the ownership check was skipped");
});

test("a ring the size of the real plan is reported as exactly one cycle", () => {
  // The same shape at canonical size, where the graph *is* analysed. This is what proves the walk
  // no longer recurses: thirty-two frames is nothing, but the ring is what the old code walked
  // depth-first to its full length.
  const doc = plan();
  const numbers = doc.issues.map((one) => one.issue);
  doc.issues.forEach((one, index) => {
    one.blocked_by = [numbers[(index + 1) % numbers.length]];
    one.blocks = [numbers[(index - 1 + numbers.length) % numbers.length]];
  });
  const report = checkPlan(doc);
  const reported = report.failures.filter((one) => one.check === "dependency-cycle");
  assert.equal(reported.length, 1, "a ring is exactly one elementary cycle");
  assert.equal(reported[0].detail.split(" -> ").length, numbers.length + 1);
});

test("the calendar is real, and the clock is a deliberately narrower profile than RFC 3339", () => {
  // Year 0000 is a leap year in the proleptic Gregorian calendar, and `Date.UTC(0, …)` maps years
  // 0-99 to 1900-1999, so February 0000 was told it had twenty-eight days.
  assert.equal(isRealInstant("0000-02-29T00:00:00Z"), true);
  assert.equal(isRealInstant("1900-02-29T00:00:00Z"), false);
  assert.equal(isRealInstant("2000-02-29T00:00:00Z"), true);
  // Second 60 is refused, and that is narrower than RFC 3339 on purpose: a leap second is legal
  // there only at the end of a month in which one was actually inserted, and honouring that needs a
  // table of announced leap seconds that would go stale in this file. Two weaker rules were tried
  // and both accepted instants that do not exist.
  assert.equal(isRealInstant("1990-12-31T23:59:60Z"), false);
  assert.equal(isRealInstant("2026-01-01T23:59:60Z"), false);
  assert.equal(isRealInstant("2026-01-01T12:34:60Z"), false);
  assert.equal(isRealInstant("1990-12-31T23:59:61Z"), false);
  assert.equal(isRealInstant("2026-02-30T00:00:00Z"), false);
  // Lowercase t and z are valid RFC 3339 and were being rejected.
  assert.equal(isRealInstant("2026-09-02t00:00:00z"), true);
});

test("the phase contract pins what a phase may do, not only what it is called", () => {
  const doc = plan();
  // #572's read-only phase is open while the issue is ready, so the scope rule -- which fires only
  // for a blocked issue -- never looked at it. Flipping this flag was a one-line edit that granted
  // the branch-deleting phase permission to integrate code.
  entry(doc, 572).phases.find((one) => one.id === "read-only-audit").code_integration_allowed = true;
  assert.ok(failures(checkPlan(doc)).includes("phases-do-not-match-contract"));
});

test("the evidence contract lives outside the document it checks", () => {
  for (const edit of [
    (d) => { entry(d, 588).evidence_bindings = {}; },
    (d) => { entry(d, 588).evidence_bindings = { manifest_digest: "README.md", schema_digest: "README.md" }; },
    (d) => { entry(d, 553).required_evidence_fields = ["x"]; },
    (d) => { const e = entry(d, 567); e.required_evidence_fields = e.required_evidence_fields.filter((f) => f !== "raw_byte_digest_api"); },
    (d) => { entry(d, 553).owned_paths = ["README.md"]; },
    (d) => { entry(d, 553).owned_paths = ["docs/whatever.md"]; }
  ]) {
    const doc = plan();
    edit(doc);
    assert.equal(checkPlan(doc).ok, false, "a one-line edit weakened the contract and passed");
  }
});

test("every canonical issue has a pinned evidence contract", () => {
  const doc = plan();
  for (const one of doc.issues) {
    assert.ok(EVIDENCE_CONTRACT[one.issue], `#${one.issue} has no pinned evidence contract`);
    assert.deepEqual(
      [...one.required_evidence_fields].sort(),
      [...EVIDENCE_CONTRACT[one.issue].fields].sort(),
      `#${one.issue}`
    );
  }
});

test("a phase that has begun on a blocked issue cannot integrate code either", () => {
  const doc = plan();
  // The scope rule only looked at `ready` phases, so moving one to `in-progress` or `done` while
  // the issue stayed blocked carried the permission the block exists to withhold.
  for (const status of ["ready", "in-progress", "done"]) {
    const one = withFeasibilityBlocked(plan());
    const phase = entry(one, 556).phases.find((each) => each.id === "final-integration");
    phase.status = status;
    assert.ok(
      failures(checkPlan(one)).includes("phase-scope-exceeded"),
      `#556 was allowed a ${status} integrating phase while blocked`
    );
  }
  assert.equal(checkPlan(doc).ok, true);
});

test("an issue number from a comment cannot become a pattern", async () => {
  const { verifyCompletionRecord } = await import("../../lib/github-state.mjs");
  // `record.issue` arrives in a fenced JSON block on an issue comment, so it is attacker-controlled
  // text until something proves otherwise. Interpolated raw, `".*"` matched any pull request body,
  // and the confirmation stored in the snapshot -- and carried into the evidence bundle -- was a
  // recorded fact that was false.
  const get = async (path) => {
    if (path.includes("/files")) return { body: [{ filename: "lib/" }], link: null };
    if (path.includes("/pulls/")) {
      return { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "dev" }, head: { sha: "b".repeat(40) }, merge_commit_sha: "c".repeat(40), body: "Closes #12345 unrelated work" } };
    }
    if (path.includes("/compare/")) return { body: { status: "ahead" } };
    return { body: { conclusion: "success", head_sha: "b".repeat(40) } };
  };

  for (const issue of [".*", "588|.*", "\\d+", "588", null, 1.5, -1]) {
    const checked = await verifyCompletionRecord("o/r", { issue, final_sha: "a".repeat(40), pr: 1, ci_run_ids: [1] }, { get, issue: { issue: 588, owned_paths: ["lib/"], evidence_bindings: {} } });
    assert.equal(checked.pr_closes_issue, false, `${JSON.stringify(issue)} was accepted as an issue number`);
  }

  // The honest case still works.
  const honest = async (path) =>
    path.includes("/pulls/")
      ? { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "dev" }, head: { sha: "b".repeat(40) }, merge_commit_sha: "c".repeat(40), body: "Closes #588" } }
      : get(path);
  const good = await verifyCompletionRecord("o/r", { issue: 588, final_sha: "a".repeat(40), pr: 1, ci_run_ids: [1] }, { get: honest, issue: { issue: 588, owned_paths: ["lib/"], evidence_bindings: {} } });
  assert.equal(good.pr_closes_issue, true);
});

// --- round three: "I could not check" is not "this fact is false" ------------------------------
//
// The observation this exists for: a live audit reported #565 as `close-evidence-unverified`, the
// same record checked directly a minute later confirmed all ten components, and two further live
// runs passed. The record never changed. The verifier initialised every confirmation to `false` and
// eight `try/catch` blocks left them there, so one 502 while walking thirty-two issues was written
// down as a forgery -- a silence scored as a value, in the tool that exists to refuse exactly that.

test("a transient failure is not a false fact", async () => {
  const { verifyCompletionRecord } = await import("../../lib/github-state.mjs");
  const record = { issue: 588, final_sha: "a".repeat(40), pr: 589, ci_run_ids: [1], evidence: {} };
  const owner = { issue: 588, owned_paths: ["lib/"], evidence_bindings: {} };
  const honest = async (path) => {
    if (path.includes("/files")) return { body: [{ filename: "lib/execution-plan.mjs" }], link: null };
    if (path.includes("/commits/")) return { body: { sha: record.final_sha } };
    if (path.includes("/compare/")) return { body: { status: "ahead" } };
    if (path.includes("/pulls/")) return { body: { merged_at: "2026-09-01T00:00:00Z", base: { ref: "dev" }, head: { sha: record.final_sha }, merge_commit_sha: record.final_sha, body: "Closes #588" } };
    return { body: { conclusion: "success", head_sha: record.final_sha } };
  };
  const refusing = (fragment, status) => async (path) => {
    if (path.includes(fragment)) {
      const error = new Error(`GitHub ${path} -> ${status}`);
      error.status = status;
      throw error;
    }
    return honest(path);
  };

  // The counterfactual first: with nothing failing, the honest repository still confirms the record
  // and claims no unresolved confirmation. Otherwise every assertion below could pass on a verifier
  // that answers "could not check" to everything.
  const clean = await verifyCompletionRecord("o/r", record, { get: honest, issue: owner });
  assert.equal(clean.verified, true);
  assert.equal(clean.resolution, "verified");
  assert.deepEqual(clean.unresolved, []);

  // One 502 on the comparison, and nothing else touched. The commit was read, so `commit_exists`
  // keeps the answer it earned; the branch question was never answered and must not read as no.
  const flaky = await verifyCompletionRecord("o/r", record, { get: refusing("/compare/", 502), issue: owner });
  assert.equal(flaky.commit_exists, true, "the call that succeeded still counts");
  assert.equal(flaky.commit_on_integration_branch, NOT_CHECKED, "a 502 was recorded as the fact being false");
  assert.notEqual(flaky.commit_on_integration_branch, false);
  assert.equal(flaky.verified, false, "an unresolved record must not pass");
  assert.equal(flaky.resolution, "not-checked", "an unread confirmation was filed as a denied one");
  // The catch says what failed: which confirmation, which call, and the HTTP status. All eight of
  // them swallowed the error entirely, so nobody could tell a rate limit from a forged SHA.
  assert.deepEqual(flaky.unresolved.map((one) => one.confirmation), ["commit_on_integration_branch"]);
  assert.equal(flaky.unresolved[0].status, 502);
  assert.match(flaky.unresolved[0].call, /\/compare\//u);

  // And the other direction, which is the one the fix can get wrong: a 404 on a commit is the
  // repository saying it does not have that commit. That is a false fact, and filing it as
  // "could not check" would turn the third state into the bucket a forged SHA hides in.
  const absent = await verifyCompletionRecord("o/r", record, { get: refusing("/commits/", 404), issue: owner });
  assert.equal(absent.commit_exists, false, "a 404 on a commit that does not exist was swallowed as unreachable");
  assert.notEqual(absent.commit_exists, NOT_CHECKED);
  assert.equal(absent.resolution, "contradicted");
  assert.deepEqual(absent.unresolved, []);
  assert.equal(absent.verified, false);
});

test("runs are not disowned by a pull request nobody could read", async () => {
  const { verifyCompletionRecord } = await import("../../lib/github-state.mjs");
  // The commits a run may belong to are partly the pull request's -- its head and its merge commit.
  // When the pull request could not be read, that set is short, and answering the question against
  // a short set is not answering it: a CI run on the pull request's head reads as a run on
  // somebody else's work.
  const record = { issue: 588, final_sha: "a".repeat(40), pr: 589, ci_run_ids: [1], evidence: {} };
  const owner = { issue: 588, owned_paths: ["lib/"], evidence_bindings: {} };
  const get = async (path) => {
    if (path.includes("/pulls/")) {
      const error = new Error(`GitHub ${path} -> 429`);
      error.status = 429;
      throw error;
    }
    if (path.includes("/commits/")) return { body: { sha: record.final_sha } };
    if (path.includes("/compare/")) return { body: { status: "ahead" } };
    return { body: { conclusion: "success", head_sha: "b".repeat(40) } };
  };
  const checked = await verifyCompletionRecord("o/r", record, { get, issue: owner });
  assert.equal(checked.pr_merged, NOT_CHECKED);
  assert.equal(checked.ci_runs_succeeded, true, "the runs themselves were read and did succeed");
  assert.equal(checked.ci_runs_ran_on_this_work, NOT_CHECKED, "an unread pull request made a run look like somebody else's");
  assert.notEqual(checked.ci_runs_ran_on_this_work, false);
  assert.equal(checked.resolution, "not-checked");
  assert.ok(checked.unresolved.some((one) => one.confirmation === "ci_runs_ran_on_this_work" && one.status === 429), JSON.stringify(checked.unresolved));
});

test("an unread confirmation and a denied one are different outcomes", () => {
  // `close-evidence-unchecked` already existed and no path reached it, so a rate limit and a forged
  // SHA arrived at the reader as the same sentence. The distinction has to survive the audit, not
  // just the verifier.
  const withChecked = (checked) => {
    const snapshot = state();
    snapshot.issues.find((one) => one.number === 588).close_evidence_checked = checked;
    return auditCloseEvidence(plan(), asLive(snapshot), { live: true });
  };

  const unread = withChecked({ ...verified(), commit_on_integration_branch: NOT_CHECKED, verified: false, resolution: "not-checked" });
  const names = unread.failures.filter((one) => one.issue === 588).map((one) => one.check);
  assert.deepEqual(names, ["close-evidence-unchecked"], `an unread confirmation was reported as ${names.join(", ") || "nothing"}`);
  assert.match(unread.failures.find((one) => one.issue === 588).detail, /commit_on_integration_branch/u);
  // Fail-closed, still. An unresolved record is not a passing one, whatever it is called.
  assert.equal(unread.ok, false, "a record nobody could check read as a pass");

  const denied = withChecked({ ...verified(), commit_on_integration_branch: false, verified: false, resolution: "contradicted" });
  const deniedNames = denied.failures.filter((one) => one.issue === 588).map((one) => one.check);
  assert.deepEqual(deniedNames, ["close-evidence-unverified"], `a denied fact was reported as ${deniedNames.join(", ") || "nothing"}`);
  assert.equal(denied.ok, false);

  // Both at once is a denial: a fact the repository contradicts is contradicted however much else
  // went unread, so "could not check" cannot become the quieter word a false fact is filed under.
  const both = withChecked({ ...verified(), commit_exists: false, pr_merged: NOT_CHECKED, verified: false, resolution: "contradicted" });
  assert.deepEqual(both.failures.filter((one) => one.issue === 588).map((one) => one.check), ["close-evidence-unverified"]);

  // And the shipped fixture, whose confirmations are all plain `true`, still passes.
  assert.equal(withChecked(verified()).failures.filter((one) => one.issue === 588).length, 0);
});
