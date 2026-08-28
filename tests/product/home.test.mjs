import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { cli } from "./helpers.mjs";
import {
  commitTerminal,
  createRun,
  initHome,
  readConfig,
  recoverRun,
  regenerateReports,
  resolveHome,
  runPaths,
  withRunLock,
  writeResult
} from "../../lib/store.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-home-"));

test("--data-dir beats AOS_HOME beats ~/.aos", () => {
  // The explicit flag is what lets a test, or a second profile, run without touching the
  // operator's real history.
  assert.equal(resolveHome({ dataDir: "/explicit", env: { AOS_HOME: "/from-env" }, home: "/user" }), "/explicit");
  assert.equal(resolveHome({ env: { AOS_HOME: "/from-env" }, home: "/user" }), "/from-env");
  assert.equal(resolveHome({ env: {}, home: "/user" }), "/user/.aos");
  // An empty value is not a choice.
  assert.equal(resolveHome({ dataDir: "", env: { AOS_HOME: "" }, home: "/user" }), "/user/.aos");
});

test("the home is one place per machine, not one per project", () => {
  // Runs kept under <project>/.aos made a result belong to whichever directory the command started
  // in, and scattered the operator's history across every repository they had assessed.
  const home = scratch();
  try {
    const first = createRun(home, { mode: "TEST" });
    const second = createRun(home, { mode: "TEST" });
    assert.equal(runPaths(home, first.runId).root.startsWith(home), true);
    assert.equal(runPaths(home, second.runId).root.startsWith(home), true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a read never modifies the operator's working tree", () => {
  // initHome used to append `.aos/` to the project's .gitignore, and readConfig calls it, so
  // `aos review` rewrote a tracked file in whatever repository it ran from.
  const project = scratch();
  const home = scratch();
  try {
    writeFileSync(join(project, ".gitignore"), "node_modules/\n", "utf8");
    readConfig(home);
    assert.equal(readFileSync(join(project, ".gitignore"), "utf8"), "node_modules/\n");
    assert.equal(existsSync(join(project, ".aos")), false, "a directory was created in the project");
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("the home and its runs are private to the operator", () => {
  // The runs underneath carry transcripts of the operator's own sessions.
  const home = scratch();
  try {
    const paths = initHome(home);
    assert.equal(statSync(paths.runs).mode & 0o777, 0o700);
    const { runId } = createRun(home, { mode: "TEST" });
    assert.equal(statSync(runPaths(home, runId).manifest).mode & 0o777, 0o600);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("two writers cannot hold one run", () => {
  // Both would append events and both could commit a terminal, and the second one loses without
  // either being told.
  const home = scratch();
  try {
    const { runId } = createRun(home, { mode: "TEST" });
    withRunLock(home, runId, () => {
      assert.throws(
        () => withRunLock(home, runId, () => "inner"),
        /AOS_RUN_LOCKED/,
        "a second writer was allowed in"
      );
    });
    // Released on the way out, including when the body threw.
    assert.equal(withRunLock(home, runId, () => "after"), "after");
    assert.throws(() => withRunLock(home, runId, () => { throw new Error("boom"); }), /boom/);
    assert.equal(withRunLock(home, runId, () => "still usable"), "still usable");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a lock whose owner is gone is broken, not honoured", () => {
  // A crash would otherwise make the run permanently unwritable, and the operator's only repair
  // would be deleting a file nobody told them about.
  const home = scratch();
  try {
    const { runId } = createRun(home, { mode: "TEST" });
    // A pid that cannot be running: this process would have had to fork four billion times.
    writeFileSync(join(runPaths(home, runId).root, "run.lock"), "4000000000", "utf8");
    assert.equal(withRunLock(home, runId, () => "recovered"), "recovered");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("reports are regenerated when they disagree with the result", () => {
  // The reports are a projection of result.json, so the result is the authority and a report that
  // disagrees with it is stale rather than a second opinion.
  const home = scratch();
  try {
    const { runId } = createRun(home, { mode: "TEST" });
    const render = (result) => ({ markdown: `# ${result.status}\n`, html: `<p>${result.status}</p>` });
    const result = { status: "EXPERIMENTAL / PROVISIONAL" };
    writeResult(home, runId, result, "# stale\n", "<p>stale</p>");

    const first = regenerateReports(home, runId, render);
    assert.equal(first.regenerated, true);
    const paths = runPaths(home, runId);
    assert.equal(readFileSync(paths.reportMd, "utf8"), "# EXPERIMENTAL / PROVISIONAL\n");

    // Deterministic renderers: a second pass has nothing to do.
    assert.equal(regenerateReports(home, runId, render).regenerated, false);

    rmSync(paths.reportHtml);
    assert.equal(regenerateReports(home, runId, render).regenerated, true, "a missing report was not rebuilt");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a run that was never scored has nothing to regenerate", () => {
  // This is the aborted path: recover runs on a run that has a manifest and no result, and
  // rendering a report from nothing would throw where the operator is trying to recover.
  const home = scratch();
  try {
    const { runId } = createRun(home, { mode: "TEST" });
    const render = (result) => ({ markdown: `# ${result.status}\n`, html: "" });
    let outcome;
    assert.doesNotThrow(() => { outcome = regenerateReports(home, runId, render); });
    assert.equal(outcome.regenerated, false);

    const recovered = recoverRun(home, runId, render);
    assert.equal(recovered.action, "ABORTED");
    assert.equal(recovered.reports.regenerated, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a report that cannot be drawn does not defeat the recovery", () => {
  // Recover exists to get a run back to a committed state. Losing that because one projection
  // threw would leave the operator with a run they cannot finish and no way to see why.
  const home = scratch();
  try {
    const { runId } = createRun(home, { mode: "TEST" });
    writeResult(home, runId, { status: "SCORED" }, "# stale\n", "<p>stale</p>");
    const recovered = recoverRun(home, runId, () => { throw new Error("renderer blew up"); });
    assert.equal(recovered.action, "COMMIT_TERMINAL_ONCE");
    assert.equal(recovered.reports.regenerated, false);
    assert.match(recovered.reports.reason, /render failed: renderer blew up/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the command stores where it was told and nowhere else", () => {
  const project = scratch();
  const home = scratch();
  try {
    const env = { ...process.env, AOS_HOME: join(home, "from-env") };
    spawnSync(process.execPath, [cli, "init"], { cwd: project, encoding: "utf8", env });
    assert.equal(existsSync(join(home, "from-env", "runs")), true);
    assert.equal(existsSync(join(project, ".aos")), false, "the project directory was written to");

    const explicit = join(home, "explicit");
    spawnSync(process.execPath, [cli, "init", "--data-dir", explicit], { cwd: project, encoding: "utf8", env });
    assert.equal(existsSync(join(explicit, "runs")), true, "--data-dir did not win over AOS_HOME");
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
