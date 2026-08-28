import { sha256Text } from "./core.mjs";

// What the operator did while the run was happening.
//
// The decision this file encodes, and the two designs it rejects:
//
// A checkpoint is a runtime event, not a metric. AOS raises one at a moment it can point to, and
// records what happened next. The choice the operator makes is never the score. "Inspect evidence"
// is a label, and a label is theatre: picking the cautious-looking option and then retrying the
// same thing unchanged is the exact defect the checkpoint exists to catch, and it would score well
// if the pick were the metric.
//
// Nor is a terminal the test. Whether stdin is a tty is a property of the channel, not of the
// operator -- `expect` holds a pty and answers in no time at all, and a person can hold one and
// walk away. This product already learned that lesson once: the length of an unattended stretch was
// 82% of all findings until it was demoted to an observation, because how long a stretch runs is a
// property of the work.
//
// And a policy file written before the run is the operator plan again. That was tried: seventeen of
// twenty metrics came from static shape checks on JSON the operator wrote about themselves, and a
// plan of literal junk scored 17/17. A program that maps a planted payload to a menu enum is the
// same object in a runtime costume -- the payload's shape is identical every run and the expected
// answer is in this repository.
//
// So: an intervention counts when a real operator turn produced a state change that can be graded,
// and the work that followed was not the same thing again.

export const CHECKPOINT_KINDS = ["identical-retry-after-failure", "repeated-failure", "no-progress"];

/**
 * The evidence an operator is shown, and its digest.
 *
 * The digest is what makes "they were shown this" checkable later: a decision recorded against a
 * payload nobody can reconstruct is a decision about nothing.
 */
const SHOWN_OUTPUT_LIMIT = 512;

export function checkpointEvidence({ kind, family, detail, output = "", calls = [] }) {
  const text = typeof output === "string" ? output : "";
  const payload = {
    kind,
    family: family ?? null,
    detail: detail ?? "",
    // What the stage actually said, redacted where it was produced. A checkpoint that shows an exit
    // code is asking the operator to decide from nothing.
    //
    // Bounded to what the event can hold, so that what was shown, what was stored and what the
    // digest covers are the same bytes. A digest over a payload the record does not keep is a claim
    // of checkability that nothing can honour.
    output: text.length > SHOWN_OUTPUT_LIMIT ? text.slice(-SHOWN_OUTPUT_LIMIT) : text,
    // Strings rather than objects, for the same reason: this is the shape that survives into the
    // record, so it is the shape everything else reads.
    calls: calls.map((call) => `${call.outcome ?? "unknown"}\t${call.signature}`)
  };
  return { ...payload, evidence_digest: sha256Text(JSON.stringify(payload)) };
}

const signatureOf = (event) =>
  `${event.event_type}:${event.agent_profile_id ?? ""}:${event.family ?? ""}:${event.payload?.stage ?? ""}`;

/**
 * Where a run reached a moment worth stopping at.
 *
 * A run that stopped and asked recorded it, and those records are the answer: the operator was
 * shown that payload, and the digest beside it is what makes the claim checkable later. Re-deriving
 * would also be wrong about when -- the runtime raises on the first failure, because an operator who
 * fixes a stage immediately must not be scored worse than one who let it fail twice.
 *
 * The derivation below is what a trace with no runtime gets: no operator was shown anything, so the
 * stricter rule applies and only a repeat with nothing changed between the attempts counts. It is
 * deterministic, so the same trace always raises the same checkpoints.
 */
export function detectCheckpoints(events) {
  const recorded = events.filter((event) => event.event_type === "checkpoint.raised");
  if (recorded.length > 0) {
    return recorded.map((event) => ({
      kind: event.payload?.kind ?? "repeated-failure",
      family: event.family ?? null,
      detail: event.payload?.detail ?? "",
      calls: Array.isArray(event.payload?.calls) ? event.payload.calls : [],
      output: event.payload?.output ?? "",
      evidence_digest: event.payload?.evidence_digest ?? ""
    }));
  }

  const raised = [];
  const failuresBySignature = new Map();

  for (const event of events) {
    if (event.event_type !== "agent.ended") continue;
    const failed = event.payload?.ok === false || event.payload?.exit_code !== 0 || event.payload?.timed_out === true;
    if (!failed) continue;
    const signature = signatureOf(event);
    const priors = failuresBySignature.get(signature) ?? [];
    if (priors.length >= 1) {
      raised.push(
        checkpointEvidence({
          kind: "identical-retry-after-failure",
          family: event.family ?? null,
          detail: "the same stage failed again with no change between the attempts",
          calls: [...priors, event].map((entry) => ({ signature: signatureOf(entry), outcome: "failed" }))
        })
      );
    }
    failuresBySignature.set(signature, [...priors, event]);
  }
  return raised;
}

/** Whether a recorded operator turn changed anything a later step could act on. */
const stateChangeOf = (decision, previousInstruction) => {
  if (decision.event_type === "session.cancelled") return "stopped";
  if (decision.event_type === "user.instruction") {
    const digest = decision.payload?.instruction_digest ?? null;
    if (digest === null) return null;
    // The same instruction sent again is not an intervention. It is the retry the checkpoint was
    // raised about, typed by a person.
    return previousInstruction !== null && digest === previousInstruction ? null : "instruction-changed";
  }
  if (decision.event_type === "operator.decision") {
    const route = decision.payload?.route_changed === true;
    return route ? "route-changed" : null;
  }
  return null;
};

/**
 * What the operator's turns actually did.
 *
 * Returns observations, never metrics. A run with no operator turn produces an empty list, and an
 * empty list is what "not observed" is made of -- it is not a zero, and nothing here converts it
 * into one.
 */
export function observeInterventions(events) {
  const observations = [];
  const checkpoints = detectCheckpoints(events);
  if (checkpoints.length === 0) return observations;

  const ordered = [...events];
  let previousInstruction = null;
  // An operator turn counts as an intervention when it answers a checkpoint. Every stage sends an
  // instruction whether or not anybody was asked, so without this the first instruction of each
  // family read as a changed one -- the plan being carried out, scored as the operator stepping in.
  //
  // A trace with no recorded checkpoints is one from before this runtime, or an imported one. There
  // is no moment to anchor to, so the older behaviour stands: every turn is considered.
  // The window a question is open for: from the checkpoint that asked it to the decision that
  // answered it. Every stage sends an instruction whether or not anybody was asked, so without a
  // window the first instruction of each family read as a changed one -- the plan being carried
  // out, scored as the operator stepping in.
  const anchored = ordered.some((event) => event.event_type === "checkpoint.raised");
  let asked = !anchored;

  for (const [index, event] of ordered.entries()) {
    if (event.event_type === "checkpoint.raised") { asked = true; continue; }
    const change = stateChangeOf(event, previousInstruction);
    if (event.event_type === "user.instruction") {
      previousInstruction = event.payload?.instruction_digest ?? previousInstruction;
    }
    const wasAsked = asked;
    // The decision closes the window whatever it was, including one nobody answered. What the
    // decision *did* is read from the events inside the window, never from the choice's name.
    if (anchored && event.event_type === "operator.decision") asked = false;
    if (change === null) continue;
    if (!wasAsked) continue;

    // What followed. An intervention that is followed by the same stage failing again in the same
    // way did not intervene in anything, whatever it was called.
    const after = ordered.slice(index + 1).filter((entry) => entry.event_type === "agent.ended");
    const repeated = after.some(
      (entry) => entry.payload?.ok === false && ordered.slice(0, index).some((prior) =>
        prior.event_type === "agent.ended" && prior.payload?.ok === false && signatureOf(prior) === signatureOf(entry)
      )
    );
    // A stop that is followed by more agent work did not stop anything. "Stop blocked" is a label
    // like the others, and taking it at its word would make the safest-sounding option the cheapest
    // one to claim.
    const workContinued = after.length > 0;
    observations.push({
      kind: "operator-intervention",
      state_change: change,
      at_event: event.event_id ?? null,
      followed_by_same_failure: repeated,
      work_continued_after: workContinued,
      // Every state change is judged by what came after it, including the one that claims to have
      // ended the run. Latency is not here at all: it is gamed by a sleep in one direction and by a
      // reflex in the other, and this product already refused duration as a measure of quality.
      effective: change === "stopped" ? !workContinued : !repeated
    });
  }
  return observations;
}

/**
 * The one line a result carries about monitoring.
 *
 * `observed` is false when nothing intervened, and that is the honest state for an unattended run:
 * the run happened, and nobody was watching it. Converting that into a low score would grade the
 * absence of a person as a failure of one.
 */
export function interventionSummary(events) {
  const checkpoints = detectCheckpoints(events);
  const observations = observeInterventions(events);
  return {
    checkpoints_raised: checkpoints.length,
    interventions: observations.length,
    effective_interventions: observations.filter((entry) => entry.effective).length,
    observed: observations.length > 0,
    checkpoints,
    observations
  };
}
