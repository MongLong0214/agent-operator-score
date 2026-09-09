import assert from "node:assert/strict";
import test from "node:test";
import fs, { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";

import { writeJson } from "../../lib/core.mjs";
import { exposureLedgerTestHooks } from "../../lib/cli.mjs";
import { classifyAdministration, markRevealed, openExposureLedger, recordExposure, reserveExposure } from "../../lib/form-class.mjs";
import { commitTerminal, exposureLedgerPath, pendingExposurePath, readEvents, readExposureLedgerFile, recoverExposureFinalizations, runPaths, withExposureLedgerLock } from "../../lib/store.mjs";
import { addAgent, assessAtATerminal, initBare, makePlan, newestRunId, run } from "./helpers.mjs";
import { finalizeExposure, signExposureFinalization } from "../../lib/exposure-finalization.mjs";
import { createHandler, mintToken } from "../../lib/dashboard.mjs";

const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const fixture = () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-finalization-"));
  initBare(cwd);
  addAgent(cwd, "solo");
  return { cwd, home: join(cwd, ".aos"), plan: makePlan(cwd, { default: "solo" }) };
};
const clean = (cwd) => {
  exposureLedgerTestHooks.afterReserve = null;
  exposureLedgerTestHooks.afterReveal = null;
  rmSync(cwd, { recursive: true, force: true });
};

const interruptedCompletion = async ({ cwd, home, plan }) => {
  const lock = join(home, "exposure-ledger.lock");
  exposureLedgerTestHooks.afterReveal = () => writeJson(lock, { pid: process.pid });
  const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
  assert.equal(assessed.status, 3, assessed.stderr);
  assert.match(assessed.stderr, /AOS_EXPOSURE_FINALIZATION_PENDING/u);
  exposureLedgerTestHooks.afterReveal = null;
  rmSync(lock);
  const id = newestRunId(cwd);
  assert.equal(existsSync(pendingExposurePath(home, id)), true);
  assert.equal(existsSync(runPaths(home, id).terminal), false);
  return id;
};

test("foreign-host exposure contention preserves the scored completion and names an executable recovery", async () => {
  const f = fixture();
  try {
    const lock = join(f.home, "exposure-ledger.lock");
    const owner = { schema_id: "aos-resource-lock.v1", pid: 4000000000, host: "another-host", boot_instant: 1, nonce: "foreign" };
    exposureLedgerTestHooks.afterReveal = () => writeJson(lock, owner);
    const assessed = await assessAtATerminal(f.cwd, ["assess", "--plan", f.plan, "--seed", "5"]);
    const id = newestRunId(f.cwd);
    assert.equal(assessed.status, 3, assessed.stderr);
    assert.match(assessed.stderr, /AOS_EXPOSURE_LOCK_UNAVAILABLE/u);
    assert.ok(assessed.stderr.includes(pendingExposurePath(f.home, id)), assessed.stderr);
    assert.match(assessed.stderr, /scored completion saved/u);
    const pending = readFileSync(pendingExposurePath(f.home, id), "utf8");
    for (const command of [["assess"], ["cycle", "status"], ["verify"], ["dashboard"]]) {
      const blocked = run(f.cwd, command, 2);
      assert.match(blocked.stderr, /aos doctor --exposure/u);
      assert.equal(readFileSync(pendingExposurePath(f.home, id), "utf8"), pending);
    }
    const diagnosis = run(f.cwd, ["doctor", "--exposure"], 3);
    assert.match(diagnosis.stdout, /another-host/u);
    assert.match(diagnosis.stdout, /--repair-exposure-lock --writers-stopped/u);
    run(f.cwd, ["doctor", "--repair-exposure-lock"], 2);
    assert.deepEqual(json(lock), owner, "inspection and missing acknowledgement must retain the lock");
    const repaired = run(f.cwd, ["doctor", "--repair-exposure-lock", "--writers-stopped"], 0);
    assert.match(repaired.stdout, /preserved/u);
    assert.equal(existsSync(lock), false);
    assert.equal(existsSync(pendingExposurePath(f.home, id)), false);
    assert.equal(json(runPaths(f.home, id).terminal).status, "INCOMPLETE");
    run(f.cwd, ["verify", "--run", id, "--json"], 0);
  } finally { clean(f.cwd); }
});

test("every exposure access failure carries the shared recovery entry even for an unnamed future fault", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-exposure-fault-"));
  try {
    for (const message of ["future publication fault", "AOS_EXPOSURE_LEDGER_CORRUPT synthetic", "ENOSPC synthetic"]) {
      assert.throws(() => withExposureLedgerLock(cwd, () => { throw new Error(message); }), (error) => {
        assert.ok(error.message.includes(message));
        assert.match(error.message, /aos doctor --exposure/u);
        assert.equal(error.recovery.command, "aos doctor --exposure");
        assert.equal(error.recovery.home, cwd);
        return true;
      });
    }
    writeFileSync(exposureLedgerPath(cwd), "{");
    assert.throws(() => readExposureLedgerFile(cwd), /AOS_MALFORMED_JSON.*aos doctor --exposure/u);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("cycle text and dashboard name the same counted seeds whose exposure was never verified", () => {
  const f = fixture();
  try {
    run(f.cwd, ["cycle", "start", "--seed", "11", "--seed", "12", "--seed", "13"]);
    const file = join(f.home, "cycle.json");
    const cycle = json(file);
    cycle.decision = {
      cycle_id: cycle.cycle_id, seeds: cycle.seeds, valid_runs: 2, complete: false, issued: false,
      excluded: [], valid_runs_exposure_unverified: [cycle.seeds[0], cycle.seeds[1]]
    };
    writeJson(file, cycle);
    const text = run(f.cwd, ["cycle", "status"], 1).stdout;
    const token = mintToken();
    let status;
    let html;
    createHandler({ home: f.home, token })({ method: "GET", url: `/?t=${token}`, headers: { host: "localhost" } }, {
      writeHead: (code) => { status = code; }, end: (body) => { html = body; }
    });
    assert.equal(status, 200);
    for (const seed of cycle.decision.valid_runs_exposure_unverified) {
      assert.ok(text.includes(`counted, exposure unverified: ${seed}`), text);
      assert.ok(html.includes(`counted, exposure unverified: ${seed}`), html);
    }
    assert.equal(html.includes(`counted, exposure unverified: ${cycle.seeds[2]}`), false);
  } finally { clean(f.cwd); }
});

test("assess publication names its own quarantined completion instead of reading missing artifacts", async (t) => {
  const f = fixture();
  const original = fs.linkSync;
  try {
    let conflicted = false;
    t.mock.method(fs, "linkSync", (source, target, ...rest) => {
      if (target === join(f.home, "exposure-ledger.lock")) {
        const name = readdirSync(f.home).find((name) => /^exposure-pending-.+\.json$/u.test(name));
        if (name && !conflicted) {
          conflicted = true;
          const id = name.slice("exposure-pending-".length, -".json".length);
          commitTerminal(f.home, id, { status: "CANCELLED", reason: "concurrent cancellation" });
        }
      }
      return original(source, target, ...rest);
    });
    syncBuiltinESMExports();
    const assessed = await assessAtATerminal(f.cwd, ["assess", "--plan", f.plan, "--seed", "5"]);
    assert.equal(conflicted, true, "the conflict must occur after the pending write");
    assert.equal(assessed.status, 2, assessed.stderr);
    assert.match(assessed.stderr, /AOS_EXPOSURE_FINALIZATION_UNPUBLISHED/u);
    assert.match(assessed.stderr, /\.unreplayable/u);
    assert.doesNotMatch(assessed.stderr, /AOS_UNREADABLE|ENOENT/u);
    const id = newestRunId(f.cwd);
    assert.equal(existsSync(`${pendingExposurePath(f.home, id)}.unreplayable`), true);
    assert.equal(json(runPaths(f.home, id).terminal).status, "CANCELLED");
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); clean(f.cwd); }
});

test("acknowledged exposure repair still refuses a live owner and preserves every artifact", () => {
  const f = fixture();
  try {
    const lock = join(f.home, "exposure-ledger.lock");
    writeJson(lock, { pid: process.pid, host: "another-host" });
    const before = readFileSync(lock, "utf8");
    const repaired = run(f.cwd, ["doctor", "--repair-exposure-lock", "--writers-stopped"], 2);
    assert.match(repaired.stderr, /AOS_EXPOSURE_LEDGER_LOCKED.*live pid/u);
    assert.equal(readFileSync(lock, "utf8"), before);
  } finally { clean(f.cwd); }
});

const assertHomeUsable = async ({ cwd, home, plan }, damagedId) => {
  run(cwd, ["session", "recover", damagedId], 0);
  const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "6"]);
  assert.equal(assessed.status, 3, assessed.stderr);
  const healthyId = newestRunId(cwd);
  assert.notEqual(healthyId, damagedId);
  assert.equal(json(runPaths(home, healthyId).terminal).status, "INCOMPLETE");
  const verified = jsonOutput(run(cwd, ["verify", "--run", healthyId, "--json"], 0));
  assert.equal(verified.state, "verified");
  run(cwd, ["cycle", "start", "--seed", "11", "--seed", "12", "--seed", "13"], 0);
  const summary = jsonOutput(run(cwd, ["cycle", "status", "--json"], 1));
  assert.equal(summary.valid_runs, 0);
  assert.equal(summary.issued, false);
  // Exercise the dashboard's real home renderer through its exported request boundary. Socket
  // binding has its own dashboard tests; no undocumented --once flag exists in the command.
  const token = mintToken();
  let status;
  let body;
  createHandler({ home, token })({ method: "GET", url: `/?t=${token}`, headers: { host: "localhost" } }, {
    writeHead: (code) => { status = code; }, end: (text) => { body = text; }
  });
  assert.equal(status, 200);
  assert.match(body, /<!doctype html>/iu);
};
const jsonOutput = (answer) => JSON.parse(answer.stdout);

test("cycle run resumes its graded administration after finalize contention without administering the seed again", async () => {
  const context = fixture();
  const { cwd, home, plan } = context;
  const lock = join(home, "exposure-ledger.lock");
  try {
    run(cwd, ["cycle", "start", "--seed", "5", "--seed", "6", "--seed", "7"], 0);
    exposureLedgerTestHooks.afterReveal = () => writeJson(lock, { pid: process.pid });
    const first = await assessAtATerminal(cwd, ["cycle", "run", "--plan", plan]);
    assert.equal(first.status, 2, first.stderr);
    const id = newestRunId(cwd);
    assert.equal(existsSync(pendingExposurePath(home, id)), true);
    assert.equal(json(join(home, "cycle.json")).runs.length, 0);
    exposureLedgerTestHooks.afterReveal = null;
    rmSync(lock);
    const resumed = await assessAtATerminal(cwd, ["cycle", "run", "--plan", plan]);
    assert.equal(resumed.status, 3, resumed.stderr);
    const cycle = json(join(home, "cycle.json"));
    assert.deepEqual(cycle.runs.map((row) => row.run_id), [id]);
    assert.equal(cycle.runs[0].exposure_verification, "VERIFIED");
    assert.equal(cycle.runs[0].failure, null);
    assert.equal(cycle.runs[0].terminal_committed, true);
    assert.deepEqual(readdirSync(join(home, "runs")), [id]);
    const entry = openExposureLedger(readExposureLedgerFile(home)).entries[0];
    assert.equal(entry.scored, true);
    assert.equal(entry.administered_class, "OPERATIONAL");
    assert.equal(entry.finalization.practice_reason, null);
    const next = await assessAtATerminal(cwd, ["cycle", "run", "--plan", plan]);
    assert.equal(next.status, 3, next.stderr);
    assert.match(next.stdout, /seed 0000000000000006/u);
    assert.equal(json(join(home, "cycle.json")).runs[0].run_id, id);
  } finally { clean(cwd); }
});

test("cycle run reads artifacts after a successful post-assessment replay", async (t) => {
  const { cwd, home, plan } = fixture();
  const lock = join(home, "exposure-ledger.lock");
  const original = fs.readdirSync;
  let released = false;
  try {
    run(cwd, ["cycle", "start", "--seed", "5", "--seed", "6", "--seed", "7"], 0);
    exposureLedgerTestHooks.afterReveal = () => writeJson(lock, { pid: process.pid });
    t.mock.method(fs, "readdirSync", (path, ...args) => {
      if (path === join(home, "runs") && existsSync(lock)
          && original(home).some((name) => /^exposure-pending-.*\.json$/u.test(name))) {
        rmSync(lock);
        released = true;
      }
      return original(path, ...args);
    });
    syncBuiltinESMExports();
    const answer = await assessAtATerminal(cwd, ["cycle", "run", "--plan", plan]);
    assert.equal(released, true);
    assert.equal(answer.status, 3, answer.stderr);
    const id = newestRunId(cwd);
    const [recorded] = json(join(home, "cycle.json")).runs;
    assert.equal(recorded.run_id, id);
    assert.equal(recorded.exposure_verification, "VERIFIED");
    assert.equal(recorded.failure, null);
    assert.equal(recorded.terminal_committed, true);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    clean(cwd);
  }
});

test("publication failure retains the completion and names a recovery that succeeds after repair", async () => {
  const context = fixture();
  const { cwd, home } = context;
  try {
    const id = await interruptedCompletion(context);
    const pending = pendingExposurePath(home, id);
    const paths = runPaths(home, id);
    mkdirSync(paths.reportHtml);
    for (const args of [["verify", "--run", id], ["session", "recover", id]]) {
      const failed = await assessAtATerminal(cwd, args);
      assert.equal(failed.status, 2, failed.stderr);
      assert.match(failed.stderr, /EISDIR|ENOTDIR/u);
      assert.ok(failed.stderr.includes(pending), failed.stderr);
      assert.ok(failed.stderr.includes(`aos session recover ${id}`), failed.stderr);
      assert.equal(existsSync(pending), true);
      assert.equal(existsSync(paths.terminal), false);
    }
    const revision = json(exposureLedgerPath(home)).revision;
    rmSync(paths.reportHtml, { recursive: true });
    const recovered = await assessAtATerminal(cwd, ["session", "recover", id]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(existsSync(pending), false);
    assert.equal(json(exposureLedgerPath(home)).revision, revision);
    assert.equal(json(paths.terminal).status, "INCOMPLETE");
    assert.equal(readEvents(home, id).filter((row) => row.event_type === "assessment.ended").length, 1);
    for (const path of [paths.result, paths.reportMd, paths.reportHtml, paths.card]) assert.ok(readFileSync(path).length > 0);
  } finally { clean(cwd); }
});

test("cycle bookkeeping resumes the original receipt after publication failure and a later administration", async (t) => {
  const { cwd, home, plan } = fixture();
  try {
    run(cwd, ["cycle", "start", "--seed", "5", "--seed", "6", "--seed", "7"], 0);
    const original = fs.renameSync;
    let interrupted = false;
    t.mock.method(fs, "renameSync", (from, to) => {
      if (to === join(home, "cycle.json")) {
        interrupted = true;
        throw new Error("AOS_TEST_CYCLE_WRITE");
      }
      return original(from, to);
    });
    syncBuiltinESMExports();
    const failed = await assessAtATerminal(cwd, ["cycle", "run", "--plan", plan]);
    assert.equal(interrupted, true);
    assert.equal(failed.status, 2, failed.stderr);
    assert.match(failed.stderr, /AOS_TEST_CYCLE_WRITE/u);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    const id = newestRunId(cwd);
    assert.equal(existsSync(pendingExposurePath(home, id)), false);
    assert.equal(json(join(home, "cycle.json")).runs.length, 0);
    const artifacts = ["result", "terminal", "record"].map((key) => readFileSync(runPaths(home, id)[key], "utf8"));
    const sibling = await assessAtATerminal(cwd, ["assess", "--seed", "5", "--plan", plan]);
    assert.equal(sibling.status, 3, sibling.stderr);
    assert.equal(json(runPaths(home, newestRunId(cwd)).terminal).status, "PRACTICE");
    const resumed = await assessAtATerminal(cwd, ["cycle", "run", "--plan", plan]);
    assert.equal(resumed.status, 3, resumed.stderr);
    const cycle = json(join(home, "cycle.json"));
    assert.deepEqual(cycle.runs.map((row) => row.run_id), [id]);
    assert.equal(cycle.runs[0].exposure_verification, "VERIFIED");
    assert.equal(cycle.runs[0].failure, null);
    assert.equal(cycle.runs[0].form_classification.official_scoring_permitted, true);
    assert.equal(readdirSync(join(home, "runs")).length, 2);
    assert.deepEqual(["result", "terminal", "record"].map((key) => readFileSync(runPaths(home, id)[key], "utf8")), artifacts);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    clean(cwd);
  }
});

test("every replay read and publication failure carries its pending path and recover command", async (t) => {
  const context = fixture();
  const { cwd, home } = context;
  const snapshot = join(cwd, "pending-snapshot");
  try {
    const id = await interruptedCompletion(context);
    const paths = runPaths(home, id);
    const pending = pendingExposurePath(home, id);
    const event = join(paths.events, "aos.ndjson");
    cpSync(home, snapshot, { recursive: true });
    const faults = [
      ["readFileSync", exposureLedgerPath(home)], ["readFileSync", pending],
      ["readFileSync", event],
      ...[exposureLedgerPath(home), paths.record, paths.result, paths.reportMd,
        paths.reportHtml, paths.card, event, paths.terminal].map((path) => ["renameSync", path]),
      ["rmSync", pending]
    ];
    for (const [operation, target] of faults) {
      rmSync(home, { recursive: true });
      cpSync(snapshot, home, { recursive: true });
      const original = fs[operation];
      let reached = false;
      t.mock.method(fs, operation, (...args) => {
        if (args[operation === "renameSync" ? 1 : 0] === target) {
          reached = true;
          throw Object.assign(new Error(`replay fault at ${operation} ${target}`), { code: "EIO" });
        }
        return original(...args);
      });
      syncBuiltinESMExports();
      assert.throws(() => readExposureLedgerFile(home), (error) => {
        assert.match(error.message, /EIO|replay fault/u);
        assert.ok(error.message.includes(pending), error.message);
        assert.ok(error.message.includes(`aos session recover ${id}`), error.message);
        return true;
      });
      assert.equal(reached, true, `${operation} ${target}`);
      t.mock.restoreAll();
      syncBuiltinESMExports();
      assert.equal(readFileSync(pending, "utf8"), readFileSync(join(snapshot, `exposure-pending-${id}.json`), "utf8"));
      const recovered = await assessAtATerminal(cwd, ["session", "recover", id]);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(existsSync(pending), false);
      assert.equal(json(paths.terminal).status, "INCOMPLETE");
      assert.equal(readEvents(home, id).filter((row) => row.event_type === "assessment.ended").length, 1);
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    clean(cwd);
  }
});

test("replay discovery quarantine and ledger parse errors cannot escape recovery context", async (t) => {
  const context = fixture();
  const { cwd, home } = context;
  try {
    const id = await interruptedCompletion(context);
    const pending = pendingExposurePath(home, id);
    const ledger = readFileSync(exposureLedgerPath(home), "utf8");
    writeFileSync(exposureLedgerPath(home), "not JSON");
    assert.throws(() => readExposureLedgerFile(home), (error) => {
      assert.match(error.message, /AOS_MALFORMED_JSON/u);
      assert.ok(error.message.includes(pending), error.message);
      assert.ok(error.message.includes(`aos session recover ${id}`), error.message);
      return true;
    });
    assert.equal(existsSync(pending), true);
    writeFileSync(exposureLedgerPath(home), ledger);
    const invalid = join(home, "exposure-pending-bad id.json");
    writeFileSync(invalid, "not JSON");
    const original = fs.renameSync;
    t.mock.method(fs, "renameSync", (from, to) => {
      if (from === invalid) throw Object.assign(new Error("quarantine I/O"), { code: "EACCES" });
      return original(from, to);
    });
    syncBuiltinESMExports();
    assert.throws(() => readExposureLedgerFile(home), (error) => {
      assert.match(error.message, /AOS_EXPOSURE_PENDING_QUARANTINE_FAILED/u);
      assert.ok(error.message.includes(invalid), error.message);
      assert.match(error.message, /aos session recover/u);
      return true;
    });
    t.mock.restoreAll();
    syncBuiltinESMExports();
    const reports = [];
    recoverExposureFinalizations(home, { report: (message) => reports.push(message) });
    assert.equal(existsSync(invalid), false);
    assert.equal(readFileSync(`${invalid}.unreplayable`, "utf8"), "not JSON");
    assert.equal(reports.length, 1);
    assert.match(reports[0], /AOS_INVALID_ID run id/u);
    assert.ok(reports[0].includes(`${invalid}.unreplayable`));
    // Discovery is shared by automatic and explicit recovery, before a run id can be read.
    const readDirectory = fs.readdirSync;
    t.mock.method(fs, "readdirSync", (path, ...args) => {
      if (path === home) throw Object.assign(new Error("discovery I/O"), { code: "EACCES" });
      return readDirectory(path, ...args);
    });
    syncBuiltinESMExports();
    assert.throws(() => readExposureLedgerFile(home), (error) => {
      assert.match(error.message, /discovery I\/O/u);
      assert.ok(error.message.includes(join(home, "exposure-pending-*.json")), error.message);
      assert.match(error.message, /aos session recover <id>/u);
      return true;
    });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    clean(cwd);
  }
});

test("a terminal conflict arising during publication is quarantined by the same replay boundary", async (t) => {
  const context = fixture();
  const { cwd, home } = context;
  try {
    const id = await interruptedCompletion(context);
    const paths = runPaths(home, id);
    const pending = pendingExposurePath(home, id);
    const original = fs.renameSync;
    let published = false;
    const terminal = { run_id: id, status: "CANCELLED", result_digest: null, committed_at: "2026-09-08T00:00:00.000Z" };
    t.mock.method(fs, "renameSync", (from, to) => {
      original(from, to);
      if (to === join(paths.events, "aos.ndjson")) {
        published = true;
        writeJson(paths.terminal, terminal);
      }
    });
    syncBuiltinESMExports();
    const reports = [];
    assert.doesNotThrow(() => recoverExposureFinalizations(home, { report: (message) => reports.push(message) }));
    assert.equal(published, true, "the conflict must arise after the pre-publication terminal check");
    assert.equal(existsSync(pending), false);
    assert.equal(existsSync(`${pending}.unreplayable`), true);
    assert.deepEqual(json(paths.terminal), terminal);
    assert.equal(reports.length, 1);
    assert.match(reports[0], /AOS_TERMINAL_ALREADY_COMMITTED/u);
    assert.ok(reports[0].includes(`${pending}.unreplayable`));
    assert.equal(json(exposureLedgerPath(home)).entries[0].state, "TERMINAL");
    assert.doesNotThrow(() => readExposureLedgerFile(home));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    clean(cwd);
  }
});

test("session cancel with a pending completion and a legacy cancelled terminal cannot wedge the home", async () => {
  const context = fixture();
  const { cwd, home } = context;
  try {
    const id = await interruptedCompletion(context);
    const pending = pendingExposurePath(home, id);
    const cancelled = await assessAtATerminal(cwd, ["session", "cancel", id]);
    assert.equal(cancelled.status, 2, cancelled.stderr);
    assert.match(cancelled.stderr, /AOS_EXPOSURE_FINALIZATION_PENDING/u);
    assert.ok(cancelled.stderr.includes(pending));
    assert.ok(cancelled.stderr.includes(`aos session recover ${id}`));
    assert.equal(existsSync(runPaths(home, id).terminal), false);
    assert.equal(readEvents(home, id).some((event) => event.event_type === "run.cancelled"), false);
    // The old documented cancel command committed this terminal. Recovery must also unstick
    // homes already left in that state, without overwriting the cancellation or publishing a result.
    const terminal = { run_id: id, status: "CANCELLED", result_digest: null, committed_at: "2026-09-08T00:00:00.000Z" };
    commitTerminal(home, id, terminal);
    const ledgerBefore = readFileSync(exposureLedgerPath(home), "utf8");
    const recovered = await assessAtATerminal(cwd, ["session", "recover", id]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stderr, /AOS_EXPOSURE_PENDING_UNREPLAYABLE/u);
    assert.ok(recovered.stderr.includes(`${pending}.unreplayable`));
    assert.match(recovered.stderr, /inspect.*remove/iu);
    assert.equal(existsSync(pending), false);
    assert.equal(existsSync(`${pending}.unreplayable`), true);
    assert.equal(readFileSync(exposureLedgerPath(home), "utf8"), ledgerBefore);
    assert.deepEqual(json(runPaths(home, id).terminal), terminal);
    assert.equal(existsSync(runPaths(home, id).result), false);
    await assertHomeUsable(context, id);
  } finally { clean(cwd); }
});

test("a pending completion with no reservation is quarantined by path and leaves exposure commands usable", async () => {
  const context = fixture();
  const { cwd, home } = context;
  try {
    const id = await interruptedCompletion(context);
    const pending = pendingExposurePath(home, id);
    const original = readFileSync(pending, "utf8");
    rmSync(exposureLedgerPath(home));
    const recovered = await assessAtATerminal(cwd, ["session", "recover", id]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stderr, /AOS_EXPOSURE_PENDING_IDENTITY/u);
    assert.ok(recovered.stderr.includes(`${pending}.unreplayable`));
    assert.match(recovered.stderr, /inspect.*remove/iu);
    assert.equal(existsSync(pending), false);
    assert.equal(readFileSync(`${pending}.unreplayable`, "utf8"), original);
    assert.equal(existsSync(exposureLedgerPath(home)), false);
    await assertHomeUsable(context, id);
  } finally { clean(cwd); }
});

test("a malformed pending completion is quarantined by path and leaves exposure commands usable", async () => {
  const context = fixture();
  const { cwd, home } = context;
  try {
    const id = await interruptedCompletion(context);
    const pending = pendingExposurePath(home, id);
    writeFileSync(pending, "not JSON");
    const ledgerBefore = readFileSync(exposureLedgerPath(home), "utf8");
    const recovered = await assessAtATerminal(cwd, ["session", "recover", id]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stderr, /AOS_MALFORMED_JSON/u);
    assert.ok(recovered.stderr.includes(`${pending}.unreplayable`));
    assert.match(recovered.stderr, /inspect.*remove/iu);
    assert.equal(existsSync(pending), false);
    assert.equal(readFileSync(`${pending}.unreplayable`, "utf8"), "not JSON");
    assert.equal(readFileSync(exposureLedgerPath(home), "utf8"), ledgerBefore);
    await assertHomeUsable(context, id);
  } finally { clean(cwd); }
});

test("a graded administration survives a held finalize lock and replays on the next ledger open", async () => {
  const { cwd, home, plan } = fixture();
  const lock = join(home, "exposure-ledger.lock");
  try {
    exposureLedgerTestHooks.afterReveal = () => writeJson(lock, { pid: process.pid });
    const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    const before = openExposureLedger(json(exposureLedgerPath(home)));
    assert.equal(before.entries[0].state, "REVEALED");
    assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), true, "the scored run must be durable before competing for the finalize lock");
    assert.equal(existsSync(runPaths(home, runId).terminal), false, "contention must not commit an INTERNAL_ERROR over the scored run");
    rmSync(lock);
    const recovered = openExposureLedger(readExposureLedgerFile(home));
    assert.equal(recovered.entries[0].state, "TERMINAL");
    assert.equal(recovered.revision, before.revision + 1);
    assert.equal(json(runPaths(home, runId).result).run.run_id, runId);
    assert.notEqual(json(runPaths(home, runId).terminal).status, "INTERNAL_ERROR");
    assert.deepEqual(openExposureLedger(readExposureLedgerFile(home)), recovered, "reopening must not consume another revision");
    assert.equal(readdirSync(home).filter((name) => /^exposure-pending-.*\.json$/u.test(name)).length, 0);
  } finally { clean(cwd); }
});

test("unrelated commands remain available with a pending completion and a faulted exposure ledger", async () => {
  const { cwd, home, plan } = fixture();
  const lock = join(home, "exposure-ledger.lock");
  const session = join(cwd, "review-session.jsonl");
  writeFileSync(session, `${JSON.stringify({ type: "summary", summary: "fixture session" })}\n`);
  try {
    exposureLedgerTestHooks.afterReveal = () => writeJson(lock, { pid: process.pid });
    const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    const pending = join(home, `exposure-pending-${runId}.json`);
    assert.equal(existsSync(pending), true);
    for (const fault of ["held", "corrupt"]) {
      if (fault === "corrupt") {
        rmSync(lock);
        writeFileSync(exposureLedgerPath(home), "not JSON");
      }
      for (const args of [["review", "--since", "1", "--session", session], ["doctor"], ["init"], ["agent", "list"], ["forms"]]) {
        const answer = await assessAtATerminal(cwd, args, { env: { PATH: cwd } });
        assert.equal(answer.status, 0, `${fault}: ${args.join(" ")}\n${answer.stderr}`);
      }
      const refused = await assessAtATerminal(cwd, ["assess", "--plan", plan]);
      assert.equal(refused.status, 2, refused.stderr);
      assert.match(refused.stderr, fault === "held" ? /AOS_EXPOSURE_LEDGER_LOCKED/u : /AOS_MALFORMED_JSON/u);
      assert.equal(existsSync(pending), true);
    }
  } finally { clean(cwd); }
});

test("an earlier result stays verified after the same form is administered again", async () => {
  const { cwd, home, plan } = fixture();
  try {
    const first = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(first.status, 3, first.stderr);
    const firstId = newestRunId(cwd);
    const paths = runPaths(home, firstId);
    const before = [paths.result, paths.record, paths.terminal].map((file) => readFileSync(file, "utf8"));
    assert.equal(openExposureLedger(readExposureLedgerFile(home)).entries[0].finalization.practice_reason, null);
    const verifyFirst = () => JSON.parse(run(cwd, ["verify", "--run", firstId, "--json"], 0).stdout);
    assert.equal(verifyFirst().state, "verified");
    const second = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(second.status, 3, second.stderr);
    assert.equal(json(runPaths(home, newestRunId(cwd)).terminal).status, "PRACTICE");
    assert.deepEqual([paths.result, paths.record, paths.terminal].map((file) => readFileSync(file, "utf8")), before);
    const verified = verifyFirst();
    assert.equal(verified.state, "verified");
    assert.equal(verified.checks.find((check) => check.check === "recompute").decision, true);
    const edited = json(paths.result);
    assert.equal(edited.aos_composite.issued, false);
    edited.aos_composite.issued = true;
    writeJson(paths.result, edited);
    const contradicted = JSON.parse(run(cwd, ["verify", "--run", firstId, "--json"], 5).stdout);
    assert.equal(contradicted.state, "contradicted");
    assert.equal(contradicted.checks.find((check) => check.check === "recompute").decision, false);
  } finally { clean(cwd); }
});

test("verification without a finalization receipt stays unresolved even with an intact result", async () => {
  const { cwd, home, plan } = fixture();
  try {
    const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    run(cwd, ["verify", "--run", runId], 0);
    const entry = openExposureLedger(readExposureLedgerFile(home)).entries[0];
    // A legitimate pre-receipt terminal made through the public transitions, with a valid chain.
    // Corrupting the chain instead would refuse before the missing-receipt guard was reached.
    const revealed = markRevealed(reserveExposure(undefined, entry).ledger, { administration_id: runId }).ledger;
    const withoutReceipt = recordExposure(revealed, { ...entry, finalization: null }).ledger;
    assert.equal(openExposureLedger(withoutReceipt).entries[0].finalization, undefined);
    writeJson(exposureLedgerPath(home), withoutReceipt);
    const report = JSON.parse(run(cwd, ["verify", "--run", runId, "--json"], 4).stdout);
    assert.equal(report.state, "unresolved");
    assert.equal(report.checks.find((check) => check.check === "exposure-ledger").decision, null);
    assert.equal(report.checks.find((check) => check.check === "recompute").decision, null);
  } finally { clean(cwd); }
});

test("editing both published and working withholding reasons cannot replace the ledger receipt", async () => {
  const { cwd, home, plan } = fixture();
  try {
    for (let i = 0; i < 2; i += 1) {
      const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
      assert.equal(assessed.status, 3, assessed.stderr);
    }
    const runId = newestRunId(cwd);
    const paths = runPaths(home, runId);
    run(cwd, ["verify", "--run", runId], 0);
    const record = json(paths.record);
    const result = json(paths.result);
    const invented = "AOS_FORM_NOT_OFFICIAL invented artifact reason";
    record.practice_withholding.reason = invented;
    for (const key of ["operator_process_profile", "system_outcome_profile", "aos_composite"]) result[key].withheld_reason = invented;
    writeJson(paths.record, record);
    writeJson(paths.result, result);
    const report = JSON.parse(run(cwd, ["verify", "--run", runId, "--json"], 5).stdout);
    assert.equal(report.state, "contradicted");
    assert.equal(report.checks.find((check) => check.check === "recompute").decision, false);
  } finally { clean(cwd); }
});

test("verify retains the finalization refusal when a sibling revealed after reservation", async () => {
  const { cwd, home, plan } = fixture();
  try {
    exposureLedgerTestHooks.afterReserve = () => {
      const ledger = openExposureLedger(json(exposureLedgerPath(home)));
      const entry = ledger.entries[0];
      assert.equal(entry.prior_exposure_count, 0);
      writeJson(exposureLedgerPath(home), reserveExposure(ledger, {
        ...entry, administration_id: "run-sibling", run_id: "run-sibling", occurred_at: new Date().toISOString()
      }).ledger);
    };
    exposureLedgerTestHooks.afterReveal = () => {
      const ledger = markRevealed(json(exposureLedgerPath(home)), { administration_id: "run-sibling" }).ledger;
      const sibling = ledger.entries.find((entry) => entry.administration_id === "run-sibling");
      writeJson(exposureLedgerPath(home), recordExposure(ledger, { ...sibling, occurred_at: new Date().toISOString() }).ledger);
    };
    const assessed = await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "5"]);
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    const ledger = openExposureLedger(readExposureLedgerFile(home));
    const entry = ledger.entries.find((row) => row.administration_id === runId);
    assert.equal(entry.prior_exposure_count, 0, "reservation-time inputs do not see the later reveal");
    assert.equal(classifyAdministration(ledger, entry).official_scoring_permitted, false);
    assert.equal(json(runPaths(home, runId).terminal).status, "PRACTICE");
    const report = JSON.parse(run(cwd, ["verify", "--run", runId, "--json"], 0).stdout);
    assert.equal(report.checks.find((check) => check.check === "recompute").decision, true);
  } finally { clean(cwd); }
});

const completion = () => {
  const keys = generateKeyPairSync("ed25519");
  const identity = {
    form_id: "form-fixture", form_contract_digest: `sha256:${"a".repeat(64)}`,
    declared_class: "OPERATIONAL", administration_id: "run-target", run_id: "run-target",
    occurred_at: "2026-09-08T00:00:00.000Z", cycle_id: "cycle-fixture",
    terminal_public_key: keys.publicKey.export({ type: "spki", format: "pem" })
  };
  const ledger = markRevealed(reserveExposure(undefined, identity).ledger, {
    administration_id: identity.administration_id, occurred_at: identity.occurred_at
  }).ledger;
  const payload = {
    schema_id: "aos-exposure-finalization.v1", administration_id: identity.administration_id,
    form_contract_digest: identity.form_contract_digest, occurred_at: "2026-09-08T00:01:00.000Z",
    safety: "S0", duration_ms: 60000, record: { run_id: identity.run_id },
    result: { run: { run_id: identity.run_id }, aos_composite: { issued: true, value: 73 } }
  };
  return { keys, identity, ledger, payload, pending: signExposureFinalization(payload, keys.privateKey) };
};

test("pending replay preserves the chain and changes only the exact administration", () => {
  const { identity, ledger, pending } = completion();
  const siblings = reserveExposure(ledger, { ...identity, administration_id: "run-sibling", run_id: "run-sibling" }).ledger;
  const completed = finalizeExposure(siblings, pending, identity.administration_id);
  assert.equal(openExposureLedger(completed.ledger).revision, siblings.revision + 1);
  assert.equal(completed.ledger.entries[0].state, "TERMINAL");
  assert.equal(completed.ledger.entries[0].score, 73);
  const { chain_digest: beforeChain, ...before } = siblings.entries[1];
  const { chain_digest: afterChain, ...after } = completed.ledger.entries[1];
  assert.notEqual(beforeChain, afterChain, "an earlier transition must rechain its following siblings");
  assert.deepEqual(after, before, "no sibling's state, identity or revision may change");
});

test("replaying a committed pending completion is byte-identical even after a sibling reveals", () => {
  const { identity, ledger, pending } = completion();
  const first = finalizeExposure(ledger, pending, identity.administration_id);
  const siblings = markRevealed(reserveExposure(first.ledger, { ...identity, administration_id: "run-sibling", run_id: "run-sibling" }).ledger,
    { administration_id: "run-sibling" }).ledger;
  const repeated = finalizeExposure(siblings, pending, identity.administration_id);
  assert.deepEqual(repeated.ledger, siblings);
  assert.deepEqual(repeated.result, first.result);
  assert.deepEqual(repeated.terminal, first.terminal);
  assert.deepEqual(repeated.record, first.record);
});

test("a pending artifact cannot replace the public key pinned in its reservation", () => {
  const { identity, ledger, payload, pending } = completion();
  assert.equal(finalizeExposure(ledger, pending, identity.administration_id).ledger.entries[0].state, "TERMINAL");
  const outsider = generateKeyPairSync("ed25519");
  const forged = signExposureFinalization(payload, outsider.privateKey);
  forged.public_key = outsider.publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => finalizeExposure(ledger, forged, identity.administration_id), /AOS_EXPOSURE_PENDING_SIGNATURE/);
});

test("an authenticated pending payload still cannot target a different administration", () => {
  const { identity, ledger, payload, keys } = completion();
  // Use the accepted producer key deliberately, so this witness cannot die at signature checking.
  const wrongId = signExposureFinalization({ ...payload, administration_id: "run-other" }, keys.privateKey);
  assert.throws(() => finalizeExposure(ledger, wrongId, identity.administration_id), /AOS_EXPOSURE_PENDING_IDENTITY/);
});

test("a different signed completion cannot replace an already committed terminal receipt", () => {
  const { identity, ledger, pending, payload, keys } = completion();
  const first = finalizeExposure(ledger, pending, identity.administration_id);
  const changed = signExposureFinalization({ ...payload, duration_ms: 90000 }, keys.privateKey);
  assert.throws(() => finalizeExposure(first.ledger, changed, identity.administration_id), /AOS_EXPOSURE_PENDING_CONFLICT/);
});

test("pending replay derives withholding from current ledger exposure instead of payload permission", () => {
  const { identity, ledger, payload, keys } = completion();
  const siblings = markRevealed(reserveExposure(ledger, { ...identity, administration_id: "run-sibling", run_id: "run-sibling" }).ledger,
    { administration_id: "run-sibling" }).ledger;
  const pending = signExposureFinalization({ ...payload, official_scoring_permitted: true }, keys.privateKey);
  const completed = finalizeExposure(siblings, pending, identity.administration_id);
  assert.equal(completed.terminal.status, "PRACTICE");
  assert.equal(completed.ledger.entries[0].scored, false);
  assert.equal(completed.result.aos_composite.issued, false);
  assert.match(completed.record.practice_withholding.reason, /AOS_FORM_EXPOSED_WITHOUT_TERMINAL/);
});

test("an unrecognised signed pending schema cannot be replayed", () => {
  const { identity, ledger, payload, keys } = completion();
  const pending = signExposureFinalization({ ...payload, schema_id: "future-completion" }, keys.privateKey);
  assert.throws(() => finalizeExposure(ledger, pending, identity.administration_id), /AOS_EXPOSURE_PENDING_SCHEMA/);
});

test("process death before during and after the pending write preserves exposure and recovers only committed completions", () => {
  for (const stage of ["before", "during", "pending", "ledger", "result", "event", "terminal"]) {
    const { cwd, home, plan } = fixture();
    try {
      const killed = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
        stage, "assess", "--plan", plan, "--seed", "5"], {
        cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
      });
      assert.equal(killed.signal, "SIGKILL", `${stage}: ${killed.stdout}\n${killed.stderr}`);
      const runId = newestRunId(cwd);
      const before = openExposureLedger(json(exposureLedgerPath(home)));
      const wasCommitted = !["before", "during"].includes(stage);
      assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), wasCommitted, stage);
      // A new process opens the home, not an in-memory object carrying the signing key.
      const reopened = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
        "recover", "verify", "--run", runId, "--json"], {
        cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
      });
      assert.equal(reopened.status, wasCommitted ? 0 : 2, `${stage}: ${reopened.stdout}\n${reopened.stderr}`);
      const after = openExposureLedger(json(exposureLedgerPath(home)));
      if (wasCommitted) {
        assert.equal(after.entries[0].state, "TERMINAL", stage);
        const result = json(runPaths(home, runId).result);
        assert.equal(result.run.run_id, runId);
        assert.equal(typeof result.aos_composite, "object");
        const terminal = json(runPaths(home, runId).terminal);
        assert.equal(terminal.status, "INCOMPLETE");
        assert.equal(readEvents(home, runId).filter((event) => event.event_type === "assessment.ended").length, 1);
        const bytes = readFileSync(exposureLedgerPath(home), "utf8");
        run(cwd, ["session", "recover", runId]);
        assert.equal(readFileSync(exposureLedgerPath(home), "utf8"), bytes, stage);
        assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), false);
      } else {
        assert.deepEqual(after, before, stage);
        assert.equal(after.entries[0].state, "REVEALED");
        assert.equal(existsSync(runPaths(home, runId).result), false);
        const refusal = classifyAdministration(after, { ...after.entries[0], administration_id: "run-next" });
        assert.equal(refusal.refusal_code, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL");
      }
    } finally { clean(cwd); }
  }
});

test("an error after the pending rename cannot overwrite the scored completion with an internal error", () => {
  const { cwd, home, plan } = fixture();
  try {
    const interrupted = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
      "write-error", "assess", "--plan", plan, "--seed", "5"], {
      cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
    });
    assert.match(interrupted.stderr, /injected pending directory fsync failure/);
    const runId = newestRunId(cwd);
    assert.equal(existsSync(join(home, `exposure-pending-${runId}.json`)), true);
    assert.equal(existsSync(runPaths(home, runId).result), false, "the error path must preserve the scored journal without publishing a diagnostic over it");
    assert.equal(existsSync(runPaths(home, runId).terminal), false);
    const recovered = openExposureLedger(readExposureLedgerFile(home));
    assert.equal(recovered.entries[0].state, "TERMINAL");
    assert.notEqual(json(runPaths(home, runId).terminal).status, "INTERNAL_ERROR");
  } finally { clean(cwd); }
});

test("the completion producer signs its measured working record without rereading a replaced file", () => {
  const { cwd, home, plan } = fixture();
  try {
    const assessed = spawnSync(process.execPath, [new URL("./exposure-finalization-crash-harness.mjs", import.meta.url).pathname,
      "record-change", "assess", "--plan", plan, "--seed", "5"], {
      cwd, env: { ...process.env, AOS_HOME: home }, encoding: "utf8", timeout: 120000
    });
    assert.equal(assessed.status, 3, assessed.stderr);
    const runId = newestRunId(cwd);
    assert.equal(json(runPaths(home, runId).record).run_id, runId);
    assert.equal(json(runPaths(home, runId).terminal).status, "INCOMPLETE");
  } finally { clean(cwd); }
});
