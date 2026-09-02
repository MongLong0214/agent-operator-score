import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOUNDARY_CANARY_PROGRAM,
  CANARY_CELLS,
  CLAIM_STAGE_CEILING,
  DESCENDANT_SCAN,
  ISSUANCE_REASONS,
  SUPPORTED_RELEASE_SET,
  SUPPORT_LANES,
  adapterForPlatform,
  bubblewrapArgs,
  descendantTracker,
  evaluateCanary,
  isolationPolicyDigestOf,
  isolationPolicyFor,
  issuanceGate,
  issuanceGateForRun,
  laneOf,
  renderSeatbeltProfile,
  renderSupportMatrix,
  settleConfinement,
  stageRuntimeConfig,
  supportMatrixDecisions
} from "../../lib/confinement.mjs";
import { ADAPTERS } from "../../lib/profile.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const fixtureDir = join(root, "fixtures", "confinement");
const matrix = JSON.parse(readFileSync(join(fixtureDir, "support-matrix.json"), "utf8"));
const doc = readFileSync(join(root, "docs", "STRICT_CONFINEMENT_FEASIBILITY.md"), "utf8");

const codex = ADAPTERS["codex-cli.v1"];
const generic = ADAPTERS["generic-command.v1"];

const BINDINGS = Object.freeze({
  "@WORKSPACE@": "/private/var/aos/runs/run-1/workspaces/FAM-1",
  "@AOS_HOME@": "/private/var/aos",
  "@AGENT_HOME@": "/private/tmp/aos-agent-home-abc",
  "@RUN_SCRATCH@": "/private/tmp/aos-prompt-abc",
  "@NODE_TREE@": "/opt/node",
  "@RUNTIME_CLI_TREE@": "/opt/runtime/node_modules"
});
const OPERATOR_CONFIG_DIR = "/Users/someone/.codex";

// A record shaped the way `runProcess` produces one for a STRICT run that passed everything. Each
// negative test below breaks exactly one field of it, so what each test proves is that the one
// field is load-bearing and nothing else changed.
const canaryCells = () => Object.fromEntries(CANARY_CELLS.map((name) => [name, { expected: "denied", observed: "denied", errno: "EPERM" }]));

const passingRecord = (overrides = {}) => {
  const policy = isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: codex });
  return {
    schema: "aos-confinement-record.v1",
    level: "STRICT",
    platform: "darwin",
    backend: "macos-seatbelt",
    adapter: "codex-cli.v1",
    filesystem_enforced: true,
    process_enforced: true,
    network_policy: policy.network.policy,
    network: { provider_transport: "allowed", task_external: "NOT_OBSERVED", enforcement: "kernel" },
    policy_digest: isolationPolicyDigestOf(policy),
    rendered_profile_digest: sha256Bytes(Buffer.from("(version 1)\n")),
    setup_verified: true,
    // The evidence a run produces, not a shape that resembles it: the cells the shipped canary
    // reported, the checks made outside it, and the digest of the source that was run.
    boundary_canary: {
      result: "PASS",
      failed: [],
      cells: canaryCells(),
      out_of_band: { planted_intact: { outside: true, store_root: true, run_store: true }, descendant: { pid: 4243, observed_by_scan: true, dead_after_cleanup: true, escapee_confined: true, survivors: [] } },
      evidence_digest: sha256Bytes(Buffer.from("{}")),
      program_digest: sha256Bytes(Buffer.from(BOUNDARY_CANARY_PROGRAM)),
      scan_polls: 7
    },
    descendants: { scan: DESCENDANT_SCAN, poll_interval_ms: 200, polls: 12, tracked: [4242], leaked: [], survivors: [], group_sweep: { pgid: 4242, members: [] }, residual: "x" },
    cleanup_verified: true,
    support_status: "SUPPORTED_WITH_CONSTRAINTS",
    ...overrides
  };
};

test("never_issues_official_under_best_effort_cli_or_none", () => {
  // Over the support matrix first: the release declaration itself has no row where a non-STRICT
  // level is official. Then over the gate with a record that is perfect in every other respect,
  // because the matrix could be edited and the gate is what a run actually goes through.
  const rows = supportMatrixDecisions(matrix);
  assert.ok(rows.length >= 8, "the support matrix is too small to be the macOS/Linux x backend x level table");
  const nonStrict = rows.filter((row) => row.level !== "STRICT");
  assert.ok(nonStrict.length >= 4, "the matrix has no BEST_EFFORT_CLI / NONE rows to prove anything over");
  for (const row of nonStrict) {
    assert.equal(row.decision.official, false, `${row.platform}/${row.backend}/${row.level} is official`);
    assert.ok(row.decision.reasons.includes(ISSUANCE_REASONS.LEVEL_NOT_STRICT), `${row.platform}/${row.backend}/${row.level} lacks the level reason`);
  }
  assert.equal(rows.filter((row) => row.level !== "STRICT" && row.decision.official).length, 0);
  for (const level of ["BEST_EFFORT_CLI", "NONE"]) {
    const decision = issuanceGate(passingRecord({ level }));
    assert.equal(decision.official, false, level);
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.LEVEL_NOT_STRICT));
    assert.equal(decision.claim_stage_ceiling, CLAIM_STAGE_CEILING.withheld);
  }
});

test("issues_official_only_for_a_strict_record_that_passed_every_gate_on_a_proven_lane", () => {
  const decision = issuanceGate(passingRecord());
  assert.deepEqual(decision.reasons, []);
  assert.equal(decision.official, true);
  assert.equal(decision.isolation_level, "STRICT");
  assert.equal(decision.backend, "macos-seatbelt");
  assert.equal(decision.boundary_canary, "PASS");
  assert.equal(decision.claim_stage_ceiling, CLAIM_STAGE_CEILING.official);
  assert.equal(decision.platform_lane, "darwin/macos-seatbelt/codex-cli.v1");
  assert.equal(decision.network.task_external, "NOT_OBSERVED");
});

test("blocks_official_when_boundary_canary_fails", () => {
  for (const canary of [
    { result: "FAIL", failed: ["outside_read"], evidence_digest: sha256Bytes(Buffer.from("{}")), program_digest: null },
    { result: "NOT_RUN", reason: "backend probe refused", failed: [], evidence_digest: null, program_digest: null },
    null,
    undefined
  ]) {
    const decision = issuanceGate(passingRecord({ boundary_canary: canary }));
    assert.equal(decision.official, false, JSON.stringify(canary));
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.CANARY_NOT_PASS), JSON.stringify(canary));
    assert.notEqual(decision.boundary_canary, "PASS");
  }
});

test("blocks_official_when_descendant_leaks", () => {
  const leaked = issuanceGate(passingRecord({ descendants: { scan: "ancestry-poll", polls: 9, tracked: [4242], leaked: [4242], survivors: [], residual: "x" } }));
  assert.equal(leaked.official, false);
  assert.ok(leaked.reasons.includes(ISSUANCE_REASONS.LEAKED_DESCENDANT));
  // A survivor of the teardown is a cleanup failure as well as a leak, and both are named.
  const survived = issuanceGate(passingRecord({
    descendants: { scan: "ancestry-poll", polls: 9, tracked: [4242], leaked: [4242], survivors: [4242], residual: "x" },
    cleanup_verified: false
  }));
  assert.equal(survived.official, false);
  assert.ok(survived.reasons.includes(ISSUANCE_REASONS.LEAKED_DESCENDANT));
  assert.ok(survived.reasons.includes(ISSUANCE_REASONS.CLEANUP_UNVERIFIED));
});

test("blocks_official_when_cleanup_fails", () => {
  for (const cleanup of [false, null, undefined, "true"]) {
    const decision = issuanceGate(passingRecord({ cleanup_verified: cleanup }));
    assert.equal(decision.official, false, String(cleanup));
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.CLEANUP_UNVERIFIED), String(cleanup));
  }
  // The record leaves `runProcess` with cleanup unsettled and is settled by the `finally` that
  // removes the scratch directories. A settle that reports a directory left behind cannot verify.
  const record = passingRecord({ cleanup_verified: null });
  settleConfinement(record, ["/tmp/aos-agent-home-x: ENOTEMPTY"]);
  assert.equal(record.cleanup_verified, false);
  assert.equal(issuanceGate(record).official, false);
  const clean = passingRecord({ cleanup_verified: null });
  settleConfinement(clean, []);
  assert.equal(clean.cleanup_verified, true);
  assert.equal(issuanceGate(clean).official, true);
});

test("blocks_official_when_filesystem_process_or_setup_is_not_established", () => {
  const cases = [
    [{ filesystem_enforced: false }, ISSUANCE_REASONS.FILESYSTEM_NOT_ENFORCED],
    [{ filesystem_enforced: "true" }, ISSUANCE_REASONS.FILESYSTEM_NOT_ENFORCED],
    [{ process_enforced: false }, ISSUANCE_REASONS.PROCESS_NOT_ENFORCED],
    [{ setup_verified: false }, ISSUANCE_REASONS.SETUP_UNVERIFIED],
    [{ setup_verified: undefined }, ISSUANCE_REASONS.SETUP_UNVERIFIED],
    [{ policy_digest: null }, ISSUANCE_REASONS.POLICY_DIGEST_MISSING],
    [{ policy_digest: "3a84" }, ISSUANCE_REASONS.POLICY_DIGEST_MISSING],
    [{ backend: "none" }, ISSUANCE_REASONS.BACKEND_ABSENT],
    [{ backend: null }, ISSUANCE_REASONS.BACKEND_ABSENT],
    [{ support_status: "BLOCKED" }, ISSUANCE_REASONS.SUPPORT_STATUS],
    [{ support_status: "NOT_OBSERVED" }, ISSUANCE_REASONS.SUPPORT_STATUS]
  ];
  for (const [override, reason] of cases) {
    const decision = issuanceGate(passingRecord(override));
    assert.equal(decision.official, false, JSON.stringify(override));
    assert.ok(decision.reasons.includes(reason), `${JSON.stringify(override)} -> ${decision.reasons.join(",")}`);
  }
});

test("blocks_official_on_a_lane_the_release_has_not_proven", () => {
  // A STRICT record that passed everything, on a platform/backend/adapter combination for which no
  // real-lane evidence exists. The gate reads the lane off the record and the lane table decides.
  const linux = issuanceGate(passingRecord({ platform: "linux", backend: "linux-bubblewrap" }));
  assert.equal(linux.official, false);
  assert.ok(linux.reasons.includes(ISSUANCE_REASONS.LANE_NOT_PROVEN));
  assert.equal(laneOf({ platform: "linux", backend: "linux-bubblewrap", adapter: "codex-cli.v1", level: "STRICT" })?.support_status, "NOT_OBSERVED");
  const claude = issuanceGate(passingRecord({ adapter: "claude-code.v1" }));
  assert.equal(claude.official, false);
  assert.ok(claude.reasons.includes(ISSUANCE_REASONS.LANE_NOT_PROVEN));
  const unknown = issuanceGate(passingRecord({ platform: "freebsd" }));
  assert.equal(unknown.official, false);
  assert.ok(unknown.reasons.includes(ISSUANCE_REASONS.LANE_NOT_PROVEN));
});

test("a_run_is_official_only_when_every_invocation_is", () => {
  const good = passingRecord();
  const bad = passingRecord({ boundary_canary: { result: "FAIL", failed: ["outside_write"], evidence_digest: null, program_digest: null } });
  assert.equal(issuanceGateForRun([good, good]).official, true);
  const mixed = issuanceGateForRun([good, bad]);
  assert.equal(mixed.official, false);
  assert.ok(mixed.reasons.includes(ISSUANCE_REASONS.CANARY_NOT_PASS));
  // Nothing ran, nothing is official. An empty family is not a clean one.
  const empty = issuanceGateForRun([]);
  assert.equal(empty.official, false);
  assert.ok(empty.reasons.includes(ISSUANCE_REASONS.NO_INVOCATIONS));
  for (const bogus of [null, undefined, "records", [null], [{}]]) {
    assert.equal(issuanceGateForRun(bogus).official, false, JSON.stringify(bogus));
  }
});

test("records_network_not_observed_rather_than_denied", () => {
  // Task-initiated external network is not distinguishable from provider transport at the layer
  // any backend here enforces, so no record and no decision may say it was denied.
  for (const adapter of [codex, generic]) {
    for (const backend of ["macos-seatbelt", "linux-bubblewrap"]) {
      const platform = backend === "macos-seatbelt" ? "darwin" : "linux";
      const policy = isolationPolicyFor({ level: "STRICT", platform, backend, adapter });
      assert.equal(policy.network.task_external, "NOT_OBSERVED", `${adapter.id}/${backend}`);
      assert.notEqual(policy.network.task_external, "denied");
    }
  }
  const decision = issuanceGate(passingRecord());
  assert.equal(decision.network.task_external, "NOT_OBSERVED");
  assert.equal(decision.network.policy, "provider-required-unrestricted");
  // A canary that did not run the network cell reports it unobserved, not denied.
  const cells = Object.fromEntries(CANARY_CELLS.map((cell) => [cell, { outcome: cell === "network_outbound_connect" ? "inconclusive" : expectedOutcome(cell), errno: null, detail: null }]));
  const evaluated = evaluateCanary({ cells, stdout: Buffer.from(JSON.stringify(cells)), networkPolicy: "provider-required-unrestricted", outOfBand: passingOutOfBand() });
  assert.equal(evaluated.result, "FAIL");
  assert.ok(evaluated.failed.includes("network_outbound_connect"));
  assert.equal(evaluated.cells.network_outbound_connect.observed, "inconclusive");
});

test("policy_names_provider_network_as_unrestricted_and_unknown_provider_as_disabled", () => {
  // The generic adapter describes no runtime, so nothing is known about what network it needs. The
  // strict answer to "unknown" is "none", and the record says which of the two was applied.
  assert.equal(isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: codex }).network.policy, "provider-required-unrestricted");
  assert.equal(isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: generic }).network.policy, "disabled");
  assert.throws(() => isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: codex, networkPolicy: "restricted" }), /AOS_ISOLATION_NETWORK_POLICY_UNSUPPORTED/u);
});

test("denies_aos_home_from_generated_profile", () => {
  const policy = isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: codex });
  const profile = renderSeatbeltProfile(policy, BINDINGS);
  assert.ok(profile.startsWith("(version 1)\n(deny default)\n"), "the profile does not open with deny-default");
  const denyHome = profile.indexOf(`(deny file-read* file-write* (subpath "${BINDINGS["@AOS_HOME@"]}"))`);
  const allowWorkspace = profile.indexOf(`(allow file-read* file-write* (subpath "${BINDINGS["@WORKSPACE@"]}"))`);
  assert.ok(denyHome >= 0, "AOS_HOME is not explicitly denied");
  assert.ok(allowWorkspace > denyHome, "the workspace allow must follow the AOS_HOME deny, because the later rule wins");
  // The workspace lives inside AOS_HOME. A workspace that contains AOS_HOME would make the later
  // allow re-open the whole store, so it is refused before any profile is written.
  assert.throws(
    () => renderSeatbeltProfile(policy, { ...BINDINGS, "@WORKSPACE@": "/private/var/aos" }),
    /AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME/u
  );
  assert.throws(
    () => renderSeatbeltProfile(policy, { ...BINDINGS, "@WORKSPACE@": "/private/var" }),
    /AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME/u
  );
  assert.throws(
    () => renderSeatbeltProfile(policy, { ...BINDINGS, "@AGENT_HOME@": "/private/var/aos/runs/run-1/home" }),
    /AOS_ISOLATION_SCRATCH_INSIDE_AOS_HOME/u
  );
  // No placeholder survives rendering and no path can break out of its string literal.
  assert.doesNotMatch(profile, /@[A-Z_]+@/u);
  assert.throws(() => renderSeatbeltProfile(policy, { ...BINDINGS, "@WORKSPACE@": '/private/var/aos/runs/x/workspaces/a"))(allow default)(deny (literal "' }), /AOS_ISOLATION_UNSAFE_PATH/u);
  assert.throws(() => renderSeatbeltProfile(policy, { ...BINDINGS, "@WORKSPACE@": "relative/path" }), /AOS_ISOLATION_UNSAFE_PATH/u);
  assert.throws(() => renderSeatbeltProfile(policy, { ...BINDINGS, "@NODE_TREE@": undefined }), /AOS_ISOLATION_BINDING_MISSING/u);
});

test("the_generated_profile_never_names_the_operator_runtime_config_directory", () => {
  const policy = isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: codex });
  const withConfig = renderSeatbeltProfile(policy, { ...BINDINGS, "@RUNTIME_CONFIG_DIR@": OPERATOR_CONFIG_DIR });
  // Phase 0 named `~/.codex` read-only and `codex exec` could not run under it; Phase B stages the
  // declared files into the agent HOME instead, so the profile has no rule for the source at all.
  assert.ok(!withConfig.includes(OPERATOR_CONFIG_DIR), "the operator's runtime config directory is named in the profile");
  assert.ok(!policy.filesystem.readable.includes("@RUNTIME_CONFIG_DIR@"));
  assert.deepEqual(policy.holes.map((one) => [one.env, one.access, [...one.staged]]), [["CODEX_HOME", "staged-copy", ["auth.json", "config.toml"]]]);
  assert.ok(withConfig.includes("(allow network-outbound)"), "provider transport is not allowed for a provider-required runtime");
  const generic = renderSeatbeltProfile(isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: ADAPTERS["generic-command.v1"] }), BINDINGS);
  assert.ok(!generic.includes("network-outbound"), "a runtime with unknown network needs was given network");
  // The operator's home is never allowed as a subtree; only listing `/Users` itself is, for the
  // path walk. The run scratch that holds the task file is readable and not writable.
  assert.ok(!withConfig.includes('(subpath "/Users/someone")'));
  assert.ok(withConfig.includes(`(allow file-read* (subpath "${BINDINGS["@RUN_SCRATCH@"]}"))`));
  assert.ok(withConfig.includes(`(allow file-read* file-write* (subpath "${BINDINGS["@AGENT_HOME@"]}"))`));
});

test("stages_only_the_declared_runtime_config_files_into_the_agent_home", () => {
  const base = mkdtempSync(join(tmpdir(), "aos-staging-"));
  try {
    const operatorHome = join(base, "operator");
    const agentHome = join(base, "agent");
    mkdirSync(join(operatorHome, ".codex", "sessions"), { recursive: true });
    mkdirSync(agentHome, { recursive: true });
    writeFileSync(join(operatorHome, ".codex", "auth.json"), "{\"tokens\":\"stub\"}\n");
    writeFileSync(join(operatorHome, ".codex", "config.toml"), "model = \"stub\"\n");
    writeFileSync(join(operatorHome, ".codex", "history.jsonl"), "{\"prompt\":\"private\"}\n");
    // Unset in the operator's environment, the way it is on this machine: the source is the
    // runtime's own default under the operator HOME, which is what the runtime would have read.
    const byDefault = stageRuntimeConfig(codex, { PATH: "/usr/bin" }, agentHome, operatorHome);
    assert.equal(byDefault.source, "default_dir");
    assert.deepEqual(byDefault.staged, ["auth.json", "config.toml"]);
    assert.deepEqual(byDefault.env, Object.assign(Object.create(null), { CODEX_HOME: join(agentHome, ".codex") }));
    assert.deepEqual(readdirSync(join(agentHome, ".codex")).sort(), ["auth.json", "config.toml"], "something beyond the declared files was staged");
    assert.equal(statSync(join(agentHome, ".codex", "auth.json")).mode & 0o777, 0o600);
    assert.equal(statSync(join(agentHome, ".codex")).mode & 0o777, 0o700);
    rmSync(join(agentHome, ".codex"), { recursive: true });
    // Set in the operator's environment: that directory, and a missing file is listed as missing.
    const elsewhere = join(base, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, "config.toml"), "model = \"other\"\n");
    const fromEnv = stageRuntimeConfig(codex, { CODEX_HOME: elsewhere }, agentHome, operatorHome);
    assert.equal(fromEnv.source, "operator_env");
    assert.deepEqual(fromEnv.staged, ["config.toml"]);
    assert.deepEqual(fromEnv.missing, ["auth.json"]);
    rmSync(join(agentHome, ".codex"), { recursive: true });
    // An adapter with no config variable stages nothing and sets nothing.
    const none = stageRuntimeConfig(generic, { CODEX_HOME: elsewhere }, agentHome, operatorHome);
    assert.deepEqual([none.source, none.staged, Object.keys(none.env)], ["none", [], []]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("isolation_policy_digest_is_stable_and_path_free", () => {
  const policy = isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: codex });
  const digest = isolationPolicyDigestOf(policy);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(isolationPolicyDigestOf(isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: codex })), digest);
  // Two runs are comparable exactly when their policy digests match, so a concrete path in the
  // policy would make every run incomparable with every other. Paths stay as placeholders.
  assert.doesNotMatch(JSON.stringify(policy), /"\/[^"]*"/u, "the policy carries a concrete path");
  assert.throws(() => isolationPolicyDigestOf({ ...policy, filesystem: { ...policy.filesystem, writable: ["/private/tmp/x"] } }), /AOS_ISOLATION_POLICY_PATH_LEAK/u);
  assert.notEqual(isolationPolicyDigestOf(isolationPolicyFor({ level: "STRICT", platform: "darwin", backend: "macos-seatbelt", adapter: generic })), digest, "network policy did not move the digest");
  assert.notEqual(isolationPolicyDigestOf(isolationPolicyFor({ level: "BEST_EFFORT_CLI", platform: "darwin", backend: "none", adapter: codex })), digest);
  assert.throws(() => isolationPolicyDigestOf(null), /AOS_ISOLATION_POLICY_INVALID/u);
  assert.throws(() => isolationPolicyDigestOf({ ...policy, schema: "other" }), /AOS_ISOLATION_POLICY_INVALID/u);
});

test("refuses_strict_when_backend_absent", () => {
  // Linux without bubblewrap, and darwin without sandbox-exec: the adapter says what it cannot do
  // and which level it can offer instead, and never reports STRICT.
  const linux = adapterForPlatform("linux", { commandExists: () => false });
  const probe = linux.probe();
  assert.equal(probe.available, false);
  assert.equal(probe.level_ceiling, "BEST_EFFORT_CLI");
  assert.match(probe.reason, /bwrap/u);
  assert.equal(probe.reason.startsWith(ISSUANCE_REASONS.BACKEND_ABSENT), true);
  const darwin = adapterForPlatform("darwin", { commandExists: () => false });
  const darwinProbe = darwin.probe();
  assert.equal(darwinProbe.available, false);
  assert.equal(darwinProbe.level_ceiling, "BEST_EFFORT_CLI");
  assert.match(darwinProbe.reason, /sandbox-exec/u);
  assert.throws(() => adapterForPlatform("win32", {}), /AOS_ISOLATION_PLATFORM_UNSUPPORTED/u);
});

test("bubblewrap_arguments_isolate_the_store_and_share_only_the_named_trees", () => {
  const policy = isolationPolicyFor({ level: "STRICT", platform: "linux", backend: "linux-bubblewrap", adapter: codex });
  const bindings = { ...BINDINGS, "@NODE_TREE@": "/usr/local/node", "@RUNTIME_CLI_TREE@": "/usr/local/lib/node_modules" };
  const args = bubblewrapArgs(policy, bindings, ["/usr/local/node/bin/node", "agent.mjs"]);
  const text = args.join(" ");
  assert.ok(args.includes("--unshare-pid") && args.includes("--die-with-parent") && args.includes("--new-session"));
  assert.ok(text.includes(`--bind ${bindings["@WORKSPACE@"]} ${bindings["@WORKSPACE@"]}`));
  assert.ok(text.includes(`--bind ${bindings["@AGENT_HOME@"]} ${bindings["@AGENT_HOME@"]}`));
  assert.ok(text.includes(`--ro-bind ${bindings["@RUN_SCRATCH@"]} ${bindings["@RUN_SCRATCH@"]}`));
  assert.ok(!text.includes("/home/someone"), "the operator's home was mounted");
  assert.ok(!text.includes(`--bind ${bindings["@AOS_HOME@"]} `) && !text.includes(`--ro-bind ${bindings["@AOS_HOME@"]} `), "the store was mounted");
  assert.ok(!args.includes("--unshare-net"), "a provider-required runtime lost its network");
  assert.deepEqual(args.slice(-3), ["--", "/usr/local/node/bin/node", "agent.mjs"]);
  const offline = bubblewrapArgs(isolationPolicyFor({ level: "STRICT", platform: "linux", backend: "linux-bubblewrap", adapter: generic }), bindings, ["/bin/true"]);
  assert.ok(offline.includes("--unshare-net"), "an unknown-provider runtime kept its network");
  assert.throws(() => bubblewrapArgs(policy, { ...bindings, "@WORKSPACE@": "/private/var" }, ["/bin/true"]), /AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME/u);
});

test("the_descendant_tracker_follows_ancestry_and_drops_a_reused_pid", () => {
  // Driven by a fake process table, so what is tested is the adoption rule: a process is tracked if
  // its parent chain reaches a tracked process or it shares the agent's process group, and it stays
  // tracked after reparenting to init unless its start time changes, which means the pid was reused.
  let rows = [
    { pid: 1, ppid: 0, pgid: 1, start: "boot" },
    { pid: 100, ppid: 1, pgid: 100, start: "a" },
    { pid: 101, ppid: 100, pgid: 100, start: "a" },
    { pid: 102, ppid: 101, pgid: 102, start: "a" },
    { pid: 900, ppid: 1, pgid: 900, start: "z" }
  ];
  const tracker = descendantTracker(100, { table: () => rows, intervalMs: 1000 });
  tracker.poll();
  assert.deepEqual(tracker.tracked(), [100, 101, 102]);
  // The agent exits; the detached grandchild is reparented to init and keeps its start time.
  rows = [
    { pid: 1, ppid: 0, pgid: 1, start: "boot" },
    { pid: 102, ppid: 1, pgid: 102, start: "a" },
    { pid: 900, ppid: 1, pgid: 900, start: "z" }
  ];
  tracker.poll();
  assert.deepEqual(tracker.alive(), [102]);
  assert.deepEqual(tracker.tracked(), [100, 101, 102]);
  // pid 101 comes back as a different process: same number, different start. Not ours to signal.
  rows = [
    { pid: 1, ppid: 0, pgid: 1, start: "boot" },
    { pid: 101, ppid: 1, pgid: 101, start: "q" },
    { pid: 102, ppid: 1, pgid: 102, start: "a" }
  ];
  tracker.poll();
  assert.deepEqual(tracker.alive(), [102]);
  assert.equal(tracker.polls(), 3);
  // A process in the agent's group with no visible ancestry is adopted through the group.
  rows = [{ pid: 1, ppid: 0, pgid: 1, start: "boot" }, { pid: 555, ppid: 1, pgid: 100, start: "b" }];
  tracker.poll();
  assert.deepEqual(tracker.alive(), [555]);
  assert.match(tracker.residual(), /double-fork|between two polls/u);
});

const expectedOutcome = (cell) => {
  if (cell === "workspace_read" || cell === "workspace_write") return "allowed";
  if (cell === "network_outbound_connect") return "allowed";
  if (cell === "detached_descendant") return "spawned";
  return "denied";
};

const passingOutOfBand = () => ({
  planted_intact: { outside: true, store_root: true, run_store: true },
  descendant: { pid: 4242, observed_by_scan: true, dead_after_cleanup: true, escapee_confined: true }
});

const passingCells = () => Object.fromEntries(CANARY_CELLS.map((cell) => [cell, {
  outcome: expectedOutcome(cell),
  errno: expectedOutcome(cell) === "denied" ? "EPERM" : null,
  detail: cell === "detached_descendant" ? { pid: 4242 } : null
}]));

test("the_canary_passes_only_when_every_cell_and_every_out_of_band_check_holds", () => {
  const cells = passingCells();
  const stdout = Buffer.from(JSON.stringify(cells));
  const pass = evaluateCanary({ cells, stdout, networkPolicy: "provider-required-unrestricted", outOfBand: passingOutOfBand() });
  assert.equal(pass.result, "PASS");
  assert.deepEqual(pass.failed, []);
  assert.equal(pass.evidence_digest, sha256Bytes(stdout));
  assert.equal(pass.program_digest, sha256Bytes(Buffer.from(BOUNDARY_CANARY_PROGRAM)));
  // Every boundary cell, broken one at a time. The canary's own word is not enough for the ones AOS
  // can check from outside: a "denied" write whose target changed on disk is a failure.
  for (const cell of CANARY_CELLS) {
    const broken = passingCells();
    broken[cell] = { outcome: expectedOutcome(cell) === "denied" ? "allowed" : cell === "detached_descendant" ? "failed" : "denied", errno: null, detail: null };
    const evaluated = evaluateCanary({ cells: broken, stdout, networkPolicy: "provider-required-unrestricted", outOfBand: passingOutOfBand() });
    assert.equal(evaluated.result, "FAIL", cell);
    assert.ok(evaluated.failed.includes(cell), cell);
  }
  for (const [path, value] of [[["planted_intact", "outside"], false], [["planted_intact", "store_root"], false], [["planted_intact", "run_store"], false], [["descendant", "observed_by_scan"], false], [["descendant", "dead_after_cleanup"], false], [["descendant", "escapee_confined"], false]]) {
    const outOfBand = passingOutOfBand();
    outOfBand[path[0]][path[1]] = value;
    const evaluated = evaluateCanary({ cells: passingCells(), stdout, networkPolicy: "provider-required-unrestricted", outOfBand });
    assert.equal(evaluated.result, "FAIL", path.join("."));
  }
  // A cell the program did not report is a failure, not a pass by omission.
  const missing = passingCells();
  delete missing.symlink_escape_read;
  assert.equal(evaluateCanary({ cells: missing, stdout, networkPolicy: "provider-required-unrestricted", outOfBand: passingOutOfBand() }).result, "FAIL");
  // The network cell is judged against the policy: a disabled policy expects the connect to be
  // refused by the boundary, and an allowed connect under it is the profile not matching the policy.
  const offline = passingCells();
  offline.network_outbound_connect = { outcome: "denied", errno: "EPERM", detail: null };
  assert.equal(evaluateCanary({ cells: offline, stdout, networkPolicy: "disabled", outOfBand: passingOutOfBand() }).result, "PASS");
  assert.equal(evaluateCanary({ cells: passingCells(), stdout, networkPolicy: "disabled", outOfBand: passingOutOfBand() }).result, "FAIL");
  assert.equal(evaluateCanary({ cells: null, stdout, networkPolicy: "disabled", outOfBand: passingOutOfBand() }).result, "FAIL");
});

test("the_support_matrix_marks_official_only_where_committed_canary_evidence_passes", () => {
  const rows = supportMatrixDecisions(matrix);
  const official = rows.filter((row) => row.official);
  assert.ok(official.length >= 1, "no lane is official, so the release has no real runtime lane");
  for (const row of official) {
    assert.equal(row.level, "STRICT");
    assert.equal(row.decision.official, true, `${row.platform}/${row.backend}/${row.adapter}: the gate disagrees with the table`);
    assert.ok(SUPPORTED_RELEASE_SET.has(row.support_status));
    assert.ok(row.evidence?.canary && row.evidence?.runtime, `${row.platform}/${row.backend}/${row.adapter}: an official row without evidence`);
    for (const [kind, reference] of Object.entries(row.evidence)) {
      const file = join(fixtureDir, reference.file);
      assert.ok(existsSync(file), `${kind}: ${reference.file} is not committed`);
      assert.equal(sha256Bytes(readFileSync(file)), reference.digest, `${kind}: ${reference.file} changed since the table was written`);
      const observation = JSON.parse(readFileSync(file, "utf8"));
      if (kind === "canary") assert.equal(observation.captured?.result, "PASS", `${reference.file} does not record a passing canary`);
      if (kind === "runtime") {
        assert.equal(observation.exit_status, 0, `${reference.file}: the runtime did not exit 0 inside the boundary`);
        assert.match(observation.stderr_excerpt + observation.stdout_excerpt, /Logged in/u, `${reference.file}: the runtime did not authenticate`);
      }
    }
    assert.equal(laneOf(row)?.support_status, row.support_status, "the table and the shipped lane declaration disagree");
  }
  // Every row that is not official names why, in the gate's vocabulary.
  for (const row of rows.filter((one) => !one.official)) {
    assert.ok(row.decision.reasons.length > 0, `${row.platform}/${row.backend}/${row.level} is withheld with no reason`);
    for (const reason of row.decision.reasons) assert.ok(Object.values(ISSUANCE_REASONS).includes(reason), reason);
  }
  // The shipped declaration and the fixture describe the same lanes.
  assert.deepEqual(
    SUPPORT_LANES.map((lane) => `${lane.platform}/${lane.backend}/${lane.adapter}/${lane.level}=${lane.support_status}`).sort(),
    matrix.lanes.map((lane) => `${lane.platform}/${lane.backend}/${lane.adapter}/${lane.level}=${lane.support_status}`).sort()
  );
});

test("the_document_renders_the_support_matrix_the_fixture_declares", () => {
  const rendered = renderSupportMatrix(supportMatrixDecisions(matrix));
  assert.ok(doc.includes(rendered), "docs/STRICT_CONFINEMENT_FEASIBILITY.md does not contain the rendered support matrix");
  assert.ok(rendered.includes("| darwin | macos-seatbelt | codex-cli.v1 | STRICT |"));
  assert.ok(doc.includes(matrix.evidence_digest), "the document does not state the support matrix digest");
  const stated = matrix.evidence_digest;
  const { evidence_digest: _ignored, ...rest } = matrix;
  assert.equal(stated, sha256Bytes(Buffer.from(JSON.stringify(rest))), "the fixture's digest does not describe its own content");
});

test("a_fabricated_official_row_is_rejected_by_the_matrix_test_itself", () => {
  // The previous test is the gate on the fixture. This one shows the gate bites: a copy of the
  // fixture with an official Linux row and no evidence behind it is not accepted.
  const forged = JSON.parse(JSON.stringify(matrix));
  const linux = forged.lanes.find((lane) => lane.platform === "linux" && lane.level === "STRICT");
  linux.official = true;
  linux.support_status = "SUPPORTED";
  const rows = supportMatrixDecisions(forged);
  const row = rows.find((one) => one.platform === "linux" && one.level === "STRICT" && one.official);
  assert.ok(row);
  assert.equal(row.decision.official, false, "the gate accepted a lane with no proven evidence");
  assert.ok(row.decision.reasons.includes(ISSUANCE_REASONS.LANE_NOT_PROVEN));
});

test("a_canary_observation_that_did_not_pass_withholds_the_row_it_backs", () => {
  // The official row is only as good as the observation it names. A copy of the fixture directory
  // whose canary observation records a failed cell -- everything else untouched, the row still
  // labelled official -- is withheld by the gate with the canary reason.
  const copy = mkdtempSync(join(tmpdir(), "aos-matrix-"));
  try {
    cpSync(fixtureDir, copy, { recursive: true });
    const official = matrix.lanes.find((lane) => lane.official);
    const file = join(copy, official.evidence.canary.file);
    const observation = JSON.parse(readFileSync(file, "utf8"));
    observation.captured.result = "FAIL";
    observation.captured.failed = ["outside_write"];
    const bytes = Buffer.from(JSON.stringify(observation), "utf8");
    writeFileSync(file, bytes);
    // The row is re-pointed at the bytes it now names, so what this proves is the canary result
    // and not the digest check beside it -- that one has a test of its own.
    const restated = JSON.parse(JSON.stringify(matrix));
    restated.lanes.find((lane) => lane.official).evidence.canary.digest = sha256Bytes(bytes);
    const row = supportMatrixDecisions(restated, copy).find((one) => one.official);
    assert.equal(row.decision.official, false, "a row backed by a failed canary was issued");
    assert.ok(row.decision.reasons.includes(ISSUANCE_REASONS.CANARY_NOT_PASS));
    assert.equal(row.decision.boundary_canary, "FAIL");
    // And with the observation missing altogether, the row is not run rather than failed.
    rmSync(file);
    const unrun = supportMatrixDecisions(restated, copy).find((one) => one.official);
    assert.equal(unrun.decision.official, false);
    assert.equal(unrun.decision.boundary_canary, "NOT_RUN");
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
