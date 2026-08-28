import assert from "node:assert/strict";
import test from "node:test";
import { reviewSession } from "../../lib/review.mjs";
import { effectiveCwd } from "../../lib/file-effects.mjs";

const build = (steps, cwd = "/repo") => {
  const timed = steps.map((step, index) => ({ at: index * 1000, ...step }));
  return reviewSession({
    path: "/t.jsonl", cwd, started: 0, ended: timed.length * 1000, duration_ms: timed.length * 1000,
    steps: timed,
    calls: timed.filter((s) => s.kind === "call"),
    operatorTurns: timed.filter((s) => s.kind === "message" && s.role === "operator")
  });
};
const bash = (command, extra = {}) => ({ kind: "call", tool: "Bash", input: { command, ...extra } });
const rules = (result) => result.findings.map((f) => f.rule);
const count = (result, rule) => result.findings.filter((f) => f.rule === rule).length;

// #502, measured by an independent agent given only the repository URL: five of six
// destructive-command findings and thirteen of fifteen secret findings were text *about* a command
// or a key rather than one that ran.

test("a program in another language is not a shell script", () => {
  // `node -e '<js>'` is a shell call whose argument is JavaScript. Scanning it as shell read a
  // regex literal inside a test as a command that ran.
  const regexLiteral = build([
    bash(`node -e 'console.log("bodies gone:", !/drop table|mkfs/i.test(out));'`)
  ]);
  assert.equal(rules(regexLiteral).includes("destructive-command-executed"), false);

  // And a fixture array of command strings, which the runner unwrapper otherwise helpfully
  // unwrapped into apparent commands.
  // As it appeared in a real transcript: a one-liner that writes single quotes as \x27, which is
  // how they survive being nested inside a single-quoted shell argument.
  const fixtureArray = build([
    bash(`node -e 'const should=["bash -c \\x27git push --force origin main\\x27","sh -c \\"git reset --hard 9a8b7c6\\""];'`)
  ]);
  assert.equal(rules(fixtureArray).includes("destructive-command-executed"), false);

  const python = build([bash(`python3 -c 'print("rm -rf /var/data")'`)]);
  assert.equal(rules(python).includes("destructive-command-executed"), false);
});

test("the guard the interpreter fix must not break", () => {
  // A real destructive command still reports, including one behind a shell runner -- that carve-out
  // was itself a fix (#468) and trading it away would be the worse error.
  const direct = build([bash("git reset --hard 9a8b7c6")]);
  assert.ok(rules(direct).includes("destructive-command-executed"));
  // `git reset --hard origin/...` stays exempt: that is routine synchronisation, and the exemption
  // predates this change.
  assert.equal(rules(build([bash("git reset --hard origin/main~5")])).includes("destructive-command-executed"), false);

  const wrapped = build([bash(`bash -c 'git push --force origin main'`)]);
  assert.ok(rules(wrapped).includes("destructive-command-executed"));

  // `node` running a *file* is not an interpreter payload and must not become a blanket exemption.
  // `rm -rf` of an ordinary path is deliberately not destructive here -- flagging every variable
  // produced 420 findings in four sessions -- so the case that proves the exemption is narrow uses
  // a form the rule does catch.
  const notAPayload = build([bash("node build.mjs && git reset --hard 9a8b7c6")]);
  assert.ok(rules(notAPayload).includes("destructive-command-executed"));
  assert.ok(rules(build([bash("rm -rf $HOME")])).includes("destructive-command-executed"));
});

test("one credential is one finding, however many times it is printed", () => {
  const key = "ghp_Ab3xQ9zK2mN7pW1vT5rY8sD4fG6hJ0";
  const twice = build([
    bash(`gh api -H "Authorization: token ${key}" /user`),
    { kind: "result", text: `Authorization: token ${key}` }
  ]);
  // "Rotate this" is a statement about a credential, not about how often it appeared.
  assert.equal(count(twice, "secret-material-in-session"), 1);

  // Two different credentials are two findings.
  const both = build([
    bash(`export A=${key}`),
    bash("export B=ghp_Zz9yXx8wVv7uTt6sRr5qPp4oNn3m")
  ]);
  assert.equal(count(both, "secret-material-in-session"), 2);
});

test("a value the session wrote into a test is that session's fixture", () => {
  const fake = "ghp_Kk1jHh2gGg3fFf4eEe5dDd6cCc7bB";
  // Authored through a heredoc into a test file, then printed back by running that test. Shape
  // cannot tell this from a real key -- a fixture is built to look real on purpose -- so the rule
  // uses authorship instead.
  const authored = build([
    bash(`cat > tests/product/secrets.test.mjs <<'EOF'\nconst token = "${fake}";\nEOF`),
    { kind: "result", text: `expected ${fake} to be redacted` }
  ]);
  assert.equal(rules(authored).includes("secret-material-in-session"), false);

  // The same value in a session that never authored it is still reported.
  const used = build([{ kind: "result", text: `Authorization: token ${fake}` }]);
  assert.ok(rules(used).includes("secret-material-in-session"));
});

test("a leading cd moves where a command's relative paths land", () => {
  // Nothing tracked `cd`, so `cd /tmp/x && cat > prompt.txt` resolved prompt.txt against the
  // session's own directory: a file written outside the tree looked like an edit to the work, and
  // `session-ended-on-stale-evidence` reported a session that had done nothing wrong.
  assert.equal(effectiveCwd({ input: { command: "cd /private/tmp/e2e && cat > prompt.txt" } }, "/repo"), "/private/tmp/e2e");
  assert.equal(effectiveCwd({ input: { command: 'cd "/tmp/with space" && ls' } }, "/repo"), "/tmp/with space");
  assert.equal(effectiveCwd({ input: { command: "cd build && make" } }, "/repo"), "/repo/build");

  // Each Bash call is a fresh shell, so a cd that is not leading moves nothing that came before it.
  assert.equal(effectiveCwd({ input: { command: "make && cd /elsewhere" } }, "/repo"), "/repo");
  // And a cd inside a heredoc is text.
  assert.equal(effectiveCwd({ input: { command: "cat <<'EOF'\ncd /elsewhere\nEOF" } }, "/repo"), "/repo");
  assert.equal(effectiveCwd({ input: { command: "npm test" } }, "/repo"), "/repo");
  assert.equal(effectiveCwd({ input: {} }, "/repo"), "/repo");
});

test("a file written after a cd is not an edit to the work", () => {
  const scratch = build([
    bash("npm test"),
    bash("cd /private/tmp/e2e && cat > prompt.txt <<'EOF'\nhello\nEOF")
  ]);
  // The write went to a scratch directory, so nothing was edited after the last verification.
  assert.equal(rules(scratch).includes("session-ended-on-stale-evidence"), false);
  assert.equal(rules(scratch).includes("edits-outside-the-working-directory"), false);

  // An edit inside the tree after verification is still reported.
  const real = build([
    bash("npm test"),
    { kind: "call", tool: "Edit", input: { file_path: "/repo/src/a.ts" } }
  ]);
  assert.ok(rules(real).includes("session-ended-on-stale-evidence"));
});
