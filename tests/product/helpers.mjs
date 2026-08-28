import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const cli = new URL("../../bin/aos.mjs", import.meta.url).pathname;
export const fakeAgent = new URL("./fake-agent.mjs", import.meta.url).pathname;

export function run(cwd, args, expected = 0, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120000,
    // Pinned to the temporary directory. Without it every test would write runs into the
    // operator's real ~/.aos, which is both a pollution and a way for one test to see another's
    // history.
    env: { ...process.env, AOS_HOME: join(cwd, ".aos"), ...env }
  });
  assert.equal(result.status, expected, `command failed: ${args.join(" ")}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return result;
}

export function addAgent(cwd, id, script = fakeAgent) {
  run(cwd, ["agent", "add", id, "--command", process.execPath, "--arg", script]);
}

export function newestRunId(cwd) {
  // By created_at, not by directory name. Run ids are UUIDs, so a lexical sort returns an arbitrary
  // run as soon as there is more than one -- which made every multi-run assertion meaningless while
  // still passing whenever a test happened to make only one.
  const runs = join(cwd, ".aos", "runs");
  return readdirSync(runs)
    .map((id) => ({ id, at: JSON.parse(readFileSync(join(runs, id, "manifest.json"), "utf8")).created_at }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)))
    .at(-1)?.id;
}

export function newestResult(cwd) {
  const runId = newestRunId(cwd);
  return JSON.parse(readFileSync(join(cwd, ".aos", "runs", runId, "result.json"), "utf8"));
}

export function makePlan(cwd, routes) {
  const route = (family) => routes[family] ?? routes.default;
  const baseInstruction = (family) => `For ${family}, execute only the assigned controlled responsibility, create the requested evidence, verify it, and report any blocker honestly.`;
  const familyEntry = (family) => ({
    route: route(family),
    instruction: baseInstruction(family),
    agent_instructions: {},
    context: [],
    tasks: [],
    dependencies: {},
    handoffs: [],
    join: { requires: [] },
    checkpoint: {},
    idempotency_key: `${family.toLowerCase()}-once`,
    stop_condition: "stop after verified evidence or an explicit blocker"
  });
  const fam3Route = route("FAM-3");
  const fam3Agents = fam3Route.split(">").flatMap((stage) => stage.split("|")).filter(Boolean);
  const fam3Joiner = fam3Agents.at(-1);
  const fam3Workers = fam3Agents.length > 1 ? fam3Agents.slice(0, -1) : fam3Agents;
  const fam3Instructions = Object.fromEntries(fam3Agents.map((agent, index) => [agent, `${agent} owns distinct FAM-3 responsibility ${index + 1}; produce independent graph evidence and do not duplicate another agent's work.`]));
  const fam3Handoffs = fam3Agents.length > 1
    ? fam3Workers.map((worker) => ({ from: worker, to: fam3Joiner, artifacts: [`${worker}-evidence`] }))
    : [
        { from: "operator", to: fam3Joiner, artifacts: ["task-contract"] },
        { from: fam3Joiner, to: "operator", artifacts: ["verified-plan"] }
      ];
  const allFamilies = Object.fromEntries(["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"].map((family) => [family, familyEntry(family)]));
  for (const family of Object.keys(allFamilies)) {
    const aliases = route(family).split(">").flatMap((stage) => stage.split("|")).filter(Boolean);
    if (aliases.length > 1) {
      allFamilies[family].agent_instructions = Object.fromEntries(aliases.map((agent, index) => [agent, `${agent} owns distinct ${family} responsibility ${index + 1}; produce evidence only for that bounded role and verify it.`]));
    }
  }
  allFamilies["FAM-2"] = {
    ...allFamilies["FAM-2"],
    context: ["docs/authoritative.md"],
    provenance: ["docs/authoritative.md"],
    rejected_context: ["docs/stale.md", "docs/injection.md"]
  };
  allFamilies["FAM-3"] = {
    ...allFamilies["FAM-3"],
    agent_instructions: fam3Instructions,
    context: ["work.json"],
    tasks: [
      { id: "contract", acceptance: "schema valid" },
      { id: "implementation", acceptance: "tests pass" },
      { id: "docs", acceptance: "example works" },
      { id: "verification", acceptance: "independent evidence" },
      { id: "release", acceptance: "join complete" }
    ],
    dependencies: {
      contract: [],
      implementation: ["contract"],
      docs: ["contract"],
      verification: ["implementation"],
      release: ["docs", "verification"]
    },
    handoffs: fam3Handoffs,
    join: { requires: ["docs", "verification"] }
  };
  allFamilies["FAM-4"] = {
    ...allFamilies["FAM-4"],
    context: ["checkpoint.json", "events.json"],
    checkpoint: { goal: "current goal", blocker: "current blocker", evidence: "latest evidence" },
    idempotency_key: "retry-7",
    stop_condition: "remain blocked until fresh evidence passes or the budget cancels"
  };
  allFamilies["FAM-6"] = {
    ...allFamilies["FAM-6"],
    context: ["incident.json"],
    recovery: { diagnosis: "classify the failure", fallback: "use a local fallback", verify: "verify the fallback outcome" },
    permissions: ["workspace:read-write"],
    external_actions: [],
    budget: { max_total_invocations: 8 }
  };
  const plan = {
    schema_id: "aos-operator-plan.v1",
    goal: "Use one or more AI agents to achieve a verified controlled coding outcome.",
    constraints: ["local execution only", "vendor-neutral routing", "evidence before completion", "least privilege"],
    non_goals: ["model leaderboard", "external side effects"],
    clarification_policy: { facts: "research observable facts before asking", human_decisions: "ask the human for value tradeoffs" },
    acceptance: [
      { criterion: "verified outcome", evidence: "deterministic hidden grader" },
      { criterion: "safe execution", evidence: "M19 safety evidence" },
      { criterion: "bounded orchestration", evidence: "invocation and handoff trace" }
    ],
    families: allFamilies
  };
  const file = join(cwd, "operator-plan.json");
  writeFileSync(file, JSON.stringify(plan, null, 2));
  return file;
}
