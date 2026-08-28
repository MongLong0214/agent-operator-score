import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { randomBytes } from "node:crypto";
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
  readJsonIfExists,
  rejectSecretLike,
  requireId,
  runProcess,
  validId,
  sha256Text,
  writeJson
} from "./core.mjs";
import { addAgent, addSurface, appendEvent, commitTerminal, createRun, initHome, listRuns, readConfig, readEvents, readRun, recoverRun, regenerateReports, removeAgent, removeSurface, resolveHome, runPaths, withRunLock, writeResult } from "./store.mjs";
import { observeRun } from "./observe.mjs";
import { DIMENSIONS, METRICS, METRIC_IDS, observationOf } from "./metrics.mjs";
import { SCORER_VERSION, scoreRun } from "./scorer-v1.mjs";
import { checkpointEvidence, interventionSummary } from "./checkpoint.mjs";
import { DEFAULT_RUNS, aggregateCycle, createCycle, mayRerun, recordRun } from "./cycle.mjs";
import { MAX_CHECKPOINTS_PER_STAGE, resolveCheckpoint } from "./checkpoint-runtime.mjs";
import { startDashboard } from "./dashboard.mjs";
import { FAMILIES, SEEDED_FAMILIES, SEED_INPUTS, SUITE_MAJOR, cloneScenario, gradeScenario, prepareScenario, promptFor, scenarioCheckpoint, suiteDigest, suiteManifest } from "./suite.mjs";
import { normalizeSeed } from "./suite-seed.mjs";
import { MARKER_FILE, branchMarkerFor, handoffIntegrity, handoffOutcome, joinCoverage, plantBranchMarker } from "./orchestration.mjs";
import { renderHtml, renderMarkdown } from "./report.mjs";
import { RUNTIMES, findSessions, loadSession } from "./session.mjs";
import { aggregateFindings, reviewSession } from "./review.mjs";
import { gradeOperatorPlan, operatorPlanTemplate, routeAliases, validateOperatorPlan } from "./operator-plan.mjs";
import { ADAPTERS, buildProfile, profileDigestOf } from "./profile.mjs";
import { isSensitiveName } from "./isolation.mjs";
import { acceptanceOf, findingIdOf, judge, loadLedger, recordSession, saveLedger, sessionDigestOf } from "./holdout.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const usage = `Agent Operator Score ${VERSION}

Commands:
  aos init
  aos review [--session <path>] [--since <n>] [--list] [--json]
  aos doctor [--json]
  aos agent add <id> --command <binary> [--arg <value> ...] [--allow-env <NAME> ...] [--adapter <id>]
  aos agent list | remove <id> | doctor [id] | run <id> --task <text> [--workspace <path>]
  aos surface add <id> [--kind <kind>] [--transport ndjson]
  aos surface list | remove <id>
  aos assess --template <operator-plan.json> [--force]
  aos assess --plan <operator-plan.json> [--checkpoints] [--timeout-ms 300000] [--json]
  aos observe --agent <id> --task <text> [--workspace <path>]
  aos import [--run <id>] --producer <id> --file <events.ndjson>
  aos bridge [--run <id>] --producer <id> [--file <events.ndjson>]
  aos report --run <id> [--format markdown|html|json]
  aos session list | status <id> | graph <id> | recover <id> | cancel <id>
  aos handoff create --run <id> --from <id> --to <id> --family <FAM-n> [--artifact <sha256> ...]
  aos handoff consume --run <id> --from <id> --to <id> --family <FAM-n> [--artifact <sha256> ...]
  aos dashboard [--port <n>]
  aos holdout --session <path> --use holdout|tuning [--evidence COMPLETE|INCOMPLETE]
  aos holdout --session <path> --finding <id> --verdict true-positive|false-positive|unclear [--reason <text>]
  aos holdout [--json]
  aos cycle start [--runs 3] [--seed <hex> ...] [--force]
  aos cycle run --plan <operator-plan.json> [--checkpoints]
  aos cycle [--json]
  aos verify [--run <id>] [--json]
`;

function emit(io, value, json = false) {
  io.stdout.write(json ? canonicalJson(value) : `${value}\n`);
}
function fail(io, message, code = 2) { io.stderr.write(`${message}\n`); return code; }
// Which artifact each family is expected to leave behind, so the observation layer reads the run
// rather than a summary of it.
const ARTIFACT_OF = {
  "FAM-1": [["contract", "contract.json"]],
  "FAM-2": [["answer", "answer.json"]],
  "FAM-3": [["plan", "plan.json"]],
  "FAM-4": [["resume", "resume.json"]],
  "FAM-5": [["completion", "completion.json"]],
  "FAM-6": [["response", "response.json"]]
};

function outputNames(root) {
  return readdirSync(root).filter((name) => !SEED_INPUTS.includes(name));
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

/**
 * An agent that never started, as opposed to one that did badly.
 *
 * A wrong flag is the ordinary way to misconfigure an agent, and the CLI it wraps rejects it before
 * doing any work: no output, a non-zero exit, and it is over in a fifth of a second. Measured
 * against a real misconfiguration -- `codex exec --full-auto`, which this build of Codex does not
 * accept -- that is exit 2, zero bytes of stdout, 0.2s.
 *
 * Scored as an ordinary failure it produces a number, and the number describes the operator's typo
 * rather than their agent. That is the one outcome this product must never produce, so a run that
 * begins this way stops instead.
 *
 * The test is deliberately narrow. An agent that read its task and decided against it takes longer
 * than this and says so on stdout, which is what every real one does.
 */
const NEVER_STARTED_MS = 2000;
/**
 * What an invocation failed as, for telling one bad task apart from one broken setup.
 *
 * Different families ask for different things. An agent that answers two of them with the same
 * exit code and byte-identical output did not read either -- it failed before the task reached it.
 */
export const failureSignature = (result) =>
  `${result.exit_code}:${result.stdout_digest}:${result.stderr_digest}`;

export const neverStarted = (result) =>
  result.ok === false &&
  result.timed_out !== true &&
  (result.stdout_bytes ?? 0) === 0 &&
  Number.isFinite(result.duration_ms) &&
  result.duration_ms < NEVER_STARTED_MS;

async function invokeAgent(home, runId, family, agent, workspace, stage, prompt, timeoutMs, operatorInstruction) {
  const producer = `agent-${agent.id}`;
  appendEvent(home, runId, "operator", {
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
  appendEvent(home, runId, producer, {
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
  appendEvent(home, runId, producer, {
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
      stderr_digest: result.stderr_digest,
      // Kept because a digest cannot tell an operator why a stage produced nothing. Redacted at the
      // source, and this file never leaves the operator's own home.
      stderr_excerpt: result.stderr_excerpt
    }
  });
  for (const semantic of result.semantic_events) {
    if (typeof semantic.event_type !== "string") continue;
    appendEvent(home, runId, producer, { ...semantic, agent_profile_id: agent.id, family });
  }
  return result;
}

/**
 * Raises one checkpoint and records what the answer did.
 *
 * The effect is written before the decision, and the decision closes the window an observer reads.
 * Leaving the new instruction to the retry would put it outside any moment it could be attributed
 * to -- every stage sends an instruction, so a window that stayed open would read the next family's
 * first one as this answer.
 */
async function askAtCheckpoint(home, runId, family, stage, evidence, checkpoint, attempt) {
  appendEvent(home, runId, "operator", { event_type: "checkpoint.raised", family, payload: evidence });
  const decision = await checkpoint.ask(evidence, { attempt });
  if (decision.choice === "instruct") {
    appendEvent(home, runId, "operator", {
      event_type: "user.instruction",
      family,
      payload: { stage, instruction_digest: sha256Text(decision.instruction), instruction_length: decision.instruction.length }
    });
  }
  if (decision.choice === "stop") {
    appendEvent(home, runId, "operator", { event_type: "session.cancelled", family, payload: { stage, reason: "operator stopped at a checkpoint" } });
  }
  appendEvent(home, runId, "operator", {
    event_type: "operator.decision",
    family,
    payload: { stage, choice: decision.choice, route_changed: decision.choice === "reroute", evidence_digest: evidence.evidence_digest }
  });
  return decision;
}

async function executeRoute(home, runId, family, familyPlan, config, workspace, timeoutMs, checkpoint = null) {
  const expression = familyPlan.route;
  const instructionFor = (id) => familyPlan.agent_instructions?.[id] ?? familyPlan.instruction;
  const stages = expression.split(">").map((stage) => stage.split("|").map((id) => id.trim()).filter(Boolean));
  if (stages.some((stage) => stage.length === 0)) throw new Error(`AOS_INVALID_ROUTE ${expression}`);
  if (stages.at(-1).length > 1) throw new Error(`AOS_PARALLEL_ROUTE_REQUIRES_JOIN ${expression}`);

  const invocations = [];
  // Families where AOS stopped and asked. A failure there already has an explanation on record.
  const askedIn = new Set();
  let previous = [];
  const previousArtifacts = new Map();
  const pendingHandoffs = [];
  // What each handoff turned out to be, rather than a flag set before anyone could know.
  const handoffOutcomes = [];
  const branchMarkers = {};
  let joinResult = null;

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
        // Each branch gets something no other branch has. A join that read one branch and invented
        // the rest can write a plausible summary; it cannot write a token it never opened.
        branchMarkers[id] = plantBranchMarker(branch, branchMarkerFor(runId, family, id));
        const instruction = instructionFor(id);
        const prompt = promptFor(family, branch, `parallel-${stageIndex + 1}`, [], instruction);
        const result = await invokeAgent(home, runId, family, agent, branch, `parallel-${stageIndex + 1}`, prompt, timeoutMs, instruction);
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
        appendEvent(home, runId, "operator", {
          event_type: "handoff.created",
          family,
          payload: { from, to: id, family, artifact_digests: artifactDigests }
        });
        pendingHandoffs.push({ from, to: id, artifactDigests });
      }
    }
    const stage_ = `stage-${stageIndex + 1}`;
    let instruction = instructionFor(id);
    let runner = agent;
    let runnerId = id;

    // The blocker the scenario itself puts in front of the operator, before any agent has run. A
    // checkpoint that only fires when a stage fails is one a competent agent never reaches, and a
    // run with no checkpoint has nothing to observe on the dimension that asks what the operator
    // did. This is the scenario being shown to the person whose decision it is.
    const declared = stageIndex === 0 ? scenarioCheckpoint(family, workspace) : null;
    if (checkpoint && declared) {
      askedIn.add(family);
      const decision = await askAtCheckpoint(
        home, runId, family, stage_,
        checkpointEvidence({ ...declared, family }),
        checkpoint, 1
      );
      if (decision.choice === "instruct") instruction = decision.instruction;
      if (decision.choice === "reroute" && config.agents[decision.route]) {
        runner = config.agents[decision.route];
        runnerId = decision.route;
      }
      // Stopping stops the run. Carrying on to the next family after the operator said to stop
      // would grade their decision as ineffective for a reason that is AOS's, not theirs -- an
      // intervention is judged by whether the work that followed was the same thing again, and
      // there must be no work that followed.
      if (decision.choice === "stop") throw new Error("AOS_CANCELLED");
    }

    let result = await invokeAgent(home, runId, family, runner, workspace, stage_, promptFor(family, workspace, stage_, previous, instruction), timeoutMs, instruction);
    invocations.push({ agent: runnerId, ...result });
    if (neverStarted(result)) {
      throw new Error(
        `AOS_AGENT_DID_NOT_RUN ${runnerId} exited ${result.exit_code} in ${result.duration_ms}ms with no output.\n` +
        `  ${runner.command} ${runner.args.join(" ")}\n` +
        `${(result.stderr_excerpt ?? "").trim().split("\n").map((line) => `  ${line}`).join("\n")}\n` +
        "  Nothing was scored: a run that begins this way measures the configuration, not the agent."
      );
    }

    // A failed stage is the one moment in a run where what the operator does is observable. AOS
    // shows what it saw and asks; the choice is recorded, and so is what the choice changed, which
    // is the only part M11-M13 read. Without --checkpoints nothing stops and the run is unattended,
    // which this product knows how to report.
    for (let attempt = 1; checkpoint && !result.ok && attempt <= MAX_CHECKPOINTS_PER_STAGE; attempt += 1) {
      askedIn.add(family);
      const decision = await askAtCheckpoint(
        home, runId, family, stage_,
        checkpointEvidence({
          kind: "repeated-failure",
          family,
          detail: `${runnerId} failed ${stage_} (exit ${result.exit_code}${result.timed_out ? ", timed out" : ""})`,
          output: result.stderr_excerpt,
          calls: [{ signature: `agent.ended:${runnerId}:${family}:${stage_}`, outcome: "failed" }]
        }),
        checkpoint, attempt
      );
      if (decision.choice === "stop") throw new Error("AOS_CANCELLED");
      if (decision.unanswered) break;
      if (decision.choice === "reroute") {
        const next = config.agents[decision.route];
        if (!next) break;
        runner = next;
        runnerId = decision.route;
      }
      if (decision.choice === "instruct") instruction = decision.instruction;
      result = await invokeAgent(home, runId, family, runner, workspace, stage_, promptFor(family, workspace, stage_, previous, instruction), timeoutMs, instruction);
      invocations.push({ agent: runnerId, ...result });
    }

    // Consumption is judged after the receiver has run, from what it produced. Where the sender was
    // a set of parallel branches, each one planted a marker and the join either carries it or does
    // not; where the sender was a single stage in this same workspace, nothing distinguishes a
    // receiver that read the artifact from one that ignored it, and that is recorded as such.
    const observable = Object.keys(branchMarkers).length > 0;
    const joinText = outputNames(workspace)
      .map((name) => {
        try {
          return readFileSync(join(workspace, name), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    const coverage = observable ? joinCoverage(joinText, branchMarkers) : null;
    if (coverage !== null) joinResult = { ...coverage, branches: Object.keys(branchMarkers).sort() };
    for (const handoff of pendingHandoffs) {
      const evidenced = coverage !== null && coverage.covered.includes(handoff.from);
      const outcome = handoffOutcome({ artifactDigests: handoff.artifactDigests, observable, evidenced });
      handoffOutcomes.push(outcome);
      appendEvent(home, runId, `agent-${runnerId}`, {
        event_type: outcome === "consumed" ? "handoff.consumed" : "handoff.unconsumed",
        agent_profile_id: runnerId,
        family,
        payload: { from: handoff.from, to: runnerId, family, artifact_digests: handoff.artifactDigests, outcome }
      });
    }
    pendingHandoffs.length = 0;
    if (observable) for (const key of Object.keys(branchMarkers)) delete branchMarkers[key];

    // Whoever actually produced them. A reroute means the next stage receives this agent's work,
    // not the work of the one the plan named.
    previousArtifacts.set(runnerId, outputArtifactDigests(workspace));
    previous = [runnerId];
  }
  const integrity = handoffIntegrity(handoffOutcomes);
  return {
    invocations,
    asked: askedIn.has(family),
    handoff_complete: integrity.complete,
    handoff_integrity: integrity,
    join: joinResult
  };
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
    // A directory exists and is not a session. Reading it raised EISDIR from inside the parser,
    // which reads as AOS having broken rather than as the path being wrong.
    if (!statSync(chosen).isFile()) {
      emit(io, `${chosen} is not a session file`);
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
    // The same count the rest of the command uses. A fixed cap of fifteen meant the aggregate named
    // sessions the picker could not reach: `--since 60` reported findings in sessions that were
    // never among the fifteen rows the README points at for picking one out.
    const shown = Number(getOption(options, "limit", wanted));
    const rows = Number.isFinite(shown) && shown > 0 ? sessions.slice(0, Math.trunc(shown)) : sessions;
    for (const entry of rows) {
      emit(io, `${new Date(entry.modified).toISOString().slice(0, 16).replace("T", " ")}\t${entry.runtime}\t${entry.path}`);
    }
    if (rows.length < sessions.length) emit(io, `… ${sessions.length - rows.length} more; --limit ${sessions.length} lists them`);
    if (sessions.aosWorkspacesSkipped > 0) {
      emit(io, `${sessions.aosWorkspacesSkipped} transcript(s) from this tool's own assessment workspaces were not listed`);
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
        runtimes_read: RUNTIMES,
        aos_workspaces_skipped: sessions.aosWorkspacesSkipped ?? 0,
        reviewed_sessions: reviewed.length,
        incomplete_sessions: incomplete,
        observations: observed,
        rules: ranked
      }).trimEnd());
      return ranked.length ? 1 : 0;
    }
    const shortfall = wanted > reviewed.length ? ` (${wanted} requested, ${reviewed.length} found)` : "";
    emit(io, `${reviewed.length} session(s)${shortfall}${incomplete > 0 ? `, ${incomplete} only partly readable` : ""}`);
    // What was searched. A silent omission reads as "this is everything you have run", and it was
    // not: an operator running a runtime with no adapter got a review of part of their work with
    // nothing saying a part was missing.
    emit(io, `read ${RUNTIMES.length} runtimes: ${RUNTIMES.join(", ")}`);
    if (sessions.aosWorkspacesSkipped > 0) {
      emit(io, `${sessions.aosWorkspacesSkipped} transcript(s) from this tool's own assessment workspaces were not read`);
    }
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

/**
 * The held-back sessions and the owner's verdict on each finding in them.
 *
 * Three shapes, because there are three things to do: put a session on one side of the line, judge
 * one of its findings, and read where the acceptance gates stand. The ledger lives in the operator's
 * home and holds digests, never sessions -- `aos holdout --session` reads the file to compute the
 * digest and list the findings, and nothing it read is written down.
 */
const cyclePath = (home) => join(home, "cycle.json");

/**
 * A locked assessment cycle: three seeds fixed at the start, and the median of every valid run.
 *
 * The seeds are drawn once and never again. That is the whole mechanism -- a cycle that could draw
 * a fresh seed later is one whose owner can retry until the scenario suits them, and "run twenty and
 * keep the best three" is one loop away from any design that allows it. Every run against a fixed
 * seed is counted, including the low ones; the only runs excluded are the ones that measured
 * nothing, and each exclusion is named with its reason.
 */
async function cycle(home, options, io) {
  const stored = readJsonIfExists(cyclePath(home));
  // `rest` is stripped of the command before parsing, so the subcommand is the first positional.
  const sub = options._[0];

  if (sub === "start") {
    if (stored !== null && getOption(options, "force", false) !== true) {
      return fail(io, `a cycle is already open (${stored.cycle_id}); pass --force to replace it`);
    }
    const config = readConfig(home);
    if (Object.keys(config.agents).length === 0) return fail(io, "no agents configured; run aos agent add first");
    const runs = Number(getOption(options, "runs", DEFAULT_RUNS));
    const seeds = getOptions(options, "seed");
    const environment = Object.values(config.agents).map((agent) =>
      profileDigestOf(buildProfile({ profileId: agent.id, agent, isolation: "BEST_EFFORT_CLI" }))
    );
    let created;
    try {
      created = createCycle({
        profileDigest: sha256Text(canonicalJson(environment.sort())),
        suiteMajor: SUITE_MAJOR,
        scorerMajor: Number(SCORER_VERSION.split(".")[0]),
        runs: Number.isInteger(runs) ? runs : DEFAULT_RUNS,
        seeds: seeds.length > 0 ? seeds : null
      });
    } catch (error) { return fail(io, error.message); }
    writeJson(cyclePath(home), created);
    emit(io, `${created.cycle_id} opened with ${created.seeds.length} locked seed(s): ${created.seeds.join(", ")}`);
    emit(io, "Seeds are fixed now and cannot be redrawn. Run each with: aos cycle run --plan <plan.json>");
    return 0;
  }

  if (stored === null) return fail(io, "no cycle; run aos cycle start", 1);

  if (sub === "run") {
    const pending = stored.seeds.filter((seed) => mayRerun(stored, seed));
    if (pending.length === 0) {
      emit(io, "every seed in this cycle has produced a result; nothing left to run");
      return 1;
    }
    const seed = pending[0];
    emit(io, `seed ${seed} (${stored.seeds.length - pending.length + 1} of ${stored.seeds.length})`);
    // Which run ids existed before, so the new one can be named exactly. `listRuns` sorts by name
    // and a run id is a uuid, so "the first" and "the newest" are unrelated -- taking either end of
    // that list recorded the first run's score for every seed in the cycle, and a report built from
    // it was three copies of one number wearing three seeds.
    const before = new Set(listRuns(home));
    const code = await assess(home, { ...options, seed: [seed] }, io);
    const runId = listRuns(home).find((id) => !before.has(id)) ?? null;
    if (runId === null) return fail(io, "the run produced no record; nothing to add to the cycle");
    const result = readJsonIfExists(runPaths(home, runId).result);
    const terminal = readJsonIfExists(runPaths(home, runId).terminal);
    let recorded;
    try {
      recorded = recordRun(stored, {
        seed,
        run_id: runId,
        profile_digest: result?.profile_digest ?? null,
        suite_major: SUITE_MAJOR,
        scorer_major: Number(SCORER_VERSION.split(".")[0]),
        // An instrument failure is not a low score, and a low score is not an instrument failure.
        // Only the first may be run again on the same seed.
        failure: result === null ? "AOS_INTERNAL_ERROR" : null,
        terminal_committed: terminal !== null,
        issued: result?.issued === true,
        final_score: result?.score?.final ?? null,
        dimensions: result?.dimensions ?? {}
      });
    } catch (error) { return fail(io, error.message); }
    writeJson(cyclePath(home), recorded);
    const last = recorded.runs.at(-1);
    emit(io, last.valid ? `recorded: ${last.final_score}` : `not counted: ${last.invalid_reason}`);
    return code;
  }

  const summary = aggregateCycle(stored);
  if (getOption(options, "json")) {
    emit(io, canonicalJson(summary).trimEnd());
    return summary.complete ? 0 : 1;
  }
  emit(io, `${summary.cycle_id} — ${summary.valid_runs} valid run(s) of ${stored.seeds.length}`);
  emit(io, `seeds: ${summary.seeds.join(", ")}`);
  for (const excluded of summary.excluded) emit(io, `  not counted: ${excluded.seed} — ${excluded.reason}`);
  emit(io, "");
  if (!summary.complete) {
    emit(io, `Operator Score withheld — ${summary.valid_runs} of 3 valid runs`);
    return 1;
  }
  emit(io, `Operator Score: ${summary.operator_score} / 100`);
  emit(io, `spread ${summary.spread}, deviation ${summary.mad}, stability ${summary.stability}`);
  // Never "confidence". Three runs on one machine say how much this measurement moved when it was
  // repeated, and nothing about how it would move anywhere else.
  emit(io, `local repeat evidence: ${summary.local_repeat_evidence}`);
  for (const [id, value] of Object.entries(summary.dimensions)) {
    emit(io, `  ${id} ${DIMENSIONS[id]?.title ?? ""}: ${value === null ? "n/o" : value}`);
  }
  emit(io, "PROFILE-BOUND: this number describes the declared environment and task pack.");
  return 0;
}

function holdout(home, options, io) {
  const ledgerBefore = loadLedger(home);
  const sessionPath = getOption(options, "session");

  if (typeof sessionPath === "string") {
    if (!existsSync(sessionPath)) return fail(io, `no session file at ${sessionPath}`);
    const digest = sessionDigestOf(readFileSync(sessionPath, "utf8"));
    const result = reviewSession(loadSession(sessionPath));
    const verdict = getOption(options, "verdict");

    if (typeof verdict === "string") {
      const findingId = getOption(options, "finding");
      if (typeof findingId !== "string") return fail(io, "--verdict needs --finding <id>; run without it to list them");
      const finding = result.findings.find((entry) => findingIdOf(digest, entry) === findingId);
      if (!finding) return fail(io, `no finding ${findingId} in this session; run without --verdict to list them`);
      try {
        saveLedger(home, judge(ledgerBefore, {
          session_digest: digest,
          finding_id: findingId,
          rule: finding.rule,
          severity: finding.severity,
          judgement: verdict,
          reason: String(getOption(options, "reason", ""))
        }));
      } catch (error) { return fail(io, error.message); }
      emit(io, `${findingId} ${finding.rule} judged ${verdict}`);
      return 0;
    }

    const use = getOption(options, "use");
    if (typeof use === "string") {
      // The evidence status defaults to what AOS reported. The gate only fires where the two
      // differ, so the owner sets it only when they read the transcript and found otherwise.
      const evidence = String(getOption(options, "evidence", result.status));
      try {
        saveLedger(home, recordSession(ledgerBefore, {
          digest,
          use,
          reported_status: result.status,
          actual_evidence: evidence,
          note: String(getOption(options, "note", ""))
        }));
      } catch (error) { return fail(io, error.message); }
      emit(io, `${digest.slice(0, 12)} recorded as ${use} (AOS read it as ${result.status}, evidence ${evidence})`);
    }

    const known = loadLedger(home).sessions.find((entry) => entry.digest === digest);
    emit(io, `${digest.slice(0, 12)} ${known ? known.use : "not recorded"} · ${result.findings.length} finding(s)`);
    for (const finding of result.findings) {
      const id = findingIdOf(digest, finding);
      const judged = loadLedger(home).judgements.find((entry) => entry.finding_id === id && entry.session_digest === digest);
      emit(io, `  ${id}  [${finding.severity}] ${finding.rule}  ${judged ? judged.judgement : "unjudged"}`);
      emit(io, `    ${finding.where} — ${finding.what}`);
    }
    return 0;
  }

  const acceptance = acceptanceOf(ledgerBefore);
  if (getOption(options, "json")) {
    emit(io, canonicalJson(acceptance).trimEnd());
    return acceptance.accepted ? 0 : 1;
  }
  emit(io, `${acceptance.holdout_sessions} holdout session(s), ${acceptance.tuning_sessions} used for tuning, ${acceptance.judged} finding(s) judged`);
  emit(io, "");
  for (const gate of acceptance.gates) {
    const value = gate.value === null ? "undecided" : typeof gate.value === "number" && gate.value <= 1 && !Number.isInteger(gate.value)
      ? gate.value.toFixed(3) : String(gate.value);
    emit(io, `${gate.pass ? "pass" : "FAIL"}  ${gate.gate} — ${value} (target ${gate.target})`);
    emit(io, `      ${gate.detail}`);
  }
  emit(io, "");
  emit(io, acceptance.accepted ? "accepted for local use" : "not accepted");
  // Local product acceptance, and it says so: rules written by looking at sessions are at risk of
  // having been written to fit them, and this measures only the owner's own held-back work.
  emit(io, "This is local product acceptance on the owner's own sessions, not external validation.");
  return acceptance.accepted ? 0 : 1;
}

function reportSession(result, options, io) {
  if (getOption(options, "json")) {
    emit(io, canonicalJson(result).trimEnd());
    return result.findings.length ? 1 : 0;
  }

  const minutes = result.duration_ms === null ? "?" : Math.round(result.duration_ms / 60000);
  emit(io, `${result.home ?? result.path}`);
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

async function assess(home, options, io) {
  assertSupportedPlatform();
  const config = readConfig(home);
  const templatePath = getOption(options, "template");
  if (typeof templatePath === "string") {
    const target = resolve(io.cwd, templatePath);
    if (existsSync(target) && getOption(options, "force", false) !== true) throw new Error(`AOS_TEMPLATE_EXISTS ${target}; pass --force to replace it`);
    writeJson(target, operatorPlanTemplate(Object.keys(config.agents)));
    emit(io, getOption(options, "json", false) === true ? { ok: true, template: target } : `Wrote operator plan template: ${target}`, getOption(options, "json", false) === true);
    return 0;
  }

  const planPath = getOption(options, "plan");
  if (typeof planPath !== "string") throw new Error("AOS_OPERATOR_PLAN_REQUIRED; run aos assess --template aos-plan.json");
  const plan = readJson(resolve(io.cwd, planPath));
  const planProblems = validateOperatorPlan(plan, Object.keys(config.agents));
  if (planProblems.length > 0) throw new Error(`AOS_INVALID_OPERATOR_PLAN ${planProblems.join("; ")}`);
  const operatorGrade = gradeOperatorPlan(plan);
  const routes = Object.fromEntries(FAMILIES.map((family) => [family, plan.families[family].route]));
  const timeoutMs = Number(getOption(options, "timeout-ms", 300000));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) throw new Error("AOS_INVALID_TIMEOUT");

  // The environment this number is bound to. The runtime version is probed rather than taken from
  // the config, because upgrading an agent changes what the score describes and a digest over the
  // command line alone would not notice.
  const profile = Object.values(config.agents).map((agent) => {
    const built = buildProfile({ profileId: agent.id, agent, isolation: "BEST_EFFORT_CLI" });
    return {
      id: agent.id,
      runtime_name: agent.runtime_name,
      vendor: agent.vendor,
      adapter: agent.adapter,
      config_digest: agent.config_digest,
      available: commandExists(agent.command),
      runtime_version: built.runtime_version,
      runtime_version_source: built.runtime_version_source,
      profile_digest: profileDigestOf(built)
    };
  });
  const profileDigest = sha256Text(canonicalJson(profile.map((entry) => entry.profile_digest).sort()));
  for (const expression of Object.values(routes)) {
    for (const id of routeAliases(expression)) {
      const agent = config.agents[id];
      if (!agent) throw new Error(`AOS_AGENT_NOT_FOUND ${id}`);
      if (!commandExists(agent.command)) throw new Error(`AOS_AGENT_COMMAND_UNAVAILABLE ${id} ${agent.command}`);
    }
  }

  // The seed names this run's scenario. Given explicitly it is reproducible; left out it is drawn
  // once and recorded, because a scenario nobody can name again is a result nobody can check.
  const requested = getOption(options, "seed");
  const seedValue = normalizeSeed(typeof requested === "string" ? requested : randomBytes(8).toString("hex"));
  if (seedValue === null) throw new Error(`AOS_INVALID_SEED --seed ${requested}; expected up to 16 hex digits`);
  const manifest = suiteManifest(seedValue);

  const created = createRun(home, {
    mode: "CONTROLLED",
    suite: manifest.suite_id,
    suite_manifest: manifest,
    seed: seedValue,
    seeded_families: [...SEEDED_FAMILIES],
    suite_digest: manifest.suite_digest,
    routes,
    opportunity_profile: profile,
    collaboration_surfaces: Object.values(config.collaboration_surfaces ?? {}),
    operator_plan_digest: operatorGrade.digest,
    operator_plan: operatorGrade.projection
  });
  const { runId, paths } = created;
  appendEvent(home, runId, "aos", { event_type: "assessment.started", payload: { mode: "CONTROLLED", suite: "verified-core-v0" } });
  // The artifacts each family produced, kept so the twenty observations can be assembled from what
  // the run actually wrote rather than from a grader's summary of it.
  const artifacts = {};
  const scenarioParamsByFamily = {};
  const invocationsByFamily = {};
  let orchestration = { integrity: null, join: null };
  // The operator says they are here by passing the flag. Nothing asks whether stdin is a terminal:
  // that is a property of the channel, and `expect` holds a pty while a person can hold one and walk
  // away. An answer that never comes is an unattended run, which has its own honest result.
  const nextLine = lineReader(io.stdin);
  const checkpoint = getOption(options, "checkpoints", false) === true
    ? {
        ask: (evidence, { attempt }) =>
          resolveCheckpoint({
            evidence,
            agents: Object.keys(config.agents),
            attempt,
            ask: nextLine,
            write: (text) => emit(io, text)
          })
      }
    : null;

  // Per agent, the signature of its first failure and the family it happened in. A second family
  // failing the same way is a harness problem, and continuing spends quota on families that cannot
  // start -- a real Claude Code route did exactly this four times, exiting 1 after a second with
  // `Not logged in · Please run /login`, and the report blamed the operator for producing no
  // contract.
  const firstFailure = new Map();

  let fam5Details = null;
  const familyResults = {};
  const used = new Set();
  let invocationCount = 0;
  let safety = "S0";

  try {
    for (const family of FAMILIES) {
      const workspace = join(paths.workspaces, family);
      const prepared = prepareScenario(family, workspace, seedValue);
      const familyPlan = plan.families[family];
      for (const id of routeAliases(familyPlan.route)) used.add(id);
      const execution = await executeRoute(home, runId, family, familyPlan, config, workspace, timeoutMs, checkpoint);
      const runs = execution.invocations;
      if (runs.some((entry) => entry.interrupted)) throw new Error("AOS_CANCELLED");

      // The family's last invocation, not every attempt in it. A first attempt that failed and was
      // then unblocked at a checkpoint is the checkpoint working, and counting it here would stop
      // the run at exactly the moment the operator did the thing being measured.
      // Not where AOS raised a checkpoint. If it stopped and asked and the run still failed, the
      // reason is on record as an operator decision -- or as nobody answering, which is what an
      // unattended run is. Neither is a harness that could not start.
      const ended = execution.asked ? null : runs.at(-1);
      for (const invocation of ended && ended.ok === false && !ended.timed_out ? [ended] : []) {
        const signature = failureSignature(invocation);
        const seen = firstFailure.get(`${invocation.agent}:${signature}`);
        if (seen === undefined) {
          firstFailure.set(`${invocation.agent}:${signature}`, family);
          continue;
        }
        if (seen === family) continue;
        const said = [invocation.stdout_excerpt, invocation.stderr_excerpt]
          .map((text) => (text ?? "").trim()).filter(Boolean).join("\n");
        throw new Error(
          `AOS_AGENT_FAILS_IDENTICALLY ${invocation.agent} failed ${seen} and ${family} the same way ` +
          `(exit ${invocation.exit_code}, byte-identical output).\n` +
          `${said.split("\n").map((line) => `  ${line}`).join("\n")}\n` +
          "  Two families ask for different things; an agent that answers both identically did not read either.\n" +
          "  Nothing was scored, and the remaining families were not run."
        );
      }
      invocationCount += runs.length;
      const graded = await gradeScenario(family, workspace, { baseline: prepared.baseline, params: prepared.params, invocationCount: runs.length });
      if (graded.safety === "S2") safety = "S2";

      scenarioParamsByFamily[family] = prepared.params;
      invocationsByFamily[family] = runs.length;
      for (const [name, file] of ARTIFACT_OF[family] ?? []) {
        artifacts[name] = readJsonIfExists(join(workspace, file));
      }
      if (family === "FAM-3") orchestration = { integrity: execution.handoff_integrity, join: execution.join };
      if (family === "FAM-5") fam5Details = graded.details;
      familyResults[family] = {
        route: familyPlan.route,
        handoff_complete: execution.handoff_complete,
        // Carried into the result, not summarised away: "complete" is true both when every handoff
        // was consumed and when none could be observed, and those are different runs.
        handoff_integrity: execution.handoff_integrity,
        join: execution.join,
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
      appendEvent(home, runId, "grader", {
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

    // The plan grade is not a scoring input. It set seventeen of twenty metrics from static shape
    // checks on JSON the operator wrote about themselves -- a plan of literal junk scored 17/17.
    // A metric is observed from the run or it is NOT_OBSERVED.
    //
    // Monitoring is observed from what the operator did while this was running. In an unattended
    // run there is nothing to observe, D4 stays empty, and coverage withholds the score: a run
    // nobody watched is a diagnostic result, not an operator score.
    const interventions = interventionSummary(readEvents(home, runId));
    const observations = observeRun({
      artifacts,
      params: scenarioParamsByFamily,
      interventions,
      orchestration,
      fam5: fam5Details,
      invocations: invocationsByFamily
    });
    // Recorded beside the number, because a result that cannot say what it was computed from
    // cannot be recomputed -- and `aos verify --run` would then be re-deriving its inputs from its
    // own conclusions, which checks nothing.
    const scoringContext = { safetyState: safety, isolationLevel: "BEST_EFFORT_CLI", evidenceStatus: "COMPLETE" };
    const scored = scoreRun(observations, scoringContext);
    const result = {
      schema_id: "aos-mvp-result.v1",
      ...scored,
      metrics: observations,
      interventions,
      run_id: runId,
      suite: manifest.suite_id,
      suite_manifest: manifest,
      seed: seedValue,
      // Recorded rather than implied: three families read this seed and three still carry one fixed
      // form, and a result that said "seeded" without saying which would overstate what varied.
      seeded_families: [...SEEDED_FAMILIES],
      suite_digest: manifest.suite_digest,
      opportunity_profile: profile,
      // What makes two runs comparable, and the only thing a cycle checks before counting one.
      profile_digest: profileDigest,
      scoring_context: scoringContext,
      operator_plan_digest: operatorGrade.digest,
      operator_plan: operatorGrade.projection,
      agent_portfolio: { configured: profile.length, used: [...used].sort(), invocations: invocationCount },
      collaboration_surfaces: Object.values(config.collaboration_surfaces ?? {}),
      family_results: familyResults,
      limitations: [
        "PROFILE-BOUND: this number describes the declared environment and task pack, not an ability independent of them.",
        "EXPERIMENTAL / PROVISIONAL: no calibration study, independent reproduction or qualified review exists.",
        "The suite's answers are in this repository, which makes it practice rather than an exam."
      ]
    };
    appendEvent(home, runId, "aos", { event_type: "assessment.ended", payload: { status: result.status } });
    writeResult(home, runId, result, renderMarkdown(result), renderHtml(result));
    commitTerminal(home, runId, {
      run_id: runId,
      status: result.status,
      result_digest: sha256Text(canonicalJson(result)),
      committed_at: new Date().toISOString()
    });
    if (getOption(options, "json", false) === true) emit(io, result, true);
    else {
      const observed = result.metrics.filter((row) => row.value !== null);
      const missed = observed.filter((row) => row.value !== 1).map((row) => row.metric_id);
      emit(io, `${observed.length} of ${result.coverage.total} metrics observed`);
      emit(io, missed.length ? `below full marks: ${missed.join(", ")}` : "no metric below full marks");
      emit(io, result.score ? `Score: ${result.score.final} / 100 (${result.score.band})` : `Score withheld — ${result.blockers.map((blocker) => blocker.code).join(", ")}`);
      for (const cap of result.caps) emit(io, `capped at ${cap.max}: ${cap.code}`);
      emit(io, `Report: ${paths.reportHtml}`);
    }
    return result.issued && result.status !== "UNSAFE" ? 0 : result.status === "UNSAFE" ? 4 : 3;
  } catch (error) {
    const cancelled = error instanceof Error && error.message === "AOS_CANCELLED";
    try {
      commitTerminal(home, runId, {
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

async function commandAgent(home, args, io) {
  const [action, id] = args._;
  const json = getOption(args, "json", false) === true;
  if (action === "add") {
    requireId(id, "agent id");
    const command = getOption(args, "command");
    if (typeof command !== "string") return fail(io, "AOS_COMMAND_REQUIRED", 2);
    const commandArgs = getOptions(args, "arg").map(String);
    rejectSecretLike([command, ...commandArgs]);

    // A real runtime needs a little of the operator's environment to find its own configuration --
    // CODEX_HOME, CLAUDE_CONFIG_DIR -- because isolation replaces HOME so that ~/.ssh and
    // ~/.aws/credentials are not one path expansion away.
    //
    // A credential-shaped name is refused. The allow list is checked before the credential filter,
    // so permitting one here would hand the agent the key itself, and no runtime needs that: they
    // authenticate through a config directory, which is a name this will carry.
    const allowEnv = getOptions(args, "allow-env").map(String);
    const sensitive = allowEnv.filter((name) => isSensitiveName(name));
    if (sensitive.length > 0) {
      return fail(io, `AOS_CREDENTIAL_ENV_REFUSED ${sensitive.join(", ")}; point the runtime at a config directory instead`);
    }
    const adapter = getOption(args, "adapter");
    if (typeof adapter === "string" && !ADAPTERS[adapter]) {
      return fail(io, `AOS_UNKNOWN_ADAPTER ${adapter}; one of ${Object.keys(ADAPTERS).join(", ")}`);
    }

    const agent = addAgent(home, {
      id,
      command,
      args: commandArgs,
      allowed_env_names: allowEnv,
      adapter: typeof adapter === "string" ? adapter : undefined,
      display_name: getOption(args, "display", id),
      runtime_name: getOption(args, "runtime", id),
      vendor: getOption(args, "vendor", null)
    });
    emit(io, json ? agent : `Added ${id}`, json);
    return 0;
  }
  if (action === "list") {
    const agents = Object.values(readConfig(home).agents);
    emit(io, json ? agents : agents.map((agent) => `${agent.id}\t${agent.command} ${agent.args.join(" ")}`).join("\n"), json);
    return 0;
  }
  if (action === "remove") {
    const removed = removeAgent(home, requireId(id, "agent id"));
    emit(io, json ? { removed } : removed ? `Removed ${id}` : `Not found: ${id}`, json);
    return removed ? 0 : 1;
  }
  if (action === "doctor") {
    const config = readConfig(home);
    // Naming an agent that is not configured used to filter it away and then report that every
    // agent in the resulting empty list was fine. A question about something that does not exist
    // has no good answer, and "PASS" is the worst of them.
    if (id && !config.agents[id]) return fail(io, `AOS_AGENT_NOT_FOUND ${id}`, 2);
    // Reporting on nothing is not reporting success. `every` over an empty list is true, so a home
    // with no agents answered exit 0 with no output, and the first real signal was
    // AOS_AGENT_NOT_FOUND from a run that could not start.
    if (!id && Object.keys(config.agents).length === 0) {
      emit(io, "FAIL\tno agents registered\taos agent add <id> --command <binary>");
      return 3;
    }
    const targets = id ? [config.agents[id]] : Object.values(config.agents);
    const rows = targets.map((agent) => ({ id: agent.id, command: agent.command, available: commandExists(agent.command), config_digest: agent.config_digest }));
    emit(io, json ? rows : [
      ...rows.map((row) => `${row.available ? "PASS" : "FAIL"}\t${row.id}\t${row.command}`),
      // Said, because PASS here has been read as "this agent works". It means the binary is on
      // PATH; whether it can authenticate is only answered by running it.
      "this checks the command resolves, not that it can authenticate"
    ].join("\n"), json);
    return rows.every((row) => row.available) ? 0 : 3;
  }
  if (action === "run") {
    const config = readConfig(home);
    const agent = config.agents[id];
    if (!agent) return fail(io, `AOS_AGENT_NOT_FOUND ${id}`, 2);
    const workspace = resolve(io.cwd, String(getOption(args, "workspace", ".")));
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

function commandSurface(home, args, io) {
  const [action, id] = args._;
  const json = getOption(args, "json", false) === true;
  if (action === "add") {
    requireId(id, "surface id");
    const surface = addSurface(home, {
      id,
      display_name: getOption(args, "display", id),
      kind: getOption(args, "kind", "other"),
      transport: getOption(args, "transport", "ndjson")
    });
    emit(io, json ? surface : `Added surface ${id}`, json);
    return 0;
  }
  if (action === "list") {
    const surfaces = Object.values(readConfig(home).collaboration_surfaces ?? {});
    emit(io, json ? surfaces : surfaces.map((surface) => `${surface.id}\t${surface.kind}\t${surface.transport}`).join("\n"), json);
    return 0;
  }
  if (action === "remove") {
    const removed = removeSurface(home, requireId(id, "surface id"));
    emit(io, json ? { removed } : removed ? `Removed surface ${id}` : `Not found: ${id}`, json);
    return removed ? 0 : 1;
  }
  return fail(io, usage, 2);
}

async function doctor(home, options, io) {
  const checks = [];
  try { assertSupportedPlatform(); checks.push({ check: "platform", ok: true, detail: `${process.platform}/${process.arch}` }); }
  catch (error) { checks.push({ check: "platform", ok: false, detail: error.message }); }
  const config = readConfig(home);
  for (const agent of Object.values(config.agents)) checks.push({ check: `agent:${agent.id}`, ok: commandExists(agent.command), detail: agent.command });
  checks.push({ check: "suite", ok: FAMILIES.length === 6, detail: suiteDigest() });
  const ok = checks.every((row) => row.ok);
  const json = getOption(options, "json", false) === true;
  emit(io, json ? { ok, checks } : checks.map((row) => `${row.ok ? "PASS" : "FAIL"}\t${row.check}\t${row.detail}`).join("\n"), json);
  return ok ? 0 : 3;
}

async function observe(home, options, io) {
  const id = getOption(options, "agent");
  const task = getOption(options, "task");
  if (typeof id !== "string" || typeof task !== "string") return fail(io, "AOS_OBSERVE_REQUIRES_AGENT_AND_TASK", 2);
  const config = readConfig(home);
  const agent = config.agents[id];
  if (!agent) return fail(io, `AOS_AGENT_NOT_FOUND ${id}`, 2);
  const workspace = resolve(io.cwd, String(getOption(options, "workspace", ".")));
  const created = createRun(home, { mode: "PROJECT_OBSERVATION", agent_profile_id: id, task_digest: sha256Text(task) });
  const result = await invokeAgent(home, created.runId, "OBSERVE", agent, workspace, "observe", task, Number(getOption(options, "timeout-ms", 300000)), task);
  const diagnostic = {
    schema_id: "aos-diagnostic",
    run_id: created.runId,
    status: "DIAGNOSTIC_ONLY",
    agent_profile_id: id,
    process: result,
    limitations: ["Project observations do not issue AOS-Coding P0."]
  };
  writeResult(home, created.runId, diagnostic, `# AOS diagnostic\n\n- Status: DIAGNOSTIC ONLY\n- Agent: ${id}\n- Exit: ${result.exit_code}\n`, `<h1>AOS diagnostic</h1><p>DIAGNOSTIC ONLY</p>`);
  commitTerminal(home, created.runId, {
    run_id: created.runId,
    status: "DIAGNOSTIC_ONLY",
    result_digest: sha256Text(canonicalJson(diagnostic)),
    committed_at: new Date().toISOString()
  });
  const json = getOption(options, "json", false) === true;
  emit(io, json ? diagnostic : `Diagnostic run ${created.runId}`, json);
  return result.ok ? 0 : 4;
}

function report(home, options, io) {
  const runId = getOption(options, "run");
  if (typeof runId !== "string") return fail(io, "AOS_RUN_REQUIRED", 2);
  const run = readRun(home, runId);
  if (!run.result) return fail(io, `AOS_RESULT_NOT_FOUND ${runId}`, 3);
  const format = getOption(options, "format", "markdown");
  if (format === "json") emit(io, run.result, true);
  else if (format === "html") emit(io, readFileSync(run.paths.reportHtml, "utf8"));
  else emit(io, readFileSync(run.paths.reportMd, "utf8"));
  return 0;
}

function session(home, args, io) {
  const [action, id] = args._;
  const json = getOption(args, "json", false) === true;
  if (action === "list") {
    const runs = listRuns(home);
    emit(io, json ? runs : runs.join("\n"), json);
    return 0;
  }
  if (!id) return fail(io, "AOS_RUN_REQUIRED", 2);
  const run = readRun(home, id);
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
    const recovered = recoverRun(home, id, (result) => ({ markdown: renderMarkdown(result), html: renderHtml(result) }));
    emit(io, json ? recovered : `${recovered.action} ${id}`, json);
    return recovered.action === "INVALID" ? 4 : 0;
  }
  if (action === "cancel") {
    appendEvent(home, id, "operator", { event_type: "session.cancelled", payload: { reason: "operator" } });
    const terminal = commitTerminal(home, id, { run_id: id, status: "CANCELLED", result_digest: null, committed_at: new Date().toISOString() });
    emit(io, json ? terminal : `Cancelled ${id}`, json);
    return 0;
  }
  return fail(io, usage, 2);
}

function handoff(home, args, io) {
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
  const event = appendEvent(home, runId, action === "create" ? "operator" : `agent-${to}`, {
    event_type: type,
    family,
    agent_profile_id: action === "consume" ? to : null,
    payload: { from, to, family, artifact_digests: artifacts }
  });
  const json = getOption(args, "json", false) === true;
  emit(io, json ? event : `${type} ${from} -> ${to}`, json);
  return 0;
}

/**
 * Reads one line at a time, keeping what came after it.
 *
 * A checkpoint asks several times in a run, and each answer arrives on its own line. Consuming the
 * whole stream per question would swallow every later answer, which is how a piped script would
 * appear to stop answering after the first checkpoint.
 *
 * Returns null when the stream ends: that is the operator not answering, not a failure.
 */
export function lineReader(stream) {
  if (!stream) return async () => null;
  const iterator = stream[Symbol.asyncIterator]();
  let buffer = "";
  let ended = false;
  return async () => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return line;
      }
      if (ended) {
        if (buffer.length === 0) return null;
        const rest = buffer;
        buffer = "";
        return rest;
      }
      const next = await iterator.next();
      if (next.done) { ended = true; continue; }
      buffer += next.value.toString("utf8");
    }
  };
}

async function readStdin(stream) {
  if (!stream) return "";
  let text = "";
  for await (const chunk of stream) text += chunk.toString("utf8");
  return text;
}

async function ingestEvents(home, options, io, mode) {
  let runId = getOption(options, "run");
  const producer = getOption(options, "producer");
  if (typeof producer !== "string") return fail(io, "AOS_PRODUCER_REQUIRED", 2);
  requireId(producer, "producer id");
  if (typeof runId !== "string") runId = createRun(home, { mode: "IMPORTED", source: producer }).runId;
  else if (!existsSync(runPaths(home, runId).manifest)) createRun(home, { run_id: runId, mode: "IMPORTED", source: producer });

  const file = getOption(options, "file");
  const source = typeof file === "string" ? readFileSync(resolve(io.cwd, file), "utf8") : await readStdin(io.stdin);
  if (source.trim() === "") return fail(io, "AOS_EVENT_SOURCE_EMPTY", 2);
  let count = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (typeof parsed.event_type !== "string") throw new Error("AOS_INVALID_IMPORTED_EVENT");
    appendEvent(home, runId, producer, parsed);
    count += 1;
  }
  appendEvent(home, runId, "aos", { event_type: mode === "bridge" ? "bridge.received" : "import.received", payload: { source: producer, count } });
  const result = { run_id: runId, producer, count, status: "DIAGNOSTIC_ONLY", mode: mode.toUpperCase() };
  const json = getOption(options, "json", false) === true;
  emit(io, json ? result : `${mode === "bridge" ? "Bridged" : "Imported"} ${count} events as diagnostic evidence`, json);
  return 0;
}

function verify(home, options, io) {
  assertSupportedPlatform();
  const runId = getOption(options, "run");
  if (typeof runId === "string") return verifyRun(home, runId, options, io);
  // The self-check runs the real scorer over a synthetic perfect run and a synthetic unsafe one, so
  // a change to the contract or the caps shows up here rather than in somebody's assessment.
  const everyMetric = (passing) =>
    METRIC_IDS.map((id) =>
      observationOf({
        metric_id: id,
        verifier_id: "aos-verify.v1",
        subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: passing })),
        evidence_ids: ["self-check"],
        reason: "self check"
      })
    );
  const perfect = scoreRun(everyMetric(true));
  const unsafe = scoreRun(everyMetric(true), { safetyState: "S2" });
  const template = operatorPlanTemplate(["agent"]);
  const checks = [
    { check: "version", ok: typeof VERSION === "string" && /^\d+\.\d+\.\d+$/.test(VERSION) },
    { check: "six-family-suite", ok: FAMILIES.length === 6 },
    { check: "perfect-score", ok: perfect.issued && perfect.score.final === 100 },
    // An unsafe run is still issued -- it is capped, not withheld -- and the ceiling is what the
    // gate is. Asserting "not issued" would pass on a scorer that simply refused to score.
    { check: "safety-hard-gate", ok: unsafe.status === "UNSAFE" && unsafe.score.final === 39 },
    { check: "unobserved-is-not-zero", ok: scoreRun(everyMetric(true).map((entry, index) => (index < 4 ? observationOf({ metric_id: entry.metric_id }) : entry))).score === null },
    { check: "agent-count-not-score-input", ok: !JSON.stringify(perfect).includes("agent_count") },
    { check: "deterministic-score", ok: canonicalJson(perfect) === canonicalJson(scoreRun(everyMetric(true))) },
    { check: "blank-plan-refused", ok: validateOperatorPlan(template, ["agent"]).length > 0 }
  ];
  const result = { ok: checks.every((row) => row.ok), version: VERSION, suite_digest: suiteDigest(), checks };
  const json = getOption(options, "json", false) === true;
  emit(io, json ? result : checks.map((row) => `${row.ok ? "PASS" : "FAIL"}\t${row.check}`).join("\n"), json);
  return result.ok ? 0 : 5;
}

/**
 * Recomputes a stored result from its own record.
 *
 * The observations and the context they were scored under are both in the file, so the number can
 * be derived again and compared. That is what makes a result checkable rather than merely stored:
 * a hand-edited score, or one produced by a scorer that has since changed, stops matching.
 *
 * A result whose scorer or suite differs from this build is reported as not comparable rather than
 * as wrong. It was computed correctly by something else.
 */
function verifyRun(home, runId, options, io) {
  if (!validId(runId)) return fail(io, `AOS_INVALID_RUN_ID ${runId}`);
  const result = readJsonIfExists(runPaths(home, runId).result);
  if (result === null) return fail(io, `no result for ${runId}`, 2);

  const checks = [];
  const add = (check, ok, detail = "") => checks.push({ check, ok, detail });

  add("scorer-version", result.scorer?.version === SCORER_VERSION, `${result.scorer?.version ?? "none"} vs ${SCORER_VERSION}`);
  // The manifest this build produces for the seed the result recorded. `suiteDigest()` is the
  // whole suite and is not what a result carries: a run's digest is bound to its own seed, and
  // comparing the two would fail every time regardless of whether anything had changed.
  const rebuilt = typeof result.seed === "string" ? suiteManifest(result.seed).suite_digest : null;
  add("suite-digest", rebuilt !== null && result.suite_digest === rebuilt, rebuilt === null ? "the result recorded no seed" : result.suite_digest === rebuilt ? "" : "this build's suite differs for that seed");
  add("metric-count", Array.isArray(result.metrics) && result.metrics.length === METRIC_IDS.length, `${result.metrics?.length ?? 0} of ${METRIC_IDS.length}`);

  const context = result.scoring_context ?? null;
  if (context === null) {
    add("recompute", false, "this result did not record what it was scored under, so it cannot be recomputed");
  } else if (checks.every((row) => row.ok)) {
    const again = scoreRun(result.metrics, context);
    const stored = { score: result.score, provisional_raw: result.provisional_raw, dimensions: result.dimensions, caps: result.caps, coverage: result.coverage, status: result.status };
    const fresh = { score: again.score, provisional_raw: again.provisional_raw, dimensions: again.dimensions, caps: again.caps, coverage: again.coverage, status: again.status };
    add("recompute", canonicalJson(stored) === canonicalJson(fresh), canonicalJson(stored) === canonicalJson(fresh) ? "" : "the stored number does not follow from the stored observations");
  } else {
    add("recompute", false, "not comparable: this build's scorer or suite is not the one that produced it");
  }

  const ok = checks.every((row) => row.ok);
  if (getOption(options, "json", false) === true) {
    emit(io, { ok, run_id: runId, checks }, true);
  } else {
    for (const row of checks) emit(io, `${row.ok ? "PASS" : "FAIL"}\t${row.check}${row.detail ? `\t${row.detail}` : ""}`);
  }
  return ok ? 0 : 5;
}

export async function runCli(argv, io) {
  const runtimeIo = { ...io, stdin: io.stdin ?? process.stdin };
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") { emit(runtimeIo, usage); return 0; }
  if (command === "--version" || command === "version") { emit(runtimeIo, VERSION); return 0; }
  const options = parseArgs(rest);
  // Resolved once, here. Every command below stores under this root; the five places that resolve
  // a path the operator typed use io.cwd, which is a different question from where AOS keeps data.
  const home = resolveHome({ dataDir: getOption(options, "data-dir"), env: process.env });
  // The store used to live beside the project. Moving it to the machine is right -- runs belong to
  // the machine, not to whichever directory `aos` was invoked from -- but an operator who upgrades
  // a working checkout finds their agents gone with nothing said, and the next signal they get is
  // AOS_AGENT_NOT_FOUND from a run, which points at re-registering rather than at the move.
  const orphaned = join(runtimeIo.cwd ?? ".", ".aos");
  if (orphaned !== home && existsSync(join(orphaned, "agents.json"))) {
    runtimeIo.stderr.write(
      `note: ${join(orphaned, "agents.json")} is from a version that kept the store beside the project.\n` +
      `      the store is now ${home} — copy it across, or re-add the agents.\n`
    );
  }
  try {
    if (command === "init") {
      initHome(home);
      const json = getOption(options, "json", false) === true;
      emit(runtimeIo, json ? { ok: true, root: home } : `Initialized ${home}`, json);
      return 0;
    }
    if (command === "doctor") return await doctor(home, options, runtimeIo);
    if (command === "agent") return await commandAgent(home, options, runtimeIo);
    if (command === "surface") return await commandSurface(home, options, runtimeIo);
    if (command === "assess") return await assess(home, options, runtimeIo);
    if (command === "observe") return await observe(home, options, runtimeIo);
    if (command === "import") return await ingestEvents(home, options, runtimeIo, "import");
    if (command === "bridge") return await ingestEvents(home, options, runtimeIo, "bridge");
    if (command === "report") return await report(home, options, runtimeIo);
    if (command === "session") return await session(home, options, runtimeIo);
    if (command === "handoff") return await handoff(home, options, runtimeIo);
    if (command === "dashboard") {
      // An unparsable port used to become NaN, which listen() reads as 0, so `--port lemon` quietly
      // bound somewhere else entirely. Asking for a port and being given another one without being
      // told is worse than being refused.
      const requestedPort = getOption(options, "port", 0);
      const port = Number(requestedPort);
      if (!Number.isInteger(port) || port < 0 || port > 65535) return fail(runtimeIo, `AOS_INVALID_PORT ${requestedPort}`, 2);
      const started = await startDashboard({ home, port });
      // The token is printed once, here. It is not written to disk: a file holding it would be one
      // more thing on the machine that grants access to the operator's runs.
      emit(runtimeIo, `Dashboard: ${started.url}`);
      emit(runtimeIo, "Read only, this machine only. Stop it with ctrl-c.");
      await new Promise(() => {});
      return 0;
    }
    if (command === "review") return await review(options, runtimeIo);
    if (command === "holdout") return await holdout(home, options, runtimeIo);
    if (command === "cycle") return await cycle(home, options, runtimeIo);
    if (command === "verify") return await verify(home, options, runtimeIo);
    return fail(runtimeIo, usage, 2);
    // Every handler above is awaited. Returning a promise from inside a try block does not put its
    // rejection in that block's catch, so an async command's refusal used to escape this
    // classification entirely and be reported by the caller as an internal error -- which is how
    // `aos assess` with no --plan told the operator that AOS had broken.
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // An `AOS_` error is something this product decided to refuse: a missing option, a plan that
    // does not validate, a damaged file. Those are the operator's to fix and they exit 2, the same
    // as every refusal that never had to throw. 70 is for a failure nobody anticipated, and mixing
    // the two taught a reader that "internal error" means "you forgot an argument".
    return fail(runtimeIo, message, /^AOS_[A-Z_]+/.test(message) ? 2 : 70);
  }
}
