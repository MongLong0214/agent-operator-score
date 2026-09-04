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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CAPABILITY_PROBE_VERIFIER,
  CLAIM_AGREES_WORD,
  CLAIM_DIFFERS_WORD,
  PROBE_CHALLENGES,
  VERIFY_CLAIM_COUNT,
  VERIFY_WRONG_SETS,
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

test("the verification challenge separates checking a claim from asserting a verdict", (t) => {
  // Round 1, G-04. The first version seeded one claim and it was always wrong, so `MISMATCH` was
  // the correct answer on every probe that would ever run: a runtime could copy the file's own
  // value, append the word, never open the claim, and earn `independent-verify`. The word on the
  // record was then wider than what was observed, and a wider record is a shortfall nobody notices.
  //
  // There is now a negative control. Six claims, exactly two wrong, positions drawn per probe --
  // so the assertions below are about the *reason* a strategy fails: it gave the same verdict to a
  // true claim and a false one.
  const root = mkdtempSync(join(tmpdir(), "aos-probe-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  const verify = () => observeProbeWorkspace(root, tokens).find((row) => row.capability === "independent-verify").observed;
  const put = (lines) => writeFileSync(join(root, "probe", "verify.txt"), lines.join("\n"));
  const truth = (index) => tokens[`verify_${index}`];
  const claimed = (index) => JSON.parse(readFileSync(join(root, "claims.json"), "utf8"))[index - 1].claimed_value;
  const each = (verdictOf, valueOf = truth) =>
    Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => `claim-${offset + 1}: ${valueOf(offset + 1)} ${verdictOf(offset + 1)}`);

  // Exactly two of the six are misstated, so the seeding itself has a negative control in it.
  const wrong = Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => offset + 1)
    .filter((index) => claimed(index) !== truth(index));
  assert.equal(wrong.length, 2, "the seeding did not put up two wrong claims, so an unconditional verdict could be right");
  assert.deepEqual(wrong, [...tokens.verify_wrong_claims]);

  put(each(() => CLAIM_DIFFERS_WORD));
  assert.equal(verify(), false, "a runtime that called every claim wrong was credited with having compared them");
  put(each(() => CLAIM_AGREES_WORD));
  assert.equal(verify(), false, "a runtime that called every claim right was credited with having compared them");
  put(each(() => CLAIM_AGREES_WORD, claimed));
  assert.equal(verify(), false, "a runtime that repeated the claims was credited with having checked them");
  // The hedge: the true value and the claimed one together is not a verdict.
  put(each((index) => (wrong.includes(index) ? CLAIM_DIFFERS_WORD : CLAIM_AGREES_WORD),
    (index) => (wrong.includes(index) ? `${truth(index)} ${claimed(index)}` : truth(index))));
  assert.equal(verify(), false, "a runtime that wrote both the true and the claimed value was credited with a verdict");
  // Right values, right verdicts, one claim left unanswered.
  put(each((index) => (wrong.includes(index) ? CLAIM_DIFFERS_WORD : CLAIM_AGREES_WORD)).slice(1));
  assert.equal(verify(), false, "a runtime that answered five of six claims was credited for the one it skipped");

  put(each((index) => (wrong.includes(index) ? CLAIM_DIFFERS_WORD : CLAIM_AGREES_WORD)));
  assert.equal(verify(), true);
});

test("a runtime that compares always earns the verification word and one that guesses mostly does not", () => {
  // The property the negative control has to have in both directions. A challenge whose randomness
  // could fail a capable runtime would manufacture a shortfall, which is the class this whole
  // module exists to refuse; a challenge a guesser passes measures compliance rather than ability.
  const seedings = 90;
  let comparer = 0;
  let asserted = 0;
  const positions = new Set();
  for (let round = 0; round < seedings; round += 1) {
    const root = mkdtempSync(join(tmpdir(), "aos-probe-verify-sweep-"));
    const tokens = probeTokens();
    seedProbeWorkspace(root, tokens);
    positions.add(String(tokens.verify_wrong_claims));
    const claims = JSON.parse(readFileSync(join(root, "claims.json"), "utf8"));
    const truth = (index) => tokens[`verify_${index}`];
    const put = (verdictOf) => writeFileSync(join(root, "probe", "verify.txt"),
      Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => `claim-${offset + 1}: ${truth(offset + 1)} ${verdictOf(offset + 1)}`).join("\n"));
    const observed = () => observeProbeWorkspace(root, tokens).find((row) => row.capability === "independent-verify").observed;

    put((index) => (claims[index - 1].claimed_value === truth(index) ? CLAIM_AGREES_WORD : CLAIM_DIFFERS_WORD));
    if (observed()) comparer += 1;
    put(() => CLAIM_DIFFERS_WORD);
    if (observed()) asserted += 1;
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(comparer, seedings, "a runtime that compared every claim was refused the word on some seeding, so the challenge is noisy against a capable runtime");
  assert.equal(asserted, 0, "a runtime that asserted one verdict for every claim earned the word");
  assert.equal(positions.size > 1, true, "every seeding put the wrong claims in the same place, so the position is learnable");
  assert.equal(VERIFY_WRONG_SETS.length, 15);
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

test("a trial cut off part way through withholds the question and never scores what it did not reach", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // Round 1, O-03/G-02/G-03, end to end. The runtime answers three of the eight items and then
  // dies the way a provider-quota failure dies: a 429 on stderr, exit 1, five items never
  // attempted. Before the fix this published `detected` with three capabilities and a `false` on
  // `capability-matches-task` naming artifact-write -- an operator scored for the probe's own
  // plumbing, which is the defect this issue exists to remove.
  const { record, result } = assess(cwd, ["--probe-capabilities"], { FAKE_AGENT_PROFILE: "probe-cut-off" });

  const capability = capabilityOf(record);
  assert.equal(capability.pass, null, "a runtime that stopped part way was scored as one that fell short");
  assert.equal(subOf(result, "capability-matches-task"), null);
  // The reason the row was withheld, not merely that it was. The two wrong answers this pins are
  // `false` -- a shortfall the probe manufactured -- and `true`, which would mean the record fell
  // back to the adapter table.
  assert.match(capability.reason, /AOS holds no capability record it may score for alpha/u);

  const alpha = record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha");
  assert.equal(alpha.source, "unknown");
  assert.deepEqual(alpha.capabilities, []);

  const probe = record.capability_probes.find((entry) => entry.agent_id === "alpha");
  assert.equal(probe.status, "INDETERMINATE");
  // Withheld because the trial did not finish -- not because the workspace was empty. The runtime
  // did answer three items, and the record has to say which of the two absences this was.
  assert.match(probe.reason, /exited 1 before the trial finished, so the items it did not reach were never asked/u);
  assert.equal(probe.invocation.completed, false);
  assert.equal(probe.invocation.exit_code, 1);
  assert.equal(probe.observations.filter((row) => row.observed).length, 3,
    "the fixture no longer answers three items, so this test no longer distinguishes a cut-off trial from an empty one");
  assert.deepEqual(probe.exhibited, [], "a cut-off trial published the abilities it happened to reach");
});

test("every way a trial can fail to complete withholds alike", () => {
  // The class, not the four field names. `runProcess` answers "did this run to completion" in one
  // field, and reading that rather than re-deriving it is what makes a termination mode added to
  // `lib/core.mjs` later reach this control on the day it is added.
  const observations = PROBE_CHALLENGES.map((challenge, index) => ({
    capability: challenge.capability, answer_path: challenge.answer_path, method: "aos-read-the-workspace",
    present: index < 3, observed: index < 3, expected_digest: "sha256"
  }));
  const shapes = [
    ["a clean run", { ok: true, exit_code: 0 }, "ANSWERED"],
    ["a non-zero exit", { ok: false, exit_code: 1 }, "INDETERMINATE"],
    ["a signal kill", { ok: false, exit_code: null, signal: "SIGKILL" }, "INDETERMINATE"],
    ["a timeout", { ok: false, exit_code: null, timed_out: true }, "INDETERMINATE"],
    ["an interrupt", { ok: false, exit_code: null, interrupted: true }, "INDETERMINATE"],
    ["a surviving descendant", { ok: false, exit_code: 0, survivor: true }, "INDETERMINATE"],
    ["a leaked descendant", { ok: false, exit_code: 0, leaked_descendants: true }, "INDETERMINATE"],
    ["a refused spawn", { ok: false, exit_code: null, error: "AOS_RUNTIME_IDENTITY_UNVERIFIED" }, "INDETERMINATE"],
    // An invocation that does not say it completed has not said it completed. The control is
    // positive, so a caller cannot reach ANSWERED by leaving the field out.
    ["an invocation that claims nothing", { exit_code: 0 }, "INDETERMINATE"]
  ];
  for (const [label, invocation, expected] of shapes) {
    const probe = capabilityProbeRecord({ agent_id: "alpha", probe_id: "probe-3", observations, invocation });
    assert.equal(probe.status, expected, `${label} was ${probe.status}`);
    const record = detectedCapabilityRecord(probe);
    assert.equal(record.source, expected === "ANSWERED" ? "detected" : "unknown", label);
    assert.deepEqual(record.capabilities.length, expected === "ANSWERED" ? 3 : 0, label);
  }
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

test("a fixture runtime that does not compare loses the verification word and keeps the other seven", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // Both non-comparing fixture profiles, exercised rather than merely declared. Round 1 noted that
  // `probe-credulous` existed and no test ran it, which is a claim with no test behind it.
  for (const [profile, why] of [
    ["probe-credulous", "a runtime that repeated the claims it was handed"],
    ["probe-unchecked", "a runtime that asserted one verdict for every claim without comparing"]
  ]) {
    const probed = runCli(cwd, ["agent", "probe", "alpha", "--json"], 0, { FAKE_AGENT_PROFILE: profile });
    const { capability_record: record, probe } = JSON.parse(probed.stdout);
    assert.equal(probe.status, "ANSWERED", profile);
    assert.equal(record.capabilities.includes("independent-verify"), false, `${why} was credited with having verified`);
    // Everything else it did do is still on the record: the withheld word is the one it did not earn.
    assert.equal(record.capabilities.length, CAPABILITY_VOCABULARY.length - 1, profile);
    assert.equal(probe.observations.find((row) => row.capability === "independent-verify").present, true,
      `${profile} wrote no answer at all, so this no longer distinguishes a wrong answer from a missing one`);
  }
});

test("an answer path that resolves outside the workspace is not an answer", (t) => {
  // Round 1, G-06. `lstat` covers the final component only, so the answer path itself was refused
  // as a link and `probe -> <somewhere else>` was not: the parent is resolved by the kernel before
  // lstat sees the leaf. Nothing left the process even then, but the docstring claimed the stronger
  // property, so the whole resolved path is now bounded to the workspace.
  const root = mkdtempSync(join(tmpdir(), "aos-probe-escape-"));
  const outside = mkdtempSync(join(tmpdir(), "aos-probe-outside-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);

  // The correct answer, at the correct relative path -- but the directory holding it is elsewhere.
  mkdirSync(join(outside, "probe"), { recursive: true });
  writeFileSync(join(outside, "probe", "read.txt"), tokens.read);
  rmSync(join(root, "probe"), { recursive: true, force: true });
  symlinkSync(join(outside, "probe"), join(root, "probe"));

  const row = observeProbeWorkspace(root, tokens).find((entry) => entry.capability === "code-read");
  assert.equal(row.present, false, "a file reached through a redirected parent directory was read as an answer");
  assert.equal(row.observed, false);
  // And the published path is still this module's own relative string, never the resolved one.
  assert.equal(row.answer_path, "probe/read.txt");
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
