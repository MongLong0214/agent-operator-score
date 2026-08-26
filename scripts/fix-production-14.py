from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"patch target not found: {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new), encoding="utf-8")


# Multi-agent routes need role-specific instructions. Repeating one generic instruction across every
# worker and joiner is not evidence of orchestration skill.
replace(
    "lib/operator-plan.mjs",
    '''    if (typeof entry.route !== "string" || aliases(entry.route).length === 0) problems.push(`${family}.route is missing`);
    if (typeof entry.instruction !== "string" || entry.instruction.trim().length < 20) problems.push(`${family}.instruction is too short`);
    for (const agent of aliases(entry.route)) if (configured.size > 0 && !configured.has(agent)) problems.push(`${family}.route references unknown agent ${agent}`);
''',
    '''    const routeAgents = aliases(entry.route);
    if (typeof entry.route !== "string" || routeAgents.length === 0) problems.push(`${family}.route is missing`);
    if (typeof entry.instruction !== "string" || entry.instruction.trim().length < 20) problems.push(`${family}.instruction is too short`);
    if (routeAgents.length > 1) {
      if (!entry.agent_instructions || typeof entry.agent_instructions !== "object") problems.push(`${family}.agent_instructions are required for multi-agent routes`);
      else for (const agent of routeAgents) if (typeof entry.agent_instructions[agent] !== "string" || entry.agent_instructions[agent].trim().length < 20) problems.push(`${family}.agent_instructions.${agent} is required`);
    }
    for (const agent of routeAgents) if (configured.size > 0 && !configured.has(agent)) problems.push(`${family}.route references unknown agent ${agent}`);
'''
)
replace(
    "lib/operator-plan.mjs",
    '''  const routeAliases = Object.values(routes).map(aliases);
  const dependency = fam3.dependencies ?? {};
''',
    '''  const routeAliases = Object.values(routes).map(aliases);
  const fam3Agents = aliases(fam3.route);
  const roleInstructions = fam3.agent_instructions ?? {};
  const roleSpecific = fam3Agents.length <= 1 || (fam3Agents.every((agent) => typeof roleInstructions[agent] === "string" && roleInstructions[agent].trim().length >= 20) && new Set(fam3Agents.map((agent) => roleInstructions[agent])).size >= 2);
  const dependency = fam3.dependencies ?? {};
'''
)
replace(
    "lib/operator-plan.mjs",
    '''    M10: row(routeAliases.every((entries) => entries.length >= 1 && entries.length <= 3 && new Set(entries).size === entries.length) && routeAliases.slice(0, 2).every((entries) => entries.length === 1) && routeAliases.slice(3).every((entries) => entries.length === 1)),
    M11: row(handoffs.length >= 2 && handoffs.every((entry) => entry.from && entry.to && Array.isArray(entry.artifacts) && entry.artifacts.length > 0) && Array.isArray(fam3.join?.requires) && fam3.join.requires.includes("docs") && fam3.join.requires.includes("verification")),
''',
    '''    M10: row(roleSpecific && routeAliases.every((entries) => entries.length >= 1 && entries.length <= 3 && new Set(entries).size === entries.length) && routeAliases.slice(0, 2).every((entries) => entries.length === 1) && routeAliases.slice(3).every((entries) => entries.length === 1)),
    M11: row(handoffs.length >= 2 && handoffs.every((entry) => ["operator", ...fam3Agents].includes(entry.from) && ["operator", ...fam3Agents].includes(entry.to) && entry.from !== entry.to && Array.isArray(entry.artifacts) && entry.artifacts.length > 0) && Array.isArray(fam3.join?.requires) && fam3.join.requires.includes("docs") && fam3.join.requires.includes("verification")),
'''
)
replace(
    "lib/operator-plan.mjs",
    '''  const family = (instruction) => ({ route: agent, instruction, context: [], tasks: [], dependencies: {}, handoffs: [], join: { requires: [] }, checkpoint: {}, idempotency_key: "", stop_condition: "" });
''',
    '''  const family = (instruction) => ({ route: agent, instruction, agent_instructions: {}, context: [], tasks: [], dependencies: {}, handoffs: [], join: { requires: [] }, checkpoint: {}, idempotency_key: "", stop_condition: "" });
'''
)

# Handoff payloads carry the exact artifact digests passed to the receiver.
replace(
    "lib/store.mjs",
    '''  "handoff.consumed": ["from", "to", "family"],
''',
    '''  "handoff.consumed": ["from", "to", "family", "artifact_digests"],
'''
)

# Import artifact digest helper and add recursive symlink refusal/digesting.
replace(
    "lib/cli.mjs",
    '''  commandExists,
  getOption,
''',
    '''  commandExists,
  fileDigest,
  getOption,
'''
)
replace(
    "lib/cli.mjs",
    '''function outputNames(root) {
  return readdirSync(root).filter((name) => !["task.md", "request.txt", "docs", "work.json", "checkpoint.json", "events.json", "public-check.mjs", "incident.json", "branches", "candidates"].includes(name));
}
''',
    '''function outputNames(root) {
  return readdirSync(root).filter((name) => !["task.md", "request.txt", "docs", "work.json", "checkpoint.json", "events.json", "public-check.mjs", "incident.json", "branches", "candidates"].includes(name));
}

function artifactDigest(path, relative = "") {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`AOS_SYMLINK_ARTIFACT ${relative || path}`);
  if (stat.isFile()) return sha256Text(`${relative}\\0${fileDigest(path)}`);
  if (!stat.isDirectory()) throw new Error(`AOS_UNSUPPORTED_ARTIFACT ${relative || path}`);
  const rows = readdirSync(path).sort().map((name) => `${name}:${artifactDigest(join(path, name), relative ? `${relative}/${name}` : name)}`);
  return sha256Text(rows.join("\\n"));
}

function outputArtifactDigests(root) {
  return outputNames(root).sort().map((name) => artifactDigest(join(root, name), name));
}
'''
)

# Route execution uses the instruction assigned to each agent and returns handoff-integrity evidence.
replace(
    "lib/cli.mjs",
    '''async function executeRoute(cwd, runId, family, expression, config, workspace, operatorInstruction, timeoutMs) {
  const stages = expression.split(">").map((stage) => stage.split("|").map((id) => id.trim()).filter(Boolean));
''',
    '''async function executeRoute(cwd, runId, family, familyPlan, config, workspace, timeoutMs) {
  const expression = familyPlan.route;
  const instructionFor = (id) => familyPlan.agent_instructions?.[id] ?? familyPlan.instruction;
  const stages = expression.split(">").map((stage) => stage.split("|").map((id) => id.trim()).filter(Boolean));
'''
)
replace(
    "lib/cli.mjs",
    '''  const invocations = [];
  let previous = [];
''',
    '''  const invocations = [];
  let previous = [];
  const previousArtifacts = new Map();
  let handoffComplete = true;
'''
)
replace(
    "lib/cli.mjs",
    '''        const prompt = promptFor(family, branch, `parallel-${stageIndex + 1}`, [], operatorInstruction);
        const result = await invokeAgent(cwd, runId, family, agent, branch, `parallel-${stageIndex + 1}`, prompt, timeoutMs, join(branch, "task.md"), operatorInstruction);
''',
    '''        const instruction = instructionFor(id);
        const prompt = promptFor(family, branch, `parallel-${stageIndex + 1}`, [], instruction);
        const result = await invokeAgent(cwd, runId, family, agent, branch, `parallel-${stageIndex + 1}`, prompt, timeoutMs, join(branch, "task.md"), instruction);
'''
)
replace(
    "lib/cli.mjs",
    '''        for (const name of outputNames(item.branch)) {
          const source = join(item.branch, name);
          if (lstatSync(source).isSymbolicLink()) throw new Error(`AOS_SYMLINK_ARTIFACT ${name}`);
          cpSync(source, join(destination, name), { recursive: true, dereference: false });
        }
        invocations.push({ agent: item.id, ...item.result });
''',
    '''        for (const name of outputNames(item.branch)) {
          const source = join(item.branch, name);
          artifactDigest(source, name);
          cpSync(source, join(destination, name), { recursive: true, dereference: false });
        }
        previousArtifacts.set(item.id, outputArtifactDigests(item.branch));
        invocations.push({ agent: item.id, ...item.result });
'''
)
replace(
    "lib/cli.mjs",
    '''      for (const from of previous) {
        appendEvent(cwd, runId, "operator", { event_type: "handoff.created", family, payload: { from, to: id, family, artifact_digests: [] } });
        appendEvent(cwd, runId, `agent-${id}`, { event_type: "handoff.consumed", agent_profile_id: id, family, payload: { from, to: id, family } });
      }
''',
    '''      for (const from of previous) {
        const artifactDigests = previousArtifacts.get(from) ?? [];
        if (artifactDigests.length === 0) handoffComplete = false;
        appendEvent(cwd, runId, "operator", { event_type: "handoff.created", family, payload: { from, to: id, family, artifact_digests: artifactDigests } });
        appendEvent(cwd, runId, `agent-${id}`, { event_type: "handoff.consumed", agent_profile_id: id, family, payload: { from, to: id, family, artifact_digests: artifactDigests } });
      }
'''
)
replace(
    "lib/cli.mjs",
    '''    const prompt = promptFor(family, workspace, `stage-${stageIndex + 1}`, previous, operatorInstruction);
    const result = await invokeAgent(cwd, runId, family, agent, workspace, `stage-${stageIndex + 1}`, prompt, timeoutMs, join(workspace, "task.md"), operatorInstruction);
    invocations.push({ agent: id, ...result });
    previous = [id];
  }
  return invocations;
}
''',
    '''    const instruction = instructionFor(id);
    const prompt = promptFor(family, workspace, `stage-${stageIndex + 1}`, previous, instruction);
    const result = await invokeAgent(cwd, runId, family, agent, workspace, `stage-${stageIndex + 1}`, prompt, timeoutMs, join(workspace, "task.md"), instruction);
    invocations.push({ agent: id, ...result });
    previousArtifacts.set(id, outputArtifactDigests(workspace));
    previous = [id];
  }
  return { invocations, handoff_complete: handoffComplete };
}
'''
)

# Assessment consumes the execution evidence and refuses M11 credit for an empty actual handoff.
replace(
    "lib/cli.mjs",
    '''      const runs = await executeRoute(cwd, runId, family, route, config, workspace, plan.families[family].instruction, timeoutMs);
      if (runs.some((entry) => entry.interrupted)) throw new Error("AOS_CANCELLED");
      invocations += runs.length;
      const graded = await gradeScenario(family, workspace, { baseline: prepared.baseline, invocationCount: runs.length });
      if (runs.some((entry) => !entry.ok)) {
''',
    '''      const execution = await executeRoute(cwd, runId, family, plan.families[family], config, workspace, timeoutMs);
      const runs = execution.invocations;
      if (runs.some((entry) => entry.interrupted)) throw new Error("AOS_CANCELLED");
      invocations += runs.length;
      const graded = await gradeScenario(family, workspace, { baseline: prepared.baseline, invocationCount: runs.length });
      if (family === "FAM-3" && !execution.handoff_complete) graded.metrics.M11 = 0;
      if (runs.some((entry) => !entry.ok)) {
'''
)
replace(
    "lib/cli.mjs",
    '''      familyResults[family] = { route, invocations: runs.map((entry) => ({ agent: entry.agent, ok: entry.ok, exit_code: entry.exit_code, timed_out: entry.timed_out, duration_ms: entry.duration_ms })), grader: graded.details };
''',
    '''      familyResults[family] = { route, handoff_complete: execution.handoff_complete, invocations: runs.map((entry) => ({ agent: entry.agent, ok: entry.ok, exit_code: entry.exit_code, timed_out: entry.timed_out, duration_ms: entry.duration_ms })), grader: graded.details };
'''
)

# Plan template/test fixtures include explicit per-agent roles and route-bound handoffs.
replace(
    "test-product/aos.test.mjs",
    '''  const route = (family) => routes[family] ?? routes.default;
  const instruction = (family) => `Use the declared ${family} strategy, inspect only the controlled workspace, produce the requested artifact, verify it, and report blockers honestly.`;
  const plan = {
''',
    '''  const route = (family) => routes[family] ?? routes.default;
  const instruction = (family) => `Use the declared ${family} strategy, inspect only the controlled workspace, produce the requested artifact, verify it, and report blockers honestly.`;
  const fam3Route = route("FAM-3");
  const fam3Agents = fam3Route.split(">").flatMap((stage) => stage.split("|")).filter(Boolean);
  const fam3Joiner = fam3Agents.at(-1);
  const fam3Workers = fam3Agents.length > 1 ? fam3Agents.slice(0, -1) : fam3Agents;
  const fam3Instructions = Object.fromEntries(fam3Agents.map((agent, index) => [agent, `${agent} owns role ${index + 1}: produce independent evidence for the FAM-3 graph, handoff, or join and verify only its assigned responsibility.`]));
  const fam3Handoffs = fam3Agents.length > 1
    ? fam3Workers.map((worker) => ({ from: worker, to: fam3Joiner, artifacts: [`${worker}-evidence`] }))
    : [{ from: "operator", to: fam3Joiner, artifacts: ["task-contract"] }, { from: fam3Joiner, to: "operator", artifacts: ["verified-plan"] }];
  const plan = {
'''
)
replace(
    "test-product/aos.test.mjs",
    '''      "FAM-3": { route: route("FAM-3"), instruction: instruction("FAM-3"), context: ["work.json"], tasks: [{ id: "contract", acceptance: "schema valid" }, { id: "implementation", acceptance: "tests pass" }, { id: "docs", acceptance: "example works" }, { id: "verification", acceptance: "independent evidence" }, { id: "release", acceptance: "join complete" }], dependencies: { contract: [], implementation: ["contract"], docs: ["contract"], verification: ["implementation"], release: ["docs", "verification"] }, handoffs: [{ from: "architect", to: "builder", artifacts: ["contract"] }, { from: "builder", to: "reviewer", artifacts: ["implementation", "tests"] }], join: { requires: ["docs", "verification"] }, checkpoint: {}, idempotency_key: "fam3-once", stop_condition: "stop after joined evidence" },
''',
    '''      "FAM-3": { route: fam3Route, instruction: instruction("FAM-3"), agent_instructions: fam3Instructions, context: ["work.json"], tasks: [{ id: "contract", acceptance: "schema valid" }, { id: "implementation", acceptance: "tests pass" }, { id: "docs", acceptance: "example works" }, { id: "verification", acceptance: "independent evidence" }, { id: "release", acceptance: "join complete" }], dependencies: { contract: [], implementation: ["contract"], docs: ["contract"], verification: ["implementation"], release: ["docs", "verification"] }, handoffs: fam3Handoffs, join: { requires: ["docs", "verification"] }, checkpoint: {}, idempotency_key: "fam3-once", stop_condition: "stop after joined evidence" },
'''
)

# Explicit role/handoff regression.
(ROOT / "test-product" / "handoff.test.mjs").write_text(r'''import assert from "node:assert/strict";
import { test } from "node:test";
import { operatorPlanTemplate, validateOperatorPlan } from "../lib/operator-plan.mjs";

test("multi-agent routes require an instruction for every worker and joiner", () => {
  const plan = operatorPlanTemplate(["a", "b", "joiner"]);
  plan.goal = "The human operator uses agents to achieve a verified outcome.";
  plan.constraints = ["vendor-neutral", "local-first", "macOS", "Linux"];
  plan.non_goals = ["Windows", "SaaS"];
  plan.clarification_policy = { facts: "research", human_decisions: "ask human" };
  plan.acceptance = [{ criterion: "a", evidence: "a" }, { criterion: "b", evidence: "b" }, { criterion: "c", evidence: "c" }];
  plan.families["FAM-3"].route = "a|b>joiner";
  const missing = validateOperatorPlan(plan, ["a", "b", "joiner"]);
  assert.equal(missing.some((problem) => problem.includes("agent_instructions")), true);
  plan.families["FAM-3"].agent_instructions = { a: "A produces the implementation evidence and reports only its assigned scope.", b: "B independently verifies constraints and produces review evidence for the joiner.", joiner: "The joiner resolves conflicts, adopts verified artifacts, and produces the final joined result." };
  assert.equal(validateOperatorPlan(plan, ["a", "b", "joiner"]).some((problem) => problem.includes("agent_instructions")), false);
});
''', encoding="utf-8")

readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8")
readme = readme.replace(
    '''`a|b>joiner` runs `a` and `b` in isolated workspaces and requires an explicit joiner. The operator plan and actual artifacts are both graded; a polished plan cannot hide a failed outcome, and a strong model cannot manufacture missing operator evidence.
''',
    '''`a|b>joiner` runs `a` and `b` in isolated workspaces and requires an explicit joiner. Multi-agent routes must also define `agent_instructions` for every worker and joiner; repeating one generic prompt is refused as missing role evidence. Handoffs carry exact artifact digests, nested symlinks are rejected, and the receiving stage records consumption of the same digest set. The operator plan and actual artifacts are both graded; a polished plan cannot hide a failed outcome, and a strong model cannot manufacture missing operator evidence.
'''
)
readme_path.write_text(readme, encoding="utf-8")

print("Agent-specific role and evidence-bound handoff contract applied")
