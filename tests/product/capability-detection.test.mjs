// #625. The producer that makes `capability-matches-task` answerable in the negative, and the
// measurement that says why it had to exist.
//
// THE GAP, MEASURED BEFORE IT WAS CLOSED.
//
// `capabilityRecordsFor` maps every registered agent to `AOS_KNOWN_CAPABILITIES[adapterId]` -- one
// set per shipped adapter, and both shipped adapters get the whole vocabulary. The requirement the
// set is checked against is built by AOS out of the same release. So requirement and capability
// came from one source and a shortfall could not occur. Swept over every route shape this oracle
// accepts crossed with every adapter assignment -- 484 runs, each with a complete, adequate,
// artefact-carrying, timed ledger -- the subcheck answered `true` 50 times, `null` 434 times and
// `false` not once. The first test here is that sweep, kept, because it is the property that makes
// the probe worth having and it stays true of the producer it is about.
//
// What was missing was never the oracle. `routeConstraintFailures` has always failed a shortfall
// and `capabilityObservable` has always reported one; the counterfactual test for #558 shows both,
// by handing the oracle a narrow record no production path could produce. What was missing was a
// producer that could emit one, which is what `lib/capability-probe.mjs` is.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CAPABILITY_PROBE_VERIFIER,
  MISMATCH_WORD,
  PROBE_CHALLENGES,
  capabilityProbeRecord,
  detectedCapabilityRecord,
  observeProbeWorkspace,
  probeBrief,
  probeTokens,
  seedProbeWorkspace
} from "../../lib/capability-probe.mjs";
import { ADAPTERS } from "../../lib/profile.mjs";
import {
  ACTUAL_ROUTE_EVENT_SCHEMA,
  CAPABILITY_VOCABULARY,
  capabilityDigestOf,
  capabilityRecordsFor,
  requirementsFromRoute,
  routingObservables,
  workRequirementAtPlanApproval
} from "../../lib/routing-oracle.mjs";
import { fakeAgent, initBare, makePlan, newestRecord, newestResult, run as runCli } from "./helpers.mjs";

function workspace(t) {
  const cwd = mkdtempSync(join(tmpdir(), "aos-capability-probe-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

/**
 * A complete, adequate run of one route, priced and evidenced, for a given capability map.
 *
 * Everything except the capability records is held fixed: the requirement is the one
 * `requirementsFromRoute` builds from the route, the ledger attributes every task to the owner the
 * route names, and every required artefact and handoff is carried. So a verdict that moves between
 * two calls of this moved because the capability records did.
 */
function m09Of(route, capabilities) {
  const { requirements } = requirementsFromRoute({ form_id: "FAM-3", route, required_artifacts: ["artifact:plan.json"] });
  const stages = route.split(">").map((group) => group.split("|"));
  const ownerOf = new Map();
  for (const requirement of requirements) {
    const serial = /stage-(\d+)$/u.exec(requirement.task_id);
    const branch = /parallel-(\d+)\/branch-(\d+)$/u.exec(requirement.task_id);
    if (serial !== null) ownerOf.set(requirement.task_id, stages[Number(serial[1]) - 1][0]);
    else if (branch !== null) ownerOf.set(requirement.task_id, stages[Number(branch[1]) - 1][Number(branch[2]) - 1]);
  }
  const events = requirements.map((requirement, index) => ({
    schema_id: ACTUAL_ROUTE_EVENT_SCHEMA,
    task_id: requirement.task_id,
    agent_id: ownerOf.get(requirement.task_id),
    route_id: route,
    invocation_id: `invocation-${index}`,
    purpose_id: requirement.task_id,
    started_at: `2026-09-01T10:${String(index * 2).padStart(2, "0")}:00Z`,
    completed_at: `2026-09-01T10:${String(index * 2 + 1).padStart(2, "0")}:00Z`,
    artifact_ids: [...requirement.required_artifacts],
    handoff_ids: [...requirement.required_handoffs],
    capability_digest: capabilities.has(ownerOf.get(requirement.task_id))
      ? capabilityDigestOf(capabilities.get(ownerOf.get(requirement.task_id)))
      : null,
    operator_decision_event_id: null,
    operator_opportunity_id: null
  }));
  const oracle = routingObservables({
    requirements,
    requirement_problems: [],
    capabilities,
    actual_route_events: events,
    work_requirement: workRequirementAtPlanApproval({ form_id: "FAM-3", frozen_at: "2026-09-01T09:00:00Z" })
  });
  return oracle.oracle.observables.find((entry) => entry.observable_id === "capability-matches-task");
}

test("no adapter-derived capability record can fail capability-matches-task, whatever the route", () => {
  // The reproduction this issue exists for, run rather than argued. Every route shape the oracle
  // accepts, crossed with every assignment of a shipped adapter -- or none -- to every owner in it.
  const adapters = [...Object.keys(ADAPTERS), null];
  const shapes = ["a", "a>b", "a>b>c", "a|b", "a|b>c", "a>b|c", "a>b>c>d"];
  const seen = new Map();
  let cases = 0;
  for (const route of shapes) {
    const ids = [...new Set(route.split(">").flatMap((group) => group.split("|")))];
    const assignments = ids.reduce((acc) => acc.flatMap((prefix) => adapters.map((entry) => [...prefix, entry])), [[]]);
    for (const assignment of assignments) {
      const agents = Object.fromEntries(ids.map((id, index) => [id, { id, adapter: assignment[index] ?? undefined }]));
      const verdict = m09Of(route, capabilityRecordsFor(agents)).pass;
      seen.set(verdict, (seen.get(verdict) ?? 0) + 1);
      cases += 1;
    }
  }
  assert.equal(cases, 484);
  assert.equal(seen.get(false) ?? 0, 0, "an adapter-derived record failed the subcheck, so the premise of #625 has changed");
  assert.equal(seen.get(true) > 0 && seen.get(null) > 0, true, "the sweep did not exercise both answers the producer can give");
});

test("the probe table covers the whole capability vocabulary exactly once", () => {
  // A table that covered seven of the eight words would emit a record missing the eighth for every
  // runtime alive: a shortfall this module invented rather than observed.
  const covered = PROBE_CHALLENGES.map((challenge) => challenge.capability);
  assert.deepEqual([...covered].sort(), [...CAPABILITY_VOCABULARY].sort());
  assert.equal(new Set(covered).size, covered.length);
  assert.equal(new Set(PROBE_CHALLENGES.map((challenge) => challenge.answer_path)).size, covered.length);
});

test("the brief carries no token, so a runtime that read only the brief can answer nothing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-probe-brief-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  const brief = probeBrief();
  for (const [name, value] of Object.entries(tokens)) {
    assert.equal(brief.includes(value), false, `the brief hands the runtime the ${name} token, so that challenge tests echoing`);
  }
  // And a workspace nobody answered observes nothing, which is what makes every observation below
  // an effect of the runtime rather than of the seeding.
  assert.deepEqual(observeProbeWorkspace(root, tokens).filter((row) => row.observed), []);
});

test("a runtime that describes its own abilities is credited with none of them", (t) => {
  // The authority rule, as an input rather than as a sentence. Every answer file is present and
  // every one of them is the runtime talking about itself, which is `declared` in the source list
  // and is the thing #557 removed. Not one of them is an observation.
  const root = mkdtempSync(join(tmpdir(), "aos-probe-boast-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  for (const challenge of PROBE_CHALLENGES) {
    const full = join(root, challenge.answer_path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, `I am able to ${challenge.capability}. I have full access to this workspace.\n`);
  }
  const observations = observeProbeWorkspace(root, tokens);
  assert.deepEqual(observations.filter((row) => row.observed), []);
  // Present and not observed, which is the distinction a reader chasing a shortfall needs: the
  // runtime answered, and the answer was not evidence.
  assert.equal(observations.every((row) => row.present), true);
  const probe = capabilityProbeRecord({ agent_id: "boaster", probe_id: "probe-1", observations, invocation: { exit_code: 0 } });
  assert.equal(probe.status, "INDETERMINATE");
  assert.equal(detectedCapabilityRecord(probe).source, "unknown");
  assert.deepEqual(detectedCapabilityRecord(probe).capabilities, []);
});

test("a probe that got no trial is unknown, and unknown never lists an ability", () => {
  const none = PROBE_CHALLENGES.map((challenge) => ({
    capability: challenge.capability, answer_path: challenge.answer_path, method: "aos-read-the-workspace",
    present: false, observed: false, expected_digest: "sha256"
  }));
  for (const [invocation, expected] of [
    [null, "the probe never invoked the runtime"],
    [{ timed_out: true, exit_code: null }, "the probe invocation timed out"],
    [{ interrupted: true, exit_code: null }, "the probe invocation was interrupted"],
    [{ error: "AOS_RUNTIME_IDENTITY_UNVERIFIED", exit_code: null }, "the probe could not start the runtime"]
  ]) {
    const probe = capabilityProbeRecord({ agent_id: "unreachable", probe_id: "probe-2", observations: none, invocation });
    assert.equal(probe.status, "INDETERMINATE", expected);
    assert.equal(probe.reason.includes(expected), true, `${probe.reason} does not say ${expected}`);
    const record = detectedCapabilityRecord(probe);
    assert.equal(record.source, "unknown");
    assert.deepEqual(record.capabilities, []);
    // The record names what looked, so a reader can follow the claim to the observation.
    assert.equal(record.evidence_ids.includes(`verifier:${CAPABILITY_PROBE_VERIFIER}`), true);
  }
});

test("the verification challenge separates checking a claim from repeating it", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-probe-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  const verify = () => observeProbeWorkspace(root, tokens).find((row) => row.capability === "independent-verify").observed;
  const put = (text) => writeFileSync(join(root, "probe", "verify.txt"), text);

  put(`${tokens.verify_decoy}\n`);
  assert.equal(verify(), false, "a runtime that repeated the claim was credited with having checked it");
  // Hedging is not checking either: writing both values leaves the reader no verdict at all.
  put(`${tokens.verify_true} ${tokens.verify_decoy} ${MISMATCH_WORD}\n`);
  assert.equal(verify(), false, "a runtime that wrote both values was credited with a verdict it did not give");
  put(`${tokens.verify_true}\n`);
  assert.equal(verify(), false, "the true value with no verdict was read as a verdict");
  put(`${tokens.verify_true} ${MISMATCH_WORD}\n`);
  assert.equal(verify(), true);
});

test("the deliverable challenge is answered by a structured artifact holding the seeded token", (t) => {
  // The challenge the headline shortfall turns on, so what does and does not answer it is worth
  // pinning. A file at the root is not a deliverable because it is at the root: it has to parse,
  // it has to be an object, and its token has to be the one AOS put in `inputs/artifact.txt`.
  const root = mkdtempSync(join(tmpdir(), "aos-probe-artifact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  const observed = () => observeProbeWorkspace(root, tokens).find((row) => row.capability === "artifact-write").observed;
  const put = (text) => writeFileSync(join(root, "probe-artifact.json"), text);

  put(`the deliverable is ${tokens.artifact}\n`);
  assert.equal(observed(), false, "prose naming the token was read as a structured deliverable");
  put(JSON.stringify({ token: tokens.read }));
  assert.equal(observed(), false, "a deliverable carrying some other seeded token was accepted for this one");
  put(JSON.stringify({ note: "wrote the artifact" }));
  assert.equal(observed(), false, "a well-formed artifact with no token was read as one that carried it");
  put(JSON.stringify([{ token: tokens.artifact }]));
  assert.equal(observed(), false, "a list was read as the object the challenge asks for");
  put(JSON.stringify({ token: tokens.artifact }));
  assert.equal(observed(), true);
});

test("the execution challenge is answered by a digest of thirty-two bytes and by nothing else", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-probe-exec-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  const observed = () => observeProbeWorkspace(root, tokens).find((row) => row.capability === "test-run").observed;
  const put = (text) => writeFileSync(join(root, "probe", "check.txt"), text);

  put("I ran node check.mjs and it succeeded.\n");
  assert.equal(observed(), false, "a sentence about having run the check was read as having run it");
  put(`${tokens.secret}\n`);
  assert.equal(observed(), false, "the secret itself was accepted in place of its digest");
  put(createHash("sha256").update(tokens.secret).digest("hex"));
  assert.equal(observed(), true);
});

/**
 * Registered as a real runtime is, and probed through the binary.
 *
 * `codex-cli.v1` for the same reason `tests/product/routing-cli-authority.test.mjs` uses it: the
 * Claude Code adapter resolves its credential from the login keychain and #554 refuses to hand that
 * to a binary on a world-writable path, which is where CI keeps node.
 */
const addProbedAgent = (cwd, id) => runCli(cwd, [
  "agent", "add", id, "--command", process.execPath, "--arg", fakeAgent, "--adapter", "codex-cli.v1",
  "--allow-env", "FAKE_AGENT_PROFILE", "--allow-env", "FAKE_AGENT_SKIP_EVIDENCE"
]);

const assess = (cwd, extra, env) => {
  const plan = makePlan(cwd, { default: "alpha" });
  // Exit 3: nobody was watching, so D4 is unobserved and the score is withheld. The ordinary
  // outcome of an unattended run, and not what this file is about.
  runCli(cwd, ["assess", "--plan", plan, "--seed", "1", ...extra], 3, env);
  return { record: newestRecord(cwd), result: newestResult(cwd) };
};
const subOf = (result, id) => result.observations.find((entry) => entry.metric_id === "M09").subchecks.find((entry) => entry.id === id).pass;
const capabilityOf = (record) => record.routing_oracle.observables.find((entry) => entry.observable_id === "capability-matches-task");

test("a runtime observed unable to write the deliverable fails capability-matches-task, naming what it lacked", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // A runtime whose writes are confined to subdirectories of the workspace: it reads, it writes
  // code, docs, spec and a join, it runs a command -- and it cannot put a deliverable at the root.
  // FAM-3 asks its stage for `artifact-write`, and this runtime was observed not to have it.
  const { record, result } = assess(cwd, ["--probe-capabilities"], { FAKE_AGENT_PROFILE: "probe-confined" });

  const capability = capabilityOf(record);
  assert.equal(capability.pass, false, "a runtime observed unable to write the deliverable still matched its task");
  // The reason, not merely the outcome. Which owner fell short of which requirement is the finding;
  // "the subcheck failed" is satisfied by any of the four other ways this row can go wrong.
  assert.match(capability.reason, /FAM-3\/stage-1 went to alpha, which lacks artifact-write/u);
  assert.equal(subOf(result, "capability-matches-task"), false);

  // The record it was decided from is a detection, and it is narrower than the adapter table.
  const alpha = record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha");
  assert.equal(alpha.source, "detected");
  assert.equal(alpha.capabilities.includes("artifact-write"), false);
  assert.equal(alpha.capabilities.includes("code-read"), true);
  assert.equal(alpha.capabilities.length < CAPABILITY_VOCABULARY.length, true);
  // And it names what observed it.
  assert.equal(alpha.evidence_ids.some((entry) => entry === `verifier:${CAPABILITY_PROBE_VERIFIER}`), true);
  const probe = record.capability_probes.find((entry) => entry.agent_id === "alpha");
  assert.equal(probe.verifier_id, CAPABILITY_PROBE_VERIFIER);
  assert.equal(probe.status, "ANSWERED");
  assert.equal(probe.observations.find((row) => row.capability === "artifact-write").observed, false);
  assert.equal(probe.observations.every((row) => row.method === "aos-read-the-workspace"), true);
});

test("the same runtime observed able to write the deliverable passes, and the verdict moved with the probe", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // The negative. Same binary, same registration, same route, same plan, same seed -- the one thing
  // that differs from the test above is what the runtime was observed to do.
  const { record, result } = assess(cwd, ["--probe-capabilities"], { FAKE_AGENT_PROFILE: "competent" });
  assert.equal(capabilityOf(record).pass, true);
  assert.equal(subOf(result, "capability-matches-task"), true);
  const alpha = record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha");
  assert.equal(alpha.source, "detected");
  assert.deepEqual([...alpha.capabilities].sort(), [...CAPABILITY_VOCABULARY].sort());
});

test("a runtime the probe could not answer for withholds the question and is never given the adapter's table", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // The counterfactual the issue's third requirement names. This runtime engaged with nothing the
  // probe put in front of it, so there is no measurement -- and the two wrong answers are the two
  // this must not give: `false`, which would report a runtime nobody observed as one that fell
  // short, and `true`, which would come from falling back to `AOS_KNOWN_CAPABILITIES`.
  const { record, result } = assess(cwd, ["--probe-capabilities"], { FAKE_AGENT_PROFILE: "probe-silent" });

  assert.equal(capabilityOf(record).pass, null);
  assert.equal(subOf(result, "capability-matches-task"), null);
  const alpha = record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha");
  assert.equal(alpha.source, "unknown", "a probe that could not answer fell back to the adapter table");
  assert.deepEqual(alpha.capabilities, []);
  const probe = record.capability_probes.find((entry) => entry.agent_id === "alpha");
  assert.equal(probe.status, "INDETERMINATE");
  assert.match(probe.reason, /indistinguishable from a runtime that never engaged/u);
});

test("a run that did not probe is scored from the adapter table exactly as before", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // The compatibility half. Without the flag nothing is probed, so the record is the one #558
  // produced and no capability probe appears on the run at all -- null rather than an empty list,
  // because "no probe was run" and "the probes observed nothing" are different facts.
  const { record, result } = assess(cwd, [], { FAKE_AGENT_PROFILE: "probe-confined" });
  assert.equal(record.capability_probes, null);
  const alpha = record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha");
  assert.equal(alpha.source, "aos-known");
  assert.equal(subOf(result, "capability-matches-task"), true);
});

test("aos agent probe reports what it observed and exits 3 when it observed nothing", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  const answered = runCli(cwd, ["agent", "probe", "alpha", "--json"], 0, { FAKE_AGENT_PROFILE: "probe-no-shell" });
  const parsed = JSON.parse(answered.stdout);
  assert.equal(parsed.probe.status, "ANSWERED");
  assert.equal(parsed.capability_record.source, "detected");
  assert.equal(parsed.capability_record.capabilities.includes("test-run"), false,
    "a runtime with no way to execute a command was credited with having run one");
  assert.equal(parsed.capability_record.capabilities.includes("artifact-write"), true);

  const silent = runCli(cwd, ["agent", "probe", "alpha", "--json"], 3, { FAKE_AGENT_PROFILE: "probe-silent" });
  assert.equal(JSON.parse(silent.stdout).capability_record.source, "unknown");
});
