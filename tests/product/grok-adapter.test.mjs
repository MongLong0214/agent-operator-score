import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNTIMES, loadSession } from "../../lib/session.mjs";
import { reviewSession } from "../../lib/review.mjs";

// Grok CLI keeps one directory per working directory, url-encoded, and one per session inside it.
// The rows are flat and the tool calls carry their own ids, so nothing has to be guessed from
// adjacency -- which is the thing the other two adapters refuse to do.
const CWD = "/Users/someone/projects/thing";
const SESSION = "01a023c9-4711-7451-b5f3-366cadb221b2";

const transcript = (rows) => {
  const root = mkdtempSync(join(tmpdir(), "aos-grok-"));
  const workdir = join(root, encodeURIComponent(CWD));
  mkdirSync(join(workdir, SESSION), { recursive: true });
  const path = join(workdir, SESSION, "chat_history.jsonl");
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return { root, path, workdir };
};

const call = (id, name, args) => ({
  type: "assistant", content: "", model_id: "grok", tool_calls: [{ id, name, arguments: JSON.stringify(args) }]
});
const result = (id, content) => ({ type: "tool_result", tool_call_id: id, content });
const asked = (text) => ({ type: "user", content: [{ type: "text", text }] });

test("a Grok transcript is read as a session", () => {
  const { root, path } = transcript([
    { type: "system", content: "you are grok" },
    asked("<user_info>\nOS Version: macos\nWorkspace Path: /x\n</user_info>"),
    asked("fix the parser"),
    { type: "reasoning", id: "r1", status: "done", summary: [] },
    call("call-1", "run_terminal_command", { command: "npm test", description: "run the tests" }),
    result("call-1", "1 failing"),
    call("call-2", "search_replace", { file_path: `${CWD}/src/parser.ts`, old_string: "a", new_string: "b" }),
    result("call-2", "edited"),
    { type: "assistant", content: "All tests pass, ready to merge.", tool_calls: [] }
  ]);
  try {
    const session = loadSession(path);
    assert.equal(session.runtime, "grok");
    // There is no row that carries the working directory; the directory name is it.
    assert.equal(session.cwd, CWD);

    // The `<user_info>` block is the harness speaking, the same as a system reminder is on the
    // Claude Code side. Counting it would make a session look attended that nobody was attending.
    assert.equal(session.operatorTurns.length, 1);
    assert.equal(session.operatorTurns[0].text, "fix the parser");

    // Every call carries its own id and every result names it, so pairing is read rather than
    // guessed from adjacency.
    assert.equal(session.calls.length, 2);
    assert.equal(session.calls.every((entry) => entry.result !== null), true);
    assert.equal(session.coverage.unpaired_calls, 0);
    assert.equal(session.coverage.status, "COMPLETE");

    // The tools are normalised to the shapes the rules already read.
    assert.equal(session.calls[0].tool, "Bash");
    assert.equal(session.calls[0].input.command, "npm test");
    assert.equal(session.calls[1].tool, "Edit");
    assert.equal(session.calls[1].input.file_path, `${CWD}/src/parser.ts`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the rules run on a Grok session the same as on any other", () => {
  const { root, path } = transcript([
    asked("fix it"),
    call("c1", "run_terminal_command", { command: "npm test" }),
    result("c1", "ok"),
    call("c2", "search_replace", { file_path: `${CWD}/src/a.ts`, old_string: "x", new_string: "y" }),
    result("c2", "edited"),
    { type: "assistant", content: "All tests pass, ready to merge.", tool_calls: [] }
  ]);
  try {
    const found = reviewSession(loadSession(path)).findings.map((finding) => finding.rule);
    assert.ok(found.includes("completion-claimed-without-verification"), found.join(", "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a destructive command in a Grok session is found", () => {
  const { root, path } = transcript([
    asked("sync it"),
    call("c1", "run_terminal_command", { command: "git push --force origin main" }),
    result("c1", "done")
  ]);
  try {
    const found = reviewSession(loadSession(path)).findings.map((finding) => finding.rule);
    assert.ok(found.includes("destructive-command-executed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an operator prompt is timestamped from the history beside it, and the rest stay unknown", () => {
  // The transcript has no clock of its own. `prompt_history.jsonl` carries one per prompt, matched
  // by what the operator typed -- position does not line up, because the first `user` row is an
  // injected block.
  const { root, path, workdir } = transcript([
    asked("<user_info>injected</user_info>"),
    asked("fix the parser"),
    call("c1", "run_terminal_command", { command: "npm test" }),
    result("c1", "ok")
  ]);
  try {
    writeFileSync(join(workdir, "prompt_history.jsonl"),
      `${JSON.stringify({ timestamp: "2026-08-21T09:21:30.155Z", session_id: SESSION, prompt: "fix the parser" })}\n` +
      `${JSON.stringify({ timestamp: "2026-08-21T09:30:00.000Z", session_id: "someone-else", prompt: "not this session" })}\n`);
    const session = loadSession(path);
    assert.equal(session.operatorTurns.length, 1);
    assert.equal(session.operatorTurns[0].at, Date.parse("2026-08-21T09:21:30.155Z"));
    // A step with no timestamp keeps NaN, which is unknown rather than zero.
    assert.equal(Number.isFinite(session.calls[0].at), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the runtimes it reads are named, because a silent omission reads as everything", () => {
  assert.deepEqual(RUNTIMES, ["claude-code", "codex", "grok"]);
});
