import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MVP_PRECISION,
  acceptanceOf,
  emptyLedger,
  findingIdOf,
  holdoutPath,
  judge,
  loadLedger,
  precisionOf,
  recordSession,
  saveLedger,
  sessionDigestOf
} from "../../lib/holdout.mjs";

const DIGEST = sessionDigestOf("a session");
const OTHER = sessionDigestOf("another session");

const withSession = (over = {}) =>
  recordSession(emptyLedger(), { digest: DIGEST, use: "holdout", reported_status: "COMPLETE", actual_evidence: "COMPLETE", ...over });

const judged = (ledger, verdicts) =>
  verdicts.reduce(
    (acc, [finding_id, judgement, severity = "high"]) =>
      judge(acc, { session_digest: DIGEST, finding_id, rule: "destructive-command-executed", severity, judgement }),
    ledger
  );

test("a finding is identified without the session being stored", () => {
  // The identity has to survive a re-run and carry none of the transcript. Keying on the finding's
  // text would put the session in the ledger through the back door.
  const finding = { rule: "destructive-command-executed", where: "step 4 · 11:02:31", what: "rm -rf /etc", evidence: "rm -rf /etc" };
  const id = findingIdOf(DIGEST, finding);
  assert.equal(id, findingIdOf(DIGEST, { ...finding, what: "different wording", evidence: "different" }));
  assert.notEqual(id, findingIdOf(DIGEST, { ...finding, where: "step 5 · 11:02:31" }));
  assert.notEqual(id, findingIdOf(DIGEST, { ...finding, rule: "secret-material-in-session" }));
  assert.notEqual(id, findingIdOf(OTHER, finding), "the same finding in another session is another finding");
});

test("a judgement about a tuning session is refused", () => {
  // Rules written by looking at a session cannot be tested on it. This is the whole holdout.
  const tuning = recordSession(emptyLedger(), { digest: DIGEST, use: "tuning", reported_status: "COMPLETE", actual_evidence: "COMPLETE" });
  assert.throws(
    () => judge(tuning, { session_digest: DIGEST, finding_id: "f1", rule: "r", severity: "high", judgement: "true-positive" }),
    /AOS_HOLDOUT_SESSION_IS_TUNING/
  );
});

test("a judgement about a session nobody recorded is refused", () => {
  assert.throws(
    () => judge(emptyLedger(), { session_digest: DIGEST, finding_id: "f1", rule: "r", severity: "high", judgement: "true-positive" }),
    /AOS_HOLDOUT_UNKNOWN_SESSION/
  );
});

test("only the three verdicts are verdicts", () => {
  const ledger = withSession();
  for (const bad of ["yes", "TRUE-POSITIVE", "", null, "probably"]) {
    assert.throws(
      () => judge(ledger, { session_digest: DIGEST, finding_id: "f1", rule: "r", severity: "high", judgement: bad }),
      /AOS_HOLDOUT_BAD_JUDGEMENT/,
      String(bad)
    );
  }
});

test("re-judging replaces the verdict and keeps the one it replaced", () => {
  // An owner grading their own tool can always revise until the number is good. The defence is not
  // that they cannot; it is that the revision is written down where they will see it.
  const once = judged(withSession(), [["f1", "false-positive"]]);
  const twice = judge(once, { session_digest: DIGEST, finding_id: "f1", rule: "destructive-command-executed", severity: "high", judgement: "true-positive" });
  assert.equal(twice.judgements.length, 1, "re-judging must not add a second row");
  assert.equal(twice.judgements[0].judgement, "true-positive");
  assert.deepEqual(twice.judgements[0].revisions.map((entry) => entry.judgement), ["false-positive"]);
  assert.equal(precisionOf(twice).decided, 1, "the replaced verdict must not also be counted");
});

test("precision is the rate over what was decided, and unclear is neither", () => {
  const ledger = judged(withSession(), [
    ["f1", "true-positive"],
    ["f2", "true-positive"],
    ["f3", "false-positive"],
    ["f4", "unclear"]
  ]);
  const result = precisionOf(ledger);
  assert.equal(result.true_positive, 2);
  assert.equal(result.false_positive, 1);
  assert.equal(result.unclear, 1);
  assert.equal(result.decided, 3);
  assert.equal(result.precision, 2 / 3);
});

test("nothing decided is no rate, not a perfect one", () => {
  // A ledger with two unclear entries reporting 100% is the failure mode this exists to prevent.
  assert.equal(precisionOf(withSession()).precision, null);
  assert.equal(precisionOf(judged(withSession(), [["f1", "unclear"]])).precision, null);
  const gate = acceptanceOf(judged(withSession(), [["f1", "unclear"]])).gates[0];
  assert.equal(gate.pass, false, "an undecided holdout must not clear the bar");
});

test("severity is what the precision is about", () => {
  // The target is a high-severity rate. A medium finding being wrong is not what it measures.
  const ledger = judged(withSession(), [
    ["f1", "true-positive", "high"],
    ["f2", "false-positive", "medium"],
    ["f3", "false-positive", "medium"]
  ]);
  assert.equal(precisionOf(ledger, { severity: "high" }).precision, 1);
  assert.equal(precisionOf(ledger, { severity: "medium" }).precision, 0);
});

test("the bar is ninety per cent and it is a bar", () => {
  const nine = judged(withSession(), [
    ...Array.from({ length: 9 }, (unused, index) => [`t${index}`, "true-positive"]),
    ["f1", "false-positive"]
  ]);
  assert.equal(precisionOf(nine).precision, MVP_PRECISION);
  assert.equal(acceptanceOf(nine).gates[0].pass, true, "exactly the target passes");

  const eight = judged(withSession(), [
    ...Array.from({ length: 8 }, (unused, index) => [`t${index}`, "true-positive"]),
    ["f1", "false-positive"],
    ["f2", "false-positive"]
  ]);
  assert.equal(acceptanceOf(eight).gates[0].pass, false);
});

test("a transcript AOS could not read is never a clean bill of health", () => {
  // The gap between the two statuses is the gate: a session whose evidence was incomplete, reported
  // as complete, is a clean result that was never earned.
  const honest = withSession({ reported_status: "INCOMPLETE", actual_evidence: "INCOMPLETE" });
  assert.equal(acceptanceOf(honest).gates[1].pass, true, "reporting the gap is not the failure");

  const passedOff = withSession({ reported_status: "COMPLETE", actual_evidence: "INCOMPLETE" });
  const gate = acceptanceOf(passedOff).gates[1];
  assert.equal(gate.pass, false);
  assert.equal(gate.value, 1);
  assert.match(gate.detail, new RegExp(DIGEST.slice(0, 12)));
});

test("a tuning session cannot fail or pass the gates", () => {
  // It is not in the holdout, so it is not evidence in either direction.
  const tuning = recordSession(emptyLedger(), { digest: DIGEST, use: "tuning", reported_status: "COMPLETE", actual_evidence: "INCOMPLETE" });
  const acceptance = acceptanceOf(tuning);
  assert.equal(acceptance.gates[1].pass, true);
  assert.equal(acceptance.holdout_sessions, 0);
  assert.equal(acceptance.tuning_sessions, 1);
});

test("a secret typed into a reason never reaches the file", () => {
  // The reason is the one free-text field, so it is the one way a secret gets in.
  const ledger = judge(withSession(), {
    session_digest: DIGEST,
    finding_id: "f1",
    rule: "secret-material-in-session",
    severity: "high",
    judgement: "true-positive",
    reason: "real: the key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA was in the log"
  });
  const stored = ledger.judgements[0].reason;
  assert.equal(stored.includes("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), false);
  assert.match(stored, /the key .* was in the log/);
  assert.equal(acceptanceOf(ledger).gates[2].pass, true);
});

test("the ledger has nowhere to put a transcript", () => {
  // Not a promise about what callers pass: the recorder copies named fields and never spreads, so
  // an extra key is dropped rather than trusted.
  const ledger = recordSession(emptyLedger(), {
    digest: DIGEST,
    use: "holdout",
    reported_status: "COMPLETE",
    actual_evidence: "COMPLETE",
    transcript: "the operator typed something private here",
    events: [{ text: "and here" }]
  });
  const serialized = JSON.stringify(ledger);
  assert.equal(serialized.includes("private here"), false);
  assert.equal(serialized.includes("and here"), false);
  assert.deepEqual(Object.keys(ledger.sessions[0]).sort(), ["actual_evidence", "digest", "note", "reported_status", "use"]);

  const withVerdict = judge(ledger, {
    session_digest: DIGEST,
    finding_id: "f1",
    rule: "r",
    severity: "high",
    judgement: "true-positive",
    evidence: "rm -rf / ran at 11:02"
  });
  assert.equal(JSON.stringify(withVerdict).includes("rm -rf /"), false);
});

test("the ledger is written to the operator's home and read back as it was", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-holdout-"));
  try {
    const ledger = judged(withSession(), [["f1", "true-positive"], ["f2", "false-positive"]]);
    saveLedger(home, ledger);
    assert.equal(holdoutPath(home), join(home, "holdout.json"));
    assert.deepEqual(loadLedger(home), ledger);
    // A missing ledger is an empty one, not a crash: the first judgement has nothing to read.
    assert.deepEqual(loadLedger(mkdtempSync(join(tmpdir(), "aos-holdout-empty-"))), emptyLedger());
    // A ledger from a version that meant something else is refused rather than reinterpreted.
    const raw = JSON.parse(readFileSync(holdoutPath(home), "utf8"));
    saveLedger(home, { ...raw, version: 99 });
    assert.throws(() => loadLedger(home), /AOS_HOLDOUT_VERSION/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("acceptance is all three gates, and it says which one failed", () => {
  const good = judged(withSession(), Array.from({ length: 10 }, (unused, index) => [`t${index}`, "true-positive"]));
  const acceptance = acceptanceOf(good);
  assert.equal(acceptance.accepted, true);
  assert.deepEqual(acceptance.gates.map((entry) => entry.gate), [
    "high-severity precision",
    "incomplete evidence reported as clean",
    "secret material reprinted"
  ]);
  for (const gate of acceptance.gates) assert.equal(typeof gate.detail, "string");

  const oneBad = recordSession(good, { digest: OTHER, use: "holdout", reported_status: "COMPLETE", actual_evidence: "INCOMPLETE" });
  assert.equal(acceptanceOf(oneBad).accepted, false, "one failed gate fails acceptance");
  assert.deepEqual(acceptanceOf(oneBad).gates.filter((entry) => !entry.pass).map((entry) => entry.gate), [
    "incomplete evidence reported as clean"
  ]);
});
