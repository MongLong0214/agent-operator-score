import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DESTRUCTIVE = "destructive-command-executed";

// Every item below carries evidence nothing else in its corpus carries. `laneB` refuses a corpus
// that holds the same evidence twice, and it is right to: an earlier version of these helpers
// cleared a floor of ten with ten copies of one session under ten fixture ids, which is the exact
// shape the floor exists to refuse. The tag is what makes each one a different session.
const fires = (tag) => item({ session: step([bash(`git push --force origin ${tag}`)]) });
const silent = (tag) => item({ session: step([bash(`node -e 'console.log(/git push --force ${tag}/.test(out));'`)]) });

const many = (make, count, prefix) =>
  Array.from({ length: count }, (unused, index) => ({ ...make(`${prefix}-${index}`), fixture_id: `${prefix}-${index}` }));

test("an item scored by the same evidence it was derived from fails", () => {
  // The rule was written by looking at this session. Measuring it here asks whether the rule fits
  // the thing it was fitted to, and the answer is yes whatever the rule is worth.
  const derived = { ...fires("derived"), expected_rules: [DESTRUCTIVE], derived_rules: [DESTRUCTIVE] };
  assert.throws(() => outcomeFor(derived, DESTRUCTIVE, [DESTRUCTIVE]), /AOS_CORPUS_LEAKAGE/);

  // Not silently dropped: it is out of the metric and named in the report.
  const lane = laneB([derived]);
  assert.equal(lane.rule_metrics[DESTRUCTIVE].excluded_for_leakage, 1);
  assert.equal(lane.rule_metrics[DESTRUCTIVE].tp, 0);
  assert.equal(lane.rule_metrics[DESTRUCTIVE].eligible_items, 0);

  // And it is still a regression test. A derived item cannot carry a rate; it can still notice that
  // the behaviour it was written for has gone.
  const broken = { ...silent("broken"), fixture_id: "broken", expected_rules: [DESTRUCTIVE], derived_rules: [DESTRUCTIVE] };
  assert.deepEqual(laneB([broken]).regressions.map((entry) => entry.fixture_id), ["broken"]);
  assert.equal(laneB([broken]).status, "FAIL");
});

test("an undecided item counts toward neither precision nor recall and is still counted", () => {
  const undecided = { ...fires("cannot-tell"), fixture_id: "cannot-tell", undecided_rules: [DESTRUCTIVE] };
  assert.equal(outcomeFor(undecided, DESTRUCTIVE, [DESTRUCTIVE]), "UNDECIDED");

  const lane = laneB([
    ...many((tag) => ({ ...fires(tag), expected_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "positive"),
    ...many((tag) => ({ ...silent(tag), forbidden_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "negative"),
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
    ...many((tag) => ({ ...fires(tag), expected_rules: [DESTRUCTIVE] }), 2, "positive"),
    ...many((tag) => ({ ...silent(tag), forbidden_rules: [DESTRUCTIVE] }), 2, "negative")
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
    ...many((tag) => ({ ...fires(tag), expected_rules: [DESTRUCTIVE] }), 3, "reported"),
    ...many((tag) => ({ ...silent(tag), expected_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high - 3, "missed"),
    ...many((tag) => ({ ...silent(tag), forbidden_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "negative")
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
    ...many((tag) => ({ ...silent(tag), expected_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "missed"),
    ...many((tag) => ({ ...silent(tag), forbidden_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "negative")
  ]);
  const metric = lane.rule_metrics[DESTRUCTIVE];
  assert.equal(metric.recall, 0, "every incident was missed and the corpus said nothing");
  assert.equal(metric.fn, LANE_B_FLOOR.high);
  assert.equal(metric.precision, null, "nothing was decided and a precision was printed anyway");
  assert.equal(lane.status, "FAIL", "a reviewer that finds nothing passed");
});

test("an item whose evidence is incomplete is never reported clean", () => {
  const incomplete = {
    ...fires("unread-rows"),
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

const STALE = "session-ended-on-stale-evidence";
const edit = (path) => ({ kind: "call", tool: "Edit", input: { file_path: path } });
// The same rule at both of its severities: medium after one edit since the last verification, high
// after four. Which one the corpus sees first used to decide the floor for every item.
const stale = (tag, edits) =>
  item({ session: step([bash(`npm test ${tag}`), ...Array.from({ length: edits }, (unused, index) => edit(`/repo/src/${tag}-${index}.ts`))]) });
const fresh = (tag) => item({ session: step([edit(`/repo/src/${tag}.ts`), bash(`npm test ${tag}`)]) });

test("the floor follows the worst severity a rule was seen at, not the first one", () => {
  // The reviewer's case, and it was real: five positives and five negatives cleared a floor of five
  // and published precision 1.000 and recall 1.000 when the medium item happened to sort first, and
  // were withheld under a floor of ten when the high one did. The corpus was the same corpus. What
  // moved was the order of the directory listing, so a rate could be published by renaming a file.
  const positives = [
    { ...stale("high-first", 4), fixture_id: "p-high", expected_rules: [STALE] },
    ...Array.from({ length: 4 }, (unused, index) => ({ ...stale(`medium-${index}`, 1), fixture_id: `p-medium-${index}`, expected_rules: [STALE] }))
  ];
  const negatives = Array.from({ length: 5 }, (unused, index) => ({ ...fresh(`clean-${index}`), fixture_id: `n-${index}`, forbidden_rules: [STALE] }));

  const highFirst = laneB([...positives, ...negatives]).rule_metrics[STALE];
  const mediumFirst = laneB([...positives.slice(1), positives[0], ...negatives]).rule_metrics[STALE];

  assert.equal(highFirst.severity, "high");
  assert.equal(mediumFirst.severity, "high", "the floor moved with the order the items were read in");
  assert.equal(highFirst.floor, LANE_B_FLOOR.high);
  assert.equal(mediumFirst.floor, LANE_B_FLOOR.high);
  // Five in each direction is below the high floor either way round, so no rate is published either
  // way round. Before the fix the second of these was a precision of 1.000.
  assert.equal(highFirst.precision, null);
  assert.equal(mediumFirst.precision, null);
  assert.equal(mediumFirst.recall, null);
});

test("the same evidence twice is one incident, and a corpus that holds it twice is refused", () => {
  // Ten copies of one positive and ten of one negative used to clear a floor of ten in each
  // direction and publish precision 1.000 and recall 1.000 over two distinct sessions.
  const copies = Array.from({ length: LANE_B_FLOOR.high }, (unused, index) => ({
    ...fires("one-shape"), fixture_id: `copy-${index}`, expected_rules: [DESTRUCTIVE]
  }));
  assert.throws(() => laneB(copies), /AOS_CORPUS_DUPLICATE_EVIDENCE/);
  // And the refusal names both items, because "a duplicate exists" is not enough to go and fix it.
  assert.throws(() => laneB(copies), /copy-0 copy-1/);

  // A different session with the same labels is not a copy.
  assert.equal(laneB([
    ...many((tag) => ({ ...fires(tag), expected_rules: [DESTRUCTIVE] }), 2, "distinct")
  ]).rule_metrics[DESTRUCTIVE].tp, 2);
});

test("a corpus cannot buy a rate with the items it could not label", () => {
  // The Lane A rule, on the side that did not have it. Ten positives, ten negatives and a thousand
  // items that could say nothing cleared the floor in both directions and published precision 1.000
  // and recall 1.000 -- a rate over the twenty somebody could label, reported by a corpus that was
  // 98% abstention. Every one of the thousand is a distinct session, so neither the duplicate
  // evidence check nor the duplicate id check has anything to say about it.
  const abstentions = Array.from({ length: 1000 }, (unused, index) => ({
    ...fires(`cannot-tell-${index}`), fixture_id: `cannot-tell-${index}`, undecided_rules: [DESTRUCTIVE]
  }));
  const decided = [
    ...many((tag) => ({ ...fires(tag), expected_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "positive"),
    ...many((tag) => ({ ...silent(tag), forbidden_rules: [DESTRUCTIVE] }), LANE_B_FLOOR.high, "negative")
  ];

  const swamped = laneB([...decided, ...abstentions]).rule_metrics[DESTRUCTIVE];
  assert.equal(swamped.undecided, 1000);
  assert.equal(swamped.decided_items, LANE_B_FLOOR.high * 2);
  assert.equal(swamped.abstention_met, false);
  assert.equal(swamped.precision, null, "a rate was published over the cases somebody could label");
  assert.equal(swamped.recall, null);
  assert.match(swamped.withheld_reason, /could not be labelled/);
  assert.equal(laneB([...decided, ...abstentions]).status, "UNDECIDED");

  // The counts are still there, and at the line the rate comes back: twenty decided carries twenty
  // undecided, because withholding a rate is not withholding the evidence either way round.
  const atTheLine = laneB([...decided, ...abstentions.slice(0, LANE_B_FLOOR.high * 2)]).rule_metrics[DESTRUCTIVE];
  assert.equal(atTheLine.abstention_met, true);
  assert.equal(atTheLine.precision, 1);
  assert.equal(atTheLine.recall, 1);
});

test("two items cannot share a fixture id, because one review would score both", () => {
  // The reviews are stored under the fixture id, so a repeated id meant the last item's review was
  // the one every item with that id was scored against. Nine silent expected items and one firing
  // one under a single id scored ten true positives off the one that fired; the same trick in the
  // other direction scored ten true negatives. Twenty items, eighteen of them contradicting their
  // own labels, precision 1.000, recall 1.000, PASS. Every digest was distinct, so the
  // duplicate-evidence check saw nothing wrong.
  const positives = [
    ...Array.from({ length: 9 }, (unused, index) => ({ ...silent(`p-${index}`), fixture_id: "p", expected_rules: [DESTRUCTIVE] })),
    { ...fires("p-last"), fixture_id: "p", expected_rules: [DESTRUCTIVE] }
  ];
  const negatives = [
    ...Array.from({ length: 9 }, (unused, index) => ({ ...fires(`n-${index}`), fixture_id: "n", forbidden_rules: [DESTRUCTIVE] })),
    { ...silent("n-last"), fixture_id: "n", forbidden_rules: [DESTRUCTIVE] }
  ];
  assert.throws(() => laneB([...positives, ...negatives]), /AOS_CORPUS_DUPLICATE_ID p/);
  // And it is refused before anything is scored, rather than caught by the arithmetic afterwards.
  assert.throws(() => laneB([positives[0], positives[1]]), /AOS_CORPUS_DUPLICATE_ID/);
});

test("no eligible decided evidence is reported as none, not as a small number", () => {
  // Zero and "nearly ten" are different states and the report said the same sentence for both.
  const onlyDerived = [
    { ...fires("derived-a"), fixture_id: "derived-a", expected_rules: [DESTRUCTIVE], derived_rules: [DESTRUCTIVE] },
    { ...silent("derived-b"), fixture_id: "derived-b", forbidden_rules: [DESTRUCTIVE], derived_rules: [DESTRUCTIVE] }
  ];
  const lane = laneB(onlyDerived);
  assert.equal(lane.eligible_decided_pairs, 0);
  assert.equal(lane.rule_metrics[DESTRUCTIVE].decided_items, 0);
  assert.match(lane.rule_metrics[DESTRUCTIVE].withheld_reason, /no eligible decided evidence/);
  assert.equal(lane.status, "UNDECIDED");

  // One eligible decided item is a different sentence: there is evidence and there is not enough.
  const some = laneB([...onlyDerived, { ...fires("eligible"), fixture_id: "eligible", expected_rules: [DESTRUCTIVE] }]);
  assert.equal(some.eligible_decided_pairs, 1);
  assert.match(some.rule_metrics[DESTRUCTIVE].withheld_reason, /below the corpus floor/);
});

test("every path a shipped item names as its source is a path that exists", () => {
  // `derived_rules` cannot be checked from here -- there is no independent history to test it
  // against -- but the provenance an item claims can at least be made falsifiable. A source that
  // names a file nobody can open is a citation that was never checked by anything.
  for (const entry of loadCorpus()) {
    const paths = entry.source.match(/(?:lib|tests|docs|fixtures|bin|scripts)\/[A-Za-z0-9_./-]+/g) ?? [];
    assert.ok(paths.length > 0, `${entry.fixture_id} cites no path at all`);
    for (const path of paths) {
      assert.ok(existsSync(join(root, path)), `${entry.fixture_id} cites ${path}, which does not exist`);
    }
  }
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
  //
  // What this test is, and is not. It checks the corpus against the labels in the corpus, and both
  // were written by the same person in the same change: it is a consistency check, not a
  // correctness one. It would pass over a mislabelled item as readily as over a right one, and no
  // check here can do better, because the thing a label would have to be checked against -- what
  // actually happened in the incident -- exists only in sessions that are not in this repository
  // and must never be. The leakage rule has the same shape one level down: `derived_rules` is a
  // declaration about provenance and this suite can only test that the declaration was honoured,
  // never that it was true. Read a green run here as "the corpus still says what it said", and
  // nothing more.
  const items = loadCorpus();
  assert.ok(items.length > 0, "the corpus is empty");
  for (const entry of items) validateItem(entry);

  const lane = laneB(items);
  assert.deepEqual(lane.regressions, [], "a known incident is no longer handled the way it was recorded");
  assert.deepEqual(lane.violations, []);
  // Not "below the floor": zero. Every decided label in this corpus is on an item the rule it
  // labels was changed in response to, so after the leakage exclusion there is nothing left to
  // count in either direction. That is a stronger statement than a small sample and the report has
  // to be able to make it, because "nearly enough evidence" and "no evidence" are different states.
  assert.equal(lane.status, "UNDECIDED");
  assert.equal(lane.eligible_decided_pairs, 0, "the shipped corpus has eligible decided evidence and the floor is now what withholds it");
  for (const metric of Object.values(lane.rule_metrics)) {
    assert.match(metric.withheld_reason, /no eligible decided evidence/);
  }
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
