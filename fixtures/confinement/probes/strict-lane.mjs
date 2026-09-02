// Records the Phase B real-lane evidence: the boundary canary and the installed Codex runtime,
// both run through the profile `lib/confinement.mjs` generates for a STRICT run on this machine.
// Phase 0 recorded its observations ad hoc; this one is committed so that the lane can be
// re-measured after a macOS, Codex or profile change with one command:
//
//   node fixtures/confinement/probes/strict-lane.mjs            # observations only
//   node fixtures/confinement/probes/strict-lane.mjs --matrix   # and rewrite support-matrix.json
//
// Everything written is scrubbed to the same placeholders Phase 0 used. No credential value is
// read by this script; Codex reads its own out of CODEX_HOME inside the boundary, and what is
// recorded is its answer, not its token.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ADAPTERS } from "../../../lib/profile.mjs";
import { sha256Bytes } from "../../../lib/digest.mjs";
import { SUPPORT_LANES, SUPPORT_MATRIX_SCHEMA, prepareConfinement } from "../../../lib/confinement.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const observations = resolve(here, "..", "observations");
const fixtureDir = resolve(here, "..");
const writeMatrix = process.argv.includes("--matrix");

const excerpt = (buffer, limit = 2000) => (buffer ?? Buffer.alloc(0)).toString("utf8").slice(0, limit);

/**
 * What a runtime's stream looked like, without quoting it.
 *
 * Bytes, lines, and a digest over the bytes, plus which of a small set of markers the output
 * contained -- whether it authenticated, whether it reported the one word the prompt asked for,
 * whether it printed an error. Enough to judge the run and to detect a change in it; nothing of
 * the conversation, the model's words or the session identifier.
 */
const streamSummary = (buffer) => {
  const bytes = buffer ?? Buffer.alloc(0);
  const text = bytes.toString("utf8");
  return {
    bytes: bytes.length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
    digest: sha256Bytes(bytes),
    markers: {
      logged_in: /Logged in/u.test(text),
      answered_ok: /\bOK\b/u.test(text),
      error: /\berror\b/iu.test(text),
      tokens_used: /tokens used/u.test(text)
    }
  };
};

const main = async () => {
  if (process.platform !== "darwin") throw new Error("strict-lane.mjs measures the darwin/macos-seatbelt lane and runs only on darwin");
  const operatorHome = realpathSync(process.env.HOME);
  const configDir = realpathSync(process.env.CODEX_HOME ?? join(process.env.HOME, ".codex"));
  const base = mkdtempSync(join(tmpdir(), "aos-strict-lane-"));
  const aosHome = join(base, "home");
  const runId = "run-strict-lane";
  // The layout a real run has since #556: the store holds AOS's own records, and the workspaces
  // live in their own root beside it, one directory per run. The boundary denies that root by name
  // and grants back the one workspace in hand, so the other run below is a directory this run
  // cannot read.
  const workspacesRoot = join(base, "home-workspaces");
  const workspace = join(workspacesRoot, runId, "FAM-1");
  const otherRun = join(workspacesRoot, "run-other", "FAM-1");
  const agentHome = mkdtempSync(join(tmpdir(), "aos-agent-home-"));
  const runScratch = mkdtempSync(join(tmpdir(), "aos-prompt-"));
  mkdirSync(workspace, { recursive: true });
  mkdirSync(otherRun, { recursive: true });
  // The store itself, which now holds only AOS's own records: the canary plants a file in its root
  // and in a run directory to prove neither is readable from inside the boundary.
  mkdirSync(join(aosHome, "runs", runId), { recursive: true });
  writeFileSync(join(otherRun, "secret.txt"), "other-run-secret\n");
  writeFileSync(join(workspace, "task.md"), "# task\n\nReply with the single word OK.\n");
  // Exactly the operator's own resolution: CODEX_HOME when set, else `~/.codex`. The handle stages
  // the files it declares out of that directory; the directory itself is never named in the profile.
  const env = { PATH: process.env.PATH, ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}) };
  // Both spellings of every path: `os.tmpdir()` hands out `/var/folders/...` and the kernel
  // reports `/private/var/folders/...`, and a runtime may print either.
  const readFileOrEmpty = (path) => {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
};

const resolvedOr = (path) => {
    try { return realpathSync(path); } catch { return path; }
  };
  const scrubber = (text) => {
    const pairs = [
      [workspace, "@WORKSPACE@"],
      [workspacesRoot, "@WORKSPACES_ROOT@"],
      [aosHome, "@AOS_HOME@"],
      [base, "@BASE@"],
      [agentHome, "@AGENT_TEMP_HOME@"],
      [runScratch, "@RUN_SCRATCH@"],
      [configDir, "@RUNTIME_CONFIG_DIR@"],
      [operatorHome, "@OPERATOR_HOME@"],
      [process.env.HOME, "@OPERATOR_HOME@"]
      // `realpathSync` where the directory still exists, and the path itself where it does not:
      // the teardown observation is recorded after these are removed, and a scrubber that threw
      // there would take the cleanup evidence with it.
    ].flatMap(([path, name]) => [[path, name], [resolvedOr(path), name]]).concat([[hostname(), "@HOSTNAME@"]]).sort((a, b) => b[0].length - a[0].length);
    let out = text;
    for (const [from, to] of pairs) out = out.split(from).join(to);
    return out;
  };
  const record = (name, body) => {
    const file = join(observations, `${name}.json`);
    const text = scrubber(JSON.stringify({ backend_run: name, ...body }, null, 2));
    for (const secret of [operatorHome, process.env.HOME, hostname()]) {
      if (text.includes(secret)) throw new Error(`${name}: an unscrubbed operator path or host name survived`);
    }
    writeFileSync(file, `${text}\n`);
    process.stdout.write(`wrote ${file}\n`);
    return file;
  };

  // Every result the matrix row depends on, so the row is stamped from what happened rather than
  // from the script having reached the end.
  const outcomes = { canary: null, auth: null, exec: null };
  let handle = null;
  let stagedAuth = null;
  try {
  try {
    handle = await prepareConfinement({ level: "STRICT", adapter: ADAPTERS["codex-cli.v1"], workspace, aosHome, agentHome, runScratch, command: "codex", env });
    stagedAuth = handle.staging?.dir === null || handle.staging?.dir === undefined ? null : join(handle.staging.dir, "auth.json");
    outcomes.canary = handle.canary_run?.result === "PASS" ? 0 : 1;
  } catch (error) {
    if (error.canary) {
      record("strict-lane.darwin.seatbelt.canary", {
        command: "node boundary-canary.mjs   # under sandbox-exec -f strict.sb, profile generated by lib/confinement.mjs",
        exit_status: error.canary.exit_code,
        signal: error.canary.signal,
        spawn_error: error.canary.spawn_error,
        stdout_excerpt: "",
        stderr_excerpt: excerpt(Buffer.from(error.canary.stderr_excerpt ?? "")),
        parse_error: null,
        captured: { result: error.canary.result, failed: error.canary.failed, cells: error.canary.cells, out_of_band: error.canary.out_of_band }
      });
    }
    outcomes.canary = 1;
    throw error;
  }
  {
    const canary = handle.canary_run;
    const scrubbedTree = (path) => scrubber(path);
    record("strict-lane.darwin.seatbelt.canary", {
      command: `${scrubbedTree(canary.command[0])} -f strict.sb <node> boundary-canary.mjs   # profile generated by lib/confinement.mjs from isolation policy ${handle.policy_digest}`,
      exit_status: canary.exit_code,
      signal: canary.signal,
      spawn_error: canary.spawn_error,
      stdout: streamSummary(Buffer.alloc(0)),
      stderr: streamSummary(Buffer.from(canary.stderr_excerpt)),
      parse_error: null,
      captured: {
        result: canary.result,
        failed: canary.failed,
        cells: canary.cells,
        out_of_band: canary.out_of_band,
        evidence_digest: canary.evidence_digest,
        program_digest: canary.program_digest,
        policy_digest: handle.policy_digest,
        rendered_profile_digest: handle.rendered_profile_digest,
        scan_polls: canary.scan_polls,
        // The group the canary child led, swept from the process table after teardown. The matrix
        // reads the process axis from this through the same helper a run uses, so the row cannot
        // synthesize a sweep the lane never made.
        group_sweep: canary.group_sweep,
        // And the sweep that survives a reparent and a regroup, with what it scanned by. The
        // matrix requires it, so a recorded lane that never looked for the orphan cannot be
        // official.
        survivor_sweep: canary.survivor_sweep,
        // Which executable the lane was measured with, and whether #554 verified it as this
        // adapter's runtime. The matrix reads it: a row whose recorded run staged a credential for
        // an unidentified program is not the lane the release proved.
        runtime_identity: handle.staging.identity,
        network_policy: handle.policy.network.policy,
        bindings: Object.fromEntries(Object.entries(handle.bindings).map(([key, value]) => [key, value === null ? null : scrubber(value)]))
      }
    });

    // The environment `lib/core.mjs` builds for the child, reduced to what this lane needs: the
    // agent's HOME and TMPDIR, PATH, and the staged CODEX_HOME the handle hands back.
    const childEnv = { PATH: process.env.PATH, HOME: agentHome, TMPDIR: agentHome, ...handle.env };
    const staging = { dir: scrubber(handle.staging.dir), staged: handle.staging.staged, source: handle.staging.source };
    const runCodex = (args, name, input, extra = {}) => {
      const launch = handle.spawnSpec(realpathSync(join(process.env.HOME, ".local", "bin", "codex")), args);
      const started = Date.now();
      const result = spawnSync(launch.command, launch.args, { cwd: workspace, env: childEnv, input: Buffer.from(input), timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
      record(name, {
        command: `cd @WORKSPACE@ && sandbox-exec -f strict.sb codex ${args.join(" ")}   # same profile as the canary; HOME=TMPDIR=@AGENT_TEMP_HOME@, CODEX_HOME=${staging.dir} (staged copy of ${staging.staged.join(", ")})`,
        exit_status: result.status,
        signal: result.signal,
        spawn_error: result.error ? result.error.message : null,
        // Not the transcript. A runtime's stdout and stderr carry the prompt, the model's answer,
        // its banner and its session id, and SSOT excludes raw transcripts from committed
        // evidence -- so what is recorded is the shape of the output and a digest of its bytes.
        // The digest is what makes this evidence: it is over what the runtime actually wrote, and
        // a reader can recompute it from a re-run.
        stdout: streamSummary(result.stdout),
        stderr: streamSummary(result.stderr),
        parse_error: null,
        // A function when the record depends on what the run left behind: arguments are evaluated
        // before the call, so an object built there would describe the state before the runtime ran.
        captured: { duration_ms: Date.now() - started, staging, ...(typeof extra === "function" ? extra(result) : extra) }
      });
      return result;
    };
    outcomes.auth = runCodex(["login", "status"], "strict-lane.darwin.seatbelt.codex-auth", "").status;
    const lastMessage = join(workspace, "last-message.txt");
    // The same argument vector `agent discover` registers for Codex, the prompt on stdin the way
    // `runProcess` sends it, plus `-o` so that the answer is captured without parsing the stream.
    const prompt = "Reply with exactly the single word OK and nothing else.";
    const exec = runCodex(["exec", "--skip-git-repo-check", "-C", workspace, "-o", lastMessage, "-"], "strict-lane.darwin.seatbelt.codex-exec", prompt, () => ({
      // The prompt is this repository's own one-line instruction, so it is quoted; the answer is
      // the model's, so only its shape and whether it is the word the prompt asked for.
      prompt,
      answer: streamSummary(Buffer.from(readFileOrEmpty(lastMessage), "utf8")),
      answered_expected_word: readFileOrEmpty(lastMessage).trim() === "OK"
    }));
    outcomes.exec = exec.status;
    let last = null;
    try { last = readFileSync(lastMessage, "utf8"); } catch {}
    process.stdout.write(`codex exec: exit ${exec.status} last message ${JSON.stringify(last)}\n`);

    const host = spawnSync("/bin/sh", ["-c", "uname -a; sw_vers; node -v; codex --version; ls -l /usr/bin/sandbox-exec"], { encoding: "buffer" });
    record("strict-lane.darwin.host", {
      command: "uname -a; sw_vers; node -v; codex --version; ls -l /usr/bin/sandbox-exec",
      exit_status: host.status,
      signal: host.signal,
      spawn_error: null,
      // The host description is this machine's own, not a runtime's output: kept as text because
      // the whole point of it is to be read, and scrubbed of the operator's paths and host name.
      stdout_excerpt: scrubber(excerpt(host.stdout)),
      stderr_excerpt: scrubber(excerpt(host.stderr)),
      parse_error: null,
      captured: null
    });
  }
  } finally {
    // Unconditional. A probe that stages a credential copy and then fails its canary used to
    // rethrow before this ran, leaving `agentHome/.codex/auth.json`, the base store and the run
    // scratch on the operator's disk -- exactly the failure mode the staged copy exists to avoid.
    if (handle !== null) handle.cleanup();
    for (const path of [base, agentHome, runScratch]) rmSync(path, { recursive: true, force: true });
    // And the evidence that it went: the matrix reads `cleanup_verified` from this rather than
    // from a row declaring it.
    record("strict-lane.darwin.seatbelt.cleanup", {
      command: "handle.cleanup(); rm -rf @BASE@ @AGENT_TEMP_HOME@ @RUN_SCRATCH@   # the probe's own teardown",
      exit_status: 0,
      signal: null,
      spawn_error: null,
      stdout: streamSummary(Buffer.alloc(0)),
      stderr: streamSummary(Buffer.alloc(0)),
      parse_error: null,
      captured: {
        removed: {
          staged_runtime_config: stagedAuth === null || !existsSync(stagedAuth),
          agent_home: !existsSync(agentHome),
          run_scratch: !existsSync(runScratch),
          base_store: !existsSync(base)
        },
        outcomes
      }
    });
  }

  if (writeMatrix) {
    const reference = (name) => {
      const file = `observations/${name}.json`;
      return { file, digest: sha256Bytes(readFileSync(join(fixtureDir, file))) };
    };
    const lanes = SUPPORT_LANES.map((lane) => {
      // The lane is proven by what ran, not by which lane this script measures: the canary passed,
      // the runtime authenticated under the boundary, and the runtime executed a task under it.
      // Stamping `official` from the lane's identity alone let a failed `codex exec` -- the runtime
      // not starting under the profile -- be recorded as a proven lane.
      const measured = outcomes.canary === 0 && outcomes.auth === 0 && outcomes.exec === 0;
      const proven = lane.platform === "darwin" && lane.backend === "macos-seatbelt" && lane.adapter === "codex-cli.v1" && measured;
      const strict = lane.level === "STRICT";
      const row = {
        platform: lane.platform,
        backend: lane.backend,
        adapter: lane.adapter,
        level: lane.level,
        support_status: lane.support_status,
        official: proven,
        network_policy: !strict ? null : lane.adapter === "generic-command.v1" || lane.adapter === "*" ? "disabled" : "provider-required-unrestricted",
        provider_transport: !strict ? "allowed" : lane.adapter === "generic-command.v1" || lane.adapter === "*" ? "denied" : "allowed"
      };
      if (proven) {
        row.evidence = {
          canary: reference("strict-lane.darwin.seatbelt.canary"),
          runtime: reference("strict-lane.darwin.seatbelt.codex-auth"),
          exec: reference("strict-lane.darwin.seatbelt.codex-exec"),
          cleanup: reference("strict-lane.darwin.seatbelt.cleanup"),
          host: reference("strict-lane.darwin.host")
        };
        row.constraints = [
          "sandbox-exec is deprecated by Apple and still enforcing on darwin 25.3 (macOS 26.3); the probe re-checks it on every run",
          "CODEX_HOME is a staged copy, not a hole: auth.json and config.toml are copied into the agent's private HOME before the spawn, the operator's ~/.codex is never named in the profile, and what Codex writes to the copy -- session logs, its state database, a refreshed token -- is discarded with the run",
          "task-initiated external network is NOT_OBSERVED: the profile allows outbound network wholesale because the provider transport needs it",
          "a descendant that double-forks between two 200 ms polls is not tracked; it stays confined by the kernel"
        ];
      } else if (lane.platform === "darwin" && lane.backend === "macos-seatbelt" && lane.adapter === "codex-cli.v1") {
        row.reason = `the lane was measured on this host and did not hold: canary ${outcomes.canary}, codex login ${outcomes.auth}, codex exec ${outcomes.exec}`;
      } else if (lane.backend === "none") {
        row.reason = "no OS boundary: a replaced HOME and a filtered environment are not a sandbox";
      } else if (lane.backend === "linux-bubblewrap") {
        row.reason = "bwrap is not installed on the probing host; the argument vector is tested, the boundary is not measured";
      } else if (lane.backend === "linux-container") {
        row.reason = "Phase 0 measured the boundary in a container and could not run the darwin-only runtime inside it; no adapter targets it";
      } else {
        row.reason = "boundary measured by the same canary, no real runtime authenticated under it on this lane";
      }
      return row;
    });
    const rest = { schema: SUPPORT_MATRIX_SCHEMA, recorded_on: "darwin 25.3.0 arm64, macOS 26.3", lanes };
    const matrix = { ...rest, evidence_digest: sha256Bytes(Buffer.from(JSON.stringify(rest))) };
    const file = join(fixtureDir, "support-matrix.json");
    writeFileSync(file, `${JSON.stringify(matrix, null, 2)}\n`);
    process.stdout.write(`wrote ${file}\n`);
  }
};

await main();
