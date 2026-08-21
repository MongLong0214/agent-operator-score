import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";

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

const correlated = (
  actor: string,
  eventType: string,
  correlationId: string,
  payload: string
): Record<string, string> => ({
  actor,
  event_type: eventType,
  correlation_id: correlationId,
  payload
});

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
      const verifiedAfterWrite = asOk(
        api.verifyWorkspace(verifyRequest(temp, first)),
        "verify create-time base after mutation"
      );
      assert.equal(verifiedAfterWrite.baseDigest, first.baseDigest, CONTAINED);

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

      refused(
        api.verifyWorkspace(verifyRequest(temp, clean, { expectedBaseDigest: "0".repeat(64) })),
        "wrong expected base digest"
      );

      writeFileSync(join(clean.root, "src", "agent.ts"), "agent write\n");
      const liveAfterWrite = api.sealWorkspace({ root: clean.root, phase: "final" });
      accepted(liveAfterWrite, "final seal after workspace write");
      if (liveAfterWrite.ok) {
        assert.notEqual(liveAfterWrite.digest, clean.baseDigest, CONTAINED);
        refused(
          api.verifyWorkspace(verifyRequest(temp, clean, { expectedBaseDigest: liveAfterWrite.digest })),
          "live tree digest is not the recorded base"
        );
      }

      const pinnedAfterWrite = asOk(
        api.verifyWorkspace(verifyRequest(temp, clean)),
        "create-time base pin after workspace write"
      );
      assert.equal(pinnedAfterWrite.baseDigest, clean.baseDigest, CONTAINED);

      const omittedPin = asOk(
        api.verifyWorkspace(verifyRequest(temp, clean, { expectedBaseDigest: undefined })),
        "omitted base pin after workspace write"
      );
      assert.equal(omittedPin.baseDigest, clean.baseDigest, CONTAINED);

      refused(
        api.verifyWorkspace(verifyRequest(temp, clean, { environment: { ...ENV, runtime: "other" } })),
        "wrong environment object after workspace write"
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
          traces: [correlated("agent", "tool.call", "corr-agent", "src/secret.txt")]
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
          traces: [correlated("agent", "tool.call", "corr-agent", "src/agent.ts")]
        }),
        "classify before mutation"
      );
      refused(
        api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/app.ts",
          traces: [correlated("agent", "tool.call", "corr-app", "src/app.ts")]
        }),
        "classify unchanged base file"
      );

      writeFileSync(join(created.root, "src", "agent.ts"), "agent write\n");
      writeFileSync(join(created.root, "src", "human.ts"), "declared human write\n");
      writeFileSync(join(created.root, "src", "external.ts"), "uncorrelated write\n");
      writeFileSync(join(created.root, "src", "unknown.ts"), "ambiguous write\n");

      const deadPath = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/agent.ts",
        traces: [{
          actor: "agent",
          event_type: "tool.call",
          correlation_id: "corr-agent",
          path: "src/agent.ts",
          provenance: "wrapper-workspace-correlation"
        }]
      });
      accepted(deadPath, "dead path field is not correlation");
      if (deadPath.ok) {
        assert.equal(deadPath.actor, "external_mutation", CONTAINED);
        assert.equal(deadPath.event_type, "workspace.external_mutation", CONTAINED);
      }

      const missingCorrelation = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/agent.ts",
        traces: [{
          actor: "agent",
          event_type: "tool.call",
          payload: "src/agent.ts"
        }]
      });
      accepted(missingCorrelation, "payload without correlation_id");
      if (missingCorrelation.ok) {
        assert.equal(missingCorrelation.actor, "external_mutation", CONTAINED);
      }

      const agent = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/agent.ts",
        traces: [correlated("agent", "tool.call", "corr-agent", "src/agent.ts")]
      });
      accepted(agent, "agent");
      if (agent.ok) {
        assert.equal(agent.actor, "agent", CONTAINED);
        assert.equal(agent.path, "src/agent.ts", CONTAINED);
        assert.notEqual(agent.actor, "external_mutation", CONTAINED);
        assert.notEqual(agent.event_type, "workspace.external_mutation", CONTAINED);
        assert.notEqual(agent.actor, "actor.attribution_unknown", CONTAINED);
      }

      const human = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/human.ts",
        traces: [correlated("human/takeover", "human.manual_edit_declared", "corr-human", "src/human.ts")]
      });
      accepted(human, "human");
      if (human.ok) {
        assert.equal(human.actor, "human/takeover", CONTAINED);
        assert.equal(human.event_type, "human.manual_edit_declared", CONTAINED);
        assert.equal(human.path, "src/human.ts", CONTAINED);
      }

      const external = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/external.ts",
        traces: []
      });
      accepted(external, "external");
      if (external.ok) {
        assert.equal(external.actor, "external_mutation", CONTAINED);
        assert.equal(external.event_type, "workspace.external_mutation", CONTAINED);
        assert.equal(external.provenance, "runner-workspace-correlation", CONTAINED);
        assert.equal(external.path, "src/external.ts", CONTAINED);
      }

      const unknown = api.classifyWorkspaceMutation({
        root: created.root,
        path: "src/unknown.ts",
        traces: [
          correlated("agent", "tool.call", "corr-a", "src/unknown.ts"),
          correlated("human/takeover", "human.manual_edit_declared", "corr-b", "src/unknown.ts")
        ]
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
