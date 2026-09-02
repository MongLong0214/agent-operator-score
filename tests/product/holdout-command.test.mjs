import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./helpers.mjs";
import { loadLedger } from "../../lib/holdout.mjs";

// A session with something in it to find: an edit, then a claim that nothing re-checked.
const SESSION = [
  { type: "user", timestamp: "2026-08-20T10:00:00Z", cwd: "/repo", message: { content: [{ type: "text", text: "fix the parser" }] } },
  { type: "assistant", timestamp: "2026-08-20T10:00:10Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } },
  { type: "user", timestamp: "2026-08-20T10:00:20Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: "ok" }] } },
  { type: "assistant", timestamp: "2026-08-20T10:00:30Z", message: { content: [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/repo/parser.ts" } }] } },
  { type: "user", timestamp: "2026-08-20T10:00:40Z", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: false, content: "ok" }] } },
  { type: "assistant", timestamp: "2026-08-20T10:00:50Z", message: { content: [{ type: "text", text: "All tests pass, ready to merge." }] } }
];

const withSession = () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-holdout-cli-"));
  run(cwd, ["init"]);
  const session = join(cwd, "session.jsonl");
  writeFileSync(session, `${SESSION.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return { cwd, session, home: join(cwd, ".aos") };
};

test("a session is listed with an id per finding before anything is judged", () => {
  const { cwd, session } = withSession();
  try {
    const listed = run(cwd, ["holdout", "--session", session]);
    assert.match(listed.stdout, /not recorded/);
    assert.match(listed.stdout, /completion-claimed-without-verification/);
    assert.match(listed.stdout, /unjudged/);
    // The id is what a verdict is keyed on, so it has to be printed next to the finding.
    assert.match(listed.stdout, /^\s{2}[0-9a-f]{16}\s{2}\[high\]/m);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a verdict needs a finding this session actually has", () => {
  const { cwd, session } = withSession();
  try {
    run(cwd, ["holdout", "--session", session, "--use", "holdout"]);
    const wrong = run(cwd, ["holdout", "--session", session, "--verdict", "true-positive", "--finding", "0000000000000000"], 2);
    assert.match(wrong.stderr, /no finding 0000000000000000/);
    const missing = run(cwd, ["holdout", "--session", session, "--verdict", "true-positive"], 2);
    assert.match(missing.stderr, /needs --finding/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("recording, judging and reporting go through the ledger on disk", () => {
  const { cwd, session, home } = withSession();
  try {
    const recorded = run(cwd, ["holdout", "--session", session, "--use", "holdout"]);
    assert.match(recorded.stdout, /recorded as holdout/);

    const id = /^\s{2}([0-9a-f]{16})\s{2}\[high\]/m.exec(recorded.stdout)[1];
    run(cwd, ["holdout", "--session", session, "--finding", id, "--verdict", "false-positive", "--reason", "the claim was about a different file"]);

    const ledger = loadLedger(home);
    assert.equal(ledger.judgements.length, 1);
    assert.equal(ledger.judgements[0].judgement, "false-positive");
    assert.equal(ledger.judgements[0].reason, "the claim was about a different file");
    // No transcript anywhere in it.
    assert.equal(JSON.stringify(ledger).includes("fix the parser"), false);
    assert.equal(JSON.stringify(ledger).includes("parser.ts"), false);

    const listed = run(cwd, ["holdout", "--session", session]);
    assert.match(listed.stdout, new RegExp(`${id}.*false-positive`));

    // This assertion used to read `FAIL  high-severity precision`, which encoded the defect: a rate
    // over one decided finding, printed as a gate verdict. One false positive made it "— 0" and one
    // true positive made it "— 1", and a notice underneath saying the number was not a measurement
    // does not unprint a number. Withheld has to mean absent, so what is asserted here now is that
    // the rate is gone and the counts and the reason are not.
    const report = run(cwd, ["holdout"], 1);
    assert.match(report.stdout, /1 holdout session/);
    assert.match(report.stdout, /high-severity precision: withheld/);
    assert.equal(/high-severity precision — /.test(report.stdout), false, "the unfloored gate line is back");
    assert.equal(/\b\d\.\d{3}\b/.test(report.stdout), false, "a rate reached a report below the floor");
    // The evidence the withheld rate would have been computed from is still printed.
    assert.match(report.stdout, /0 right, 1 wrong/);
    assert.match(report.stdout, /not accepted/);
    assert.match(report.stdout, /local product acceptance/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("neither report the command can print carries a rate below the floor", () => {
  // Two output paths and only one of them used to be floored. `--lanes` was built on the lane
  // result and withheld correctly; the default report was built on the acceptance object, which
  // carries an unfloored precision, so the plain text printed a gate verdict over one decision and
  // `--json` carried `precision` alongside it. Absent means absent on every path out of here.
  const { cwd, session } = withSession();
  try {
    run(cwd, ["holdout", "--session", session, "--use", "holdout"]);
    const listed = run(cwd, ["holdout", "--session", session]);
    const id = /^\s{2}([0-9a-f]{16})\s{2}\[high\]/m.exec(listed.stdout)[1];
    run(cwd, ["holdout", "--session", session, "--finding", id, "--verdict", "true-positive"]);

    // One true positive and nothing else: the arithmetic says 1.000 and the sample says nothing.
    const json = JSON.parse(run(cwd, ["holdout", "--json"], 1).stdout);
    assert.equal(json.status, "UNDECIDED");
    assert.equal(json.precision, null);
    assert.equal(json.precision_withheld, true);
    assert.equal(json.tp, 1, "the counts went with the rate");
    assert.equal(json.decided_high, 1);
    assert.equal(/"precision":\s*[0-9]/.test(JSON.stringify(json)), false);

    const plain = run(cwd, ["holdout"], 1);
    assert.match(plain.stdout, /high-severity precision: withheld/);
    assert.equal(/\b1\.000\b|\b100%/.test(plain.stdout), false, "a perfect score over one finding");

    const lanes = run(cwd, ["holdout", "--lanes"], 1);
    assert.match(lanes.stdout, /precision withheld/);
    assert.equal(/\b1\.000\b/.test(lanes.stdout), false);

    // The fourth way out of this command, and the test claimed to cover every one of them while
    // leaving this one out. It is the machine-readable path, so it is the one a number would be
    // quoted from.
    const lanesJson = JSON.parse(run(cwd, ["holdout", "--lanes", "--json"], 1).stdout);
    assert.equal(lanesJson.lane_a.precision, null);
    assert.equal(lanesJson.lane_a.status, "UNDECIDED");
    assert.equal(lanesJson.precision_claim, "WITHHELD");
    assert.equal(lanesJson.claim, "EXPERIMENTAL");
    for (const metric of Object.values(lanesJson.lane_b.rule_metrics)) {
      assert.equal(metric.precision, null, `${metric.rule} published a precision`);
      assert.equal(metric.recall, null, `${metric.rule} published a recall`);
    }
    assert.equal(/"precision":\s*[0-9]|"recall":\s*[0-9]/.test(JSON.stringify(lanesJson)), false, "a rate reached the lane report");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a session the rules were tuned on refuses a verdict", () => {
  const { cwd, session } = withSession();
  try {
    run(cwd, ["holdout", "--session", session, "--use", "tuning"]);
    const listed = run(cwd, ["holdout", "--session", session]);
    const id = /^\s{2}([0-9a-f]{16})\s{2}\[high\]/m.exec(listed.stdout)[1];
    const refused = run(cwd, ["holdout", "--session", session, "--finding", id, "--verdict", "true-positive"], 2);
    assert.match(refused.stderr, /AOS_HOLDOUT_SESSION_IS_TUNING/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an empty ledger reports no rate rather than a perfect one", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-holdout-empty-"));
  try {
    run(cwd, ["init"]);
    const report = run(cwd, ["holdout"], 1);
    assert.match(report.stdout, /undecided/);
    assert.equal(/1\.000|100%/.test(report.stdout), false, "nothing judged must not read as everything right");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a session that is not there is said so, not invented", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-holdout-missing-"));
  try {
    run(cwd, ["init"]);
    const missing = run(cwd, ["holdout", "--session", join(cwd, "nope.jsonl")], 2);
    assert.match(missing.stderr, /no session file/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
