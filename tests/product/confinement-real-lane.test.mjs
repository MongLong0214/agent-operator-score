// The real lane: `runProcess` under STRICT on this machine, through `sandbox-exec`, first with a
// node agent that tries to leave the boundary and leaves a detached descendant behind, then with
// the installed Codex runtime. Nothing here is mocked. Where the backend or the runtime is absent,
// the test skips with a `NOT_OBSERVED` reason rather than passing on nothing.
//
// `npm run verify:real-runtime-strict` runs this file.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runProcess } from "../../lib/core.mjs";
import { ISSUANCE_REASONS, issuanceGate, issuanceGateForRun, laneOf, realStrictLaneStatus } from "../../lib/confinement.mjs";

const NOT_OBSERVED = process.platform !== "darwin"
  ? `NOT_OBSERVED: the darwin/macos-seatbelt lane runs only on darwin; this host is ${process.platform}`
  : !existsSync("/usr/bin/sandbox-exec")
    ? "NOT_OBSERVED: /usr/bin/sandbox-exec is absent on this darwin host"
    : null;

// `npm test` may skip this file: a Linux runner has no Seatbelt and skipping is the honest answer.
// `npm run verify:real-runtime-strict` may not, because that script exists to answer whether a real
// STRICT run happened here, and a suite that skipped and exited 0 answers it wrongly. The
// requirement is a test of its own so the script's promise is checked rather than assumed.
const laneStatus = (reason = NOT_OBSERVED) => realStrictLaneStatus({ backendAvailable: reason === null, reason });

test("the_real_strict_lane_ran_here_or_this_verification_did_not_pass", () => {
  laneStatus().assertRan();
});

const codexOnPath = () => {
  const found = spawnSync("/bin/sh", ["-c", "command -v codex"], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() : null;
};

// `os.tmpdir()` reads TMPDIR on every call, so a run's scratch can be sent to a folder this test
// owns and "nothing left behind" is a statement about that folder alone. The system temp folder
// is shared with every other process on the machine, and another suite's scratch appearing
// there mid-test is not a leak of this run.
const withPrivateTmp = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "aos-real-lane-tmp-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
};

// A store laid out the way `runPaths` lays one out: the workspace in its own root beside the store,
// with a second run beside it holding something the first must not read.
const makeStore = () => {
  const base = mkdtempSync(join(tmpdir(), "aos-real-lane-"));
  const aosHome = join(base, "home");
  // #556 round 3: workspaces live outside the store, because the agent runs with its workspace as
  // its working directory and a workspace inside the store hands it the store's path through
  // `getcwd`. One directory per run under a root the boundary denies by name.
  const workspacesRoot = join(base, "home-workspaces");
  const workspace = join(workspacesRoot, "run-under-test", "FAM-1");
  const otherRun = join(workspacesRoot, "run-other", "FAM-1");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(aosHome, "runs", "run-under-test"), { recursive: true });
  mkdirSync(otherRun, { recursive: true });
  writeFileSync(join(otherRun, "secret.txt"), "other-run-secret\n");
  writeFileSync(join(base, "outside.txt"), "outside-the-workspace\n");
  return { base, aosHome, workspacesRoot, workspace, otherRun };
};

// The agent under test. It reports what it could reach in the Phase 0 vocabulary and leaves a
// detached `sleep` behind on purpose, holding long enough for the ancestry scan to see it.
const AGENT = `import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
const spec = JSON.parse(readFileSync(new URL("./probe-spec.json", import.meta.url), "utf8"));
const cells = Object.create(null);
const attempt = (name, fn) => {
  try { fn(); cells[name] = "allowed"; } catch (error) { cells[name] = error && typeof error.code === "string" ? error.code : "inconclusive"; }
};
attempt("outside_read", () => readFileSync(spec.outside));
attempt("other_run_read", () => readFileSync(spec.other_run));
attempt("store_list", () => readdirSync(spec.store));
attempt("operator_home_list", () => readdirSync(spec.operator_home));
attempt("workspace_write", () => writeFileSync("./written.txt", "ok\\n"));
const child = spawn("/bin/sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
child.unref();
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
writeFileSync("./probe-result.json", JSON.stringify({ cells, descendant: child.pid, aos_home_env: process.env.AOS_HOME ?? null, home: process.env.HOME ?? null, cwd: process.cwd(), env: process.env, argv: process.argv }));
`;

const nodeAgent = { id: "probe", command: "node", args: ["agent.mjs"], adapter: "generic-command.v1" };

const isDead = (pid) => {
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
};

test("strict_run_holds_the_boundary_and_the_tracked_descendant_does_not_survive", { skip: NOT_OBSERVED ?? false }, async () => {
  const store = makeStore();
  try {
    await withPrivateTmp(async (privateTmp) => {
    writeFileSync(join(store.workspace, "agent.mjs"), AGENT);
    writeFileSync(join(store.workspace, "probe-spec.json"), JSON.stringify({
      outside: join(store.base, "outside.txt"),
      other_run: join(store.otherRun, "secret.txt"),
      store: store.aosHome,
      operator_home: process.env.HOME
    }));
    const result = await runProcess(nodeAgent, {
      workspace: store.workspace, family: "FAM-1", stage: "probe", prompt: "probe", promptFile: join(store.workspace, "task.md"),
      session: "real-lane", timeoutMs: 60000, isolation: "STRICT", aosHome: store.aosHome
    });
    const probe = JSON.parse(readFileSync(join(store.workspace, "probe-result.json"), "utf8"));
    // The filesystem axis, as the agent saw it: the kernel refused everything outside the
    // workspace, including the store root and the other run beside it, and allowed the workspace.
    assert.deepEqual(probe.cells, { outside_read: "EPERM", other_run_read: "EPERM", store_list: "EPERM", operator_home_list: "EPERM", workspace_write: "allowed" });
    assert.equal(probe.aos_home_env, null, "AOS_HOME reached the child environment");
    // On the values, not on the name. `AOS_WORKSPACE` used to carry
    // `<store>/runs/<run>/workspaces/FAM-1`, which discloses the store to an agent that was never
    // handed the variable that names it -- a rule checked by looking for the wrong thing.
    for (const [name, value] of Object.entries(probe.env)) {
      assert.equal(String(value).includes(store.aosHome), false, `${name} carries the store path`);
      assert.equal(String(value).includes(realpathSync(store.aosHome)), false, `${name} carries the store path`);
    }
    assert.equal(probe.env.AOS_WORKSPACE, ".");
    // argv and cwd name the run's own workspace, which is where the child is: that directory lives
    // outside the store now (#556 round 4), so what the child reads out of `getcwd` says where it
    // is working and nothing about where AOS keeps its runs. The check is that nothing under the
    // store is named at all.
    for (const value of [...probe.argv, probe.cwd]) {
      const text = String(value);
      if (!text.includes(store.aosHome) && !text.includes(realpathSync(store.aosHome))) continue;
      assert.ok(
        text.startsWith(store.workspace) || text.startsWith(realpathSync(store.workspace)),
        `${text} names the store above this run's own workspace`
      );
    }
    assert.notEqual(probe.home, process.env.HOME, "the child ran with the operator's HOME");
    assert.equal(existsSync(join(store.workspace, "written.txt")), true);
    // The process axis: the detached sleep was seen by the scan while the agent lived, reported as
    // a leaked descendant, and is dead after teardown even though it left the process group.
    assert.equal(result.leaked_descendants, true);
    assert.ok(result.descendant_pids.includes(probe.descendant), `descendant ${probe.descendant} not in ${JSON.stringify(result.descendant_pids)}`);
    assert.equal(result.survivor, false);
    assert.equal(isDead(probe.descendant), true, "the detached descendant survived teardown");
    const record = result.confinement;
    // The tracker is what reached it. The survivor sweep is the backstop for what the tracker
    // cannot see, and a run where the sweep had to kill a descendant the tracker was holding is a
    // run whose teardown did not do its job -- `found_before_signal` is absent when it did.
    // The sweep the record carries, measured at this run's teardown: a real group id with the
    // process table behind it, and the survivor sweep having enumerated that group. A guard whose
    // only witness needed an installed Codex could not fire on a machine without one, so what the
    // record says about its own teardown is asserted here, in the test every darwin host runs.
    assert.ok(Number.isInteger(record.descendants.group_sweep?.pgid) && record.descendants.group_sweep.pgid > 0, "no process group was swept at teardown");
    assert.ok(Array.isArray(record.descendants.group_sweep.members));
    assert.ok(record.descendants.survivor_sweep.scanners.includes("process-group"), record.descendants.survivor_sweep.scanners.join(", "));
    assert.ok(Number.isInteger(record.descendants.survivor_sweep.group_enumerated), "the group was not enumerated");
    assert.equal(Object.hasOwn(record.descendants.survivor_sweep, "found_before_signal"), false, "the sweep had to kill what the tracker tracked");
    assert.deepEqual(record.descendants.survivor_sweep.survivors, []);
    assert.equal(record.level, "STRICT");
    assert.equal(record.backend, "macos-seatbelt");
    assert.equal(record.filesystem_enforced, true);
    assert.equal(record.process_enforced, true);
    assert.equal(record.boundary_canary.result, "PASS");
    assert.match(record.boundary_canary.evidence_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(record.descendants.polls >= 1);
    assert.ok(record.descendants.tracked.includes(probe.descendant));
    assert.deepEqual(record.descendants.survivors, []);
    assert.equal(record.cleanup_verified, true);
    assert.equal(record.network.task_external, "NOT_OBSERVED");
    assert.deepEqual(record.holes, [], "the generic adapter declares no config directory");
    // Not official, and for two named reasons: the leak, and a lane no committed evidence proves.
    const decision = issuanceGate(record);
    assert.equal(decision.official, false);
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.LEAKED_DESCENDANT));
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.LANE_NOT_PROVEN));
    assert.equal(laneOf({ platform: "darwin", backend: "macos-seatbelt", adapter: "generic-command.v1", level: "STRICT" }).support_status, "NOT_OBSERVED");
    assert.deepEqual(readdirSync(privateTmp), [], "scratch was left behind in the temp folder");
    });
  } finally {
    rmSync(store.base, { recursive: true, force: true });
  }
});

test("strict_run_refuses_a_workspace_that_contains_the_store_and_leaves_no_scratch", { skip: NOT_OBSERVED ?? false }, async () => {
  const store = makeStore();
  try {
    await withPrivateTmp(async (privateTmp) => {
      writeFileSync(join(store.base, "agent.mjs"), AGENT);
      await assert.rejects(
        runProcess(nodeAgent, { workspace: store.base, family: "FAM-1", stage: "probe", prompt: "probe", promptFile: join(store.base, "task.md"), session: "real-lane", timeoutMs: 60000, isolation: "STRICT", aosHome: store.aosHome }),
        /AOS_ISOLATION_WORKSPACE_CONTAINS_AOS_HOME/u
      );
      await assert.rejects(
        runProcess(nodeAgent, { workspace: store.workspace, family: "FAM-1", stage: "probe", prompt: "probe", promptFile: join(store.workspace, "task.md"), session: "real-lane", timeoutMs: 60000, isolation: "STRICT" }),
        /AOS_ISOLATION_AOS_HOME_REQUIRED/u
      );
      // And a workspace inside the store, which is the disclosure #556 forbids: the layout puts
      // workspaces in their own root, and the spawn refuses one that is not there rather than
      // handing the agent the store's path through its own working directory.
      const inside = join(store.aosHome, "runs", "run-under-test", "workspaces", "FAM-1");
      mkdirSync(inside, { recursive: true });
      await assert.rejects(
        runProcess(nodeAgent, { workspace: inside, family: "FAM-1", stage: "probe", prompt: "probe", promptFile: join(inside, "task.md"), session: "real-lane", timeoutMs: 60000, isolation: "STRICT", aosHome: store.aosHome }),
        /AOS_ISOLATION_WORKSPACE_INSIDE_STORE/u
      );
      assert.deepEqual(readdirSync(privateTmp), [], "a refused run left scratch behind");
    });
  } finally {
    rmSync(store.base, { recursive: true, force: true });
  }
});

test("best_effort_run_records_no_boundary_and_is_never_official", async () => {
  const store = makeStore();
  try {
    writeFileSync(join(store.workspace, "agent.mjs"), "process.stdout.write('ran\\n');\n");
    const result = await runProcess(nodeAgent, {
      workspace: store.workspace, family: "FAM-1", stage: "probe", prompt: "probe", promptFile: join(store.workspace, "task.md"),
      session: "real-lane", timeoutMs: 60000, isolation: "BEST_EFFORT_CLI", aosHome: store.aosHome
    });
    assert.equal(result.ok, true);
    const record = result.confinement;
    assert.equal(record.level, "BEST_EFFORT_CLI");
    assert.equal(record.backend, "none");
    assert.equal(record.filesystem_enforced, false);
    assert.equal(record.process_enforced, false);
    assert.equal(record.boundary_canary.result, "NOT_RUN");
    assert.equal(record.cleanup_verified, false);
    const decision = issuanceGate(record);
    assert.equal(decision.official, false);
    assert.ok(decision.reasons.includes(ISSUANCE_REASONS.LEVEL_NOT_STRICT));
    assert.equal(issuanceGateForRun([record]).official, false);
  } finally {
    rmSync(store.base, { recursive: true, force: true });
  }
});

test("strict_run_with_the_installed_codex_runtime_is_official_on_the_proven_lane", { skip: NOT_OBSERVED ?? false, timeout: 240000 }, async (t) => {
  const codex = codexOnPath();
  if (codex === null) {
    laneStatus("NOT_OBSERVED: codex is not on PATH; the codex-cli.v1 lane was not re-measured").assertRan();
    return t.skip("NOT_OBSERVED: codex is not on PATH; the codex-cli.v1 lane was not re-measured");
  }
  const status = spawnSync(codex, ["login", "status"], { encoding: "utf8", timeout: 60000 });
  if (status.status !== 0) {
    const why = `NOT_OBSERVED: \`codex login status\` exited ${status.status}; the lane needs an authenticated runtime`;
    laneStatus(why).assertRan();
    return t.skip(why);
  }
  const store = makeStore();
  try {
    const spec = { id: "codex", command: "codex", args: ["exec", "--skip-git-repo-check"], adapter: "codex-cli.v1", runtime_name: "codex", allowed_env_names: ["CODEX_HOME"] };
    const result = await runProcess(spec, {
      workspace: store.workspace, family: "FAM-1", stage: "answer", prompt: "Reply with exactly the single word OK and nothing else.", promptFile: join(store.workspace, "task.md"),
      session: "real-lane-codex", timeoutMs: 180000, isolation: "STRICT", aosHome: store.aosHome
    });
    assert.equal(result.exit_code, 0, `codex exited ${result.exit_code}: ${result.stderr_excerpt}`);
    assert.match(result.stdout_excerpt, /\bOK\b/u);
    assert.equal(result.leaked_descendants, false);
    const record = result.confinement;
    assert.equal(record.platform_lane, "darwin/macos-seatbelt/codex-cli.v1");
    assert.equal(record.support_status, "SUPPORTED_WITH_CONSTRAINTS");
    // The runtime's config is a staged copy in the agent HOME, and the record says which files.
    assert.equal(record.holes.length, 1);
    const [hole] = record.holes;
    assert.equal(hole.env, "CODEX_HOME");
    assert.equal(hole.access, "staged-copy");
    assert.deepEqual(hole.staged, ["auth.json", "config.toml"]);
    assert.equal(hole.source, process.env.CODEX_HOME ? "operator_env" : "default_dir");
    // The bytes of the configuration the runtime was given, so two runs cannot differ in their MCP
    // servers and still claim one cohort. The credential file is deliberately not digested here:
    // this record is published, and a token that refreshes is not a change of environment.
    assert.match(String(hole.staged_digests["config.toml"]), /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.hasOwn(hole.staged_digests, "auth.json"), false, "the credential file was digested into a published record");
    assert.equal(record.cleanup_verified, true);
    const decision = issuanceGate(record);
    assert.deepEqual(decision.reasons, []);
    assert.equal(decision.official, true);
    assert.equal(decision.claim_stage_ceiling, "PROFILE_BOUND");
    assert.equal(issuanceGateForRun([record]).official, true);
  } finally {
    rmSync(store.base, { recursive: true, force: true });
  }
});
