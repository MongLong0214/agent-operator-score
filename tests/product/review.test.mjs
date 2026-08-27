import assert from "node:assert/strict";
import test from "node:test";

import { reviewSession } from "../../lib/review.mjs";

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

test("key material in the transcript is reported without repeating it", () => {
  const leaked = build([{ kind: "result", text: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n" }]);
  const finding = leaked.findings.find((entry) => entry.rule === "secret-material-in-session");
  assert.ok(finding, "key material must be reported");
  assert.equal(finding.evidence, "match withheld");
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
