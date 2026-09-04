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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "../../lib/core.mjs";
import {
  CAPABILITY_PROBE_VERIFIER,
  CLAIM_AGREES_WORD,
  CLAIM_DIFFERS_WORD,
  PROBE_CHALLENGES,
  CAPABILITY_PROBE_GENERATIONS,
  CAPABILITY_PROBE_PREDATES,
  CAPABILITY_PROBE_SCHEMA,
  VERIFY_CLAIM_COUNT,
  VERIFY_WRONG_SETS,
  capabilityProbeGeneration,
  capabilityProbeRecord,
  detectedCapabilityRecord,
  observeProbeWorkspace,
  probeBrief,
  probeTokens,
  seedProbeWorkspace
} from "../../lib/capability-probe.mjs";
import { evaluate, loadEcdContract, sealEcdContract } from "../../lib/ecd-contract.mjs";
import { ADAPTERS } from "../../lib/profile.mjs";
import { renderProfileTerminal } from "../../lib/profile-report.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import {
  ACTUAL_ROUTE_EVENT_SCHEMA,
  CAPABILITY_VOCABULARY,
  capabilityDigestOf,
  capabilityRecord,
  capabilityRecordsFor,
  requirementsFromRoute,
  routingObservables,
  workRequirementAtPlanApproval
} from "../../lib/routing-oracle.mjs";
import { spawnSync } from "node:child_process";

import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";
import { cli, fakeAgent, initBare, makePlan, newestRecord, newestResult, run as runCli } from "./helpers.mjs";

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
function routingFor(route, capabilities) {
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
  return routingObservables({
    requirements,
    requirement_problems: [],
    capabilities,
    actual_route_events: events,
    work_requirement: workRequirementAtPlanApproval({ form_id: "FAM-3", frozen_at: "2026-09-01T09:00:00Z" })
  });
}

const m09Of = (route, capabilities) =>
  routingFor(route, capabilities).oracle.observables.find((entry) => entry.observable_id === "capability-matches-task");

test("adapter-derived capability records withhold capability-matches-task, whatever the route", () => {
  // Every route shape the oracle accepts, crossed with every assignment of a shipped adapter -- or
  // none -- to every owner in it. This was the RED baseline for #558's last condition: before the
  // provenance boundary, all 484 cases were either true or null and none could be false, because
  // the requirement and every scorable adapter record came from AOS's vocabulary. `aos-known` must
  // now be null instead: it says what AOS knows of an adapter, not what this runtime has exhibited.
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
  assert.equal(seen.get(true) ?? 0, 0, "an adapter-derived record answered the runtime capability question");
  assert.equal(seen.get(null), cases, "an adapter-derived record did not withhold the runtime capability question");
});

test("the probe table covers the whole capability vocabulary exactly once", () => {
  // A table that covered seven of the eight words would emit a record missing the eighth for every
  // runtime alive: a shortfall this module invented rather than observed.
  const covered = PROBE_CHALLENGES.map((challenge) => challenge.capability);
  assert.deepEqual([...covered].sort(), [...CAPABILITY_VOCABULARY].sort());
  assert.equal(new Set(covered).size, covered.length);
  assert.equal(new Set(PROBE_CHALLENGES.map((challenge) => challenge.answer_path)).size, covered.length);
});

test("the brief and the seeded workspace name the same paths PROBE_CHALLENGES does", () => {
  // Round 1 of #627's G-07: `probeBrief()` hardcodes all eight answer paths and the seven input
  // filenames as prose, and `seedProbeWorkspace` hardcodes the same filenames again to write them --
  // both restatements of `PROBE_CHALLENGES`, and neither was bound to it by anything. Agreeing today
  // is not the same as being unable to disagree tomorrow: an edit that moved a `challenge.answer_path`
  // without updating the brief would make every runtime alive fail that challenge, and AOS would
  // publish a shortfall it invented -- the one outcome this module says it must never produce --
  // with no test failing. This is that test.
  const brief = probeBrief();
  for (const challenge of PROBE_CHALLENGES) {
    assert.equal(brief.includes(challenge.answer_path), true,
      `the brief no longer names ${challenge.answer_path}, the answer path for ${challenge.capability}`);
  }
  // The seven input files the brief tells the runtime to read from, independently of the six
  // `verify-N.txt` files (checked by their own count elsewhere): one per non-verification challenge,
  // plus the three join inputs.
  const inputFiles = [
    "inputs/artifact.txt", "inputs/code.txt", "inputs/doc.txt", "inputs/spec.txt",
    "inputs/join-one.txt", "inputs/join-two.txt", "inputs/join-three.txt"
  ];
  for (const file of inputFiles) {
    assert.equal(brief.includes(file), true, `the brief no longer names ${file}, which seedProbeWorkspace writes`);
  }
  const root = mkdtempSync(join(tmpdir(), "aos-probe-binding-"));
  try {
    const tokens = probeTokens();
    const seeded = seedProbeWorkspace(root, tokens);
    // What the seeding actually wrote agrees with what the challenge table expects to read, for
    // every entry -- not just the ones this test happened to name above.
    assert.deepEqual([...seeded.seeded].sort(), PROBE_CHALLENGES.map((challenge) => challenge.answer_path).sort());
    for (const file of inputFiles) assert.equal(existsSync(join(root, file)), true, `seedProbeWorkspace did not write ${file}`);
    for (let index = 1; index <= VERIFY_CLAIM_COUNT; index += 1) {
      assert.equal(existsSync(join(root, `inputs/verify-${index}.txt`)), true, `seedProbeWorkspace did not write inputs/verify-${index}.txt`);
      assert.equal(brief.includes(`inputs/verify-${index}.txt`) || brief.includes("verify-N.txt"), true,
        `the brief no longer names inputs/verify-${index}.txt or its verify-N.txt pattern`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the reported-not-gating mitigation's restatement of capability-registry-is-coarse's status agrees with the field it restates", () => {
  // #627 round 2's G-07, the fourth site: three restatements of `PROBE_CHALLENGES` were bound above
  // and in "the probe table covers the whole capability vocabulary exactly once"; this is the one
  // the reviewer found still unbound. `reported-not-gating`'s mitigation prose describes
  // `capability-registry-is-coarse`'s status in a sentence of its own. The default-path change
  // below moves that rival to CONTROLLED, so this test keeps the two contract entries in lockstep.
  const contract = loadEcdContract();
  const cell = contract.cells.cells.find((one) => one.cell_id === "C2.RF.01");
  const capabilityRegistryIsCoarse = cell.rival_explanations.find((one) => one.id === "capability-registry-is-coarse");
  const reportedNotGating = cell.rival_explanations.find((one) => one.id === "reported-not-gating");
  // Only the statuses this sentence has actually been written for -- not the whole cell schema
  // enum. `OPEN` has no prose on file because the shipped contract has never said it; a future edit
  // that moved the field to `OPEN` should fail here with a message that says so, not pass against a
  // guessed sentence nobody wrote or checked. Matched by a phrase rather than the whole sentence, so
  // a rewording that keeps the meaning does not fail this test, but a status change that keeps the
  // old wording does.
  const RESTATEMENT_FOR_STATUS = Object.freeze({
    PARTIALLY_MITIGATED: "now partially mitigated rather than open",
    CONTROLLED: "now controlled"
  });
  const expected = RESTATEMENT_FOR_STATUS[capabilityRegistryIsCoarse.status];
  assert.notEqual(expected, undefined, `no restatement is on file for status ${capabilityRegistryIsCoarse.status}; add one before shipping it`);
  assert.equal(reportedNotGating.mitigation.includes(expected), true,
    `reported-not-gating's mitigation no longer says "${expected}", which is what it must say while capability-registry-is-coarse's status is ${capabilityRegistryIsCoarse.status}`);
  // The other direction too: it must not still carry a different status's phrase, which is the
  // shape an edit that changed the field and forgot the sentence would actually take.
  for (const [status, phrase] of Object.entries(RESTATEMENT_FOR_STATUS)) {
    if (status === capabilityRegistryIsCoarse.status) continue;
    assert.equal(reportedNotGating.mitigation.includes(phrase), false,
      `reported-not-gating's mitigation still carries the ${status} restatement "${phrase}" while the field says ${capabilityRegistryIsCoarse.status}`);
  }
});

test("the brief carries no token, so a runtime that read only the brief can answer nothing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "aos-probe-brief-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  const brief = probeBrief();
  for (const [name, value] of Object.entries(tokens)) {
    // The tokens are the hex strings. `verify_wrong_claims` is a set of small positions rather than
    // a token, and it is checked below on its own terms -- a substring test would match the "1" in
    // "claim-1" and report a leak that is not one.
    if (typeof value !== "string") continue;
    assert.equal(brief.includes(value), false, `the brief hands the runtime the ${name} token, so that challenge tests echoing`);
  }
  assert.equal(Array.isArray(tokens.verify_wrong_claims), true);
  // And the one non-token the seeding draws is not disclosed either: the brief has to tell the
  // runtime that it is not being told how many claims are wrong, because a stated count is a prior
  // an answer can be built on without comparing anything.
  assert.match(brief, /you are not told how many/u);
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
  // The seeded half of the same property, against a real workspace rather than a constructed token
  // set: what the runtime is actually handed, and what AOS actually reads back.
  const root = mkdtempSync(join(tmpdir(), "aos-probe-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tokens = probeTokens();
  seedProbeWorkspace(root, tokens);
  const verify = () => observeProbeWorkspace(root, tokens).find((row) => row.capability === "independent-verify").observed;
  const put = (lines) => writeFileSync(join(root, "probe", "verify.txt"), lines.join("\n"));
  const claims = JSON.parse(readFileSync(join(root, "claims.json"), "utf8"));
  const truth = (index) => tokens[`verify_${index}`];
  const claimed = (index) => claims[index - 1].claimed_value;
  const wrong = Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => offset + 1)
    .filter((index) => claimed(index) !== truth(index));
  const each = (lineOf) => Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => lineOf(offset + 1));

  // The seeding itself has a negative control in it, and it is not always the same size.
  assert.equal(wrong.length >= 1 && wrong.length <= 4, true, "the seeding put up no wrong claim, so an unconditional AGREES would be right");
  assert.deepEqual(wrong, [...tokens.verify_wrong_claims]);

  put(each((index) => `claim-${index}: ${truth(index)} ${CLAIM_DIFFERS_WORD}`));
  assert.equal(verify(), false, "a runtime that called every claim wrong was credited with having compared them");
  put(each((index) => `claim-${index}: ${truth(index)} ${CLAIM_AGREES_WORD}`));
  assert.equal(verify(), false, "a runtime that called every claim right was credited with having compared them");
  put(each((index) => `claim-${index}: ${claimed(index)} ${CLAIM_AGREES_WORD}`));
  assert.equal(verify(), false, "a runtime that repeated the claims was credited with having checked them");
  // The verdicts right, but with no report of what was claimed: this is the answer a runtime that
  // never opened claims.json would give if it happened to guess the wrong set correctly.
  put(each((index) => `claim-${index}: ${truth(index)} ${wrong.includes(index) ? CLAIM_DIFFERS_WORD : CLAIM_AGREES_WORD}`));
  assert.equal(verify(), false, "a correct verdict with no claimed value was accepted, so guessing the wrong set is enough again");
  // A claimed value on a line whose claim was right is not a report, it is a hedge.
  put(each((index) => (wrong.includes(index)
    ? `claim-${index}: ${truth(index)} ${claimed(index)} ${CLAIM_DIFFERS_WORD}`
    : `claim-${index}: ${truth(index)} ${claimed(wrong[0])} ${CLAIM_AGREES_WORD}`)));
  assert.equal(verify(), false, "another claim's stated value on an AGREES line was read as a verdict");
  // The right values on every line and the verdicts the wrong way round. This is what the verdict
  // check is for, now that the claimed-value binding carries most of the weight: a runtime with all
  // the evidence in hand can still be wrong about what it means.
  put(each((index) => (wrong.includes(index)
    ? `claim-${index}: ${truth(index)} ${claimed(index)} ${CLAIM_AGREES_WORD}`
    : `claim-${index}: ${truth(index)} ${CLAIM_DIFFERS_WORD}`)));
  assert.equal(verify(), false, "a runtime that reported every claim's opposite verdict was credited with comparing them");
  // One claim left unanswered is not six answers.
  put(each((index) => (wrong.includes(index)
    ? `claim-${index}: ${truth(index)} ${claimed(index)} ${CLAIM_DIFFERS_WORD}`
    : `claim-${index}: ${truth(index)} ${CLAIM_AGREES_WORD}`)).slice(1));
  assert.equal(verify(), false, "a runtime that skipped a claim was credited for it");

  put(each((index) => (wrong.includes(index)
    ? `claim-${index}: ${truth(index)} ${claimed(index)} ${CLAIM_DIFFERS_WORD}`
    : `claim-${index}: ${truth(index)} ${CLAIM_AGREES_WORD}`)));
  assert.equal(verify(), true);
});

test("the probe record's schema identity moves when the record's meaning does", () => {
  // The final review's R-01. The O-03 hunk took the persisted `invocation` projection from four
  // fields to eight and the G-04 hunk changed what `independent-verify` witnesses, while the schema
  // id stayed `aos-capability-probe.v1` -- so two records with different evidentiary meanings shared
  // one identity, and `lib/cli.mjs` persists both into `record.json`. The module states the rule it
  // was breaking: "A field moving means a new schema id."
  assert.equal(CAPABILITY_PROBE_SCHEMA, "aos-capability-probe.v3");
  // Bound, not merely equal by coincidence: this module is the only thing that writes this record
  // and the only thing that decides it, so a verifier that kept its old name while the record moved
  // would claim the authority had not changed when its instrument had.
  assert.equal(CAPABILITY_PROBE_VERIFIER, CAPABILITY_PROBE_SCHEMA);
  const emitted = capabilityProbeRecord({
    agent_id: "alpha", probe_id: "probe-9", observations: [], invocation: { ok: true, exit_code: 0 }
  });
  assert.equal(emitted.schema_id, CAPABILITY_PROBE_SCHEMA);
  assert.equal(emitted.verifier_id, CAPABILITY_PROBE_VERIFIER);

  // The superseded generation is kept and named, not dropped: a record from the earlier build reads
  // as a version this build has heard of, with a sentence true of that record.
  assert.deepEqual([...CAPABILITY_PROBE_GENERATIONS], ["aos-capability-probe.v1", "aos-capability-probe.v2", "aos-capability-probe.v3"]);
  const old = capabilityProbeGeneration({ schema_id: "aos-capability-probe.v1" });
  assert.equal(old.generation, "SUPERSEDED");
  // The sentence has to say what is different about *that* record, so a reader knows which of the
  // two things they are holding.
  assert.match(old.predates, /before the withholding control read whether the trial completed/u);
  assert.match(old.predates, /constant, so that word does not witness a comparison/u);
  const prior = capabilityProbeGeneration({ schema_id: "aos-capability-probe.v2" });
  assert.equal(prior.generation, "SUPERSEDED");
  assert.match(prior.predates, /before retryability, the AOS-observed blocker class/u);
  assert.equal(CAPABILITY_PROBE_PREDATES[CAPABILITY_PROBE_SCHEMA], undefined, "the current generation was described as superseding itself");

  assert.equal(capabilityProbeGeneration(emitted).generation, "CURRENT");
  // And a generation this build has never heard of is named as unknown rather than accused of
  // forging one or quietly read as current.
  for (const unknown of [{ schema_id: "aos-capability-probe.v9" }, { schema_id: null }, {}, null]) {
    assert.equal(capabilityProbeGeneration(unknown).generation, "UNKNOWN");
    assert.equal(capabilityProbeGeneration(unknown).predates, null);
  }
});

test("C2.RF.01 requires all of its declared opportunities", () => {
  const contract = JSON.parse(JSON.stringify(loadEcdContract()));
  const routingFitness = contract.cells.cells.find((cell) => cell.cell_id === "C2.RF.01");
  assert.equal(routingFitness.minimum_opportunities, 3);
  assert.equal(routingFitness.subcheck_ids.length, 3);
  routingFitness.minimum_opportunities = 1;
  assert.throws(() => sealEcdContract(contract), /minimum-basis-mismatch/u);
});

test("no answer that skips claims.json is accepted, for any wrong set and any fixed strategy", () => {
  // The final review's finding, and the test whose absence is why two rounds passed the defect.
  //
  // The previous instrument measured the best non-comparing strategy at 1 in 15 and both the
  // implementer and the reviewer read that as an acceptable floor. It was not a floor, it was a
  // live path: read the six truth files, never open `claims.json`, always answer that claims 1 and
  // 2 differ, and earn `independent-verify` on every probe where those two happen to be the wrong
  // ones. The word was then recorded for a runtime that compared nothing.
  //
  // The fix is structural rather than statistical, so this test is exhaustive rather than sampled:
  // a DIFFERS verdict has to carry the value `claims.json` stated, that value exists only in that
  // file, and so no strategy that did not read it can produce a valid line. Every wrong set crossed
  // with every fixed-position strategy is 56 x 56, and the expected count is zero -- not small.
  const verify = PROBE_CHALLENGES.find((entry) => entry.capability === "independent-verify");
  const tokensFor = (wrong) => {
    const built = { verify_wrong_claims: wrong };
    for (let index = 1; index <= VERIFY_CLAIM_COUNT; index += 1) built[`verify_${index}`] = `truth-${index}-0123456789abcdef`;
    wrong.forEach((_, offset) => { built[`verify_decoy_${offset + 1}`] = `decoy-${offset + 1}-fedcba9876543210`; });
    return built;
  };
  const claimedOf = (tokens, index) => (tokens.verify_wrong_claims.includes(index)
    ? tokens[`verify_decoy_${tokens.verify_wrong_claims.indexOf(index) + 1}`]
    : tokens[`verify_${index}`]);
  const answer = (tokens, lineOf) =>
    Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => lineOf(tokens, offset + 1)).join("\n");

  let comparer = 0;
  let fixedAccepted = 0;
  let fixedTried = 0;
  let pasted = 0;
  let credulous = 0;
  for (const wrong of VERIFY_WRONG_SETS) {
    const tokens = tokensFor(wrong);
    // A runtime that compares carries the claimed value exactly where the claim was wrong.
    if (verify.answered(answer(tokens, (held, index) => (wrong.includes(index)
      ? `claim-${index}: ${held[`verify_${index}`]} ${claimedOf(held, index)} ${CLAIM_DIFFERS_WORD}`
      : `claim-${index}: ${held[`verify_${index}`]} ${CLAIM_AGREES_WORD}`)), tokens)) comparer += 1;

    // Every fixed-position strategy there is. It has the truth values -- it had to read those to
    // answer at all -- and no claimed value, because it never opened the file that holds them.
    for (const guess of VERIFY_WRONG_SETS) {
      fixedTried += 1;
      if (verify.answered(answer(tokens, (held, index) =>
        `claim-${index}: ${held[`verify_${index}`]} ${guess.includes(index) ? CLAIM_DIFFERS_WORD : CLAIM_AGREES_WORD}`), tokens)) {
        fixedAccepted += 1;
      }
    }

    // And two strategies that did open the file but still did not compare.
    const everyClaimed = Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => claimedOf(tokens, offset + 1)).join(" ");
    if (verify.answered(answer(tokens, (held, index) =>
      `claim-${index}: ${held[`verify_${index}`]} ${everyClaimed} ${CLAIM_DIFFERS_WORD}`), tokens)) pasted += 1;
    if (verify.answered(answer(tokens, (held, index) =>
      `claim-${index}: ${claimedOf(held, index)} ${CLAIM_AGREES_WORD}`), tokens)) credulous += 1;
  }

  assert.equal(VERIFY_WRONG_SETS.length, 56, "the wrong sets are no longer every non-empty subset of at most four");
  assert.equal(comparer, VERIFY_WRONG_SETS.length,
    "a runtime that compared every claim was refused on some seeding, so the challenge is noisy against a capable runtime");
  assert.equal(fixedTried, VERIFY_WRONG_SETS.length ** 2);
  // Zero, not small. A rate here would mean the word can still be earned without comparing.
  assert.equal(fixedAccepted, 0,
    "a runtime that never opened claims.json and named a fixed set of claims as wrong earned independent-verify");
  assert.equal(pasted, 0, "a runtime that copied every stated value onto every line earned independent-verify");
  assert.equal(credulous, 0, "a runtime that repeated the claims earned independent-verify");
});

test("a fixed guess that also carries the claimed value is accepted at 1/VERIFY_WRONG_SETS.length, not zero", () => {
  // Round 2 of #627's O-02/P-01: the exhaustive test above proves the class that made the previous
  // instrument's 1-in-15 a live path is gone -- a strategy that never opens `claims.json` earns
  // nothing, at any wrong set, at any fixed guess. It does not prove independent-verify has no
  // guessing residual at all, because it never gives its fixed-guess strategy the one thing
  // `claims.json` actually hands out: the exact value to paste. This test gives it that, which is
  // the strategy the docstring above `CLAIM_AGREES_WORD` now says is not closed -- a runtime that
  // opened claims.json and every truth file, fixed which six positions it would call DIFFERS
  // *before* comparing anything and never compares, and pastes whatever claims.json stated at each
  // position it decided to mark. It cannot be told apart from a real comparer by the shape of its
  // answer; it is told apart only by being wrong at any position where its fixed guess disagrees
  // with the actual wrong set, which is every draw except the one where the guess is exactly right.
  //
  // Twice before, this exact number (first as 1/15, then as 1/56) was reported by a human reader as
  // "effectively zero" or "closed by construction" without this test existing to say otherwise. It
  // exists now so the claim and the mechanism cannot drift apart silently again: if `VERIFY_CLAIM_COUNT`
  // or `VERIFY_WRONG_SETS` ever change, this assertion moves with them, and the docstring's stated
  // bound has to move too, in the same commit.
  const verify = PROBE_CHALLENGES.find((entry) => entry.capability === "independent-verify");
  const tokensFor = (wrong) => {
    const built = { verify_wrong_claims: wrong };
    for (let index = 1; index <= VERIFY_CLAIM_COUNT; index += 1) built[`verify_${index}`] = `truth-${index}-0123456789abcdef`;
    wrong.forEach((_, offset) => { built[`verify_decoy_${offset + 1}`] = `decoy-${offset + 1}-fedcba9876543210`; });
    return built;
  };
  const claimedOf = (tokens, index) => (tokens.verify_wrong_claims.includes(index)
    ? tokens[`verify_decoy_${tokens.verify_wrong_claims.indexOf(index) + 1}`]
    : tokens[`verify_${index}`]);

  let accepted = 0;
  let tried = 0;
  for (const wrong of VERIFY_WRONG_SETS) {
    const tokens = tokensFor(wrong);
    // Every fixed-position strategy there is, this time pasting claims.json's own stated value --
    // read, not derived from a comparison -- at every position the guess marks DIFFERS.
    for (const guess of VERIFY_WRONG_SETS) {
      tried += 1;
      const answer = Array.from({ length: VERIFY_CLAIM_COUNT }, (_, offset) => {
        const index = offset + 1;
        return guess.includes(index)
          ? `claim-${index}: ${tokens[`verify_${index}`]} ${claimedOf(tokens, index)} ${CLAIM_DIFFERS_WORD}`
          : `claim-${index}: ${tokens[`verify_${index}`]} ${CLAIM_AGREES_WORD}`;
      }).join("\n");
      if (verify.answered(answer, tokens)) accepted += 1;
    }
  }

  assert.equal(tried, VERIFY_WRONG_SETS.length ** 2);
  // The measured bound, not an aspiration: accepted only where guess === wrong (the diagonal of the
  // 56x56 grid), which is exactly VERIFY_WRONG_SETS.length outcomes out of VERIFY_WRONG_SETS.length ** 2.
  assert.equal(accepted, VERIFY_WRONG_SETS.length,
    "the guess-with-decoys residual moved away from 1/VERIFY_WRONG_SETS.length; the docstring above CLAIM_AGREES_WORD states this bound and must move with it");
});

test("the count of wrong claims is not knowable in advance either", () => {
  // Part of what holds the guessing residual at 1/VERIFY_WRONG_SETS.length rather than something
  // larger, not the thing that reduces it to zero -- nothing does that, see the docstring above
  // `CLAIM_AGREES_WORD`. This removes the prior a fixed-count answerer used to have: with a fixed
  // count, "exactly two of the six" was a shape it could assume before drawing its guess.
  const sizes = new Set(VERIFY_WRONG_SETS.map((set) => set.length));
  assert.deepEqual([...sizes].sort(), [1, 2, 3, 4]);
  // Never empty: an all-correct seeding would make an unconditional AGREES right again.
  assert.equal(VERIFY_WRONG_SETS.every((set) => set.length >= 1), true);
  // And a probe really does draw across them, so the count is not fixed in practice either.
  const drawn = new Set();
  for (let round = 0; round < 200; round += 1) drawn.add(probeTokens().verify_wrong_claims.length);
  assert.equal(drawn.size > 1, true, "every probe drew the same number of wrong claims");
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
const routingResultFor = (capability, minimality) => {
  const contract = contractWithAPopulatedIndex();
  const observations = observationsWith({
    M09: {
      "capability-matches-task": capability,
      "simplest-adequate-route": minimality,
      "no-redundant-invocation": true,
      "invocation-budget-respected": true
    }
  });
  return buildResult({
    contract,
    evaluation: evaluate(observations, identified, contract),
    observations,
    run: { run_id: "run-capability-transition" }
  });
};

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

test("a clean silent probe and a cut-off probe publish different retry signals without provider output", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  const { record: silentRecord } = assess(cwd, ["--probe-capabilities"], { FAKE_AGENT_PROFILE: "probe-silent" });
  const { record: cutOffRecord } = assess(cwd, ["--probe-capabilities"], { FAKE_AGENT_PROFILE: "probe-cut-off" });
  const silent = silentRecord.capability_probes.find((entry) => entry.agent_id === "alpha");
  const cutOff = cutOffRecord.capability_probes.find((entry) => entry.agent_id === "alpha");

  assert.equal(silent.status, "INDETERMINATE");
  assert.equal(cutOff.status, "INDETERMINATE");
  assert.deepEqual(
    { retryable: silent.retryable, blocker_class: silent.blocker_class, provider_blocker_class: silent.provider_blocker_class },
    { retryable: false, blocker_class: "NO_ENGAGEMENT", provider_blocker_class: "NOT_APPLICABLE" }
  );
  assert.deepEqual(
    { retryable: cutOff.retryable, blocker_class: cutOff.blocker_class, provider_blocker_class: cutOff.provider_blocker_class },
    { retryable: true, blocker_class: "NON_ZERO_EXIT", provider_blocker_class: "UNDETERMINED" }
  );
  assert.equal(cutOff.invocation.exit_code, 1);
  assert.equal(cutOff.observations.filter((row) => row.observed).length, 3);
  assert.deepEqual(
    { observed: cutOff.observed_challenge_count, total: cutOff.challenge_count },
    { observed: 3, total: 8 }
  );
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

test("a run that did not probe withholds routing fitness from the adapter table", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // Without the flag nothing is probed, so this remains honest evidence of what AOS knows about
  // the adapter -- not evidence of what this runtime can do. The source must stay visible beside
  // the withheld answer: a probe that could not answer is `unknown`, while this is an unmeasured
  // runtime under a known adapter.
  const { record, result } = assess(cwd, [], { FAKE_AGENT_PROFILE: "probe-confined" });
  assert.equal(record.capability_probes, null);
  const alpha = record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha");
  assert.equal(alpha.source, "aos-known");
  const capability = capabilityOf(record);
  assert.equal(capability.pass, null);
  assert.equal(subOf(result, "capability-matches-task"), null);
  // An adapter record is an unmeasured runtime, not an owner AOS knows nothing about. The distinction
  // travels through the constraint failure #583 consumes and reaches the report that tells the
  // operator how to obtain an answer.
  const adapterFailure = record.routing_oracle.constraint_failures.find((entry) => entry.constraint === "capability");
  assert.equal(adapterFailure.basis, "unmeasured-owner");
  assert.match(adapterFailure.detail, /aos-known adapter record but no observed runtime capability evidence/u);
  const minimality = record.routing_oracle.observables.find((entry) => entry.observable_id === "simplest-adequate-route");
  const expectedWithholds = [
    {
      observable_id: "capability-matches-task",
      pass: null,
      basis: ["unmeasured-owner"],
      reason: "AOS holds aos-known adapter records for alpha, but did not observe those runtimes; run aos assess --probe-capabilities to answer this question"
    },
    {
      observable_id: "simplest-adequate-route",
      pass: null,
      basis: ["unmeasured-owner"],
      reason: "the cheapest adequate route could not be computed for this run: NO_SCORABLE_OWNER"
    }
  ];
  assert.deepEqual([capability, minimality].map(({ observable_id, pass, basis, reason }) => ({ observable_id, pass, basis, reason })), expectedWithholds);

  // The oracle owns the wording; terminal, Markdown and HTML must relay the complete notice rather
  // than each picking one observable to summarize.
  const notice = expectedWithholds.map(({ observable_id, reason }) => `${observable_id} withholds: ${reason}`).join("; ");
  for (const [surface, rendered] of [
    ["terminal", renderProfileTerminal(result).join("\n")],
    ["Markdown", runCli(cwd, ["report", "--run", record.run_id]).stdout],
    ["HTML", runCli(cwd, ["report", "--run", record.run_id, "--format", "html"]).stdout]
  ]) {
    assert.equal(rendered.includes(`Routing capability evidence: ${notice}`), true, `${surface} omitted a causal subcheck or its reason`);
  }

  const { record: unknownRecord } = assess(cwd, ["--probe-capabilities"], { FAKE_AGENT_PROFILE: "probe-silent" });
  const unknownCapability = capabilityOf(unknownRecord);
  const unknownFailure = unknownRecord.routing_oracle.constraint_failures.find((entry) => entry.constraint === "capability");
  assert.equal(unknownFailure.basis, "unknown-owner");
  assert.match(unknownCapability.reason, /AOS holds no capability record it may score for alpha/u);
  assert.notEqual(capability.reason, unknownCapability.reason, "an aos-known record was described as an unknown owner");
  assert.notEqual(adapterFailure.basis, unknownFailure.basis, "the delegation oracle received one basis for different evidence states");

  // C2.RF.01 owns the capability, minimality and no-redundancy subchecks. One answered ledger
  // question cannot turn the two absent runtime-capability answers into a cell estimate; the
  // required cell therefore withholds O4 and prevents an outcome index or composite issuance.
  const routingFitness = result.cells.find((entry) => entry.cell_id === "C2.RF.01");
  assert.equal(routingFitness.status, "INSUFFICIENT_OPPORTUNITIES");
  assert.equal(routingFitness.estimate, null);
  const o4 = result.system_outcome_profile.domains.O4;
  assert.equal(o4.status, "WITHHELD");
  assert.deepEqual(o4.withheld_for, [{ cell_id: "C2.RF.01", status: "INSUFFICIENT_OPPORTUNITIES" }]);
  assert.equal(result.system_outcome_profile.index, null);
  assert.equal(result.aos_composite.issued, false);

  // This is the causal transition, rather than merely the default run's end state. With every
  // other cell issued, only the two capability answers move C2.RF.01, then O4, the outcome index
  // and the secondary composite.
  const issued = routingResultFor(true, true);
  const withheld = routingResultFor(null, null);
  assert.equal(issued.cells.find((cell) => cell.cell_id === "C2.RF.01").status, "ISSUED");
  assert.equal(withheld.cells.find((cell) => cell.cell_id === "C2.RF.01").status, "INSUFFICIENT_OPPORTUNITIES");
  assert.equal(issued.system_outcome_profile.domains.O4.status, "ISSUED");
  assert.equal(withheld.system_outcome_profile.domains.O4.status, "WITHHELD");
  assert.notEqual(issued.system_outcome_profile.index, null);
  assert.equal(withheld.system_outcome_profile.index, null);
  assert.equal(issued.aos_composite.issued, true);
  assert.equal(withheld.aos_composite.issued, false);
});

test("withholding O4 for unobserved capability leaves the Process Profile byte-identical", () => {
  const issued = routingResultFor(true, true);
  const withheld = routingResultFor(null, null);
  assert.equal(issued.system_outcome_profile.domains.O4.status, "ISSUED");
  assert.equal(withheld.system_outcome_profile.domains.O4.status, "WITHHELD");
  assert.equal(canonicalJson(withheld.operator_process_profile), canonicalJson(issued.operator_process_profile));
});

test("the routing notice names both causal subchecks and their reasons for every non-scorable source", () => {
  const sourceCases = [
    {
      source: "aos-known",
      basis: "unmeasured-owner",
      capabilityReason: "AOS holds aos-known adapter records for alpha, beta, but did not observe those runtimes; run aos assess --probe-capabilities to answer this question"
    },
    {
      source: "declared",
      basis: "declared-owner",
      capabilityReason: "AOS holds only declared capability records for alpha, beta; an owner's declaration cannot answer a runtime capability question"
    },
    {
      source: "unknown",
      basis: "unknown-owner",
      capabilityReason: "AOS holds no capability record it may score for alpha, beta; an owner it knows nothing about is not an owner that matched"
    }
  ];
  for (const { source, basis, capabilityReason } of sourceCases) {
    const capabilities = new Map(["alpha", "beta"].map((agent_id) => [agent_id, capabilityRecord({
      agent_id,
      capabilities: CAPABILITY_VOCABULARY,
      source,
      evidence_ids: source === "aos-known" ? ["adapter:codex-cli.v1"] : []
    })]));
    const routing = routingFor("alpha>beta", capabilities);
    const expectedWithholds = [
      { observable_id: "capability-matches-task", pass: null, basis: [basis], reason: capabilityReason },
      {
        observable_id: "simplest-adequate-route",
        pass: null,
        basis: [basis],
        reason: "the cheapest adequate route could not be computed for this run: NO_SCORABLE_OWNER"
      }
    ];
    const actualWithholds = routing.oracle.observables
      .filter(({ observable_id }) => ["capability-matches-task", "simplest-adequate-route"].includes(observable_id))
      .map(({ observable_id, pass, basis: observedBasis, reason }) => ({ observable_id, pass, basis: observedBasis, reason }));
    assert.deepEqual(actualWithholds, expectedWithholds, source);
    assert.equal(routing.reason.split("; routing capability evidence: ")[1],
      expectedWithholds.map(({ observable_id, reason }) => `${observable_id} withholds: ${reason}`).join("; "), source);
  }
});

test("a missing admitted owner does not become a probe recommendation because another owner is aos-known", () => {
  const { requirements, problems } = requirementsFromRoute({
    form_id: "FAM-3",
    route: "alpha>beta",
    required_artifacts: ["artifact:plan.json"]
  });
  const stageOne = requirements.find((entry) => entry.task_id === "FAM-3/stage-1");

  for (const source of ["aos-known", "detected"]) {
    const capabilities = new Map(["alpha", "beta"].map((agent_id) => [agent_id, capabilityRecord({
      agent_id,
      capabilities: CAPABILITY_VOCABULARY,
      source,
      evidence_ids: source === "detected" ? ["verifier:aos-capability-probe.v1"] : ["adapter:codex-cli.v1"]
    })]));
    const routing = routingObservables({
      requirements,
      requirement_problems: problems,
      capabilities,
      actual_route_events: [{
        schema_id: ACTUAL_ROUTE_EVENT_SCHEMA,
        task_id: stageOne.task_id,
        agent_id: "alpha",
        route_id: "alpha>beta",
        invocation_id: `only-stage-one-${source}`,
        purpose_id: stageOne.task_id,
        started_at: "2026-09-01T10:00:00Z",
        completed_at: "2026-09-01T10:01:00Z",
        artifact_ids: [],
        handoff_ids: [],
        capability_digest: capabilityDigestOf(capabilities.get("alpha")),
        operator_decision_event_id: null,
        operator_opportunity_id: null
      }],
      work_requirement: workRequirementAtPlanApproval({ form_id: "FAM-3", frozen_at: "2026-09-01T09:00:00Z" })
    });
    const byId = new Map(routing.oracle.observables.map((entry) => [entry.observable_id, entry]));
    const capability = byId.get("capability-matches-task");
    const minimality = byId.get("simplest-adequate-route");
    assert.equal(capability.pass, null, source);
    assert.equal(minimality.pass, null, source);
    assert.deepEqual(capability.basis, ["unassigned-owner"], source);
    assert.equal(minimality.basis, undefined, source);
    assert.match(capability.reason, /no admitted route event attributes an owner to FAM-3\/stage-2/u, source);
    assert.doesNotMatch(routing.reason, /routing capability evidence|probe-capabilities|aos-known adapter/u, source);
  }
});

test("a fixture runtime that does not compare loses the verification word and keeps the other seven", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // Both non-comparing fixture profiles, exercised rather than merely declared. Round 1 noted that
  // `probe-credulous` existed and no test ran it, which is a claim with no test behind it.
  for (const [profile, why] of [
    ["probe-credulous", "a runtime that repeated the claims it was handed"],
    ["probe-unchecked", "a runtime that asserted one verdict for every claim without comparing"],
    ["probe-pasting", "a runtime that copied every stated value onto every line"],
    // The strategy the final review found beating the previous instrument: it never opens
    // claims.json at all, and names the same two claims as wrong on every probe.
    ["probe-fixed-verdict", "a runtime that never opened claims.json and named a fixed pair as wrong"]
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

test("a mistyped probe flag is refused, and the spellings most command lines take turn it on", async (t) => {
  const cwd = workspace(t);
  initBare(cwd);
  addProbedAgent(cwd, "alpha");

  // Round 2. Only the bare `--probe-capabilities` turned the probe on; `--probe-capabilities=true`,
  // `--probe-capabilities 1` and `--probe-capabilities=1` all silently fell back to the probe being
  // off. An operator who wrote the flag the way most command lines accept it got the default
  // posture and no indication of it -- a silence read as a choice, in the flag that decides whether
  // the measurement happens at all.

  // The behavioural half: an alternative spelling really does probe, not merely fail to error.
  const { record } = assess(cwd, ["--probe-capabilities=true"], { FAKE_AGENT_PROFILE: "probe-confined" });
  assert.notEqual(record.capability_probes, null, "--probe-capabilities=true ran no probe and said nothing about it");
  const alpha = record.routing_oracle.capabilities.find((entry) => entry.agent_id === "alpha");
  assert.equal(alpha.source, "detected");
  assert.equal(capabilityOf(record).pass, false);

  // The classification half, asked cheaply: the flag is read before the plan, so a run against a
  // plan that does not exist reaches the flag and nothing else. `AOS_INVALID_FLAG` means refused;
  // reaching the missing plan means accepted.
  const classify = (flag) => {
    const result = spawnSync(process.execPath, [cli, "assess", "--plan", "does-not-exist.json", flag], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    const refused = /AOS_INVALID_FLAG/u.test(result.stderr);
    assert.equal(result.status, 2, `${flag} exited ${result.status}`);
    return refused ? "REFUSED" : "ACCEPTED";
  };
  for (const flag of ["--probe-capabilities", "--probe-capabilities=true", "--probe-capabilities=1",
    "--probe-capabilities=yes", "--probe-capabilities=ON", "--probe-capabilities=false",
    "--probe-capabilities=0", "--probe-capabilities=off"]) {
    assert.equal(classify(flag), "ACCEPTED", `${flag} was refused`);
  }
  // And anything that is not a spelling of on or off is refused with the value in the message,
  // rather than read as "off". The second case is the one where `parseArgs` swallowed what the
  // operator meant as a separate token: telling them beats losing both.
  for (const flag of ["--probe-capabilities=nonsense", "--probe-capabilities=2", "--probe-capabilities=-1"]) {
    assert.equal(classify(flag), "REFUSED", `${flag} was read as a deliberate default`);
  }
  const swallowed = spawnSync(process.execPath, [cli, "assess", "--plan", "does-not-exist.json", "--probe-capabilities", "stray-token"], {
    cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
  });
  assert.match(swallowed.stderr, /AOS_INVALID_FLAG --probe-capabilities stray-token/u);
  assert.match(swallowed.stderr, /pass --probe-capabilities on its own, or one of/u);
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
