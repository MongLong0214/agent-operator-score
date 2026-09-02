import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { sha256Bytes } from "../../lib/digest.mjs";
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
  for (const removal of ["if (handle !== null) handle.cleanup();", "for (const path of [base, agentHome, runScratch]) rmSync(path, { recursive: true, force: true });"]) {
    const at = probe.indexOf(removal);
    assert.ok(at > finallyAt, `cleanup step is outside the finally: ${removal}`);
  }
  // And the committed evidence says it worked, which is what the matrix reads cleanup from.
  const cleanup = observations("strict-lane.darwin.seatbelt.cleanup.json");
  assert.deepEqual(cleanup.captured.removed, { staged_runtime_config: true, agent_home: true, run_scratch: true, base_store: true });
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
    processAxisEnforced({ canary: { result: captured.result, out_of_band: captured.out_of_band }, polls: captured.scan_polls, groupSweep: captured.group_sweep }),
    true,
    "the table is official where the helper is not"
  );

  // Take the sweep out of the observation the row cites and the row goes with it.
  const copy = mkdtempSync(join(tmpdir(), "aos-matrix-sweep-"));
  try {
    cpSync(fixtureDir, copy, { recursive: true });
    const fixture = JSON.parse(readFileSync(join(copy, "support-matrix.json"), "utf8"));
    const reference = fixture.lanes.find((one) => one.official === true).evidence.canary;
    const file = join(copy, reference.file);
    const observation = JSON.parse(readFileSync(file, "utf8"));
    delete observation.captured.group_sweep;
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

test("a_staged_credential_never_reaches_a_public_surface", async () => {
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
    const staged = stageRuntimeConfig(ADAPTERS["codex-cli.v1"], {}, agentHome, operator);
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
