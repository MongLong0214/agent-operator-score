import assert from "node:assert/strict";
import test from "node:test";

import { effectsOfCall, effectsOfScript, effectsOfShellLine, isUnparsableShell } from "../../lib/file-effects.mjs";
import { reviewSession } from "../../lib/review.mjs";

const paths = (line) => effectsOfShellLine(line).map((entry) => entry.path).sort();
const kinds = (line) => effectsOfShellLine(line).map((entry) => `${entry.kind}:${entry.path}`).sort();

test("the ways a file changes that are not a tool call", () => {
  // Knowing five tool names meant a session that edited this way looked like a session that edited
  // nothing, and the rule about claiming completion after an unverified edit never fired for it.
  assert.deepEqual(paths("echo hi > notes.md"), ["notes.md"]);
  assert.deepEqual(paths("cat a.txt >> combined.txt"), ["combined.txt"]);
  assert.deepEqual(paths("printf x | tee out.log"), ["out.log"]);
  assert.deepEqual(paths("sed -i '' 's/a/b/' src/app.ts"), ["src/app.ts"]);
  assert.deepEqual(paths("cp build/out.js dist/out.js"), ["dist/out.js"]);
  assert.deepEqual(kinds("mv old/name.ts new/name.ts"), ["rename:new/name.ts"]);
  assert.deepEqual(kinds("rm stale/cache.json"), ["delete:stale/cache.json"]);
  assert.deepEqual(kinds("ln -s ../real.ts link.ts"), ["symlink:link.ts"]);
});

test("a redirection into a null sink is not an edit", () => {
  // Otherwise every `2>/dev/null` is a file the session changed.
  assert.deepEqual(paths("noisy-command 2>/dev/null"), []);
  assert.deepEqual(paths("ls > /dev/null"), []);
});

test("a file descriptor is not a file", () => {
  // `0`, `1` and `2` were among the most frequent "files" this produced across forty sessions.
  assert.deepEqual(paths("command 2>&1"), []);
  assert.deepEqual(paths("git log --oneline | head -1"), []);
});

test("code inside a quoted script argument is not a redirection", () => {
  // Parsing it as shell read arrow functions and regex literals as writes. What excludes it is the
  // quoting, not the interpreter: refusing every `-e`/`-c` line dropped 249 real paths, because a
  // redirection sitting outside the script argument is a genuine write.
  assert.deepEqual(paths(`node -e 'const write = () => log > out.txt'`), []);
  assert.deepEqual(paths(`python3 -c "if x > report.md: pass"`), []);
  assert.deepEqual(paths(`node -e 'const x = 1' > result.json`), ["result.json"]);
  assert.equal(isUnparsableShell("echo hi > notes.md"), false);
});

test("a line whose quotes do not close was cut out of something larger", () => {
  assert.equal(isUnparsableShell(`echo "unterminated > file.txt`), true);
  assert.deepEqual(paths(`echo "unterminated > file.txt`), []);
});

test("an apostrophe inside double quotes is a character, not a quote", () => {
  // Counting ' and " separately read this line as unbalanced and refused it. Measured, that
  // refusal dropped 154 real paths.
  assert.equal(isUnparsableShell(`echo "don't stop" > notes.md`), false);
  assert.deepEqual(paths(`echo "don't stop" > notes.md`), ["notes.md"]);
  assert.deepEqual(paths(`echo 'a "quoted" word' > out.log`), ["out.log"]);
});

test("an operator without a token boundary is not a redirection", () => {
  // `a=>b.txt` is an arrow, not a write. Without the boundary every arrow function in a command
  // named a file.
  assert.deepEqual(paths("const f = a=>b.txt"), []);
  assert.deepEqual(paths("check x>=y.txt"), []);
  assert.deepEqual(paths("build > out.txt"), ["out.txt"]);
});

test("a word is not a path", () => {
  // Prose reaching the parser produced files named `The` and `s`. A path has a separator or an
  // extension.
  assert.deepEqual(paths("summarise > The"), []);
  assert.deepEqual(paths("x > s"), []);
  assert.deepEqual(paths("x > report.md"), ["report.md"]);
  assert.deepEqual(paths("x > logs/today"), ["logs/today"]);
});

test("trailing punctuation belongs to the line, not to the name", () => {
  // `2>/dev/null)` was the single most frequent target this produced.
  assert.deepEqual(paths("(build > out/app.js)"), ["out/app.js"]);
});

test("a multi-line quoted argument does not hide the redirection after it", () => {
  // Scanning per line split this into two fragments that are each unbalanced, and the one carrying
  // the redirection was refused. Measured, that lost 152 real paths.
  assert.deepEqual(effectsOfScript('echo "line one\nline two" > out.txt').map((e) => e.path), ["out.txt"]);
  // And the text inside the quotes is still not read as commands.
  assert.deepEqual(effectsOfScript('echo "first\nrm inner.txt" > out.txt').map((e) => e.kind), ["write"]);
});

test("a heredoc body is data, not commands", () => {
  const call = {
    tool: "Bash",
    input: { command: "cat <<'EOF' > real.txt\necho fake > not-a-file.txt\nEOF\n" }
  };
  const written = effectsOfCall(call).map((entry) => entry.path);
  assert.equal(written.includes("real.txt"), true);
  assert.equal(written.includes("not-a-file.txt"), false, "a line inside a heredoc was read as a command");
});

test("a native tool call is high confidence and a shell parse is not", () => {
  // A reader weighing a finding needs to know which of the two it rests on.
  const native = effectsOfCall({ tool: "Write", input: { file_path: "/repo/a.ts" } });
  assert.deepEqual(native, [{ kind: "write", path: "/repo/a.ts", source: "native-tool", confidence: "HIGH" }]);
  assert.equal(effectsOfShellLine("echo x > a.ts")[0].confidence, "MEDIUM");
  assert.equal(effectsOfShellLine("touch a.ts")[0].confidence, "LOW");
});

test("a write tool that did not record its path is still a write", () => {
  // Dropping the effect would report a session that edited as one that did not.
  const effects = effectsOfCall({ tool: "Edit", input: {} });
  assert.equal(effects.length, 1);
  assert.equal(effects[0].path, null);
  assert.equal(effects[0].confidence, "LOW");
});

const session = (steps, cwd = "/repo") => ({
  path: "/s.jsonl",
  cwd,
  duration_ms: 1,
  steps,
  calls: steps.filter((step) => step.kind === "call"),
  operatorTurns: []
});
const bash = (command) => ({ kind: "call", at: 1, tool: "Bash", input: { command }, result: null });
const rules = (review) => review.findings.map((finding) => finding.rule);

test("a claim after a shell edit is caught, the same as after a tool edit", () => {
  // This is the whole point: the rule could not see a `sed -i` session at all.
  const review = reviewSession(
    session([
      bash("sed -i '' 's/a/b/' /repo/src/app.ts"),
      { kind: "message", role: "agent", at: 2, text: "all tests pass" }
    ])
  );
  assert.ok(rules(review).includes("completion-claimed-without-verification"));
});

test("a low-confidence parse does not put a file into an out-of-tree finding", () => {
  // `touch` reads as a write with low confidence. Reporting it as an out-of-tree edit would name a
  // file on the strength of a guess.
  const review = reviewSession(session([bash("touch /elsewhere/marker.txt")]));
  assert.equal(rules(review).includes("edits-outside-the-working-directory"), false);

  const confident = reviewSession(session([bash("echo x > /elsewhere/real.txt")]));
  assert.ok(rules(confident).includes("edits-outside-the-working-directory"));
});

test("a relative path is resolved against the session's working directory", () => {
  // Otherwise every relative edit looks like it happened nowhere. Asserting only that an inside
  // path is not reported passes when resolution is dropped entirely, so the case that decides it
  // is a relative path that leaves the tree.
  const inside = reviewSession(session([bash("echo x > src/a.ts")], "/repo"));
  assert.equal(rules(inside).includes("edits-outside-the-working-directory"), false);

  const escaping = reviewSession(session([bash("echo x > ../sibling/a.ts")], "/repo"));
  assert.ok(
    rules(escaping).includes("edits-outside-the-working-directory"),
    "a relative path that leaves the working tree was not resolved"
  );
});

test("a Codex patch call is a write, and the path comes from the envelope", () => {
  // Codex does not edit through a tool with a path argument: it runs a shell call whose source
  // builds a patch envelope in a string and hands it to `tools.apply_patch`. Every rule here that
  // asks what a session wrote was answering "nothing" for every Codex session.
  const update = 'const patch = "*** Begin Patch\\n*** Update File: /repo/src/index.ts\\n@@\\n-a\\n+b\\n*** End Patch"; const r = await tools.apply_patch(patch);';
  assert.deepEqual(effectsOfScript(update), [
    { kind: "write", path: "/repo/src/index.ts", source: "apply-patch", confidence: "HIGH" }
  ]);

  const added = 'const p = "*** Begin Patch\\n*** Add File: /repo/new.ts\\n+x\\n*** End Patch"; await tools.apply_patch(p);';
  assert.equal(effectsOfScript(added)[0].kind, "write");
  const removed = 'const p = "*** Begin Patch\\n*** Delete File: /repo/old.ts\\n*** End Patch"; await tools.apply_patch(p);';
  assert.equal(effectsOfScript(removed)[0].kind, "delete");

  // Several files in one envelope are several writes.
  const many = 'const p = "*** Begin Patch\\n*** Update File: /repo/a.ts\\n@@\\n*** Update File: /repo/b.ts\\n@@\\n*** End Patch"; await tools.apply_patch(p);';
  assert.deepEqual(effectsOfScript(many).map((entry) => entry.path), ["/repo/a.ts", "/repo/b.ts"]);
});

test("quoting the patch format is not applying a patch", () => {
  // The call has to be there, not just the envelope. A document explaining the format is prose, and
  // prose is not a write.
  const prose = "cat docs/apply-patch.md  # explains *** Begin Patch and *** Update File: /repo/x.ts";
  assert.deepEqual(effectsOfScript(prose), []);
  const envelopeOnly = 'echo "*** Begin Patch\\n*** Update File: /repo/x.ts\\n*** End Patch" > /repo/example.txt';
  assert.deepEqual(effectsOfScript(envelopeOnly).map((entry) => entry.path), ["/repo/example.txt"]);
});

test("the shell parser does not also run over the JavaScript around a patch", () => {
  // `a => b` was read as a redirection once already. The rest of an apply_patch call is JavaScript.
  const script = 'const patch = "*** Begin Patch\\n*** Update File: /repo/a.ts\\n@@\\n-  const f = (x) => x > 2;\\n*** End Patch"; await tools.apply_patch(patch);';
  assert.deepEqual(effectsOfScript(script).map((entry) => entry.path), ["/repo/a.ts"]);
});
