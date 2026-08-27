import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { addAgent, cli, makePlan, newestResult, newestRunId, run } from "./helpers.mjs";

const temporary = (name) => mkdtempSync(join(tmpdir(), name));

test("self verification and package version", () => {
  const cwd = temporary("aos-verify-");
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.equal(run(cwd, ["--version"]).stdout.trim(), manifest.version);
    const verified = JSON.parse(run(cwd, ["verify", "--json"]).stdout);
    assert.equal(verified.ok, true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("official assessment requires a non-vacuous operator plan", () => {
  const cwd = temporary("aos-plan-required-");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const missing = spawnSync(process.execPath, [cli, "assess", "--json"], { cwd, encoding: "utf8" });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /AOS_OPERATOR_PLAN_REQUIRED/);
    run(cwd, ["assess", "--template", "plan.json"]);
    const unchanged = spawnSync(process.execPath, [cli, "assess", "--plan", "plan.json"], { cwd, encoding: "utf8" });
    assert.notEqual(unchanged.status, 0);
    assert.match(unchanged.stderr, /AOS_INVALID_OPERATOR_PLAN/);
    const overwrite = spawnSync(process.execPath, [cli, "assess", "--template", "plan.json"], { cwd, encoding: "utf8" });
    assert.notEqual(overwrite.status, 0);
    assert.match(overwrite.stderr, /AOS_TEMPLATE_EXISTS/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("one agent can complete a controlled assessment", () => {
  const cwd = temporary("aos-single-");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    run(cwd, ["assess", "--plan", plan, "--json"]);
    const result = newestResult(cwd);
    assert.equal(result.status, "EXPERIMENTAL / PROVISIONAL");
    assert.equal(result.score.display, 100);
    assert.deepEqual(result.agent_portfolio.used, ["solo"]);
    assert.ok(result.operator_plan_digest);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("six vendor-neutral aliases share one operator score without agent-count bonus", () => {
  const cwd = temporary("aos-six-");
  try {
    run(cwd, ["init"]);
    const ids = ["codex", "claude", "gemini", "grok", "hermes", "buzz"];
    for (const id of ids) addAgent(cwd, id);
    const routes = Object.fromEntries(ids.map((id, index) => [`FAM-${index + 1}`, id]));
    const plan = makePlan(cwd, routes);
    run(cwd, ["assess", "--plan", plan, "--json"]);
    const result = newestResult(cwd);
    assert.equal(result.score.display, 100);
    assert.deepEqual(result.agent_portfolio.used, [...ids].sort());
    assert.equal(result.agent_portfolio.invocations, 6);
    assert.equal("agent_count" in result.metrics, false);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("parallel workers use isolated workspaces and evidence-bound handoffs", () => {
  const cwd = temporary("aos-parallel-");
  try {
    run(cwd, ["init"]);
    for (const id of ["a", "b", "joiner"]) addAgent(cwd, id);
    const routes = { "FAM-1": "a", "FAM-2": "a", "FAM-3": "a|b>joiner", "FAM-4": "b", "FAM-5": "joiner", "FAM-6": "a" };
    const plan = makePlan(cwd, routes);
    run(cwd, ["assess", "--plan", plan, "--json"]);
    const result = newestResult(cwd);
    assert.equal(result.issued, true);
    assert.equal(result.family_results["FAM-3"].invocations.length, 3);
    assert.equal(result.family_results["FAM-3"].handoff_complete, true);
    const runId = newestRunId(cwd);
    const graph = JSON.parse(run(cwd, ["session", "graph", runId, "--json"]).stdout);
    const created = graph.filter((edge) => edge.type === "handoff.created");
    assert.equal(created.length, 2);
    assert.ok(created.every((edge) => edge.artifact_digests.length > 0));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("duplicated role instructions are refused for a multi-agent route", () => {
  const cwd = temporary("aos-roles-");
  try {
    run(cwd, ["init"]);
    for (const id of ["a", "b", "joiner"]) addAgent(cwd, id);
    const planPath = makePlan(cwd, { "FAM-1": "a", "FAM-2": "a", "FAM-3": "a|b>joiner", "FAM-4": "b", "FAM-5": "joiner", "FAM-6": "a" });
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    const duplicate = "Perform the same generic role and return the same generic result to the operator.";
    plan.families["FAM-3"].agent_instructions = { a: duplicate, b: duplicate, joiner: duplicate };
    writeFileSync(planPath, JSON.stringify(plan));
    const result = spawnSync(process.execPath, [cli, "assess", "--plan", planPath], { cwd, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /distinct responsibilities/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("agent config refuses secret-like arguments", () => {
  const cwd = temporary("aos-secret-");
  try {
    run(cwd, ["init"]);
    const result = spawnSync(process.execPath, [cli, "agent", "add", "bad", "--command", "tool", "--arg", "API_KEY=secret"], { cwd, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AOS_SECRET_IN_AGENT_CONFIG/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("collaboration surfaces and imported or bridged evidence remain diagnostic", () => {
  const cwd = temporary("aos-surface-");
  try {
    run(cwd, ["init"]);
    run(cwd, ["surface", "add", "buzz", "--kind", "buzz", "--transport", "ndjson"]);
    const surfaces = JSON.parse(run(cwd, ["surface", "list", "--json"]).stdout);
    assert.equal(surfaces[0].id, "buzz");
    const source = join(cwd, "events.ndjson");
    writeFileSync(source, `${JSON.stringify({ event_type: "completion.claimed", payload: { claim: "blocked" } })}\n`);
    const imported = JSON.parse(run(cwd, ["import", "--producer", "buzz", "--file", source, "--json"]).stdout);
    assert.equal(imported.status, "DIAGNOSTIC_ONLY");
    const bridged = JSON.parse(run(cwd, ["bridge", "--run", imported.run_id, "--producer", "buzz", "--file", source, "--json"]).stdout);
    assert.equal(bridged.status, "DIAGNOSTIC_ONLY");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("an explicit session is reviewed without discovering any", () => {
  // Searching the default roots first meant that on a machine with no ~/.claude or ~/.codex the
  // command exited with "no sessions found" while holding the path it had been asked about.
  const cwd = temporary("aos-review-session-");
  try {
    const session = join(cwd, "explicit.jsonl");
    writeFileSync(
      session,
      `${JSON.stringify({ type: "assistant", cwd: "/repo", message: { content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: "/repo/a.ts" } }] } })}\n` +
        `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "all tests pass" }] } })}\n`,
      "utf8"
    );
    // HOME points at an empty directory, so nothing is discoverable.
    const reviewed = spawnSync(process.execPath, [cli, "review", "--session", session, "--json"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: cwd }
    });
    const result = JSON.parse(reviewed.stdout);
    assert.equal(result.findings.some((finding) => finding.rule === "completion-claimed-without-verification"), true);
    assert.equal(reviewed.status, 1, "a session with findings must not exit 0");

    const missing = spawnSync(process.execPath, [cli, "review", "--session", join(cwd, "nope.jsonl")], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, HOME: cwd }
    });
    assert.equal(missing.status, 2, "a path that does not exist is bad input, not an empty review");
    assert.match(missing.stdout, /no session file at/);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("asking for more sessions than the old cap returns more than the old cap", () => {
  // `--since 100` silently returned at most forty. The requested count and what could be found are
  // different numbers, and the output says both.
  const cwd = temporary("aos-review-limit-");
  try {
    const projects = join(cwd, ".claude", "projects", "sample");
    mkdirSync(projects, { recursive: true });
    const row = JSON.stringify({ type: "assistant", cwd: "/repo", message: { content: [{ type: "text", text: "hello" }] } });
    for (let index = 0; index < 45; index += 1) {
      writeFileSync(join(projects, `s-${index}.jsonl`), `${row}\n`, "utf8");
    }
    const env = { ...process.env, HOME: cwd };
    const asked = JSON.parse(
      spawnSync(process.execPath, [cli, "review", "--since", "45", "--json"], { cwd, encoding: "utf8", env }).stdout
    );
    assert.equal(asked.requested_sessions, 45);
    assert.equal(asked.reviewed_sessions, 45, "the request was capped");

    // And when there genuinely are not that many, both numbers are reported rather than one.
    const beyond = JSON.parse(
      spawnSync(process.execPath, [cli, "review", "--since", "60", "--json"], { cwd, encoding: "utf8", env }).stdout
    );
    assert.equal(beyond.requested_sessions, 60);
    assert.equal(beyond.reviewed_sessions, 45);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
