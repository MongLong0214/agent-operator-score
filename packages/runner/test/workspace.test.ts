import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { normalizeClaudeEvent } from "../../../adapters/claude-code/src/normalize.ts";
import { BOUNDED_PAYLOAD_MAX_CHARS } from "../../../adapters/claude-code/src/redact.ts";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const CONTAINED = "dirty/wrong-root/symlink/cross-run residue is not contained.";

const DIGEST = /^[a-f0-9]{64}$/;
const ENV = { runtime: "node", suite: "coding-core-v0" };
const SOURCE_README = "allowed source\n";
const SOURCE_APP = "export const n = 1;\n";

type WorkspaceOk = {
  ok: true;
  root: string;
  runId: string;
  baseDigest: string;
  environmentDigest: string;
};
type WorkspaceFail = { ok: false; reason: string };
type WorkspaceResult = WorkspaceOk | WorkspaceFail;
type SealResult =
  | {
      ok: true;
      phase: "initial" | "final";
      digest: string;
      files: { path: string; digest: string }[];
    }
  | WorkspaceFail;
type Classification =
  | {
      ok: true;
      actor: string;
      event_type: string;
      provenance: string;
      path: string;
      confidence?: number;
      score_withheld?: boolean;
    }
  | WorkspaceFail;
type WorkspaceApi = {
  createRunWorkspace: (input: unknown) => WorkspaceResult;
  verifyWorkspace: (input: unknown) => WorkspaceResult;
  sealWorkspace: (input: unknown) => SealResult;
  classifyWorkspaceMutation: (input: unknown) => Classification;
};

const loadWorkspace = async () => {
  try {
    return await import("../src/workspace.ts");
  } catch {
    return {};
  }
};

const requireExports = async (): Promise<WorkspaceApi> => {
  const mod = await loadWorkspace();
  assert.equal(typeof mod.createRunWorkspace, "function", CONTAINED);
  assert.equal(typeof mod.verifyWorkspace, "function", CONTAINED);
  assert.equal(typeof mod.sealWorkspace, "function", CONTAINED);
  assert.equal(typeof mod.classifyWorkspaceMutation, "function", CONTAINED);
  return mod as WorkspaceApi;
};

type Temp = { parent: string; source: string };

const openTemp = (): Temp => {
  const parent = mkdtempSync(join(tmpdir(), "aos-e3-001-"));
  const source = join(parent, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  writeFileSync(join(source, "README.txt"), SOURCE_README);
  writeFileSync(join(source, "src", "app.ts"), SOURCE_APP);
  return { parent, source };
};

const closeTemp = (temp: Temp) => {
  rmSync(temp.parent, { recursive: true, force: true });
};

const request = (temp: Temp, extra: Record<string, unknown> = {}) => ({
  parentRoot: temp.parent,
  sourceRoot: temp.source,
  environment: { ...ENV },
  ...extra
});

const STAMP = "2026-08-21T00:00:00.000Z";

const mappedNative = (
  source: string,
  native: Record<string, unknown>,
  correlationId: string
): Record<string, unknown> => {
  const event = normalizeClaudeEvent({
    source,
    native,
    run_id: "run-e3-001",
    task_id: "task-e3-001",
    correlation_id: correlationId,
    identity: "claude-code|unknown|unknown",
    timestamp: STAMP,
    parent_id: null
  });
  assert.equal(event !== null && typeof event === "object" && !Array.isArray(event), true, CONTAINED);
  const record = event as Record<string, unknown>;
  assert.equal(record.status, "MAPPED", CONTAINED);
  assert.equal(typeof record.correlation_id, "string", CONTAINED);
  assert.equal(Object.hasOwn(record, "path"), false, CONTAINED);
  return record;
};

const isPlainPayload = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const writeToolCall = (
  path: string,
  correlationId: string,
  contents?: string
): Record<string, unknown> => {
  const input: Record<string, unknown> = contents === undefined ? { path } : { path, contents };
  const event = mappedNative("sdkQuery", {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: `tool-${correlationId}`,
        name: "Write",
        input
      }]
    }
  }, correlationId);
  assert.equal(event.event_type, "tool.call", CONTAINED);
  assert.equal(event.actor, "agent", CONTAINED);
  return event;
};

const manualEditDeclared = (path: string, correlationId: string): Record<string, unknown> => {
  const event = mappedNative("wrapper", {
    type: "human.manual_edit_declared",
    path
  }, correlationId);
  assert.equal(event.event_type, "human.manual_edit_declared", CONTAINED);
  assert.equal(event.actor, "human/takeover", CONTAINED);
  assert.equal(isPlainPayload(event.payload), true, CONTAINED);
  return event;
};

const workspaceExternalMutation = (path: string, correlationId: string): Record<string, unknown> => {
  const event = mappedNative("workspace", {
    type: "workspace.external_mutation",
    path
  }, correlationId);
  assert.equal(event.event_type, "workspace.external_mutation", CONTAINED);
  assert.equal(event.actor, "external_mutation", CONTAINED);
  assert.equal(isPlainPayload(event.payload), true, CONTAINED);
  return event;
};

const verifyRequest = (temp: Temp, created: WorkspaceOk, extra: Record<string, unknown> = {}) => ({
  root: created.root,
  parentRoot: temp.parent,
  expectedBaseDigest: created.baseDigest,
  expectedEnvironmentDigest: created.environmentDigest,
  environment: { ...ENV },
  ...extra
});

const snapshotTree = (root: string): Record<string, string> => {
  const files: Record<string, string> = {};
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      files[relative(root, absolute).replaceAll("\\", "/")] = readFileSync(absolute, "utf8");
    }
  };
  walk(root);
  return files;
};

const inside = (parent: string, child: string): boolean => {
  const rel = relative(realpathSync(parent), realpathSync(child));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

const accepted = (result: { ok: boolean; reason?: string }, label: string): void => {
  assert.equal(result.ok, true, `${CONTAINED} (${label}${result.ok ? "" : `: ${result.reason ?? ""}`})`);
};

const refused = (result: { ok: boolean; reason?: string }, label: string): void => {
  assert.equal(result.ok, false, `${CONTAINED} (${label})`);
  assert.equal(result.reason, CONTAINED, `${CONTAINED} (${label})`);
};

const asOk = (result: WorkspaceResult, label: string): WorkspaceOk => {
  accepted(result, label);
  assert.equal(typeof result.root, "string", `${CONTAINED} (${label} root)`);
  assert.equal(typeof result.runId, "string", `${CONTAINED} (${label} runId)`);
  assert.match(result.baseDigest, DIGEST, `${CONTAINED} (${label} baseDigest)`);
  assert.match(result.environmentDigest, DIGEST, `${CONTAINED} (${label} environmentDigest)`);
  return result;
};

describe("workspace", () => {
  test("fresh", async () => {
    const api = await requireExports();
    const temp = openTemp();
    try {
      const first = asOk(api.createRunWorkspace(request(temp)), "first create");
      const second = asOk(api.createRunWorkspace(request(temp)), "second create");

      assert.notEqual(first.root, second.root, CONTAINED);
      assert.notEqual(first.runId, second.runId, CONTAINED);
      assert.equal(inside(temp.parent, first.root), true, CONTAINED);
      assert.equal(inside(temp.parent, second.root), true, CONTAINED);
      assert.notEqual(realpathSync(first.root), realpathSync(process.cwd()), CONTAINED);
      assert.equal(first.baseDigest, second.baseDigest, CONTAINED);
      assert.equal(first.environmentDigest, second.environmentDigest, CONTAINED);

      assert.equal(readFileSync(join(first.root, "README.txt"), "utf8"), SOURCE_README, CONTAINED);
      assert.equal(readFileSync(join(first.root, "src", "app.ts"), "utf8"), SOURCE_APP, CONTAINED);

      const verified = api.verifyWorkspace({
        root: first.root,
        parentRoot: temp.parent,
        expectedBaseDigest: first.baseDigest,
        expectedEnvironmentDigest: first.environmentDigest,
        environment: { ...ENV }
      });
      accepted(verified, "verify fresh");

      const initial = api.sealWorkspace({ root: first.root, phase: "initial" });
      accepted(initial, "initial seal");
      assert.equal(initial.ok, true, CONTAINED);
      if (initial.ok) {
        assert.equal(initial.phase, "initial", CONTAINED);
        assert.match(initial.digest, DIGEST, CONTAINED);
        assert.equal(initial.digest, first.baseDigest, CONTAINED);
        const paths = initial.files.map((file) => file.path).sort();
        assert.ok(paths.includes("README.txt"), CONTAINED);
        assert.ok(paths.includes("src/app.ts"), CONTAINED);
        for (const file of initial.files) assert.match(file.digest, DIGEST, CONTAINED);
      }

      const final = api.sealWorkspace({ root: first.root, phase: "final" });
      accepted(final, "final seal unchanged");
      if (initial.ok && final.ok) {
        assert.equal(final.phase, "final", CONTAINED);
        assert.equal(final.digest, initial.digest, CONTAINED);
        assert.equal(final.digest, first.baseDigest, CONTAINED);
      }

      writeFileSync(join(first.root, "README.txt"), "mutated after initial seal\n");
      refused(api.sealWorkspace({ root: first.root, phase: "initial" }), "initial seal after mutation");
      const finalMutated = api.sealWorkspace({ root: first.root, phase: "final" });
      accepted(finalMutated, "final seal after mutation");
      if (finalMutated.ok) {
        assert.notEqual(finalMutated.digest, first.baseDigest, CONTAINED);
      }
      refused(
        api.verifyWorkspace({
          root: first.root,
          parentRoot: temp.parent,
          environment: { ...ENV }
        }),
        "verify after mutation with no caller pin"
      );
      refused(
        api.verifyWorkspace(verifyRequest(temp, first)),
        "verify after mutation with create-time pin"
      );

      const otherEnv = asOk(
        api.createRunWorkspace(request(temp, { environment: { ...ENV, runtime: "other" } })),
        "other environment"
      );
      assert.notEqual(otherEnv.environmentDigest, first.environmentDigest, CONTAINED);
      assert.equal(otherEnv.baseDigest, first.baseDigest, CONTAINED);
    } finally {
      closeTemp(temp);
    }
  });

  test("dirty-base", async () => {
    const api = await requireExports();
    const temp = openTemp();
    try {
      const clean = asOk(api.createRunWorkspace(request(temp)), "clean create");
      writeFileSync(join(temp.source, "README.txt"), "tampered base\n");
      refused(
        api.createRunWorkspace(request(temp, { expectedBaseDigest: clean.baseDigest })),
        "dirty source"
      );

      writeFileSync(join(temp.source, "README.txt"), SOURCE_README);
      const restored = asOk(
        api.createRunWorkspace(request(temp, { expectedBaseDigest: clean.baseDigest })),
        "restored source"
      );
      assert.equal(restored.baseDigest, clean.baseDigest, CONTAINED);
      assert.notEqual(restored.root, clean.root, CONTAINED);

      writeFileSync(join(clean.root, "README.txt"), "replaced readme\n");
      writeFileSync(join(clean.root, "src", "app.ts"), "replaced app\n");
      refused(
        api.verifyWorkspace({
          root: clean.root,
          parentRoot: temp.parent,
          environment: { ...ENV }
        }),
        "replaced tree with no caller pin"
      );
      refused(
        api.verifyWorkspace(verifyRequest(temp, clean)),
        "replaced tree with create-time pin"
      );

      const untouched = asOk(api.createRunWorkspace(request(temp)), "untouched create");
      const noPin = asOk(
        api.verifyWorkspace({
          root: untouched.root,
          parentRoot: temp.parent,
          environment: { ...ENV }
        }),
        "untouched tree with no caller pin"
      );
      assert.equal(noPin.baseDigest, untouched.baseDigest, CONTAINED);

      refused(
        api.verifyWorkspace(verifyRequest(temp, untouched, { expectedBaseDigest: "0".repeat(64) })),
        "caller pin disagrees with valid workspace"
      );

      refused(
        api.verifyWorkspace({
          root: untouched.root,
          parentRoot: temp.parent,
          environment: { ...ENV, runtime: "other" }
        }),
        "wrong environment object on valid workspace"
      );
    } finally {
      closeTemp(temp);
    }
  });

  test("wrong-root", async () => {
    const api = await requireExports();
    const temp = openTemp();
    const cwd = process.cwd();
    try {
      const created = asOk(api.createRunWorkspace(request(temp)), "create");
      assert.equal(process.cwd(), cwd, CONTAINED);

      refused(api.createRunWorkspace(request(temp, { parentRoot: cwd })), "implicit cwd parent");
      refused(
        api.createRunWorkspace(request(temp, { parentRoot: "relative-parent" })),
        "relative parent"
      );
      refused(api.createRunWorkspace({ sourceRoot: temp.source, environment: { ...ENV } }), "omitted parent");
      refused(
        api.verifyWorkspace({
          root: cwd,
          parentRoot: temp.parent,
          expectedBaseDigest: created.baseDigest,
          expectedEnvironmentDigest: created.environmentDigest,
          environment: { ...ENV }
        }),
        "verify cwd"
      );
      refused(
        api.verifyWorkspace({
          root: temp.source,
          parentRoot: temp.parent,
          expectedBaseDigest: created.baseDigest,
          expectedEnvironmentDigest: created.environmentDigest,
          environment: { ...ENV }
        }),
        "verify source as run root"
      );
      refused(api.sealWorkspace({ root: cwd, phase: "initial" }), "seal cwd");
      refused(api.sealWorkspace({ root: temp.source, phase: "initial" }), "seal source");

      const verified = api.verifyWorkspace({
        root: created.root,
        parentRoot: temp.parent,
        expectedBaseDigest: created.baseDigest,
        expectedEnvironmentDigest: created.environmentDigest,
        environment: { ...ENV }
      });
      accepted(verified, "verify explicit root");
      assert.equal(process.cwd(), cwd, CONTAINED);
    } finally {
      closeTemp(temp);
    }
  });

  test("symlink-escape", async () => {
    const api = await requireExports();
    const temp = openTemp();
    try {
      const outside = join(temp.parent, "outside-secret.txt");
      writeFileSync(outside, "secret-must-not-enter-workspace\n");
      symlinkSync(outside, join(temp.source, "escaped.txt"));
      refused(api.createRunWorkspace(request(temp)), "source symlink escape");
      assert.equal(readFileSync(outside, "utf8"), "secret-must-not-enter-workspace\n", CONTAINED);

      rmSync(join(temp.source, "escaped.txt"));
      const created = asOk(api.createRunWorkspace(request(temp)), "create without symlink");
      symlinkSync(outside, join(created.root, "escaped.txt"));
      refused(
        api.verifyWorkspace({
          root: created.root,
          parentRoot: temp.parent,
          expectedBaseDigest: created.baseDigest,
          expectedEnvironmentDigest: created.environmentDigest,
          environment: { ...ENV }
        }),
        "workspace symlink escape"
      );
      refused(api.sealWorkspace({ root: created.root, phase: "final" }), "seal symlink escape");
      refused(
        api.classifyWorkspaceMutation({
          root: created.root,
          path: "escaped.txt",
          traces: []
        }),
        "classify symlink escape"
      );
      assert.equal(readFileSync(outside, "utf8"), "secret-must-not-enter-workspace\n", CONTAINED);

      const createdDir = asOk(api.createRunWorkspace(request(temp)), "create for directory symlink");
      const outsideDir = join(temp.parent, "outside-dir");
      mkdirSync(outsideDir);
      writeFileSync(join(outsideDir, "secret.txt"), "secret-must-not-enter-workspace\n");
      rmSync(join(createdDir.root, "src"), { recursive: true, force: true });
      symlinkSync(outsideDir, join(createdDir.root, "src"));
      refused(
        api.verifyWorkspace(verifyRequest(temp, createdDir)),
        "workspace directory symlink escape"
      );
      refused(api.sealWorkspace({ root: createdDir.root, phase: "final" }), "seal directory symlink escape");
      refused(
        api.classifyWorkspaceMutation({
          root: createdDir.root,
          path: "src/secret.txt",
          traces: [writeToolCall("src/secret.txt", "corr-symlink")]
        }),
        "classify directory symlink escape"
      );
      assert.equal(readFileSync(join(outsideDir, "secret.txt"), "utf8"), "secret-must-not-enter-workspace\n", CONTAINED);
    } finally {
      closeTemp(temp);
    }
  });

  test("source-mutation", async () => {
    const api = await requireExports();
    const temp = openTemp();
    try {
      const before = snapshotTree(temp.source);
      const created = asOk(api.createRunWorkspace(request(temp)), "create");
      writeFileSync(join(created.root, "README.txt"), "mutated in the run root\n");
      api.sealWorkspace({ root: created.root, phase: "final" });
      assert.deepEqual(snapshotTree(temp.source), before, CONTAINED);
      assert.equal(readFileSync(join(temp.source, "README.txt"), "utf8"), SOURCE_README, CONTAINED);
      assert.equal(readFileSync(join(temp.source, "src", "app.ts"), "utf8"), SOURCE_APP, CONTAINED);
      assert.equal(statSync(temp.source).isDirectory(), true, CONTAINED);

      const nestedParent = join(temp.source, "runs");
      mkdirSync(nestedParent);
      const sourceBeforeNested = snapshotTree(temp.source);
      let nestedCreate: WorkspaceResult | { ok: true };
      try {
        nestedCreate = api.createRunWorkspace({
          parentRoot: nestedParent,
          sourceRoot: temp.source,
          environment: { ...ENV }
        });
      } catch {
        nestedCreate = { ok: true };
      }
      refused(nestedCreate, "parent inside source");
      assert.deepEqual(snapshotTree(temp.source), sourceBeforeNested, CONTAINED);
      assert.deepEqual(readdirSync(nestedParent), [], CONTAINED);
    } finally {
      closeTemp(temp);
    }
  });

  test("residue", async () => {
    const api = await requireExports();
    const temp = openTemp();
    try {
      const parentBefore = readdirSync(temp.parent).sort();
      const first = asOk(api.createRunWorkspace(request(temp, { runId: "run-one" })), "first run");
      writeFileSync(join(first.root, "run-one-only.txt"), "residue from run one\n");

      refused(api.createRunWorkspace(request(temp, { runId: "run-one" })), "reused run id");

      const second = asOk(api.createRunWorkspace(request(temp, { runId: "run-two" })), "second run");
      assert.notEqual(second.root, first.root, CONTAINED);
      assert.equal(readdirSync(second.root).includes("run-one-only.txt"), false, CONTAINED);
      assert.equal(readFileSync(join(first.root, "run-one-only.txt"), "utf8"), "residue from run one\n", CONTAINED);
      assert.deepEqual(snapshotTree(temp.source), {
        "README.txt": SOURCE_README,
        "src/app.ts": SOURCE_APP
      }, CONTAINED);

      const parentAfter = readdirSync(temp.parent).sort();
      for (const name of parentBefore) assert.ok(parentAfter.includes(name), CONTAINED);
      assert.equal(parentAfter.includes("source"), true, CONTAINED);
      const added = parentAfter.filter((name) => !parentBefore.includes(name));
      for (const name of added) {
        assert.equal(inside(temp.parent, join(temp.parent, name)), true, CONTAINED);
        assert.notEqual(resolve(temp.parent, name), resolve(temp.source), CONTAINED);
      }
    } finally {
      closeTemp(temp);
    }
  });

  test("actor-attribution-classification", async () => {
    const api = await requireExports();
    const temp = openTemp();
    try {
      const created = asOk(api.createRunWorkspace(request(temp)), "create");
      accepted(api.sealWorkspace({ root: created.root, phase: "initial" }), "initial seal");

      refused(
        api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: [writeToolCall("src/agent.ts", "corr-agent")]
        }),
        "classify before mutation"
      );
      refused(
        api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/app.ts",
          traces: [writeToolCall("src/app.ts", "corr-app")]
        }),
        "classify unchanged base file"
      );

      writeFileSync(join(created.root, "src", "agent.ts"), "agent write\n");
      writeFileSync(join(created.root, "src", "human.ts"), "declared human write\n");
      writeFileSync(join(created.root, "src", "external.ts"), "observed external write\n");
      writeFileSync(join(created.root, "src", "unknown.ts"), "ambiguous write\n");
      writeFileSync(join(created.root, "README.txt"), "please inspect src/external.ts before merge\n");

      const agentTrace = writeToolCall("src/agent.ts", "corr-agent");
      assert.equal(isPlainPayload(agentTrace.payload), true, CONTAINED);
      const agentBoundedTrace = writeToolCall("src/agent.ts", "corr-1800", "a".repeat(1800));
      assert.equal(isPlainPayload(agentBoundedTrace.payload), true, CONTAINED);
      const truncatedTrace = writeToolCall("src/agent.ts", "corr-2500", "b".repeat(2500));
      assert.equal(typeof truncatedTrace.payload, "string", CONTAINED);
      assert.equal(
        typeof truncatedTrace.payload === "string" && truncatedTrace.payload.length === BOUNDED_PAYLOAD_MAX_CHARS,
        true,
        CONTAINED
      );
      const mentionTrace = writeToolCall(
        "README.txt",
        "corr-mention",
        "please inspect src/external.ts before merge\n"
      );
      assert.equal(isPlainPayload(mentionTrace.payload), true, CONTAINED);
      const absoluteTrace = writeToolCall(join(created.root, "src", "agent.ts"), "corr-abs");
      assert.equal(isPlainPayload(absoluteTrace.payload), true, CONTAINED);
      const humanTrace = manualEditDeclared("src/human.ts", "corr-human");
      const observedExternalTrace = workspaceExternalMutation("src/external.ts", "corr-external");
      const unknownAgentTrace = writeToolCall("src/unknown.ts", "corr-a");
      const unknownHumanTrace = manualEditDeclared("src/unknown.ts", "corr-b");

      const agent = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/agent.ts",
        traces: [agentTrace]
      });
      accepted(agent, "agent");
      if (agent.ok) {
        assert.equal(agent.actor, "agent", CONTAINED);
        assert.equal(agent.path, "src/agent.ts", CONTAINED);
        assert.notEqual(agent.actor, "external_mutation", CONTAINED);
        assert.notEqual(agent.event_type, "workspace.external_mutation", CONTAINED);
        assert.notEqual(agent.actor, "actor.attribution_unknown", CONTAINED);
      }

      const agentBounded = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/agent.ts",
        traces: [agentBoundedTrace]
      });
      accepted(agentBounded, "agent bounded object payload");
      if (agentBounded.ok) {
        assert.equal(agentBounded.actor, "agent", CONTAINED);
        assert.notEqual(agentBounded.actor, "external_mutation", CONTAINED);
      }

      const human = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/human.ts",
        traces: [humanTrace]
      });
      accepted(human, "human");
      if (human.ok) {
        assert.equal(human.actor, "human/takeover", CONTAINED);
        assert.equal(human.event_type, "human.manual_edit_declared", CONTAINED);
        assert.equal(human.path, "src/human.ts", CONTAINED);
      }

      {
        // SSOT 6.7 and this ticket's acceptance line allow external_mutation or explicit
        // unknown for an uncorrelated mutation. Empty traces are not evidence of an external
        // actor, so the answer is explicit unknown with the score withheld -- not a refusal,
        // which neither document sanctions.
        const uncorrelated = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/external.ts",
          traces: []
        });
        accepted(uncorrelated, "empty traces classify as explicit unknown");
        if (uncorrelated.ok) {
          assert.equal(uncorrelated.actor, "actor.attribution_unknown", CONTAINED);
          assert.equal(uncorrelated.score_withheld, true, CONTAINED);
        }
      }

      const external = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/external.ts",
        traces: [observedExternalTrace]
      });
      accepted(external, "observed external");
      if (external.ok) {
        assert.equal(external.actor, "external_mutation", CONTAINED);
        assert.equal(external.event_type, "workspace.external_mutation", CONTAINED);
        assert.equal(external.provenance, "runner-workspace-correlation", CONTAINED);
        assert.equal(external.path, "src/external.ts", CONTAINED);
      }

      {
        // The production shape: a source write past the 2048-character payload bound is
        // serialized and sliced, so the path is no longer recoverable. That is a correlation
        // failure, not evidence of an external actor -- explicit unknown, score withheld.
        const truncated = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: [truncatedTrace]
        });
        accepted(truncated, "truncated payload write classifies as explicit unknown");
        if (truncated.ok) {
          assert.equal(truncated.actor, "actor.attribution_unknown", CONTAINED);
          assert.equal(truncated.score_withheld, true, CONTAINED);
        }
      }

      {
        // A path appearing inside file contents is not the write target, so this does not
        // correlate. Explicit unknown, not a claim that some external actor did it.
        const mentioned = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/external.ts",
          traces: [mentionTrace]
        });
        accepted(mentioned, "a path in file contents classifies as explicit unknown");
        if (mentioned.ok) assert.equal(mentioned.actor, "actor.attribution_unknown", CONTAINED);
      }

      const readme = api.classifyWorkspaceMutation({
        root: created.root,
        path: "README.txt",
        traces: [mentionTrace]
      });
      accepted(readme, "named input.path on object payload");
      if (readme.ok) {
        assert.equal(readme.actor, "agent", CONTAINED);
        assert.equal(readme.path, "README.txt", CONTAINED);
      }

      {
        // An absolute path is not the classified relative path; correlation fails.
        const absolute = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: [absoluteTrace]
        });
        accepted(absolute, "an absolute input.path classifies as explicit unknown");
        if (absolute.ok) assert.equal(absolute.actor, "actor.attribution_unknown", CONTAINED);
      }

      const unknown = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/unknown.ts",
        traces: [unknownAgentTrace, unknownHumanTrace]
      });
      accepted(unknown, "unknown");
      if (unknown.ok) {
        assert.equal(unknown.actor, "actor.attribution_unknown", CONTAINED);
        assert.equal(unknown.event_type, "actor.attribution_unknown", CONTAINED);
        assert.equal(typeof unknown.confidence, "number", CONTAINED);
        assert.equal(
          typeof unknown.confidence === "number" && unknown.confidence < 0.7,
          true,
          CONTAINED
        );
        assert.equal(unknown.score_withheld, true, CONTAINED);
      }

      if (agent.ok && human.ok && external.ok && unknown.ok) {
        const actors = [agent.actor, human.actor, external.actor, unknown.actor];
        assert.equal(new Set(actors).size, 4, CONTAINED);
      }

      refused(
        api.classifyWorkspaceMutation({
          root: created.root,
          path: "../outside.txt",
          traces: []
        }),
        "classify path escape"
      );
    } finally {
      closeTemp(temp);
    }
  });
});
