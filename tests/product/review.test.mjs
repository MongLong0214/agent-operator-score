import assert from "node:assert/strict";
import test from "node:test";

import { isWrittenDownExample, reviewSession } from "../../lib/review.mjs";

// A session shaped the way lib/session.mjs normalizes one, built inline so these cases state the
// exact sequence each rule is about rather than depending on whatever is on this machine.
const build = (steps, cwd = "/repo") => {
  const withTime = steps.map((step, index) => ({ at: index * 1000, ...step }));
  return reviewSession({
    path: "/tmp/session.jsonl",
    cwd,
    started: 0,
    ended: withTime.length * 1000,
    duration_ms: withTime.length * 1000,
    steps: withTime,
    calls: withTime.filter((step) => step.kind === "call"),
    operatorTurns: withTime.filter((step) => step.kind === "message" && step.role === "operator")
  });
};

const rules = (result) => result.findings.map((finding) => finding.rule);

const edit = (path = "/repo/a.ts") => ({ kind: "call", tool: "Edit", input: { file_path: path } });
const bash = (command) => ({ kind: "call", tool: "Bash", input: { command } });
const said = (text) => ({ kind: "message", role: "agent", text });
const asked = (text) => ({ kind: "message", role: "operator", text });

test("a completion claim after an unverified edit is a finding", () => {
  const flagged = build([bash("npm test"), edit(), said("All tests pass, ready to merge.")]);
  assert.ok(rules(flagged).includes("completion-claimed-without-verification"));

  const clean = build([edit(), bash("npm test"), said("All tests pass, ready to merge.")]);
  assert.equal(rules(clean).includes("completion-claimed-without-verification"), false);
});

test("a progress note is not a completion claim", () => {
  // The first version matched any "done" or "완료" and fired on every status update.
  const result = build([edit(), said("완료. 다음 단계로 넘어갑니다."), said("Done with step 1, continuing.")]);
  assert.equal(rules(result).includes("completion-claimed-without-verification"), false);
});

test("edits after the last verification leave the session on stale evidence", () => {
  const stale = build([bash("npm test"), edit(), edit()]);
  assert.ok(rules(stale).includes("session-ended-on-stale-evidence"));

  const fresh = build([edit(), edit(), bash("npm test")]);
  assert.equal(rules(fresh).includes("session-ended-on-stale-evidence"), false);
});

test("only edits outside the working directory count as scope", () => {
  // Naming a file in conversation is rare even when the edit is expected, so an earlier version
  // that asked whether a path was mentioned flagged 28 of 29 files in a real session.
  const inside = build([edit("/repo/src/a.ts"), edit("/repo/src/b.ts")]);
  assert.equal(rules(inside).includes("edits-outside-the-working-directory"), false);

  const outside = build([edit("/repo/src/a.ts"), edit("/elsewhere/c.ts")]);
  assert.ok(rules(outside).includes("edits-outside-the-working-directory"));
});

test("destructive commands are judged per line, and routine sync is not one", () => {
  const forced = build([bash("git push --force origin HEAD:dev")]);
  assert.ok(rules(forced).includes("destructive-command-executed"));

  const lease = build([bash("git push --force-with-lease origin feat")]);
  assert.equal(rules(lease).includes("destructive-command-executed"), false);

  // Multi-line scripts were tested as one blob, so the lookahead exempting a reset onto a remote
  // ref read the wrong neighbouring line.
  const sync = build([bash("git checkout -q dev\ngit fetch -q origin dev\ngit reset --hard -q origin/dev")]);
  assert.equal(rules(sync).includes("destructive-command-executed"), false);

  const blind = build([bash("git reset --hard")]);
  assert.ok(rules(blind).includes("destructive-command-executed"));
});

test("a command quoted as data is not a command that ran", () => {
  // Writing a rule that mentions `git reset --hard` made the reviewer flag its own source.
  const heredoc = build([bash("cat > rules.md <<'EOF'\ngit reset --hard\nEOF")]);
  assert.equal(rules(heredoc).includes("destructive-command-executed"), false);

  const commented = build([bash("# git reset --hard is destructive\nls")]);
  assert.equal(rules(commented).includes("destructive-command-executed"), false);

  const notShell = build([{ kind: "call", tool: "Write", input: { file_path: "/repo/x.md", content: "git reset --hard" } }]);
  assert.equal(rules(notShell).includes("destructive-command-executed"), false);
});

test("key material is named by kind and never repeated", () => {
  const body = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB";
  const leaked = build([{ kind: "result", text: `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n` }]);
  const finding = leaked.findings.find((entry) => entry.rule === "secret-material-in-session");
  assert.ok(finding, "key material must be reported");
  assert.match(finding.evidence, /value withheld/);
  assert.match(finding.what, /private key/);
  assert.equal(finding.evidence.includes(body), false, "the value must never be repeated");

  // Auditing forty real sessions, three of seven hits were a bare PEM header in documentation
  // and test literals. A header with no body is prose about key material, not key material.
  const prose = build([{ kind: "result", text: "the old rule matched -----BEGIN RSA PRIVATE KEY----- in docs" }]);
  assert.equal(prose.findings.some((entry) => entry.rule === "secret-material-in-session"), false);

  const aws = build([{ kind: "result", text: "AWS_ACCESS_KEY_ID=AKIA3XQ7ZP4WLM9RTKD2" }]);
  assert.match(aws.findings.find((entry) => entry.rule === "secret-material-in-session").what, /AWS access key id/);

  // The fixture above used to be AKIAIOSFODNN7EXAMPLE, which is the key id AWS publishes in its
  // own documentation. It is also in this repository's tests, so every session that worked on this
  // repository reported it. Measured across forty real sessions, six of the eight distinct matches
  // were of this kind -- documentation or fixtures -- and a high-severity rule that is wrong three
  // times in four teaches the operator to ignore the two that are real.
  const documented = build([{ kind: "result", text: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" }]);
  assert.equal(
    documented.findings.some((entry) => entry.rule === "secret-material-in-session"),
    false,
    "a published documentation key was reported as a credential to rotate"
  );
});

test("an example beside a real key does not suppress the real one", () => {
  // The natural place for both to appear together is a diff or a test file being edited. Requiring
  // every match to be real would let one documentation string hide the credential next to it.
  const mixed = build([
    { kind: "result", text: "AKIAIOSFODNN7EXAMPLE is the docs key; ours is AKIA3XQ7ZP4WLM9RTKD2" }
  ]);
  assert.ok(
    mixed.findings.some((entry) => entry.rule === "secret-material-in-session"),
    "a real key was suppressed by the example beside it"
  );
});

test("a written-down example is distinguished from a credential by its own text", () => {
  for (const example of [
    "AKIAIOSFODNN7EXAMPLE",
    "ghp_0123456789abcdefghijklmnopqrstuvwx",
    "sk-0123456789abcdefghijklmnopqrstuvwx",
    "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sk-notarealkeyusedonlyintestsxxxx"
  ]) {
    assert.equal(isWrittenDownExample(example), true, example);
  }
  // High-entropy values with no placeholder word and no run stay reportable.
  for (const real of ["AKIA3XQ7ZP4WLM9RTKD2", "ghp_7Kq2ZmR9pXvB4nTcW8yJdL3sHf6QaE", "sk-9WmZ4kQ7xR2vT8bN5cJ3hL6pD1yA"]) {
    assert.equal(isWrittenDownExample(real), false, real);
  }
});

test("a destructive command quoted inside a string is not a command that ran", () => {
  // Three of six destructive findings across forty sessions were the reviewer reading the source
  // of its own rules, quoted inside a Python or Markdown literal.
  const quoted = build([bash(`python3 -c "print('git reset --hard')"`)]);
  assert.equal(rules(quoted).includes("destructive-command-executed"), false);

  const real = build([bash("git reset --hard")]);
  assert.ok(rules(real).includes("destructive-command-executed"));
});

test("scratchpad and agent memory are not out-of-scope edits", () => {
  // This rule fired on five of forty sessions and every hit was a harness scratchpad or the
  // agent's own memory directory, which is where a session is supposed to put working files.
  const scratch = build([
    edit("/private/tmp/claude-501/abc/scratchpad/x.mjs"),
    edit("/Users/isaac/.claude/projects/p/memory/MEMORY.md")
  ]);
  assert.equal(rules(scratch).includes("edits-outside-the-working-directory"), false);

  const elsewhere = build([edit("/Users/isaac/other-project/src/a.ts")]);
  assert.ok(rules(elsewhere).includes("edits-outside-the-working-directory"));
});

test("a long unattended stretch is measured between operator turns", () => {
  const attended = build([...Array.from({ length: 20 }, () => bash("ls")), asked("check this"), bash("ls")]);
  assert.equal(rules(attended).includes("long-unattended-stretch"), false);

  const unattended = build(Array.from({ length: 30 }, () => bash("ls")));
  assert.ok(rules(unattended).includes("long-unattended-stretch"));
});

test("a clean session produces no findings", () => {
  const result = build([asked("fix the parser"), edit("/repo/parser.ts"), bash("npm test"), said("Done.")]);
  assert.deepEqual(result.findings, []);
});

// The two runtimes write different shapes and the reviewer must not learn either one's schema
// past lib/session.mjs. An earlier version parsed only Claude Code, so `aos review` on a Codex
// session reported "0 tool calls" and no findings, which reads as a clean session.
test("both runtimes reduce to the same normalized session", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadSession } = await import("../../lib/session.mjs");

  const directory = mkdtempSync(join(tmpdir(), "aos-session-"));
  try {
    const claude = join(directory, "claude.jsonl");
    writeFileSync(claude, [
      JSON.stringify({ type: "user", cwd: "/repo", timestamp: "2026-01-01T00:00:00Z", message: { content: "fix it" } }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T00:00:01Z",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] }
      })
    ].join("\n"));

    const codex = join(directory, "codex.jsonl");
    writeFileSync(codex, [
      JSON.stringify({ type: "session_meta", timestamp: "2026-01-01T00:00:00Z", payload: { cwd: "/repo" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-01-01T00:00:00Z", payload: { type: "user_message", message: "fix it" } }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-01-01T00:00:01Z",
        payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "npm test" }) }
      })
    ].join("\n"));

    for (const [label, path] of [["claude-code", claude], ["codex", codex]]) {
      const session = loadSession(path);
      assert.equal(session.cwd, "/repo", `${label} cwd`);
      assert.equal(session.calls.length, 1, `${label} call count`);
      assert.equal(session.calls[0].tool, "Bash", `${label} tool name`);
      assert.equal(session.calls[0].input.command, "npm test", `${label} command`);
      assert.equal(session.operatorTurns.length, 1, `${label} operator turns`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
