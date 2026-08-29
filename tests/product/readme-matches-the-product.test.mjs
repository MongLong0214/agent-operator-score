// The README is a claim about this program, and every row of it was checked against the program
// rather than against the previous README. These are the three the check found, kept as tests so the
// next edit to either side has to keep them true.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RUNTIMES } from "../../lib/session.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const READMES = ["README.md", "README.ko.md", "README.ja.md", "README.zh-CN.md"];

const aosIn = (cwd, home, args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", timeout: 120000, env: { ...process.env, AOS_HOME: home, HOME: home }
  });

// Asking a command what it does must never be the command. `assess --help` fell through to `assess`:
// it wrote a plan into the operator's working directory and started a run that spends model quota,
// which is the most expensive way this CLI could answer a question about itself.
test("--help after a subcommand prints usage and runs nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-help-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "aos-help-cwd-"));
  try {
    for (const command of [["assess"], ["review"], ["doctor"], ["cycle", "run"], ["agent", "list"]]) {
      for (const flag of ["--help", "-h"]) {
        const run = aosIn(cwd, home, [...command, flag]);
        assert.equal(run.status, 0, `${command.join(" ")} ${flag}`);
        assert.match(run.stdout, /^Agent Operator Score /, `${command.join(" ")} ${flag}`);
        assert.match(run.stdout, /Commands:/);
      }
    }
    // The point of the fix, not a side effect of it: nothing was created and no quota was spent.
    assert.deepEqual(readdirSync(cwd), [], "a request for help wrote a file into the working directory");

    // And a real flag is still a real flag -- the guard must not swallow arguments that are not help.
    assert.doesNotMatch(aosIn(cwd, home, ["review", "--list"]).stdout, /^Agent Operator Score /);
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

// The message listed two of the three roots `findSessions` walks, so an operator whose only
// transcripts were Grok's was told there was nothing to review -- by the command whose whole job is
// to find their transcripts.
test("the empty-session message names every runtime the finder actually walks", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-roots-"));
  try {
    const said = aosIn(home, home, ["review"]).stdout;
    for (const runtime of RUNTIMES) {
      const label = { "claude-code": "Claude Code", codex: "Codex", grok: "Grok" }[runtime] ?? runtime;
      assert.ok(said.includes(label), `${runtime} is walked but not named: ${said.trim()}`);
    }
    assert.equal(RUNTIMES.length, 3, "a runtime was added or removed; the message has to move with it");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Every README told the operator to run `cycle run --plan aos-plan.json` directly after `cycle
// start`, and nothing in that sequence creates the file. The plan is written only when no `--plan`
// is named, so following the documented steps on a fresh clone ended at ENOENT.
test("the cycle sequence every README documents runs on a fresh clone", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-cycle-doc-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "aos-cycle-doc-cwd-"));
  try {
    aosIn(cwd, home, ["agent", "add", "codex", "--command", "/bin/sh", "--arg", "-c", "--arg", "exit 0"]);
    assert.equal(aosIn(cwd, home, ["cycle", "start", "--runs", "3"]).status, 0);

    // A withheld score is a legitimate outcome and its own exit code, so what is asserted here is
    // that the sequence reaches the run at all rather than dying on a file no step created.
    const ran = aosIn(cwd, home, ["cycle", "run"]);
    const said = ran.stdout + ran.stderr;
    assert.doesNotMatch(said, /AOS_UNREADABLE|ENOENT/, said);
    assert.match(said, /metrics observed/, said);

    for (const file of READMES) {
      const text = readFileSync(join(root, file), "utf8");
      assert.doesNotMatch(
        text, /cycle run --plan aos-plan\.json/,
        `${file} documents a plan path that no documented step creates`
      );
    }
  } finally {
    for (const dir of [home, cwd]) rmSync(dir, { recursive: true, force: true });
  }
});

// A rule that fires and is not written down is a finding the operator cannot look up. The table is
// the list of what `review` reports, so it has to hold every rule that reaches a finding.
test("every rule review can report is in every README's table", () => {
  const source = readFileSync(join(root, "lib", "review.mjs"), "utf8");
  // Every rule the file names, minus the one that marks a check as unobserved rather than reporting
  // it. Matching on `severity:` being the next line missed a rule whose fields are ordered
  // differently -- a shape detail, which is the wrong thing for this check to depend on.
  const reported = new Set(
    source.split("\n")
      .filter((line) => !line.includes("not_observed"))
      .flatMap((line) => [...line.matchAll(/rule:\s*"([a-z-]+)"/g)].map((match) => match[1]))
  );
  assert.ok(reported.size >= 8, `expected the finding rules, found ${[...reported].join(", ")}`);

  for (const file of READMES) {
    const text = readFileSync(join(root, file), "utf8");
    for (const rule of reported) {
      assert.ok(text.includes(`\`${rule}\``), `${file} does not document ${rule}`);
    }
  }
});

// CI runs one Ubuntu image at two Node versions; every README read "22" and "24" as Ubuntu releases
// and printed "macOS 24", which is not a macOS version at all.
test("what the READMEs say about CI is what the workflow does", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  const images = new Set([...workflow.matchAll(/os:\s*([a-z-]+latest)/g)].map((match) => match[1]));
  assert.deepEqual([...images].sort(), ["macos-latest", "ubuntu-latest"]);

  for (const file of READMES) {
    const text = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(text, /Ubuntu 22|Ubuntu 24|macOS 24/, `${file} names Node versions as OS releases`);
  }
});
