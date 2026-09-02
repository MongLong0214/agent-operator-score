import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { run } from "./helpers.mjs";
import { loadCorpus } from "../../lib/incident-corpus.mjs";
import { containsSecretMaterial } from "../../lib/redact.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// What must never leave the operator's machine, checked against the machine rather than promised.
//
// The holdout ledger is the one file in this product that is built from real sessions. It holds
// digests, and the reason it is allowed to exist at all is that there is no field a transcript
// could be written into. That claim is worth exactly as much as the check that it is still true.

const TRANSCRIPT = "the operator pasted a private customer name here";
const SESSION = [
  { type: "user", timestamp: "2026-08-20T10:00:00Z", cwd: "/repo", message: { content: [{ type: "text", text: TRANSCRIPT }] } },
  { type: "assistant", timestamp: "2026-08-20T10:00:10Z", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } },
  { type: "user", timestamp: "2026-08-20T10:00:20Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: "ok" }] } },
  { type: "assistant", timestamp: "2026-08-20T10:00:30Z", message: { content: [{ type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/repo/customer-parser.ts" } }] } },
  { type: "user", timestamp: "2026-08-20T10:00:40Z", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: false, content: "ok" }] } },
  { type: "assistant", timestamp: "2026-08-20T10:00:50Z", message: { content: [{ type: "text", text: "All tests pass, ready to merge." }] } }
];

test("nothing that goes into the lane report came out of a transcript", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-no-raw-"));
  try {
    run(cwd, ["init"]);
    const session = join(cwd, "session.jsonl");
    writeFileSync(session, `${SESSION.map((row) => JSON.stringify(row)).join("\n")}\n`);
    run(cwd, ["holdout", "--session", session, "--use", "holdout"]);

    const lanes = run(cwd, ["holdout", "--lanes", "--json"], 1);
    const report = JSON.parse(lanes.stdout);
    for (const secret of [TRANSCRIPT, "customer-parser.ts", "All tests pass"]) {
      assert.equal(lanes.stdout.includes(secret), false, `${secret} reached the lane report`);
    }
    // One session is one session. The report says so and says nothing else.
    assert.equal(report.lane_a.status, "UNDECIDED");
    assert.equal(report.lane_a.sessions, 1);
    assert.equal(report.lane_a.precision, null);
    assert.equal(report.claim, "EXPERIMENTAL");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the ledger is not a tracked file and never becomes one", () => {
  // `.aos/` is ignored, which is what keeps the ledger out of git. An ignore rule that stops
  // matching is silent, so the question asked here is about the index, not about the file.
  const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  assert.equal(tracked.status, 0, tracked.stderr);
  const offending = tracked.stdout.split("\n").filter((path) => /(^|\/)holdout\.json$/.test(path) || /(^|\/)\.aos\//.test(path));
  assert.deepEqual(offending, [], "a holdout ledger is tracked in git");

  const ignored = spawnSync("git", ["check-ignore", "-q", ".aos/holdout.json"], { cwd: root });
  assert.equal(ignored.status, 0, ".aos/ is no longer ignored, so the next ledger can be committed");
});

test("no corpus item carries a credential it did not declare", () => {
  // The corpus is the one thing in this lane that does ship. A fixture built from an incident about
  // a leaked key contains key-shaped text on purpose; an undeclared one is a leak.
  for (const item of loadCorpus()) {
    let text = JSON.stringify(item);
    for (const declared of item.secret_values) text = text.split(declared).join("[declared]");
    assert.equal(containsSecretMaterial(text), false, `${item.fixture_id} carries an undeclared credential`);
  }
});

test("no corpus item carries a path off the machine it was recorded on", () => {
  // A transcript's own paths are the fastest way for a real session to end up in a shipped fixture.
  for (const item of loadCorpus()) {
    const text = JSON.stringify(item);
    for (const shape of [/\/Users\/[a-z]/i, /\/home\/[a-z]/i, /\.claude\/projects/, /\.codex\/sessions/]) {
      assert.equal(shape.test(text), false, `${item.fixture_id} carries ${shape}`);
    }
  }
});

test("the historical 0.400 measurement is still on the record", () => {
  // The number the reviewer actually scored on sessions it had never seen. Replacing it with a
  // tuning number, or dropping it once the lane exists, is the disclosure this release forbids.
  const limitations = readFileSync(join(root, "docs", "LIMITATIONS.md"), "utf8");
  assert.match(limitations, /precision 0\.400/);
  assert.match(limitations, /320 sessions/);
  // And it is still the measured one: the lane may not overwrite it with a number from the corpus,
  // which is a fixture rate and not a rate over anybody's sessions.
  assert.match(limitations, /known-incident fixture/);
});
