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
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION,
  assertSupportedPlatform,
  canonicalJson,
  commandExists,
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
import { artifactByteDigest, handoffDigestsMatch, handoffDigestsSameMultiset, isByteDigest } from "./digest.mjs";
import { addAgent, addSurface, appendEvent, commitTerminal, createRun, initHome, listRuns, operatorRunKey, readConfig, readEvents, readRun, recoverRun, regenerateReports, removeAgent, removeSurface, resolveHome, runPaths, withRunLock, writeResult } from "./store.mjs";
import { observeRun } from "./observe.mjs";
import { DIMENSIONS, METRICS, METRIC_IDS, observationOf } from "./metrics.mjs";
import { MINIMUM_OBSERVED, SCORER_VERSION, scoreRun } from "./scorer-v1.mjs";
import { checkpointEvidence, interventionSummary } from "./checkpoint.mjs";
import { attestedOperatorTrace, isOperatorAuthorityType, mintOperatorEvent } from "./operator-events.mjs";
import { bindOperatorDecisions, contextDecisions, processEvidence, routeEvidence } from "./operator-plan.mjs";
import { ACTUAL_ROUTE_EVENT_SCHEMA, capabilityDigestOf, capabilityRecordsFor, delegationOracle, routingObservables } from "./routing-oracle.mjs";
import { DEFAULT_RUNS, aggregateCycle, createCycle, mayRerun, recordRun } from "./cycle.mjs";
import { MAX_CHECKPOINTS_PER_STAGE, resolveCheckpoint } from "./checkpoint-runtime.mjs";
import { startDashboard } from "./dashboard.mjs";
import { FAMILIES, SEEDED_FAMILIES, SEED_INPUTS, SUITE_MAJOR, cloneScenario, gradeScenario, prepareScenario, promptFor, scenarioCheckpoint, suiteDigest, suiteManifest } from "./suite.mjs";
import { normalizeSeed } from "./suite-seed.mjs";
import { MARKER_FILE, branchMarkerFor, handoffIntegrity, handoffOutcome, joinCoverage, plantBranchMarker } from "./orchestration.mjs";
import { primaryConstraint, renderHtml, renderMarkdown } from "./report.mjs";
import { renderCard } from "./report-card.mjs";
import { LEGACY_RESULT_SCHEMA_ID, RESULT_SCHEMA_ID, RESULT_SCHEMA_VERSION, assertUniformResultSchema, buildResult, isLegacyResult, projectResult, resultSchemaOf } from "./result-schema.mjs";
import { contractDigests, contractFileDigests, evaluate, shippedEcdContract } from "./ecd-contract.mjs";
import { languageOf, localeFromEnvironment } from "./report-i18n.mjs";
import { RUNTIMES, findSessions, loadSession } from "./session.mjs";
import { aggregateFindings, reviewSession } from "./review.mjs";
import { gradeOperatorPlan, isShippedPlan, operatorPlanTemplate, routeAliases, validateOperatorPlan } from "./operator-plan.mjs";
import { ADAPTERS, adapterFor, buildProfile, profileDigestOf } from "./profile.mjs";
import { authorizeRuntimeAuth, resolveRuntimeAuth } from "./runtime-auth.mjs";
import { describeExecutable } from "./runtime-identity.mjs";
import { buildAgentEnv, isSensitiveName, SCORING_ISOLATION } from "./isolation.mjs";
import { envPolicyFor, hardForbiddenClassOf, isTransportName } from "./env-policy.mjs";

// The lane this build actually runs under. It was a literal at each of the sites that needed it,
// which is how the grader and the scorer could have come to disagree about the same run. STRICT is
// not wired here: no backend on this stack provides both halves of it, which is why FAM-5's verdict
// records the lane rather than assuming one.
const ISOLATION_LANE = "BEST_EFFORT_CLI";
import { MVP_PRECISION, findingIdOf, judge, laneA, loadLedger, recordSession, saveLedger, sessionDigestOf } from "./holdout.mjs";
import { laneReport } from "./review-lanes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const usage = `Agent Operator Score ${VERSION}

Commands:
  aos init
  aos review [--session <path>] [--since <n>] [--list] [--json]
  aos doctor [--json]
  aos agent add <id> --command <binary> [--arg <value> ...] [--allow-env <NAME> ...]
                     [--allow-runtime-auth <NAME> ...] [--allow-transport-env <NAME> ...]
                     [--no-auto-auth] [--adapter <id>]
  aos agent list | remove <id> | doctor [id] | run <id> --task <text> [--workspace <path>]
  aos surface add <id> [--kind <kind>] [--transport ndjson]
  aos surface list | remove <id>
  aos assess --template <operator-plan.json> [--force]
  aos assess [--plan <operator-plan.json>] [--checkpoints] [--timeout-ms 300000] [--json]
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
  aos holdout --lanes [--json]
  aos cycle start [--runs 3] [--seed <hex> ...] [--force --reason <why>]
  aos cycle run [--plan <operator-plan.json>] [--checkpoints]
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

// The names as the kernel gives them, not as UTF-8 decodes them, wherever a name becomes identity.
//
// An artifact name is a filename, and `readdirSync` decodes by default: two outputs whose names
// differ only in a byte that is not valid UTF-8 arrived at `artifactByteDigest` as the same U+FFFD
// string and were handed on under one digest. The name is the only thing separating two artifacts
// of the same content, so the digest path carries it as bytes; sorting is over those bytes, which
// is the same order the canonical tree uses.
//
// Only the digest path. `cpSync` takes no Buffer path, so the candidate copy below still works in
// decoded names and would write an undecodable one under a lossy name -- named as a limitation in
// docs/BYTE_DIGEST.md rather than hidden behind a byte-accurate digest.
function outputArtifactNames(root) {
  const seeded = SEED_INPUTS.map((name) => Buffer.from(name, "utf8"));
  return readdirSync(root, { encoding: "buffer" })
    .filter((name) => !seeded.some((seed) => seed.equals(name)))
    .sort(Buffer.compare);
}

const artifactPath = (root, name) => Buffer.concat([Buffer.from(root, "utf8"), Buffer.from(sep, "utf8"), name]);

function outputArtifactDigests(root) {
  return outputArtifactNames(root).map((name) => artifactByteDigest(artifactPath(root, name), name));
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
  // Recorded as what it is. This was a `user.instruction` under producer `operator`, so the
  // sentences the shipped plan template ships with were filed as things the user said -- and with
  // no operator plan authored, every one of them was AOS's own default wearing the operator's
  // producer id. The instruction still enters the record, because `observeInterventions` compares
  // an operator's own instruction against the one that was already in flight, and losing that
  // baseline would score an operator who retyped the identical sentence as one who changed it.
  appendEvent(home, runId, "aos", {
    event_type: "plan.instruction",
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
    // `AOS_EVENT\t{"event_type":"operator.decision"}` is one `echo` away, and until #560 those three
    // lines earned M11 = M12 = 1. The store refuses them; this asks first so that a run is not
    // aborted by an agent's stdout, and records the refusal, because an event that disappeared
    // without a trace would leave the run looking like one where nothing tried.
    if (isOperatorAuthorityType(semantic.event_type)) {
      appendEvent(home, runId, "aos", {
        event_type: "operator.event.refused",
        family,
        payload: { family, refused_type: semantic.event_type, source: "agent-stdout", reason: `${agent.id} wrote an operator event to stdout` }
      });
      continue;
    }
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
let checkpointOrdinal = 0;

async function askAtCheckpoint(home, runId, family, stage, evidence, checkpoint, attempt, inFlightInstruction = null) {
  // One opportunity per question asked, numbered rather than named after the stage: a stage can be
  // asked about twice -- once for the blocker the scenario puts in front of the operator and again
  // when the agent fails -- and two opportunities sharing an id would make the second one's state
  // revision fail to advance, which is the rule that stops a decision being replayed.
  checkpointOrdinal += 1;
  const opportunity = `opp-${family}-${stage}-${checkpointOrdinal}`;

  // What AOS did, recorded when it did it. This is not a claim about a person and carries no
  // authority: the instrument stopped and offered an opportunity, and that is true whether anybody
  // was there or not.
  appendEvent(home, runId, "aos", {
    event_type: "checkpoint.offered",
    family,
    payload: { family, kind: evidence.kind, detail: evidence.detail, evidence_digest: evidence.evidence_digest }
  });

  // Asked first, recorded after. The first version signed `checkpoint.observe` at the moment the
  // question was printed, so closing the stream was enough to make AOS mint an operator event
  // describing an operator who was never there.
  const decision = await checkpoint.ask(evidence, { attempt });

  // What the channel actually is, not what the flag claimed.
  //
  // `--checkpoints` was read as proof of presence and every answer was signed interactive-tty /
  // DIRECT_LOCAL / HIGH -- so a controller that pipes four lines, which is what this repository's own
  // fixtures do, had AOS sign them. A terminal is not a person and this does not pretend otherwise:
  // `lib/checkpoint-runtime.mjs` is right that `expect` holds a pty and a person can walk away from
  // one. It is a necessary condition. A stream that is not a terminal carries somebody relaying on
  // the owner's behalf, and the attestation that admits a relayed answer is #576's to issue.
  const refuse = (source, reason) => {
    appendEvent(home, runId, "aos", {
      event_type: "operator.event.refused",
      family,
      payload: { family, refused_type: "checkpoint.raised", source, reason }
    });
    return decision;
  };
  if (decision.unanswered === true) {
    return refuse("unanswered", "the checkpoint was shown and nobody answered it, so there is no operator turn to record");
  }
  if (checkpoint.channel !== "interactive-tty") {
    return refuse("piped-stdin", "the answers arrived on a stream that is not a terminal, so no operator source can be named for them; admitting a relayed answer needs the owner-relay attestation of #576");
  }

  const secret = operatorRunKey(home, runId);
  const turn = (decision_type, construct_cell_id, state_revision, value, declared_route) => mintOperatorEvent({
    run_id: runId,
    source: "interactive-tty",
    decision_type,
    construct_cell_id,
    opportunity_id: opportunity,
    challenge_digest: `sha256:${evidence.evidence_digest}`,
    value,
    state_revision,
    declared_route
  }, { secret });

  appendEvent(home, runId, "operator", {
    event_type: "checkpoint.raised",
    family,
    payload: evidence,
    operator_event: turn("checkpoint.observe", "C3.ER.01", 1, { family, stage, kind: evidence.kind, attempt })
  }, { source: "interactive-tty" });
  if (decision.choice === "instruct") {
    appendEvent(home, runId, "operator", {
      event_type: "user.instruction",
      family,
      payload: {
        stage,
        instruction_digest: sha256Text(decision.instruction),
        instruction_length: decision.instruction.length,
        // The instruction this one replaced, recorded here because this is the only place that
        // knows it. An observer reading the event stream cannot recover it: the plan's instruction
        // is written by a different producer and `readEvents` groups a run by producer.
        previous_instruction_digest: typeof inFlightInstruction === "string" ? sha256Text(inFlightInstruction) : null
      },
      // The digest of what they wrote, never its length: length is a prohibited value source in
      // this contract and an event that carried it would put it in front of every consumer.
      operator_event: turn("intervention.decide", "C4.IQ.01", 2, { instruction_digest: sha256Text(decision.instruction) })
    }, { source: "interactive-tty" });
  }
  if (decision.choice === "stop") {
    appendEvent(home, runId, "operator", {
      event_type: "session.cancelled",
      family,
      payload: { stage, reason: "operator stopped at a checkpoint" },
      operator_event: turn("intervention.decide", "C4.IQ.01", 2, { stage, stopped: true })
    }, { source: "interactive-tty" });
  }
  if (decision.choice === "reroute") {
    appendEvent(home, runId, "operator", {
      event_type: "operator.route",
      family,
      payload: { family, stage, from: evidence.agent_profile_id ?? null, to: decision.route },
      // D3, bound to C2.OD.01 -- the contract's own operator-process cell for decomposition and
      // routing. The route is structural and is carried as itself; what actually ran is Outcome
      // evidence and is compared against this rather than replacing it.
      operator_event: turn("route.assign", "C2.OD.01", 3, { stage, to: decision.route }, [decision.route])
    }, { source: "interactive-tty" });
  }
  appendEvent(home, runId, "operator", {
    event_type: "operator.decision",
    family,
    payload: {
      stage, choice: decision.choice, route_changed: decision.choice === "reroute",
      evidence_digest: evidence.evidence_digest,
      // How many times the operator opened the evidence before answering. Not a state change and
      // never scored as one; it is what makes `critical-evidence-inspected` answerable at all.
      inspected: Number.isInteger(decision.inspected) ? decision.inspected : 0
    },
    operator_event: turn("intervention.decide", "C4.IQ.01", 4, {
      stage,
      choice: decision.choice,
      route_changed: decision.choice === "reroute",
      inspected: Number.isInteger(decision.inspected) ? decision.inspected : 0
    })
  }, { source: "interactive-tty" });
  // Handed back so the invocations that follow a reroute can be attributed to the decision that
  // caused them. An invocation nobody can attribute decides nothing in D3, and one attributed to
  // the wrong opportunity decides the wrong thing.
  return { ...decision, opportunity_id: opportunity };
}

/**
 * The run's invocations as actual route events, for the routing oracle.
 *
 * `task_id` is null and stays null. AOS invokes an agent for a family, not for one of the tasks the
 * agent's own plan describes, and writing the plan's task id onto an invocation AOS did not make
 * per task would be the declaration wearing the ledger's clothes. The oracle already treats a null
 * task id as an invocation it cannot attribute, which is the truth about it.
 *
 * The capability digest is recomputed from the record AOS holds rather than copied from anywhere,
 * so that the oracle's check of it is a check and not a comparison of a value with itself.
 */
function actualRouteEvents(family, route, runs, capabilityRecords) {
  return runs.map((entry, index) => ({
    schema_id: ACTUAL_ROUTE_EVENT_SCHEMA,
    task_id: null,
    agent_id: entry.agent,
    route_id: route,
    invocation_id: `${family}:${entry.stage ?? `invocation-${index + 1}`}:${index + 1}`,
    // The stage, not the family. Two agents in a route serve two purposes and neither repeats the
    // other; a retry after a checkpoint serves the purpose that already failed, which is the one
    // case `no-redundant-invocation` is asking about.
    purpose_id: `${family}/${entry.stage ?? `invocation-${index + 1}`}`,
    started_at: entry.started_at ?? null,
    completed_at: entry.completed_at ?? null,
    artifact_ids: Array.isArray(entry.artifact_ids) ? entry.artifact_ids : [],
    handoff_ids: [],
    capability_digest: capabilityRecords.has(entry.agent) ? capabilityDigestOf(capabilityRecords.get(entry.agent)) : null,
    // The opportunity, in the field named for it. What a checkpoint hands back is `opp-...` -- which
    // chance to decide this invocation followed -- and not the id of the operator event that
    // recorded the decision. Writing it into `operator_decision_event_id` would put an identifier's
    // shape where its provenance belongs, and the validator refuses that swap.
    operator_opportunity_id: entry.opportunity_id ?? null,
    // #560 mints the operator event and this path does not hold its id. Null rather than something
    // that looks like one.
    operator_decision_event_id: null
  }));
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
    // Families where an answer actually moved something, and families where nobody answered at all.
    // The difference decides whether a harness that fails identically may still be scored.
    const changedIn = new Set();
    const silentIn = new Set();
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
        // #558. When it started and when it ended, so that two invocations of a shared resource can
        // be shown to have overlapped. `duration_ms` alone cannot: two durations do not say whether
        // the two were in the air together, which is the only form the collision takes.
        const startedAt = new Date().toISOString();
        const result = await invokeAgent(home, runId, family, agent, branch, `parallel-${stageIndex + 1}`, prompt, timeoutMs, instruction);
        return { id, branch, result, started_at: startedAt, completed_at: new Date().toISOString() };
      }));

      const candidates = join(workspace, "candidates");
      rmSync(candidates, { recursive: true, force: true });
      mkdirSync(candidates, { recursive: true });
      for (const item of finished) {
        const destination = join(candidates, item.id);
        mkdirSync(destination, { recursive: true });
        for (const name of outputNames(item.branch)) {
          const source = join(item.branch, name);
          artifactByteDigest(source, name);
          cpSync(source, join(destination, name), { recursive: true, dereference: false });
        }
        previousArtifacts.set(item.id, outputArtifactDigests(item.branch));
        invocations.push({
          agent: item.id,
          stage: `parallel-${stageIndex + 1}`,
          started_at: item.started_at,
          completed_at: item.completed_at,
          artifact_ids: previousArtifacts.get(item.id) ?? [],
          ...item.result
        });
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
    // Which operator routing decision, if any, the invocations from here on belong to.
    let routeOpportunity = null;

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
        checkpoint, 1, instruction
      );
      if (decision.choice === "instruct") instruction = decision.instruction;
      if (decision.choice === "reroute" && config.agents[decision.route]) {
        runner = config.agents[decision.route];
        runnerId = decision.route;
        routeOpportunity = decision.opportunity_id ?? null;
      }
      // Stopping stops the run. Carrying on to the next family after the operator said to stop
      // would grade their decision as ineffective for a reason that is AOS's, not theirs -- an
      // intervention is judged by whether the work that followed was the same thing again, and
      // there must be no work that followed.
      if (decision.choice === "stop") throw new Error("AOS_CANCELLED");
    }

    let startedAt = new Date().toISOString();
    let result = await invokeAgent(home, runId, family, runner, workspace, stage_, promptFor(family, workspace, stage_, previous, instruction), timeoutMs, instruction);
    // Not walked for an agent that never started. The walk refuses a symlinked artifact and aborts
    // the run, which is right and is what the walk further down already does -- but doing it here
    // would replace `AOS_AGENT_DID_NOT_RUN` with a message about the workspace for an agent that
    // wrote nothing, and the first of those is the one the operator needs.
    const started = !neverStarted(result);
    invocations.push({
      agent: runnerId,
      opportunity_id: routeOpportunity,
      stage: stage_,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      artifact_ids: started ? outputArtifactDigests(workspace) : [],
      ...result
    });
    if (!started) {
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
        checkpoint, attempt, instruction
      );
      if (decision.choice === "stop") throw new Error("AOS_CANCELLED");
        if (decision.unanswered) { silentIn.add(family); break; }
        if (decision.changes === "instruction-changed" || decision.changes === "route-changed") changedIn.add(family);
      if (decision.choice === "reroute") {
        const next = config.agents[decision.route];
        if (!next) break;
        runner = next;
        runnerId = decision.route;
        routeOpportunity = decision.opportunity_id ?? null;
      }
      if (decision.choice === "instruct") instruction = decision.instruction;
      startedAt = new Date().toISOString();
      result = await invokeAgent(home, runId, family, runner, workspace, stage_, promptFor(family, workspace, stage_, previous, instruction), timeoutMs, instruction);
      invocations.push({
        agent: runnerId,
        opportunity_id: routeOpportunity,
        stage: stage_,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        artifact_ids: outputArtifactDigests(workspace),
        ...result
      });
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
      changed: changedIn.has(family),
      silent: silentIn.has(family),
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
    // Named from the roots `session.mjs` actually walks. It listed two of the three, so an operator
    // whose only transcripts were Grok's was told there was nothing to review.
    emit(io, "no Codex, Claude Code or Grok sessions found under ~/.codex, ~/.claude or ~/.grok");
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
    // #501: this was `sessions.slice(0, since)` over a list sorted by file mtime, so `--since 12`
    // meant twelve most-recently-touched *files*. Measured on one machine, those twelve were three
    // long-lived transcripts that produced every finding, five files with no tool activity at all,
    // and four real working sessions that produced none. A slot spent on a file with nothing in it
    // is a session the operator asked to see and did not get.
    //
    // `--since n` now means n sessions that have something to review. What was skipped is reported
    // rather than dropped, because "twelve" that silently became four is the defect, not the count.
    const pool = findSessions({ limit: Math.max(since * 5, 60) });
    const reviewed = [];
    const spans = [];
    let empty = 0;
    for (const entry of pool) {
      if (reviewed.length >= since) break;
      const loaded = loadSession(entry.path);
      if ((loaded.calls?.length ?? 0) === 0) { empty += 1; continue; }
      reviewed.push(reviewSession(loaded));
      spans.push({ path: entry.path, days: (loaded.ended - loaded.started) / 86400000, calls: loaded.calls.length });
    }
    // A transcript spanning weeks holds more of everything, so it contributes more findings than a
    // session from this morning without being more of a pattern. Naming the long ones lets a reader
    // see that rather than read a count that flattens them together.
    const longLived = spans.filter((entry) => entry.days >= 2).sort((a, b) => b.days - a.days);
    const ranked = aggregateFindings(reviewed);
    const incomplete = reviewed.filter((result) => result.status === "INCOMPLETE").length;
    const observed = reviewed.reduce((total, result) => total + (result.observations?.length ?? 0), 0);
    if (getOption(options, "json")) {
      emit(io, canonicalJson({
        requested_sessions: wanted,
        runtimes_read: RUNTIMES,
        aos_workspaces_skipped: sessions.aosWorkspacesSkipped ?? 0,
        empty_sessions_skipped: empty,
        long_lived_sessions: longLived.map((entry) => ({ path: entry.path, days: Math.round(entry.days), calls: entry.calls })),
        reviewed_sessions: reviewed.length,
        incomplete_sessions: incomplete,
        observations: observed,
        rules: ranked
      }).trimEnd());
      return ranked.length ? 1 : 0;
    }
    const shortfall = since > reviewed.length ? ` (${since} requested, ${reviewed.length} found)` : "";
    emit(io, `${reviewed.length} session(s)${shortfall}${incomplete > 0 ? `, ${incomplete} only partly readable` : ""}`);
    if (empty > 0) emit(io, `${empty} transcript(s) had no tool activity and did not take a slot`);
    for (const entry of longLived.slice(0, 3)) {
      emit(io, `long-lived: ${Math.round(entry.days)} days, ${entry.calls} calls — ${entry.path}`);
    }
    if (longLived.length > 0) {
      emit(io, "a transcript spanning days holds more of everything; it is not more of a pattern");
    }
    // What was searched. A silent omission reads as "this is everything you have run", and it was
    // not: an operator running a runtime with no adapter got a review of part of their work with
    // nothing saying a part was missing.
    emit(io, `read ${RUNTIMES.length} runtimes: ${RUNTIMES.join(", ")}`);
    if (sessions.aosWorkspacesSkipped > 0) {
      emit(io, `${sessions.aosWorkspacesSkipped} transcript(s) from this tool's own assessment workspaces were not read`);
    }
    // Only when it is true. This was unconditional, so a run that then listed four high-severity
    // rules said "none of them findings" one line above them.
    if (observed > 0 && ranked.length === 0) emit(io, `${observed} observation(s) recorded, none of them findings`);
    else if (observed > 0) emit(io, `${observed} observation(s) recorded, and the findings below`);
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
// Abandoned cycles are kept, not deleted. A cycle that can be made to disappear is a cycle whose
// owner can retry until the scenario suits them.
const abandonedPath = (home) => join(home, "cycle-abandoned.json");

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
    // #488: `--force` drew fresh seeds over the open cycle and the previous one -- its seeds and
    // every run counted against them -- was gone. That is the loop this whole mechanism exists to
    // prevent, reachable through a documented flag on the same command: open, see a low run,
    // --force, start again. `cycle.mjs` refuses to discard a run for what it scored; nothing
    // refused to discard the cycle that held it.
    //
    // Abandoning is still allowed, because an operator who opened a cycle against the wrong profile
    // has to be able to get out of it. What is not allowed is abandoning it quietly: the reason is
    // required, and the cycle is written to the ledger with its seeds and all of its scores, which
    // `aos cycle` then prints. You can stop a cycle. You cannot make it not have happened.
    let abandonReason = null;
    if (stored !== null) {
      if (getOption(options, "force", false) !== true) {
        return fail(io, `a cycle is already open (${stored.cycle_id}); pass --force --reason "<why>" to abandon it`);
      }
      const reason = getOption(options, "reason");
      if (typeof reason !== "string" || reason.trim().length < 8) {
        return fail(io, `AOS_CYCLE_ABANDON_REASON_REQUIRED abandoning ${stored.cycle_id} needs --reason "<why>" (8 characters or more); it is recorded with the cycle's seeds and scores`);
      }
      abandonReason = reason.trim();
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

    // Only now, with a replacement that actually exists. Recording the abandonment first meant a
    // bad --seed left the old cycle open *and* written into the abandoned ledger: the same cycle
    // both live and abandoned, which is a worse record than either.
    if (abandonReason !== null) {
      const ledger = readJsonIfExists(abandonedPath(home)) ?? { schema_id: "aos-abandoned-cycles.v1", cycles: [] };
      ledger.cycles.push({
        cycle_id: stored.cycle_id,
        profile_digest: stored.profile_digest,
        seeds: stored.seeds,
        reason: abandonReason,
        abandoned_at: new Date().toISOString(),
        replaced_by: created.cycle_id,
        runs: (stored.runs ?? []).map((entry) => ({
          seed: entry.seed, valid: entry.valid, final_score: entry.final_score ?? null,
          invalid_reason: entry.invalid_reason ?? null
        }))
      });
      writeJson(abandonedPath(home), ledger);
      emit(io, `abandoned ${stored.cycle_id} (${(stored.runs ?? []).length} run(s) recorded) — ${abandonReason}`);
    }
    writeJson(cyclePath(home), created);
    emit(io, `${created.cycle_id} opened with ${created.seeds.length} locked seed(s): ${created.seeds.join(", ")}`);
    emit(io, "Seeds are fixed now and cannot be redrawn. Run each with: aos cycle run --checkpoints");
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
    let resultSchema = null;
    try {
      // A cycle holds one kind of result. A profile result recorded beside legacy scores would be
      // aggregated with them by the median below, and the two are not one kind of number.
      resultSchema = result === null ? null : resultSchemaOf(result);
      assertUniformResultSchema([...(stored.runs ?? []), { result_schema: resultSchema }], stored.cycle_id);
      // A new run is not scored by the old scorer. Re-deriving a legacy number from a profile run's
      // observations and counting it is the migration this schema does not do, wearing a ledger
      // for a hat: the number would describe the new run under an instrument that never measured
      // it. Historical legacy runs keep the score they were written with, and a cycle of profile
      // results has no aggregate until #563 says what one is.
      const legacyLedger = result === null || resultSchema === RESULT_SCHEMA_ID ? null : result;
      recorded = recordRun(stored, {
        seed,
        run_id: runId,
        result_schema: resultSchema,
        profile_digest: result?.profile_digest ?? null,
        suite_major: SUITE_MAJOR,
        scorer_major: Number(SCORER_VERSION.split(".")[0]),
        // An instrument failure is not a low score, and a low score is not an instrument failure.
        // Only the first may be run again on the same seed.
        failure: result === null ? "AOS_INTERNAL_ERROR" : null,
        terminal_committed: terminal !== null,
        issued: legacyLedger?.issued === true,
        final_score: legacyLedger?.score?.final ?? null,
        dimensions: legacyLedger?.dimensions ?? {}
      });
    } catch (error) { return fail(io, error.message); }
    writeJson(cyclePath(home), recorded);
    const last = recorded.runs.at(-1);
    emit(io, resultSchema === RESULT_SCHEMA_ID
      ? `recorded: ${runId} — the run's profiles are in its own report; #563 owns what a cycle of profiles aggregates to`
      : last.valid ? `recorded: ${last.final_score}` : `not counted: ${last.invalid_reason}`);
    return code;
  }

  // The median is the legacy scorer's aggregation and applies to legacy results only; a cycle of
  // profile results waits for the cycle owner (#563) to say what a cycle of profiles is.
  let cycleSchema;
  try {
    cycleSchema = assertUniformResultSchema(stored.runs ?? [], stored.cycle_id);
  } catch (error) { return fail(io, error.message); }
  // A cycle of profile results has no aggregate here, and does not borrow one. The median is the
  // legacy scorer's aggregation of the legacy scorer's numbers; profile runs carry none, and
  // computing one for them would be this file deciding what a cycle of profiles means. #563 owns
  // that decision, so what this prints is the withholding and whose question it is.
  if (cycleSchema === RESULT_SCHEMA_ID) {
    const runs = stored.runs ?? [];
    const withheld = {
      cycle_id: stored.cycle_id,
      result_schema: cycleSchema,
      complete: false,
      valid_runs: 0,
      seeds: runs.map((run) => run.seed),
      runs: runs.map((run) => ({ seed: run.seed ?? null, run_id: run.run_id ?? null, profile_digest: run.profile_digest ?? null })),
      aggregate: null,
      withheld_reason: `AOS_CYCLE_AGGREGATION_UNDEFINED ${stored.cycle_id} holds ${runs.length} profile result(s); no aggregation over profile results is defined and #563 owns defining one. Each run's profiles are in its own report.`
    };
    if (getOption(options, "json")) {
      emit(io, canonicalJson(withheld).trimEnd());
      return 1;
    }
    emit(io, `${stored.cycle_id} — ${runs.length} profile run(s) of ${stored.seeds.length}`);
    emit(io, `seeds: ${withheld.seeds.join(", ")}`);
    emit(io, "");
    emit(io, withheld.withheld_reason);
    for (const run of withheld.runs) emit(io, `  ${run.seed ?? "no seed"}: ${run.run_id ?? "no run id"}`);
    emit(io, "PROFILE-BOUND: each run describes the declared environment and task pack it ran under.");
    return 1;
  }
  const summary = aggregateCycle(stored);
  if (getOption(options, "json")) {
    emit(io, canonicalJson(summary).trimEnd());
    return summary.complete ? 0 : 1;
  }
  emit(io, `${summary.cycle_id} — ${summary.valid_runs} valid run(s) of ${stored.seeds.length}`);
  emit(io, `seeds: ${summary.seeds.join(", ")}`);
  // Printed beside the score, not filed away. An abandoned cycle is part of what happened here.
  const abandoned = readJsonIfExists(abandonedPath(home))?.cycles ?? [];
  for (const entry of abandoned) {
    const scored = entry.runs.filter((run) => run.final_score !== null).map((run) => run.final_score);
    emit(io, `  abandoned earlier: ${entry.cycle_id} — ${entry.reason}${scored.length ? ` (scored ${scored.join(", ")})` : ""}`);
  }
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

// Enough of a digest to recognise a session by, with the algorithm label taken off first. Slicing
// the prefixed digest printed "sha256:aaaaa" and said nothing about which session it was.
const shortDigest = (digest) => digest.replace(/^sha256:/, "").slice(0, 12);

function holdout(home, options, io) {
  const ledgerBefore = loadLedger(home);
  const sessionPath = getOption(options, "session");

  if (typeof sessionPath === "string") {
    if (!existsSync(sessionPath)) return fail(io, `no session file at ${sessionPath}`);
    // The file's bytes, not its decoded text. Reading it as UTF-8 gave two session files that
    // differ only in an undecodable byte the same ledger identity, so a verdict recorded about one
    // was recorded about the other.
    const digest = sessionDigestOf(readFileSync(sessionPath));
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
      emit(io, `${shortDigest(digest)} recorded as ${use} (AOS read it as ${result.status}, evidence ${evidence})`);
    }

    const known = loadLedger(home).sessions.find((entry) => entry.digest === digest);
    emit(io, `${shortDigest(digest)} ${known ? known.use : "not recorded"} · ${result.findings.length} finding(s)`);
    for (const finding of result.findings) {
      const id = findingIdOf(digest, finding);
      const judged = loadLedger(home).judgements.find((entry) => entry.finding_id === id && entry.session_digest === digest);
      emit(io, `  ${id}  [${finding.severity}] ${finding.rule}  ${judged ? judged.judgement : "unjudged"}`);
      emit(io, `    ${finding.where} — ${finding.what}`);
    }
    return 0;
  }

  if (getOption(options, "lanes")) return lanes(ledgerBefore, options, io);

  // Everything below comes out of `laneA`, which is the floored result. It used to come out of
  // `acceptanceOf`, which is not: that object carries an unfloored precision, and printing it put
  // a rate over one decided finding on the screen -- "FAIL high-severity precision — 0" for a
  // single false positive, "pass ... — 1" for a single true positive -- with the sentence saying
  // the number was not a measurement printed underneath it. A withheld rate has to be absent, and a
  // notice under a printed number is not absence.
  const lane = laneA(ledgerBefore);
  if (getOption(options, "json")) {
    emit(io, canonicalJson(lane).trimEnd());
    return lane.status === "PASS" ? 0 : 1;
  }
  emit(io, `${lane.sessions} holdout session(s), ${lane.tuning_sessions} used for tuning, ${lane.judged} finding(s) judged`);
  // Named rather than dropped. These were recorded under the pre-byte identity, which cannot tell
  // two different session files apart, so they are in no figure above -- and an owner who cannot
  // see that they were excluded has a smaller holdout than they think they have.
  if (lane.legacy_sessions > 0) {
    emit(io, `${lane.legacy_sessions} session(s) recorded under the legacy identity are not counted; record them again to include them`);
  }
  emit(io, "");
  emit(io, `lane A (local holdout): ${lane.status}`);
  emit(io, `      ${lane.sessions} of ${lane.floor.sessions_required} holdout sessions, ${lane.decided_high} of ${lane.floor.decided_required} decided high-severity findings`);
  emit(io, `      decisions from ${lane.decided_sessions} of ${lane.floor.decided_sessions_required} required session(s); ${lane.tp} right, ${lane.fp} wrong, ${lane.unclear} undecided`);
  // The one line where the rate would go. Below the floor there is no rate to put in it, so the
  // line says so instead of saying it with a number in front of it.
  emit(io, lane.precision === null
    ? `      high-severity precision: withheld — ${lane.withheld_reason}`
    : `      high-severity precision: ${lane.precision.toFixed(3)} over ${lane.decided_high} decided finding(s) (target >= ${MVP_PRECISION})`);
  emit(io, "");
  for (const gate of lane.gates) {
    emit(io, `${gate.pass ? "pass" : "FAIL"}  ${gate.gate} — ${gate.value} (target ${gate.target})`);
    emit(io, `      ${gate.detail}`);
  }
  // `recordSession` has kept `previous_use` since the day a judged session could be re-labelled as
  // tuning while its verdicts stayed in the precision count. Nothing read it. A ledger whose stated
  // defence is that revisions are visible has to show them, or the defence is a field in a file.
  const moved = (ledgerBefore.sessions ?? []).filter((entry) => entry.previous_use && entry.previous_use !== entry.use);
  if (moved.length > 0) {
    emit(io, "");
    emit(io, `${moved.length} session(s) changed side after being recorded:`);
    for (const entry of moved) {
      emit(io, `      ${entry.digest.slice(0, 12)}  ${entry.previous_use} -> ${entry.use}${entry.previous_note ? `  (was: ${entry.previous_note})` : ""}`);
    }
    emit(io, "      A number that moved when a label moved is not the number that was measured.");
  }
  emit(io, "");
  emit(io, "      Run `aos holdout --lanes` for the lane report this release claim is made from.");
  emit(io, "");
  // One verdict, and it is the floored one. Acceptance over a handful of judgements is still a
  // handful of judgements, and a PASS here is exactly lane A's PASS: no violation, floor cleared,
  // and a rate that exists and clears the bar.
  const accepted = lane.status === "PASS";
  emit(io, accepted ? "accepted for local use" : "not accepted");
  // Local product acceptance, and it says so: rules written by looking at sessions are at risk of
  // having been written to fit them, and this measures only the owner's own held-back work.
  emit(io, "This is local product acceptance on the owner's own sessions, not external validation.");
  return accepted ? 0 : 1;
}

/**
 * Both lanes and the one claim they add up to.
 *
 * Separate from the acceptance report above because they answer separate questions. Acceptance is
 * the owner deciding whether to keep using this on their own machine. This is what the product is
 * allowed to say about itself, and the difference between them is a floor: a rate over fewer than
 * the floor is withheld here, and withheld means absent rather than zero.
 */
function lanes(ledger, options, io) {
  const report = laneReport({ ledger });
  if (getOption(options, "json")) {
    emit(io, canonicalJson(report).trimEnd());
    return report.claim === "PRODUCTION_QUALITY" ? 0 : 1;
  }

  const rate = (value) => (value === null ? "withheld" : value.toFixed(3));
  const a = report.lane_a;
  emit(io, `lane A (local holdout precision): ${a.status}`);
  emit(io, `      ${a.sessions} holdout session(s), ${a.tuning_sessions} used for tuning`);
  emit(io, `      ${a.decided_high} decided high-severity finding(s): ${a.tp} right, ${a.fp} wrong, ${a.unclear} undecided`);
  emit(io, a.precision === null
    ? `      precision withheld — ${a.withheld_reason} (floor: ${a.floor.sessions_required} sessions, ${a.floor.decided_required} decided)`
    : `      precision ${a.precision.toFixed(3)} over ${a.decided_high} decided finding(s)`);
  for (const violation of a.violations) emit(io, `      violation: ${violation.gate} — ${violation.detail}`);
  if (a.moved_sessions > 0) emit(io, `      ${a.moved_sessions} session(s) changed side after being recorded`);
  emit(io, `      dataset ${a.dataset_digest}`);

  emit(io, "");
  const b = report.lane_b;
  emit(io, `lane B (${b.metric_name}): ${b.status}`);
  if (b.corpus_absent) {
    emit(io, "      the known-incident corpus is not present in this installation, so there is nothing to measure");
  } else {
    emit(io, `      ${b.items} item(s), ${b.regressions.length} regression(s), ${b.violations.length} violation(s)`);
    emit(io, `      ${b.excluded_for_leakage} rule-item pair(s) excluded: the rule was derived from that item`);
    // Zero here is a different statement from a small number and the report has to be able to make
    // it: after the exclusion this corpus has nothing left to compute a rate from, rather than not
    // quite enough.
    emit(io, `      ${b.eligible_decided_pairs} eligible decided rule-item pair(s) remain`);
    for (const metric of Object.values(b.rule_metrics)) {
      emit(io, `      ${metric.rule}: tp ${metric.tp} fp ${metric.fp} fn ${metric.fn} tn ${metric.tn}, undecided ${metric.undecided}, eligible ${metric.eligible_items}`);
      emit(io, `        precision ${rate(metric.precision)}, recall ${rate(metric.recall)}${metric.withheld ? ` — ${metric.withheld_reason}` : ""}`);
    }
    for (const entry of b.regressions) {
      emit(io, `      regression: ${entry.fixture_id} ${entry.rule} — expected ${entry.expected}, observed ${entry.observed}`);
    }
    for (const violation of b.violations) emit(io, `      violation: ${violation.kind} — ${violation.fixture_id}: ${violation.detail}`);
    emit(io, `      corpus ${b.corpus_digest}`);
  }

  emit(io, "");
  emit(io, `claim: ${report.claim} — aos review stage ${report.review_stage}, precision claim ${report.precision_claim}`);
  // Named for what it is, every time it is printed. A fixture rate that gets called recall once is
  // quoted as recall forever after.
  emit(io, "Lane B is a rate over recorded incidents, not a recall over anybody's sessions.");
  emit(io, "Both lanes are diagnostics about the review rules, not a measurement of an operator.");
  return report.claim === "PRODUCTION_QUALITY" ? 0 : 1;
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

/** What a reader has to be told beside the number, in the place the number is read. */
const caveatsFor = (run) => [
  ...(run.fixture_backed_agents?.length
    ? [`FIXTURE-BACKED: ${run.fixture_backed_agents.join(", ")} ran a test fixture, not a runtime. This result describes the fixture.`]
    : []),
  ...(run.unrecognised_runtime_agents?.length
    ? [`UNRECOGNISED RUNTIME: ${run.unrecognised_runtime_agents.join(", ")} — a command with no adapter. This result describes whatever that command is.`]
    : [])
];

async function assess(home, options, io) {
  assertSupportedPlatform();
  const config = readConfig(home);
  const templatePath = getOption(options, "template");
  if (typeof templatePath === "string") {
    const target = resolve(io.cwd, templatePath);
    if (existsSync(target) && getOption(options, "force", false) !== true) throw new Error(`AOS_TEMPLATE_EXISTS ${target}; pass --force to replace it`);
    writeJson(target, operatorPlanTemplate(Object.keys(config.agents), config.agents));
    emit(io, getOption(options, "json", false) === true ? { ok: true, template: target } : `Wrote operator plan template: ${target}`, getOption(options, "json", false) === true);
    return 0;
  }

  // No plan named means use the one this repository ships, written to the working directory so the
  // operator can see it and edit it. Requiring a hand-authored file before anything ran was a lot
  // of typing for a document that is not a scoring input.
  const namedPlan = getOption(options, "plan");
  const planPath = typeof namedPlan === "string" ? namedPlan : "aos-plan.json";
  const planFile = resolve(io.cwd, planPath);
  if (typeof namedPlan !== "string" && !existsSync(planFile)) {
    writeJson(planFile, operatorPlanTemplate(Object.keys(config.agents), config.agents));
    io.stderr.write(`note: no plan given, so this run uses ${planFile}. Edit it and pass --plan to use your own.\n`);
  }
  let plan = readJson(planFile);
  // A plan AOS wrote, still routing at an agent that has since been removed, stopped the run and told
  // the operator to fix a document they never authored:
  //
  //   AOS_INVALID_OPERATOR_PLAN FAM-1.route references unknown agent cc; FAM-2.route ...
  //
  // The only way out was deleting a file the message does not name, because the auto-write fires only
  // when nothing is there. A generated plan is AOS's to keep current; a plan the operator wrote is
  // theirs, and that one still stops the run and says exactly what is wrong with it.
  if (typeof namedPlan !== "string" && isShippedPlan(plan, Object.keys(config.agents))
    && validateOperatorPlan(plan, Object.keys(config.agents)).length > 0) {
    plan = operatorPlanTemplate(Object.keys(config.agents), config.agents);
    writeJson(planFile, plan);
    io.stderr.write(`note: ${planFile} routed at an agent that is no longer registered, so it was rewritten for the agents you have now.\n`);
  }
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
  // #558. What AOS knows each registered agent can do, from the adapter the operator registered it
  // as. An agent with no adapter AOS ships is `unknown` here, which is what makes the routing
  // oracle refuse to answer a capability question about it instead of assuming one.
  const capabilityRecords = capabilityRecordsFor(config.agents);
  for (const expression of Object.values(routes)) {
    for (const id of routeAliases(expression)) {
      const agent = config.agents[id];
      if (!agent) throw new Error(`AOS_AGENT_NOT_FOUND ${id}`);
      if (!commandExists(agent.command)) throw new Error(`AOS_AGENT_COMMAND_UNAVAILABLE ${id} ${agent.command}`);
      // Before the first model call, for the same reason the credential check moved here in #459.
      // An identity that has drifted stops every stage that would have carried a credential, and
      // finding that out after six families have been paid for is the failure this product already
      // decided it would not repeat.
      const identity = authorizeRuntimeAuth(agent, adapterFor(agent), {});
      if (!identity.ok) throw new Error(`${identity.code} ${identity.detail}`);
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
  // Every invocation the run made, for D3, each carrying the operator routing decision it followed
  // where there was one. An invocation with none is unattributed and decides nothing: the plan is a
  // document and a document is not an operator event, so a run where nobody rerouted has no declared
  // route to compare against and `routeEvidence` says so rather than inventing one.
  const invocationsForRoute = [];
  // #558. What AOS asked FAM-3 for, read out of the workspace it seeded and before the agent has
  // run in it -- the requirement, not the answer -- and the invocations that followed, as the
  // actual route events the routing oracle compares against it.
  let routingWork = null;
  let routingEvents = [];
  let orchestration = { integrity: null, join: null };
      // Said before the first model call, not after the last one. M11, M12 and M13 are observed only
      // from a real operator turn, so an unattended run tops out at 17 of 20 against a gate of 18: no
      // score, decided by arithmetic that is known before anything runs. A cycle spends three of these
      // and the seeds are not refundable. This product already refuses to turn a setup failure into a
      // low score; letting the operator spend quota on a number that cannot be issued is the same debt.
      if (getOption(options, "checkpoints", false) !== true) {
        io.stderr.write(
          `note: no --checkpoints, so M11-M13 cannot be observed and this run tops out at ${METRIC_IDS.length - 3} of ${METRIC_IDS.length} of the metrics. The monitoring evidence is the operator's own, so the process index and the composite will be withheld with that as the reason. Pass --checkpoints to be observed on it.\n`
        );
      } else if (io.stdin?.isTTY !== true) {
        // Said before the run rather than discovered in the result. An operator whose answers are
        // piped in gets asked, and the run behaves the same; what it cannot do is record the answers
        // as an operator's, and finding that out afterwards would look like the instrument losing
        // evidence rather than declining to invent it.
        io.stderr.write(
          "note: --checkpoints was passed but this process's stdin is not a terminal, so the answers cannot be recorded as an operator's and M11-M13 will be NOT_OBSERVED. A relayed answer is admitted by the owner-relay attestation of #576.\n"
        );
      }

  // The flag says the operator wants to be asked. The descriptor says what they are being asked on,
  // and that is what decides whose turn it can be recorded as: answers that arrive on a pipe are
  // somebody relaying, and the source for a relayed answer is #576's to attest.
  const nextLine = lineReader(io.stdin);
  const channel = io.stdin?.isTTY === true ? "interactive-tty" : null;
  const checkpoint = getOption(options, "checkpoints", false) === true
    ? {
        channel,
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
  // The environment boundary each agent actually ran under, kept per agent rather than per
  // invocation because it is the same object for every call to one agent and repeating it twenty
  // times would put the operator's whole removed-name list in the result twenty times. The result
  // used to carry none of it: `runProcess` built an accurate record and `family_results` kept six
  // process fields, so a scored file could not say which policy produced the number it reports.
  const environmentByAgent = new Map();
  const used = new Set();
  let invocationCount = 0;
  let safety = "S0";

  try {
    for (const family of FAMILIES) {
      const workspace = join(paths.workspaces, family);
      const prepared = prepareScenario(family, workspace, seedValue);
      // Read here, between the seeding and the first invocation. Reading it after the agent has run
      // would let the artifact under measurement rewrite the requirement it is measured against.
      if (family === "FAM-3") routingWork = readJsonIfExists(join(workspace, "work.json"));
      const familyPlan = plan.families[family];
      for (const id of routeAliases(familyPlan.route)) used.add(id);
      const execution = await executeRoute(home, runId, family, familyPlan, config, workspace, timeoutMs, checkpoint);
      const runs = execution.invocations;
      for (const entry of runs) invocationsForRoute.push({ agent: entry.agent, opportunity_id: entry.opportunity_id ?? null });
      if (family === "FAM-3") routingEvents = actualRouteEvents(family, familyPlan.route, runs, capabilityRecords);
      if (runs.some((entry) => entry.interrupted)) throw new Error("AOS_CANCELLED");

      // The family's last invocation, not every attempt in it. A first attempt that failed and was
      // then unblocked at a checkpoint is the checkpoint working, and counting it here would stop
      // the run at exactly the moment the operator did the thing being measured.
      // Not where AOS raised a checkpoint. If it stopped and asked and the run still failed, the
      // reason is on record as an operator decision -- or as nobody answering, which is what an
      // unattended run is. Neither is a harness that could not start.
      // Not waived when a checkpoint was raised. The waiver read "if it stopped and asked and the run
      // still failed, the reason is on record as an operator decision" -- true of a real failure
      // somebody was asked about, and false of a harness that never started. Measured: a `claude`
      // whose credential was invisible exited 1 in a second with the same 35 bytes on all six
      // families, every one behind a checkpoint, and the operator was scored 6 of 20 for it. Being
      // asked about an authentication error does not make it your answer.
      //
      // Two families ask for different things, so byte-identical output from both is not a bad agent.
      // It is an agent that read neither, whoever was watching.
      // Waived in exactly two cases, and neither of them can be scored into somebody's number: the
      // operator changed something and it still failed, which is their outcome on record; or nobody
      // answered, which is an unattended run and withheld anyway. What is left is the case this guard
      // was written for and could not reach -- somebody sat there, changed nothing, and the harness
      // failed every family the same way. Measured: 6 of 20 for an invisible credential.
      const ended = execution.changed || execution.silent ? null : runs.at(-1);
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
      for (const entry of runs) {
        if (entry.isolation && !environmentByAgent.has(entry.agent)) environmentByAgent.set(entry.agent, entry.isolation);
      }
      invocationCount += runs.length;
      const graded = await gradeScenario(family, workspace, { baseline: prepared.baseline, params: prepared.params, invocationCount: runs.length, isolation: ISOLATION_LANE });
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
          duration_ms: entry.duration_ms,
          // The policy this call was actually made under, by digest. The profile digest beside the
          // score is computed before anything runs and cannot know whether automatic credential
          // resolution found a credential on this machine, which changes the names the child is
          // built with. Two invocations of one agent that differ here differ in what they could
          // see, and nothing else in the file would say so.
          env_policy_digest: entry.isolation?.env_policy_digest ?? null,
          // #554. `runProcess` binds the credential to a verified executable and says which one;
          // this mapping used to drop that on the floor, so the stored assessment -- the artifact
          // anybody reads afterwards -- carried no record of which program produced it. Digests and
          // status only, which is all the record ever holds.
          runtime_identity: entry.runtime_identity ?? null
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
    // Re-checked at the read, not trusted because the write gate held. The event files are ordinary
    // files under the operator's home, and a run recorded before that gate existed carries no
    // attestation at all: both reach here as traces with operator-typed records in them, and only a
    // record whose session binding verifies against this run's key is an operator turn.
    const attested = attestedOperatorTrace(readEvents(home, runId), { run_id: runId, secret: operatorRunKey(home, runId) });
    // D1-D3 bound to the contract's own cells, in the path that scores, not beside it. Every
    // admitted operator decision becomes a row naming its event, its cell, its opportunity, its
    // source and authority and its state revision; the rows for the cells this contract can score
    // become the evidence ids the observations carry, and a scorable cell with no row behind it
    // withholds the metrics that read it.
    const operatorBinding = bindOperatorDecisions(attested.accepted, { contract: shippedEcdContract() });
    const processBound = processEvidence(operatorBinding, interventionSummary(attested.trace));
    const interventions = processBound.interventions;
    const routingInput = Object.freeze({
      work: routingWork,
      plan: artifacts.plan ?? null,
      capabilities: capabilityRecords,
      actual_route_events: routingEvents
    });
    const observations = observeRun({
      artifacts,
      params: scenarioParamsByFamily,
      interventions,
      orchestration,
      fam5: fam5Details,
      invocations: invocationsByFamily,
      routing: routingInput
    });
    // The oracle's own record, kept beside the run rather than inside the published result: it is
    // the working evidence M09 was decided from, and #583 reads the delegation reference off it.
    //
    // Built from `routingInput`, the same object the observation was built from, so the record and
    // the scored row cannot describe two different oracles. The oracle is a pure function of that
    // object, so one input is one answer.
    const routing = routingObservables(routingInput);
    // Recorded beside the number, because a result that cannot say what it was computed from
    // cannot be recomputed -- and `aos verify --run` would then be re-deriving its inputs from its
    // own conclusions, which checks nothing.
    const scoringContext = { safetyState: safety, isolationLevel: ISOLATION_LANE, evidenceStatus: "COMPLETE" };
    // The result of a run is the profile result the #582 contract issues, not a single score.
    //
    // What the run knows about its own identity is declared and nothing else is: the interface and
    // harness are this program, the runtimes and models are the adapters that were actually
    // invoked, and the operator and occasion are nobody -- AOS does not know who is at the keyboard
    // and inventing an identity is how a run claims to be comparable with one it is not. Those two
    // absences are why a local run is a RUN_DIAGNOSTIC and says so.
    const ecdContract = shippedEcdContract();
    const invoked = [...used].sort();
    const facets = {
      language: languageOf(localeFromEnvironment(process.env)),
      interface: "cli",
      harness: `aos@${VERSION}`,
      runtime: invoked.map((id) => config.agents[id]?.runtime_name ?? "unknown").sort().join("+") || null,
      model: invoked.map((id) => config.agents[id]?.adapter ?? "generic-command.v1").sort().join("+") || null,
      operator: null,
      occasion: null
    };
    const formsCompleted = FAMILIES.filter((family) => familyResults[family] !== undefined);
    const evaluation = evaluate(observations, { facets, profile_digest: profileDigest, forms_completed: formsCompleted }, ecdContract);
    const result = buildResult({
      evaluation,
      contract: ecdContract,
      observations,
      run: {
        run_id: runId,
        mode: "ASSESS",
        suite: manifest.suite_id,
        suite_digest: manifest.suite_digest,
        seed: seedValue,
        seeded_families: [...SEEDED_FAMILIES],
        forms_completed: formsCompleted,
        profile_digest: profileDigest,
        isolation_level: scoringContext.isolationLevel,
        scoring_permitted: SCORING_ISOLATION.has(scoringContext.isolationLevel),
        evidence_status: scoringContext.evidenceStatus,
        safety_state: scoringContext.safetyState,
        agents_used: invoked,
        invocation_count: invocationCount,
        // Kept from the legacy record because they are what the number describes: a fixture is not
        // a runtime, and a command with no adapter is not a runtime this tool recognises.
        fixture_backed_agents: invoked.filter((id) => fixtureBackedAgent(config.agents[id])),
        unrecognised_runtime_agents: invoked.filter((id) => (config.agents[id]?.adapter ?? "generic-command.v1") === "generic-command.v1"),
        operator_plan_digest: operatorGrade.digest,
        operator_plan_authored: !isShippedPlan(plan, Object.keys(config.agents))
      }
    });
    // The run's own working record: everything the store keeps about how this run went, beside the
    // result rather than inside it. The result is the artifact somebody publishes; this is not.
    writeJson(runPaths(home, runId).record, {
      run_id: runId,
      suite_manifest: manifest,
      opportunity_profile: profile,
      scoring_context: scoringContext,
      isolation: {
        level: scoringContext.isolationLevel,
        scoring_permitted: SCORING_ISOLATION.has(scoringContext.isolationLevel),
        by_agent: Object.fromEntries([...environmentByAgent].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      },
      operator_plan: operatorGrade.projection,
      // The binding, cell by cell, including the cells this contract declares and cannot score. A
      // report that listed only the cells it could score would read as if the others had nothing
      // behind them.
      operator_process_binding: {
        rows: operatorBinding.rows,
        cells: operatorBinding.cells,
        rejected: [...operatorBinding.rejected, ...attested.rejected],
        evidence_ids: processBound.evidence_ids,
        withheld_for: processBound.withheld_for,
        context_decisions: contextDecisions(operatorBinding, []),
        route_evidence: routeEvidence(operatorBinding, invocationsForRoute)
      },
      routing_oracle: routing.oracle,
      delegation_oracle: delegationOracle(routing.oracle),
      interventions,
      agent_portfolio: { configured: profile.length, used: invoked, invocations: invocationCount },
      collaboration_surfaces: Object.values(config.collaboration_surfaces ?? {}),
      family_results: familyResults,
      limitations: [
        ...(invoked.some((id) => fixtureBackedAgent(config.agents[id]))
          ? ["FIXTURE-BACKED: at least one agent in this run was a test fixture, not a runtime. This result describes the fixture."]
          : []),
        "PROFILE-BOUND: this result describes the declared environment and task pack, not an ability independent of them.",
        "EXPERIMENTAL / PROVISIONAL: no calibration study, independent reproduction or qualified review exists.",
        "The suite's answers are in this repository, which makes it practice rather than an exam."
      ]
    });
    const status = safety === "S2" ? "UNSAFE" : result.aos_composite.issued ? "ISSUED" : "INCOMPLETE";
    appendEvent(home, runId, "aos", { event_type: "assessment.ended", payload: { status } });
    writeResult(home, runId, result, renderMarkdown(result), renderHtml(result), renderCard(result));
    commitTerminal(home, runId, {
      run_id: runId,
      status,
      result_digest: sha256Text(canonicalJson(result)),
      committed_at: new Date().toISOString()
    });
    if (getOption(options, "json", false) === true) emit(io, result, true);
    else {
      // Printed from the projection, so the terminal shows the stored numbers and computes none of
      // its own. Three profiles and a secondary composite, each said to be issued or withheld and
      // why -- never one number with a category under it.
      const view = projectResult(result);
      const observed = result.observations.filter((row) => row.value !== null);
      const missed = observed.filter((row) => row.value !== 1).map((row) => row.metric_id);
      emit(io, `${observed.length} of ${result.observations.length} metrics observed`);
      emit(io, missed.length ? `below full marks: ${missed.join(", ")}` : "no metric below full marks");
      emit(io, `Operator process: ${view.process.index}${view.process.withheld_summary ? ` (${view.process.withheld_summary})` : ""} — ${view.process.coverage}`);
      emit(io, `Reliance calibration: ${view.reliance.status} — ${view.reliance.explains}`);
      emit(io, `System outcome: ${view.outcome.index}${view.outcome.withheld_summary ? ` (${view.outcome.withheld_summary})` : ""}${view.outcome.cap ? ` — ${view.outcome.cap}` : ""}`);
      emit(io, `${view.composite.label} : ${view.composite.value}${view.composite.withheld_summary ? ` (${view.composite.withheld_summary})` : ""} — ${view.composite.secondary_note}`);
      emit(io, `claim stage ${view.claim.stage} · uncertainty ${view.claim.uncertainty} · generalizability ${view.claim.generalizability}`);
      // On screen, beside the numbers, not only in the JSON. A blind session watched a fixture-backed
      // agent print a full score with nothing on the terminal saying what had produced it -- the
      // caveat existed, in a file nobody had opened yet. A number that needs a footnote has to carry
      // the footnote where the number is read.
      for (const line of caveatsFor(result.run)) emit(io, line);
      emit(io, `Report: ${paths.reportHtml}`);
      emit(io, `Card:   ${paths.card}`);
    }
    return status === "UNSAFE" ? 4 : status === "ISSUED" ? 0 : 3;
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
    const adapter = getOption(args, "adapter");
    if (typeof adapter === "string" && !ADAPTERS[adapter]) {
      return fail(io, `AOS_UNKNOWN_ADAPTER ${adapter}; one of ${Object.keys(ADAPTERS).join(", ")}`);
    }
    const runtimeName = getOption(args, "runtime", id);
    const resolvedAdapter = adapterFor({ adapter, runtime_name: runtimeName });
    const authEnv = resolvedAdapter.auth_env ?? [];

    // The runtime's own credential, and only the one this adapter is known to read. It is
    // credential-shaped by nature, so `--allow-env` will not carry it; this door exists because
    // the old refusal rested on a claim that turned out to be false for one runtime.
    //
    // "Point the runtime at a config directory instead" is true of Codex, which reads
    // CODEX_HOME/auth.json. It is not true of Claude Code on macOS, where the credential lives in
    // the login Keychain and the Keychain is located through HOME -- the one thing this tool
    // replaces. There is no file to point at, so the config directory carried nothing and every
    // family failed with `Not logged in`. Telling the operator to export a Keychain token by hand
    // is worse than naming the variable the runtime already reads.
    const runtimeAuthEnv = getOptions(args, "allow-runtime-auth").map(String);
    const unknownAuth = runtimeAuthEnv.filter((name) => !authEnv.includes(name));
    if (unknownAuth.length > 0) {
      const known = authEnv.length > 0 ? authEnv.join(", ") : "none: this adapter has no known credential variable";
      return fail(io, `AOS_UNKNOWN_RUNTIME_AUTH_ENV ${unknownAuth.join(", ")} for ${resolvedAdapter.id}; this adapter reads ${known}`);
    }

    const allowEnv = getOptions(args, "allow-env").map(String);

    // Process-injection names are refused before the credential check, because several of them are
    // credential-shaped by accident (`NODE_OPTIONS` matches nothing about keys, but the old list
    // held it) and the credential message would send the operator to a remedy that does not apply.
    // There is no remedy for these: a loader hook, a shell startup file or a language preload path
    // changes what the assessed process is before its first instruction, so the command recorded in
    // the result is not the command that ran. No flag opens them.
    const forbidden = allowEnv.map((name) => [name, hardForbiddenClassOf(name)]).filter(([, className]) => className);
    if (forbidden.length > 0) {
      const detail = forbidden.map(([name, className]) => `${name} (${className})`).join(", ");
      return fail(io, `AOS_ENV_HARD_FORBIDDEN ${detail}; these change the process before it starts and no flag carries them`);
    }

    // Proxy and certificate names are a different case: an operator behind a corporate egress
    // genuinely cannot reach the provider without one. They are approved on their own flag so that
    // the approval is a decision somebody made, and so it lands in its own field of the digest.
    const transportInAllow = allowEnv.filter((name) => isTransportName(name));
    if (transportInAllow.length > 0) {
      return fail(
        io,
        `AOS_ENV_EXPLICIT_APPROVAL_REQUIRED ${transportInAllow.join(", ")}; use --allow-transport-env, which records the approval in the profile digest`
      );
    }

    const sensitive = allowEnv.filter((name) => isSensitiveName(name));
    if (sensitive.length > 0) {
      const remedy = authEnv.some((name) => sensitive.includes(name))
        ? `use --allow-runtime-auth for the runtime's own credential (${authEnv.join(", ")})`
        : "point the runtime at a config directory instead";
      return fail(io, `AOS_CREDENTIAL_ENV_REFUSED ${sensitive.join(", ")}; ${remedy}`);
    }

    // Approved by the operator, and only for an adapter that declared its runtime can need one.
    // The generic adapter declares nothing, so an unknown command gets no transport env at all --
    // otherwise the way to hand any binary a proxy would be to register it as generic.
    const transportEnv = getOptions(args, "allow-transport-env").map(String);
    try {
      envPolicyFor(resolvedAdapter, { allow: allowEnv, runtimeAuth: runtimeAuthEnv, transport: transportEnv });
    } catch (error) {
      return fail(io, error.message);
    }
    // Which executable this command reaches, read now, while the operator is standing here saying
    // this is the runtime they mean. #554: without it the only thing a later run could check was the
    // basename, and a basename survives the file being rewritten, the path becoming a symlink and a
    // wrapper appearing earlier on PATH. Registration is the one moment the answer is known.
    const runtimeIdentity = describeExecutable(command, { adapterId: resolvedAdapter.id });

    const agent = addAgent(home, {
      id,
      command,
      args: commandArgs,
      allowed_env_names: allowEnv,
      runtime_auth_env_names: runtimeAuthEnv,
      transport_env_names: transportEnv,
      runtime_identity: runtimeIdentity,
      // Off means the run fails rather than AOS reaching into the credential store. Recorded on the
      // agent, so a result can say which of the two this run was.
      auto_runtime_auth: getOption(args, "no-auto-auth", false) === true ? false : undefined,
      adapter: typeof adapter === "string" ? adapter : undefined,
      display_name: getOption(args, "display", id),
      runtime_name: runtimeName,
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
    const rows = targets.map((agent) => ({
      id: agent.id,
      command: agent.command,
      available: commandExists(agent.command),
      fixture: fixtureBackedAgent(agent),
      auth: authReadiness(agent),
      env: envReadiness(agent),
      config_digest: agent.config_digest
    }));
    emit(io, json ? rows : [
      ...rows.flatMap((row) => [
        `${row.available ? "PASS" : "FAIL"}\t${row.id}\t${row.command}`,
        `${row.auth.ok ? "PASS" : "FAIL"}\t${row.id}:auth\t${row.auth.detail}`,
        `${row.env.ok ? "PASS" : "FAIL"}\t${row.id}:env\t${row.env.detail}`,
        ...(row.fixture
          ? [`FAIL\t${row.id}:runtime\truns a test fixture, not a runtime; a score from this agent describes the fixture`]
          : [])
      ]),
      // Still said, because neither row runs the agent. What changed is that the declared
      // credential path is now checked here instead of after six families have been paid for.
      "this checks the command resolves and the declared credential path, not a live login"
    ].join("\n"), json);
    return rows.every((row) => row.available && row.auth.ok && row.env.ok && !row.fixture) ? 0 : 3;
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

/**
 * Whether this agent has any declared way to authenticate once HOME is replaced.
 *
 * #459: an operator spent the model quota on six families and got 4 of 20 metrics, because a
 * Claude Code route could not log in under isolation. The credential was in the macOS login
 * Keychain, which is located through HOME -- the one thing a run replaces -- so every family
 * exited 1 with `Not logged in`. Nothing checked before the quota was spent, and the report read
 * as though the operator had done badly.
 *
 * This costs nothing and calls no model: it asks whether the names that could carry a credential
 * were declared, and whether they are actually set here.
 */
function authReadiness(agent) {
  const adapter = adapterFor(agent);
  const authEnv = adapter.auth_env ?? [];
  if (authEnv.length === 0 && !adapter.config_env) {
    // An unrecognised runtime. Saying "ready" would be a claim about software nobody described.
    return { ok: true, detail: `${adapter.id}: no known credential path, not checked` };
  }
  const declaredAuth = agent.runtime_auth_env_names ?? [];
  const declaredConfig = (agent.allowed_env_names ?? []).filter((name) => name === adapter.config_env);
  // Asking the operator to declare something AOS can find itself is work for no reason. This costs
  // one keychain read and answers the question the run is actually going to face.
  //
  // Asked through the identity gate rather than around it, so the question doctor answers is the
  // one a run will actually face. An agent whose binary has been replaced since it was registered
  // is not "ready with a credential resolved"; it is a run that will stop, and the operator should
  // hear that here rather than after the quota is gone.
  const identity = authorizeRuntimeAuth(agent, adapter, {});
  if (!identity.ok) return { ok: false, detail: `${identity.code} ${identity.detail}` };
  if (identity.auto) {
    const resolved = resolveRuntimeAuth(adapter, { command: agent.command });
    if (resolved !== null) {
      return { ok: true, detail: `${resolved.name} resolved from the ${resolved.source}; nothing to configure` };
    }
  }
  const unset = declaredAuth.filter((name) => !process.env[name]);
  if (unset.length > 0) {
    return { ok: false, detail: `declared ${unset.join(", ")} but not set in this environment` };
  }
  if (declaredAuth.length > 0) return { ok: true, detail: `carries ${declaredAuth.join(", ")}` };
  if (declaredConfig.length > 0) {
    return { ok: true, detail: `carries ${declaredConfig[0]}; it must already hold a credential` };
  }
  const remedy = authEnv.length > 0
    ? `set ${authEnv[0]}, or re-add with --allow-runtime-auth ${authEnv[0]}`
    : `re-add with --allow-env ${adapter.config_env}`;
  return {
    ok: false,
    detail: `no credential found and none declared; a run replaces HOME, so a Keychain or HOME-bound login is invisible. ${remedy}`
  };
}

/**
 * What this agent's environment policy will actually do here, without running anything.
 *
 * The three questions an operator has before they spend a quota are which names their run will
 * carry, which of the dangerous ones are sitting in their shell right now, and whether either
 * answer moves the digest their old results were filed under. All three are answerable from the
 * policy and `process.env`, with no provider call and no spawn.
 *
 * Names and class labels only. This prints in a terminal and lands in a paste, so a value must
 * never be able to reach it -- which is also why the carried list is names, not an environment.
 */
function envReadiness(agent) {
  const adapter = adapterFor(agent);
  let policy;
  let built;
  try {
    policy = envPolicyFor(adapter, {
      allow: agent.allowed_env_names ?? [],
      runtimeAuth: agent.runtime_auth_env_names ?? [],
      transport: agent.transport_env_names ?? []
    });
    built = buildAgentEnv("BEST_EFFORT_CLI", process.env, { policy, home: "/tmp/aos-agent-home" });
  } catch (error) {
    // A policy that cannot be granted is a configuration the run will refuse. Saying so here is the
    // difference between finding out now and finding out after six families have been paid for.
    return { ok: false, detail: error.message };
  }

  // A name in the policy is a name that may travel, not a name that will. Declaring `CODEX_HOME`
  // and having nothing in it carries nothing, and the run then reaches the runtime with no
  // configuration at all: on darwin that is an HTTP 401 that reads like a login problem, because
  // AOS replaced the HOME the default `$HOME/.codex` was relative to. This row used to treat the
  // declaration as the answer and say PASS.
  const valued = (name) => typeof process.env[name] === "string" && process.env[name].length > 0;
  const missingRequired = (policy.required_env ?? []).filter((name) => !valued(name));
  if (missingRequired.length > 0) {
    return {
      ok: false,
      detail:
        `AOS_ENV_REQUIRED_MISSING ${missingRequired.join(", ")} for ${adapter.id}; ` +
        `this runtime finds its own configuration through ${missingRequired.length > 1 ? "these" : "this"}, and a run replaces HOME, ` +
        `so an unset one leaves it with no configuration and the failure reads as a login problem. ` +
        `Export ${missingRequired.map((name) => `${name}=<path>`).join(" ")} before the run`
    };
  }

  // What the operator asked for and this machine does not have. Not a blocker -- they may have
  // declared a name that is only set sometimes -- but it is the difference between "carried" and
  // "declared", and the row is the place to say which.
  const declaredAbsent = policy.config_env.filter((name) => !(policy.required_env ?? []).includes(name) && !valued(name));

  // What automatic resolution would add, by name and without reaching for a value: the row is
  // supposed to say what a run will carry, and for a runtime with a resolver that is one more name
  // than the declaration holds. `--no-auto-auth` is the case where it is not.
  const resolverName = adapter.auth_resolver?.env ?? null;
  const autoAuth = resolverName === null
    ? "auto auth none declared"
    : agent.auto_runtime_auth === false
      ? `auto auth off, so ${resolverName} is not resolved`
      : `auto auth may add ${resolverName}`;

  const dangerous = built.blocked_classes.length > 0 ? `blocked ${built.blocked_classes.join(", ")}` : "no injection env present";
  const transport = built.transport.length > 0 ? `transport ${built.transport.join(", ")}` : "transport none";
  const absent = declaredAbsent.length > 0 ? `; declared but unset ${declaredAbsent.join(", ")}` : "";
  return {
    ok: true,
    detail: `carries ${built.carried.join(", ")}${absent}; ${autoAuth}; drops ${built.removed.length} ambient names; ${dangerous}; ${transport}; ${built.policy.policy_digest}`
  };
}

/**
 * Register the runtimes that are already installed, so the operator does not type what the machine
 * already knows.
 *
 * `aos agent add <id> --command <binary> --arg ... --adapter ...` per agent was the first thing
 * anyone had to do and none of it was a decision: the binary is on PATH or it is not, and the
 * arguments that make a CLI non-interactive are a property of that CLI, not of the operator.
 *
 * Only adds what is missing. An agent the operator configured themselves is never rewritten -- the
 * point is to remove typing, not to overrule a choice.
 */

/**
 * Whether this agent runs a test fixture rather than a runtime.
 *
 * Found by a blind session on this machine: `~/.aos` held twelve agents and nine of them ran
 * `tests/product/fake-agent.mjs` -- under the names `claude`, `codex`, `grok` and `gemini`. An
 * assessment there measures the fixture and reports a normal score, which for a measuring
 * instrument is the worst failure there is: not a wrong number, a number about something else.
 *
 * `agent doctor` said PASS, because it asked `commandExists(agent.command)` and the command was
 * `node`. The fixture path is an argument. Checking only the command is the same blind spot as
 * checking only the first line of a script, and it passed the exact case doctor exists to catch.
 *
 * Not refused, only reported. This repository's own tests register fixture agents deliberately, and
 * a scorer that could not be exercised without a real model would be untestable. What must not
 * happen is a number that reads as though a runtime produced it.
 */
const FIXTURE_PATH = /(?:^|\/)(?:tests?|__tests__|fixtures?|testdata|mocks?)\/|(?:^|\/)(?:fake|mock|stub|dummy)-[\w.-]+$/i;
export const fixtureBackedAgent = (agent) =>
  [agent?.command, ...(agent?.args ?? [])].some((value) => typeof value === "string" && FIXTURE_PATH.test(value));

const DISCOVERABLE = [
  { id: "claude", command: "claude", args: ["-p", "--dangerously-skip-permissions"], adapter: "claude-code.v1", runtime: "claude-code" },
  { id: "codex", command: "codex", args: ["exec", "--skip-git-repo-check"], adapter: "codex-cli.v1", runtime: "codex", allow: ["CODEX_HOME"] }
];

/**
 * Register the runtimes on PATH, and say when a name is already taken by something that is not one.
 *
 * Not overwriting what the operator configured is the right default and stays. What was missing is
 * the sentence: an agent called `claude` whose command is this repository's own test fixture is not
 * a configuration choice to preserve silently -- it is the answer key wearing the runtime's name, and
 * every later run routes into it and scores the fixture. Found on a real machine with four of them
 * (`claude`, `codex`, `gemini`, `grok`), left behind by an earlier session's testing.
 *
 * `--force` re-registers those, and only those: an agent someone deliberately pointed at their own
 * wrapper is untouched either way, because it is not fixture-backed.
 */
function autoRegisterAgents(home, { force = false } = {}) {
  const config = readConfig(home);
  const added = [];
  const impostors = [];
  for (const entry of DISCOVERABLE) {
    const existing = config.agents[entry.id];
    if (existing && !fixtureBackedAgent(existing)) continue;
    if (existing && !force) { impostors.push(entry.id); continue; }
    if (!commandExists(entry.command)) continue;
    if (existing) removeAgent(home, entry.id);
    addAgent(home, {
      id: entry.id,
      command: entry.command,
      args: entry.args,
      adapter: entry.adapter,
      runtime_name: entry.runtime,
      allowed_env_names: entry.allow ?? [],
      // Discovery is a registration like any other. An agent AOS added for the operator that
      // carried no identity would be exactly the legacy record the migration exists to retire.
      runtime_identity: describeExecutable(entry.command, { adapterId: entry.adapter })
    });
    added.push(entry.id);
  }
  return { added, impostors };
}

async function doctor(home, options, io) {
  const checks = [];
  try { assertSupportedPlatform(); checks.push({ check: "platform", ok: true, detail: `${process.platform}/${process.arch}` }); }
  catch (error) { checks.push({ check: "platform", ok: false, detail: error.message }); }
  const config = readConfig(home);
  for (const agent of Object.values(config.agents)) {
    checks.push({ check: `agent:${agent.id}`, ok: commandExists(agent.command), detail: agent.command });
    checks.push({ check: `agent:${agent.id}:auth`, ...authReadiness(agent) });
    checks.push({ check: `agent:${agent.id}:env`, ...envReadiness(agent) });
  }
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

/**
 * Every projection a run holds, from the result it holds.
 *
 * One list, because the callers that compare projections to the result were each passing their own
 * and the card was on neither. A renderer that cannot draw this result throws, and the caller
 * decides what that means -- recovery reports it, and a run whose result this build cannot render
 * keeps whatever it has.
 */
const projectionsOf = (result) => ({ markdown: renderMarkdown(result), html: renderHtml(result), card: renderCard(result) });

function report(home, options, io) {
  const runId = getOption(options, "run");
  if (typeof runId !== "string") return fail(io, "AOS_RUN_REQUIRED", 2);
  const run = readRun(home, runId);
  if (!run.result) return fail(io, `AOS_RESULT_NOT_FOUND ${runId}`, 3);
  // What is printed is what the result projects to, not what happens to be on disk. `result.json`
  // is the record and the reports are a projection of it, so `report.md` replaced with "Operator
  // Score: 100" was a report this command handed out unchanged. The stored projections are brought
  // back to the result on the way past -- the same rule recovery applies, applied where the
  // projection is actually read, and a no-op on a run nobody has touched -- but what is served does
  // not depend on that write: a store this process cannot repair is no reason to hand a reader
  // bytes that do not follow from the record. A result this build cannot render has no projection
  // to compare against and is served as it is stored.
  let projections = null;
  try {
    projections = projectionsOf(run.result);
    regenerateReports(home, runId, () => projections);
  } catch {
    // Either this build cannot render the stored result, or the run directory could not be
    // written. `session recover` is where a repair that failed is reported by name.
  }
  const format = getOption(options, "format", "markdown");
  if (format === "json") emit(io, run.result, true);
  else if (format === "html") emit(io, projections?.html ?? readFileSync(run.paths.reportHtml, "utf8"));
  else emit(io, projections?.markdown ?? readFileSync(run.paths.reportMd, "utf8"));
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
    const recovered = recoverRun(home, id, projectionsOf);
    emit(io, json ? recovered : `${recovered.action} ${id}`, json);
    return recovered.action === "INVALID" ? 4 : 0;
  }
  if (action === "cancel") {
    // Recorded as a run's lifecycle, not as an operator's turn. This used to sign a trusted-local-ui
    // / DIRECT_LOCAL / HIGH operator event on the strength of the command having been invoked, and
    // anything with a shell can invoke it -- the same mistake the checkpoint prompt made with its
    // flag. There is no channel here to read: a cancel is typed once and answers nothing, so there
    // is no answer to attribute. `session.cancelled` stays the turn an operator takes at a
    // checkpoint, where the channel is known.
    appendEvent(home, id, "aos", {
      event_type: "run.cancelled",
      payload: { reason: "operator", channel: io.stdin?.isTTY === true ? "interactive-tty" : "not-a-terminal" }
    });
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
  // Byte digests only. A bare 64-character hex string is a digest of decoded text from before this
  // contract and says nothing about the bytes, so accepting one here would put a value that cannot
  // be verified into the evidence under the name of one that can.
  if (artifacts.some((value) => !isByteDigest(value))) return fail(io, "AOS_INVALID_ARTIFACT_DIGEST", 2);
  // A consume is a claim about what the receiver was handed, so it is checked against what the
  // sender recorded rather than recorded on the receiver's word. Without this the consumer could
  // report having read anything at all -- including nothing -- and the handoff would still close.
  if (action === "consume") {
    const created = readEvents(home, runId)
      .filter((event) => event.event_type === "handoff.created"
        && event.payload?.from === from && event.payload?.to === to && event.payload?.family === family)
      .at(-1);
    if (!created) return fail(io, "AOS_HANDOFF_NOT_CREATED", 2);
    const handed = created.payload?.artifact_digests ?? [];
    if (!handoffDigestsMatch(handed, artifacts)) {
      // Still refused when only the order differs -- the producer emits in ascending artifact-name
      // order, so an order that does not match is a list the receiver did not read. The reason is
      // named because a refusal an operator cannot tell apart from a wrong-artifact one gets worked
      // around rather than corrected.
      const reordered = handoffDigestsSameMultiset(handed, artifacts);
      return fail(io, `AOS_HANDOFF_DIGEST_MISMATCH${reordered ? " same digests in a different order; hand them on in the order they were created" : ""}`, 2);
    }
  }
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
  let refused = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (typeof parsed.event_type !== "string") throw new Error("AOS_INVALID_IMPORTED_EVENT");
    // The producer id on an import is whatever the caller typed after `--producer`, so this path
    // could file an `operator.decision` under the name `operator` and collect the process credit
    // for it. It declares no source, which is what the store reads: an imported trace is a trace,
    // and a trace is not a witness. The refused lines are recorded rather than dropped.
    if (isOperatorAuthorityType(parsed.event_type)) {
      appendEvent(home, runId, "aos", {
        event_type: "operator.event.refused",
        family: typeof parsed.family === "string" ? parsed.family : null,
        payload: { family: typeof parsed.family === "string" ? parsed.family : null, refused_type: parsed.event_type, source: mode === "bridge" ? "bridged-trace" : "imported-trace", reason: `${producer} cannot speak for the operator through ${mode === "bridge" ? "a bridge" : "an import"}` }
      });
      refused += 1;
      continue;
    }
    appendEvent(home, runId, producer, parsed);
    count += 1;
  }
  appendEvent(home, runId, "aos", { event_type: mode === "bridge" ? "bridge.received" : "import.received", payload: { source: producer, count } });
  const result = { run_id: runId, producer, count, refused, status: "DIAGNOSTIC_ONLY", mode: mode.toUpperCase() };
  const json = getOption(options, "json", false) === true;
  emit(io, json ? result : `${mode === "bridge" ? "Bridged" : "Imported"} ${count} events as diagnostic evidence${refused > 0 ? `; refused ${refused} that claimed to be operator acts` : ""}`, json);
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
  const blanked = {
    ...template,
    goal: "", constraints: [], non_goals: [],
    clarification_policy: { facts: "", human_decisions: "" },
    acceptance: [{ criterion: "", evidence: "" }]
  };
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
    // Emptied, not shipped. This asserted `validateOperatorPlan(template)` had problems, which was
    // a statement about the template being blank rather than about the validator refusing blanks --
    // so it broke the moment the template became something an operator could actually run. The
    // property is that a plan stripped of its declarations is refused, whatever the template holds.
    { check: "blank-plan-refused", ok: validateOperatorPlan(blanked, ["agent"]).length > 0 },
    // And the one this repository ships has to be runnable, or `assess` with no --plan cannot work.
    { check: "shipped-plan-runs", ok: validateOperatorPlan(template, ["agent"]).length === 0 }
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
/**
 * The reliance the result was built from, read back off the result.
 *
 * `buildResult` takes the ten metrics as a seam and publishes them; the published form is the same
 * shape it accepts, so the rebuild is handed what the original was handed. A withheld profile round
 * trips as withheld, which is why the omission survived until a run had reliance evidence in it.
 */
const relianceInputOf = (result) => {
  const stored = result.reliance_calibration_profile;
  if (!stored || typeof stored !== "object") return undefined;
  return { status: stored.status, metrics: stored.metrics };
};

/**
 * Recomputes a profile result from its own record.
 *
 * The observations, the facets and the forms are all on the result, so the whole thing can be built
 * again by the same two functions that built it and compared. Nothing is re-derived from the
 * conclusions: an edited index, a swapped domain membership or a contract that has moved since all
 * stop matching, and each is reported as what it is rather than as one failure called "wrong".
 */
function verifyProfileResult(result, checks, add) {
  add("result-schema", result.schema_version === RESULT_SCHEMA_VERSION, `${result.schema_version ?? "none"} vs ${RESULT_SCHEMA_VERSION}`);
  const contract = shippedEcdContract();
  const same = result.contract?.digests?.combined === contractDigests(contract).combined;
  add("contract-digest", same, same ? "" : "not comparable: this build's contract is not the one that produced it");
  // And the files themselves. The digest above is over the canonical form, which is stable against
  // key order and blind to the bytes: a space appended to a contract file leaves it unchanged. A
  // result that says which contract files produced it is checked against the files this build has.
  const storedBytes = result.contract?.artifact_bytes ?? null;
  const mineBytes = contractFileDigests();
  const bytesMatch = storedBytes === null ? same : storedBytes.combined === mineBytes.combined;
  add("contract-bytes", bytesMatch, bytesMatch
    ? (storedBytes === null ? "not claimed: this result was built under a contract with no files" : "")
    : "this build's contract files are not the bytes that produced it");
  add("observation-count", Array.isArray(result.observations) && result.observations.length === METRIC_IDS.length, `${result.observations?.length ?? 0} of ${METRIC_IDS.length}`);
  const forms = result.run?.forms_completed;
  if (!Array.isArray(forms) || result.facet_identity === null || typeof result.facet_identity !== "object") {
    add("recompute", false, "this result did not record the facets and forms it was evaluated under, so it cannot be recomputed");
    return checks.every((row) => row.ok);
  }
  if (!checks.every((row) => row.ok)) {
    add("recompute", false, "not comparable: this build's contract or schema is not the one that produced it");
    return false;
  }
  // The derived facets are the contract's and the run's own, and `evaluate` refuses to be handed
  // either back: they are put there by the function being checked, not by its caller.
  const { contract_digest: _contract, profile_digest: _profile, ...facets } = result.facet_identity;
  try {
    const evaluation = evaluate(result.observations, { facets, profile_digest: result.profile_digest, forms_completed: forms }, contract);
    const again = buildResult({
      evaluation,
      contract,
      observations: result.observations,
      run: result.run,
      caps: result.system_outcome_profile?.caps ?? [],
      // The reliance surface is an input like the caps are -- #583 computes the ten metrics and
      // hands them in. Rebuilding without them substituted the withheld default and compared it
      // against a stored profile that had issued metrics, so a result carrying any reliance
      // evidence at all could never verify. What is stored is what was handed in.
      reliance: relianceInputOf(result),
      uncertainty: result.uncertainty,
      generalizability_status: result.generalizability_status
    });
    // The claim is part of what has to follow from the observations, not a caption beside them:
    // editing `claim_stage` alone left every profile at PROFILE_BOUND and this comparison said the
    // result still followed from its own record. What a reader is entitled to conclude is the field
    // most worth editing, so it is compared like the numbers are.
    const surfaces = (one) => canonicalJson([
      one.operator_process_profile, one.reliance_calibration_profile, one.system_outcome_profile,
      one.aos_composite, one.cells, one.missing,
      one.claim_stage, one.generalizability_status, one.uncertainty, one.permitted_interpretation,
      one.forbidden_uses, one.profile_digest, one.contract
    ]);
    const matches = surfaces(again) === surfaces(result);
    add("recompute", matches, matches ? "" : "the stored profiles and the claim they carry do not follow from the stored observations");
  } catch (error) {
    add("recompute", false, error.message);
  }
  return checks.every((row) => row.ok);
}

function verifyRun(home, runId, options, io) {
  if (!validId(runId)) return fail(io, `AOS_INVALID_RUN_ID ${runId}`);
  const result = readJsonIfExists(runPaths(home, runId).result);
  if (result === null) return fail(io, `no result for ${runId}`, 2);

  const checks = [];
  const add = (check, ok, detail = "") => checks.push({ check, ok, detail });

  let kind;
  try {
    kind = resultSchemaOf(result);
  } catch (error) {
    return fail(io, error.message, 5);
  }
  if (kind === RESULT_SCHEMA_ID) {
    const outcome = verifyProfileResult(result, checks, add);
    if (getOption(options, "json", false) === true) emit(io, { ok: outcome, run_id: runId, checks }, true);
    else for (const row of checks) emit(io, `${row.ok ? "PASS" : "FAIL"}\t${row.check}${row.detail ? `\t${row.detail}` : ""}`);
    return outcome ? 0 : 5;
  }

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
  // `assess --help` used to fall through to the command itself: it wrote a plan into the operator's
  // working directory and started a run that spends model quota. Asking what a command does is the
  // one request that must never be the command. Every subcommand answers it the same way.
  if (rest.includes("--help") || rest.includes("-h")) { emit(runtimeIo, usage); return 0; }
  if (command === "--version" || command === "version") { emit(runtimeIo, VERSION); return 0; }
  const options = parseArgs(rest);
  // Resolved once, here. Every command below stores under this root; the five places that resolve
  // a path the operator typed use io.cwd, which is a different question from where AOS keeps data.
  const home = resolveHome({ dataDir: getOption(options, "data-dir"), env: process.env });
  // The store used to live beside the project. Moving it to the machine is right -- runs belong to
  // the machine, not to whichever directory `aos` was invoked from -- but an operator who upgrades
  // a working checkout finds their agents gone with nothing said, and the next signal they get is
  // AOS_AGENT_NOT_FOUND from a run, which points at re-registering rather than at the move.
  // #486: this fired on the existence of the old file alone, so neither remedy it offered stopped
  // it -- copying the store across or re-adding the agents changed nothing, and it printed on every
  // command including `assess`. The only thing that silenced it was deleting a file the note never
  // mentioned. It now asks the question it means: is there a store here that has not been carried
  // over yet? Once the agents exist in the new home the note has nothing to say, and it says how to
  // be rid of the old file for good.
  const orphaned = join(runtimeIo.cwd ?? ".", ".aos");
  const orphanedAgents = join(orphaned, "agents.json");
  if (orphaned !== home && existsSync(orphanedAgents)) {
    const carriedOver = Object.keys(readJsonIfExists(join(home, "agents.json"))?.agents ?? {}).length > 0;
    if (!carriedOver) {
      runtimeIo.stderr.write(
        `note: ${orphanedAgents} is from a version that kept the store beside the project.\n` +
        `      the store is now ${home}, and it has no agents yet.\n` +
        `      copy it across, or re-add them with aos agent add — either stops this note.\n` +
        `      once you no longer need the old store, delete ${orphaned}.\n`
      );
    }
  }
  try {
    if (command === "init") {
      initHome(home);
      const { added, impostors } = autoRegisterAgents(home, { force: getOption(options, "force", false) === true });
      const json = getOption(options, "json", false) === true;
      if (impostors.length > 0) {
        runtimeIo.stderr.write(
          `note: ${impostors.join(", ")} ${impostors.length === 1 ? "is" : "are"} registered as this repository's test fixture, not the runtime.\n` +
          "      a run routed there scores the answer key. re-register with aos init --force,\n" +
          "      or remove them with aos agent remove <id>.\n"
        );
      }
      emit(runtimeIo, json ? { ok: true, root: home, agents: added, fixture_backed: impostors } :
        `Initialized ${home}` + (added.length ? `\nRegistered ${added.join(", ")} — found on PATH, nothing to configure` : ""), json);
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
      // `dashboard` is the one command that never returns, so a flag it does not understand turns a
      // typo into a hang rather than an error -- measured, with `--print-token`, which does not exist:
      // it started a server and blocked for over an hour. Every other command exits, so a stray flag
      // there is at worst ignored; here it has to be refused.
      const KNOWN = ["port", "json", "data-dir"];
      const unknown = Object.keys(options).filter((key) => key !== "_" && key !== "--" && !KNOWN.includes(key));
      if (unknown.length > 0) {
        return fail(runtimeIo, `AOS_UNKNOWN_OPTION ${unknown.map((k) => `--${k}`).join(", ")} — dashboard takes ${KNOWN.map((k) => `--${k}`).join(", ")}`, 2);
      }
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
