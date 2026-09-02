import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOUNDARY_CANARY_PROGRAM_DIGEST,
  CANARY_CELLS,
  ISSUANCE_REASONS,
  issuanceGate,
  renderSupportMatrix,
  settleConfinement,
  supportMatrixDecisions
} from "../../lib/confinement.mjs";
import { scoreRun } from "../../lib/scorer-v1.mjs";
import { METRIC_IDS, METRICS, observationOf } from "../../lib/metrics.mjs";
import { run } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const fixtureDir = join(root, "fixtures", "confinement");
const matrix = JSON.parse(readFileSync(join(fixtureDir, "support-matrix.json"), "utf8"));

// The record the review forged: every field the gate used to read, none of the evidence behind
// them. Shapes only -- a schema nobody set, digests of nothing, a canary result with no cells, no
// poll and no sweep.
const forged = () => ({
  level: "STRICT",
  platform: "darwin",
  backend: "macos-seatbelt",
  adapter: "codex-cli.v1",
  filesystem_enforced: true,
  process_enforced: true,
  setup_verified: true,
  boundary_canary: { result: "PASS", failed: [], evidence_digest: `sha256:${"0".repeat(64)}` },
  descendants: { leaked: [], survivors: [] },
  cleanup_verified: true,
  policy_digest: `sha256:${"0".repeat(64)}`,
  support_status: "SUPPORTED_WITH_CONSTRAINTS"
});

const observations = (name) => JSON.parse(readFileSync(join(fixtureDir, "observations", name), "utf8"));

// An authentic record: the fields the run measured, quoted from the committed observation of the
// lane that was actually run, so that what the gate accepts here is what the boundary produced.
const measured = (overrides = {}) => {
  const captured = observations("strict-lane.darwin.seatbelt.canary.json").captured;
  return {
    schema: "aos-confinement-record.v1",
    level: "STRICT",
    platform: "darwin",
    backend: "macos-seatbelt",
    adapter: "codex-cli.v1",
    filesystem_enforced: true,
    process_enforced: true,
    network_policy: captured.network_policy,
    network: { provider_transport: "allowed", task_external: "NOT_OBSERVED", enforcement: "kernel" },
    policy_digest: captured.policy_digest,
    rendered_profile_digest: captured.rendered_profile_digest,
    setup_verified: true,
    boundary_canary: {
      result: "PASS",
      failed: [],
      cells: captured.cells,
      out_of_band: captured.out_of_band,
      evidence_digest: captured.evidence_digest,
      program_digest: captured.program_digest,
      scan_polls: captured.scan_polls
    },
    descendants: { scan: "ancestry-poll+process-group-sweep", poll_interval_ms: 200, polls: 12, tracked: [4242], leaked: [], survivors: [], group_sweep: { pgid: 4242, members: [] }, residual: "named" },
    cleanup_verified: true,
    scratch_not_removed: [],
    support_status: "SUPPORTED_WITH_CONSTRAINTS",
    platform_lane: "darwin/macos-seatbelt/codex-cli.v1",
    ...overrides
  };
};

test("a_record_that_is_not_the_boundary_s_own_output_is_refused_rather_than_believed", () => {
  // The gate used to read field shapes. Every field in this object has the right shape and none of
  // them came from a boundary: no schema, digests of nothing, a canary that reports a result with
  // no cells and no program digest, and a descendant scan with no poll behind it.
  const decision = issuanceGate(forged());
  assert.equal(decision.official, false);
  assert.ok(decision.reasons.includes(ISSUANCE_REASONS.RECORD_INVALID), decision.reasons.join(", "));
  assert.ok(Array.isArray(decision.record_problems) && decision.record_problems.length > 0);
  // Named, so the operator is told what is missing rather than that something is.
  const problems = decision.record_problems.join(" ");
  for (const expected of ["schema", "network", "program_digest", "cells", "rendered_profile_digest", "polls"]) {
    assert.match(problems, new RegExp(expected, "u"), `${expected} was not named among ${problems}`);
  }
  // And the measured record from the same lane still passes, so this refuses forgery and not
  // STRICT itself.
  assert.deepEqual(issuanceGate(measured()).reasons, []);
});

test("a_missing_network_observation_is_an_invalid_record_and_not_a_quiet_not_observed", () => {
  // The old gate projected an absent `network` object as `task_external: NOT_OBSERVED`, which is
  // the honest answer for a run that measured and could not tell -- and a fabrication for a record
  // that never measured at all.
  const decision = issuanceGate(measured({ network: undefined }));
  assert.equal(decision.official, false);
  assert.ok(decision.reasons.includes(ISSUANCE_REASONS.RECORD_INVALID));
  assert.match(decision.record_problems.join(" "), /network/u);
});

test("a_canary_that_did_not_run_the_shipped_program_cannot_certify_the_boundary", () => {
  const canary = { ...measured().boundary_canary, program_digest: `sha256:${"a".repeat(64)}` };
  const decision = issuanceGate(measured({ boundary_canary: canary }));
  assert.equal(decision.official, false);
  assert.match(decision.record_problems.join(" "), /program_digest/u);
  // The digest the gate demands is the one over the shipped source, computed here the same way.
  assert.equal(measured().boundary_canary.program_digest, BOUNDARY_CANARY_PROGRAM_DIGEST);
});

test("a_canary_missing_a_cell_is_missing_the_evidence_for_that_cell", () => {
  for (const cell of CANARY_CELLS) {
    const cells = { ...measured().boundary_canary.cells };
    delete cells[cell];
    const decision = issuanceGate(measured({ boundary_canary: { ...measured().boundary_canary, cells } }));
    assert.equal(decision.official, false, cell);
    assert.match(decision.record_problems.join(" "), new RegExp(cell, "u"));
  }
});

test("a_process_axis_with_no_sweep_and_no_escapee_proof_is_not_enforced", async () => {
  // What the record writes into `process_enforced`, from what the run measured. A canary and one
  // poll is what it used to take, and the descendant that forks away between two polls is exactly
  // what one poll cannot see.
  const { processAxisEnforced } = await import("../../lib/confinement.mjs");
  const canary = measured().boundary_canary;
  const sweep = { pgid: 4242, members: [] };
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: sweep }), true);
  assert.equal(processAxisEnforced({ canary, polls: 1, groupSweep: sweep }), false, "one poll watched nothing");
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: null }), false, "the group was never swept");
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: { pgid: 0, members: [] } }), false, "pgid 0 is not a group");
  const unconfined = { ...canary, out_of_band: { ...canary.out_of_band, descendant: { ...canary.out_of_band.descendant, escapee_confined: false } } };
  assert.equal(processAxisEnforced({ canary: unconfined, polls: 12, groupSweep: sweep }), false, "the escapee was not proved confined");
  assert.equal(processAxisEnforced({ canary: { ...canary, result: "FAIL" }, polls: 12, groupSweep: sweep }), false);

  // The double-fork blind spot: the record used to call the process axis enforced on a passing
  // canary and one poll. What is required now is what was measured -- the group sweep beside the
  // ancestry poll, and the canary's own escapee proved confined and dead.
  const withoutSweep = measured({ descendants: { ...measured().descendants, group_sweep: undefined } });
  assert.ok(issuanceGate(withoutSweep).record_problems.join(" ").includes("group_sweep"));
  const decision = issuanceGate(measured({ boundary_canary: unconfined }));
  assert.equal(decision.official, false);
  assert.match(decision.record_problems.join(" "), /escapee/u);
});

test("cleanup_failures_are_recorded_by_class_and_digest_and_never_by_path", () => {
  // The record is copied whole into the public result, so a path that reaches it is published.
  const record = measured({ cleanup_verified: null, scratch_not_removed: undefined });
  settleConfinement(record, ["/Users/alice/private/aos-agent-home-123: EPERM"]);
  const text = JSON.stringify(record.scratch_not_removed);
  assert.doesNotMatch(text, /\/Users\/alice/u);
  assert.doesNotMatch(text, /aos-agent-home-123/u);
  assert.match(text, /sha256:[0-9a-f]{64}/u);
  assert.match(text, /EPERM/u);
  assert.equal(record.cleanup_verified, false);
});

test("a_support_row_whose_evidence_does_not_match_its_declared_digest_claims_nothing", () => {
  const copy = mkdtempSync(join(tmpdir(), "aos-matrix-digest-"));
  try {
    cpSync(fixtureDir, copy, { recursive: true });
    const fixture = JSON.parse(readFileSync(join(copy, "support-matrix.json"), "utf8"));
    const official = fixture.lanes.find((row) => row.official === true);
    official.evidence.canary.digest = `sha256:${"0".repeat(64)}`;
    official.evidence.runtime.digest = "not-a-digest";
    const rows = supportMatrixDecisions(fixture, copy);
    const row = rows.find((one) => one.official === true);
    assert.equal(row.decision.official, false, "a row backed by evidence it does not match was issued");
    assert.ok(row.decision.reasons.includes(ISSUANCE_REASONS.EVIDENCE_DIGEST_MISMATCH), row.decision.reasons.join(", "));
    // The bytes on disk are untouched: what failed is the row's claim about them.
    const untouched = supportMatrixDecisions(JSON.parse(readFileSync(join(copy, "support-matrix.json"), "utf8")), copy);
    assert.equal(untouched.find((one) => one.official === true).decision.official, true);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("the_rendered_matrix_shows_the_decisions_it_was_handed", () => {
  // The renderer used to recompute the decision from the fixture, so the table could disagree with
  // the gate that was actually run over the same rows.
  const rows = supportMatrixDecisions(matrix);
  const rendered = renderSupportMatrix(rows);
  assert.match(rendered, /\| darwin \| macos-seatbelt \| codex-cli\.v1 \| STRICT \|.*\| OFFICIAL \|/u);
  const withheld = rows.map((row) => ({ ...row, decision: { ...row.decision, official: false, reasons: [ISSUANCE_REASONS.RECORD_INVALID] } }));
  assert.equal(renderSupportMatrix(withheld).includes("OFFICIAL"), false);
});

test("the_packaged_release_ships_the_evidence_its_support_matrix_cites", () => {
  const files = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).files;
  assert.ok(files.includes("fixtures/confinement/"), `packaged files do not carry the matrix evidence: ${files.join(", ")}`);
});

test("the_real_runtime_strict_script_cannot_report_a_skip_as_a_pass", async () => {
  const { realStrictLaneStatus } = await import("../../lib/confinement.mjs");
  // `verify:real-runtime-strict` exists to answer whether a real STRICT run happened. A skipped
  // suite exiting 0 answers "yes" to a question nobody asked.
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
  assert.match(scripts["verify:real-runtime-strict"], /AOS_REAL_STRICT_REQUIRED=1/u);
  const required = { AOS_REAL_STRICT_REQUIRED: "1" };
  assert.equal(realStrictLaneStatus({ env: required, platform: "linux", backendAvailable: false }).required, true);
  assert.throws(
    () => realStrictLaneStatus({ env: required, platform: "linux", backendAvailable: false }).assertRan(),
    { message: /^AOS_REAL_STRICT_NOT_RUN/u }
  );
  // Unset, the same suite is allowed to say NOT_OBSERVED and stop.
  assert.equal(realStrictLaneStatus({ env: {}, platform: "linux", backendAvailable: false }).required, false);
  realStrictLaneStatus({ env: {}, platform: "linux", backendAvailable: false }).assertRan();
  // And where the lane is available, the requirement is satisfied by running it.
  assert.equal(realStrictLaneStatus({ env: required, platform: "darwin", backendAvailable: true }).available, true);
});

test("a_run_that_the_boundary_did_not_make_official_carries_no_score", () => {
  const observed = METRIC_IDS.map((id) => observationOf({
    metric_id: id,
    verifier_id: "official-issuance.test",
    subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: true })),
    evidence_ids: ["e"],
    reason: "fixture"
  }));
  const withheld = scoreRun(observed, { officialIssuance: { official: false, reasons: [ISSUANCE_REASONS.LEVEL_NOT_STRICT] } });
  assert.equal(withheld.issued, false);
  assert.equal(withheld.score, null);
  assert.equal(withheld.status, "INCOMPLETE");
  assert.equal(withheld.claim_stage, "RUN_DIAGNOSTIC");
  const blocker = withheld.blockers.find((one) => one.code === "ISOLATION_NOT_OFFICIAL");
  assert.ok(blocker, withheld.blockers.map((one) => one.code).join(", "));
  assert.match(blocker.detail, /AOS_ISOLATION_LEVEL_NOT_STRICT/u);
  // The arithmetic is still reported: an operator fixing the gate needs to see what the run was
  // worth, under the claim stage it can support.
  assert.equal(withheld.provisional_raw, 100);

  const official = scoreRun(observed, { officialIssuance: { official: true, reasons: [] } });
  assert.equal(official.issued, true);
  assert.equal(official.claim_stage, "PROFILE_BOUND");

  // A caller that supplies no verdict has measured no boundary, so the result it gets is a
  // diagnostic one: PROFILE_BOUND is claimed only where the boundary was gated.
  assert.equal(scoreRun(observed).claim_stage, "RUN_DIAGNOSTIC");
});

test("an_assessment_on_a_lane_that_cannot_be_official_says_so_where_the_score_would_be", () => {
  // End to end through the CLI, which is the only thing that issues a result. Under the default
  // lane the confinement gate withholds, and every surface has to agree: no score, a named
  // isolation reason, the diagnostic claim stage, and an exit code that is not success.
  const cwd = mkdtempSync(join(tmpdir(), "aos-official-cli-"));
  try {
    const agent = join(cwd, "agent.mjs");
    writeFileSync(agent, "process.stdout.write('done\\n');\n");
    run(cwd, ["agent", "add", "solo", "--command", process.execPath, "--arg", agent]);
    const assessed = run(cwd, ["assess", "--json", "--timeout-ms", "30000"], 3);
    const result = JSON.parse(assessed.stdout);
    assert.equal(result.issued, false);
    assert.equal(result.score, null);
    assert.equal(result.claim_stage, "RUN_DIAGNOSTIC");
    assert.equal(result.isolation.official_issuance.official, false);
    assert.ok(result.blockers.some((one) => one.code === "ISOLATION_NOT_OFFICIAL"), JSON.stringify(result.blockers));
    const printed = run(cwd, ["assess", "--timeout-ms", "30000"], 3);
    assert.match(printed.stdout, /Score withheld/u);
    assert.match(printed.stdout, /AOS_ISOLATION_/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
