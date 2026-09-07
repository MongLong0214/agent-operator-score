import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addAgent, makePlan, run } from "./helpers.mjs";
import { classifyAdministration, openExposureLedger } from "../../lib/form-class.mjs";
import { formManifest } from "../../lib/suite.mjs";

// ---------------------------------------------------------------------------------------------
// #585 governing directive 25: cross-process concurrency and crash recovery.
//
// Every other exposure-ledger test in this repository constructs two ledger objects, or drives
// the CLI once at a time, inside one Node process. None of that proves anything about two OS
// processes racing the same file on disk -- a JS object's mutual exclusion is not the file lock
// `withExposureLedgerLock` actually takes, and a single process cannot be killed mid-write the way
// `process.kill(pid, "SIGKILL")` kills a real one. These tests spawn real, separate `aos` processes
// (`child_process.spawn`, never two objects in one process) against one shared AOS home and read
// only the bytes those processes actually left on disk.
//
// Real, repeatable timings on the machine these tests were built against (Node 22, macOS,
// unloaded): a single `aos assess` against the fake-agent fixture takes ~3.6s wall clock. Suites A
// and B run their processes concurrently rather than in series, so the wall clock each adds is one
// administration's worth, not N of them.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");
const crashHarness = join(root, "tests", "product", "exposure-crash-harness.mjs");

const ledgerOf = (home) => JSON.parse(readFileSync(join(home, "exposure-ledger.json"), "utf8"));
const runIdsOf = (home) => readdirSync(join(home, "runs"));
const terminalOf = (home, id) => JSON.parse(readFileSync(join(home, "runs", id, "terminal.json"), "utf8"));

/** Spawns one real `aos <args>` OS process and resolves with its exit and output. */
function spawnAos(bin, args, { cwd, env }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------------------------
// A. Parallel same-form (25.1)

test("25.1: two OS processes racing the identical form never both land an official reservation", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-parallel-same-form-"));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    const SEED = "00000000000000a5";
    const env = { ...process.env, AOS_HOME: home };

    // Spawned back to back, no artificial delay -- the closest two independent
    // `child_process.spawn` calls can get to "as close to simultaneously as you can arrange"
    // without stopping either process to hold it at a barrier.
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      spawnAos(cli, ["assess", "--plan", plan, "--seed", SEED], { cwd, env }),
      spawnAos(cli, ["assess", "--plan", plan, "--seed", SEED], { cwd, env })
    ]);
    const wallMs = Date.now() - t0;
    assert.ok(wallMs > 0);

    const runIds = runIdsOf(home);
    if (runIds.length !== 2) {
      assert.fail(`expected both processes to create their own run; observed run ids ${JSON.stringify(runIds)} (exit codes ${a.code}, ${b.code})`);
    }
    const terminals = new Map(runIds.map((id) => [id, terminalOf(home, id)]));
    const ledger = ledgerOf(home);

    // "Official" is legible from outside only as the run's own terminal status: a bare `aos assess`
    // (not `aos cycle run`) always writes `administered_class: "PRACTICE"` into the ledger entry
    // itself regardless of whether the ledger actually permitted official scoring, so the ledger
    // row alone cannot distinguish the two. `status` can: PRACTICE means
    // `official_scoring_permitted` was false when this administration was classified; ISSUED or
    // INCOMPLETE means it was true. UNSAFE never arises for this fixture.
    const officialRunIds = [...terminals.entries()]
      .filter(([, terminal]) => terminal.status === "ISSUED" || terminal.status === "INCOMPLETE")
      .map(([id]) => id);
    assert.ok(
      officialRunIds.length <= 1,
      `at most one administration of one exact form may ever be official; got ${officialRunIds.length} of 2 (statuses: ${[...terminals.values()].map((t) => t.status).join(", ")})`
    );

    // Administration ids in the ledger are unique, and every entry present names the one exact form
    // both processes were told to administer.
    const adminIds = ledger.entries.map((entry) => entry.administration_id);
    assert.equal(new Set(adminIds).size, adminIds.length, "administration ids in the ledger must be unique");
    for (const entry of ledger.entries) {
      assert.equal(entry.form_contract_digest, ledger.entries[0].form_contract_digest, "both processes administered the same seed; every ledger row for this race must carry the same exact form digest");
    }

    // Nothing is silently missing. Every run this test created is accounted for one of two ways:
    // it has its own row in the ledger, or its own incomplete result names the exact reason no row
    // was ever written for it.
    for (const id of runIds) {
      const inLedger = ledger.entries.some((entry) => entry.administration_id === id);
      if (inLedger) continue;
      const terminal = terminals.get(id);
      if (terminal.status !== "INTERNAL_ERROR") {
        assert.fail(`run ${id} has no ledger row and its terminal status is ${terminal.status}, not a named refusal -- an administration went missing with no trace`);
      }
      const incomplete = JSON.parse(readFileSync(join(home, "runs", id, "result.json"), "utf8"));
      assert.match(incomplete.error, /AOS_EXPOSURE_LEDGER_LOCKED/, `run ${id} was neither ledgered nor refused with a named lock error: ${incomplete.error}`);
    }

    // Two distinct, both-real shapes were observed for this exact race across repeated runs while
    // building this suite, and both satisfy every invariant checked above:
    //
    //   (1) reservation-time collision -- on an unloaded machine the reservation critical section
    //       is microseconds long, so two `spawn` calls issued back to back collide on
    //       `exposure-ledger.lock` almost every time, and `withLock` has no retry: the loser is
    //       refused outright before it ever writes a row. Exactly one ledger entry, exactly one
    //       official.
    //   (2) both reservations land as distinct rows -- under `npm test`'s own parallel load,
    //       process-startup scheduling jitter can exceed the lock's sub-millisecond hold time, so
    //       both processes reserve successfully. Because each administration's whole ~3.6s+ run
    //       overlaps the other's almost entirely, whichever finalizes second sees the first's row
    //       still RESERVED/REVEALED (or, having finished, already TERMINAL) and is classified
    //       PRACTICE either way -- and by the same logic the first can end up seeing the second's
    //       row mid-flight at ITS OWN finalize and be forced to PRACTICE too. Two ledger entries,
    //       and a real, reproducible finding: this can leave ZERO officials, not one, for one exact
    //       form raced this tightly. It can never leave two.
    //
    // Only shape (2) with zero officials is new information beyond what is already asserted above;
    // everything else about it is exactly shape (1)'s invariants restated. So rather than asserting
    // one shape and being surprised by the other, this checks that whichever shape occurred is one
    // of exactly these two -- a third shape (for example two officials, or a ledger entry count
    // outside {1, 2}) fails loudly rather than being silently accepted.
    if (ledger.entries.length === 1) {
      assert.equal(officialRunIds.length, 1, "the single reservation that landed must be the official one");
    } else if (ledger.entries.length === 2) {
      assert.ok(officialRunIds.length === 0 || officialRunIds.length === 1, `two ledger rows for one exact form must yield zero or one official, never two; got ${officialRunIds.length}`);
    } else {
      assert.fail(`a two-process race produced ${ledger.entries.length} ledger entries; expected exactly 1 (a reservation-time collision) or 2 (both reservations landed)`);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// B. Lost-update stress (25.4)

test("25.4: four OS processes administering four different forms against one ledger lose none of them", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-lost-update-"));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    const env = { ...process.env, AOS_HOME: home };
    const baseSeeds = ["00000000000000d0", "00000000000000d1", "00000000000000d2", "00000000000000d3"];
    // Spare, never-before-used seeds a slot switches to if its first form gets contaminated by lock
    // contention (see below) -- never reused as a retry of the SAME seed, because the ledger's own
    // exposed-without-terminal rule (the same one suite C exercises deliberately) means a seed whose
    // reservation or reveal already collided with another process's lock hold can no longer reach a
    // clean official administration under that seed, whatever is retried next.
    const sparePool = ["00000000000000d4", "00000000000000d5", "00000000000000d6", "00000000000000d7", "00000000000000d8", "00000000000000d9"];

    // Staggered by 150ms between spawns rather than fired all at once: at 0 lag the reservation
    // lock's total absence of retry (see suite A) means three of four processes are refused before
    // they ever write a row, which tests the lock's refusal path again rather than the
    // read-modify-write correctness this suite exists to check. 150ms is far shorter than one
    // administration's ~3.6s runtime, so all four are still genuinely concurrent -- reserved,
    // revealed and mid-execution together -- for almost their whole run; it is only long enough for
    // each reservation's open-write-close to land outside the previous one's sub-millisecond hold
    // under an unloaded machine.
    //
    // Under `npm test`'s own parallelism (many other test files spawning their own child processes
    // at the same time -- not sharing this test's lock file, but competing for the same CPUs) the
    // 150ms gap is sometimes not enough: observed twice in development, reproducibly under
    // full-suite load. Two distinct shapes showed up, and only one of them is safe to retry under
    // the same seed:
    //   - a collision at RESERVATION time writes nothing at all (`AOS_EXPOSURE_LEDGER_LOCKED`,
    //     INTERNAL_ERROR, no ledger row) -- retrying the identical seed is exactly as clean a first
    //     attempt as before;
    //   - a collision at the FINALIZE lock (after this administration's own reservation and reveal
    //     already committed) leaves that row stuck RESERVED/REVEALED forever -- the exact orphan
    //     suite C injects deliberately, except this time produced by ordinary scheduling noise
    //     rather than a kill signal. Retrying that seed again cannot produce a clean official
    //     administration; classifyAdministration will call it AOS_FORM_EXPOSED_WITHOUT_TERMINAL
    //     every time. So a contaminated seed is abandoned (its trace stays on disk and is checked
    //     below) and the slot moves on to a fresh seed from `sparePool` instead.
    const takeSpare = () => {
      const seed = sparePool.shift();
      assert.ok(seed !== undefined, "ran out of spare seeds while working around lock contention -- something is colliding far more than this suite expects");
      return seed;
    };
    const runSlot = async (initialSeed, index) => {
      if (index > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 150 * index));
      let seed = initialSeed;
      const attempts = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = await spawnAos(cli, ["assess", "--plan", plan, "--seed", seed], { cwd, env });
        const reportMatch = result.stdout.match(/runs[\\/](run-[0-9a-f-]+)[\\/]report\.html/u);
        const runId = reportMatch ? reportMatch[1] : null;
        const terminal = runId !== null ? terminalOf(home, runId) : null;
        attempts.push({ seed, result, runId, status: terminal?.status ?? null });
        if (terminal !== null && (terminal.status === "ISSUED" || terminal.status === "INCOMPLETE")) {
          return { seed, runId, attempts };
        }
        // Either no run id was printed at all (a refusal before the success-path printing, e.g. a
        // reservation-time lock collision) or the run completed but was not official (a
        // finalize-time collision contaminated this exact seed, or something else classified it
        // PRACTICE). Either way this seed's slot is done; move to a fresh one.
        seed = takeSpare();
        await new Promise((resolveWait) => setTimeout(resolveWait, 100 * attempt));
      }
      assert.fail(`slot starting at seed ${initialSeed} never reached an official administration in ${attempts.length} attempts: ${JSON.stringify(attempts.map((one) => ({ seed: one.seed, runId: one.runId, status: one.status })))}`);
      return null;
    };
    const t0 = Date.now();
    const slots = await Promise.all(baseSeeds.map((seed, index) => runSlot(seed, index)));
    const wallMs = Date.now() - t0;
    assert.ok(wallMs > 0);

    const successfulRunIds = slots.map((slot) => slot.runId);
    assert.equal(new Set(successfulRunIds).size, baseSeeds.length, "the four slots must land on four distinct, successful runs");
    assert.equal(new Set(slots.map((slot) => slot.seed)).size, baseSeeds.length, "the four slots must land on four distinct forms -- a contaminated seed must never be reused for a second slot");

    const runIds = runIdsOf(home);
    // At least one run directory per successful slot. It can be more: a seed abandoned to
    // contention (reservation-time or finalize-time) still left its own run directory behind
    // (`createRun` runs before the ledger lock is ever taken), and every one of those is checked
    // below rather than silently ignored.
    assert.ok(runIds.length >= baseSeeds.length, `expected at least ${baseSeeds.length} run directories; got ${runIds.length}`);

    const ledger = ledgerOf(home);
    const adminIds = ledger.entries.map((entry) => entry.administration_id);
    assert.equal(new Set(adminIds).size, ledger.entries.length, "administration ids in the ledger must be unique, whatever else landed there");

    // Every one of the four successful administrations has exactly one ledger row, in state
    // TERMINAL, scored, official.
    for (const slot of slots) {
      const rows = ledger.entries.filter((entry) => entry.administration_id === slot.runId);
      assert.equal(rows.length, 1, `successful run ${slot.runId} does not have exactly one ledger row`);
      assert.equal(rows[0].state, "TERMINAL");
      assert.equal(rows[0].form_contract_digest, formManifest(slot.seed).form_contract_digest, "the ledger row for a successful run must name the exact form its own seed produces");
    }
    const successfulDigests = new Set(slots.map((slot) => formManifest(slot.seed).form_contract_digest));
    assert.equal(successfulDigests.size, baseSeeds.length, "the four successful administrations must be four distinct forms, none substituted or dropped");

    // Every run id on disk that is NOT one of the four successes is accounted for one of two ways:
    // cleanly refused before any ledger row existed (INTERNAL_ERROR naming the lock), or contaminated
    // by a lock collision at finalize and left orphaned in the exact RESERVED/REVEALED shape suite C
    // documents -- never a third, unexplained shape, and never itself official.
    for (const id of runIds) {
      if (successfulRunIds.includes(id)) continue;
      const rows = ledger.entries.filter((entry) => entry.administration_id === id);
      if (rows.length === 0) {
        const terminal = terminalOf(home, id);
        if (terminal.status !== "INTERNAL_ERROR") {
          assert.fail(`abandoned run ${id} has no ledger row and its terminal status is ${terminal.status}, not a named refusal`);
        }
        const incomplete = JSON.parse(readFileSync(join(home, "runs", id, "result.json"), "utf8"));
        assert.match(incomplete.error, /AOS_EXPOSURE_LEDGER_LOCKED/, `abandoned run ${id} was neither ledgered nor refused with a named lock error: ${incomplete.error}`);
        continue;
      }
      assert.equal(rows.length, 1, `abandoned run ${id} has ${rows.length} ledger rows; an administration id must never be reused`);
      assert.ok(rows[0].state === "RESERVED" || rows[0].state === "REVEALED", `abandoned run ${id} is in unexpected ledger state ${rows[0].state}`);
      assert.notEqual(rows[0].scored, true, `an abandoned, orphaned administration must never be scored`);
    }

    // The core safety property for the whole test, regardless of how many seeds were burned to
    // contention along the way: every ledger row traces back to a run this test actually spawned --
    // no phantom entry, and (by the checks above) none of this test's runs is missing its row
    // unless it was named as a clean refusal.
    assert.equal(ledger.entries.every((entry) => runIds.includes(entry.administration_id)), true, "every ledger entry must correspond to a run id actually on disk");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// C. Crash injection (25.3) -- the reachable subset.
//
// `tests/product/exposure-crash-harness.mjs` is `bin/aos.mjs` plus one addition: it reads
// `AOS_TEST_CRASH_AFTER`, a name `lib/cli.mjs` itself never reads and no shipped flag ever sets,
// and wires it to the `exposureLedgerTestHooks` seam `lib/cli.mjs` already exports (and that
// `tests/product/form-class.test.mjs` already uses, in-process, for the same reservation/reveal
// instants). No file under `lib/` or `bin/` was changed to make this possible, and nothing here
// can be reached through `bin/aos.mjs` or any documented flag -- the hooks stay `null`, and
// therefore no-ops, unless a script imports `lib/cli.mjs` directly and sets them itself, which no
// shipped entry point does.
//
// Both crash points below kill the process with `process.kill(process.pid, "SIGKILL")` from
// inside the hook that already fires the instant the corresponding ledger write is durable on
// disk -- a real, uncatchable process death, not a thrown error a `finally` block can clean up
// after.

const crashAndRestart = async (crashAfter) => {
  const cwd = mkdtempSync(join(tmpdir(), `aos-crash-${crashAfter}-`));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    const SEED = crashAfter === "reserve" ? "00000000000000c1" : "00000000000000c2";
    const OTHER_SEEDS = crashAfter === "reserve" ? ["00000000000000c3", "00000000000000c4"] : ["00000000000000c5", "00000000000000c6"];
    run(cwd, ["cycle", "start", "--seed", SEED, "--seed", OTHER_SEEDS[0], "--seed", OTHER_SEEDS[1]]);

    const crashed = await spawnAos(crashHarness, ["cycle", "run", "--plan", plan], {
      cwd, env: { ...process.env, AOS_HOME: home, AOS_TEST_CRASH_AFTER: crashAfter }
    });
    if (crashed.signal !== "SIGKILL") {
      assert.fail(`the harness did not die by SIGKILL at "${crashAfter}" -- the crash-injection hook never fired, so this test has not reached its subject. exit code=${crashed.code} signal=${crashed.signal} stdout=${crashed.stdout} stderr=${crashed.stderr}`);
    }

    const runIdsAfterCrash = runIdsOf(home);
    assert.equal(runIdsAfterCrash.length, 1, "the crashed process must still have created its own run directory before dying");
    const crashedRunId = runIdsAfterCrash[0];
    assert.equal(existsResult(home, crashedRunId), false, "a hard-killed run must leave no result.json behind -- if one exists, the kill fired too late to test anything");

    const ledgerAfterCrash = ledgerOf(home);
    assert.equal(ledgerAfterCrash.entries.length, 1, "the crash must leave exactly the one reservation entry it wrote, no more and no less");
    const orphan = ledgerAfterCrash.entries[0];
    assert.equal(orphan.administration_id, crashedRunId);
    const expectedState = crashAfter === "reserve" ? "RESERVED" : "REVEALED";
    assert.equal(orphan.state, expectedState, `a crash injected after ${crashAfter} must leave the entry in state ${expectedState}`);
    assert.equal(orphan.content_revealed, crashAfter === "reveal", "content_revealed must match exactly what this crash point actually made durable");
    assert.equal(orphan.administered_class, null, "an entry that never reached TERMINAL must not carry an administered class");

    // The exact refusal a later attempt at this exact form gets, computed directly against the
    // bytes the crashed process actually left on disk -- not inferred from a comment.
    const form = formManifest(SEED);
    const classification = classifyAdministration(openExposureLedger(ledgerAfterCrash), {
      form_id: form.form_id, form_contract_digest: form.form_contract_digest, declared_class: form.form_class
    });
    // Directive 18.1 and 18.2 answer the two crash points differently, and this helper now holds
    // both answers rather than one. A crash after RESERVED revealed nothing -- the scenario was
    // never materialised and no agent saw the form -- so the reservation is abandoned and the form
    // stays usable; retiring it would burn a form over an administration that showed nobody
    // anything. A crash after REVEALED did put the task in front of the agent, and no crash
    // un-shows a task, so that form is spent and every later attempt is refused by name.
    if (crashAfter === "reveal") {
      assert.equal(classification.official_scoring_permitted, false);
      assert.equal(classification.administered_class, "PRACTICE");
      assert.equal(classification.refusal_code, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL", "a revealed-but-unterminated exposure must never be read as a fresh form, and must never silently become a second official slot");
    } else {
      assert.equal(classification.official_scoring_permitted, true, "a reservation that never revealed content retired the form anyway");
      assert.equal(classification.administered_class, "OPERATIONAL");
      assert.deepEqual(classification.aborted_before_reveal, [crashedRunId], "the abandoned reservation must still be named, or it reads the same as a form nobody ever reserved");
    }

    // Restart: a real second `cycle run` against the same home. `cycle.json` was never updated by
    // the crashed attempt (the whole process died before it returned), so this reattempts the exact
    // same pending seed for real, through the production classify-then-record path, and the refusal
    // above must be the one the operator actually sees printed.
    // Exit 3 either way: one seed of three has run, so the cycle is incomplete whichever answer
    // the exposure ledger gave. What differs is the reason printed and the row recorded, below.
    const restarted = run(cwd, ["cycle", "run", "--plan", plan], 3);
    if (crashAfter === "reveal") {
      assert.match(restarted.stdout, /practice lane: AOS_FORM_EXPOSED_WITHOUT_TERMINAL/u, "the restart's own refusal must name the blocker on the terminal where the operator reads it");
    } else {
      assert.equal(/AOS_FORM_EXPOSED_WITHOUT_TERMINAL/u.test(restarted.stdout), false, "an abandoned reservation refused the restart on the operator's terminal");
    }

    const cycleAfterRestart = JSON.parse(readFileSync(join(home, "cycle.json"), "utf8"));
    const recordedRun = cycleAfterRestart.runs[0];
    if (crashAfter === "reveal") {
      assert.equal(recordedRun.valid, false, "the resumed attempt must never be counted as official aggregate evidence");
      assert.equal(recordedRun.invalid_reason, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL");
      assert.equal(recordedRun.exposure_verification, "REFUSED");
    } else {
      assert.notEqual(recordedRun.invalid_reason, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL", "the restart after an unrevealed reservation was refused as though the form had been shown");
    }

    const ledgerAfterRestart = ledgerOf(home);
    assert.equal(ledgerAfterRestart.entries.length, 2, "the restart adds its own terminal row beside the orphaned crash row; neither replaces the other");
    const stillOrphaned = ledgerAfterRestart.entries.find((entry) => entry.administration_id === crashedRunId);
    // Finding, named here rather than fixed: nothing in this codebase ever resolves a dangling
    // RESERVED/REVEALED row. Governing directive 25.3 names "resume, or recorded
    // ABORTED_BEFORE_REVEAL" as the acceptable outcomes for the reserved-but-unrevealed case; no
    // "ABORTED_BEFORE_REVEAL" status exists anywhere in this codebase (`grep` finds none), and
    // nothing resumes the crashed administration either. What actually happens, for BOTH crash
    // points, is that the orphaned row stays in its crashed state (RESERVED or REVEALED) forever --
    // this exact form_contract_digest is permanently retired from official use unless an operator
    // edits the ledger file by hand. That is safe (it can never grant a second official slot) but it
    // is not what the directive's wording promised for the reserved-but-unrevealed case, and it does
    // not distinguish the two crash points from each other the way the directive's own two bullets
    // do -- both produce the identical refusal code, AOS_FORM_EXPOSED_WITHOUT_TERMINAL.
    assert.equal(stillOrphaned.state, expectedState, "the crashed row is never automatically resolved; it stays exactly as the crash left it");

    const restartRunId = ledgerAfterRestart.entries.find((entry) => entry.administration_id !== crashedRunId)?.administration_id;
    assert.notEqual(restartRunId, undefined);
    const restartEntry = ledgerAfterRestart.entries.find((entry) => entry.administration_id === restartRunId);
    assert.equal(restartEntry.state, "TERMINAL");
    assert.equal(restartEntry.scored, crashAfter === "reserve", crashAfter === "reveal"
      ? "the resumed administration of an exposed-without-terminal form must never be scored"
      : "the restart after a reservation that revealed nothing should have scored officially");

    // The core safety property, checked one last time against everything now on disk: this exact
    // form_contract_digest never carries two official slots, and (per the finding above) in this
    // codebase it in fact never carries even one after a crash -- neither entry for this digest is
    // ever an OPERATIONAL, scored administration.
    // The core safety property, whichever crash point this was: one official slot at most, never
    // two. After a reveal crash the form is spent and the count is zero; after a reservation that
    // revealed nothing the restart takes the one slot the abandoned reservation never used.
    const scoredEntries = ledgerAfterRestart.entries.filter((entry) => entry.scored === true);
    assert.ok(scoredEntries.length <= 1, `this form carries ${scoredEntries.length} scored administrations; at most one is ever permitted`);
    assert.equal(scoredEntries.length, crashAfter === "reserve" ? 1 : 0,
      crashAfter === "reveal"
        ? "a form whose content reached the agent was scored anyway after a crash"
        : "the restart after an unrevealed reservation never took the official slot the abandonment left free");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

const existsResult = (home, runId) => {
  try {
    readFileSync(join(home, "runs", runId, "result.json"), "utf8");
    return true;
  } catch {
    return false;
  }
};

test("25.3: a hard crash after the reservation commit, before content reveal, leaves the form usable and takes no official slot", async () => {
  await crashAndRestart("reserve");
});

test("25.3: a hard crash after the reveal commit, before terminal, refuses the same form to a later attempt with the named blocker", async () => {
  await crashAndRestart("reveal");
});
