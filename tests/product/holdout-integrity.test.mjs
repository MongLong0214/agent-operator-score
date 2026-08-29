import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { emptyLedger, judge, precisionOf, recordSession, saveLedger } from "../../lib/holdout.mjs";
import { redactText } from "../../lib/redact.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");

const DIGEST = "a".repeat(64);
const empty = () => ({ schema_id: "aos-holdout.v1", version: 1, sessions: [], judgements: [] });
const withVerdict = (use = "holdout") => {
  let ledger = recordSession(empty(), { digest: DIGEST, use, reported_status: "COMPLETE", actual_evidence: "COMPLETE" });
  ledger = judge(ledger, {
    session_digest: DIGEST, finding_id: "f1", rule: "completion-claimed-without-verification",
    severity: "high", judgement: "true-positive", reason: "checked the cited step"
  });
  return ledger;
};

// Found by a blind round that reproduced the ledger's arithmetic independently and then looked for
// the one way to bend it. `judge` refuses a verdict on a tuning session at write time, and nothing
// re-checked it afterwards.
test("a session cannot teach the rules and still test them", () => {
  const judged = withVerdict();
  assert.equal(precisionOf(judged).precision, 1);
  assert.equal(precisionOf(judged).true_positive, 1);

  // Re-recorded as tuning after the verdict was given. The report used to read "used for tuning"
  // and "3 right, 0 wrong" at the same time.
  const flipped = recordSession(judged, { digest: DIGEST, use: "tuning", reported_status: "COMPLETE", actual_evidence: "COMPLETE" });
  assert.equal(precisionOf(flipped).true_positive, 0, "a tuning session's verdict stayed in the precision count");
  assert.equal(precisionOf(flipped).precision, null);

  // And flipping back does not resurrect it silently -- it is the same visible change either way.
  const back = recordSession(flipped, { digest: DIGEST, use: "holdout", reported_status: "COMPLETE", actual_evidence: "COMPLETE" });
  assert.equal(back.sessions[0].previous_use, "tuning");
});

test("a change of side leaves the change behind", () => {
  // `recordSession` overwrote the row wholesale, so a session that had taught the rules could
  // become holdout with no trace -- in a file whose stated defence is that revisions are visible.
  const taught = recordSession(empty(), { digest: DIGEST, use: "tuning", reported_status: "COMPLETE", actual_evidence: "COMPLETE" });
  assert.equal(taught.sessions[0].previous_use, undefined);

  const promoted = recordSession(taught, { digest: DIGEST, use: "holdout", reported_status: "COMPLETE", actual_evidence: "COMPLETE" });
  assert.equal(promoted.sessions[0].use, "holdout");
  assert.equal(promoted.sessions[0].previous_use, "tuning", "a session changed sides with no trace");

  // Re-recording on the same side keeps the earlier flip rather than erasing it.
  const again = recordSession(promoted, { digest: DIGEST, use: "holdout", reported_status: "COMPLETE", actual_evidence: "INCOMPLETE" });
  assert.equal(again.sessions[0].previous_use, "tuning");
});

test("a key is labelled with the vendor it belongs to", () => {
  // The generic `sk-` pattern ran first and also matches every `sk-ant-…`, so the Anthropic label
  // was unreachable. The material was redacted either way; a finding that names the wrong vendor
  // sends the operator to rotate a key at the wrong provider.
  assert.deepEqual(redactText(`k sk-ant-api03-${"x".repeat(40)}`).kinds, ["Anthropic key"]);
  assert.deepEqual(redactText(`k sk-${"y".repeat(40)}`).kinds, ["OpenAI key"]);
  assert.deepEqual(redactText(`k sk-proj-${"z".repeat(40)}`).kinds, ["OpenAI key"]);
  // The value never survives, whichever label it gets.
  for (const text of [`sk-ant-api03-${"x".repeat(40)}`, `sk-${"y".repeat(40)}`]) {
    assert.equal(redactText(text).text.includes("x".repeat(20)) || redactText(text).text.includes("y".repeat(20)), false);
  }
});

// Round 10 of the sweep exercised the ledger end to end and reproduced the precision arithmetic
// exactly -- then pointed at what it could not reproduce: the tool reports whatever the owner's last
// `--use` flag leaves behind, "with the audit trail sitting unread in the file". `recordSession` has
// kept `previous_use` since a judged session could be re-labelled as tuning while its verdicts stayed
// in the count. Nothing read it back. A record nobody reads is the shape this ledger exists to refuse.
test("a session that changed side after being recorded is printed beside the number", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-moved-"));
  try {
    saveLedger(home, {
      ...emptyLedger(),
      sessions: [
        { digest: "a".repeat(16), use: "tuning", previous_use: "holdout", previous_note: "judged first", evidence: "COMPLETE" },
        { digest: "b".repeat(16), use: "holdout", evidence: "COMPLETE" }
      ]
    });
    const shown = spawnSync(process.execPath, [cli, "holdout"], {
      encoding: "utf8", env: { ...process.env, AOS_HOME: home, HOME: home }
    }).stdout;

    assert.match(shown, /1 session\(s\) changed side after being recorded/);
    assert.match(shown, /holdout -> tuning/);
    assert.match(shown, /judged first/);
    // The one that never moved is not listed, so the notice means something when it appears.
    assert.doesNotMatch(shown, new RegExp("b".repeat(12)));

    // And a clean ledger says nothing at all.
    saveLedger(home, { ...emptyLedger(), sessions: [{ digest: "c".repeat(16), use: "holdout", evidence: "COMPLETE" }] });
    assert.doesNotMatch(
      spawnSync(process.execPath, [cli, "holdout"], { encoding: "utf8", env: { ...process.env, AOS_HOME: home, HOME: home } }).stdout,
      /changed side/
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
