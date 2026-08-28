import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSession } from "../../lib/session.mjs";
import { reviewSession, verificationOf } from "../../lib/review.mjs";

const call = (command, result) => ({ kind: "call", at: 1, tool: "Bash", input: { command }, result: result ?? null });
const ok = { kind: "result", ok: true, text: "" };
const failed = { kind: "result", ok: false, text: "1 failing" };

test("a mention of a test command is not a run", () => {
  // `npm test` inside an argument was read as verification, so a session could satisfy the rule by
  // printing the words.
  for (const mention of ['echo "npm test"', "grep -n 'npm test' README.md", "cat notes.md # npm test"]) {
    assert.equal(verificationOf(call(mention, ok)), null, mention);
  }
});

test("a run at a command position counts, wherever in the line it sits", () => {
  for (const script of ["npm test", "cd packages/app && npm test", "npm run build", "CI=1 npm test", "npx jest"]) {
    assert.notEqual(verificationOf(call(script, ok)), null, script);
  }
});

test("a masked exit status is not a verification", () => {
  // The command ran and then threw the answer away. Reading it as a pass is how a red suite becomes
  // a green session.
  assert.equal(verificationOf(call("npm test || true", ok)), "masked");
  assert.equal(verificationOf(call("npm test || :", ok)), "masked");
});

test("a failed run is failed, and an unpaired run is unknown", () => {
  assert.equal(verificationOf(call("npm test", failed)), "failed");
  assert.equal(verificationOf(call("npm test", null)), "unknown");
  assert.equal(verificationOf(call("npm test", ok)), "passed");
});

const session = (steps, extra = {}) => ({
  path: "/s.jsonl",
  cwd: "/repo",
  duration_ms: 1,
  steps,
  calls: steps.filter((step) => step.kind === "call"),
  operatorTurns: steps.filter((step) => step.kind === "message" && step.role === "operator"),
  ...extra
});

const rules = (review) => review.findings.map((finding) => finding.rule);
const claim = { kind: "message", role: "agent", at: 9, text: "all tests pass" };
const edit = { kind: "call", at: 2, tool: "Edit", input: { file_path: "/repo/a.ts" } };

test("claiming completion over a check that failed is its own finding", () => {
  // Distinct from claiming with no check at all: the operator ran the right command and read the
  // wrong answer, and telling them "nothing re-checked" would be false.
  const review = reviewSession(session([edit, call("npm test", failed), claim]));
  assert.ok(rules(review).includes("completion-claimed-over-a-failed-check"), JSON.stringify(rules(review)));
  assert.equal(rules(review).includes("completion-claimed-without-verification"), false);
});

test("claiming completion after `|| true` is reported as a discarded exit status", () => {
  const review = reviewSession(session([edit, call("npm test || true", ok), claim]));
  assert.ok(rules(review).includes("verification-exit-status-discarded"));
});

test("an unrecorded outcome accuses nobody, and is reported as not observed", () => {
  // The runtime did not write down whether the run passed. A finding here would blame the operator
  // for what the transcript failed to record, and silence would hide that the review is partial.
  const review = reviewSession(session([edit, call("npm test", null), claim]));
  assert.deepEqual(rules(review), []);
  assert.deepEqual(review.not_observed, [{ rule: "verification-outcome", count: 1 }]);
});

test("a passing check before the claim is clean and reports nothing", () => {
  const review = reviewSession(session([edit, call("npm test", ok), claim]));
  assert.deepEqual(rules(review), []);
  assert.deepEqual(review.not_observed, []);
});

test("a claim with no check at all is still the original finding", () => {
  const review = reviewSession(session([edit, claim]));
  assert.ok(rules(review).includes("completion-claimed-without-verification"));
});

const withSession = (lines) => {
  const dir = mkdtempSync(join(tmpdir(), "aos-parse-"));
  try {
    const path = join(dir, "s.jsonl");
    writeFileSync(path, lines, "utf8");
    return loadSession(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const claudeRow = (value) => `${JSON.stringify(value)}\n`;

test("a torn trailing line is repaired, and damage in the middle is reported", () => {
  // Only the last line is one an append-only writer can legitimately leave half-written. Dropping
  // a damaged middle row silently reports a clean session built from a transcript with holes.
  const good = claudeRow({ type: "user", cwd: "/repo", message: { content: "hello" } });
  const torn = withSession(`${good}${good}{"type":"user","mess`);
  assert.equal(torn.coverage.torn_trailing_rows, 1);
  assert.equal(torn.coverage.malformed_middle_rows, 0);
  assert.equal(torn.coverage.status, "COMPLETE");

  const holed = withSession(`${good}not json at all\n${good}`);
  assert.equal(holed.coverage.malformed_middle_rows, 1);
  assert.equal(holed.coverage.status, "INCOMPLETE", "a session with holes was reported as complete");
});

test("one damaged row in a long transcript is still INCOMPLETE", () => {
  // Coverage stays at 0.99 here. A threshold alone would have called this clean, and the missing
  // row is exactly the one that could have carried the failure the review is looking for.
  const good = claudeRow({ type: "user", cwd: "/repo", message: { content: "hello" } });
  const loaded = withSession(`${good.repeat(50)}{oops\n${good.repeat(49)}`);
  assert.equal(loaded.coverage.malformed_middle_rows, 1);
  assert.equal(loaded.coverage.coverage > 0.98, true, "the ratio should still look healthy");
  assert.equal(reviewSession(loaded).status, "INCOMPLETE", "a hole was reported as a clean review");
});

test("a clean transcript is COMPLETE and pairs its calls by id", () => {
  // Attribution is by id. A result matched by adjacency would answer a question about a command
  // that never ran.
  const rows =
    claudeRow({ type: "assistant", cwd: "/repo", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } }) +
    claudeRow({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false, content: "ok" }] } });
  const loaded = withSession(rows);
  assert.equal(loaded.coverage.status, "COMPLETE");
  assert.equal(loaded.coverage.tool_calls, 1);
  assert.equal(loaded.coverage.paired_results, 1);
  assert.equal(loaded.coverage.unpaired_calls, 0);
  assert.equal(loaded.calls[0].result.ok, true);
  assert.equal(verificationOf(loaded.calls[0]), "passed");
});

test("is_error on the paired result is what makes a run a failure", () => {
  const rows =
    claudeRow({ type: "assistant", cwd: "/repo", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } }) +
    claudeRow({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "1 failing" }] } });
  const loaded = withSession(rows);
  assert.equal(loaded.calls[0].result.ok, false);
  assert.equal(verificationOf(loaded.calls[0]), "failed");
});

test("a call whose result never arrived is unpaired, not paired to someone else's", () => {
  const rows =
    claudeRow({ type: "assistant", cwd: "/repo", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm test" } }] } }) +
    claudeRow({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } }] } }) +
    claudeRow({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: false, content: "a b" }] } });
  const loaded = withSession(rows);
  assert.equal(loaded.coverage.unpaired_calls, 1);
  assert.equal(loaded.calls[0].result, null, "the second call's result was attributed to the first");
  assert.equal(verificationOf(loaded.calls[0]), "unknown");
});

test("a test runner is recognised however the interpreter was named", () => {
  // Five of sixteen high-severity findings in the owner's own held-back sessions were "nothing
  // verified this" about sessions that had verified it -- with a python named by path, or behind a
  // runner carrying options. A recognizer with an incomplete vocabulary does not fail loudly; it
  // invents a finding.
  const ran = (command) => verificationOf({ tool: "Bash", input: { command }, result: { ok: true } });
  for (const command of [
    "./.venv/bin/python -m pytest tests/x.py -q",
    "/opt/homebrew/bin/python3.11 -m pytest tests/y.py",
    "uv run --group dev python -m pytest -q tests/x.py",
    "uv run --extra dev python -m pytest tests/x.py",
    "uv run --quiet pytest",
    "poetry run pytest",
    "timeout 300 uv run --group dev python -m pytest -q tests/x.py"
  ]) assert.equal(ran(command), "passed", command);

  // The widening has to stop somewhere, and it stops at the tool. A runner prefix in front of
  // something that is not a check is still not a check.
  for (const command of [
    "uv run --group dev python manage.py migrate",
    "uv run python -c 'print(1)'",
    "cat pytest.ini",
    "grep -n pytest file.py",
    "rm -rf build"
  ]) assert.equal(ran(command), null, command);
});

test("a valued runner option does not swallow the tool after it", () => {
  // `--quiet pytest` read as option-and-value leaves nothing to recognise, so only options known to
  // take a value are allowed to consume the token after them.
  const ran = (command) => verificationOf({ tool: "Bash", input: { command }, result: { ok: true } });
  assert.equal(ran("uv run --quiet pytest"), "passed");
  assert.equal(ran("uv run --frozen --no-sync pytest tests/"), "passed");
  assert.equal(ran("uv run --group dev pytest"), "passed");
});

test("a tool binary run by path is the same tool", () => {
  // `./node_modules/.bin/vitest run` is how a project pins its own toolchain. All three remaining
  // stale-evidence findings in the owner's held-back sessions were sessions that had verified their
  // work exactly this way, and were told nothing had checked it.
  const ran = (command) => verificationOf({ tool: "Bash", input: { command }, result: { ok: true } });
  for (const command of [
    "./node_modules/.bin/vitest run",
    "node_modules/.bin/tsc --noEmit",
    "node_modules/.bin/tsc --noEmit && node_modules/.bin/eslint src/a.ts",
    // A compound statement leaves a segment beginning with a shell keyword.
    "if [ -x node_modules/.bin/tsc ]; then node_modules/.bin/tsc --noEmit; else echo no; fi"
  ]) assert.equal(ran(command), "passed", command);

  // `test` is only a check as a script name behind a runner. As a bare command it is the shell
  // builtin, and reading `test -f path` as a verification would silence a real finding.
  for (const command of [
    "test -f package.json && echo yes",
    "test -x ./bin/run",
    "./node_modules/.bin/tsx -e 'import x'",
    "ls node_modules/.bin/vitest",
    "cat node_modules/.bin/tsc",
    "echo \"node_modules/.bin/tsc --noEmit\""
  ]) assert.equal(ran(command), null, command);
});
