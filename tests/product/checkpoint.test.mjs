import assert from "node:assert/strict";
import test from "node:test";

import { CHECKPOINT_KINDS, checkpointEvidence, detectCheckpoints, interventionSummary, observeInterventions } from "../../lib/checkpoint.mjs";

const ended = (stage, ok, id) => ({
  event_type: "agent.ended",
  event_id: id ?? `e-${stage}-${ok}`,
  family: "FAM-4",
  agent_profile_id: "solo",
  payload: { stage, ok, exit_code: ok ? 0 : 1, timed_out: false }
});
const instruction = (digest) => ({
  event_type: "user.instruction",
  event_id: `i-${digest}`,
  family: "FAM-4",
  payload: { instruction_digest: digest }
});
const decision = (over = {}) => ({
  event_type: "operator.decision",
  event_id: "d-1",
  family: "FAM-4",
  payload: { choice: "reroute", ...over }
});
const cancelled = () => ({ event_type: "session.cancelled", event_id: "c-1", payload: { reason: "blocked" } });

const changes = (events) => observeInterventions(events).map((entry) => [entry.state_change, entry.effective]);

test("a checkpoint is raised where the same stage failed again", () => {
  // Derived from the events, so the same trace raises the same checkpoints. Nothing depends on a
  // clock or on who is watching.
  assert.equal(detectCheckpoints([ended("s1", false, "a"), ended("s1", false, "b")]).length, 1);
  assert.equal(detectCheckpoints([ended("s1", false, "a")]).length, 0, "one failure is not a pattern");
  assert.equal(detectCheckpoints([ended("s1", false, "a"), ended("s2", false, "b")]).length, 0, "different stages");
  assert.equal(detectCheckpoints([ended("s1", true, "a"), ended("s1", true, "b")]).length, 0, "nothing failed");
});

test("the evidence carries a digest of what was shown", () => {
  // A decision recorded against a payload nobody can reconstruct is a decision about nothing.
  const first = checkpointEvidence({ kind: "identical-retry-after-failure", family: "FAM-4", detail: "x", calls: [] });
  const same = checkpointEvidence({ kind: "identical-retry-after-failure", family: "FAM-4", detail: "x", calls: [] });
  const other = checkpointEvidence({ kind: "identical-retry-after-failure", family: "FAM-4", detail: "y", calls: [] });
  assert.match(first.evidence_digest, /^[a-f0-9]{64}$/);
  assert.equal(first.evidence_digest, same.evidence_digest);
  assert.notEqual(first.evidence_digest, other.evidence_digest);
});

test("an unattended run observes nothing, and nothing is not a zero", () => {
  // The run happened and nobody was watching it. Converting that into a low score would grade the
  // absence of a person as a failure of one.
  const summary = interventionSummary([ended("s1", false, "a"), ended("s1", false, "b")]);
  assert.equal(summary.checkpoints_raised, 1);
  assert.equal(summary.interventions, 0);
  assert.equal(summary.observed, false);
  assert.deepEqual(summary.observations, []);
});

test("the menu choice is never what counts", () => {
  // "Inspect evidence" is a label. Picking the cautious-looking option and then retrying the same
  // thing unchanged is the exact defect the checkpoint exists to catch.
  //
  // This used to be enforced by producing no observation at all, which also erased the operator:
  // #487 showed that a person who attended, read the evidence and decided nothing needed changing
  // was indistinguishable from a run nobody watched, and D4 came back NOT_OBSERVED. So the answer
  // is now recorded -- and earns nothing, which is the property that actually matters and which
  // "no observation" could never demonstrate.
  const inspected = [
    ended("s1", false, "a"),
    ended("s1", false, "b"),
    decision({ choice: "inspect evidence" }),
    ended("s1", false, "c")
  ];
  const seen = observeInterventions(inspected);
  assert.equal(seen.length, 1, "the operator answered and was not recorded");
  assert.equal(seen[0].state_change, "held");
  assert.equal(seen[0].effective, false, "a label earned credit");
  assert.equal(seen[0].followed_by_same_failure, true);

  // Even a choice that names a reroute earns nothing unless the route actually changed.
  const claimed = [ended("s1", false, "a"), ended("s1", false, "b"), decision({ choice: "reroute" })];
  const claimedSeen = observeInterventions(claimed);
  assert.deepEqual(claimedSeen.map((entry) => entry.state_change), ["held"], "a named reroute became a route change");
});

test("nobody there is still nobody there", () => {
  // The distinction #487 asked for cuts both ways: an unanswered checkpoint must stay unobserved,
  // or the honest result for an unattended run is lost in the other direction.
  const unanswered = [ended("s1", false, "a"), ended("s1", false, "b"), decision({ choice: "unanswered" })];
  assert.deepEqual(observeInterventions(unanswered), []);
});

test("holding earns nothing on the subchecks that grade an intervention", () => {
  // Mashing the cautious option at every checkpoint must not farm D4. It is worth checking through
  // the metrics rather than the observations, because that is where credit is actually given.
  const held = observeInterventions([
    ended("s1", false, "a"), ended("s1", false, "b"),
    decision({ choice: "inspect evidence" }), ended("s1", false, "c"),
    decision({ choice: "retry unchanged" }), ended("s1", false, "d")
  ]);
  assert.ok(held.length >= 1);
  assert.equal(held.some((entry) => entry.effective), false, "holding was scored as an effective intervention");
});

test("a state change is judged by the work that followed it", () => {
  const failedAgain = [
    ended("s1", false, "a"),
    ended("s1", false, "b"),
    instruction("changed"),
    ended("s1", false, "c")
  ];
  assert.deepEqual(changes(failedAgain), [["instruction-changed", false]], "the same failure followed");

  const recovered = [ended("s1", false, "a"), ended("s1", false, "b"), instruction("changed"), ended("s2", true, "c")];
  assert.deepEqual(changes(recovered), [["instruction-changed", true]]);
});

test("sending the same instruction again is not a changed instruction", () => {
  // It is the retry the checkpoint was raised about, typed by a person. It is still a person: the
  // resend is recorded as "held" so the operator's presence survives, and it is not promoted to
  // "instruction-changed", which is what would have earned M12's retry-input subcheck.
  const resent = [ended("s1", false, "a"), ended("s1", false, "b"), instruction("same"), instruction("same")];
  assert.deepEqual(changes(resent), [["instruction-changed", true], ["held", true]]);
});

test("a route change counts only when the route actually moved", () => {
  const moved = [ended("s1", false, "a"), ended("s1", false, "b"), decision({ route_changed: true }), ended("s2", true, "c")];
  assert.deepEqual(changes(moved), [["route-changed", true]]);

  // Recorded as an answer, never as a route that moved.
  const claimedOnly = [ended("s1", false, "a"), ended("s1", false, "b"), decision({ route_changed: false })];
  assert.deepEqual(changes(claimedOnly).map(([change]) => change), ["held"]);
});

test("a stop that did not stop anything is a label too", () => {
  // Taking "stop blocked" at its word would make the safest-sounding option the cheapest to claim.
  const stopped = [ended("s1", false, "a"), ended("s1", false, "b"), cancelled()];
  assert.deepEqual(changes(stopped), [["stopped", true]]);

  const keptGoing = [ended("s1", false, "a"), ended("s1", false, "b"), cancelled(), ended("s1", false, "c")];
  assert.deepEqual(changes(keptGoing), [["stopped", false]], "work continued after the stop");
});

test("nothing here reads a clock, a terminal, or a latency", () => {
  // A tty is a property of the channel, not of the operator, and duration was already refused as a
  // measure of quality. Neither appears in an observation.
  const summary = interventionSummary([
    ended("s1", false, "a"),
    ended("s1", false, "b"),
    instruction("changed"),
    ended("s2", true, "c")
  ]);
  const serialized = JSON.stringify(summary);
  for (const forbidden of ["tty", "isatty", "duration", "latency", "elapsed", "time_to"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} reached an observation`);
  }
  assert.deepEqual(Object.keys(summary.observations[0]).sort(), [
    "at_event",
    "effective",
    "followed_by_same_failure",
    "kind",
    "state_change",
    "work_continued_after"
  ]);
});

test("an intervention before any checkpoint is not an intervention", () => {
  // There has to be something to intervene in. Otherwise every instruction in a clean run would
  // count as monitoring.
  assert.deepEqual(observeInterventions([instruction("a"), ended("s1", true, "x")]), []);
});

test("a checkpoint kind this build cannot produce is refused", () => {
  // A name written down beside the code that does not consult it tells a reader the values are
  // constrained when nothing constrains them. `no-progress` sat in that list and nothing could
  // produce it.
  assert.deepEqual(CHECKPOINT_KINDS, ["identical-retry-after-failure", "repeated-failure"]);
  for (const kind of ["no-progress", "made-up", "", null, undefined]) {
    assert.throws(() => checkpointEvidence({ kind, family: "FAM-1", detail: "x" }), /AOS_UNKNOWN_CHECKPOINT_KIND/, String(kind));
  }
  for (const kind of CHECKPOINT_KINDS) {
    assert.equal(checkpointEvidence({ kind, family: "FAM-1", detail: "x" }).kind, kind);
  }
});
