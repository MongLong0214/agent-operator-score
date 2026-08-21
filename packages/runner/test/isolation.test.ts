import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, test } from "node:test";

// Namespace/dynamic import: a missing module or named export must stay undefined so each case
// fails with its pinned message. A static named import would be a module-load error, which the
// RED contract treats as an unrelated stop.
const REACHED =
  "worker can reach an oracle file, environment canary, inherited descriptor, temporary location, symlink, /proc file descriptor, or a post-run oracle before termination.";

const CANARY = "AOS_ORACLE_CANARY";
const SECRET_ENV = "AOS_ORACLE_SECRET";

type Fail = { ok: false; reason: string; classification: "INVALID" | "UNSAFE" };
type EnvelopeOk = {
  ok: true;
  env: Record<string, string>;
  cwd: string;
  stdio: unknown[];
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
    return await import("../src/isolation.ts");
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
  env: { PATH: process.env.PATH ?? "/usr/bin", [SECRET_ENV]: CANARY },
  ...extra
});

const accepted = (result: { ok: boolean; reason?: string }, label: string): void => {
  assert.equal(result.ok, true, `${REACHED} (${label}${result.ok ? "" : `: ${result.reason ?? ""}`})`);
};

const refused = (result: AssertResult | EnvelopeResult, label: string, classification?: "INVALID" | "UNSAFE"): void => {
  assert.equal(result.ok, false, `${REACHED} (${label})`);
  if (result.ok) return;
  assert.equal(result.reason, REACHED, `${REACHED} (${label})`);
  // Every violation is classified; a refusal with no classification is not a terminal state.
  assert.equal(
    result.classification === "INVALID" || result.classification === "UNSAFE",
    true,
    `${REACHED} (${label} classification)`
  );
  if (classification) assert.equal(result.classification, classification, `${REACHED} (${label} classification)`);
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
      for (const [name, value] of Object.entries(envelope.env)) {
        assert.equal(value.includes(CANARY), false, `${REACHED} (${name})`);
      }
      refused(api.assertIsolation({ envelope, env: { ...envelope.env, [SECRET_ENV]: CANARY } }), "canary re-added", "UNSAFE");
      refused(api.assertIsolation({ envelope, env: { ...envelope.env, RENAMED: CANARY } }), "canary under another name", "UNSAFE");
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
      refused(api.assertIsolation({ envelope, ipcMessage: { nested: { deep: [CANARY] } } }), "canary nested in an IPC message", "UNSAFE");
      accepted(api.assertIsolation({ envelope, ipcMessage: { status: "running" } }), "ordinary IPC message");
    } finally {
      closeBed(bed);
    }
  });

  test("child-inherit", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // A child spawned by the worker inherits the worker's envelope, so the same denials apply
      // one level down; otherwise isolation ends at the first process boundary.
      refused(api.assertIsolation({ envelope, child: { env: { [SECRET_ENV]: CANARY } } }), "child carries the canary", "UNSAFE");
      refused(api.assertIsolation({ envelope, child: { readPath: bed.oracle } }), "child reads the oracle", "UNSAFE");
      refused(api.assertIsolation({ envelope, child: { stdio: ["inherit"] } }), "child inherits a descriptor", "UNSAFE");
      accepted(api.assertIsolation({ envelope, child: { env: { PATH: envelope.env.PATH } } }), "ordinary child");
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
      refused(api.assertIsolation({ envelope, readPath: join(tmpdir(), "anything.json") }), "system temp is not allowed", "UNSAFE");
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
      refused(api.assertIsolation({ envelope, readPath: link }), "symlink to the oracle", "UNSAFE");

      const dirLink = join(bed.workspace, "peek");
      symlinkSync(join(bed.root, "oracle"), dirLink);
      refused(api.assertIsolation({ envelope, readPath: join(dirLink, "expected.json") }), "symlinked directory", "UNSAFE");
    } finally {
      closeBed(bed);
    }
  });

  test("proc-fd-oracle", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // /proc/self/fd/N reaches whatever a descriptor points at without naming a path, so a check
      // that only compares path prefixes never sees it.
      refused(api.assertIsolation({ envelope, readPath: "/proc/self/fd/3" }), "proc fd", "UNSAFE");
      refused(api.assertIsolation({ envelope, readPath: "/proc/1234/fd/3" }), "another process fd", "UNSAFE");
      refused(api.assertIsolation({ envelope, readPath: "/dev/fd/3" }), "dev fd", "UNSAFE");
    } finally {
      closeBed(bed);
    }
  });

  test("post-run-materialization", async () => {
    const api = await requireExports();
    const bed = openBed();
    try {
      const envelope = asOk(api.buildWorkerEnvelope(request(bed)), "envelope");

      // The oracle is materialized only after the worker has terminated. While it is running the
      // destination must not exist, and materializing early is a violation rather than a race.
      const destination = join(bed.workspace, "..", "materialized.json");
      refused(
        api.assertIsolation({ envelope, materialize: { destination, workerTerminated: false } }),
        "materialize while the worker runs",
        "INVALID"
      );
      assert.equal(existsSync(destination), false, REACHED);

      accepted(
        api.assertIsolation({ envelope, materialize: { destination, workerTerminated: true } }),
        "materialize after termination"
      );
      // Without this the refusal above is satisfied by an implementation that never materializes
      // at all, and "not yet" cannot be told from "never".
      assert.equal(existsSync(destination), true, REACHED);
      assert.equal(readFileSync(destination, "utf8"), readFileSync(bed.oracle, "utf8"), REACHED);
    } finally {
      closeBed(bed);
    }
  });
});
