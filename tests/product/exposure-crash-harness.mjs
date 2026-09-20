#!/usr/bin/env node
// #585 governing directive 25.3 -- a test-only process entry point, never imported by production
// code and never reachable through `bin/aos.mjs` or any documented `aos` flag or environment
// variable. It exists so a crash-injection test can kill a REAL OS process hard
// (`process.kill(process.pid, "SIGKILL")`) at an exact, durable exposure-ledger transition, which
// only an actual process death can honestly exercise -- an in-process callback or a thrown error
// leaves stack frames to unwind and `finally` blocks to run, and neither is what a crash is.
//
// This is `bin/aos.mjs` verbatim, plus one addition: it reads `AOS_TEST_CRASH_AFTER`, an env var
// `lib/cli.mjs` itself never reads and no shipped flag ever sets, and wires it to
// `exposureLedgerTestHooks` -- the seam `lib/cli.mjs` already exports for exactly this kind of
// observation (`tests/product/form-class.test.mjs` uses the same hooks in-process). The hooks are
// no-ops until something sets them; `bin/aos.mjs` never does, so a real invocation of the shipped
// binary never runs any of the code below. Nothing in `lib/` or `bin/` was changed to make this
// file possible.
import { exposureLedgerTestHooks, runCli } from "../../lib/cli.mjs";

const crashAfter = process.env.AOS_TEST_CRASH_AFTER;
const die = () => process.kill(process.pid, "SIGKILL");
if (crashAfter === "reserve") {
  exposureLedgerTestHooks.afterReserve = die;
} else if (crashAfter === "reveal") {
  exposureLedgerTestHooks.afterReveal = die;
} else if (crashAfter !== undefined) {
  throw new Error(`AOS_TEST_HARNESS_UNKNOWN_CRASH_POINT ${crashAfter}; expected "reserve" or "reveal"`);
}

try {
  const code = await runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr
  });
  process.exitCode = code;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`AOS_INTERNAL_ERROR ${message}\n`);
  process.exitCode = 70;
}
