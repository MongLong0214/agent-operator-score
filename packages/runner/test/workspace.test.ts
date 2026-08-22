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

// An array carrying the right properties passes every later check that reads them by name, so
// only the plain-record guard stands between it and acceptance. A bare string is refused further
// down for being unusable, which measures a different guard -- that mistake is why the first pass
// over these guards reported them covered.
const arrayWithProperties = (properties: Record<string, unknown>): unknown => {
  const value: unknown[] = [];
  Object.assign(value, properties);
  return value;
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
  assert.equal(Object.hasOwn(record, "status"), false, CONTAINED);
  assert.equal(typeof record.event_id, "string", CONTAINED);
  assert.equal(typeof record.correlation_id, "string", CONTAINED);
  assert.equal(Object.hasOwn(record, "path"), false, CONTAINED);
  return record;
};

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
  assert.equal(event.target_path, path, CONTAINED);
  return event;
};

const writeWithoutTarget = (correlationId: string): Record<string, unknown> => {
  const event = mappedNative("sdkQuery", {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: `tool-${correlationId}`,
        name: "Write",
        input: { contents: "no target" }
      }]
    }
  }, correlationId);
  assert.equal(event.event_type, "tool.call", CONTAINED);
  assert.equal(event.target_path, null, CONTAINED);
  return event;
};

const manualEditDeclared = (path: string, correlationId: string): Record<string, unknown> => {
  const event = mappedNative("wrapper", {
    type: "human.manual_edit_declared",
    path
  }, correlationId);
  assert.equal(event.event_type, "human.manual_edit_declared", CONTAINED);
  assert.equal(event.actor, "human/takeover", CONTAINED);
  assert.equal(typeof event.payload, "string", CONTAINED);
  assert.equal(event.target_path, path, CONTAINED);
  return event;
};

const workspaceExternalMutation = (path: string, correlationId: string): Record<string, unknown> => {
  const event = mappedNative("workspace", {
    type: "workspace.external_mutation",
    path
  }, correlationId);
  assert.equal(event.event_type, "workspace.external_mutation", CONTAINED);
  assert.equal(event.actor, "external_mutation", CONTAINED);
  assert.equal(typeof event.payload, "string", CONTAINED);
  assert.equal(event.target_path, path, CONTAINED);
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

      // The environment digest must depend on key names, not only on the ordered values. The keys
      // are chosen so that sorting them yields the SAME value sequence as ENV -- runtime/suite sort
      // to "node","coding-core-v0" and so do alpha/beta -- otherwise the digests differ on ordering
      // alone and a build that dropped key names entirely would still pass this case.
      assert.deepEqual(
        Object.keys(ENV).sort().map((key) => (ENV as Record<string, string>)[key]),
        ["node", "coding-core-v0"],
        CONTAINED
      );
      const sameValuesOtherKeys = asOk(
        api.createRunWorkspace(request(temp, { environment: { alpha: "node", beta: "coding-core-v0" } })),
        "same ordered values under different keys"
      );
      assert.notEqual(sameValuesOtherKeys.environmentDigest, first.environmentDigest, CONTAINED);

      // Every caller pin in this file hands createRunWorkspace the digest it just produced, so
      // the environment comparison was never given a value it had to reject. A mismatching pin
      // must fail closed exactly like the base-digest pin above it.
      refused(
        api.createRunWorkspace(request(temp, { expectedEnvironmentDigest: "f".repeat(64) })),
        "create with a caller environment pin that disagrees"
      );

      // createRunWorkspace reads its input by property name, so an array carrying those
      // properties reaches every later check intact and is accepted once the record guard goes.
      refused(
        api.createRunWorkspace(
          arrayWithProperties({
            parentRoot: temp.parent,
            sourceRoot: temp.source,
            environment: { ...ENV },
            runId: "array-shaped-request"
          })
        ),
        "create from an array carrying the request properties"
      );

      // sealWorkspace records a manifest under the phase it is handed. An unrecognised phase
      // must be refused rather than sealed, or the manifest names a phase no contract defines.
      refused(
        api.sealWorkspace({ root: first.root, phase: "bogus" }),
        "seal under an unrecognised phase"
      );
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

      // A pin is a caller's claim about identity. Absent means no claim; present-but-unusable was
      // being collapsed into absent, so a caller that pinned the wrong type was told its pin had
      // been honoured while nothing was compared.
      for (const malformed of [7, true, {}, [], "", "short"] as unknown[]) {
        refused(
          api.createRunWorkspace(request(temp, { expectedEnvironmentDigest: malformed })),
          `create with an unusable environment pin: ${JSON.stringify(malformed)}`
        );
        refused(
          api.createRunWorkspace(request(temp, { expectedBaseDigest: malformed })),
          `create with an unusable base pin: ${JSON.stringify(malformed)}`
        );
        refused(
          api.verifyWorkspace({
            root: untouched.root,
            parentRoot: temp.parent,
            environment: { ...ENV },
            expectedEnvironmentDigest: malformed
          }),
          `verify with an unusable environment pin: ${JSON.stringify(malformed)}`
        );
      }

      // A review found the first version of this fix accepted an inherited wrong pin, because it
      // asked Object.hasOwn while every other field on the request is read through the prototype
      // chain. The old code refused these, so that was a fail-open regression, not a fix.
      {
        const inheritedCreate = Object.create({ expectedBaseDigest: "f".repeat(64) }) as Record<string, unknown>;
        inheritedCreate.parentRoot = temp.parent;
        inheritedCreate.sourceRoot = temp.source;
        inheritedCreate.environment = { ...ENV };
        refused(api.createRunWorkspace(inheritedCreate), "create with an inherited disagreeing base pin");

        const inheritedVerify = Object.create({ expectedEnvironmentDigest: "f".repeat(64) }) as Record<string, unknown>;
        inheritedVerify.root = untouched.root;
        inheritedVerify.parentRoot = temp.parent;
        inheritedVerify.environment = { ...ENV };
        refused(api.verifyWorkspace(inheritedVerify), "verify with an inherited disagreeing environment pin");
      }

      // An accessor that answers differently on two reads is not a claim about identity, it is two
      // claims. Both orders are refused: reading once accepted [correct, wrong] while the guard it
      // replaced read twice and refused it, and reading twice-then-trusting-the-last accepted
      // [wrong, correct]. The read count is pinned so neither becomes unbounded re-reading.
      for (const [label, sequence] of [
        ["first read disagrees", ["f".repeat(64), untouched.baseDigest]],
        ["second read disagrees", [untouched.baseDigest, "f".repeat(64)]]
      ] as [string, string[]][]) {
        let reads = 0;
        refused(
          api.verifyWorkspace({
            root: untouched.root,
            parentRoot: temp.parent,
            environment: { ...ENV },
            get expectedBaseDigest() {
              return sequence[Math.min(reads++, sequence.length - 1)];
            }
          }),
          `verify with an unstable pin accessor: ${label}`
        );
        assert.equal(reads, 2, CONTAINED);
      }
      {
        // The stable accessor is the control: without it a build that refuses every accessor pin
        // satisfies both refusals above.
        let reads = 0;
        accepted(
          api.verifyWorkspace({
            root: untouched.root,
            parentRoot: temp.parent,
            environment: { ...ENV },
            get expectedBaseDigest() {
              reads += 1;
              return untouched.baseDigest;
            }
          }),
          "verify with a stable correct pin accessor"
        );
        assert.equal(reads, 2, CONTAINED);
      }

      // A pin accessor that throws is not a claim that can be checked. Letting the exception escape
      // is not a fail-closed answer, and treating it as absence silently drops the caller's pin.
      // Built with defineProperty rather than through request(), whose object spread would read the
      // accessor inside the test and throw before production ever saw it.
      {
        const throwing: Record<string, unknown> = {
          parentRoot: temp.parent,
          sourceRoot: temp.source,
          environment: { ...ENV }
        };
        Object.defineProperty(throwing, "expectedBaseDigest", {
          enumerable: true,
          get() {
            throw new Error("pin accessor");
          }
        });
        refused(api.createRunWorkspace(throwing), "create with a pin accessor that throws");
      }

      // Pins are captured before any filesystem work, so caller code cannot run after the digest it
      // is checked against was computed. Previously the accessor ran after the tree was inspected,
      // and one that deleted a workspace file still verified against the cached digest.
      {
        const victim = join(untouched.root, "src", "app.ts");
        const preserved = readFileSync(victim, "utf8");
        const result = api.verifyWorkspace({
          root: untouched.root,
          parentRoot: temp.parent,
          environment: { ...ENV },
          get expectedBaseDigest() {
            rmSync(victim, { force: true });
            return untouched.baseDigest;
          }
        });
        writeFileSync(victim, preserved);
        assert.equal(result.ok, false, CONTAINED);
      }

      // The malformed loop above never reached the verify base pin, so reverting that one of the
      // four migrated guards left the whole suite green.
      for (const malformed of [7, true, {}, [], "", "short"] as unknown[]) {
        refused(
          api.verifyWorkspace({
            root: untouched.root,
            parentRoot: temp.parent,
            environment: { ...ENV },
            expectedBaseDigest: malformed
          }),
          `verify with an unusable base pin: ${JSON.stringify(malformed)}`
        );
      }

      // Pairing an accepted correct pin with a refused well-formed wrong one on the SAME entry
      // point is what stops a build that simply refuses every create pin: the first case dies if
      // pins stop working, the second dies if they stop being compared.
      accepted(
        api.createRunWorkspace(request(temp, { expectedEnvironmentDigest: clean.environmentDigest })),
        "create with a correct environment pin"
      );
      refused(
        api.createRunWorkspace(request(temp, { expectedEnvironmentDigest: "f".repeat(64) })),
        "create with a well-formed disagreeing environment pin"
      );

      // The positive half: an absent pin and an explicitly undefined one are both "no claim", and
      // a correct pin still passes. Without these the refusals above are satisfied by a build that
      // refuses every pin, which would be a broken feature rather than a closed hole.
      accepted(
        api.verifyWorkspace({
          root: untouched.root,
          parentRoot: temp.parent,
          environment: { ...ENV },
          expectedEnvironmentDigest: undefined
        }),
        "an explicitly undefined pin is no pin"
      );
      accepted(
        api.verifyWorkspace({
          root: untouched.root,
          parentRoot: temp.parent,
          environment: { ...ENV },
          expectedBaseDigest: untouched.baseDigest,
          expectedEnvironmentDigest: untouched.environmentDigest
        }),
        "correct pins still verify"
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
      // verifyWorkspace is always re-asked with the parent it was created under, so the
      // comparison against the recorded parent never had to reject anything. A workspace
      // presented under a different real parent is a wrong-root claim, not a verification.
      {
        const otherParent = mkdtempSync(join(tmpdir(), "aos-e3-001-other-"));
        try {
          refused(
            api.verifyWorkspace({
              root: created.root,
              parentRoot: otherParent,
              environment: { ...ENV }
            }),
            "verify under a parent that is not the recorded one"
          );
        } finally {
          rmSync(otherParent, { recursive: true, force: true });
        }
      }

      // Same gap on the verify side: the environment pin only ever arrived correct.
      refused(
        api.verifyWorkspace({
          root: created.root,
          parentRoot: temp.parent,
          environment: { ...ENV },
          expectedEnvironmentDigest: "f".repeat(64)
        }),
        "verify with a caller environment pin that disagrees"
      );

      // A blind review isolated these two after I reported them masked: the array helper was
      // written for createRunWorkspace and classifyWorkspaceMutation and never pointed at the
      // other two entry points, which accept a property-carrying array once their record guard
      // is removed.
      refused(
        api.verifyWorkspace(
          arrayWithProperties({ root: created.root, parentRoot: temp.parent, environment: { ...ENV } })
        ),
        "verify from an array carrying the request properties"
      );
      refused(
        api.sealWorkspace(arrayWithProperties({ root: created.root, phase: "initial" })),
        "seal from an array carrying the request properties"
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
      assert.equal(typeof agentTrace.payload, "string", CONTAINED);
      const agentBoundedTrace = writeToolCall("src/agent.ts", "corr-1800", "a".repeat(1800));
      assert.equal(typeof agentBoundedTrace.payload, "string", CONTAINED);
      const largeWriteTrace = writeToolCall("src/agent.ts", "corr-100k", "b".repeat(100 * 1024));
      assert.equal(typeof largeWriteTrace.payload, "string", CONTAINED);
      assert.equal(
        typeof largeWriteTrace.payload === "string" && largeWriteTrace.payload.length === BOUNDED_PAYLOAD_MAX_CHARS,
        true,
        CONTAINED
      );
      assert.equal(largeWriteTrace.target_path, "src/agent.ts", CONTAINED);
      const mentionTrace = writeToolCall(
        "README.txt",
        "corr-mention",
        "please inspect src/external.ts before merge\n"
      );
      assert.equal(typeof mentionTrace.payload, "string", CONTAINED);
      const absoluteTrace = writeToolCall(join(created.root, "src", "agent.ts"), "corr-abs");
      assert.equal(typeof absoluteTrace.payload, "string", CONTAINED);
      const humanTrace = manualEditDeclared("src/human.ts", "corr-human");
      const observedExternalTrace = workspaceExternalMutation("src/external.ts", "corr-external");
      const unknownAgentTrace = writeToolCall("src/unknown.ts", "corr-a");
      const unknownHumanTrace = manualEditDeclared("src/unknown.ts", "corr-b");
      const missingTargetTrace = writeWithoutTarget("corr-missing-target");

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
      accepted(agentBounded, "agent bounded payload");
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
        // SSOT 6.7:721 -- no traces is missing evidence, not an observation set this mutation
        // is absent from, so attribution cannot be determined and the score is withheld.
        const uncorrelated = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/external.ts",
          traces: []
        });
        accepted(uncorrelated, "no traces is missing evidence, not an observation set");
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
        // The 100 KiB write excerpt is still bounded, but its first-class workspace-relative
        // target sits outside that excerpt and therefore remains attributable.
        const largeWrite = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: [largeWriteTrace]
        });
        accepted(largeWrite, "large bounded payload write remains attributable");
        if (largeWrite.ok) {
          assert.equal(largeWrite.actor, "agent", CONTAINED);
          assert.notEqual(largeWrite.actor, "actor.attribution_unknown", CONTAINED);
          assert.notEqual(largeWrite.score_withheld, true, CONTAINED);
        }
      }

      {
        // SSOT 6.7:720 -- the payload is readable and names a different write target, so the
        // observation set was seen and this path is not in it. That is the uncorrelated case.
        const mentioned = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/external.ts",
          traces: [mentionTrace]
        });
        accepted(mentioned, "a readable trace naming another path leaves this one uncorrelated");
        if (mentioned.ok) assert.equal(mentioned.actor, "external_mutation", CONTAINED);
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
        // Absolute targets are outside the shared trace contract. The runner must not turn one
        // into a trusted relative path even when it happens to point inside this workspace.
        const absolute = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: [absoluteTrace]
        });
        accepted(absolute, "an absolute target fails closed");
        if (absolute.ok) {
          assert.equal(absolute.actor, "actor.attribution_unknown", CONTAINED);
          assert.equal(absolute.score_withheld, true, CONTAINED);
        }
      }

      {
        // Missing target evidence is not a license to guess from the bounded excerpt.
        const missingTarget = api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: [missingTargetTrace]
        });
        accepted(missingTarget, "a missing target fails closed");
        if (missingTarget.ok) {
          assert.equal(missingTarget.actor, "actor.attribution_unknown", CONTAINED);
          assert.equal(missingTarget.score_withheld, true, CONTAINED);
        }
      }

      // Same shape on the classifier: the properties are all present and valid, so nothing
      // downstream objects once the record guard stops looking at the container.
      refused(
        api.classifyWorkspaceMutation(
          arrayWithProperties({ root: created.root, path: "src/agent.ts", traces: [] })
        ),
        "classify from an array carrying the request properties"
      );

      // A trace that is not a record carries no correlation and no payload. Dropping it leaves a
      // non-empty observation set, and the mutation is then attributed to an external actor --
      // an unreadable trace minting evidence about who wrote the file.
      refused(
        api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: ["malformed-trace"]
        }),
        "classify against a trace that is not a record"
      );

      // traces must be a list before it can be walked; a record-shaped stand-in is not iterable
      // and reaches the walk as a thrown TypeError rather than a refusal.
      refused(
        api.classifyWorkspaceMutation({
          root: created.root,
          path: "src/agent.ts",
          traces: { 0: "malformed-trace" }
        }),
        "classify with traces that are not a list"
      );

      // A root the runner never created has no recorded base to correlate against. Without
      // this refusal the lookup returns null and the classifier reads through it, which is a
      // thrown TypeError rather than a fail-closed answer.
      {
        const unregistered = mkdtempSync(join(tmpdir(), "aos-e3-001-unregistered-"));
        try {
          refused(
            api.classifyWorkspaceMutation({ root: unregistered, path: "src/app.ts", traces: [] }),
            "classify against a root the runner never created"
          );
        } finally {
          rmSync(unregistered, { recursive: true, force: true });
        }
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
