// The FAM-5 trusted verifier controller. It never loads anything the agent wrote.
//
// This file used to be the whole verifier: it imported the assessed module and then, in the same
// process and after that import, computed `Object.values(subchecks).every(Boolean)`, tested thrown
// values with `error instanceof RangeError`, serialised the result and handed it to
// process.stdout.write together with the nonce that authenticates it. Deleting the nonce from the
// environment before the import protected the environment and nothing else. Every one of those
// later steps ran on machinery the module had already been given a turn to replace, and three
// separate forgeries followed from that:
//
//   Array.prototype.every = () => true            four failing probes reported as a pass
//   globalThis.RangeError = class extends Error   a module throwing its own class satisfied the
//                                                 divide-by-zero and wrong-type probes
//   process.stdout.write = interceptor            the real verdict line arrived at the interceptor
//                                                 with the nonce in it, and was replaced
//
// The last one is the one that matters most, because it shows the shape of the problem rather than
// an instance of it: keeping a secret from a process that is also running the attacker's code is
// not something more care can achieve. The secret has to be somewhere the attacker's code is not.
//
// So the verdict authority is here and the assessed module is not. This process resolves the target
// path, spawns one short-lived subject per probe, reads one typed observation from each on a
// dedicated descriptor, compares those against the expectations in fam5-probes.mjs, and is the only
// process that ever holds the nonce or writes an AOS_VERDICT line. A subject can lie about what it
// saw only as far as its own captured references allow, and it cannot lie about what that means.

import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { PROBES, SUBCHECKS } from "./fam5-probes.mjs";
import { MAX_CHANNEL_BYTES, RESULT_FD, parseObservation } from "./fam5-result.mjs";

const VERIFIER_ID = "fam5-independent-verifier.v1";

// The files this run's correctness rests on, and their bytes as they were before anything the agent
// wrote had executed.
//
// The assessed module runs with AOS's own filesystem permissions. The workspace scope check walks
// the workspace, so a write into the AOS installation is invisible to it -- and the subject runner
// lives in the AOS installation. A module that overwrote lib/verifiers/fam5-subject.mjs from inside
// the first probe had every later probe executed by its own replacement, which read the result
// token from stdin, never loaded calculator.mjs, and wrote whichever observation the manifest
// expected. Six perfect probes for a ratio() that was wrong for five of them. Separate processes
// were never the whole of probe independence: six processes that share writable code share
// everything that matters.
//
// Two answers, both applied. The run does not read them again -- the subject is executed from the
// string captured here, not from its path -- and the bytes are re-checked after every probe, so a
// write into the installation refuses the verdict instead of merely failing to help the attacker.
// Denying the write in the first place is OS-level workspace confinement, which is #556.
const TRUSTED_FILES = ["./fam5.mjs", "./fam5-subject.mjs", "./fam5-probes.mjs", "./fam5-result.mjs"];

const fileDigest = (relative) => {
  try {
    return createHash("sha256").update(readFileSync(new URL(relative, import.meta.url))).digest("hex");
  } catch {
    return null;
  }
};

const trustedDigests = new Map(TRUSTED_FILES.map((relative) => [relative, fileDigest(relative)]));

/** Which trusted files have changed since this process started, if any. */
const modifiedTrustedFiles = () =>
  TRUSTED_FILES.filter((relative) => fileDigest(relative) !== trustedDigests.get(relative));

// Read once, before the first spawn and therefore before any assessed code has run. Every subject
// is executed from this string.
const SUBJECT_SOURCE = (() => {
  try {
    return readFileSync(new URL("./fam5-subject.mjs", import.meta.url), "utf8");
  } catch {
    return null;
  }
})();

// Under the parent's own timeout, with room left for the verdict to be written. A subject that
// never returns costs one probe, not the run: the remaining probes are refused against the deadline
// instead of being spawned, so an infinite loop in the module body still produces a verdict here
// rather than leaving the parent to read a killed process.
// Said in the verdict rather than only in a comment, because a reader who trusts a subchecks map
// without it is trusting more than this architecture delivers.
//
// The controller's decision is trustworthy: it runs in a process the assessed module never enters,
// against a manifest the module cannot reach, and the module cannot write the AOS_VERDICT line, see
// the nonce, or affect another probe. The *content* of one probe's observation is not, because the
// module runs in the process that produces it and nothing inside a process distinguishes the
// module's code from ours -- the result token is recoverable from an in-process heap snapshot, and
// `node:inspector` reaches further. Raising that floor needs confinement of what a subject can
// reach at all, which is #556.
const OBSERVATION_TRUST = "subject-process-observed; a module that introspects its own process can forge one probe outcome (#556)";

const CONTROLLER_DEADLINE_MS = 6_000;
const PROBE_TIMEOUT_MS = 2_000;
const SAFE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const nonce = process.env.AOS_VERIFIER_NONCE ?? "";
const workspace = process.argv[2] ?? "";

// Nothing in this process imports the assessed module, so this is no longer what keeps the nonce
// away from it. It stays because the environment of a process is inherited by anything it spawns by
// accident as well as on purpose, and one line is cheap insurance against the next person who adds
// a spawn here without building its environment by hand.
delete process.env.AOS_VERIFIER_NONCE;

const emit = (verdict) => {
  process.stdout.write(`AOS_VERDICT ${nonce} ${JSON.stringify(verdict)}\n`);
};

// The subject gets an environment this file builds, never a copy of this one. A spread of
// process.env would hand it AOS_VERIFIER_NONCE and AOS_HOME.
//
// The nonce is not directly exploitable from there as things stand -- the subject's stdout goes to
// /dev/null, so nothing it prints reaches the parent's verdict stream. That is a property of how
// this file wires stdio today, not of the secret, and it is the wrong thing to rest on: the nonce
// is the parent's authentication secret and it has no business in a process that is running
// assessed code. Handing it over would also mean handing it to anything that process writes to,
// including the workspace the run is about.
const subjectEnv = (home) => ({ PATH: SAFE_PATH, HOME: home, TMPDIR: home, LANG: "C", NODE_ENV: "production" });

const contains = (base, target) => target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);

/** The target must be a regular file that really lives in the workspace. A symlink is refused. */
const resolveAssessed = () => {
  let base;
  try {
    base = realpathSync(resolve(workspace));
  } catch {
    return { path: null, reason: "workspace-missing" };
  }
  const full = resolve(base, "calculator.mjs");
  if (!contains(base, full)) return { path: null, reason: "outside-workspace" };
  let stats;
  try {
    stats = lstatSync(full);
  } catch {
    return { path: null, reason: "absent" };
  }
  if (stats.isSymbolicLink()) return { path: null, reason: "symlink" };
  if (!stats.isFile()) return { path: null, reason: "not-a-regular-file" };
  try {
    if (!contains(base, realpathSync(full))) return { path: null, reason: "escapes-workspace" };
  } catch {
    return { path: null, reason: "unresolvable" };
  }
  return { path: full, reason: null };
};

/**
 * Runs one probe in its own process and returns what that process reported, or why nothing counts.
 *
 * One process per probe is what makes a global mutation local. A module that breaks something on
 * load breaks it for the one call that follows, and the next probe gets a process where the module
 * has not run yet.
 */
const runProbe = async (probe, assessedPath, deadline) => {
  const budget = Math.min(PROBE_TIMEOUT_MS, deadline - Date.now());
  if (budget <= 0) return { ok: false, reason: "deadline", observation: null };

  const home = mkdtempSync(join(tmpdir(), "aos-subject-"));
  // Per probe, so a token learned in one probe -- which would take reading it out of a closure --
  // would still not authenticate a result for the next.
  const token = randomUUID();
  let channel = "";
  let overflowed = false;

  try {
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      SUBJECT_SOURCE,
      assessedPath,
      probe.id,
      JSON.stringify(probe.call)
    ], {
      cwd: home,
      shell: false,
      // stdout and stderr are discarded rather than piped. The subject shares no output stream with
      // this process, so an AOS_VERDICT line printed by the assessed module goes to /dev/null and
      // there is no path by which the module's text reaches the parent at all.
      stdio: ["pipe", "ignore", "ignore", "pipe"],
      env: subjectEnv(home)
    });

    child.stdio[RESULT_FD].on("data", (chunk) => {
      if (channel.length > MAX_CHANNEL_BYTES) {
        overflowed = true;
        return;
      }
      channel += chunk.toString("utf8");
      if (channel.length > MAX_CHANNEL_BYTES) overflowed = true;
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${token}\n`);

    let timer = null;
    const outcome = await new Promise((done) => {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
        // Killing the subject is not enough to close its result descriptor: a process the subject
        // spawned can be holding the other end, and then "close" never fires and this controller
        // waits until the parent kills it -- which is fail-closed but reports nothing. Dropping the
        // read end here lets the controller finish and say which probes went unanswered, and the
        // process still holding the descriptor is what the parent's descendant check is for.
        try {
          child.stdio[RESULT_FD]?.destroy();
        } catch {}
        child.unref();
        done({ code: null, signal: null, failed: false, timedOut: true });
      }, budget);
      child.once("error", () => done({ code: null, signal: null, failed: true, timedOut: false }));
      child.once("close", (code, signal) => done({ code, signal, failed: false, timedOut: false }));
    });
    clearTimeout(timer);

    if (outcome.timedOut) return { ok: false, reason: "timeout", observation: null };
    if (outcome.failed) return { ok: false, reason: "spawn-failed", observation: null };
    if (outcome.signal !== null) return { ok: false, reason: "signal", observation: null };
    if (outcome.code !== 0) return { ok: false, reason: "exit-nonzero", observation: null };
    if (overflowed) return { ok: false, reason: "oversized-result", observation: null };
    return parseObservation(channel, { token, probeId: probe.id });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

const refuse = (reason) => {
  emit({
    verifier_id: VERIFIER_ID,
    hidden: false,
    refused: reason,
    subchecks: {},
    probes: {},
    observation_trust: OBSERVATION_TRUST
  });
};

const main = async () => {
  // Before the workspace, because a verifier that cannot vouch for its own runner has nothing to
  // say about anything else.
  if (SUBJECT_SOURCE === null) {
    refuse("subject-runner-unreadable");
    return;
  }
  const modifiedBeforeStart = modifiedTrustedFiles();
  if (modifiedBeforeStart.length > 0) {
    refuse("verifier-code-modified");
    return;
  }

  const target = resolveAssessed();
  if (target.path === null) {
    refuse(target.reason);
    return;
  }

  const deadline = Date.now() + CONTROLLER_DEADLINE_MS;
  const results = new Map();
  for (const probe of PROBES) {
    results.set(probe.id, await runProbe(probe, target.path, deadline));
    // After every probe, not once at the end. Which probe was running when the installation changed
    // is the difference between "the agent edited AOS" and "the agent edited AOS to be graded by
    // its own code", and the run is refused either way.
    if (modifiedTrustedFiles().length > 0) {
      refuse("verifier-code-modified");
      return;
    }
  }

  // A probe passes when the subject reported, the report authenticated, and what it says happened
  // is what the manifest says a fixed ratio() would have done. Anything else -- silence, a second
  // line, a report for another probe, a report nobody can authenticate, a non-zero exit, a timeout
  // -- is a probe that did not pass. There is no branch here that reaches true without an
  // observation, which is what "fails closed" means in this file.
  const passed = (probe) => {
    const result = results.get(probe.id);
    if (!result || result.ok !== true || result.observation === null) return false;
    return result.observation.kind === probe.expect.kind && result.observation.detail === probe.expect.detail;
  };

  const subchecks = {};
  for (const name of SUBCHECKS) {
    const members = PROBES.filter((probe) => probe.subcheck === name);
    subchecks[name] = members.length > 0 && members.every(passed);
  }

  // The per-probe evidence, so a reader can tell "the module returned 0 for 9/3" from "the subject
  // never answered". Both fail; they are not the same finding and a report that flattens them tells
  // the operator nothing they can act on. Every value here has already been through the result
  // schema, so nothing an assessed module chose reaches this line unfiltered.
  const probes = {};
  for (const probe of PROBES) {
    const result = results.get(probe.id);
    probes[probe.id] = {
      passed: passed(probe),
      refused: result?.reason ?? null,
      kind: result?.observation?.kind ?? null,
      detail: result?.observation?.detail ?? null
    };
  }

  emit({
    verifier_id: VERIFIER_ID,
    hidden: Object.values(subchecks).every(Boolean),
    refused: null,
    subchecks,
    probes,
    observation_trust: OBSERVATION_TRUST
  });
};

// A rejection must not become a silent pass: no verdict line at all is what the parent reads as a
// verifier failure, so the only thing to add here is a non-zero exit.
main().catch(() => {
  process.exitCode = 1;
});
