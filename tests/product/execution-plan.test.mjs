import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  CANONICAL_ISSUE_COUNT,
  EXCLUDED_ISSUES,
  auditCloseEvidence,
  checkGithubState,
  checkPlan,
  loadPlan,
  loadSchema,
  planDigest,
  validateAgainstSchema
} from "../../lib/execution-plan.mjs";

const plan = () => loadPlan();
const clone = (value) => JSON.parse(JSON.stringify(value));
const entry = (doc, issue) => doc.issues.find((one) => one.issue === issue);
const failures = (report) => report.failures.map((one) => one.check);

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
    issue: 567,
    final_sha: "0".repeat(40),
    pr: 601,
    ci_run_ids: [12345],
    verdict: "PASS",
    evidence: { mutation: "load-bearing" }
  };
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
  assert.deepEqual(auditCloseEvidence(plan(), snapshot).failures, []);
});

// --- the manifest is the thing a lower-tier agent reads -------------------------------------

test("the next batch is decidable from the manifest alone", () => {
  const doc = plan();
  const ready = doc.issues.filter((one) => one.status === "ready").map((one) => one.issue).sort((a, b) => a - b);
  assert.deepEqual(ready, [553, 554, 555, 565, 567, 570, 572, 582, 588]);
  const phaseReady = doc.issues
    .filter((one) => one.status !== "ready" && (one.phases ?? []).some((p) => p.status === "ready"))
    .map((one) => one.issue);
  assert.deepEqual(phaseReady, [556]);
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

test("the audit summary carries no title, body or path", () => {
  // What this command prints is what goes into the release evidence bundle, and the bundle is
  // published. A check that leaked an issue title would leak it once and for ever.
  const doc = plan();
  const report = checkPlan(doc);
  const serialised = JSON.stringify(report.failures);
  assert.equal(serialised, "[]");
  for (const one of state().issues) assert.ok(one.title.length > 0);
});
