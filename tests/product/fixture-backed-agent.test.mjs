import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureBackedAgent } from "../../lib/cli.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
const fixture = join(dirname(fileURLToPath(import.meta.url)), "fake-agent.mjs");
const aos = (home, args) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8", timeout: 60000, env: { ...process.env, AOS_HOME: home, HOME: home }
  });

// Found by a blind session on the owner's machine: `~/.aos` held twelve agents and nine ran
// `tests/product/fake-agent.mjs`, under the names `claude`, `codex`, `grok` and `gemini`. An
// assessment there measures the fixture and reports a normal score. For a measuring instrument
// that is the worst failure available -- not a wrong number, a number about something else.
test("the fixture is in an argument, which is why the old check missed it", () => {
  // `agent doctor` asked `commandExists(agent.command)` and the command was `node`. Checking only
  // the command is the same blind spot as reading only the first line of a script.
  assert.equal(fixtureBackedAgent({ command: "/usr/bin/node", args: [fixture] }), true);
  assert.equal(fixtureBackedAgent({ command: "/usr/bin/node", args: ["/repo/tests/product/fake-agent.mjs"] }), true);
  assert.equal(fixtureBackedAgent({ command: "/repo/fixtures/stub-agent.mjs", args: [] }), true);
  assert.equal(fixtureBackedAgent({ command: "/usr/bin/python3", args: ["-m", "mocks/agent.py"] }), true);
  assert.equal(fixtureBackedAgent({ command: "/usr/bin/node", args: ["/repo/bin/mock-server.mjs"] }), true);
});

test("a real runtime is not called a fixture", () => {
  assert.equal(fixtureBackedAgent({ command: "/usr/local/bin/claude", args: ["-p"] }), false);
  assert.equal(fixtureBackedAgent({ command: "codex", args: ["exec", "--skip-git-repo-check"] }), false);
  // "latest" contains no fixture word, and a path merely containing "test" as part of a longer
  // word is not a test directory.
  assert.equal(fixtureBackedAgent({ command: "/opt/contest-runner/bin/agent", args: [] }), false);
  assert.equal(fixtureBackedAgent({ command: "node", args: [] }), false);
  assert.equal(fixtureBackedAgent({}), false);
});

test("agent doctor fails an agent that runs a fixture", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-fixture-agent-"));
  try {
    aos(home, ["agent", "add", "faker", "--command", process.execPath, "--arg", fixture]);
    const doctor = aos(home, ["agent", "doctor", "faker"]);
    // Exit 3, not 0: the whole point of doctor is to answer this before the quota is spent, and it
    // used to answer PASS.
    assert.equal(doctor.status, 3);
    assert.match(doctor.stdout, /FAIL\tfaker:runtime\truns a test fixture, not a runtime/);
    assert.match(doctor.stdout, /describes the fixture/);

    // A real binary in the same home still passes, so this is not a blanket refusal.
    aos(home, ["agent", "add", "real", "--command", "/bin/echo", "--arg", "hello"]);
    assert.equal(aos(home, ["agent", "doctor", "real"]).status, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the caveat prints where the number is read, not only in the JSON", () => {
  // A blind session watched a fixture-backed agent print `Score: 100 / 100 (HIGH RELIABILITY)` with
  // nothing on the terminal saying what had produced it. The caveat existed -- in a file nobody had
  // opened yet.
  const home = mkdtempSync(join(tmpdir(), "aos-caveat-"));
  try {
    aos(home, ["agent", "add", "faker", "--command", process.execPath, "--arg", fixture]);
    const run = spawnSync(process.execPath, [cli, "assess", "--timeout-ms", "20000"], {
      cwd: home, encoding: "utf8", timeout: 120000,
      env: { ...process.env, AOS_HOME: home, HOME: home }
    });
    assert.match(run.stdout, /FIXTURE-BACKED: faker ran a test fixture, not a runtime/);
    assert.match(run.stdout, /This result describes the fixture/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an unrecognised command is named as one", () => {
  // The fixture check is a filename rule, and a hundred-line stub called `solver` walked straight
  // past it to 100/100 with `fixture_backed_agents: []`. Detecting an arbitrary script that
  // pretends to be a runtime is not something this tool can do; saying which agents it did not
  // recognise is.
  const home = mkdtempSync(join(tmpdir(), "aos-unrecognised-"));
  try {
    writeFileSync(join(home, "solver"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    aos(home, ["agent", "add", "solver", "--command", join(home, "solver")]);
    const run = spawnSync(process.execPath, [cli, "assess", "--timeout-ms", "20000"], {
      cwd: home, encoding: "utf8", timeout: 120000,
      env: { ...process.env, AOS_HOME: home, HOME: home }
    });
    assert.match(run.stdout, /UNRECOGNISED RUNTIME: solver/);
    assert.doesNotMatch(run.stdout, /FIXTURE-BACKED/, "a plain stub is not this repository's fixture");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
