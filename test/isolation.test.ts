import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { describe, test } from "node:test";

// Namespace/dynamic import: a missing module or named export must stay undefined so each case
// fails with its pinned message. A static named import would be a module-load error, which the
// RED contract treats as an unrelated stop.
const REACHED =
  "worker can reach an oracle file, environment canary, inherited descriptor, temporary location, symlink, /proc file descriptor, or a post-run oracle before termination.";

const CANARY = "AOS_ORACLE_CANARY";
const SECRET_ENV = "AOS_ORACLE_SECRET";
const SAFE_PATH = "/usr/bin";
const MAX_ORACLE_BYTES = 1024 * 1024;
const MAX_ORACLE_NESTING = 32;

type Fail = { ok: false; reason: string; classification: "INVALID" | "UNSAFE" };
type EnvelopeOk = {
  ok: true;
  env: Record<string, string>;
  cwd: string;
  stdio: (string | number)[];
  allowedPaths: string[];
  ipc: { enabled: boolean; channels: string[] };
};
type EnvelopeResult = EnvelopeOk | Fail;
type AssertResult = { ok: true } | Fail;
type IsolationApi = {
  buildWorkerEnvelope: (input: unknown) => EnvelopeResult;
  assertIsolation: (input: unknown) => AssertResult;
};

const loadIsolation = async () => {
  try {
    return await import("../src/runner/isolation.ts");
  } catch {
    return {};
  }
};

const requireExports = async (): Promise<IsolationApi> => {
  const mod = await loadIsolation();
  assert.equal(typeof mod.buildWorkerEnvelope, "function", REACHED);
  assert.equal(typeof mod.assertIsolation, "function", REACHED);
  return mod as IsolationApi;
};

type Bed = { root: string; workspace: string; oracle: string; temp: string };

const openBed = (): Bed => {
  const root = mkdtempSync(join(tmpdir(), "aos-e3-002-"));
  const workspace = join(root, "workspace");
  const oracleDir = join(root, "oracle");
  const temp = join(root, "scratch");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(oracleDir, { recursive: true });
  mkdirSync(temp, { recursive: true });
  writeFileSync(join(workspace, "src", "app.ts"), "export const n = 1;\n");
  const oracle = join(oracleDir, "expected.json");
  writeFileSync(oracle, JSON.stringify({ answer: CANARY }));
  return { root, workspace, oracle, temp };
};

const closeBed = (bed: Bed) => rmSync(bed.root, { recursive: true, force: true });

const request = (bed: Bed, extra: Record<string, unknown> = {}) => ({
  workspaceRoot: bed.workspace,
  oraclePath: bed.oracle,
  tempRoot: bed.temp,
  env: { PATH: SAFE_PATH, [SECRET_ENV]: CANARY },
  ...extra
});

const accepted = (result: { ok: boolean; reason?: string }, _label: string): void => {
  assert.equal(result.ok, true, REACHED);
};

const refused = (result: AssertResult | EnvelopeResult, _label: string, classification?: "INVALID" | "UNSAFE"): void => {
  assert.equal(result.ok, false, REACHED);
  if (result.ok) return;
  assert.equal(result.reason, REACHED, REACHED);
  // Every violation is classified; a refusal with no classification is not a terminal state.
  assert.equal(result.classification === "INVALID" || result.classification === "UNSAFE", true, REACHED);
  if (classification) assert.equal(result.classification, classification, REACHED);
};

const asOk = (result: EnvelopeResult, label: string): EnvelopeOk => {
  accepted(result, label);
  if (!result.ok) throw new Error(REACHED);
  return result;
};

const envelopeText = (envelope: EnvelopeOk): string =>
  JSON.stringify({ env: envelope.env, cwd: envelope.cwd, stdio: envelope.stdio, allowedPaths: envelope.allowedPaths, ipc: envelope.ipc });

describe("isolation", () => {
  test("oracle-path", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const noEvidence = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");
      // An envelope describes policy, not an observed interaction. A bare envelope is therefore
      // not evidence that a worker was isolated.
      refused(api.assertIsolation({ envelope: noEvidence }), "no interaction evidence", "INVALID");
      accepted(api.assertIsolation({ envelope: noEvidence, readPath: join(bed.workspace, "src", "app.ts") }), "observed read");

      // WeakMap identity alone is not integrity: every mutable field must still agree with the
      // issued record before a report is accepted.
      const mutated = asOk(api.buildWorkerEnvelope(request(bed)), "mutable envelope");
      mutated.cwd = "/";
      mutated.allowedPaths = ["/"];
      mutated.stdio = ["inherit"];
      mutated.env[SECRET_ENV] = CANARY;
      mutated.ipc.channels = [CANARY];
      refused(
        api.assertIsolation({ envelope: mutated, readPath: join(bed.workspace, "src", "app.ts") }),
        "mutated issued envelope",
        "INVALID"
      );

      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // The oracle path must not appear anywhere the worker can read it, and no allowed path may
      // contain it. Denial is by allowlist, not by the oracle living somewhere unguessable.
      assert.equal(envelopeText(envelope).includes(bed.oracle), false, REACHED);
      for (const allowed of envelope.allowedPaths) {
        assert.equal(isAbsolute(allowed), true, REACHED);
        assert.equal(bed.oracle.startsWith(allowed), false, REACHED);
      }

      refused(api.assertIsolation({ envelope, readPath: bed.oracle }), "read the oracle directly", "UNSAFE");
      refused(
        api.assertIsolation({ envelope, readPath: join(bed.workspace, "..", "oracle", "expected.json") }),
        "reach the oracle by traversal",
        "UNSAFE"
      );
      accepted(api.assertIsolation({ envelope, readPath: join(bed.workspace, "src", "app.ts") }), "read inside the workspace");

      // An oracle cannot be recognised by its presentation path alone. Inode identity catches a
      // hardlink, while a digest catches a distinct file containing the same bytes.
      const hardlink = join(bed.workspace, "oracle-hardlink.json");
      const copy = join(bed.workspace, "oracle-copy.json");
      linkSync(bed.oracle, hardlink);
      writeFileSync(copy, readFileSync(bed.oracle));
      refused(api.assertIsolation({ envelope, readPath: hardlink }), "hardlink to the oracle", "UNSAFE");
      refused(api.assertIsolation({ envelope, readPath: copy }), "byte-for-byte oracle copy", "UNSAFE");
      const changedHardlink = join(bed.workspace, "changed-oracle-hardlink.json");
      linkSync(bed.oracle, changedHardlink);
      writeFileSync(changedHardlink, "changed-after-issue");
      refused(api.assertIsolation({ envelope, readPath: changedHardlink }), "changed hardlink to the oracle", "UNSAFE");
      accepted(api.assertIsolation({ envelope, readPath: join(bed.workspace, "src", "app.ts") }), "ordinary workspace file");

      // A directory is not a readable oracle file, even when its path exists.
      refused(api.buildWorkerEnvelope(request(bed, { oraclePath: dirname(bed.oracle) })), "directory oracle", "INVALID");
      accepted(api.buildWorkerEnvelope(request(bed)), "regular oracle file");

      const oversized = join(bed.root, "oversized-oracle");
      writeFileSync(oversized, "x".repeat(MAX_ORACLE_BYTES + 1));
      refused(api.buildWorkerEnvelope(request(bed, { oraclePath: oversized })), "oversized oracle", "INVALID");
      const deeplyNested = join(bed.root, "deep-oracle.json");
      writeFileSync(deeplyNested, `${"[".repeat(MAX_ORACLE_NESTING + 1)}"x"${"]".repeat(MAX_ORACLE_NESTING + 1)}`);
      refused(api.buildWorkerEnvelope(request(bed, { oraclePath: deeplyNested })), "over-nested oracle", "INVALID");
      accepted(api.buildWorkerEnvelope(request(bed)), "bounded oracle");

      // Read errors are evidence failures, never an empty secret list. Restore permissions before
      // teardown so cleanup is deterministic.
      chmodSync(bed.oracle, 0o000);
      try {
        refused(api.buildWorkerEnvelope(request(bed)), "unreadable oracle", "INVALID");
      } finally {
        chmodSync(bed.oracle, 0o600);
      }
      accepted(api.buildWorkerEnvelope(request(bed)), "readable oracle after restore");

      // An envelope this module never issued carries no rules to check it against. Without this the
      // registry lookup can be replaced by "trust it" and every case here still passes, because
      // every case hands back an envelope the module itself produced.
      refused(
        api.assertIsolation({
          envelope: {
            ok: true,
            env: {},
            cwd: bed.workspace,
            stdio: ["pipe"],
            allowedPaths: [bed.workspace],
            ipc: { enabled: false, channels: [] }
          },
          readPath: bed.oracle
        }),
        "a fabricated envelope",
        "INVALID"
      );
    } finally {
      closeBed(bed);
    }
  });

  test("env-secret", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // The canary is present in the caller's environment and must not survive into the worker's,
      // by name or by value -- renaming the variable is not isolation.
      assert.equal(Object.hasOwn(envelope.env, SECRET_ENV), false, REACHED);
      for (const value of Object.values(envelope.env)) assert.equal(value.includes(CANARY), false, REACHED);
      refused(api.assertIsolation({ envelope, env: { PATH: SAFE_PATH, [SECRET_ENV]: CANARY } }), "canary re-added", "UNSAFE");
      refused(api.assertIsolation({ envelope, env: { PATH: SAFE_PATH, RENAMED: CANARY } }), "canary under another name", "UNSAFE");

      // Both cases above are refused on the variable NAME, so the value scan never had to fire and
      // could be deleted with the suite still green. An allowlisted name carrying the oracle is the
      // case that needs it: PATH is permitted to cross over, its contents are not.
      refused(api.assertIsolation({ envelope, env: { PATH: `${SAFE_PATH}:${CANARY}` } }), "allowlisted canary", "UNSAFE");
      accepted(api.assertIsolation({ envelope, env: { PATH: SAFE_PATH } }), "ordinary PATH");
    } finally {
      closeBed(bed);
    }
  });

  test("fd-leak", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // stdio must be fully specified; an inherited slot hands the worker a descriptor the parent
      // opened, which is how an oracle handle escapes without any path being named.
      assert.equal(Array.isArray(envelope.stdio), true, REACHED);
      assert.equal(envelope.stdio.includes("inherit"), false, REACHED);
      refused(api.assertIsolation({ envelope, stdio: ["inherit", "pipe", "pipe"] }), "inherited stdin", "UNSAFE");
      refused(api.assertIsolation({ envelope, stdio: ["pipe", "pipe", "pipe", 7] }), "extra numeric descriptor", "UNSAFE");
      accepted(api.assertIsolation({ envelope, stdio: ["pipe", "pipe", "pipe"] }), "isolated descriptors");
    } finally {
      closeBed(bed);
    }
  });

  test("ipc-leak", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // An IPC channel is a path for the oracle to arrive on. Whatever channels exist must be
      // named, and a message carrying the canary is a violation rather than a redaction problem.
      for (const channel of envelope.ipc.channels) assert.equal(channel.includes(CANARY), false, REACHED);
      refused(api.assertIsolation({ envelope, ipcMessage: { answer: CANARY } }), "canary over IPC", "UNSAFE");
      refused(api.assertIsolation({ envelope, ipcMessage: { nested: { deep: [CANARY] } } }), "nested canary", "UNSAFE");
      refused(api.assertIsolation({ envelope, ipcMessage: { [CANARY]: 1 } }), "canary as IPC key", "UNSAFE");

      // IPC values are not restricted to JSON-like records. Each carrier has an independent
      // representation capable of moving a secret across the worker boundary.
      refused(api.assertIsolation({ envelope, ipcMessage: Buffer.from(CANARY) }), "canary Buffer", "UNSAFE");
      refused(api.assertIsolation({ envelope, ipcMessage: new Map([["answer", CANARY]]) }), "canary Map", "UNSAFE");
      refused(api.assertIsolation({ envelope, ipcMessage: new Set([CANARY]) }), "canary Set", "UNSAFE");
      refused(api.assertIsolation({ envelope, ipcMessage: new String(CANARY) }), "boxed canary", "UNSAFE");
      refused(api.assertIsolation({ envelope, ipcMessage: { toJSON: () => ({ answer: CANARY }) } }), "toJSON canary", "UNSAFE");
      refused(api.assertIsolation({ envelope, ipcMessage: { toString: () => CANARY } }), "toString canary", "UNSAFE");
      accepted(api.assertIsolation({ envelope, ipcMessage: new Map([["status", "running"]]) }), "ordinary IPC Map");

      // Oracle extraction has no length floor: JSON keys and every scalar representation are
      // secrets. Non-JSON documents are parsed into their complete document and delimiter-bounded
      // fields, so a field leaked from "name=value" is still caught.
      writeFileSync(bed.oracle, JSON.stringify({ answer: 12345678 }));
      const numeric = asOk(api.buildWorkerEnvelope(request(bed)), "numeric oracle");
      refused(api.assertIsolation({ envelope: numeric, ipcMessage: 12345678 }), "numeric canary", "UNSAFE");
      accepted(api.assertIsolation({ envelope: numeric, ipcMessage: 42 }), "ordinary numeric IPC");

      writeFileSync(bed.oracle, JSON.stringify({ answer: "short" }));
      const short = asOk(api.buildWorkerEnvelope(request(bed)), "short oracle");
      refused(api.assertIsolation({ envelope: short, ipcMessage: "short" }), "short canary", "UNSAFE");
      accepted(api.assertIsolation({ envelope: short, ipcMessage: "ordinary" }), "ordinary short IPC");

      writeFileSync(bed.oracle, JSON.stringify({ keyCanary: "ordinary" }));
      const key = asOk(api.buildWorkerEnvelope(request(bed)), "key oracle");
      refused(api.assertIsolation({ envelope: key, ipcMessage: { keyCanary: 1 } }), "oracle key", "UNSAFE");
      accepted(api.assertIsolation({ envelope: key, ipcMessage: { status: "running" } }), "ordinary key IPC");

      writeFileSync(bed.oracle, JSON.stringify({ answer: true }));
      const bool = asOk(api.buildWorkerEnvelope(request(bed)), "boolean oracle");
      refused(api.assertIsolation({ envelope: bool, ipcMessage: true }), "boolean canary", "UNSAFE");
      accepted(api.assertIsolation({ envelope: bool, ipcMessage: false }), "ordinary boolean IPC");

      writeFileSync(bed.oracle, "answer=raw-short");
      const nonJson = asOk(api.buildWorkerEnvelope(request(bed)), "non-JSON oracle");
      refused(api.assertIsolation({ envelope: nonJson, ipcMessage: "raw-short" }), "non-JSON field", "UNSAFE");
      accepted(api.assertIsolation({ envelope: nonJson, ipcMessage: "ordinary" }), "ordinary non-JSON IPC");
    } finally {
      closeBed(bed);
    }
  });

  test("child-inherit", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // A child spawned by the worker inherits the worker's envelope at every generation, so the
      // same denials recurse until a terminal child. One generation would end isolation at the
      // first process boundary.
      refused(api.assertIsolation({ envelope, child: { env: { [SECRET_ENV]: CANARY } } }), "child canary", "UNSAFE");
      refused(api.assertIsolation({ envelope, child: { readPath: bed.oracle } }), "child oracle", "UNSAFE");
      refused(api.assertIsolation({ envelope, child: { stdio: ["inherit"] } }), "child descriptor", "UNSAFE");
      refused(
        api.assertIsolation({ envelope, child: { child: { child: { ipcMessage: { answer: CANARY } } } } }),
        "grandchild canary",
        "UNSAFE"
      );
      accepted(api.assertIsolation({ envelope, child: { child: { ipcMessage: { status: "running" } } } }), "ordinary descendant");
    } finally {
      closeBed(bed);
    }
  });

  test("redaction", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // A refusal must not quote what it refused. Reporting the canary to prove it was found is
      // the same disclosure by another route.
      const violation = api.assertIsolation({ envelope, ipcMessage: { answer: CANARY } });
      refused(violation, "canary over IPC", "UNSAFE");
      if (!violation.ok) {
        assert.equal(violation.reason.includes(CANARY), false, REACHED);
        assert.equal(JSON.stringify(violation).includes(CANARY), false, REACHED);
        assert.equal(JSON.stringify(violation).includes(bed.oracle), false, REACHED);
      }
      accepted(api.assertIsolation({ envelope, ipcMessage: { status: "running" } }), "ordinary IPC");
    } finally {
      closeBed(bed);
    }
  });

  test("temp-oracle", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // A temporary location is writable and shared; a copy of the oracle placed there is still
      // the oracle, and the system temp directory is not an allowed path.
      const planted = join(bed.temp, "expected.json");
      writeFileSync(planted, readFileSync(bed.oracle, "utf8"));
      refused(api.assertIsolation({ envelope, readPath: planted }), "oracle copied into temp", "UNSAFE");
      refused(api.assertIsolation({ envelope, readPath: join(tmpdir(), "anything.json") }), "system temp", "UNSAFE");

      // A workspace may legitimately live under the system temporary directory -- on Linux
      // tmpdir() is /tmp and CI puts it there. Denying that directory wholesale refused every read
      // in the workspace it was supposed to protect, and this suite did not catch it because macOS
      // tmpdir() is not under realpath("/tmp"). Building a bed directly under /tmp reproduces the
      // condition on both platforms.
      {
        const under = mkdtempSync(join("/tmp", "aos-e3-002-under-"));
        try {
          const workspace = join(under, "workspace");
          const oracleDir = join(under, "oracle");
          const scratch = join(under, "scratch");
          mkdirSync(join(workspace, "src"), { recursive: true });
          mkdirSync(oracleDir, { recursive: true });
          mkdirSync(scratch, { recursive: true });
          writeFileSync(join(workspace, "src", "app.ts"), "export const n = 1;\n");
          const oraclePath = join(oracleDir, "expected.json");
          writeFileSync(oraclePath, JSON.stringify({ answer: CANARY }));
          const nested = asOk(
            api.buildWorkerEnvelope({ workspaceRoot: workspace, oraclePath, tempRoot: scratch, env: { PATH: SAFE_PATH } }),
            "envelope under system temp"
          );
          accepted(api.assertIsolation({ envelope: nested, readPath: join(workspace, "src", "app.ts") }), "workspace under system temp");
          refused(api.assertIsolation({ envelope: nested, readPath: join(scratch, "copy.json") }), "declared scratch", "UNSAFE");
        } finally {
          rmSync(under, { recursive: true, force: true });
        }
      }

      // Both refusals above are already satisfied by workspace containment, because this bed puts
      // the scratch root outside the workspace. Put it inside and containment can no longer answer:
      // the temp rule is then the only thing between the worker and a copy placed there.
      {
        const nested = join(bed.workspace, "scratch");
        mkdirSync(nested, { recursive: true });
        writeFileSync(join(nested, "copy.json"), readFileSync(bed.oracle, "utf8"));
        const inner = asOk(api.buildWorkerEnvelope({ ...request(bed), tempRoot: nested }), "in-workspace scratch envelope");
        refused(api.assertIsolation({ envelope: inner, readPath: join(nested, "copy.json") }), "in-workspace scratch", "UNSAFE");
        accepted(api.assertIsolation({ envelope: inner, readPath: join(bed.workspace, "src", "app.ts") }), "ordinary workspace file");
      }
    } finally {
      closeBed(bed);
    }
  });

  test("symlink-oracle", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // A symlink inside the workspace resolves outside it. Checking the presented path rather
      // than its real target is the whole defect this case exists for.
      const link = join(bed.workspace, "answer.json");
      symlinkSync(bed.oracle, link);
      refused(api.assertIsolation({ envelope, readPath: link }), "symlink to oracle", "UNSAFE");

      const dirLink = join(bed.workspace, "peek");
      symlinkSync(join(bed.root, "oracle"), dirLink);
      refused(api.assertIsolation({ envelope, readPath: join(dirLink, "expected.json") }), "symlinked directory", "UNSAFE");

      // The path is two missing levels below the symlink, so only the deepest-existing-ancestor
      // walk can reveal that it would land outside the workspace.
      const outside = join(bed.root, "outside");
      mkdirSync(outside);
      const escape = join(bed.workspace, "escape");
      symlinkSync(outside, escape);
      refused(api.assertIsolation({ envelope, readPath: join(escape, "missing", "two.json") }), "missing path through symlink", "UNSAFE");
      accepted(api.assertIsolation({ envelope, readPath: join(bed.workspace, "missing", "two.json") }), "missing path in workspace");
    } finally {
      closeBed(bed);
    }
  });

  test("proc-fd-oracle", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // /proc/self/fd/N reaches whatever a descriptor points at without naming a file, so a check
      // that only compares directory prefixes never sees it.
      refused(api.assertIsolation({ envelope, readPath: "/proc/self/fd/3" }), "proc fd", "UNSAFE");
      refused(api.assertIsolation({ envelope, readPath: "/proc/1234/fd/3" }), "other proc fd", "UNSAFE");
      refused(api.assertIsolation({ envelope, readPath: "/dev/fd/3" }), "dev fd", "UNSAFE");
      accepted(api.assertIsolation({ envelope, readPath: join(bed.workspace, "src", "app.ts") }), "ordinary descriptor-free read");
    } finally {
      closeBed(bed);
    }
  });

  test("post-run-materialization", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");
      const destination = join(bed.workspace, "..", "materialized.json");

      // A caller-minted boolean cannot demonstrate death. A zero-signal probe sees this process as
      // alive and must refuse even if the caller says it terminated.
      refused(
        api.assertIsolation({ envelope, materialize: { destination, workerTerminated: true, worker: { pid: process.pid } } }),
        "materialize while worker is alive",
        "INVALID"
      );
      assert.equal(existsSync(destination), false, REACHED);

      const exited = spawnSync(process.execPath, ["-e", ""]);
      assert.equal(typeof exited.pid, "number", REACHED);
      if (typeof exited.pid !== "number") throw new Error(REACHED);
      accepted(api.assertIsolation({ envelope, materialize: { destination, worker: { pid: exited.pid } } }), "materialize after observed death");
      // Without this the refusal above is satisfied by an implementation that never materializes
      // at all, and "not yet" cannot be told from "never".
      assert.equal(existsSync(destination), true, REACHED);
      assert.equal(readFileSync(destination, "utf8"), readFileSync(bed.oracle, "utf8"), REACHED);
    } finally {
      closeBed(bed);
    }
  });
});
