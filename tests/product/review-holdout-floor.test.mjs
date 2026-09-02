import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LANE_A_SCHEMA,
  MVP_DECIDED_HIGH,
  MVP_DECIDED_SESSIONS,
  MVP_HOLDOUT_SESSIONS,
  emptyLedger,
  judge,
  laneA,
  recordSession,
  sessionDigestOf
} from "../../lib/holdout.mjs";
import { laneReport } from "../../lib/review-lanes.mjs";

// The floor, and what a report is allowed to say below it.
//
// A precision of 1.000 over one decided finding is arithmetically fine and describes nothing. The
// ledger already refused to invent a rate when nothing was decided; it did not refuse to print one
// when almost nothing was. These tests are about the second case, which is the one that ships.

const ledgerWith = ({ sessions = 0, verdicts = [], over = {}, into = null } = {}) => {
  const digests = Array.from({ length: sessions }, (unused, index) => sessionDigestOf(Buffer.from(`session ${index}`, "utf8")));
  let ledger = emptyLedger();
  for (const digest of digests) {
    ledger = recordSession(ledger, {
      digest, use: "holdout", reported_status: "COMPLETE", actual_evidence: "COMPLETE", ...over
    });
  }
  verdicts.forEach((judgement, index) => {
    ledger = judge(ledger, {
      // `into` concentrates every verdict in the first few sessions. The default spreads them, which
      // is what a real holdout does and what the floor now requires.
      session_digest: digests[index % Math.min(into ?? digests.length, digests.length)],
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

test("twenty decisions inside one session is a fact about one session", () => {
  // Fifty sessions and twenty decisions were both satisfied while forty-nine of the sessions
  // contributed nothing, so the sessions figure was decoration: it counted what was held back, not
  // what was decided. A precision quoted about a reviewer is a claim across sessions.
  const concentrated = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: repeat("true-positive", MVP_DECIDED_HIGH),
    into: 1
  }));
  assert.equal(concentrated.status, "UNDECIDED");
  assert.equal(concentrated.precision, null);
  assert.equal(concentrated.decided_sessions, 1);
  assert.equal(concentrated.floor.sessions_met, true, "the other two figures were met and are reported as met");
  assert.equal(concentrated.floor.decided_met, true);
  assert.equal(concentrated.floor.decided_sessions_met, false);
  assert.match(concentrated.withheld_reason, /fewer than 10 sessions/);

  // One short of the required spread is still short.
  const nearly = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: repeat("true-positive", MVP_DECIDED_HIGH),
    into: MVP_DECIDED_SESSIONS - 1
  }));
  assert.equal(nearly.status, "UNDECIDED");
  assert.equal(nearly.decided_sessions, MVP_DECIDED_SESSIONS - 1);

  const spread = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: repeat("true-positive", MVP_DECIDED_HIGH),
    into: MVP_DECIDED_SESSIONS
  }));
  assert.equal(spread.status, "PASS");
  assert.equal(spread.decided_sessions, MVP_DECIDED_SESSIONS);
});

test("a rate over the findings that could be judged, when most could not, is withheld", () => {
  // The abstentions were counted and printed and that was all they did. Twenty decisions and a
  // thousand shrugs is a rate over the twenty that were easy, published as a rate about a reviewer.
  const mostlyUnclear = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: [...repeat("true-positive", MVP_DECIDED_HIGH), ...repeat("unclear", MVP_DECIDED_HIGH + 1)]
  }));
  assert.equal(mostlyUnclear.status, "UNDECIDED");
  assert.equal(mostlyUnclear.precision, null);
  assert.equal(mostlyUnclear.floor.abstention_met, false);
  assert.match(mostlyUnclear.withheld_reason, /more findings undecided than decided/);
  // The counts are still there. Withholding a rate is not withholding the evidence.
  assert.equal(mostlyUnclear.unclear, MVP_DECIDED_HIGH + 1);
  assert.equal(mostlyUnclear.decided_high, MVP_DECIDED_HIGH);

  // Half is the line, and at the line the rate is reported.
  const half = laneA(ledgerWith({
    sessions: MVP_HOLDOUT_SESSIONS,
    verdicts: [...repeat("true-positive", MVP_DECIDED_HIGH), ...repeat("unclear", MVP_DECIDED_HIGH)]
  }));
  assert.equal(half.floor.abstention_met, true);
  assert.equal(half.status, "PASS");
});

test("an undecided lane is not a quiet pass", () => {
  // The claim is what a reader carries away, so it is the thing that must not outrun the evidence.
  // Lane A passing on its own is not a production-quality review product: lane B has no rate.
  const passing = ledgerWith({ sessions: MVP_HOLDOUT_SESSIONS, verdicts: repeat("true-positive", MVP_DECIDED_HIGH) });
  assert.equal(laneA(passing).status, "PASS");

  const report = laneReport({ ledger: passing });
  assert.equal(report.lane_b.status, "UNDECIDED");
  assert.equal(report.claim, "EXPERIMENTAL", "one passing lane was read as both");
  assert.equal(report.review_stage, "EXPERIMENTAL");
  assert.equal(report.precision_claim, "REPORTED", "lane A has a rate and the claim about the rate says so");

  // And with neither lane passing, which is where this product actually is.
  const undecided = laneReport({ ledger: ledgerWith({ sessions: 1, verdicts: ["true-positive"] }) });
  assert.equal(undecided.claim, "EXPERIMENTAL");
  assert.equal(undecided.precision_claim, "WITHHELD");
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

  const digest = sessionDigestOf(Buffer.from("session 0", "utf8"));
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
    session_digest: sessionDigestOf(Buffer.from("session 0", "utf8")),
    finding_id: "extra",
    rule: "destructive-command-executed",
    severity: "high",
    judgement: "false-positive"
  });
  assert.notEqual(laneA(more).dataset_digest, digest, "the digest did not move when the data did");
});

test("the shape lane A returns is named, and the name is the one the migration note documents", () => {
  // This object replaced an unversioned one. `aos holdout --json` used to print the acceptance
  // report -- `accepted`, `holdout_sessions`, a nested `precision` object -- and it had to stop,
  // because that object carries a rate no floor was applied to. What it must not do is replace one
  // unnamed shape with another: a consumer that reads `undefined` has been told nothing about why.
  const lane = laneA(ledgerWith({ sessions: 1, verdicts: ["true-positive"] }));
  assert.equal(lane.schema_id, LANE_A_SCHEMA);
  assert.match(lane.schema_id, /^aos-holdout-lane-a\.v\d+$/);

  // And the note that tells the old readers what to read instead names the same shape. A rename
  // here with the document left behind is the same silent break in a new coat.
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const note = readFileSync(join(root, "docs", "HOLDOUT_OUTPUT.md"), "utf8");
  assert.ok(note.includes(LANE_A_SCHEMA), `docs/HOLDOUT_OUTPUT.md does not name ${lane.schema_id}`);
  // The fields it promises to explain are the ones the old shape carried.
  for (const old of ["accepted", "holdout_sessions", "precision.precision", "gates"]) {
    assert.ok(note.includes(old), `the migration note does not say what replaced ${old}`);
  }
});

test("the lane report carries no band, no percentile and no rank", () => {
  // A diagnostic about a review rule is not a score about a person, and the vocabulary is where
  // that distinction is lost first.
  //
  // The whole report, not lane A on its own: this asserted the vocabulary of one lane while its
  // name promised the report, and the words it looks for would most likely be introduced in lane B
  // or in the claim, which is the part a reader quotes.
  const ledger = ledgerWith({ sessions: MVP_HOLDOUT_SESSIONS, verdicts: repeat("true-positive", MVP_DECIDED_HIGH) });
  const report = laneReport({ ledger });
  assert.ok(Object.keys(report.lane_b.rule_metrics).length > 0, "lane B contributed nothing to the text this checks");
  assert.equal(/percentile|\brank(ed|ing|s)?\b|\bband\b/i.test(JSON.stringify(report)), false);
});
