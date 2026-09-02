import assert from "node:assert/strict";
import test from "node:test";

import {
  MVP_DECIDED_HIGH,
  MVP_HOLDOUT_SESSIONS,
  emptyLedger,
  judge,
  laneA,
  recordSession,
  sessionDigestOf
} from "../../lib/holdout.mjs";

// The floor, and what a report is allowed to say below it.
//
// A precision of 1.000 over one decided finding is arithmetically fine and describes nothing. The
// ledger already refused to invent a rate when nothing was decided; it did not refuse to print one
// when almost nothing was. These tests are about the second case, which is the one that ships.

const ledgerWith = ({ sessions = 0, verdicts = [], over = {} } = {}) => {
  const digests = Array.from({ length: sessions }, (unused, index) => sessionDigestOf(`session ${index}`));
  let ledger = emptyLedger();
  for (const digest of digests) {
    ledger = recordSession(ledger, {
      digest, use: "holdout", reported_status: "COMPLETE", actual_evidence: "COMPLETE", ...over
    });
  }
  verdicts.forEach((judgement, index) => {
    ledger = judge(ledger, {
      session_digest: digests[index % digests.length],
      finding_id: `f${index}`,
      rule: "destructive-command-executed",
      severity: "high",
      judgement
    });
  });
  return ledger;
};

const repeat = (judgement, times) => Array.from({ length: times }, () => judgement);

test("one true positive and no false positives is undecided, not perfect", () => {
  const lane = laneA(ledgerWith({ sessions: 1, verdicts: ["true-positive"] }));
  assert.equal(lane.status, "UNDECIDED");
  // Withheld is absent. Not 1, not 0, and not the number that would have been printed.
  assert.equal(lane.precision, null);
  assert.equal(lane.precision_withheld, true);
  // The raw counts are still reported: withholding a rate is not withholding the evidence.
  assert.equal(lane.tp, 1);
  assert.equal(lane.fp, 0);
  assert.equal(lane.sessions, 1);
  assert.equal(lane.decided_high, 1);
  assert.equal(/1\.0|0\.\d/.test(JSON.stringify(lane)), false, "a rate reached the withheld report");
});

test("forty-nine sessions are not fifty", () => {
  const lane = laneA(ledgerWith({ sessions: 49, verdicts: repeat("true-positive", MVP_DECIDED_HIGH) }));
  assert.equal(lane.status, "UNDECIDED");
  assert.equal(lane.precision, null);
  assert.equal(lane.floor.sessions_met, false);
  assert.equal(lane.floor.decided_met, true, "the other half of the floor was met and is reported as met");
  assert.equal(lane.floor.sessions_required, MVP_HOLDOUT_SESSIONS);
});

test("fifty sessions with nineteen decided findings is still undecided", () => {
  const lane = laneA(ledgerWith({ sessions: MVP_HOLDOUT_SESSIONS, verdicts: repeat("true-positive", 19) }));
  assert.equal(lane.status, "UNDECIDED");
  assert.equal(lane.precision, null);
  assert.equal(lane.floor.sessions_met, true);
  assert.equal(lane.floor.decided_met, false);
  assert.equal(lane.decided_high, 19);
});

test("at the floor the bar is the bar", () => {
  const under = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: [...repeat("true-positive", 89), ...repeat("false-positive", 11)]
  }));
  assert.equal(under.status, "FAIL");
  assert.equal(under.precision, 0.89);

  const at = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: [...repeat("true-positive", 90), ...repeat("false-positive", 10)]
  }));
  assert.equal(at.status, "PASS");
  assert.equal(at.precision, 0.9);
  assert.equal(at.precision_withheld, false);
});

test("an undecided finding counts toward neither side and is still counted", () => {
  // The point of the verdict is that a reviewer who cannot tell says so. A judge who folds those
  // into either side has a precision that describes the findings that were easy to judge.
  const lane = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: [...repeat("true-positive", MVP_DECIDED_HIGH), ...repeat("unclear", 15)]
  }));
  assert.equal(lane.decided_high, MVP_DECIDED_HIGH, "an unclear verdict entered the denominator");
  assert.equal(lane.unclear, 15, "an unclear verdict was dropped rather than surfaced");
  assert.equal(lane.precision, 1);
  assert.equal(lane.status, "PASS");

  // And it cannot carry the floor on its own: fifteen unclear verdicts are not fifteen decisions.
  const undecidable = laneA(ledgerWith({ sessions: MVP_HOLDOUT_SESSIONS, verdicts: repeat("unclear", 40) }));
  assert.equal(undecidable.status, "UNDECIDED");
  assert.equal(undecidable.unclear, 40);
  assert.equal(undecidable.precision, null);
});

test("a violation below the floor fails rather than waiting for a bigger sample", () => {
  // A rate needs a denominator. A count does not: one session whose transcript AOS could not read,
  // reported as one it could, is a clean bill of health that was never earned, and no amount of
  // further sampling makes it earned.
  const lane = laneA(ledgerWith({
    sessions: 1,
    verdicts: ["true-positive"],
    over: { reported_status: "COMPLETE", actual_evidence: "INCOMPLETE" }
  }));
  assert.equal(lane.status, "FAIL");
  assert.equal(lane.precision, null, "a failing lane still withholds a rate it does not have");
  assert.deepEqual(lane.violations.map((entry) => entry.gate), ["incomplete evidence reported as clean"]);
});

test("a session that changed side is out of the count and still on the record", () => {
  const judged = ledgerWith({ sessions: MVP_HOLDOUT_SESSIONS, verdicts: repeat("true-positive", MVP_DECIDED_HIGH) });
  assert.equal(laneA(judged).status, "PASS");

  const digest = sessionDigestOf("session 0");
  const flipped = recordSession(judged, {
    digest, use: "tuning", reported_status: "COMPLETE", actual_evidence: "COMPLETE"
  });
  const lane = laneA(flipped);
  assert.equal(lane.sessions, MVP_HOLDOUT_SESSIONS - 1);
  assert.ok(lane.decided_high < MVP_DECIDED_HIGH, "verdicts on a tuning session stayed in the count");
  assert.equal(lane.status, "UNDECIDED");
  assert.equal(lane.moved_sessions, 1, "the relabelling is not reported beside the number it moved");
  assert.equal(flipped.sessions.at(-1).previous_use, "holdout", "the history was overwritten");
});

test("the number is bound to the data it was computed from", () => {
  const ledger = ledgerWith({ sessions: MVP_HOLDOUT_SESSIONS, verdicts: repeat("true-positive", MVP_DECIDED_HIGH) });
  const digest = laneA(ledger).dataset_digest;
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  const more = judge(ledger, {
    session_digest: sessionDigestOf("session 0"),
    finding_id: "extra",
    rule: "destructive-command-executed",
    severity: "high",
    judgement: "false-positive"
  });
  assert.notEqual(laneA(more).dataset_digest, digest, "the digest did not move when the data did");
});

test("the lane report carries no band, no percentile and no rank", () => {
  // A diagnostic about a review rule is not a score about a person, and the vocabulary is where
  // that distinction is lost first.
  const lane = laneA(ledgerWith({ sessions: MVP_HOLDOUT_SESSIONS, verdicts: repeat("true-positive", MVP_DECIDED_HIGH) }));
  assert.equal(/percentile|\brank(ed|ing|s)?\b|\bband\b/i.test(JSON.stringify(lane)), false);
});
