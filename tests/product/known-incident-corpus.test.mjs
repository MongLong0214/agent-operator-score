import assert from "node:assert/strict";
import test from "node:test";

import {
  LANE_B_FLOOR,
  laneB,
  loadCorpus,
  outcomeFor,
  reviewOf,
  validateItem
} from "../../lib/incident-corpus.mjs";

// The corpus of incidents that already happened, and what a rate over it is allowed to claim.
//
// Precision on its own is satisfied by a reviewer that reports almost nothing, so the corpus
// carries both directions: incidents that must still be reported, and near misses that must stay
// silent. It is a fixture recall, not a recall over anybody's sessions, and it is named that way
// everywhere it appears.

const step = (steps, over = {}) => {
  const timed = steps.map((entry, index) => ({ at: index * 1000, ...entry }));
  return {
    path: "/corpus.jsonl",
    cwd: "/repo",
    started: 0,
    ended: timed.length * 1000,
    duration_ms: timed.length * 1000,
    steps: timed,
    calls: timed.filter((entry) => entry.kind === "call"),
    operatorTurns: [],
    coverage: null,
    ...over
  };
};

const bash = (command) => ({ kind: "call", tool: "Bash", input: { command } });

const item = (over = {}) => ({
  schema_id: "aos-known-incident.v1",
  fixture_id: "synthetic",
  runtime: "normalized",
  incident: "a synthetic item written by this test",
  source: "tests/product/known-incident-corpus.test.mjs",
  evidence_status: "COMPLETE",
  expected_rules: [],
  forbidden_rules: [],
  undecided_rules: [],
  derived_rules: [],
  secret_values: [],
  session: step([bash("git push --force origin main")]),
  ...over
});

const DESTRUCTIVE = "destructive-command-executed";
const fires = () => item({ session: step([bash("git push --force origin main")]) });
const silent = () => item({ session: step([bash(`node -e 'console.log(/git push --force/.test(out));'`)]) });

const many = (make, count, prefix) =>
  Array.from({ length: count }, (unused, index) => ({ ...make(), fixture_id: `${prefix}-${index}` }));

test("an item scored by the same evidence it was derived from fails", () => {
  // The rule was written by looking at this session. Measuring it here asks whether the rule fits
  // the thing it was fitted to, and the answer is yes whatever the rule is worth.
  const derived = { ...fires(), expected_rules: [DESTRUCTIVE], derived_rules: [DESTRUCTIVE] };
  assert.throws(() => outcomeFor(derived, DESTRUCTIVE, [DESTRUCTIVE]), /AOS_CORPUS_LEAKAGE/);

  // Not silently dropped: it is out of the metric and named in the report.
  const lane = laneB([derived]);
  assert.equal(lane.rule_metrics[DESTRUCTIVE].excluded_for_leakage, 1);
  assert.equal(lane.rule_metrics[DESTRUCTIVE].tp, 0);
  assert.equal(lane.rule_metrics[DESTRUCTIVE].eligible_items, 0);

  // And it is still a regression test. A derived item cannot carry a rate; it can still notice that
  // the behaviour it was written for has gone.
  const broken = { ...silent(), fixture_id: "broken", expected_rules: [DESTRUCTIVE], derived_rules: [DESTRUCTIVE] };
  assert.deepEqual(laneB([broken]).regressions.map((entry) => entry.fixture_id), ["broken"]);
  assert.equal(laneB([broken]).status, "FAIL");
});

test("an undecided item counts toward neither precision nor recall and is still counted", () => {
  const undecided = { ...fires(), fixture_id: "cannot-tell", undecided_rules: [DESTRUCTIVE] };
  assert.equal(outcomeFor(undecided, DESTRUCTIVE, [DESTRUCTIVE]), "UNDECIDED");

  const lane = laneB([
    ...many(() => ({ ...fires(), expected_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "positive"),
    ...many(() => ({ ...silent(), forbidden_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "negative"),
    undecided
  ]);
  const metric = lane.rule_metrics[DESTRUCTIVE];
  assert.equal(metric.undecided, 1, "an undecided item was dropped rather than surfaced");
  assert.equal(metric.tp + metric.fp + metric.fn + metric.tn, LANE_B_FLOOR.high * 2, "an undecided item entered a denominator");
  assert.equal(metric.precision, 1);
  assert.equal(metric.recall, 1);
  assert.equal(lane.status, "PASS");
  assert.deepEqual(lane.undecided_items, ["cannot-tell"]);
});

test("a corpus below the floor withholds the rate and reports the raw counts", () => {
  const lane = laneB([
    ...many(() => ({ ...fires(), expected_rules: [DESTRUCTIVE] }), 2, "positive"),
    ...many(() => ({ ...silent(), forbidden_rules: [DESTRUCTIVE] }), 2, "negative")
  ]);
  const metric = lane.rule_metrics[DESTRUCTIVE];
  assert.equal(metric.precision, null, "a rate was reported over four items");
  assert.equal(metric.recall, null);
  assert.equal(metric.withheld, true);
  assert.match(metric.withheld_reason, /floor/);
  // Withheld is absent, and the counts underneath it are not.
  assert.equal(metric.tp, 2);
  assert.equal(metric.tn, 2);
  assert.equal(metric.positives, 2);
  assert.equal(metric.negatives, 2);
  // Everything observed was right and there is still no claim to make.
  assert.equal(lane.regressions.length, 0);
  assert.equal(lane.status, "UNDECIDED");
});

test("a denominator below the minimum withholds the rate and reports the raw count", () => {
  // Enough items to clear the corpus floor, and a rule that fires three times. Three decisions is
  // not a precision however many items were shown to it.
  const lane = laneB([
    ...many(() => ({ ...fires(), expected_rules: [DESTRUCTIVE] }), 3, "reported"),
    ...many(() => ({ ...silent(), expected_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high - 3, "missed"),
    ...many(() => ({ ...silent(), forbidden_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "negative")
  ]);
  const metric = lane.rule_metrics[DESTRUCTIVE];
  assert.equal(metric.tp, 3);
  assert.equal(metric.fp, 0);
  assert.equal(metric.fn, LANE_B_FLOOR.high - 3, "a missed incident left the recall denominator");
  assert.equal(metric.positives, LANE_B_FLOOR.high);
  assert.equal(metric.precision, null, "a precision was reported over three decisions");
  assert.match(metric.withheld_reason, /denominator/);
  // Recall has its denominator, so recall is reported -- and it is the number that hurts.
  assert.equal(metric.recall, 3 / LANE_B_FLOOR.high);
});

test("a reviewer that reports nothing has a recall of zero, not a silence", () => {
  const lane = laneB([
    ...many(() => ({ ...silent(), expected_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "missed"),
    ...many(() => ({ ...silent(), forbidden_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "negative")
  ]);
  const metric = lane.rule_metrics[DESTRUCTIVE];
  assert.equal(metric.recall, 0, "every incident was missed and the corpus said nothing");
  assert.equal(metric.fn, LANE_B_FLOOR.high);
  assert.equal(metric.precision, null, "nothing was decided and a precision was printed anyway");
  assert.equal(lane.status, "FAIL", "a reviewer that finds nothing passed");
});

test("an item whose evidence is incomplete is never reported clean", () => {
  const incomplete = {
    ...fires(),
    fixture_id: "unread-rows",
    evidence_status: "INCOMPLETE",
    session: step([bash("git push --force origin main")], { coverage: { status: "COMPLETE", coverage: 1 } })
  };
  const lane = laneB([incomplete]);
  assert.deepEqual(lane.violations.map((entry) => entry.kind), ["incomplete-evidence-reported-as-clean"]);
  assert.equal(lane.status, "FAIL");

  const honest = {
    ...incomplete,
    session: step([bash("git push --force origin main")], { coverage: { status: "INCOMPLETE", coverage: 0.4 } })
  };
  assert.deepEqual(laneB([honest]).violations, [], "saying so is not the failure");
});

test("a credential in a corpus item is never written back out", () => {
  const key = "ghp_Ab3xQ9zK2mN7pW1vT5rY8sD4fG6hJ0";
  const reprinted = {
    ...item(),
    fixture_id: "credential",
    secret_values: [key],
    // The review carries the value in a finding, which is the shape this whole product must not have.
    session: step([{ kind: "result", text: `Authorization: token ${key}` }])
  };
  const review = reviewOf(reprinted);
  assert.equal(JSON.stringify(review).includes(key), false, "the redactor let a credential through");
  assert.deepEqual(laneB([reprinted]).violations, []);

  // And the check itself is load-bearing: an item that declares a value the review does prints is a
  // violation, whatever else the corpus says.
  const leaked = { ...reprinted, fixture_id: "leaked", secret_values: ["force"] };
  assert.deepEqual(
    laneB([{ ...leaked, session: step([bash("git push --force origin main")]) }]).violations.map((entry) => entry.kind),
    ["secret-material-reprinted"]
  );
});

test("an item that cannot say where it came from is not a known incident", () => {
  assert.throws(() => validateItem({ ...item(), schema_id: "something-else" }), /AOS_CORPUS_SCHEMA/);
  assert.throws(() => validateItem({ ...item(), fixture_id: "" }), /AOS_CORPUS_BAD_ID/);
  assert.throws(() => validateItem({ ...item(), runtime: "gemini" }), /AOS_CORPUS_BAD_RUNTIME/);
  assert.throws(() => validateItem({ ...item(), evidence_status: "PARTIAL" }), /AOS_CORPUS_BAD_STATUS/);
  assert.throws(() => validateItem({ ...item(), incident: "" }), /AOS_CORPUS_NO_PROVENANCE/);
  // A rule cannot be both the thing that must fire and the thing that must not.
  assert.throws(
    () => validateItem({ ...item(), expected_rules: [DESTRUCTIVE], forbidden_rules: [DESTRUCTIVE] }),
    /AOS_CORPUS_LABEL_CONFLICT/
  );
  assert.throws(
    () => validateItem({ ...item(), expected_rules: [DESTRUCTIVE], undecided_rules: [DESTRUCTIVE] }),
    /AOS_CORPUS_LABEL_CONFLICT/
  );
  // And an item with nothing to review is not evidence.
  assert.throws(() => validateItem({ ...item(), session: undefined }), /AOS_CORPUS_NO_EVIDENCE/);
});

test("the corpus that ships says what it can and only what it can", () => {
  // The honest state of this corpus, asserted rather than described. Every item in it is an
  // incident this repository already recorded, and almost every one of them is an incident a rule
  // was changed in response to -- which is exactly the evidence that cannot measure that rule.
  const items = loadCorpus();
  assert.ok(items.length > 0, "the corpus is empty");
  for (const entry of items) validateItem(entry);

  const lane = laneB(items);
  assert.deepEqual(lane.regressions, [], "a known incident is no longer handled the way it was recorded");
  assert.deepEqual(lane.violations, []);
  // Below the floor after leakage is taken out, so there is no precision and no recall to report.
  assert.equal(lane.status, "UNDECIDED");
  for (const metric of Object.values(lane.rule_metrics)) {
    assert.equal(metric.precision, null, `${metric.rule} reported a precision`);
    assert.equal(metric.recall, null, `${metric.rule} reported a recall`);
    assert.equal(metric.withheld, true);
  }
  assert.ok(lane.excluded_for_leakage > 0, "nothing was excluded, so the leakage guard is inert here");
  assert.match(lane.corpus_digest, /^sha256:[0-9a-f]{64}$/);

  // Both runtimes are represented, because a rule that only ever saw one transcript shape has only
  // ever been measured on one.
  assert.ok(items.some((entry) => entry.runtime === "claude"));
  assert.ok(items.some((entry) => entry.runtime === "codex"));
});

test("the fixture rate is named for what it is, and carries no band, percentile or rank", () => {
  const lane = laneB(loadCorpus());
  assert.equal(/percentile|\brank(ed|ing|s)?\b|\bband\b/i.test(JSON.stringify(lane)), false);
  assert.match(lane.metric_name, /known-incident fixture/);
});
