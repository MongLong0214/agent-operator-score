// Three things a real machine did that no fixture had: the answer key wearing a runtime's name, a
// generated plan choosing an agent for no reason, and that plan outliving the agent it chose.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultRoute, operatorPlanTemplate } from "../../lib/operator-plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const fixture = join(root, "tests", "product", "fake-agent.mjs");

const aos = (cwd, home, args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", timeout: 120000, env: { ...process.env, AOS_HOME: home, HOME: home }
  });

const temporary = (name) => mkdtempSync(join(tmpdir(), name));

// Found on a real machine: `claude`, `codex`, `gemini` and `grok` all registered as this repository's
// own fake agent, left by an earlier session's testing. `init` skipped every one of them, because not
// overwriting what the operator configured is the rule -- and so every later run routed into the
// answer key under the name of the runtime it was pretending to be.
test("init says when a runtime's name is taken by the answer key", () => {
  const home = temporary("aos-impostor-");
  const cwd = temporary("aos-impostor-cwd-");
  try {
    aos(cwd, home, ["agent", "add", "claude", "--command", process.execPath, "--arg", fixture]);

    const noticed = aos(cwd, home, ["init"]);
    assert.match(noticed.stderr, /claude is registered as this repository's test fixture/);
    assert.match(noticed.stderr, /scores the answer key/);
    assert.match(noticed.stderr, /aos init --force/);
    // Still refuses to overwrite on its own: the operator is told, and decides.
    assert.match(aos(cwd, home, ["agent", "list"]).stdout, new RegExp(fixture.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const forced = aos(cwd, home, ["init", "--force"]);
    assert.match(forced.stdout, /Registered .*claude/);
    assert.doesNotMatch(aos(cwd, home, ["agent", "list"]).stdout, /fake-agent/);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

test("--force re-registers the impostor and leaves a deliberate wrapper alone", () => {
  const home = temporary("aos-wrapper-");
  const cwd = temporary("aos-wrapper-cwd-");
  try {
    // Not fixture-backed: somebody meant this. It is theirs, with or without --force.
    aos(cwd, home, ["agent", "add", "codex", "--command", "/usr/bin/true", "--arg", "--my-wrapper"]);
    aos(cwd, home, ["init", "--force"]);
    assert.match(aos(cwd, home, ["agent", "list"]).stdout, /--my-wrapper/);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

// It was `agentIds[0]`. On a machine with four agents that chose `cc` -- a `claude` registered without
// `-p` -- which ran every family to exit 0 and wrote no artifact at all, and the assessment described
// that. A run has to route somewhere; it now routes somewhere for a reason it can state.
test("a generated plan routes at a runtime AOS recognises, not at the alphabet", () => {
  const agents = { aaa: {}, claude: { adapter: "claude-code.v1" }, zz: { adapter: "generic-command.v1" } };
  assert.equal(defaultRoute(Object.keys(agents), agents), "claude");
  assert.equal(operatorPlanTemplate(Object.keys(agents), agents).families["FAM-1"].route, "claude");

  // Nothing recognised: still answers, still deterministic, still the first.
  assert.equal(defaultRoute(["zz", "aaa"], { zz: {}, aaa: {} }), "zz");
  assert.equal(defaultRoute([], {}), "<agent-id>");
});

// The message named six routes and no remedy. The auto-write fires only when the file is absent, so
// the only way forward was deleting a file the error never mentions.
test("a plan AOS wrote keeps itself current; a plan you wrote does not get rewritten", () => {
  const home = temporary("aos-stale-");
  const cwd = temporary("aos-stale-cwd-");
  try {
    // Three, so that removing the routed one never empties the store -- an empty store fails earlier,
    // for a different reason, and would have tested nothing about plans.
    for (const id of ["aaa", "keeper", "spare"]) {
      aos(cwd, home, ["agent", "add", id, "--command", "/usr/bin/true"]);
    }
    aos(cwd, home, ["assess"]);
    const planFile = join(cwd, "aos-plan.json");
    const routed = JSON.parse(readFileSync(planFile, "utf8")).families["FAM-1"].route;

    aos(cwd, home, ["agent", "remove", routed]);
    const rerun = aos(cwd, home, ["assess"]);
    assert.match(rerun.stderr, /no longer registered, so it was rewritten/);
    assert.doesNotMatch(rerun.stderr + rerun.stdout, /AOS_INVALID_OPERATOR_PLAN/);
    assert.notEqual(JSON.parse(readFileSync(planFile, "utf8")).families["FAM-1"].route, routed);

    // A plan with the operator's own goal in it is theirs. It still stops, and still says why.
    const mine = join(cwd, "mine.json");
    aos(cwd, home, ["assess", "--template", mine]);
    const plan = JSON.parse(readFileSync(mine, "utf8"));
    plan.goal = "cut the weekly report over to the new pipeline without changing its output";
    writeFileSync(mine, JSON.stringify(plan, null, 2));
    aos(cwd, home, ["agent", "remove", plan.families["FAM-1"].route]);
    const refused = aos(cwd, home, ["assess", "--plan", mine]);
    assert.match(refused.stderr, /AOS_INVALID_OPERATOR_PLAN/);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});
