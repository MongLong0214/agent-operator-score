import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addAgent, initBare, makePlan, run } from "./helpers.mjs";
import { failureSignature } from "../../lib/cli.mjs";
import { isAosWorkspaceTranscript, isHarnessBlock, operatorText } from "../../lib/session.mjs";
import { runProcess } from "../../lib/core.mjs";
import { reviewSession } from "../../lib/review.mjs";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "aos.mjs");
const temporary = (name) => mkdtempSync(join(tmpdir(), name));
const session = (steps, cwd = "/repo") => {
  const timed = steps.map((step, index) => ({ at: index * 1000, ...step }));
  return reviewSession({
    path: "/t.jsonl", cwd, started: 0, ended: timed.length * 1000, duration_ms: timed.length * 1000,
    steps: timed,
    calls: timed.filter((step) => step.kind === "call"),
    operatorTurns: timed.filter((step) => step.kind === "message" && step.role === "operator")
  });
};
const rules = (result) => result.findings.map((finding) => finding.rule);

// #460
test("cleaning up scratch cannot end a run", async () => {
  // The agent's HOME is also its TMPDIR, so anything it or its children write lands in the
  // directory being removed. A hook still running after the agent exited creates an entry mid-walk,
  // rmSync raises ENOTEMPTY, and thrown from a `finally` that replaced the run's own result: an
  // operator paid for a family and got rc=70 and one line of ENOTEMPTY.
  const workspace = temporary("aos-cleanup-");
  try {
    const leaveAWriter = [
      'const {spawn} = require("node:child_process"); const d = process.env.HOME;',
      'spawn(process.execPath, ["-e", `const fs=require("fs");let i=0;const t=setInterval(()=>{try{fs.writeFileSync("${d}/x"+(i++),"y")}catch{}},2);setTimeout(()=>clearInterval(t),1200)`], {detached:true, stdio:"ignore"}).unref();',
      'process.stdout.write("did the work\\n");'
    ].join("");
    const result = await runProcess(
      { id: "x", command: process.execPath, args: ["-e", leaveAWriter] },
      { workspace, family: "FAM-1", stage: "stage-1", prompt: "go", promptFile: join(workspace, "p.txt"), session: "s", timeoutMs: 30000 }
    );
    // The property under test: cleanup reports what it could not remove instead of throwing from
    // a `finally` and replacing the run's own result. The run has a result, and it is the agent's.
    // The writer above is a race -- the sweep may kill it before the walk -- so the assertions on
    // the reported shape live in the deterministic case below, which makes its own HOME
    // unremovable.
    assert.equal(result.exit_code, 0, "the run did not survive its own cleanup");
    assert.match(result.stdout_excerpt, /did the work/u);
    assert.equal(Array.isArray(result.scratch_not_removed), true);
    // By class and by digest of the path, never by the path: #556 publishes this record whole.
    for (const entry of result.scratch_not_removed) {
      assert.deepEqual(Object.keys(entry).sort(), ["class", "code", "path_digest"]);
      assert.match(entry.path_digest, /^sha256:[0-9a-f]{64}$/u);
    }
    // And the writer itself: a descendant still running after the agent exited is a leak, which
    // #556's survivor sweep finds even when it took its own session between two polls. It is
    // reported rather than swallowed, and the run is not issued on it.
    if (result.leaked_descendants) assert.equal(result.ok, false, "a leaked descendant left the run ok");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

// #459
test("what cleanup could not remove is reported by class and digest, never by path", async () => {
  // Deterministic, where the sibling above is a race: the agent makes a directory inside its own
  // HOME unwritable, so removing the file in it is refused and the walk raises. #556 publishes this
  // list in the run result and in the confinement record, and both are absolute paths on the
  // operator's machine -- their home directory, the run's own id -- so both carry a class, a digest
  // of the path and the errno instead.
  const workspace = temporary("aos-cleanup-refused-");
  try {
    const lockItsOwnHome = [
      'const { mkdirSync, writeFileSync, chmodSync } = require("node:fs");',
      'const { join } = require("node:path");',
      'const dir = join(process.env.HOME, "sealed");',
      'mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "x"), "y"); chmodSync(dir, 0o500);',
      'process.stdout.write("sealed\\n");'
    ].join("");
    const result = await runProcess(
      { id: "x", command: process.execPath, args: ["-e", lockItsOwnHome] },
      { workspace, family: "FAM-1", stage: "stage-1", prompt: "go", promptFile: join(workspace, "p.txt"), session: "cleanup-refused-run", timeoutMs: 30000 }
    );
    assert.equal(result.exit_code, 0);
    assert.ok(result.scratch_not_removed.length > 0, "the sealed directory was removed after all");
    const published = JSON.stringify(result);
    assert.equal(/\/(Users|home)\//u.test(published.replace(/"stdout_excerpt":"[^"]*"/u, "")), false, "an absolute home path reached the result");
    for (const entry of result.scratch_not_removed) {
      assert.deepEqual(Object.keys(entry).sort(), ["class", "code", "path_digest"]);
      assert.match(entry.path_digest, /^sha256:[0-9a-f]{64}$/u);
      assert.match(entry.class, /agent-home|run-scratch|confinement-scratch|other/u);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("an agent that fails two families identically stops the run", () => {
  // A Claude Code route exited 1 after a second with `Not logged in · Please run /login`, four
  // times, and the report blamed the operator for producing no contract.
  const cwd = temporary("aos-identical-");
  try {
    run(cwd, ["init"]);
    run(cwd, ["agent", "add", "notloggedin", "--command", process.execPath, "--arg", "-e",
      "--arg", 'process.stdout.write("Not logged in \\u00b7 Please run /login\\n"); process.exit(1);']);
    const plan = makePlan(cwd, { default: "notloggedin" });
    const refused = run(cwd, ["assess", "--plan", plan, "--seed", "3"], 2);
    assert.match(refused.stderr, /AOS_AGENT_FAILS_IDENTICALLY notloggedin/);
    assert.match(refused.stderr, /Not logged in/, "what the agent said is not shown");
    assert.match(refused.stderr, /did not read either/);
    assert.equal(/Score:/.test(refused.stdout), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a failure signature is what the invocation failed as", () => {
  const base = { exit_code: 1, stdout_digest: "a", stderr_digest: "b" };
  assert.equal(failureSignature(base), failureSignature({ ...base }));
  assert.notEqual(failureSignature(base), failureSignature({ ...base, exit_code: 2 }));
  assert.notEqual(failureSignature(base), failureSignature({ ...base, stdout_digest: "c" }));
});

// #467
test("key material is found in what the operator typed, not only in what came back", () => {
  const key = "AKIA3XQ7ZP4WLM9RTKD2";
  const typed = session([{ kind: "call", tool: "Bash", input: { command: `export AWS_ACCESS_KEY_ID=${key} && aws s3 ls` } }]);
  assert.ok(rules(typed).includes("secret-material-in-session"), "a key typed into a command was missed");

  const written = session([{ kind: "call", tool: "Write", input: { file_path: "/repo/.env", content: "GITHUB_TOKEN=ghp_7Kq2ZmR9pXvB4nTcW8yJdL3sHf6QaE" } }]);
  assert.ok(rules(written).includes("secret-material-in-session"), "a key written to .env was missed");

  // The value is still never repeated back.
  assert.match(typed.findings.find((f) => f.rule === "secret-material-in-session").evidence, /value withheld/);
  assert.equal(JSON.stringify(typed).includes(key), false);
});

// #468
test("a shell wrapper does not make a destructive command into data", () => {
  for (const command of [
    "bash -c 'git push --force origin main'",
    'sh -c "git reset --hard 9a8b7c6"',
    "zsh -lc 'git push --force origin dev'",
    "ssh deploy@host 'git reset --hard 9a8b7c6'",
    'ssh -p 22 host "git push --force origin main"',
    "xargs -I{} sh -c 'git push --force origin {}'",
    "docker exec c sh -c 'git push --force origin main'"
  ]) {
    assert.ok(rules(session([{ kind: "call", tool: "Bash", input: { command } }])).includes("destructive-command-executed"), command);
  }

  // And the false positives that heuristic was added to remove stay removed.
  for (const command of [
    'echo "git push --force origin main"',
    "printf 'git reset --hard'",
    "cat > rules.md <<'EOF'\ngit reset --hard\nEOF",
    "# bash -c 'git push --force' is destructive\nls",
    "git push --force-with-lease origin feat",
    "git checkout -q dev\ngit fetch -q origin dev\ngit reset --hard -q origin/dev",
    "ssh host 'ls -la'"
  ]) {
    assert.equal(rules(session([{ kind: "call", tool: "Bash", input: { command } }])).includes("destructive-command-executed"), false, command);
  }
});

// #469
test("a worktree under a project's .claude is source, not agent memory", () => {
  const worktree = session([{ kind: "call", tool: "Edit", input: { file_path: "/Users/someone/other/v3_fe/.claude/worktrees/feat-x/src/app.ts" } }], "/Users/someone/proj");
  assert.ok(rules(worktree).includes("edits-outside-the-working-directory"), "a source edit in another repository was excused");

  // The agent's own state under the operator's home stays exempt.
  const memory = session([{ kind: "call", tool: "Edit", input: { file_path: join(process.env.HOME ?? "/home/x", ".claude", "todos", "a.json") } }], "/Users/someone/proj");
  assert.equal(rules(memory).includes("edits-outside-the-working-directory"), false);
});

// #470
test("this tool's own assessment workspaces are not the operator's sessions", () => {
  // A suite family is designed to end without verification and to write where it should not. Read
  // as operator sessions they become operator findings describing behaviour AOS prescribed.
  const run083 = "run-83eae048-1111-2222-3333-444444444444";
  assert.equal(isAosWorkspaceTranscript(`/h/.claude/projects/-Users-i--aos-runs-${run083}-workspaces-FAM-6/x.jsonl`), true);
  assert.equal(isAosWorkspaceTranscript(`/h/.aos/runs/${run083}/workspaces/FAM-2/y.jsonl`), true);
  assert.equal(isAosWorkspaceTranscript("/h/.claude/projects/-Users-i-projects-myapp/x.jsonl"), false);
  assert.equal(isAosWorkspaceTranscript("/h/.codex/sessions/2026/08/28/rollout-x.jsonl"), false);
});

// #471
test("a harness-injected row is not an operator turn", () => {
  // Taken from what the runtimes on this machine actually emit: `task-notification` is much the
  // most common of them and was being counted as the operator taking a turn.
  for (const text of [
    "<system-reminder>be careful</system-reminder>",
    "<task-notification>a background task finished</task-notification>",
    "<user_info>OS Version: macos</user_info>",
    "<fork-boilerplate>x</fork-boilerplate>",
    "<local-command-stdout>ok</local-command-stdout>",
    "<local-command-caveat>x</local-command-caveat>\n<system-reminder>y</system-reminder>"
  ]) assert.equal(isHarnessBlock(text), true, text);

  // `user_query` is not one of them. It is what the operator typed, wrapped, and treating it as
  // harness would leave a Grok session with no operator turns at all.
  assert.equal(isHarnessBlock("<user_query>fix the parser</user_query>"), false);
  assert.equal(operatorText("<user_query>fix the parser</user_query>"), "fix the parser");
  assert.equal(operatorText("fix the parser"), "fix the parser");

  // An operator quoting one while asking about it is still taking a turn.
  for (const text of [
    "fix the parser",
    "the <system-reminder> block says to be careful — why?",
    "<system-reminder>x</system-reminder> and also please fix the build"
  ]) assert.equal(isHarnessBlock(text), false, text);
});

// #461, #462
test("the picker reaches what the aggregate names, and an empty roster is not a pass", () => {
  const cwd = temporary("aos-roster-");
  try {
    // `init` registers whatever runtimes it finds on PATH now, so an empty roster has to be built
    // rather than assumed. The guard is unchanged: reporting on nothing is not reporting success.
    initBare(cwd);
    const empty = run(cwd, ["agent", "doctor"], 3);
    assert.match(empty.stdout, /no agents registered/);
    assert.match(empty.stdout, /aos agent add/);

    // A real binary, because `addAgent` registers the repository's own fake-agent fixture and an
    // agent that runs a fixture now fails doctor on purpose -- a score from it describes the
    // fixture. That guard is covered in tests/product/fixture-backed-agent.test.mjs.
    run(cwd, ["agent", "add", "solo", "--command", "/bin/echo", "--arg", "hi"]);
    const listed = run(cwd, ["agent", "doctor"]);
    assert.match(listed.stdout, /PASS\tsolo/);
    // PASS here has been read as "this agent works". It means the binary resolves, and -- since
    // #459 -- that the declared credential path holds up. Neither runs the agent, so the footer
    // still refuses the stronger reading; what it disclaims narrowed from "can authenticate" to
    // "a live login" because the declared half is now actually checked.
    assert.match(listed.stdout, /not a live login/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// #463
test("a store left beside the project is named, not silently ignored", () => {
  const cwd = temporary("aos-orphan-");
  try {
    const legacy = join(cwd, ".aos");
    run(cwd, ["init"]);
    writeFileSync(join(legacy, "agents.json"), JSON.stringify({ agents: { claude: {}, codex: {} } }));
    const elsewhere = join(cwd, "home");
    const listed = spawnSync(process.execPath, [cli, "agent", "list"], {
      cwd, encoding: "utf8", timeout: 60000, env: { ...process.env, AOS_HOME: elsewhere }
    });
    assert.match(listed.stderr, /kept the store beside the project/);
    assert.match(listed.stderr, new RegExp(elsewhere.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
