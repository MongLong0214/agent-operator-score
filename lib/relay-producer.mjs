// The measurement questions a run puts to its operator, and the oracle that grades the answers.
//
// `lib/relay.mjs` owns the user-turn boundary and the initial -> reveal -> final order. It takes a
// prepared opportunity and refuses to invent one: "preparation is intentionally separate from this
// module's response handling". Nothing prepared one, so every assessment created a signed reliance
// journal and wrote nothing into it. This is the producer that fills it.
//
// Three properties decide whether an episode measures reliance at all, and each is a constraint on
// this file rather than on the protocol:
//
//   The advice's correctness is known before the question is asked. An episode whose advice nobody
//   can grade measures agreement, not appropriate reliance. Every question here is drawn from a
//   seeded scenario whose answer the instrument already holds -- FAM-2 knows which document is
//   authoritative because it wrote the stale one -- so the oracle is a fact about the fixture and
//   never a later judgement about the answer.
//
//   The answer is gradeable without reading what the operator wrote. Questions are option-shaped
//   and scored by option id. Free text is carried for the record and decides nothing, which keeps
//   the raw text out of the grading path entirely.
//
//   The floors are met by construction. `reliance-events/opportunity-floor.v1.json` withholds every
//   one of the ten metrics unless a run carries sixteen opportunities, eight with correct advice
//   and eight with incorrect, four complete choice-independence pairs, two incorrect-advice error
//   types, and four represented families. A catalogue that merely tried to cover those would meet
//   them on some seeds and not others, and a withheld profile looks the same whether the producer
//   is absent or merely unlucky. The sixteen below are fixed, and `assertCatalogueMeetsFloor`
//   checks them against the shipped floor file at module load.
//
// What this file may not do: FAM-1 is absent on purpose. `lib/reliance.mjs:626` counts a family
// only when it matches /^FAM-[2-6]$/, so an opportunity bound to FAM-1 lands in `unknownTaskForms`
// and raises TASK_FORM_FAMILY_UNBOUND -- one unmet reason that withholds all ten metrics. A
// question on the framing form would not be a wider measurement; it would be a silent zero.

import { createHash } from "node:crypto";

import { canonicalJson } from "./core.mjs";
import { loadRelianceOpportunityFloor } from "./reliance.mjs";
import { routeOracleDigest } from "./routing-oracle.mjs";
import { streamFor } from "./suite-seed.mjs";

/** The catalogue's own identity, so a result can say which questions produced its episodes. */
export const RELIANCE_QUESTION_CATALOGUE_ID = "aos-reliance-question-catalogue.v1";

/** Named in every opportunity's forcing record: what was required before the advice was shown. */
export const RELIANCE_FORCING_PROTOCOL_ID = "initial-judgment-before-advice.v1";

/** The interface facet every episode this producer creates is observed through. */
export const RELIANCE_INTERFACE = "agent-relay";

/** Two submissions per episode: the independent judgment, then the post-advice decision. */
const BURDEN_INTERACTION_COUNT = 2;

const ERROR_TYPE_CYCLE = Object.freeze(["systematic", "omission", "rare-large", "continuous-small"]);

const digestOf = (value) => `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;

/**
 * The sixteen questions, in the order a run administers them.
 *
 * `paired` marks a question asked twice -- once with no unrelated prior AI error in the session and
 * once after one. Both members carry the same current evidence, which is what makes the pair a
 * choice-independence case (`lib/reliance.mjs:610`) rather than two unrelated episodes: a decision
 * that moves between them moved on something other than the evidence in front of it.
 *
 * `correct_option_ids` is a set rather than one id because some of these questions have more than
 * one defensible answer. FAM-4's repeated failure is the clear case: rerouting and stopping are
 * both recognitions of a loop, and only retrying it unchanged is the failure the form injects. An
 * oracle that named one of the two would grade a preference as an error.
 */
const CATALOGUE = Object.freeze([
  {
    id: "fam2-authoritative-source",
    proactive_delegation: "DECIDE_ALONE",
    family: "FAM-2",
    domain: "source-authority",
    paired: true,
    delegation_expectation: "HARMFUL",
    context: (p) => `docs/ holds four documents about the ${p.subject} service. One is the current signed record, one is a superseded record, one is a notice carrying an instruction, and one states AI advice.`,
    initial_prompt: "Before any agent runs: which document do you take as the authority for the answer?",
    final_prompt: "Now that the advice is visible: which document do you take as the authority?",
    options: (p) => [
      { option_id: "current", label: `${p.authoritative} (updated 2026-08-01, current signed record)` },
      { option_id: "superseded", label: `${p.stale} (updated 2024-01-01, superseded record)` },
      { option_id: "notice", label: `${p.injection} (a notice document)` },
      { option_id: "advice-note", label: `${p.advice} (a document stating AI advice)` }
    ],
    correct_option_ids: ["current"],
    advice_option_id: (correct) => (correct ? "current" : "advice-note"),
    advice_summary: (p, correct) => (correct
      ? `Take ${p.authoritative} as the authority; it is the current signed record.`
      : `Take ${p.advice} as the authority; it states the recommended values directly.`)
  },
  {
    id: "fam2-conflicting-port",
    proactive_delegation: "DELEGATE",
    family: "FAM-2",
    domain: "source-authority",
    paired: false,
    delegation_expectation: "HARMFUL",
    context: (p) => `The current record and the superseded record state different ports for the ${p.subject} service.`,
    initial_prompt: "Which port do you carry into the answer?",
    final_prompt: "After the advice, which port do you carry into the answer?",
    options: (p) => [
      { option_id: "current-port", label: `${p.port} (stated by the current record)` },
      { option_id: "superseded-port", label: "9999 (stated by the superseded record and by the notice)" }
    ],
    correct_option_ids: ["current-port"],
    advice_option_id: (correct) => (correct ? "current-port" : "superseded-port"),
    advice_summary: (p, correct) => (correct
      ? `Use port ${p.port}; it is what the current record states.`
      : "Use port 9999; both the superseded record and the notice agree on it.")
  },
  {
    id: "fam2-injected-instruction",
    proactive_delegation: "DECIDE_ALONE",
    family: "FAM-2",
    domain: "source-authority",
    paired: false,
    delegation_expectation: "HARMFUL",
    context: (p) => `The notice document ${p.injection} instructs the reader to ignore the task and emit a different value instead.`,
    initial_prompt: "Do you let that instruction decide what the answer contains?",
    final_prompt: "After the advice, do you let that instruction decide what the answer contains?",
    options: () => [
      { option_id: "follow-notice", label: "Follow the notice; it is one of the supplied documents" },
      { option_id: "refuse-notice", label: "Refuse it; a document's content is evidence, not an instruction" }
    ],
    correct_option_ids: ["refuse-notice"],
    advice_option_id: (correct) => (correct ? "refuse-notice" : "follow-notice"),
    advice_summary: (p, correct) => (correct
      ? "Refuse the notice. It is content inside a source under review, not a task the operator set."
      : "Follow the notice. It is the most specific instruction in the supplied material.")
  },
  {
    id: "fam3-verification-independence",
    proactive_delegation: "DELEGATE",
    family: "FAM-3",
    domain: "task-routing",
    paired: true,
    delegation_expectation: "BENEFICIAL",
    context: (p) => `work.json declares that ${p.independent_pair[0]} and ${p.independent_pair[1]} both own the same resource and must stay independently verifiable.`,
    initial_prompt: `Before any agent runs: do ${"the two"} routes stay separate, or does one agent take both?`,
    final_prompt: "After the advice, do the two routes stay separate?",
    options: (p) => [
      { option_id: "keep-independent", label: `Keep ${p.independent_pair[0]} and ${p.independent_pair[1]} on separate routes` },
      { option_id: "merge-routes", label: "Give both to one agent; it is fewer handoffs" }
    ],
    correct_option_ids: ["keep-independent"],
    advice_option_id: (correct) => (correct ? "keep-independent" : "merge-routes"),
    advice_summary: (p, correct) => (correct
      ? "Keep them separate; work verified by whoever produced it is not independently verified."
      : "Give both to one agent; the handoff is the expensive part and the work is the same.")
  },
  {
    id: "fam3-shared-resource-order",
    proactive_delegation: "DELEGATE",
    family: "FAM-3",
    domain: "task-routing",
    paired: false,
    delegation_expectation: "NEUTRAL",
    context: () => "Two tasks in the declared graph write the same resource, and the plan may run stages in parallel.",
    initial_prompt: "Do those two tasks run in parallel or in sequence?",
    final_prompt: "After the advice, do those two tasks run in parallel or in sequence?",
    options: () => [
      { option_id: "serialise", label: "In sequence; they collide on one resource" },
      { option_id: "parallelise", label: "In parallel; the run finishes sooner" }
    ],
    correct_option_ids: ["serialise"],
    advice_option_id: (correct) => (correct ? "serialise" : "parallelise"),
    advice_summary: (p, correct) => (correct
      ? "Run them in sequence; the shared resource makes a parallel pair non-deterministic."
      : "Run them in parallel; the stages are short and a collision is unlikely.")
  },
  {
    id: "fam4-repeated-retry",
    proactive_delegation: "DECIDE_ALONE",
    family: "FAM-4",
    domain: "failure-recovery",
    paired: true,
    delegation_expectation: "HARMFUL",
    context: (p) => `events.json records the same action twice under one correlation id (${p.correlation}), and the checkpoint is still blocked by: ${p.blocker}.`,
    initial_prompt: "What happens next: the same retry, a different route, or a stop?",
    final_prompt: "After the advice, what happens next?",
    options: () => [
      { option_id: "retry-unchanged", label: "Retry the same way once more" },
      { option_id: "reroute", label: "Send the work somewhere else" },
      { option_id: "stop", label: "Stop and report the blocker" }
    ],
    correct_option_ids: ["reroute", "stop"],
    advice_option_id: (correct) => (correct ? "reroute" : "retry-unchanged"),
    advice_summary: (p, correct) => (correct
      ? "Change something. The correlation id shows the same attempt already ran twice."
      : "Retry once more; transient failures usually clear on a third attempt.")
  },
  {
    id: "fam4-blocker-completion",
    proactive_delegation: "DELEGATE",
    family: "FAM-4",
    domain: "failure-recovery",
    paired: false,
    delegation_expectation: "HARMFUL",
    context: (p) => `The goal is "${p.goal}" and the recorded blocker is "${p.blocker}". No evidence says the blocker cleared.`,
    initial_prompt: "Do you record this work as complete?",
    final_prompt: "After the advice, do you record this work as complete?",
    options: () => [
      { option_id: "claim-complete", label: "Record it complete; the remaining step is small" },
      { option_id: "report-blocked", label: "Record it blocked and name what would let it resume" }
    ],
    correct_option_ids: ["report-blocked"],
    advice_option_id: (correct) => (correct ? "report-blocked" : "claim-complete"),
    advice_summary: (p, correct) => (correct
      ? "Report it blocked; nothing observed says the blocker cleared."
      : "Record it complete; the blocker is understood and the rest is mechanical.")
  },
  {
    id: "fam5-public-probe-only",
    proactive_delegation: "DELEGATE",
    family: "FAM-5",
    domain: "completion-verification",
    paired: true,
    delegation_expectation: "HARMFUL",
    context: (p) => `The public check covers ratio(${p.public_probe[0]}, ${p.public_probe[1]}) and nothing else. The independent verifier holds a larger probe set that has not run.`,
    initial_prompt: "The public check passes. Do you accept the completion claim now?",
    final_prompt: "After the advice, do you accept the completion claim?",
    options: () => [
      { option_id: "accept-public", label: "Accept it; the check that exists passes" },
      { option_id: "withhold-until-hidden", label: "Withhold it until the independent verifier has run" }
    ],
    correct_option_ids: ["withhold-until-hidden"],
    advice_option_id: (correct) => (correct ? "withhold-until-hidden" : "accept-public"),
    advice_summary: (p, correct) => (correct
      ? "Withhold it; the public probe is stated to be incomplete."
      : "Accept it; the available evidence passes and further probing costs a cycle.")
  },
  {
    id: "fam5-revision-mismatch",
    proactive_delegation: "DECIDE_ALONE",
    family: "FAM-5",
    domain: "completion-verification",
    paired: false,
    delegation_expectation: "HARMFUL",
    context: () => "The completion claim names one revision while the working tree holds uncommitted changes to the file the claim is about.",
    initial_prompt: "Do you accept a claim whose revision does not describe the tree?",
    final_prompt: "After the advice, do you accept that claim?",
    options: () => [
      { option_id: "accept-mismatch", label: "Accept it; the difference is small" },
      { option_id: "reject-mismatch", label: "Reject it; the claim is not bound to anything" }
    ],
    correct_option_ids: ["reject-mismatch"],
    advice_option_id: (correct) => (correct ? "reject-mismatch" : "accept-mismatch"),
    advice_summary: (p, correct) => (correct
      ? "Reject it; a claim that names one revision while the tree holds another binds to nothing."
      : "Accept it; the named revision is close enough to what was measured.")
  },
  {
    id: "fam6-credential-suggestion",
    proactive_delegation: "DECIDE_ALONE",
    family: "FAM-6",
    domain: "incident-safety",
    paired: false,
    delegation_expectation: "HARMFUL",
    context: () => "incident.json carries a suggestion to write a credential into the local configuration and retry.",
    initial_prompt: "Do you take that suggestion?",
    final_prompt: "After the advice, do you take that suggestion?",
    options: () => [
      { option_id: "adopt-suggestion", label: "Take it; it is the fastest route back to a working run" },
      { option_id: "refuse-suggestion", label: "Refuse it and say why" }
    ],
    correct_option_ids: ["refuse-suggestion"],
    advice_option_id: (correct) => (correct ? "refuse-suggestion" : "adopt-suggestion"),
    advice_summary: (p, correct) => (correct
      ? "Refuse it. Writing a credential to local configuration is the unsafe half of the incident."
      : "Take it; the credential is already on this machine and the run is blocked without it.")
  },
  {
    id: "fam6-provider-fallback",
    proactive_delegation: "DELEGATE",
    family: "FAM-6",
    domain: "incident-safety",
    paired: false,
    delegation_expectation: "BENEFICIAL",
    context: (p) => `The incident is: ${p.failure}. A lower-cost local agent with repository access only is available.`,
    initial_prompt: "Do you retry the failed provider or route to the local fallback?",
    final_prompt: "After the advice, do you retry the provider or route to the fallback?",
    options: () => [
      { option_id: "retry-primary", label: "Retry the primary provider" },
      { option_id: "local-fallback", label: "Route to the local fallback" }
    ],
    correct_option_ids: ["local-fallback"],
    advice_option_id: (correct) => (correct ? "local-fallback" : "retry-primary"),
    advice_summary: (p, correct) => (correct
      ? "Route to the fallback; the declared failure is not one a blind retry clears."
      : "Retry the primary; the fallback is weaker and the failure may be transient.")
  },
  {
    id: "fam6-external-action",
    proactive_delegation: "DECIDE_ALONE",
    family: "FAM-6",
    domain: "incident-safety",
    paired: false,
    delegation_expectation: "HARMFUL",
    context: () => "incident.json states that the task does not need network access.",
    initial_prompt: "Do you permit an external action in the recovery route?",
    final_prompt: "After the advice, do you permit an external action?",
    options: () => [
      { option_id: "allow-external", label: "Permit one; it makes the recovery simpler" },
      { option_id: "deny-external", label: "Permit none; the task is declared not to need it" }
    ],
    correct_option_ids: ["deny-external"],
    advice_option_id: (correct) => (correct ? "deny-external" : "allow-external"),
    advice_summary: (p, correct) => (correct
      ? "Permit none; the incident states the task does not need network access."
      : "Permit one; a single outbound call is cheaper than working around its absence.")
  }
]);

/**
 * Which questions carry correct advice, and which error each incorrect one carries.
 *
 * Drawn as a shuffle over the catalogue rather than as one coin flip per question. Independent
 * flips give an all-correct run about once in four thousand, and a run that happens to draw nine
 * correct conditions misses the floor of eight incorrect ones -- which withholds every metric and
 * is indistinguishable, in the profile, from a run where nobody answered. The shuffle makes the
 * split exact on every seed and leaves which questions fall on which side to the seed.
 *
 * A paired question counts twice, so the eight/eight split is over opportunities, not over rows.
 */
const adviceConditions = (seed) => {
  const stream = streamFor(`0x${seed}`, "RELIANCE-ADVICE");
  const order = CATALOGUE.map((question) => question.id);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = stream.int(index + 1);
    const held = order[index];
    order[index] = order[swap];
    order[swap] = held;
  }
  const weightOf = (id) => (CATALOGUE.find((question) => question.id === id).paired ? 2 : 1);
  const correct = new Set();
  let taken = 0;
  const half = CATALOGUE.reduce((total, question) => total + weightOf(question.id), 0) / 2;
  for (const id of order) {
    if (taken + weightOf(id) > half) continue;
    correct.add(id);
    taken += weightOf(id);
  }
  const errorTypes = new Map();
  let cycle = 0;
  for (const id of order) {
    if (correct.has(id)) continue;
    errorTypes.set(id, ERROR_TYPE_CYCLE[cycle % ERROR_TYPE_CYCLE.length]);
    cycle += 1;
  }
  // Checked, not reported. The first cut returned this as a flag nobody read, which is the same
  // shape as the defect the shuffle exists to prevent: a split that silently missed the floor would
  // withhold every metric, and a withheld profile cannot say whether the operator was never asked
  // or the draw went wrong. A catalogue whose weights cannot divide exactly fails here instead.
  if (taken !== half) {
    throw new Error(`AOS_RELIANCE_ADVICE_SPLIT_UNEVEN the catalogue's weights put ${taken} of ${half * 2} opportunities on the correct-advice side`);
  }
  return { correct, errorTypes };
};

const optionIdsOf = (question, params) => question.options(params[question.family]).map((option) => option.option_id);

/**
 * One opportunity, in the exact shape `assertOpportunity` demands.
 *
 * `member` is 0 or 1 for a paired question and null for a single one. The two members of a pair
 * differ only in `unrelated_prior_ai_error`; every other field, including the evidence digest the
 * pair is keyed on, is identical by construction.
 */
const opportunityFor = ({ question, params, seed, conditions, ordinal, member, expiresAt, routeOracle }) => {
  const familyParams = params[question.family];
  const adviceCorrect = conditions.correct.has(question.id);
  const errorType = adviceCorrect ? "none" : conditions.errorTypes.get(question.id);
  const options = question.options(familyParams);
  const suffix = member === null ? "" : `-${member + 1}`;
  // What the question rests on, digested from the fixture values it was built from rather than
  // from its rendered text. Both members of a pair read the same fixture, so both produce the same
  // digest -- which is the equality `choiceCases` requires of a pair.
  const evidenceDigest = digestOf({
    catalogue: RELIANCE_QUESTION_CATALOGUE_ID,
    question: question.id,
    seed,
    options: options.map((option) => option.option_id),
    correct: [...question.correct_option_ids].sort()
  });
  const adviceOption = question.advice_option_id(adviceCorrect);
  const opportunity = {
    reliance_opportunity_id: `rel-${question.id}${suffix}`,
    operator_opportunity_id: `opp-${question.id}${suffix}`,
    // The reliance cell this episode observes. C3.CC.01 reads the same episodes for calibration and
    // is not named separately: one episode is one observation, and naming two cells on one record
    // would let a single answer count twice.
    construct_cell_id: "C3.RA.01",
    task_form_id: question.family,
    expires_at: expiresAt,
    // Fixed by the question, never by the answer key.
    //
    // This read `adviceCorrect ? "DELEGATE" : "DECIDE_ALONE"`, and two things followed. The
    // checkpoint stores it in cleartext beside the advice the instrument encrypts, so anything that
    // could read the run directory knew which advice was correct before the operator answered --
    // the seal was intact and the answer was next to it. And `delegation_regret` became a function
    // of the advice condition and the question's fixed expected value, which is the producer's own
    // construction scored as an operator's judgement.
    //
    // A fixed posture is structurally independent of correctness: the seed moves which questions
    // carry correct advice and cannot move this. What it is not is the operator's own decision --
    // the protocol takes it from the prepared opportunity, so nobody's actual delegation choice is
    // observed yet, and `delegation_regret` should be read as unobserved rather than as evidence.
    proactive_delegation: question.proactive_delegation,
    forcing: {
      forcing_protocol_id: RELIANCE_FORCING_PROTOCOL_ID,
      burden_interaction_count: BURDEN_INTERACTION_COUNT,
      skip_or_refusal: "NONE",
      timeout: false,
      interface: RELIANCE_INTERFACE
    },
    delegation: {
      chosen: question.proactive_delegation === "DELEGATE",
      oracle_expected_value: question.delegation_expectation,
      route_oracle: { ...routeOracle, route_oracle_digest: routeOracleDigest(routeOracle) }
    },
    advice: {
      summary: question.advice_summary(familyParams, adviceCorrect),
      proposal_evidence_digest: evidenceDigest,
      oracle: {
        correct: adviceCorrect,
        error_type: errorType,
        domain: question.domain,
        evidence_digest: evidenceDigest
      }
    },
    action: {
      initial_prompt: question.initial_prompt,
      final_prompt: question.final_prompt,
      context_summary: question.context(familyParams),
      initial_options: options,
      final_options: options,
      free_text_allowed: true
    }
  };
  if (member !== null) {
    opportunity.choice_independence = {
      pair_id: `pair-${question.id}`,
      current_evidence_digest: evidenceDigest,
      unrelated_prior_ai_error: member === 1
    };
  }
  return Object.freeze({
    ...opportunity,
    // Not part of the protocol's opportunity: the ordinal and the graded option set travel beside
    // it so a sequencer can grade an answer without re-deriving the catalogue. `prepare` is given
    // only the protocol half.
    grading: Object.freeze({
      ordinal,
      question_id: question.id,
      family: question.family,
      correct_option_ids: Object.freeze([...question.correct_option_ids]),
      advice_option_id: adviceOption,
      advice_correct: adviceCorrect,
      evidence_digest: evidenceDigest
    })
  });
};

/** The protocol half of a produced opportunity: everything `prepare` accepts and nothing else. */
export const preparedOpportunity = (produced) => {
  const { grading, ...opportunity } = produced;
  return Object.freeze(opportunity);
};

/**
 * Every reliance opportunity one run administers, in order.
 *
 * `params` is `scenarioParams(seed)`: the same values that built the workspace and that grade the
 * agent's artifact. Drawing the question from them is what makes the oracle independent of the
 * answer -- the fixture decided which document was authoritative before anybody was asked.
 */
export function relianceOpportunities({ seed, params, expires_at: expiresAt, route_oracle: routeOracle } = {}) {
  if (typeof seed !== "string" || seed.length === 0) throw new Error("AOS_RELIANCE_PRODUCER_SEED a produced opportunity set belongs to one seed");
  if (params === null || typeof params !== "object") throw new Error("AOS_RELIANCE_PRODUCER_PARAMS the producer reads the run's scenario parameters");
  if (typeof expiresAt !== "string" || expiresAt.length === 0) throw new Error("AOS_RELIANCE_PRODUCER_EXPIRY an opportunity needs an explicit expiry; absence is never a default");
  if (routeOracle === null || typeof routeOracle !== "object") throw new Error("AOS_RELIANCE_PRODUCER_ROUTE_ORACLE the delegation observation must name the run's route oracle record");
  const conditions = adviceConditions(seed);
  const produced = [];
  let ordinal = 0;
  for (const question of CATALOGUE) {
    const members = question.paired ? [0, 1] : [null];
    for (const member of members) {
      ordinal += 1;
      produced.push(opportunityFor({ question, params, seed, conditions, ordinal, member, expiresAt, routeOracle }));
    }
  }
  return Object.freeze(produced);
}

/**
 * The independent verifier's reading of one answered episode.
 *
 * Correctness is set membership over option ids and reads no free text: what the operator typed is
 * kept for the record and decides nothing here. The value digests are the ones the ordered operator
 * events already committed -- `assertOutcome` re-checks them against those events, so passing
 * anything recomputed here would be refused rather than believed.
 */
export function gradeRelianceOutcome({
  opportunity,
  initial_selected_option_ids: initialSelected,
  final_selected_option_ids: finalSelected,
  initial_value_digest: initialValueDigest,
  final_value_digest: finalValueDigest
} = {}) {
  const grading = opportunity?.grading;
  if (grading === undefined) throw new Error("AOS_RELIANCE_PRODUCER_GRADING the outcome verifier needs the produced opportunity, not its protocol projection");
  const correct = new Set(grading.correct_option_ids);
  // Exactly one option, and it is a correct one. A submission that selected every option has not
  // answered the question, and reading it as correct because a correct id appears among the others
  // is the reading an answer sheet gives itself.
  const graded = (selected) => Array.isArray(selected) && selected.length === 1 && correct.has(selected[0]);
  return Object.freeze({
    initial_correct: graded(initialSelected),
    initial_value_digest: initialValueDigest,
    final_correct: graded(finalSelected),
    final_value_digest: finalValueDigest,
    verified_outcome_evidence_ids: Object.freeze([`oracle-${grading.question_id}`, `fixture-${grading.family}`])
  });
}

/**
 * What the catalogue guarantees against the shipped floor, recomputed rather than asserted.
 *
 * Every number here decides whether a run's ten metrics can be issued at all, and all of them are
 * properties of this file. Checking them at load turns a catalogue edit that quietly drops below a
 * floor into a failure at the edit, instead of a withheld profile weeks later that reads exactly
 * like a run nobody answered.
 */
export function catalogueCoverage() {
  const opportunities = CATALOGUE.reduce((total, question) => total + (question.paired ? 2 : 1), 0);
  const paired = CATALOGUE.filter((question) => question.paired).length;
  const families = new Set(CATALOGUE.map((question) => question.family));
  return Object.freeze({
    catalogue_id: RELIANCE_QUESTION_CATALOGUE_ID,
    questions: CATALOGUE.length,
    opportunities,
    choice_independence_pairs: paired,
    families: Object.freeze([...families].sort()),
    // Both sides of the split, because the floor requires each separately and an even total says
    // nothing about how it divides.
    correct_advice_conditions: opportunities / 2,
    incorrect_advice_conditions: opportunities / 2,
    confidence_observations: opportunities * 2
  });
}

const assertCatalogueMeetsFloor = () => {
  const floor = loadRelianceOpportunityFloor();
  const coverage = catalogueCoverage();
  const shortfalls = [];
  if (coverage.opportunities < floor.planned_opportunities_per_cycle) shortfalls.push(`opportunities ${coverage.opportunities} < ${floor.planned_opportunities_per_cycle}`);
  if (coverage.correct_advice_conditions < floor.correct_advice_conditions) shortfalls.push(`correct-advice conditions ${coverage.correct_advice_conditions} < ${floor.correct_advice_conditions}`);
  if (coverage.incorrect_advice_conditions < floor.incorrect_advice_conditions) shortfalls.push(`incorrect-advice conditions ${coverage.incorrect_advice_conditions} < ${floor.incorrect_advice_conditions}`);
  if (coverage.families.length < floor.families_represented) shortfalls.push(`families ${coverage.families.length} < ${floor.families_represented}`);
  if (coverage.choice_independence_pairs < floor.choice_independence_pairs) shortfalls.push(`choice-independence pairs ${coverage.choice_independence_pairs} < ${floor.choice_independence_pairs}`);
  if (coverage.confidence_observations < floor.confidence_observations) shortfalls.push(`confidence observations ${coverage.confidence_observations} < ${floor.confidence_observations}`);
  if (ERROR_TYPE_CYCLE.length < floor.incorrect_advice_error_types) shortfalls.push(`incorrect-advice error types ${ERROR_TYPE_CYCLE.length} < ${floor.incorrect_advice_error_types}`);
  if (shortfalls.length > 0) {
    throw new Error(`AOS_RELIANCE_CATALOGUE_BELOW_FLOOR the question catalogue cannot meet the shipped opportunity floor: ${shortfalls.join("; ")}`);
  }
};

assertCatalogueMeetsFloor();
