// #627 round 2, P-04. Round 1 asked whether `lib/capability-probe.mjs` works under STRICT
// confinement and could not answer: the only fixture on hand (`tests/product/fake-agent.mjs`,
// invoked as `node <path-outside-every-granted-tree>`) is refused by the Seatbelt profile before
// the probe brief is ever read, so that reproduction measured the fixture's location and not the
// probe. This file measures the probe.
//
// THE CONSTRUCTION. `prepareConfinement` grants three trees under STRICT: the workspace, the run
// scratch, and `@RUNTIME_CLI_TREE@` -- the directory holding the executable actually named as
// `command`. A fixture invoked as `node fake-agent.mjs` puts the *runtime* (node) inside a granted
// tree and the *script* outside every one of them, which is exactly what round 1 hit. A fixture
// whose own file IS `command` -- a `#!/usr/bin/env node` copy of `fake-agent.mjs`, placed in a
// directory made for this test and nowhere else -- puts the script inside `@RUNTIME_CLI_TREE@`
// itself, the same way the real `codex` binary is a `#!` script under its own `node_modules` tree.
// Nothing about the probe changed to make this true; only where the fixture lives did.
//
// Both directions are measured, because P-04's `must_hold` was a disjunction: a probe under STRICT
// either works, or fails in the withholding direction. The first test is the fixture the profile
// can start; the second is round 1's own fixture at its ordinary, unmoved location, kept as the
// negative control that the safe-failure path still holds.
import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probeAgentCapabilities } from "../../lib/capability-probe.mjs";
import { CAPABILITY_VOCABULARY } from "../../lib/routing-oracle.mjs";
import { fakeAgent } from "./helpers.mjs";

// The same skip condition `confinement-real-lane.test.mjs` uses, and for the same reason: a Linux
// runner has no Seatbelt, and reporting that as a failure would be wrong in the opposite direction
// from the one this file exists to fix. Kept local rather than imported so this file's honesty
// about what it measured does not depend on another file's constant staying named the same way.
const NOT_OBSERVED = process.platform !== "darwin"
  ? `NOT_OBSERVED: the darwin/macos-seatbelt lane runs only on darwin; this host is ${process.platform}`
  : !existsSync("/usr/bin/sandbox-exec")
    ? "NOT_OBSERVED: /usr/bin/sandbox-exec is absent on this darwin host"
    : null;

const aosHomeFor = (t) => {
  const home = mkdtempSync(join(tmpdir(), "aos-strict-probe-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
};

// Copies `fake-agent.mjs` into a fresh directory as an executable `#!` script, so `command` names
// the script itself rather than `node` -- the one change that moves `@RUNTIME_CLI_TREE@` from
// node's own install to a directory this test owns. The content is read from the shared fixture
// and not duplicated, so this file cannot drift from what the BEST_EFFORT_CLI probe tests exercise.
const strictStartableFixture = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aos-strict-probe-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, "fake-agent.mjs");
  writeFileSync(script, `#!/usr/bin/env node\n${readFileSync(fakeAgent, "utf8")}`, { mode: 0o755 });
  chmodSync(script, 0o755);
  return script;
};

test("a runtime the STRICT profile can start answers all eight challenges under real Seatbelt confinement", { skip: NOT_OBSERVED ?? false, timeout: 60000 }, async (t) => {
  const script = strictStartableFixture(t);
  const aosHome = aosHomeFor(t);
  const { probe, record } = await probeAgentCapabilities(
    { id: "strict-probe-startable", command: script, args: [], adapter: "codex-cli.v1", allowed_env_names: [], runtime_auth_env_names: [], transport_env_names: [] },
    { isolation: "STRICT", aosHome, timeoutMs: 30000 }
  );
  assert.equal(probe.status, "ANSWERED", probe.reason);
  assert.equal(probe.invocation.completed, true);
  assert.equal(probe.invocation.exit_code, 0);
  assert.deepEqual([...probe.observations.map((row) => row.observed)], probe.observations.map(() => true));
  assert.equal(record.source, "detected");
  assert.deepEqual([...record.capabilities].sort(), [...CAPABILITY_VOCABULARY].sort());
});

test("a runtime the STRICT boundary refuses to start is withheld as unknown, never scored and never widened to the adapter table", { skip: NOT_OBSERVED ?? false, timeout: 60000 }, async (t) => {
  const aosHome = aosHomeFor(t);
  // Round 1's own reproduction, unmoved: `fake-agent.mjs` at its ordinary path in this checkout,
  // which sits outside `@WORKSPACE@`, `@AGENT_HOME@`, `@RUN_SCRATCH@`, `@NODE_TREE@` and
  // `@RUNTIME_CLI_TREE@` alike. `node` itself is still inside a granted tree; the file it was told
  // to open is not, so the child fails before the probe brief is ever read.
  const { probe, record } = await probeAgentCapabilities(
    { id: "strict-probe-denied", command: process.execPath, args: [fakeAgent], adapter: "codex-cli.v1", allowed_env_names: [], runtime_auth_env_names: [], transport_env_names: [] },
    { isolation: "STRICT", aosHome, timeoutMs: 30000 }
  );
  assert.equal(probe.status, "INDETERMINATE");
  assert.equal(probe.invocation.completed, false);
  assert.notEqual(probe.invocation.exit_code, 0);
  assert.equal(record.source, "unknown", "a refused STRICT invocation fell back to a source other than unknown");
  assert.deepEqual(record.capabilities, []);
});
