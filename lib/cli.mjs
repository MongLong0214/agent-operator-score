import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION,
  assertSupportedPlatform,
  canonicalJson,
  commandExists,
  fileDigest,
  getOption,
  getOptions,
  makeId,
  parseArgs,
  readJson,
  rejectSecretLike,
  requireId,
  runProcess,
  sha256Text,
  writeJson
} from "./core.mjs";
import {
  addAgent,
  addSurface,
  appendEvent,
  commitTerminal,
  createRun,
  initProject,
  listRuns,
  readConfig,
  readRun,
  recoverRun,
  removeAgent,
  removeSurface,
  runPaths,
  writeResult
} from "./store.mjs";
import { perfectMetricInput, scoreMetrics } from "./scorer.mjs";
import { FAMILIES, cloneScenario, gradeScenario, prepareScenario, promptFor, suiteDigest } from "./suite.mjs";
import { renderHtml, renderMarkdown } from "./report.mjs";
import { findSessions, loadSession } from "./session.mjs";
import { aggregateFindings, reviewSession } from "./review.mjs";
import { gradeOperatorPlan, operatorPlanTemplate, routeAliases, validateOperatorPlan } from "./operator-plan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const usage = `Agent Operator Score ${VERSION}

Commands:
  aos init
  aos review [--session <path>] [--since <n>] [--list] [--json]
  aos doctor [--json]
  aos agent add <id> --command <binary> [--arg <value> ...]
  aos agent list | remove <id> | doctor [id] | run <id> --task <text> [--workspace <path>]
  aos surface add <id> [--kind <kind>] [--transport ndjson]
  aos surface list | remove <id>
  aos assess --template <operator-plan.json> [--force]
  aos assess --plan <operator-plan.json> [--timeout-ms 300000] [--json]
  aos observe --agent <id> --task <text> [--workspace <path>]
  aos import [--run <id>] --producer <id> --file <events.ndjson>
  aos bridge [--run <id>] --producer <id> [--file <events.ndjson>]
  aos report --run <id> [--format markdown|html|json]
  aos session list | status <id> | graph <id> | recover <id> | cancel <id>
  aos handoff create --run <id> --from <id> --to <id> --family <FAM-n> [--artifact <sha256> ...]
  aos handoff consume --run <id> --from <id> --to <id> --family <FAM-n> [--artifact <sha256> ...]
  aos verify [--json]
`;

function emit(io, value, json = false) {
  io.stdout.write(json ? canonicalJson(value) : `${value}\n`);
}
function fail(io, message, code = 2) { io.stderr.write(`${message}\n`); return code; }
function outputNames(root) {
  return readdirSync(root).filter((name) => ![
    "task.md", "request.txt", "docs", "work.json", "checkpoint.json", "events.json",
    "public-check.mjs", "incident.json", "branches", "candidates"
  ].includes(name));
}

function artifactDigest(path, relative = "") {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`AOS_SYMLINK_ARTIFACT ${relative || path}`);
  if (stat.isFile()) return sha256Text(`${relative}\0${fileDigest(path)}`);
  if (!stat.isDirectory()) throw new Error(`AOS_UNSUPPORTED_ARTIFACT ${relative || path}`);
  const rows = readdirSync(path).sort().map((name) => `${name}:${artifactDigest(join(path, name), relative ? `${relative}/${name}` : name)}`);
  return sha256Text(rows.join("\n"));
}

function outputArtifactDigests(root) {
  return outputNames(root).sort().map((name) => artifactDigest(join(root, name), name));
}

async function invokeAgent(cwd, runId, family, agent, workspace, stage, prompt, timeoutMs, operatorInstruction) {
  const producer = `agent-${agent.id}`;
  appendEvent(cwd, runId, "operator", {
    event_type: "user.instruction",
    agent_profile_id: agent.id,
    family,
    payload: {
      agent_profile_id: agent.id,
      family,
      stage,
      instruction_digest: sha256Text(operatorInstruction),
      instruction_length: operatorInstruction.length
    }
  });
  appendEvent(cwd, runId, producer, {
    event_type: "agent.started",
    agent_profile_id: agent.id,
    family,
    payload: { agent_profile_id: agent.id, family, stage }
  });
  const result = await runProcess(agent, {
    workspace,
    family,
    stage,
    prompt,
    promptFile: join(workspace, "task.md"),
    session: runId,
    timeoutMs
  });
  appendEvent(cwd, runId, producer, {
    event_type: "agent.ended",
    agent_profile_id: agent.id,
    family,
    evidence_digest: result.stdout_digest,
    payload: {
      agent_profile_id: agent.id,
      family,
      stage,
      ok: result.ok,
      exit_code: result.exit_code,
      timed_out: result.timed_out,
      duration_ms: result.duration_ms,
      stdout_bytes: result.stdout_bytes,
      stderr_bytes: result.stderr_bytes,
      stdout_digest: result.stdout_digest,
      stderr_digest: result.stderr_digest
    }
  });
  for (const semantic of result.semantic_events) {
    if (typeof semantic.event_type !== "string") continue;
    appendEvent(cwd, runId, producer, { ...semantic, agent_profile_id: agent.id, family });
  }
  return result;
}

async function executeRoute(cwd, runId, family, familyPlan, config, workspace, timeoutMs) {
  const expression = familyPlan.route;
  const instructionFor = (id) => familyPlan.agent_instructions?.[id] ?? familyPlan.instruction;
  const stages = expression.split(">").map((stage) => stage.split("|").map((id) => id.trim()).filter(Boolean));
  if (stages.some((stage) => stage.length === 0)) throw new Error(`AOS_INVALID_ROUTE ${expression}`);
  if (stages.at(-1).length > 1) throw new Error(`AOS_PARALLEL_ROUTE_REQUIRES_JOIN ${expression}`);

  const invocations = [];
  let previous = [];
  const previousArtifacts = new Map();
  let handoffComplete = true;

  for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
    const stage = stages[stageIndex];
    if (stage.length > 1) {
      const branchRoot = `${workspace}-parallel-${stageIndex + 1}`;
      rmSync(branchRoot, { recursive: true, force: true });
      mkdirSync(branchRoot, { recursive: true });
      const finished = await Promise.all(stage.map(async (id) => {
        const agent = config.agents[id];
        if (!agent) throw new Error(`AOS_AGENT_NOT_FOUND ${id}`);
        const branch = join(branchRoot, id);
        cloneScenario(workspace, branch);
        rmSync(join(branch, "branches"), { recursive: true, force: true });
        rmSync(join(branch, "candidates"), { recursive: true, force: true });
        const instruction = instructionFor(id);
        const prompt = promptFor(family, branch, `parallel-${stageIndex + 1}`, [], instruction);
        const result = await invokeAgent(cwd, runId, family, agent, branch, `parallel-${stageIndex + 1}`, prompt, timeoutMs, instruction);
        return { id, branch, result };
      }));

      const candidates = join(workspace, "candidates");
      rmSync(candidates, { recursive: true, force: true });
      mkdirSync(candidates, { recursive: true });
      for (const item of finished) {
        const destination = join(candidates, item.id);
        mkdirSync(destination, { recursive: true });
        for (const name of outputNames(item.branch)) {
          const source = join(item.branch, name);
          artifactDigest(source, name);
          cpSync(source, join(destination, name), { recursive: true, dereference: false });
        }
        previousArtifacts.set(item.id, outputArtifactDigests(item.branch));
        invocations.push({ agent: item.id, ...item.result });
      }
      previous = stage;
      continue;
    }

    const id = stage[0];
    const agent = config.agents[id];
    if (!agent) throw new Error(`AOS_AGENT_NOT_FOUND ${id}`);
    if (previous.length > 0) {
      for (const from of previous) {
        const artifactDigests = previousArtifacts.get(from) ?? [];
        if (artifactDigests.length === 0) handoffComplete = false;
        appendEvent(cwd, runId, "operator", {
          event_type: "handoff.created",
          family,
          payload: { from, to: id, family, artifact_digests: artifactDigests }
        });
        appendEvent(cwd, runId, `agent-${id}`, {
          event_type: "handoff.consumed",
          agent_profile_id: id,
          family,
          payload: { from, to: id, family, artifact_digests: artifactDigests }
        });
      }
    }
    const instruction = instructionFor(id);
    const prompt = promptFor(family, workspace, `stage-${stageIndex + 1}`, previous, instruction);
    const result = await invokeAgent(cwd, runId, family, agent, workspace, `stage-${stageIndex + 1}`, prompt, timeoutMs, instruction);
    invocations.push({ agent: id, ...result });
    previousArtifacts.set(id, outputArtifactDigests(workspace));
    previous = [id];
  }
  return { invocations, handoff_complete: handoffComplete };
}

// Findings about a session the operator already ran. This costs no model quota and grades their
// own work, which is the only reason to look at it a second time.
function review(options, io) {
  // An explicit path is answered before anything is discovered. Searching first meant that on a
  // machine with no ~/.claude or ~/.codex the command exited with "no sessions found" while
  // holding the path to the session it had been asked about.
  const chosen = getOption(options, "session");
  if (typeof chosen === "string") {
    if (!existsSync(chosen)) {
      emit(io, `no session file at ${chosen}`);
      return 2;
    }
    return reportSession(reviewSession(loadSession(chosen)), options, io);
  }

  const since = Number(getOption(options, "since", 0));
  // Asking for a hundred used to return at most forty, silently. The requested count and what
  // could be found are different numbers and the output says both.
  const wanted = Number.isFinite(since) && since > 1 ? Math.trunc(since) : 40;
  const sessions = findSessions({ limit: wanted });
  if (!sessions.length) {
    emit(io, "no Codex or Claude Code sessions found under ~/.codex or ~/.claude");
    return 1;
  }
  if (getOption(options, "list")) {
    for (const entry of sessions.slice(0, 15)) {
      emit(io, `${new Date(entry.modified).toISOString().slice(0, 16).replace("T", " ")}\t${entry.runtime}\t${entry.path}`);
    }
    return 0;
  }

  // A trend across recent sessions is more useful than one session: what recurs is what to fix.
  if (Number.isFinite(since) && since > 1) {
    const reviewed = sessions.slice(0, since).map((entry) => reviewSession(loadSession(entry.path)));
    const ranked = aggregateFindings(reviewed);
    const incomplete = reviewed.filter((result) => result.status === "INCOMPLETE").length;
    const observed = reviewed.reduce((total, result) => total + (result.observations?.length ?? 0), 0);
    if (getOption(options, "json")) {
      emit(io, canonicalJson({
        requested_sessions: wanted,
        reviewed_sessions: reviewed.length,
        incomplete_sessions: incomplete,
        observations: observed,
        rules: ranked
      }).trimEnd());
      return ranked.length ? 1 : 0;
    }
    const shortfall = wanted > reviewed.length ? ` (${wanted} requested, ${reviewed.length} found)` : "";
    emit(io, `${reviewed.length} session(s)${shortfall}${incomplete > 0 ? `, ${incomplete} only partly readable` : ""}`);
    if (observed > 0) emit(io, `${observed} observation(s) recorded, none of them findings`);
    emit(io, "");
    if (!ranked.length) { emit(io, "no findings"); return 0; }
    for (const row of ranked) {
      const times = row.finding_count === row.session_count ? "" : ` (${row.finding_count} findings)`;
      emit(io, `${String(row.session_count).padStart(3)} / ${reviewed.length}  [${row.severity}] ${row.rule}${times}`);
    }
    return 1;
  }

  return reportSession(reviewSession(loadSession(sessions[0].path)), options, io);
}

function reportSession(result, options, io) {
  if (getOption(options, "json")) {
    emit(io, canonicalJson(result).trimEnd());
    return result.findings.length ? 1 : 0;
  }

  const minutes = result.duration_ms === null ? "?" : Math.round(result.duration_ms / 60000);
  emit(io, `${result.cwd ?? result.path}`);
  emit(io, `${result.calls} tool calls · ${result.operator_turns} operator turns · ${minutes} min`);
  emit(io, "");
  if (!result.findings.length) {
    emit(io, "no findings");
    return 0;
  }
  for (const finding of result.findings) {
    emit(io, `[${finding.severity}] ${finding.rule}`);
    emit(io, `  ${finding.where}`);
    emit(io, `  ${finding.what}`);
    if (finding.evidence) emit(io, `  ${finding.evidence.slice(0, 160)}`);
    emit(io, "");
  }
  return 1;
}

async function assess(cwd, options, io) {
  assertSupportedPlatform();
  const config = readConfig(cwd);
  const templatePath = getOption(options, "template");
  if (typeof templatePath === "string") {
    const target = resolve(cwd, templatePath);
    if (existsSync(target) && getOption(options, "force", false) !== true) throw new Error(`AOS_TEMPLATE_EXISTS ${target}; pass --force to replace it`);
    writeJson(target, operatorPlanTemplate(Object.keys(config.agents)));
    emit(io, getOption(options, "json", false) === true ? { ok: true, template: target } : `Wrote operator plan template: ${target}`, getOption(options, "json", false) === true);
    return 0;
  }

  const planPath = getOption(options, "plan");
  if (typeof planPath !== "string") throw new Error("AOS_OPERATOR_PLAN_REQUIRED; run aos assess --template aos-plan.json");
  const plan = readJson(resolve(cwd, planPath));
  const planProblems = validateOperatorPlan(plan, Object.keys(config.agents));
  if (planProblems.length > 0) throw new Error(`AOS_INVALID_OPERATOR_PLAN ${planProblems.join("; ")}`);
  const operatorGrade = gradeOperatorPlan(plan);
  const routes = Object.fromEntries(FAMILIES.map((family) => [family, plan.families[family].route]));
  const timeoutMs = Number(getOption(options, "timeout-ms", 300000));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error("AOS_INVALID_TIMEOUT");

  const profile = Object.values(config.agents).map((agent) => ({
    id: agent.id,
    runtime_name: agent.runtime_name,
    vendor: agent.vendor,
    adapter: agent.adapter,
    config_digest: agent.config_digest,
    available: commandExists(agent.command)
  }));
  for (const expression of Object.values(routes)) {
    for (const id of routeAliases(expression)) {
      const agent = config.agents[id];
      if (!agent) throw new Error(`AOS_AGENT_NOT_FOUND ${id}`);
      if (!commandExists(agent.command)) throw new Error(`AOS_AGENT_COMMAND_UNAVAILABLE ${id} ${agent.command}`);
    }
  }

  const created = createRun(cwd, {
    mode: "CONTROLLED",
    suite: "verified-core-v0",
    suite_digest: suiteDigest(),
    routes,
    opportunity_profile: profile,
    collaboration_surfaces: Object.values(config.collaboration_surfaces ?? {}),
    operator_plan_digest: operatorGrade.digest,
    operator_plan: operatorGrade.projection
  });
  const { runId, paths } = created;
  appendEvent(cwd, runId, "aos", { event_type: "assessment.started", payload: { mode: "CONTROLLED", suite: "verified-core-v0" } });
  const metricInput = {};
  const familyResults = {};
  const used = new Set();
  let invocationCount = 0;
  let safety = "S0";

  try {
    for (const family of FAMILIES) {
      const workspace = join(paths.workspaces, family);
      const prepared = prepareScenario(family, workspace);
      const familyPlan = plan.families[family];
      for (const id of routeAliases(familyPlan.route)) used.add(id);
      const execution = await executeRoute(cwd, runId, family, familyPlan, config, workspace, timeoutMs);
      const runs = execution.invocations;
      if (runs.some((entry) => entry.interrupted)) throw new Error("AOS_CANCELLED");
      invocationCount += runs.length;
      const graded = await gradeScenario(family, workspace, { baseline: prepared.baseline, invocationCount: runs.length });
      if (family === "FAM-3" && !execution.handoff_complete) graded.metrics.M11 = 0;
      if (runs.some((entry) => !entry.ok)) {
        if (family === "FAM-4") graded.metrics.M14 = 0;
        if (family === "FAM-5") graded.metrics.M15 = 0;
        if (family === "FAM-6") graded.metrics.M18 = 0;
      }
      Object.assign(metricInput, graded.metrics);
      if (graded.safety === "S2") safety = "S2";
      familyResults[family] = {
        route: familyPlan.route,
        handoff_complete: execution.handoff_complete,
        invocations: runs.map((entry) => ({
          agent: entry.agent,
          ok: entry.ok,
          exit_code: entry.exit_code,
          timed_out: entry.timed_out,
          leaked_descendants: entry.leaked_descendants,
          duration_ms: entry.duration_ms
        })),
        grader: graded.details
      };
      appendEvent(cwd, runId, "grader", {
        event_type: "verification.completed",
        family,
        evidence_digest: sha256Text(JSON.stringify(graded.details)),
        payload: {
          family,
          verdict: Object.values(graded.metrics).every((value) => value === 1) ? "PASS" : "FAIL",
          evidence_digest: sha256Text(JSON.stringify(graded.details))
        }
      });
    }

    // The plan grade is no longer a scoring input. It set seventeen of twenty metrics from static
    // shape checks on JSON the operator wrote about themselves - a plan of literal junk scored
    // 17/17 - and Math.min let that override what the agents actually did. A metric is observed
    // from the run or it is NOT_OBSERVED.
    const scored = scoreMetrics(metricInput, safety);
    const result = {
      ...scored,
      run_id: runId,
      suite: "verified-core-v0",
      suite_digest: suiteDigest(),
      opportunity_profile: profile,
      operator_plan_digest: operatorGrade.digest,
      operator_plan: operatorGrade.projection,
      agent_portfolio: { configured: profile.length, used: [...used].sort(), invocations: invocationCount },
      collaboration_surfaces: Object.values(config.collaboration_surfaces ?? {}),
      family_results: familyResults
    };
    appendEvent(cwd, runId, "aos", { event_type: "assessment.ended", payload: { status: result.status } });
    writeResult(cwd, runId, result, renderMarkdown(result), renderHtml(result));
    commitTerminal(cwd, runId, {
      run_id: runId,
      status: result.status,
      result_digest: sha256Text(canonicalJson(result)),
      committed_at: new Date().toISOString()
    });
    if (getOption(options, "json", false) === true) emit(io, result, true);
    else {
      const observed = Object.entries(result.metrics).filter(([, row]) => row.state === "SCORED");
      const missed = observed.filter(([, row]) => row.value !== 1).map(([id]) => id);
      emit(io, `${observed.length} of 20 metrics observed`);
      emit(io, missed.length ? `below full marks: ${missed.join(", ")}` : "no metric below full marks");
      if (result.safety.blocks_score) emit(io, `safety: ${result.safety.state}`);
      emit(io, `Report: ${paths.reportHtml}`);
    }
    return result.issued ? 0 : result.status === "UNSAFE" ? 4 : 3;
  } catch (error) {
    const cancelled = error instanceof Error && error.message === "AOS_CANCELLED";
    try {
      commitTerminal(cwd, runId, {
        run_id: runId,
        status: cancelled ? "CANCELLED" : "INTERNAL_ERROR",
        result_digest: null,
        committed_at: new Date().toISOString()
      });
    } catch {}
    if (cancelled) {
      io.stderr.write("AOS_CANCELLED\n");
      return 130;
    }
    throw error;
  }
}

async function commandAgent(cwd, args, io) {
  const [action, id] = args._;
  const json = getOption(args, "json", false) === true;
  if (action === "add") {
    requireId(id, "agent id");
    const command = getOption(args, "command");
    if (typeof command !== "string") return fail(io, "AOS_COMMAND_REQUIRED", 2);
    const commandArgs = getOptions(args, "arg").map(String);
    rejectSecretLike([command, ...commandArgs]);
    const agent = addAgent(cwd, {
      id,
      command,
      args: commandArgs,
      display_name: getOption(args, "display", id),
      runtime_name: getOption(args, "runtime", id),
      vendor: getOption(args, "vendor", null)
    });
    emit(io, json ? agent : `Added ${id}`, json);
    return 0;
  }
  if (action === "list") {
    const agents = Object.values(readConfig(cwd).agents);
    emit(io, json ? agents : agents.map((agent) => `${agent.id}\t${agent.command} ${agent.args.join(" ")}`).join("\n"), json);
    return 0;
  }
  if (action === "remove") {
    const removed = removeAgent(cwd, requireId(id, "agent id"));
    emit(io, json ? { removed } : removed ? `Removed ${id}` : `Not found: ${id}`, json);
    return removed ? 0 : 1;
  }
  if (action === "doctor") {
    const config = readConfig(cwd);
    const targets = id ? [config.agents[id]].filter(Boolean) : Object.values(config.agents);
    const rows = targets.map((agent) => ({ id: agent.id, command: agent.command, available: commandExists(agent.command), config_digest: agent.config_digest }));
    emit(io, json ? rows : rows.map((row) => `${row.available ? "PASS" : "FAIL"}\t${row.id}\t${row.command}`).join("\n"), json);
    return rows.every((row) => row.available) ? 0 : 3;
  }
  if (action === "run") {
    const config = readConfig(cwd);
    const agent = config.agents[id];
    if (!agent) return fail(io, `AOS_AGENT_NOT_FOUND ${id}`, 2);
    const workspace = resolve(cwd, String(getOption(args, "workspace", ".")));
    const task = String(getOption(args, "task", ""));
    if (!task) return fail(io, "AOS_TASK_REQUIRED", 2);
    const result = await runProcess(agent, {
      workspace,
      family: "ADHOC",
      stage: "adhoc",
      prompt: task,
      promptFile: join(workspace, ".aos-task.md"),
      session: makeId("adhoc"),
      timeoutMs: Number(getOption(args, "timeout-ms", 300000))
    });
    emit(io, json ? result : result.ok ? "Agent completed" : `Agent failed: ${result.exit_code ?? result.signal}`, json);
    return result.ok ? 0 : 4;
  }
  return fail(io, usage, 2);
}

function commandSurface(cwd, args, io) {
  const [action, id] = args._;
  const json = getOption(args, "json", false) === true;
  if (action === "add") {
    requireId(id, "surface id");
    const surface = addSurface(cwd, {
      id,
      display_name: getOption(args, "display", id),
      kind: getOption(args, "kind", "other"),
      transport: getOption(args, "transport", "ndjson")
    });
    emit(io, json ? surface : `Added surface ${id}`, json);
    return 0;
  }
  if (action === "list") {
    const surfaces = Object.values(readConfig(cwd).collaboration_surfaces ?? {});
    emit(io, json ? surfaces : surfaces.map((surface) => `${surface.id}\t${surface.kind}\t${surface.transport}`).join("\n"), json);
    return 0;
  }
  if (action === "remove") {
    const removed = removeSurface(cwd, requireId(id, "surface id"));
    emit(io, json ? { removed } : removed ? `Removed surface ${id}` : `Not found: ${id}`, json);
    return removed ? 0 : 1;
  }
  return fail(io, usage, 2);
}

async function doctor(cwd, options, io) {
  const checks = [];
  try { assertSupportedPlatform(); checks.push({ check: "platform", ok: true, detail: `${process.platform}/${process.arch}` }); }
  catch (error) { checks.push({ check: "platform", ok: false, detail: error.message }); }
  const config = readConfig(cwd);
  for (const agent of Object.values(config.agents)) checks.push({ check: `agent:${agent.id}`, ok: commandExists(agent.command), detail: agent.command });
  checks.push({ check: "suite", ok: FAMILIES.length === 6, detail: suiteDigest() });
  const ok = checks.every((row) => row.ok);
  const json = getOption(options, "json", false) === true;
  emit(io, json ? { ok, checks } : checks.map((row) => `${row.ok ? "PASS" : "FAIL"}\t${row.check}\t${row.detail}`).join("\n"), json);
  return ok ? 0 : 3;
}

async function observe(cwd, options, io) {
  const id = getOption(options, "agent");
  const task = getOption(options, "task");
  if (typeof id !== "string" || typeof task !== "string") return fail(io, "AOS_OBSERVE_REQUIRES_AGENT_AND_TASK", 2);
  const config = readConfig(cwd);
  const agent = config.agents[id];
  if (!agent) return fail(io, `AOS_AGENT_NOT_FOUND ${id}`, 2);
  const workspace = resolve(cwd, String(getOption(options, "workspace", ".")));
  const created = createRun(cwd, { mode: "PROJECT_OBSERVATION", agent_profile_id: id, task_digest: sha256Text(task) });
  const result = await invokeAgent(cwd, created.runId, "OBSERVE", agent, workspace, "observe", task, Number(getOption(options, "timeout-ms", 300000)), task);
  const diagnostic = {
    schema_id: "aos-diagnostic",
    run_id: created.runId,
    status: "DIAGNOSTIC_ONLY",
    agent_profile_id: id,
    process: result,
    limitations: ["Project observations do not issue AOS-Coding P0."]
  };
  writeResult(cwd, created.runId, diagnostic, `# AOS diagnostic\n\n- Status: DIAGNOSTIC ONLY\n- Agent: ${id}\n- Exit: ${result.exit_code}\n`, `<h1>AOS diagnostic</h1><p>DIAGNOSTIC ONLY</p>`);
  commitTerminal(cwd, created.runId, {
    run_id: created.runId,
    status: "DIAGNOSTIC_ONLY",
    result_digest: sha256Text(canonicalJson(diagnostic)),
    committed_at: new Date().toISOString()
  });
  const json = getOption(options, "json", false) === true;
  emit(io, json ? diagnostic : `Diagnostic run ${created.runId}`, json);
  return result.ok ? 0 : 4;
}

function report(cwd, options, io) {
  const runId = getOption(options, "run");
  if (typeof runId !== "string") return fail(io, "AOS_RUN_REQUIRED", 2);
  const run = readRun(cwd, runId);
  if (!run.result) return fail(io, `AOS_RESULT_NOT_FOUND ${runId}`, 3);
  const format = getOption(options, "format", "markdown");
  if (format === "json") emit(io, run.result, true);
  else if (format === "html") emit(io, readFileSync(run.paths.reportHtml, "utf8"));
  else emit(io, readFileSync(run.paths.reportMd, "utf8"));
  return 0;
}

function session(cwd, args, io) {
  const [action, id] = args._;
  const json = getOption(args, "json", false) === true;
  if (action === "list") {
    const runs = listRuns(cwd);
    emit(io, json ? runs : runs.join("\n"), json);
    return 0;
  }
  if (!id) return fail(io, "AOS_RUN_REQUIRED", 2);
  const run = readRun(cwd, id);
  if (action === "status") {
    const value = { run_id: id, mode: run.manifest.mode, terminal: run.terminal, result_status: run.result?.status ?? null, event_count: run.events.length };
    emit(io, json ? value : JSON.stringify(value, null, 2), json);
    return 0;
  }
  if (action === "graph") {
    const edges = run.events.filter((event) => ["handoff.created", "handoff.consumed"].includes(event.event_type)).map((event) => ({
      type: event.event_type,
      from: event.payload?.from ?? null,
      to: event.payload?.to ?? null,
      family: event.family,
      artifact_digests: event.payload?.artifact_digests ?? []
    }));
    emit(io, json ? edges : edges.map((edge) => `${edge.type}\t${edge.from ?? "?"} -> ${edge.to ?? "?"}\t${edge.family ?? ""}\t${edge.artifact_digests.length} artifacts`).join("\n"), json);
    return 0;
  }
  if (action === "recover") {
    const recovered = recoverRun(cwd, id);
    emit(io, json ? recovered : `${recovered.action} ${id}`, json);
    return recovered.action === "INVALID" ? 4 : 0;
  }
  if (action === "cancel") {
    appendEvent(cwd, id, "operator", { event_type: "session.cancelled", payload: { reason: "operator" } });
    const terminal = commitTerminal(cwd, id, { run_id: id, status: "CANCELLED", result_digest: null, committed_at: new Date().toISOString() });
    emit(io, json ? terminal : `Cancelled ${id}`, json);
    return 0;
  }
  return fail(io, usage, 2);
}

function handoff(cwd, args, io) {
  const [action] = args._;
  const runId = getOption(args, "run");
  const from = getOption(args, "from");
  const to = getOption(args, "to");
  const family = getOption(args, "family");
  if (![runId, from, to, family].every((value) => typeof value === "string")) return fail(io, "AOS_HANDOFF_FIELDS_REQUIRED", 2);
  const type = action === "create" ? "handoff.created" : action === "consume" ? "handoff.consumed" : null;
  if (!type) return fail(io, usage, 2);
  const artifacts = getOptions(args, "artifact").map(String);
  if (artifacts.some((value) => !/^[a-f0-9]{64}$/.test(value))) return fail(io, "AOS_INVALID_ARTIFACT_DIGEST", 2);
  const event = appendEvent(cwd, runId, action === "create" ? "operator" : `agent-${to}`, {
    event_type: type,
    family,
    agent_profile_id: action === "consume" ? to : null,
    payload: { from, to, family, artifact_digests: artifacts }
  });
  const json = getOption(args, "json", false) === true;
  emit(io, json ? event : `${type} ${from} -> ${to}`, json);
  return 0;
}

async function readStdin(stream) {
  if (!stream) return "";
  let text = "";
  for await (const chunk of stream) text += chunk.toString("utf8");
  return text;
}

async function ingestEvents(cwd, options, io, mode) {
  let runId = getOption(options, "run");
  const producer = getOption(options, "producer");
  if (typeof producer !== "string") return fail(io, "AOS_PRODUCER_REQUIRED", 2);
  requireId(producer, "producer id");
  if (typeof runId !== "string") runId = createRun(cwd, { mode: "IMPORTED", source: producer }).runId;
  else if (!existsSync(runPaths(cwd, runId).manifest)) createRun(cwd, { run_id: runId, mode: "IMPORTED", source: producer });

  const file = getOption(options, "file");
  const source = typeof file === "string" ? readFileSync(resolve(cwd, file), "utf8") : await readStdin(io.stdin);
  if (source.trim() === "") return fail(io, "AOS_EVENT_SOURCE_EMPTY", 2);
  let count = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (typeof parsed.event_type !== "string") throw new Error("AOS_INVALID_IMPORTED_EVENT");
    appendEvent(cwd, runId, producer, parsed);
    count += 1;
  }
  appendEvent(cwd, runId, "aos", { event_type: mode === "bridge" ? "bridge.received" : "import.received", payload: { source: producer, count } });
  const result = { run_id: runId, producer, count, status: "DIAGNOSTIC_ONLY", mode: mode.toUpperCase() };
  const json = getOption(options, "json", false) === true;
  emit(io, json ? result : `${mode === "bridge" ? "Bridged" : "Imported"} ${count} events as diagnostic evidence`, json);
  return 0;
}

function verify(_cwd, options, io) {
  assertSupportedPlatform();
  const perfect = scoreMetrics(perfectMetricInput(), "S0");
  const unsafe = scoreMetrics(perfectMetricInput(), "S2");
  const template = operatorPlanTemplate(["agent"]);
  const checks = [
    { check: "version", ok: typeof VERSION === "string" && /^\d+\.\d+\.\d+$/.test(VERSION) },
    { check: "six-family-suite", ok: FAMILIES.length === 6 },
    { check: "perfect-score", ok: perfect.issued && perfect.score.display === 100 },
    { check: "safety-hard-gate", ok: !unsafe.issued && unsafe.status === "UNSAFE" },
    { check: "agent-count-not-score-input", ok: !JSON.stringify(perfect).includes("agent_count") },
    { check: "deterministic-score", ok: canonicalJson(perfect) === canonicalJson(scoreMetrics(perfectMetricInput(), "S0")) },
    { check: "blank-plan-refused", ok: validateOperatorPlan(template, ["agent"]).length > 0 }
  ];
  const result = { ok: checks.every((row) => row.ok), version: VERSION, suite_digest: suiteDigest(), checks };
  const json = getOption(options, "json", false) === true;
  emit(io, json ? result : checks.map((row) => `${row.ok ? "PASS" : "FAIL"}\t${row.check}`).join("\n"), json);
  return result.ok ? 0 : 5;
}

export async function runCli(argv, io) {
  const runtimeIo = { ...io, stdin: io.stdin ?? process.stdin };
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") { emit(runtimeIo, usage); return 0; }
  if (command === "--version" || command === "version") { emit(runtimeIo, VERSION); return 0; }
  const options = parseArgs(rest);
  try {
    if (command === "init") {
      initProject(runtimeIo.cwd);
      const json = getOption(options, "json", false) === true;
      emit(runtimeIo, json ? { ok: true, root: join(runtimeIo.cwd, ".aos") } : `Initialized ${join(runtimeIo.cwd, ".aos")}`, json);
      return 0;
    }
    if (command === "doctor") return doctor(runtimeIo.cwd, options, runtimeIo);
    if (command === "agent") return commandAgent(runtimeIo.cwd, options, runtimeIo);
    if (command === "surface") return commandSurface(runtimeIo.cwd, options, runtimeIo);
    if (command === "assess") return assess(runtimeIo.cwd, options, runtimeIo);
    if (command === "observe") return observe(runtimeIo.cwd, options, runtimeIo);
    if (command === "import") return ingestEvents(runtimeIo.cwd, options, runtimeIo, "import");
    if (command === "bridge") return ingestEvents(runtimeIo.cwd, options, runtimeIo, "bridge");
    if (command === "report") return report(runtimeIo.cwd, options, runtimeIo);
    if (command === "session") return session(runtimeIo.cwd, options, runtimeIo);
    if (command === "handoff") return handoff(runtimeIo.cwd, options, runtimeIo);
    if (command === "review") return review(options, runtimeIo);
    if (command === "verify") return verify(runtimeIo.cwd, options, runtimeIo);
    return fail(runtimeIo, usage, 2);
  } catch (error) {
    return fail(runtimeIo, error instanceof Error ? error.message : String(error), 70);
  }
}
