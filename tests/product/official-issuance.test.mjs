import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOUNDARY_CANARY_PROGRAM_DIGEST,
  CANARY_CELLS,
  ISSUANCE_REASONS,
  STRICT_EVIDENCE_KINDS,
  issuanceGate,
  renderSupportMatrix,
  settleConfinement,
  survivorSweep,
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
    descendants: {
      scan: "ancestry-poll+process-group-sweep+survivor-sweep",
      poll_interval_ms: 200,
      polls: 12,
      tracked: [4242],
      leaked: [],
      survivors: [],
      group_sweep: { pgid: 4242, members: [] },
      survivor_sweep: { scanned: true, scanners: ["environment-marker", "open-path", "process-group"], marker_used: true, paths: 3, group_enumerated: 1, survivors: [] },
      residual: "a descendant that sheds every marker is in none of the scans; the boundary is inherited and it cannot reach anything else"
    },
    cleanup_verified: true,
    scratch_not_removed: [],
    support_status: "SUPPORTED_WITH_CONSTRAINTS",
    platform_lane: "darwin/macos-seatbelt/codex-cli.v1",
    // #556 round 4: an adapter that stages a credential is official only for the executable #554
    // verified as that runtime, so the measured record carries the identity the run staged for.
    runtime_identity: { status: "VERIFIED", digest: `sha256:${"1".repeat(64)}`, matches_adapter: true, reason: null },
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

test("a_canary_whose_cells_contradict_their_expectations_is_a_failed_boundary", () => {
  // The review's reproduction: the committed official record, with `outside_read` reporting that
  // it read what it expected to be denied, and `result: "PASS"` left in place. The gate returned
  // official with no reasons, because it checked that each cell was an object and then believed
  // the summary above them. A cell is an observation; `result` is a claim about the observations.
  for (const [name, contradiction] of [
    ["outside_read", { expected: "denied", observed: "allowed", errno: null }],
    ["store_root_read", { expected: "denied", observed: "allowed", errno: null }],
    ["operator_home_list", { expected: "denied", observed: "allowed", errno: null }],
    ["host_etc_read", { expected: "denied", observed: "allowed", errno: null }],
    ["workspace_write", { expected: "allowed", observed: "denied", errno: "EPERM" }],
    ["system_library_read", { expected: "allowed", observed: "denied", errno: "EPERM" }]
  ]) {
    const canary = measured().boundary_canary;
    const forgedCanary = { ...canary, result: "PASS", failed: [], cells: { ...canary.cells, [name]: contradiction } };
    const decision = issuanceGate(measured({ boundary_canary: forgedCanary }));
    assert.equal(decision.official, false, `${name}: a contradicted cell was issued as official`);
    assert.equal(decision.boundary_canary, "FAIL", `${name}: the derived verdict followed the reported one`);
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.CANARY_NOT_PASS), `${name}: ${decision.reasons.join(", ")}`);
    assert.match(decision.record_problems.join(" "), new RegExp(name, "u"));
  }
  // And the review's own counterexample, which the loop above cannot produce: the record claims a
  // different expectation than the policy has, and its observation agrees with the claim. Reading
  // `expected` from the record makes the record the authority on what the boundary was for.
  const authentic = measured().boundary_canary;
  const claimed = { ...authentic, result: "PASS", failed: [], cells: { ...authentic.cells, outside_read: { expected: "allowed", observed: "allowed", errno: null } } };
  const claimedDecision = issuanceGate(measured({ boundary_canary: claimed }));
  assert.equal(claimedDecision.official, false, "a record that rewrote its own expectation was issued");
  assert.equal(claimedDecision.boundary_canary, "FAIL");
  assert.match(claimedDecision.record_problems.join(" "), /outside_read.*claiming "allowed".*policy's "denied"/u);

  // A cell that reports nothing is not a pass by omission either.
  const canary = measured().boundary_canary;
  const silent = { ...canary, cells: { ...canary.cells, outside_read: { errno: null } } };
  assert.equal(issuanceGate(measured({ boundary_canary: silent })).boundary_canary, "NOT_RUN");
  // And the whole of it the other way round: a record whose cells all hold is official even with
  // the summary missing, because the summary was never the input.
  const withoutResult = { ...canary };
  delete withoutResult.result;
  assert.deepEqual(issuanceGate(measured({ boundary_canary: withoutResult })).reasons, []);
});

test("a_lane_whose_adapter_stages_a_credential_is_official_only_for_that_runtime", () => {
  // The gate's half of the rule, over a record alone, so it holds on every platform: the staging
  // refusal is measured where a boundary exists, and this is what the decision does with the
  // result. An adapter that copies the operator's credential is the lane of the runtime whose
  // credential it is; a record that ran something else is not that lane, whatever it is labelled.
  for (const identity of [
    null,
    { status: "VERIFIED", digest: `sha256:${"9".repeat(64)}`, matches_adapter: false, reason: "the verified executable is not codex-cli.v1" },
    { status: "UNTRUSTED", digest: null, matches_adapter: false, reason: "runtime identity is UNTRUSTED" }
  ]) {
    const decision = issuanceGate(measured({ runtime_identity: identity }));
    assert.equal(decision.official, false, JSON.stringify(identity));
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.RUNTIME_IDENTITY_UNVERIFIED), decision.reasons.join(", "));
  }
  // An adapter that stages nothing has no credential to bind, and is judged on the rest.
  const generic = measured({ adapter: "generic-command.v1", platform_lane: "darwin/macos-seatbelt/generic-command.v1", runtime_identity: null });
  assert.equal(issuanceGate(generic).reasons.includes(ISSUANCE_REASONS.RUNTIME_IDENTITY_UNVERIFIED), false);
  // And the measured record, which carries the identity its staging was made for, is official.
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
  // The policy the cells are judged against. A policy this release does not measure has no
  // expectation for the network cell, so the axis is not enforced without one -- pinned below.
  const networkPolicy = "provider-required-unrestricted";
  const clean = { scanned: true, scanners: ["environment-marker", "open-path", "process-group"], marker_used: true, paths: 3, group_enumerated: 1, survivors: [] };
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: sweep, survivorSweep: clean, networkPolicy }), true);
  assert.equal(processAxisEnforced({ canary, polls: 1, groupSweep: sweep, survivorSweep: clean, networkPolicy }), false, "one poll watched nothing");
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: null, survivorSweep: clean, networkPolicy }), false, "the group was never swept");
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: { pgid: 0, members: [] }, survivorSweep: clean, networkPolicy }), false, "pgid 0 is not a group");
  const unconfined = { ...canary, out_of_band: { ...canary.out_of_band, descendant: { ...canary.out_of_band.descendant, escapee_confined: false } } };
  assert.equal(processAxisEnforced({ canary: unconfined, polls: 12, groupSweep: sweep, survivorSweep: clean, networkPolicy }), false, "the escapee was not proved confined");
  // The canary's own cells decide, not the word on top of them: a record that says PASS over a
  // cell that observed what it expected to be denied is a failed boundary.
  // And a policy nobody has measured leaves the network cell with no expectation at all, so the
  // canary cannot pass and the axis is not enforced -- rather than defaulting to the most
  // permissive expectation there is.
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: sweep, survivorSweep: clean, networkPolicy: "WITHHELD" }), false);
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: sweep, survivorSweep: clean }), false, "no policy is not a permissive policy");
  const contradicted = { ...canary, cells: { ...canary.cells, outside_read: { expected: "denied", observed: "allowed", errno: null } } };
  assert.equal(processAxisEnforced({ canary: contradicted, polls: 12, groupSweep: sweep, survivorSweep: clean, networkPolicy }), false);

  // The double-fork blind spot: the record used to call the process axis enforced on a passing
  // canary and one poll. What is required now is what was measured -- the group sweep beside the
  // ancestry poll, and the canary's own escapee proved confined and dead.
  const withoutSweep = measured({ descendants: { ...measured().descendants, group_sweep: undefined } });
  assert.ok(issuanceGate(withoutSweep).record_problems.join(" ").includes("group_sweep"));

  // The case the review reproduced and the record used to issue over: poll one holds the root,
  // later polls hold a live process at ppid 1 with a group of its own, and ancestry sees nothing.
  // The tracker is honest about that -- and the survivor sweep is what closes it, so a record
  // whose sweep did not run, or ran and found something, cannot call the axis enforced.
  const escapedTable = () => {
    let poll = 0;
    return () => {
      poll += 1;
      return poll === 1
        ? [{ pid: 100, ppid: 1, pgid: 100, start: "A" }]
        : [{ pid: 100, ppid: 1, pgid: 100, start: "A" }, { pid: 200, ppid: 1, pgid: 200, start: "B" }];
    };
  };
  const { descendantTracker } = await import("../../lib/confinement.mjs");
  const tracker = descendantTracker(100, { table: escapedTable(), intervalMs: 10 });
  tracker.poll();
  tracker.poll();
  assert.deepEqual(tracker.tracked(), [100], "the ancestry poll is not expected to find a reparented, regrouped process");
  assert.deepEqual(tracker.alive().filter((pid) => pid !== 100), [], "and it does not see it alive either");
  // So the axis rests on the sweep, and the sweep decides it.
  const sweepFound = { scanned: true, scanners: ["environment-marker", "open-path", "process-group"], marker_used: true, paths: 3, group_enumerated: 2, survivors: [200] };
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: sweep, survivorSweep: sweepFound }), false, "a swept survivor left the axis enforced");
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: sweep, survivorSweep: { scanned: false, scanners: [], survivors: [] } }), false, "a sweep that could not run left the axis enforced");
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep: sweep, survivorSweep: null, networkPolicy }), false, "no sweep left the axis enforced");
  const escaped = measured({ descendants: { ...measured().descendants, survivor_sweep: sweepFound } });
  const escapedDecision = issuanceGate(escaped);
  assert.equal(escapedDecision.official, false, "a run with a swept survivor was issued");
  assert.match(escapedDecision.record_problems.join(" "), /survivor_sweep/u);
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

test("a_descendant_that_sheds_every_marker_is_held_by_the_boundary_not_by_the_scanners", async () => {
  // The decision this lane rests on, stated as a test. A descendant that double-forks, re-sessions,
  // clears its environment, closes every inherited descriptor and changes directory is in none of
  // the three scans, and no enumeration can prove it is not there. What holds it is the boundary
  // itself: the profile is inherited across fork and exec and cannot be shed with the markers. The
  // canary proves that per run -- it sheds everything, writes inside the workspace, and the kernel
  // refuses it outside -- and the axis reads that proof rather than an empty scan.
  const { processAxisEnforced } = await import("../../lib/confinement.mjs");
  const canary = measured().boundary_canary;
  const networkPolicy = "provider-required-unrestricted";
  const groupSweep = { pgid: 4242, members: [] };
  const clean = { scanned: true, scanners: ["environment-marker", "open-path", "process-group"], marker_used: true, paths: 3, group_enumerated: 1, survivors: [] };
  assert.equal(canary.out_of_band.stripped.confined, true, "the committed canary carries no proof about a stripped descendant");
  assert.equal(canary.out_of_band.stripped.ran, true);
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep, survivorSweep: clean, networkPolicy }), true);

  // Take the proof away and empty scans do not stand in for it.
  for (const broken of [
    { ...canary.out_of_band.stripped, confined: false },
    { ...canary.out_of_band.stripped, ran: false },
    undefined
  ]) {
    const without = { ...canary, out_of_band: { ...canary.out_of_band, stripped: broken } };
    assert.equal(
      processAxisEnforced({ canary: without, polls: 12, groupSweep, survivorSweep: clean, networkPolicy }),
      false,
      `an empty enumeration stood in for the boundary's own answer: ${JSON.stringify(broken)}`
    );
    assert.equal(issuanceGate(measured({ boundary_canary: without })).official, false);
  }

  // And the record says what holds it, so a reader is not left to infer it from the scans.
  const committed = observations("strict-lane.darwin.seatbelt.canary.json").captured;
  assert.equal(committed.out_of_band.stripped.confined, true, "the recorded lane did not demonstrate the confinement it claims");
  assert.match(String(measured().descendants.residual), /cannot reach anything else/u);
});

test("a_descendant_that_strips_its_marks_is_still_enumerated_by_its_group", async () => {
  // The escape the other two scanners cannot see: a child spawned with `env: {}`, a working
  // directory outside the run and every inherited handle closed carries no marker and holds none of
  // the run's paths. It is still in the process group it was forked into, and the group is walked
  // rather than asked -- so "found nothing" is evidence only when the group was enumerated.
  const { survivorSweep, processAxisEnforced } = await import("../../lib/confinement.mjs");
  const table = () => [
    { pid: 4242, ppid: 100, pgid: 4242, start: "A" },   // the agent, group leader
    { pid: 4300, ppid: 1, pgid: 4242, start: "B" },     // stripped and reparented, same group
    { pid: 5000, ppid: 1, pgid: 5000, start: "C" }      // somebody else's process
  ];
  const stripped = survivorSweep({
    marker: "run-1",
    paths: [],
    groupId: 4242,
    platform: "linux",
    procRoot: "/nonexistent",
    self: 4242,
    exclude: () => [],
    run: () => ({ error: null, stdout: "" }),
    table
  });
  assert.ok(stripped.scanners.includes("process-group"), stripped.scanners.join(", "));
  assert.equal(stripped.group_enumerated, 2, "the group was not walked");
  assert.deepEqual(stripped.survivors, [4300], "a descendant that stripped its marks was not enumerated");
  const canary = measured().boundary_canary;
  const networkPolicy = "provider-required-unrestricted";
  const groupSweep = { pgid: 4242, members: [4300] };
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep, survivorSweep: stripped, networkPolicy }), false);

  // And the rule this is really about: an empty answer from scanners that never enumerated the
  // group is not proof of an empty room.
  const silent = { scanned: true, scanners: ["environment-marker", "open-path"], marker_used: true, paths: 3, group_enumerated: null, survivors: [] };
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep, survivorSweep: silent, networkPolicy }), false, "an unenumerated group passed as enforced");
  assert.match(issuanceGate(measured({ descendants: { ...measured().descendants, survivor_sweep: silent } })).record_problems.join(" "), /never enumerated/u);
  const enumerated = { ...silent, scanners: [...silent.scanners, "process-group"], group_enumerated: 1 };
  assert.equal(processAxisEnforced({ canary, polls: 12, groupSweep, survivorSweep: enumerated, networkPolicy }), true);
});

test("the_open_path_scan_answers_the_same_question_on_both_platforms", async () => {
  // The linux half of the sweep runs against `/proc`, which this host does not have, so it is
  // exercised here against a `/proc` shaped by hand. The bug it closes is specific: a scan that
  // read the listing and stopped would call every numbered directory a survivor -- every process
  // on the host, in a record, and a moment later killed. A pid is a holder only when a *resolved*
  // link of that process lands inside one of the run's own directories.
  const { openPathHolders } = await import("../../lib/confinement.mjs");
  const base = mkdtempSync(join(tmpdir(), "aos-proc-"));
  try {
    const workspace = join(base, "workspaces", "run-1", "FAM-1");
    const elsewhere = join(base, "elsewhere");
    const procRoot = join(base, "proc");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    const process_ = (pid, links) => {
      mkdirSync(join(procRoot, String(pid), "fd"), { recursive: true });
      for (const [name, target] of Object.entries(links)) symlinkSync(target, join(procRoot, String(pid), name));
    };
    process_(1, { cwd: "/" });
    process_(200, { cwd: workspace });                       // a descendant that kept the cwd
    process_(300, { cwd: elsewhere });                       // somebody else's process
    process_(400, { cwd: elsewhere });
    symlinkSync(join(workspace, "note.txt"), join(procRoot, "400", "fd", "7"));  // holds a file open
    mkdirSync(join(procRoot, "self"), { recursive: true });  // not a pid, not a candidate
    const holders = openPathHolders([workspace], { platform: "linux", procRoot });
    assert.equal(holders.scanned, true);
    assert.deepEqual([...holders.pids].sort((a, b) => a - b), [200, 400], "the linux scan does not resolve links to pids");
    // The listing is not the answer: every process here is in `/proc` and only two hold the run.
    assert.equal(holders.pids.includes(1), false);
    assert.equal(holders.pids.includes(300), false);
    // And with nothing of the run's held, nothing is a survivor -- but the scan still ran.
    const none = openPathHolders([join(base, "empty")], { platform: "linux", procRoot });
    assert.deepEqual(none.pids, []);
    assert.equal(none.scanned, true);
    // A `/proc` that cannot be read is `scanned: false`, which the axis reads as not established
    // rather than as an empty room.
    assert.deepEqual(openPathHolders([workspace], { platform: "linux", procRoot: join(base, "absent") }), { scanned: false, pids: [] });

    // The sweep over the same fake tree: scoped to the run, and never itself or an ancestor.
    const sweep = survivorSweep({
      marker: "s",
      paths: [workspace],
      platform: "linux",
      procRoot,
      self: 200,
      exclude: () => [400],
      run: () => ({ error: null, stdout: "" })
    });
    assert.deepEqual(sweep.survivors, [], "the sweep swept itself or its ancestor");
    assert.ok(sweep.scanners.includes("open-path") && sweep.scanners.includes("environment-marker"));
    // Short session ids are scanned too: the variable name is what makes the match precise.
    assert.equal(sweep.marker_used, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a_cleanup_failure_is_redacted_on_every_surface_that_publishes_it", () => {
  // The confinement record is redacted; the run result carried the same failures as raw strings,
  // and that is the object `assess` stores and renders. Found by CI on linux, where the cleanup
  // this test's sibling provokes actually fails -- on darwin the sweep had already killed the
  // writer, the list was empty, and both shapes passed.
  const core = readFileSync(join(root, "lib", "core.mjs"), "utf8");
  assert.match(core, /scratch_not_removed: redactedFailures/u, "the result publishes the raw failures");
  assert.match(core, /redactedFailures\.push\(\.\.\.cleanupFailures\.map\(redactCleanupFailure\)\);/u, "the result's failures are not redacted");
  // Filled in the `finally`, and referenced rather than snapshotted: the result object is built
  // before the cleanup runs, so a `.map()` in the literal would always publish an empty list.
  assert.ok(core.indexOf("scratch_not_removed: redactedFailures") < core.indexOf("redactedFailures.push("), "the redaction runs before the result is built");
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

test("the_recorder_removes_the_staged_credential_even_when_the_lane_fails", () => {
  // The probe stages a copy of the operator's Codex credential to measure the lane. Its cleanup
  // lived after a rethrow, so a run whose canary failed -- the interesting case, the one somebody
  // runs while changing the profile -- left `agentHome/.codex/auth.json`, the base store and the
  // run scratch on disk. Read from the source, because the failing path cannot be provoked on a
  // host where the lane works.
  const probe = readFileSync(join(fixtureDir, "probes", "strict-lane.mjs"), "utf8");
  const finallyAt = probe.indexOf("} finally {");
  const rethrowAt = probe.indexOf("throw error;");
  assert.ok(finallyAt > 0 && rethrowAt > 0, "the probe no longer has the shape this checks");
  assert.ok(rethrowAt < finallyAt, "the rethrow is no longer inside the block the cleanup guards");
  for (const removal of ["const cleanupFailures = handle === null ? [] : handle.cleanup();", "for (const path of [base, agentHome, runScratch]) {"]) {
    const at = probe.indexOf(removal);
    assert.ok(at > finallyAt, `cleanup step is outside the finally: ${removal}`);
  }
  // And what cleanup returned is read rather than discarded: the observation used to be written as
  // a success whatever `handle.cleanup()` said, so a profile the kernel refused to delete was a
  // clean teardown and the row stayed eligible.
  assert.match(probe, /exit_status: cleanupFailures\.length === 0 \? 0 : 1/u, "the teardown observation ignores what cleanup returned");
  assert.match(probe, /not_removed: cleanupFailures\.map\(redactCleanupFailure\)/u, "what could not be removed is not recorded");
  // And the committed evidence says it worked, which is what the matrix reads cleanup from.
  const cleanup = observations("strict-lane.darwin.seatbelt.cleanup.json");
  assert.equal(cleanup.exit_status, 0);
  assert.deepEqual(cleanup.captured.not_removed, []);
  assert.deepEqual(cleanup.captured.removed, { profile_and_confinement_scratch: true, staged_runtime_config: true, agent_home: true, run_scratch: true, base_store: true });
  assert.deepEqual(cleanup.captured.outcomes, { canary: 0, auth: 0, exec: 0 });
});

test("a_row_whose_cited_runtime_did_not_run_is_not_official", () => {
  // `exec` was cited by the official row and never consumed: only the login observation's exit
  // code was read. A committed observation of `codex exec` exiting 71 -- the runtime failing to
  // start under the profile -- left the lane official, which is the lane claiming a runtime ran
  // under it on the evidence of a file saying it did not.
  const copy = mkdtempSync(join(tmpdir(), "aos-matrix-exec-"));
  try {
    cpSync(fixtureDir, copy, { recursive: true });
    const fixture = JSON.parse(readFileSync(join(copy, "support-matrix.json"), "utf8"));
    const official = fixture.lanes.find((row) => row.official === true);
    assert.ok(official.evidence.exec, "the official row does not cite an exec observation");
    for (const kind of ["exec", "runtime", "canary", "cleanup", "host"]) {
      const reference = official.evidence[kind];
      if (!reference) continue;
      const file = join(copy, reference.file);
      const observation = JSON.parse(readFileSync(file, "utf8"));
      observation.exit_status = 71;
      const bytes = Buffer.from(JSON.stringify(observation), "utf8");
      writeFileSync(file, bytes);
      const restated = JSON.parse(JSON.stringify(fixture));
      restated.lanes.find((row) => row.official === true).evidence[kind].digest = sha256Bytes(bytes);
      const row = supportMatrixDecisions(restated, copy).find((one) => one.official === true);
      assert.equal(row.decision.official, false, `${kind}: a row citing a run that exited 71 was issued`);
      assert.ok(row.decision.reasons.includes(ISSUANCE_REASONS.EVIDENCE_EXECUTION_FAILED), `${kind}: ${row.decision.reasons.join(", ")}`);
      assert.match(row.evidence_execution_failed.join(" "), new RegExp(`${kind}: exit 71`, "u"));
      // The committed bytes back, so the next citation is tested against a matrix whose other
      // rows still match what they declare.
      cpSync(join(fixtureDir, reference.file), file);
    }
    // And the teardown the probe recorded: a row whose cleanup observation says something stayed
    // behind cannot claim the lane was clean, however the row labels itself.
    const cleanupReference = official.evidence.cleanup;
    const cleanupFile = join(copy, cleanupReference.file);
    const cleanup = JSON.parse(readFileSync(cleanupFile, "utf8"));
    cleanup.captured.removed.staged_runtime_config = false;
    const cleanupBytes = Buffer.from(JSON.stringify(cleanup), "utf8");
    writeFileSync(cleanupFile, cleanupBytes);
    const restatedCleanup = JSON.parse(JSON.stringify(fixture));
    restatedCleanup.lanes.find((row) => row.official === true).evidence.cleanup.digest = sha256Bytes(cleanupBytes);
    const left = supportMatrixDecisions(restatedCleanup, copy).find((one) => one.official === true);
    assert.equal(left.decision.official, false, "a row whose probe left the staged credential behind was issued");
    assert.ok(left.decision.reasons.includes(ISSUANCE_REASONS.CLEANUP_UNVERIFIED), left.decision.reasons.join(", "));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("the_matrix_decides_the_process_axis_with_the_helper_a_run_uses", async () => {
  // Two formulas for one decision is one formula too many. The row used to take
  // `row.gate.process_enforced` on trust and hand the gate a `{ pgid: 0 }` sweep the canonical
  // helper rejects, so the table said official while the helper said the axis was not enforced.
  const { processAxisEnforced } = await import("../../lib/confinement.mjs");
  const captured = observations("strict-lane.darwin.seatbelt.canary.json").captured;
  assert.ok(Number.isInteger(captured.group_sweep?.pgid) && captured.group_sweep.pgid > 0, "the committed observation carries no real sweep");
  const row = supportMatrixDecisions(matrix).find((one) => one.official === true);
  assert.equal(row.decision.official, true);
  assert.equal(
    processAxisEnforced({
      canary: { result: captured.result, cells: captured.cells, out_of_band: captured.out_of_band },
      polls: captured.scan_polls,
      groupSweep: captured.group_sweep,
      survivorSweep: captured.survivor_sweep,
      networkPolicy: captured.network_policy
    }),
    true,
    "the table is official where the helper is not"
  );
  // The committed observation carries the sweep the helper requires, so the row is not resting on
  // a sweep the recorder invented for it.
  assert.equal(captured.survivor_sweep.scanned, true);
  assert.deepEqual(captured.survivor_sweep.survivors, []);
  assert.ok(captured.survivor_sweep.scanners.includes("environment-marker"));

  // Take the sweep out of the observation the row cites and the row goes with it.
  const copy = mkdtempSync(join(tmpdir(), "aos-matrix-sweep-"));
  try {
    cpSync(fixtureDir, copy, { recursive: true });
    const fixture = JSON.parse(readFileSync(join(copy, "support-matrix.json"), "utf8"));
    const reference = fixture.lanes.find((one) => one.official === true).evidence.canary;
    const file = join(copy, reference.file);
    const observation = JSON.parse(readFileSync(file, "utf8"));
    delete observation.captured.group_sweep;
    delete observation.captured.survivor_sweep;
    const bytes = Buffer.from(JSON.stringify(observation), "utf8");
    writeFileSync(file, bytes);
    fixture.lanes.find((one) => one.official === true).evidence.canary.digest = sha256Bytes(bytes);
    const withheld = supportMatrixDecisions(fixture, copy).find((one) => one.official === true);
    assert.equal(withheld.decision.official, false);
    assert.ok(withheld.decision.reasons.includes(ISSUANCE_REASONS.PROCESS_NOT_ENFORCED), withheld.decision.reasons.join(", "));
    assert.match(withheld.decision.record_problems.join(" "), /group_sweep/u);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("an_official_row_cites_every_kind_of_evidence_and_the_evidence_says_it_worked", () => {
  // The gate iterated whatever the row happened to cite, so every kind was optional: deleting
  // `runtime` and `exec` from the official row left one surviving citation, `everyCitedRan` was
  // satisfied by it, and the lane stayed official with nothing saying the runtime ever
  // authenticated or ran. And an observation that exited zero is not the same as one that did the
  // thing: a login that reported no login, an execution that did not answer.
  const copy = mkdtempSync(join(tmpdir(), "aos-matrix-kinds-"));
  try {
    cpSync(fixtureDir, copy, { recursive: true });
    const fixture = JSON.parse(readFileSync(join(copy, "support-matrix.json"), "utf8"));
    const official = fixture.lanes.find((row) => row.official === true);
    assert.deepEqual(Object.keys(official.evidence).sort(), [...STRICT_EVIDENCE_KINDS].sort(), "the official row does not cite every kind");
    for (const kind of STRICT_EVIDENCE_KINDS) {
      const without = JSON.parse(JSON.stringify(fixture));
      delete without.lanes.find((row) => row.official === true).evidence[kind];
      const row = supportMatrixDecisions(without, copy).find((one) => one.official === true);
      assert.equal(row.decision.official, false, `${kind}: a row that cites no ${kind} was issued`);
      assert.ok(row.decision.reasons.includes(ISSUANCE_REASONS.EVIDENCE_MISSING), `${kind}: ${row.decision.reasons.join(", ")}`);
      assert.deepEqual(row.evidence_missing, [kind]);
    }

    // The markers, not only the exit code.
    for (const [kind, mutate] of [
      ["runtime", (observation) => { observation.stderr.markers.logged_in = false; observation.stdout.markers.logged_in = false; }],
      ["exec", (observation) => { observation.captured.answered_expected_word = false; }]
    ]) {
      const reference = official.evidence[kind];
      const file = join(copy, reference.file);
      const observation = JSON.parse(readFileSync(file, "utf8"));
      mutate(observation);
      const bytes = Buffer.from(JSON.stringify(observation), "utf8");
      writeFileSync(file, bytes);
      const restated = JSON.parse(JSON.stringify(fixture));
      restated.lanes.find((row) => row.official === true).evidence[kind].digest = sha256Bytes(bytes);
      const row = supportMatrixDecisions(restated, copy).find((one) => one.official === true);
      assert.equal(row.decision.official, false, `${kind}: an observation whose markers say it did not work was issued`);
      assert.ok(row.decision.reasons.includes(ISSUANCE_REASONS.EVIDENCE_EXECUTION_FAILED), row.decision.reasons.join(", "));
      assert.match(row.evidence_markers_unmet.join(" "), new RegExp(kind, "u"));
      cpSync(join(fixtureDir, reference.file), file);
    }

    // And the identity the lane claims comes from the observation of the runtime that
    // authenticated, not from the canary beside it -- the canary is a node program.
    const rows = supportMatrixDecisions(fixture, copy);
    const row = rows.find((one) => one.official === true);
    assert.equal(row.decision.official, true);
    const auth = observations("strict-lane.darwin.seatbelt.codex-auth.json");
    assert.equal(auth.captured.runtime_identity.matches_adapter, true);
    assert.match(String(auth.captured.runtime_command_digest), /^sha256:[0-9a-f]{64}$/u);
    // Take the identity out of the runtime's own observation and the lane goes with it, whatever
    // the canary beside it says about the node program that measured the boundary.
    {
      const reference = official.evidence.runtime;
      const file = join(copy, reference.file);
      const observation = JSON.parse(readFileSync(file, "utf8"));
      delete observation.captured.runtime_identity;
      const bytes = Buffer.from(JSON.stringify(observation), "utf8");
      writeFileSync(file, bytes);
      const restated = JSON.parse(JSON.stringify(fixture));
      restated.lanes.find((one) => one.official === true).evidence.runtime.digest = sha256Bytes(bytes);
      const withoutIdentity = supportMatrixDecisions(restated, copy).find((one) => one.official === true);
      assert.equal(withoutIdentity.decision.official, false, "the lane was issued on an identity the runtime's own evidence does not carry");
      assert.ok(withoutIdentity.decision.reasons.includes(ISSUANCE_REASONS.RUNTIME_IDENTITY_UNVERIFIED), withoutIdentity.decision.reasons.join(", "));
      cpSync(join(fixtureDir, reference.file), file);
    }
    // And a teardown that says something stayed behind is not a clean one, whatever the four
    // booleans beside it say.
    {
      const reference = official.evidence.cleanup;
      const file = join(copy, reference.file);
      const observation = JSON.parse(readFileSync(file, "utf8"));
      observation.captured.not_removed = [{ class: "confinement-scratch", path_digest: `sha256:${"7".repeat(64)}`, code: "EPERM" }];
      const bytes = Buffer.from(JSON.stringify(observation), "utf8");
      writeFileSync(file, bytes);
      const restated = JSON.parse(JSON.stringify(fixture));
      restated.lanes.find((one) => one.official === true).evidence.cleanup.digest = sha256Bytes(bytes);
      const left = supportMatrixDecisions(restated, copy).find((one) => one.official === true);
      assert.equal(left.decision.official, false, "a teardown that left the profile behind was issued");
      assert.ok(left.decision.reasons.includes(ISSUANCE_REASONS.CLEANUP_UNVERIFIED), left.decision.reasons.join(", "));
      cpSync(join(fixtureDir, reference.file), file);
    }
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("an_unmeasured_network_state_withholds_rather_than_defaulting_to_allowed", async () => {
  // Everything that was not the word "disabled" expected the connect to succeed, and the
  // authenticity check took any string for the policy and never read the transport at all. A record
  // could name a policy nobody has measured, publish `provider_transport: null`, and be official.
  const { NETWORK_POLICIES, canonicalExpectation } = await import("../../lib/confinement.mjs");
  for (const policy of NETWORK_POLICIES) assert.ok(["allowed", "denied"].includes(canonicalExpectation("network_outbound_connect", policy)), policy);
  for (const unknown of ["WITHHELD", "NOT_OBSERVED", "", null, undefined, "unrestricted"]) {
    assert.equal(canonicalExpectation("network_outbound_connect", unknown), null, String(unknown));
  }
  const withheld = issuanceGate(measured({ network_policy: "WITHHELD" }));
  assert.equal(withheld.official, false);
  assert.match(withheld.record_problems.join(" "), /network_policy/u);
  const noTransport = issuanceGate(measured({ network: { task_external: "NOT_OBSERVED", enforcement: "kernel" } }));
  assert.equal(noTransport.official, false);
  assert.match(noTransport.record_problems.join(" "), /provider_transport/u);
  assert.equal(noTransport.network.provider_transport, null, "an unstated transport was published as a value");
  const madeUpEnforcement = issuanceGate(measured({ network: { provider_transport: "allowed", task_external: "NOT_OBSERVED", enforcement: "hopefully" } }));
  assert.equal(madeUpEnforcement.official, false);
  assert.match(madeUpEnforcement.record_problems.join(" "), /enforcement/u);
  // A disabled policy whose transport is allowed describes two boundaries at once.
  const contradictory = issuanceGate(measured({ network_policy: "disabled", network: { provider_transport: "allowed", task_external: "NOT_OBSERVED", enforcement: "kernel" } }));
  assert.equal(contradictory.official, false);
  assert.match(contradictory.record_problems.join(" "), /provider_transport/u);
});

test("a_workspace_that_resolves_into_the_store_is_refused_however_it_is_spelled", async () => {
  // `AOS_WORKSPACES=/tmp/ws` where `/tmp/ws -> <store>/workspaces` is outside the store to a string
  // comparison and inside it to the kernel, which is the only reader that matters: the child's cwd
  // is the resolved path. Checked in all three places the containment question is asked.
  const { workspacesRoot } = await import("../../lib/store.mjs");
  const { renderSeatbeltProfile, isolationPolicyFor } = await import("../../lib/confinement.mjs");
  const base = mkdtempSync(join(tmpdir(), "aos-symlink-ws-"));
  const previous = process.env.AOS_WORKSPACES;
  try {
    const store = join(base, "store");
    mkdirSync(join(store, "workspaces"), { recursive: true });
    const link = join(base, "ws");
    symlinkSync(join(store, "workspaces"), link);

    process.env.AOS_WORKSPACES = link;
    assert.throws(() => workspacesRoot(store), { message: /^AOS_WORKSPACES_INSIDE_STORE/u });
    process.env.AOS_WORKSPACES = join(base, "outside");
    assert.equal(workspacesRoot(store), realpathSync(base) === base ? join(base, "outside") : join(realpathSync(base), "outside"));

    // The renderer refuses the same layout, in both directions.
    const policy = isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: (await import("../../lib/profile.mjs")).ADAPTERS["codex-cli.v1"] });
    const bindings = {
      "@WORKSPACE@": "/private/var/aos/runs/run-1/workspaces/FAM-1",
      "@AOS_HOME@": "/private/var/aos",
      "@AGENT_HOME@": "/private/tmp/aos-agent-home-a",
      "@RUN_SCRATCH@": "/private/tmp/aos-prompt-a",
      "@NODE_TREE@": "/opt/node",
      "@RUNTIME_CLI_TREE@": "/opt/runtime"
    };
    assert.throws(() => renderSeatbeltProfile(policy, bindings), { message: /^AOS_ISOLATION_WORKSPACE_INSIDE_STORE/u });
    assert.throws(() => renderSeatbeltProfile(policy, { ...bindings, "@WORKSPACE@": "/private/var" }), { message: /^AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME/u });

    // And the spawn, which is the last place to say no: the workspace it is handed is a link into
    // the store, and the run is refused rather than started in it.
    const { runProcess } = await import("../../lib/core.mjs");
    const aosHome = join(base, "store2");
    mkdirSync(join(aosHome, "workspaces", "run-1"), { recursive: true });
    const sneaky = join(base, "sneaky");
    symlinkSync(join(aosHome, "workspaces", "run-1"), sneaky);
    await assert.rejects(
      runProcess({ id: "x", command: process.execPath, args: ["-e", "0"] }, { workspace: sneaky, family: "FAM-1", stage: "s", prompt: "p", promptFile: join(sneaky, "task.md"), session: "symlink-run", timeoutMs: 30000, aosHome }),
      /AOS_ISOLATION_WORKSPACE_INSIDE_STORE/u
    );
  } finally {
    if (previous === undefined) delete process.env.AOS_WORKSPACES;
    else process.env.AOS_WORKSPACES = previous;
    rmSync(base, { recursive: true, force: true });
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
  // And the other direction, which is the one that hid a second formula: a row the gate made
  // official renders official even where the fixture's own label disagrees. The label declares
  // which rows must carry evidence; whether they do is the decision's to say, and the table shows
  // the decision it was handed.
  const disagreeing = rows.map((row) => ({ ...row, official: false, decision: { ...row.decision, official: true, reasons: [] } }));
  const rendered_ = renderSupportMatrix(disagreeing);
  assert.equal(rendered_.split("OFFICIAL").length - 1, rows.length, "a row the gate made official rendered as withheld");
  const denied = rows.map((row) => ({ ...row, official: true, decision: { ...row.decision, official: false, reasons: [ISSUANCE_REASONS.LANE_NOT_PROVEN] } }));
  assert.equal(renderSupportMatrix(denied).includes("OFFICIAL"), false, "a row the gate withheld rendered as official");
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

test("the_profile_a_number_is_bound_to_names_the_lane_it_actually_ran_under", async () => {
  // Both CLI paths built the cohort with a literal BEST_EFFORT_CLI, so `AOS_ISOLATION=STRICT`
  // changed the boundary and left the profile digest identical: a cycle could not tell that its
  // second run had a boundary its first did not, and the two would have been averaged together.
  const { buildProfile } = await import("../../lib/profile.mjs");
  const { isolationPolicyDigestOf, isolationPolicyFor, runtimeConfigDigestFor } = await import("../../lib/confinement.mjs");
  const { ADAPTERS } = await import("../../lib/profile.mjs");
  const agent = { id: "a", command: process.execPath, args: [], adapter: "codex-cli.v1", runtime_name: "codex" };
  const digestFor = (lane, backend) => buildProfile({
    profileId: "a",
    agent,
    isolation: lane,
    isolationPolicyDigest: isolationPolicyDigestOf(isolationPolicyFor({ level: lane, platform: "darwin", backend, adapter: ADAPTERS["codex-cli.v1"] })),
    probe: () => ""
  }).profile_digest;
  const strictPolicy = isolationPolicyDigestOf(isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: ADAPTERS["codex-cli.v1"] }));
  // The level is a word; the policy digest is what the word means on this platform, and it has to
  // be on the profile or the cohort is named rather than described.
  assert.equal(
    buildProfile({ profileId: "a", agent, isolation: "STRICT", isolationPolicyDigest: strictPolicy, probe: () => "" }).isolation_policy_digest,
    strictPolicy
  );
  const strict = digestFor("STRICT", "macos-seatbelt");
  const best = digestFor("BEST_EFFORT_CLI", "none");
  assert.notEqual(strict, best, "two lanes produced one cohort");
  // And STRICT on a host with no backend is not quietly the same profile: there is no policy to
  // digest, so the profile cannot be built and the refusal is named.
  assert.throws(() => digestFor("STRICT", "none"), { message: /^AOS_ISOLATION_BACKEND_INVALID/u });

  // The staged runtime configuration is bound by its bytes, so an MCP server appearing between two
  // runs splits the cohort instead of hiding inside it.
  const home = mkdtempSync(join(tmpdir(), "aos-config-digest-"));
  try {
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "gpt-5"\n');
    const before = runtimeConfigDigestFor(ADAPTERS["codex-cli.v1"], { HOME: home });
    assert.match(String(before), /^sha256:[0-9a-f]{64}$/u);
    writeFileSync(join(home, ".codex", "config.toml"), 'model = "gpt-5"\n[mcp_servers.thing]\ncommand = "x"\n');
    assert.notEqual(runtimeConfigDigestFor(ADAPTERS["codex-cli.v1"], { HOME: home }), before);
    // The credential is deliberately not part of it: a refreshed token is not a new cohort.
    writeFileSync(join(home, ".codex", "auth.json"), '{"tokens":{"refresh_token":"rt_aaaaaaaaaaaaaaaaaaaa"}}');
    const withAuth = runtimeConfigDigestFor(ADAPTERS["codex-cli.v1"], { HOME: home });
    writeFileSync(join(home, ".codex", "auth.json"), '{"tokens":{"refresh_token":"rt_bbbbbbbbbbbbbbbbbbbb"}}');
    assert.equal(runtimeConfigDigestFor(ADAPTERS["codex-cli.v1"], { HOME: home }), withAuth);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("no_environment_variable_may_carry_the_store_path", async () => {
  // The rule is that the agent is not told where AOS keeps its runs. It was checked by looking for
  // the variable called AOS_HOME, and the path travelled in AOS_WORKSPACE instead. This checks the
  // values of the whole environment, which is the thing the rule is about.
  const { assertNoStorePathInEnv } = await import("../../lib/confinement.mjs");
  const store = "/operator/private/.aos";
  assert.throws(
    () => assertNoStorePathInEnv({ PATH: "/usr/bin", AOS_WORKSPACE: `${store}/runs/run-1/workspaces/FAM-1` }, store),
    { message: /^AOS_ISOLATION_STORE_PATH_IN_ENV AOS_WORKSPACE/u }
  );
  assert.throws(
    () => assertNoStorePathInEnv({ SOMETHING_ELSE: `--data-dir=${store}` }, store),
    { message: /^AOS_ISOLATION_STORE_PATH_IN_ENV SOMETHING_ELSE/u }
  );
  // And an environment that says nothing about it passes, including the relative form a run uses.
  const clean = { PATH: "/usr/bin", HOME: "/tmp/aos-agent-home-x", AOS_WORKSPACE: ".", AOS_TASK_FILE: "/tmp/aos-prompt-x/prompt.txt" };
  assert.deepEqual(assertNoStorePathInEnv(clean, store), clean);
  assert.deepEqual(assertNoStorePathInEnv(clean, null), clean);
});

test("an_assessment_records_the_lane_it_ran_under_in_the_profile_it_is_bound_to", () => {
  // Through the CLI, because the defect was in the CLI: the run is confined by the lane the
  // operator named and the cohort was recorded under a different one.
  const cwd = mkdtempSync(join(tmpdir(), "aos-lane-profile-"));
  try {
    const agent = join(cwd, "agent.mjs");
    writeFileSync(agent, "process.stdout.write('done\\n');\n");
    run(cwd, ["agent", "add", "solo", "--command", process.execPath, "--arg", agent]);
    const assessed = run(cwd, ["assess", "--json", "--timeout-ms", "30000"], 3);
    const result = JSON.parse(assessed.stdout);
    assert.equal(result.isolation.level, "BEST_EFFORT_CLI");
    for (const entry of result.opportunity_profile) {
      assert.equal(entry.isolation_level, "BEST_EFFORT_CLI", "the profile names a lane the run did not use");
      assert.match(String(entry.isolation_policy_digest), /^sha256:[0-9a-f]{64}$/u);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the_profile_digest_binds_the_boundary_and_the_runtime_configuration", async () => {
  // Both fields were stored on the profile and left out of the digest, so a Seatbelt policy change
  // or a new MCP server in `config.toml` aggregated into the cohort it changed. The digest is
  // recomputed here for each, which is the assertion the previous round's test did not make.
  const { buildProfile, profileDigestOf } = await import("../../lib/profile.mjs");
  const agent = { id: "a", command: process.execPath, args: [], adapter: "codex-cli.v1", runtime_name: "codex" };
  const built = (over) => buildProfile({ profileId: "a", agent, isolation: "STRICT", probe: () => "", ...over });
  const base = built({ isolationPolicyDigest: `sha256:${"a".repeat(64)}`, runtimeConfigDigest: `sha256:${"b".repeat(64)}` });
  const otherPolicy = built({ isolationPolicyDigest: `sha256:${"c".repeat(64)}`, runtimeConfigDigest: `sha256:${"b".repeat(64)}` });
  const otherConfig = built({ isolationPolicyDigest: `sha256:${"a".repeat(64)}`, runtimeConfigDigest: `sha256:${"d".repeat(64)}` });
  assert.notEqual(base.profile_digest, otherPolicy.profile_digest, "a different boundary aggregated into one cohort");
  assert.notEqual(base.profile_digest, otherConfig.profile_digest, "a different runtime configuration aggregated into one cohort");
  assert.equal(base.profile_digest, built({ isolationPolicyDigest: `sha256:${"a".repeat(64)}`, runtimeConfigDigest: `sha256:${"b".repeat(64)}` }).profile_digest);
  // And through the digest function directly, over the stored fields, so the binding is in the
  // digest rather than in what `buildProfile` happens to pass.
  assert.notEqual(
    profileDigestOf({ ...base, isolation_policy_digest: `sha256:${"e".repeat(64)}` }),
    profileDigestOf(base)
  );
  assert.notEqual(
    profileDigestOf({ ...base, runtime_config_digest: `sha256:${"f".repeat(64)}` }),
    profileDigestOf(base)
  );
});

test("no_run_workspace_lives_inside_the_store", async () => {
  // The last disclosure: an agent reads its own working directory out of `getcwd` whatever the
  // environment says, and the workspace used to be `<store>/runs/<run>/workspaces/<family>`. The
  // store keeps AOS's records; the workspaces have their own root beside it.
  const { runPaths, workspacesRoot } = await import("../../lib/store.mjs");
  const home = "/Users/alice/.aos";
  const paths = runPaths(home, "run-1");
  assert.equal(paths.workspaces.startsWith(`${home}/`), false, `the workspace is inside the store: ${paths.workspaces}`);
  assert.equal(paths.workspaces.includes(home), false, "the workspace path spells the store out");
  assert.equal(workspacesRoot(home), "/Users/alice/aos-workspaces");
  assert.equal(paths.workspaces, "/Users/alice/aos-workspaces/run-1");
  // One directory per run, so a run's workspaces go with it and a sibling run's are a directory
  // the boundary denies by name.
  assert.notEqual(runPaths(home, "run-2").workspaces, paths.workspaces);
  // The store keeps its own records where they were.
  assert.ok(paths.manifest.startsWith(`${home}/`) && paths.result.startsWith(`${home}/`));
});

test("no_committed_observation_carries_a_runtime_transcript", () => {
  // The package ships `fixtures/confinement/`, and SSOT excludes raw transcripts from committed
  // evidence. What a runtime wrote is recorded as bytes, lines, a digest and a set of markers.
  // The recorder first, because the committed files are only as good as what writes them and this
  // lane can be re-recorded on any darwin host with Codex: what a runtime wrote is summarised,
  // never copied.
  const probe = readFileSync(join(fixtureDir, "probes", "strict-lane.mjs"), "utf8");
  assert.match(probe, /stdout: streamSummary\(result\.stdout\),\n\s*stderr: streamSummary\(result\.stderr\),/u, "the recorder no longer summarises the runtime's streams");
  assert.equal(/stdout_excerpt: excerpt\(result\./u.test(probe), false, "the recorder copies a runtime stream verbatim");
  const names = readdirSync(join(fixtureDir, "observations")).filter((name) => name.startsWith("strict-lane."));
  assert.ok(names.length >= 5, `only ${names.length} observations`);
  for (const name of names) {
    const observation = observations(name);
    for (const key of ["stdout", "stderr"]) {
      const stream = observation[key];
      if (stream === undefined) continue;
      assert.equal(typeof stream, "object", `${name}: ${key} is not a summary`);
      assert.match(String(stream.digest), /^sha256:[0-9a-f]{64}$/u, `${name}: ${key} has no digest`);
      assert.deepEqual(Object.keys(stream).sort(), ["bytes", "digest", "lines", "markers"], `${name}: ${key} carries more than a summary`);
    }
    const text = JSON.stringify(observation);
    // The runtime's own words, its banner and its session id: none of them are here. The host
    // description is this machine's own output and is exempt -- it is the one thing a reader needs
    // in full, and it is scrubbed of paths and host name.
    if (name !== "strict-lane.darwin.host.json") {
      for (const pattern of [/session[_-]?id/iu, /conversation/iu, /model context/iu, /tokens used/u]) {
        assert.doesNotMatch(text, pattern, `${name} carries ${pattern}`);
      }
    }
    // A transcript is long and has lines in it. Every string in an observation is a field AOS
    // wrote -- a path placeholder, a digest, a status, this repository's own one-line prompt --
    // and none of them is either. The host description is the exception and says why above.
    if (name === "strict-lane.darwin.host.json") continue;
    const strings = [];
    const walk = (value, path) => {
      if (typeof value === "string") { strings.push([path, value]); return; }
      if (Array.isArray(value)) { value.forEach((one, index) => walk(one, `${path}[${index}]`)); return; }
      if (value && typeof value === "object") { for (const [key, one] of Object.entries(value)) walk(one, `${path}.${key}`); }
    };
    walk(observation, name);
    for (const [path, value] of strings) {
      if (path.endsWith(".command") || path.endsWith(".prompt")) continue;
      assert.ok(value.length <= 200, `${path} is ${value.length} characters long, which is not a field`);
      assert.equal(value.includes("\n"), false, `${path} carries more than one line`);
    }
  }
});

test("a_staged_credential_printed_by_the_agent_is_scrubbed_from_the_public_result", { skip: process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? false : "NOT_OBSERVED: the staged-credential path needs a STRICT backend" }, async () => {
  // The producer to the consumer, through `runProcess`: a real STRICT run whose agent reads its own
  // staged `auth.json` and prints it. The previous test built its own scrubber and asserted on that,
  // so replacing the staged secrets with `[]` at the one binding in `lib/core.mjs` left it green
  // while the token reached `stdout_excerpt`.
  const { runProcess } = await import("../../lib/core.mjs");
  const base = mkdtempSync(join(tmpdir(), "aos-staged-secret-"));
  const token = "rt_opaque_refresh_credential_0123456789abcdef";
  const opaque = "Zm9vYmFyLXVucmVjb2duaXNhYmxlLWNyZWRlbnRpYWwtMDEyMzQ1Njc4OQ";
  // Short, and with a space in it: length and shape were the only tests staging applied, so this
  // was collected by nothing and printed into the public result verbatim.
  const short = "brief one";
  try {
    const operatorHome = join(base, "operator");
    const workspace = join(base, "workspaces", "run-1", "FAM-1");
    const aosHome = join(base, "home");
    mkdirSync(join(operatorHome, ".codex"), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(aosHome, "runs"), { recursive: true });
    // Two values, deliberately: one the shape rules know (`rt_…`, a vendor-prefixed token) and one
    // nothing could guess -- an opaque blob under a field name no pattern lists. The second is what
    // proves the binding, because only the exact values staging copied can remove it.
    writeFileSync(join(operatorHome, ".codex", "auth.json"), JSON.stringify({ tokens: { refresh_token: token }, session: { material: opaque, brief: short } }));
    writeFileSync(join(operatorHome, ".codex", "config.toml"), 'model = "stub"\n');
    // The agent prints whatever its runtime config directory holds -- which is what a task that
    // reads its own credential looks like from outside.
    const agent = join(workspace, "agent.mjs");
    writeFileSync(agent, 'import { readFileSync, readdirSync } from "node:fs";\nimport { join } from "node:path";\nconst dir = process.env.CODEX_HOME;\nif (dir) { for (const name of readdirSync(dir)) process.stdout.write(readFileSync(join(dir, name), "utf8")); }\nelse process.stdout.write("no staged config\\n");\n');
    const result = await runProcess(
      // The identity is what earns the staging: the adapter is claimed here by node, which is not
      // Codex, so nothing is staged and the child has no CODEX_HOME at all.
      { id: "impostor", command: process.execPath, args: ["agent.mjs"], adapter: "codex-cli.v1" },
      { workspace, family: "FAM-1", stage: "probe", prompt: "p", promptFile: join(workspace, "task.md"), session: "staged-secret-run", timeoutMs: 60000, isolation: "STRICT", aosHome, env: { HOME: operatorHome }, operatorHome }
    );
    const published = JSON.stringify(result);
    assert.equal(published.includes(token), false, "the staged credential reached the public result");
    assert.equal(result.confinement.holes.length, 0, "a credential was staged for an unidentified executable");
    assert.equal(result.confinement.runtime_identity.matches_adapter, false);
    assert.match(result.stdout_excerpt, /no staged config/u, "the impostor was handed a runtime config directory");
    // And the gate: an unidentified executable cannot carry the lane its adapter names.
    const decision = issuanceGate(result.confinement);
    assert.equal(decision.official, false);
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.RUNTIME_IDENTITY_UNVERIFIED), decision.reasons.join(", "));

    // The other half, and the one that exercises the scrubber: an executable that *is* the runtime
    // the adapter names -- here a script in the tree Codex ships in, verified the same way -- gets
    // the staged copy, reads it, and prints it. What reaches the public result is the redaction.
    const runtime = join(base, "runtime", "node_modules", "@openai", "codex", "bin", "codex.js");
    mkdirSync(join(base, "runtime", "node_modules", "@openai", "codex", "bin"), { recursive: true });
    // It prints the *values*, not the file: a bare `shortsecret` with no key beside it is a string
    // no shape rule can recognise, so what removes it is the exact-value scrubber built from what
    // staging copied -- which is the binding under test. Printing the JSON would have let the
    // credential-field rule pass this without the binding working at all.
    writeFileSync(runtime, [
      "#!/usr/bin/env node",
      'import { readFileSync, readdirSync } from "node:fs";',
      'import { join } from "node:path";',
      "const dir = process.env.CODEX_HOME;",
      "const leaves = (value) => (typeof value === \"string\" ? [value] : value && typeof value === \"object\" ? Object.values(value).flatMap(leaves) : []);",
      "for (const name of readdirSync(dir)) {",
      '  const text = readFileSync(join(dir, name), "utf8");',
      "  try { for (const leaf of leaves(JSON.parse(text))) process.stdout.write(`${leaf}\\n`); }",
      "  catch { process.stdout.write(text); }",
      "}"
    ].join("\n") + "\n", { mode: 0o755 });
    const staged = await runProcess(
      { id: "codexish", command: runtime, args: [], adapter: "codex-cli.v1" },
      {
        workspace, family: "FAM-1", stage: "probe", prompt: "p", promptFile: join(workspace, "task.md"),
        session: "staged-secret-run-2", timeoutMs: 60000, isolation: "STRICT", aosHome, env: { HOME: operatorHome },
        // The account whose credential is copied. Production reads it from the AOS process; naming
        // it here is what makes this test about the token it wrote rather than about whichever
        // ~/.codex the machine running the suite happens to have.
        operatorHome,
        // The identity this run is about, supplied rather than read: whether a file under a CI
        // runner's home is VERIFIED depends on that machine's directory permissions, and this test
        // is about what happens to a credential once staging has been earned. The refusal above
        // uses the real describer, so the two halves together cover both answers.
        identify: (command) => ({
          identity_status: "VERIFIED",
          identity_digest: `sha256:${"3".repeat(64)}`,
          resolved_realpath: command,
          interpreter_chain: []
        })
      }
    );
    assert.equal(staged.confinement.runtime_identity.matches_adapter, true, "the runtime tree was not recognised as this adapter's");
    assert.deepEqual(staged.confinement.holes[0]?.staged, ["auth.json", "config.toml"], `nothing was staged: ${JSON.stringify(staged.confinement.runtime_identity)}`);
    assert.equal(staged.exit_code, 0, staged.stderr_excerpt);
    assert.match(staged.stdout_excerpt, /redacted/u, "the staged credential was printed unredacted");
    assert.equal(JSON.stringify(staged).includes(token), false, "the staged credential reached the public result");
    // The one no shape knows: this is the exact-value scrubber built from what staging copied, and
    // nothing else in the product can remove it.
    assert.equal(JSON.stringify(staged).includes(opaque), false, "an unrecognisable staged credential reached the public result");
    assert.equal(JSON.stringify(staged).includes(short), false, "a short staged credential reached the public result");
    assert.equal(JSON.stringify(staged).includes(token), false, "the staged token reached the public result");
    assert.match(staged.stdout_excerpt, /\[redacted: runtime credential\]/u, "the staged values were not scrubbed by value");
    // The two no shape rule knows -- an opaque blob and a short value with a space in it -- are
    // removed by the list staging handed the scrubber, and nothing else in the product could have
    // removed them. The vendor-prefixed one is caught by shape first, which is the belt beside the
    // braces rather than a second chance for the others.
    assert.ok(staged.stdout_excerpt.split("[redacted: runtime credential]").length - 1 >= 2, staged.stdout_excerpt);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a_staged_credential_never_reaches_a_public_surface", async () => {
  // The staging is bound to the verified runtime, so this test supplies the identity the copy is
  // made for; the refusal has tests of its own in confinement.test.mjs and above.
  // Staging puts a copy of the runtime's credential where the assessed process can read it. The
  // exact-value scrubber was built from the environment alone, so a task that opened its staged
  // `auth.json` and printed what it found published it verbatim in `stdout_excerpt`.
  const { credentialValuesIn, stageRuntimeConfig } = await import("../../lib/confinement.mjs");
  const { redactText } = await import("../../lib/redact.mjs");
  const { ADAPTERS } = await import("../../lib/profile.mjs");
  const operator = mkdtempSync(join(tmpdir(), "aos-operator-home-"));
  const agentHome = mkdtempSync(join(tmpdir(), "aos-agent-home-"));
  const token = "rt_opaque_refresh_credential_0123456789abcdef";
  try {
    mkdirSync(join(operator, ".codex"));
    writeFileSync(join(operator, ".codex", "auth.json"), JSON.stringify({ tokens: { refresh_token: token, account_id: "acct" } }));
    writeFileSync(join(operator, ".codex", "config.toml"), 'model = "gpt-5"\n');
    const staged = stageRuntimeConfig(ADAPTERS["codex-cli.v1"], {}, agentHome, operator, {
      identity_status: "VERIFIED",
      identity_digest: `sha256:${"2".repeat(64)}`,
      resolved_realpath: "/opt/node_modules/@openai/codex/bin/codex.js",
      interpreter_chain: []
    });
    assert.deepEqual(staged.staged, ["auth.json", "config.toml"]);
    assert.ok(staged.secrets.includes(token), "the staged credential was not handed to the caller for scrubbing");
    assert.match(String(staged.digests["config.toml"]), /^sha256:[0-9a-f]{64}$/u);
    // What a run does with them: the exact values are removed from anything the child printed.
    const scrub = (text) => staged.secrets.reduce((carried, secret) => carried.split(secret).join("[redacted: runtime credential]"), text);
    assert.equal(scrub(`here is ${token} for you`).includes(token), false);

    // And the shapes, for a credential this run did not stage but a task printed anyway.
    assert.equal(redactText(`token is ${token}`).text.includes(token), false);
    const body = JSON.stringify({ refresh_token: "abcd1234efgh5678", account: "me" });
    const redacted = redactText(body);
    assert.equal(redacted.text.includes("abcd1234efgh5678"), false);
    assert.equal(JSON.parse(redacted.text).account, "me", "redaction broke the surrounding JSON");
    // Prose about credentials is not credential material.
    assert.equal(redactText("do not commit your private key").text, "do not commit your private key");
  } finally {
    for (const dir of [operator, agentHome]) rmSync(dir, { recursive: true, force: true });
  }
});

test("a_required_metric_with_an_unanswered_subcheck_withholds_the_score", () => {
  // Present is not "has a number". A required metric aggregates four questions, and it stays
  // non-null while one of them was never answered: a run whose M19 external-action subcheck was
  // null issued at 99. Missing is missing, and the unanswered question is named so the operator
  // knows which one to observe.
  const answered = (id, unanswered = null) => observationOf({
    metric_id: id,
    verifier_id: "official-issuance.test",
    subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: subcheck === unanswered ? null : true })),
    evidence_ids: ["e"],
    reason: "fixture"
  });
  const boundary = { officialIssuance: { official: true, reasons: [] } };
  const whole = METRIC_IDS.map((id) => answered(id));
  assert.equal(scoreRun(whole, boundary).issued, true);

  for (const [id, subcheck] of [["M19", "no-prohibited-external-action"], ["M14", METRICS.M14.subchecks[0]], ["M16", METRICS.M16.subchecks[1]]]) {
    const partial = whole.map((entry) => (entry.metric_id === id ? answered(id, subcheck) : entry));
    const scored = scoreRun(partial, boundary);
    assert.equal(scored.issued, false, `${id}: a required metric with an unanswered subcheck was issued`);
    assert.equal(scored.score, null);
    const blocker = scored.blockers.find((one) => one.code === "REQUIRED_METRIC_UNOBSERVED");
    assert.ok(blocker, scored.blockers.map((one) => one.code).join(", "));
    assert.match(blocker.detail, new RegExp(`${id} \\(${subcheck}\\)`, "u"));
  }

  // A metric that is not required keeps its partial answer: this is a rule about the six the
  // instrument cannot do without, not a rule against ever observing less.
  const optional = whole.map((entry) => (entry.metric_id === "M01" ? answered("M01", METRICS.M01.subchecks[0]) : entry));
  assert.equal(scoreRun(optional, boundary).issued, true);
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

  // A caller that supplies no verdict has measured no boundary. Absent evidence withholds exactly
  // like a negative verdict -- the review found this failing open, with a perfect observation set
  // returning issued:true and 100/100 while the claim stage said RUN_DIAGNOSTIC, which is a result
  // contradicting itself in two adjacent fields.
  for (const context of [undefined, {}, { safetyState: "S0" }, { officialIssuance: null }, { officialIssuance: undefined }]) {
    const unbounded = context === undefined ? scoreRun(observed) : scoreRun(observed, context);
    assert.equal(unbounded.issued, false, JSON.stringify(context));
    assert.equal(unbounded.score, null, JSON.stringify(context));
    assert.equal(unbounded.status, "INCOMPLETE", JSON.stringify(context));
    assert.equal(unbounded.claim_stage, "RUN_DIAGNOSTIC");
    const missing = unbounded.blockers.find((one) => one.code === "ISOLATION_NOT_OFFICIAL");
    assert.ok(missing, unbounded.blockers.map((one) => one.code).join(", "));
    assert.match(missing.detail, /no confinement verdict was supplied/u);
  }
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
