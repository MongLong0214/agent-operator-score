import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
