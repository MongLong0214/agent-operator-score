import assert from "node:assert/strict";
import test from "node:test";

import { aggregateFindings, isWrittenDownExample, reviewSession } from "../../lib/review.mjs";

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
// A call that recorded what it printed. A repeat is only no progress when the answer was the same
// too, so a case about repetition has to say what came back.
const ran = (command, text = "output", ok = true) => ({ kind: "call", tool: "Bash", input: { command }, result: { ok, text } });
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

test("reporting that a test stayed green is not claiming the work is done", () => {
  // A mutation report saying a test kept passing says the test failed to catch something. Both
  // completion-claim findings in the owner's held-back sessions were this shape, and reading a
  // defect report as a claim of success is the worst direction for this rule to be wrong in.
  for (const text of [
    "Mutating both defaults to false left the test passing.",
    "Changing the reduction left all three new tests passing because the fixture makes them identical.",
    "The mutation kept the tests passing, so the assertion is inert.",
    // The bare infinitive was missing from the first version of this exclusion, and it cost a
    // finding in the held-back measurement.
    "Reverting its helper adoption would leave these helper tests passing.",
    "That change would keep the tests passing while removing the check."
  ]) {
    const result = build([bash("npm test"), edit(), said(text)]);
    assert.equal(rules(result).includes("completion-claimed-without-verification"), false, text);
  }

  // The exclusion stops at the sentence, so a real claim after a clause using one of those verbs is
  // still a claim.
  const real = build([bash("npm test"), edit(), said("This leaves the door open. All tests pass, ready to merge.")]);
  assert.ok(rules(real).includes("completion-claimed-without-verification"));
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

test("rm -rf is judged by its target, not by its flags", () => {
  // Every absolute path outside /tmp counted as destructive, so ordinary cleanup of a directory the
  // session made was reported. Across forty sessions that was 26 of 33 destructive findings, and a
  // rule that fires on routine cleanup is one the operator stops reading.
  for (const safe of [
    "rm -rf /Users/isaac/scratch/build",
    "rm -rf /var/folders/xx/T/aos-test",
    "rm -rf node_modules",
    'rm -rf "$ROOT"',
    "rm -rf ./dist"
  ]) {
    assert.equal(rules(build([bash(safe)])).includes("destructive-command-executed"), false, safe);
  }

  for (const dangerous of [
    "rm -rf /",
    "rm -rf /usr",
    "rm -rf /Users",
    "rm -rf ~",
    'rm -rf "$HOME"',
    // The classic: an unset variable makes the trailing slash the whole target.
    'rm -rf "$BUILD/"'
  ]) {
    assert.ok(rules(build([bash(dangerous)])).includes("destructive-command-executed"), dangerous);
  }
});

test("resetting onto a ref that was just fetched is synchronisation", () => {
  // origin/ and upstream/ were already excluded. FETCH_HEAD is the same act and was not, because
  // the underscore stops \bHEAD\b from matching.
  for (const sync of ["git reset --hard FETCH_HEAD", "git reset --hard ORIG_HEAD", "git reset --hard @{u}"]) {
    assert.equal(rules(build([bash(sync)])).includes("destructive-command-executed"), false, sync);
  }
  assert.ok(rules(build([bash("git reset --hard 3b17051c")])).includes("destructive-command-executed"));
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
  assert.equal(rules(attended).includes("long-uninterrupted-tool-run"), false);

  // Recorded, but as an observation: nothing went wrong inside it.
  const unattended = build(Array.from({ length: 30 }, (_, i) => bash(`ls dir-${i}`)));
  assert.equal(rules(unattended).includes("long-uninterrupted-tool-run"), false);
  assert.ok(unattended.observations.some((entry) => entry.rule === "long-uninterrupted-tool-run"));
});

test("length on its own is an observation, not a warning", () => {
  // This rule produced 82% of all findings across forty sessions and varied eightfold between
  // projects, because how long a stretch runs is a property of the work. A careful refactor is
  // long; so is a loop retrying one failing command, and only one of them is a defect.
  const long = build(Array.from({ length: 40 }, (_, i) => bash(`rg pattern-${i} src/`)));
  assert.deepEqual(long.findings, [], "an uneventful long stretch was reported as a problem");
  const observed = long.observations.find((entry) => entry.rule === "long-uninterrupted-tool-run");
  assert.equal(observed.severity, "info");
  assert.match(observed.what, /nothing inside it failed or repeated/);
});

test("what raises a stretch is something that happened inside it", () => {
  const failed = { kind: "result", ok: false, text: "error" };
  const retried = build([
    ...Array.from({ length: 24 }, (_, i) => bash(`step-${i}`)),
    { ...bash("npm test"), result: failed },
    { ...bash("npm test"), result: failed }
  ]);
  const finding = retried.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run");
  assert.notEqual(finding.severity, "info");
  assert.match(finding.what, /unchanged-retry-after-failure/);
  assert.match(finding.evidence, /first failure at call 25 of 26/);
});

test("the same call three times over is a loop, even when nothing failed", () => {
  const looping = build([
    ...Array.from({ length: 24 }, (_, i) => bash(`step-${i}`)),
    ran("git status", "nothing to commit"),
    ran("git status", "nothing to commit"),
    ran("git status", "nothing to commit")
  ]);
  const finding = looping.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run");
  assert.match(finding.what, /no-progress-loop/);
});

test("the same call answering differently every time is waiting, not looping", () => {
  // Draining a background process with repeated empty writes, or polling `ps` while a build runs, is
  // the same call over and over that learns something new each time. Fifty-five of the sixty-three
  // repeats in the owner's held-back sessions were this, and the rule called every one of them a
  // stuck agent.
  const polling = build([
    ...Array.from({ length: 24 }, (unused, index) => bash(`step-${index}`)),
    ran("tail -f build.log", "compiling a.ts"),
    ran("tail -f build.log", "compiling b.ts"),
    ran("tail -f build.log", "compiling c.ts")
  ]);
  const finding = polling.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run");
  assert.equal(/no-progress-loop/.test(finding?.what ?? ""), false, finding?.what);

  // A result nobody recorded is not a match either. Silence is the safer direction for a claim that
  // an agent was stuck, and a runtime that keeps no output would otherwise make every repeat one.
  const unrecorded = build([
    ...Array.from({ length: 24 }, (unused, index) => bash(`step-${index}`)),
    bash("git status"),
    bash("git status"),
    bash("git status")
  ]);
  assert.equal(
    /no-progress-loop/.test(unrecorded.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run")?.what ?? ""),
    false
  );
});

test("re-running the same test after editing the code is iteration, not a loop", () => {
  // Red-green. The command repeats because the code under it changed, and the second run is asking a
  // question the first one could not answer. Counting the repeat alone made five of the nine loop
  // findings in the owner's held-back sessions wrong -- every one an agent doing exactly the right
  // thing, and every one raised to high severity for it.
  const iterating = build([
    ...Array.from({ length: 24 }, (unused, index) => bash(`step-${index}`)),
    ran("npm test", "1 failing"),
    edit(),
    ran("npm test", "1 failing"),
    edit(),
    ran("npm test", "1 failing")
  ]);
  const finding = iterating.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run");
  assert.equal(/no-progress-loop/.test(finding?.what ?? ""), false, finding?.what);

  // A write through a shell redirection counts as a change too, or the rule would only understand
  // edits made with a tool.
  const viaShell = build([
    ...Array.from({ length: 24 }, (unused, index) => bash(`step-${index}`)),
    ran("npm test", "1 failing"),
    bash("cat > /repo/a.ts <<'EOF'\nnew\nEOF"),
    ran("npm test", "1 failing"),
    bash("cat > /repo/a.ts <<'EOF'\nnewer\nEOF"),
    ran("npm test", "1 failing")
  ]);
  assert.equal(
    /no-progress-loop/.test(viaShell.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run")?.what ?? ""),
    false
  );

  // And the distinction is real in both directions: back to back with nothing in between is still a
  // loop, which is the shape a stuck agent takes.
  const stuck = build([
    ...Array.from({ length: 24 }, (unused, index) => bash(`step-${index}`)),
    ran("npm test", "1 failing"),
    ran("npm test", "1 failing"),
    ran("npm test", "1 failing")
  ]);
  assert.match(stuck.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run").what, /no-progress-loop/);

  // A read between two runs is not a change. Looking at a file does not make the next run different.
  const justLooking = build([
    ...Array.from({ length: 24 }, (unused, index) => bash(`step-${index}`)),
    ran("npm test", "1 failing"),
    ran("cat /repo/a.ts", "contents"),
    ran("npm test", "1 failing"),
    ran("cat /repo/a.ts", "contents"),
    ran("npm test", "1 failing")
  ]);
  assert.match(justLooking.findings.find((entry) => entry.rule === "long-uninterrupted-tool-run").what, /no-progress-loop/);
});

test("a stretch is counted per stretch, not across the whole session", () => {
  // Two shorter stretches with an operator turn between them are two moments the operator was
  // present for, and summing them would report a session that was interrupted as one that was not.
  const twice = build([
    ...Array.from({ length: 20 }, (_, i) => bash(`a-${i}`)),
    asked("looks right?"),
    ...Array.from({ length: 20 }, (_, i) => bash(`b-${i}`))
  ]);
  assert.equal(rules(twice).includes("long-uninterrupted-tool-run"), false);
  // And not as an observation either: merging the two stretches would report forty consecutive
  // calls in a session the operator interrupted halfway through.
  assert.deepEqual(twice.observations, []);
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

test("the trend separates how many sessions from how many findings", () => {
  // The count used to be per finding and was printed as "4 / 40 sessions", which reads as a habit
  // across the operator's work when it is one moment in one session.
  const noisy = { findings: [
    { rule: "destructive-command-executed", severity: "high" },
    { rule: "destructive-command-executed", severity: "high" },
    { rule: "destructive-command-executed", severity: "high" }
  ] };
  const quiet = { findings: [{ rule: "long-unattended-stretch", severity: "high" }] };
  const spread = { findings: [{ rule: "long-unattended-stretch", severity: "high" }] };

  const ranked = aggregateFindings([noisy, quiet, spread]);
  const destructive = ranked.find((row) => row.rule === "destructive-command-executed");
  const unattended = ranked.find((row) => row.rule === "long-unattended-stretch");

  assert.equal(destructive.session_count, 1, "three findings in one session counted as three sessions");
  assert.equal(destructive.finding_count, 3);
  assert.equal(unattended.session_count, 2);
  assert.equal(unattended.finding_count, 2);

  // Prevalence first: two sessions beat three findings in one.
  assert.equal(ranked[0].rule, "long-unattended-stretch", "the noisier single session outranked the habit");
});

test("a rule that fires four times in one session is one session, not four", () => {
  // The trend counted findings and printed them as sessions, so one moment in one session read as
  // a pattern across the operator's work.
  const repeated = build([
    bash("rm -rf /"),
    bash("rm -rf /usr"),
    bash("rm -rf /etc"),
    bash("rm -rf /bin")
  ]);
  // Through the aggregator, on findings a real review produced. Counting the findings and mapping
  // each to the session they already came from would be arithmetic on a constant -- it answers one
  // whatever the aggregator does, which is how this assertion passed while the dedupe was broken.
  const row = aggregateFindings([repeated]).find((entry) => entry.rule === "destructive-command-executed");
  assert.equal(row.finding_count, 4, "each command should still be its own finding");
  assert.equal(row.session_count, 1, "four findings came from one session");
});

test("a patch body is file content, not a command that ran", () => {
  // Two of the ten high-severity findings in the owner's held-back sessions were `DROP TABLE`
  // inside a sqlite migration an agent was *writing*, reported as an irreversible command. This is
  // the rule the heredoc stripper already applies, in the shape Codex uses.
  const patch = 'const patch = "*** Begin Patch\\n*** Update File: /repo/storage.py\\n+  conn.execute(\\"DROP TABLE runs\\")\\n*** End Patch"; await tools.apply_patch(patch);';
  assert.equal(rules(build([bash(patch)])).includes("destructive-command-executed"), false);

  // A destructive command that really ran is still one. Unquoted, because a command quoted as data
  // is already excluded by a rule of its own -- that is what `psql -c 'DROP TABLE x'` is.
  assert.ok(rules(build([bash("git push --force origin main")])).includes("destructive-command-executed"));
  const both = 'const p = "*** Begin Patch\\n*** Update File: /repo/a.sql\\n+DROP TABLE x\\n*** End Patch"; await tools.apply_patch(p); git push --force origin main';
  assert.ok(rules(build([bash(both)])).includes("destructive-command-executed"), "a real command beside a patch still counts");
});

test("output written outside the working tree is not an edit to the work", () => {
  // A PR body and two CI logs under /tmp were three of the five "edits" behind one held-back
  // finding; that session had pushed and watched CI go green, and was told nothing confirmed it.
  const captured = build([
    bash("npm test"),
    bash("gh api /repos/x/actions/jobs/1/logs > /tmp/red.log"),
    bash("cat > /tmp/pr-body.md <<'EOF'\nbody\nEOF")
  ], "/repo");
  assert.equal(rules(captured).includes("session-ended-on-stale-evidence"), false);

  // A temp path is the work when the session is working there, which many of these sessions are.
  const worktree = build([bash("npm test"), bash("echo x > /private/tmp/wt/src/a.ts")], "/private/tmp/wt");
  assert.ok(rules(worktree).includes("session-ended-on-stale-evidence"));

  // And an ordinary edit is untouched.
  assert.ok(rules(build([bash("npm test"), bash("echo x > /repo/src/a.ts")], "/repo")).includes("session-ended-on-stale-evidence"));
});
