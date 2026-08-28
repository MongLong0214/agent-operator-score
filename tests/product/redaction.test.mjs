import assert from "node:assert/strict";
import test from "node:test";

import { containsSecretMaterial, redactFinding, redactText, redactValue } from "../../lib/redact.mjs";
import { reviewSession } from "../../lib/review.mjs";

const GITHUB = "ghp_0123456789abcdefghijklmnopqrstuvwx";
const AWS = "AKIAIOSFODNN7EXAMPLE";
const OPENAI = "sk-0123456789abcdefghijklmnopqrstuvwx";

test("material is removed and labelled, wherever it sits in the string", () => {
  for (const [label, value] of [
    ["github", GITHUB],
    ["aws", AWS],
    ["openai", OPENAI],
    ["slack", "xoxb-1234567890-abcdefghij"],
    ["google", `AIza${"a".repeat(35)}`],
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"]
  ]) {
    const { text, kinds } = redactText(`before ${value} after`);
    assert.equal(text.includes(value), false, `${label} survived`);
    assert.match(text, /^before \[redacted: .+\] after$/, label);
    assert.equal(kinds.length > 0, true, label);
  }
});

test("an assignment keeps the name and drops the value", () => {
  // Knowing that AWS_SECRET_ACCESS_KEY appeared in a command is the actionable half. The value is
  // the half that must not be written down a second time.
  const { text } = redactText('export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY"');
  assert.equal(text.includes("wJalrXUtnFEMI"), false, "the value survived");
  assert.match(text, /AWS_SECRET_ACCESS_KEY=\[redacted: assigned secret\]/);
});

test("a connection string keeps its host and loses its password", () => {
  const { text } = redactText("psql postgres://appuser:hunter2hunter2@db.internal:5432/prod");
  assert.equal(text.includes("hunter2hunter2"), false);
  assert.match(text, /postgres:\/\/appuser:\[redacted: connection string password\]@db\.internal/);
});

test("describing a secret is not carrying one", () => {
  // A refusal the operator wrote is exactly the evidence worth reading, and an earlier version of
  // this product marked that refusal unsafe. Redaction must not repeat the mistake.
  for (const safe of [
    "do not commit your private key",
    "rotate the GitHub token before merging",
    "the AWS access key id is stored in 1Password",
    "-----BEGIN PRIVATE KEY-----",
    "TOKENIZER_PATH=/usr/local/share/tokenizer"
  ]) {
    assert.equal(containsSecretMaterial(safe), false, safe);
    assert.equal(redactText(safe).text, safe, safe);
  }
});

test("redactValue walks nested structures, arrays and keys", () => {
  const redacted = redactValue({
    findings: [{ evidence: `curl -H "authorization: Bearer ${GITHUB}"` }],
    [`/home/me/${AWS}/config`]: 1,
    depth: { deeper: [[OPENAI]] }
  });
  const serialized = JSON.stringify(redacted);
  for (const secret of [GITHUB, AWS, OPENAI]) {
    assert.equal(serialized.includes(secret), false, `${secret} survived a nested walk`);
  }
});

test("redactValue preserves shape: an array stays an array", () => {
  // Without the array branch the walk still redacts, because an array is an object -- and it comes
  // back as {"0":...,"1":...}. Nothing leaks and every consumer of a findings list breaks.
  const out = redactValue({ evidence_ids: ["a", "b"], nested: [[1, 2]] });
  assert.equal(Array.isArray(out.evidence_ids), true, "an array became an object");
  assert.deepEqual(out.evidence_ids, ["a", "b"]);
  assert.equal(Array.isArray(out.nested[0]), true);
});

test("a cycle does not crash the redactor", () => {
  // A report that throws is a report that warns nobody.
  const value = { name: "root" };
  value.self = value;
  assert.doesNotThrow(() => redactValue(value));
  assert.equal(redactValue(value).self, "[cycle]");
});

const sessionWith = (steps, cwd = "/repo") => ({
  path: "/sessions/x.jsonl",
  cwd,
  duration_ms: 1000,
  steps,
  calls: steps.filter((step) => step.kind === "call"),
  operatorTurns: steps.filter((step) => step.kind === "message" && step.role === "operator")
});

test("a secret inside a destructive command is not reprinted as evidence", () => {
  // This is the path the dedicated secret rule never covered: the command line is quoted verbatim
  // by a different rule, so hiding the match in one place changed nothing.
  const review = reviewSession(
    sessionWith([
      { kind: "call", at: 1, tool: "Bash", input: { command: `AWS_SECRET_ACCESS_KEY=${AWS} git push --force https://x` } }
    ])
  );
  const serialized = JSON.stringify(review);
  assert.equal(serialized.includes(AWS), false, "a credential was reprinted in a finding");
  assert.equal(review.findings.length > 0, true, "the destructive command should still be reported");
});

test("a secret inside a completion claim is not reprinted as evidence", () => {
  const review = reviewSession(
    sessionWith([
      { kind: "call", at: 1, tool: "Write", input: { file_path: "/repo/a.js" } },
      { kind: "message", role: "agent", at: 2, text: `all tests pass, token ${GITHUB} was used` }
    ])
  );
  assert.equal(JSON.stringify(review).includes(GITHUB), false);
});

test("a secret inside an out-of-tree path is not reprinted as evidence", () => {
  // The path is a key in a map of per-file counts, so a redactor that only walked values would
  // have printed it.
  const review = reviewSession(
    sessionWith([
      { kind: "call", at: 1, tool: "Write", input: { file_path: `/elsewhere/${AWS}/notes.txt` } }
    ])
  );
  assert.equal(JSON.stringify(review).includes(AWS), false);
});

test("redactFinding is what reviewSession applies, not a separate path", () => {
  const finding = { rule: "x", severity: "high", where: "step 1", what: "y", evidence: `token ${GITHUB}` };
  assert.equal(JSON.stringify(redactFinding(finding)).includes(GITHUB), false);
});
