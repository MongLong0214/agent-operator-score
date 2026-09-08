import assert from "node:assert/strict";
import test from "node:test";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { hostname as osHostname, tmpdir, uptime as osUptime } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { cli } from "./helpers.mjs";
import { MAX_EVENT_LINE_BYTES } from "../../lib/core.mjs";
import {
  appendEvent,
  commitTerminal,
  createRun,
  initHome,
  readConfig,
  recoverRun,
  regenerateReports,
  resolveHome,
  runPaths,
  withExposureLedgerLock,
  withRunLock,
  writeResult
} from "../../lib/store.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "aos-home-"));

test("a lock released before either observation is the same acquiring contention for both resources", (t) => {
  const home = scratch();
  try {
    const { runId, paths } = createRun(home, { mode: "TEST" });
    for (const [lock, acquire, code] of [
      [join(home, "exposure-ledger.lock"), (body) => withExposureLedgerLock(home, body), "AOS_EXPOSURE_LEDGER_LOCKED"],
      [join(paths.root, "run.lock"), (body) => withRunLock(home, runId, body), "AOS_RUN_LOCKED"]
    ]) {
      for (const observation of ["readFileSync", "statSync"]) {
        writeFileSync(lock, JSON.stringify({ pid: process.pid }));
        const original = fs[observation];
        let intercepted = false;
        t.mock.method(fs, observation, (path, ...args) => {
          if (path === lock && !intercepted) {
            intercepted = true;
            rmSync(lock);
          }
          return original(path, ...args);
        });
        syncBuiltinESMExports();
        assert.throws(() => acquire(() => assert.fail("contender entered the body")), (error) => {
          assert.ok(error.message.startsWith(code), error.message);
          assert.match(error.message, /acquiring/u);
          return true;
        });
        assert.equal(intercepted, true);
        t.mock.restoreAll();
        syncBuiltinESMExports();
        assert.equal(acquire(() => "acquired"), "acquired");
      }
    }
    const lock = join(home, "exposure-ledger.lock");
    symlinkSync(join(home, "absent"), lock);
    assert.throws(() => withExposureLedgerLock(home, () => assert.fail("entered")), /AOS_EXPOSURE_LEDGER_LOCKED.*acquiring/u);
    rmSync(lock);
    mkdirSync(lock);
    assert.throws(() => withExposureLedgerLock(home, () => assert.fail("entered")), /AOS_EXPOSURE_LOCK_UNAVAILABLE/u);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(home, { recursive: true, force: true });
  }
});

test("assessment ended repairs a torn tail and obeys the ordinary event writer limits", () => {
  const home = scratch();
  try {
    const { runId, paths } = createRun(home, { mode: "TEST" });
    const first = appendEvent(home, runId, "aos", { event_type: "assessment.started" });
    const file = join(paths.events, "aos.ndjson");
    const prefix = readFileSync(file, "utf8");
    writeFileSync(file, prefix + '{"torn":');
    const ended = appendEvent(home, runId, "aos", { event_type: "assessment.ended", payload: { status: "INCOMPLETE" } });
    const text = readFileSync(file, "utf8");
    assert.equal(text.endsWith("\n"), true);
    assert.deepEqual(text.trimEnd().split("\n").map((line) => JSON.parse(line)), [first, ended]);
    assert.equal(ended.producer_seq, first.producer_seq + 1);
    for (const event_type of ["assessment.started", "assessment.ended"]) {
      assert.throws(() => appendEvent(home, runId, "aos", { event_type, event_id: "x".repeat(MAX_EVENT_LINE_BYTES) }), /AOS_INVALID_EVENT_LINE/u);
      assert.equal(readFileSync(file, "utf8"), text);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

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

// Mirrors `lib/store.mjs`'s own boot identity so a test can write a lock this boot demonstrably
// owns. Kept here rather than exported from the module: a test that imports the value it is
// checking proves only that the module agrees with itself.
const thisBootLock = (pid) => ({
  schema_id: "aos-resource-lock.v1",
  pid,
  host: osHostname(),
  boot_instant: Date.now() / 1000 - osUptime(),
  nonce: "0".repeat(24),
  created_at: new Date().toISOString()
});

test("a lock whose owner is gone is broken, not honoured", () => {
  // A crash would otherwise make the run permanently unwritable, and the operator's only repair
  // would be deleting a file nobody told them about.
  //
  // The lock now records the boot it was taken under, because a dead pid on its own cannot tell a
  // crashed owner from a recycled pid (see the ambiguity test below). The property this test has
  // always been about is unchanged and still holds where it can be established: a lock written by
  // THIS boot whose pid is gone is broken and entered, so a crash never leaves a run permanently
  // unwritable. What changed is only the case this test never covered -- a lock nothing can
  // adjudicate is refused instead of guessed at.
  const home = scratch();
  try {
    const { runId } = createRun(home, { mode: "TEST" });
    // A pid that cannot be running -- this process would have had to fork four billion times --
    // recorded under this boot, so its staleness is a fact rather than an inference.
    writeFileSync(join(runPaths(home, runId).root, "run.lock"), JSON.stringify(thisBootLock(4000000000)), "utf8");
    assert.equal(withRunLock(home, runId, () => "recovered"), "recovered");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a lock file caught mid-acquisition is contended, not unreadable", () => {
  // Legacy writers can leave a fresh empty file while acquiring. This first attempt grants
  // their bounded grace; it cannot establish that an owner is alive. Recovery after the grace
  // and publication without an empty-file window are exercised separately below.
  const home = scratch();
  try {
    initHome(home);
    writeFileSync(join(home, "exposure-ledger.lock"), "", "utf8");
    assert.throws(
      () => withExposureLedgerLock(home, () => "entered"),
      /AOS_EXPOSURE_LEDGER_LOCKED/u,
      "0바이트 원장 락이 경합이 아니라 판정 불가로 처리됐다"
    );
    const { runId } = createRun(home, { mode: "TEST" });
    writeFileSync(join(runPaths(home, runId).root, "run.lock"), "", "utf8");
    assert.throws(
      () => withRunLock(home, runId, () => "entered"),
      /AOS_RUN_LOCKED/u,
      "0바이트 런 락을 치우고 들어갔다 -- 두 writer 가 된다"
    );
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("abandoned empty locks are recovered for both resources after the acquisition grace", () => {
  for (const resource of ["run", "exposure ledger"]) {
    const home = scratch();
    try {
      const { runId } = createRun(home, { mode: "TEST" });
      const lock = resource === "run" ? join(runPaths(home, runId).root, "run.lock") : join(home, "exposure-ledger.lock");
      const acquire = (body) => resource === "run" ? withRunLock(home, runId, body) : withExposureLedgerLock(home, body);
      writeFileSync(lock, "");
      let entered = 0;
      assert.throws(() => acquire(() => { entered += 1; }), /AOS_(?:RUN|EXPOSURE_LEDGER)_LOCKED/u);
      assert.equal(entered, 0);
      // Advance the file's age without a wall-clock sleep. This is the identical empty inode.
      const old = new Date(Date.now() - 60_000);
      utimesSync(lock, old, old);
      assert.equal(acquire(() => { entered += 1; return "recovered"; }), "recovered");
      assert.equal(entered, 1);
      assert.equal(existsSync(lock), false);
      assert.equal(acquire(() => "again"), "again");
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("both lock names appear only with an already durable owner record", () => {
  const home = scratch();
  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const durable = new Set();
      const opened = new Map();
      const original = { open: fs.openSync, fsync: fs.fsyncSync, link: fs.linkSync };
      const isLock = path => /(?:run|exposure-ledger)\\.lock$/.test(String(path));
      let published = 0;
      fs.openSync = (...args) => {
        const fd = original.open(...args);
        opened.set(fd, String(args[0]));
        if (isLock(args[0]) && args[1] === 'wx') {
          assert.ok(fs.fstatSync(fd).size > 0, 'published an empty lock before writing its owner');
        }
        return fd;
      };
      fs.fsyncSync = fd => {
        original.fsync(fd);
        if (/\\.lock\\.owner-/.test(opened.get(fd))) durable.add(fs.fstatSync(fd).ino);
      };
      fs.linkSync = (source, target) => {
        if (isLock(target)) {
          assert.ok(fs.statSync(source).size > 0, 'published an empty owner record');
          const owner = JSON.parse(fs.readFileSync(source, 'utf8'));
          assert.equal(owner.pid, process.pid);
          assert.ok(durable.has(fs.statSync(source).ino), 'owner record was published without fsync');
          published += 1;
        }
        return original.link(source, target);
      };
      syncBuiltinESMExports();
      const store = await import(${JSON.stringify(new URL("../../lib/store.mjs", import.meta.url).href)});
      const home = process.argv[1];
      const { runId } = store.createRun(home, { mode: 'TEST' });
      store.withRunLock(home, runId, () => {});
      store.withExposureLedgerLock(home, () => {});
      assert.ok(published >= 2, 'both resources must exercise publication');
    `, home], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the store never reads the clock at import time", async () => {
  // 샌드박스에서 `os.uptime()` 이 `uv_uptime returned EPERM` 을 던진다. 부트 식별자를 모듈 최상단
  // const 로 계산하던 동안에는 그 예외가 `lib/store.mjs` 의 import 자체를 실패시켰고, store 를 쓰는
  // 명령 전부가 함께 죽었다. AOS 는 에이전트를 confinement 아래 돌리는 게 본업이라 샌드박스 안에서
  // 도는 건 예외가 아니다.
  //
  // 처음 쓴 이 테스트는 자식 프로세스에서 `os.uptime` 을 갈아끼웠는데, `store.mjs` 가 명명 임포트를
  // 쓰기 때문에 그 바인딩은 링크 시점에 원본에 묶여 바뀌지 않았다. 즉 대상에 닿지 못한 채 통과했고,
  // 수정을 되돌려도 그대로 통과했다. 그래서 성질을 직접 잰다: 이 호출이 함수 밖에 있으면 안 된다.
  const { parse } = await import("acorn");
  const source = readFileSync(new URL("../../lib/store.mjs", import.meta.url), "utf8");
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module" });

  const offenders = [];
  const walk = (node, insideFunction) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) walk(child, insideFunction); return; }
    const isFunction = node.type === "FunctionDeclaration" || node.type === "FunctionExpression"
      || node.type === "ArrowFunctionExpression";
    if (!insideFunction && node.type === "CallExpression"
      && node.callee?.type === "Identifier" && node.callee.name === "uptime") {
      offenders.push(node.start);
    }
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end") continue;
      walk(node[key], insideFunction || isFunction);
    }
  };
  walk(tree, false);

  assert.deepEqual(offenders, [], `uptime() is called outside any function at offset(s) ${offenders.join(", ")}; a sandbox that refuses it would fail the import of this module and every command that stores anything`);
});

test("a run lock in the older bare-pid format is broken, not refused under the ledger's answer", () => {
  // Found by round 2. Failing closed on a lock this process cannot adjudicate is right for the
  // exposure ledger, where counting an administration twice is worse than refusing to count it at
  // all. It is wrong for a run's writer lock, which protects an append log: refusing forever makes
  // the run permanently unwritable, and the operator's only repair is deleting a file nobody told
  // them about -- the exact failure the comment on `withRunLock` has always named. The fail-closed
  // policy was applied to both locks and under the ledger's own error name, so a bare-pid lock
  // left by any pre-#585 build, or one written before a reboot, wedged that run.
  const home = scratch();
  try {
    const { runId } = createRun(home, { mode: "TEST" });
    // The pre-#585 shape: a bare pid, no host, no boot instant. Unadjudicable by construction.
    writeFileSync(join(runPaths(home, runId).root, "run.lock"), "4000000000", "utf8");
    assert.equal(withRunLock(home, runId, () => "recovered"), "recovered",
      "a run lock in the older format was refused instead of broken, leaving the run unwritable");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a stale lock written seconds earlier on this boot is still adjudicable", () => {
  // Measured defect, found by review of the fix above. Flooring the wall clock and the uptime
  // separately made the boot identity alternate between two adjacent seconds depending on their
  // fractional parts -- two distinct values inside three seconds of one process. A lock written
  // under one of them read as belonging to a different boot, so a genuinely same-boot stale lock
  // became unadjudicable and the ledger stayed wedged until somebody deleted the file by hand: a
  // fail-closed that fires on nothing, which is worse than the guess it replaced because it looks
  // like a safety property working.
  //
  // What matters is cross-process: the lock this process must adjudicate was written by ANOTHER
  // process, seconds earlier, whose own reading of the boot instant differs slightly from ours.
  // Equality rejected those; the record now carries the instant and is compared with a tolerance.
  const home = scratch();
  try {
    initHome(home);
    const lockPath = join(home, "exposure-ledger.lock");
    // A dead pid, this host, and a boot instant a couple of seconds off ours -- exactly the drift
    // two processes on one boot produce, and exactly what used to read as a different boot.
    writeFileSync(lockPath, JSON.stringify({
      schema_id: "aos-resource-lock.v1",
      pid: 4000000000,
      host: osHostname(),
      boot_instant: (Date.now() / 1000 - osUptime()) - 2,
      nonce: "0".repeat(24),
      created_at: new Date().toISOString()
    }), "utf8");
    assert.equal(withExposureLedgerLock(home, () => "recovered"), "recovered",
      "a stale lock from this boot, written a couple of seconds earlier, was refused as unadjudicable and wedged the ledger");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a lock whose recorded owner is gone is not reclaimed on pid liveness alone", () => {
  // #585 governance directive 15.4. Reclaiming a lock because `kill(pid, 0)` says nobody is there
  // is a guess: pids are reused, so a live unrelated process reads as the owner still holding, and
  // a dead pid reads as safe to break even when the owner died mid-transaction and left the ledger
  // half-written. The lock file has to say enough about its owner to tell "this is my own stale
  // lock" from "I cannot tell", and an ambiguous state is BLOCKED rather than reclaimed -- an
  // ambiguous stale lock silently reclaimed is one of the named stop conditions.
  const home = scratch();
  try {
    initHome(home);
    const lockPath = join(home, "exposure-ledger.lock");
    // A lock left by a pid that is almost certainly not alive, carrying nothing else about who
    // wrote it: the exact shape this process cannot distinguish from a live owner whose pid was
    // recycled. Refusing is the only honest answer.
    writeFileSync(lockPath, "999999", "utf8");
    assert.throws(
      () => withExposureLedgerLock(home, () => "reclaimed"),
      /AOS_EXPOSURE_LOCK_UNAVAILABLE|AOS_EXPOSURE_LEDGER_LOCKED/u,
      "a lock file carrying only a dead pid was broken and entered on that basis alone"
    );
    // The ledger must be untouched by the refusal.
    assert.equal(existsSync(lockPath), true, "the refusal deleted the lock it could not adjudicate");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("two writers cannot hold the exposure ledger lock", () => {
  // #585. `aos assess` reads, classifies and rewrites the whole exposure ledger file on every
  // administration; two processes racing that read-modify-write can each read the same prior
  // entries and each write back a ledger missing the other's administration. Mirrors
  // `withRunLock`'s own guard: one process at a time may hold the ledger's lock, and a lock whose
  // owner is gone is broken rather than honoured forever.
  const home = scratch();
  try {
    initHome(home);
    withExposureLedgerLock(home, () => {
      assert.throws(
        () => withExposureLedgerLock(home, () => "inner"),
        /AOS_EXPOSURE_LEDGER_LOCKED/,
        "a second writer was allowed to hold the exposure ledger at the same time"
      );
    });
    // Released on the way out, including when the body threw.
    assert.equal(withExposureLedgerLock(home, () => "after"), "after");
    assert.throws(() => withExposureLedgerLock(home, () => { throw new Error("boom"); }), /boom/);
    assert.equal(withExposureLedgerLock(home, () => "still usable"), "still usable");
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

test("a ledger lock from a previous boot is reclaimed, not refused forever", () => {
  // Found by review of this branch and reproduced before the fix. The unadjudicable branch refused
  // every lock it could not place on THIS boot, which put the two cases the wrong way round:
  //
  //   same boot, dead pid   -> reclaimed   (asserted by the test above) -- yet a pid can be reused
  //                                         within a boot, so "dead" here is a guess
  //   previous boot         -> refused     -- yet the writer provably cannot be alive, because the
  //                                         pid space was replaced when the boot instant changed
  //
  // The stated reason for refusing is that a genuinely dead owner may have died mid-transaction and
  // left the resource half-written. That cannot happen to this resource: every ledger write goes
  // through `atomicWrite` (`lib/core.mjs`), which writes a temp file, fsyncs it, renames it and
  // fsyncs the directory. There is no half-written ledger to protect.
  //
  // Measured before the fix: two consecutive attempts both ended in AOS_EXPOSURE_LOCK_UNAVAILABLE
  // and nothing cleared the file, so the home stayed wedged until an operator deleted a path no
  // message names. A fail-closed that fires where the danger cannot occur is not a safety property.
  const home = scratch();
  try {
    initHome(home);
    const lockPath = join(home, "exposure-ledger.lock");
    writeFileSync(lockPath, JSON.stringify({
      schema_id: "aos-resource-lock.v1",
      pid: 999999,
      host: osHostname(),
      // A whole boot earlier: the shape a SIGKILL leaves behind when the machine is then rebooted,
      // since withLock's finally never runs on SIGKILL.
      boot_instant: (Date.now() / 1000 - osUptime()) - 100000,
      nonce: "0".repeat(24),
      created_at: new Date().toISOString()
    }), "utf8");
    assert.equal(withExposureLedgerLock(home, () => "recovered"), "recovered",
      "a lock from a previous boot -- whose writer cannot be alive -- wedged the ledger permanently");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a ledger lock this process cannot place at all is still refused", () => {
  // The narrowing above must not become "reclaim anything that is not this boot". These three stay
  // closed because nothing about them says the writer is gone: another host may still be running
  // it, an unreadable record says nothing, and a record with no boot instant cannot be placed on
  // any boot. Only "provably an earlier boot on this host" is reclaimable.
  const cases = [
    ["another host", { host: "some-other-machine", boot_instant: (Date.now() / 1000 - osUptime()) - 100000 }],
    ["no boot instant", { host: osHostname() }],
    ["boot instant from the future", { host: osHostname(), boot_instant: (Date.now() / 1000 - osUptime()) + 100000 }]
  ];
  for (const [name, extra] of cases) {
    const home = scratch();
    try {
      initHome(home);
      writeFileSync(join(home, "exposure-ledger.lock"), JSON.stringify({
        schema_id: "aos-resource-lock.v1", pid: 999999, nonce: "0".repeat(24),
        created_at: new Date().toISOString(), ...extra
      }), "utf8");
      assert.throws(() => withExposureLedgerLock(home, () => "recovered"),
        /AOS_EXPOSURE_LOCK_UNAVAILABLE/,
        `an unadjudicable lock (${name}) was reclaimed; only a provably earlier boot on this host may be`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
});
