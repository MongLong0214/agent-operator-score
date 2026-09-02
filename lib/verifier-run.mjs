import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { processGroupMembers } from "./core.mjs";

// Assessed code runs in a subprocess, never in this one.
//
// The grader used to `import()` the file the agent had just rewritten. That module body executes
// with AOS's own permissions: it can read ~/.ssh, spawn processes, reach the network, and write to
// the run directory the result is about. No amount of care in the grading logic afterwards matters,
// because the damage is done by the import itself.
//
// So the parent spawns an immutable verifier script, hands it the workspace, and reads back one
// line of JSON. The parent never loads anything the agent wrote.

export const VERIFIER_TIMEOUT_MS = 10_000;

// What the cleanup check can and cannot see, said out loud rather than left for a reader to infer.
//
// The scan enumerates the verifier's process group. A descendant that calls setsid -- which is what
// Node's own `spawn({ detached: true })` does -- takes its own session, reparents to pid 1, is
// absent from `processGroupMembers`, and survives `kill(-pgid, SIGKILL)`. Reproduced directly
// against the real function in tests/product/verifier-authority.test.mjs, and end to end: six
// detached processes outlived a FAM-5 run that reported `leaked_descendants: false`.
//
// So the scan's positive findings stand -- something it saw really is there -- but its silence is
// not evidence. A `survivors: false` on its own would be the check reporting that it looked in the
// one place the escape does not appear, and that reads as a clean exit to anyone downstream. It is
// reported as "not established" instead.
//
// Closing it needs descendant accounting the operating system keeps on our behalf -- a cgroup, a
// job object -- which is #556's surface, not this file's. macOS sandbox-exec cannot deny setsid by
// name or by syscall number, so OS-level confinement does not close this axis either. When a
// mechanism exists that a setsid descendant cannot leave, this constant is what flips.
export const DESCENDANT_SCAN = "process-group";
export const DESCENDANT_SCAN_ESTABLISHES_CLEANUP = false;
const MAX_CAPTURE_BYTES = 256 * 1024;

// Everything else is dropped. NODE_OPTIONS matters most: an inherited `--require ./evil.mjs` would
// run inside the verifier before the verifier's own first line, which defeats the isolation this
// module exists to provide.
const baseEnv = (home) => ({
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: home,
  TMPDIR: home,
  LANG: "C",
  // Node reads this and it is not sensitive; pinning it keeps output stable across machines.
  NODE_ENV: "production"
});

const signalGroup = (pgid, signal) => {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Runs a verifier script in an isolated subprocess and returns its structured verdict.
 *
 * The verdict is authenticated with a nonce passed through the environment, which the verifier
 * deletes before it touches anything the agent wrote. Assessed code executing inside the verifier
 * can print whatever it likes to stdout; it cannot print a line carrying a value it never saw.
 */
export async function runVerifier(script, args, { timeoutMs = VERIFIER_TIMEOUT_MS } = {}) {
  const home = mkdtempSync(join(tmpdir(), "aos-verifier-home-"));
  const nonce = randomUUID();
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  try {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: home,
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...baseEnv(home), AOS_VERIFIER_NONCE: nonce }
    });
    const pgid = child.pid;

    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      if (pgid) signalGroup(pgid, "SIGTERM");
      setTimeout(() => {
        if (pgid) signalGroup(pgid, "SIGKILL");
      }, 1000).unref();
    }, timeoutMs);
    timer.unref();

    const outcome = await new Promise((done) => {
      child.once("error", (error) => done({ code: null, signal: null, error }));
      child.once("exit", (code, signal) => done({ code, signal, error: null }));
    });
    clearTimeout(timer);

    // Assessed code can spawn. What is left behind is enumerated *before* the cleanup kills it --
    // measuring after SIGKILL only ever reports what the kill failed to reach, which is nothing, so
    // the earlier version of this check could not be false and could not be tested.
    await sleep(50);
    const leaked = pgid ? processGroupMembers(pgid).filter((pid) => pid !== pgid) : [];
    if (pgid && processGroupMembers(pgid).length > 0) {
      signalGroup(pgid, "SIGTERM");
      await sleep(100);
    }
    if (pgid && processGroupMembers(pgid).length > 0) {
      signalGroup(pgid, "SIGKILL");
      await sleep(100);
    }
    const survivors = pgid ? processGroupMembers(pgid).length > 0 : false;

    return {
      // A verification that left processes behind did not finish cleanly, whatever its exit code
      // said, so it is not a pass. This matches how runProcess already reads an agent run.
      ok: !timedOut && outcome.error === null && outcome.code === 0 && leaked.length === 0 && !survivors,
      exit_code: outcome.code,
      signal: outcome.signal,
      timed_out: timedOut,
      survivors,
      leaked_descendants: leaked.length > 0,
      descendant_pids: leaked,
      // Which scan produced the two flags above, and whether that scan is capable of establishing
      // the absence it appears to report. Both are false-by-construction today; they exist so that
      // "nothing was found" is never stored as "nothing was there".
      descendant_scan: DESCENDANT_SCAN,
      cleanup_established: DESCENDANT_SCAN_ESTABLISHES_CLEANUP && leaked.length === 0 && !survivors,
      duration_ms: Date.now() - started,
      verdict: readVerdict(stdout, nonce),
      stderr_sample: stderr.slice(0, 2048),
      error: outcome.error instanceof Error ? outcome.error.message : null
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Extracts the one line the verifier authenticated.
 *
 * Returns null when there is none, and a null verdict is a verifier failure — never a pass. Code
 * that exits early, loops until the timeout, or crashes produces no line, and all three have to
 * read the same way: nothing was verified.
 */
export function readVerdict(stdout, nonce) {
  const marker = `AOS_VERDICT ${nonce} `;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith(marker)) continue;
    try {
      const parsed = JSON.parse(line.slice(marker.length));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}
