import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";

const BLOCKING = "report can cite missing or wrong-digest artifacts.";
const ARTIFACT_BODY = "metric evidence: verified outcome\n";
const ARTIFACT_DIGEST = createHash("sha256").update(ARTIFACT_BODY).digest("hex");
const STALE_DIGEST = "f".repeat(64);
const SECRET = "e10-secret-canary-value";

type Json = Record<string, unknown>;

type EvidenceApi = {
  resolveEvidenceChain: (input: unknown) => unknown;
  assertContainedEvidencePath: (evidenceRoot: unknown, candidate: unknown) => string;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const loadEvidence = async (): Promise<Partial<EvidenceApi>> => {
  try {
    return await import("../src/reporter/evidence-resolver.ts") as Partial<EvidenceApi>;
  } catch {
    return {};
  }
};

const loadPathPolicy = async (): Promise<Partial<EvidenceApi>> => {
  try {
    return await import("../src/reporter/path-policy.ts") as Partial<EvidenceApi>;
  } catch {
    return {};
  }
};

const requireEvidence = async (): Promise<EvidenceApi> => {
  const [evidence, pathPolicy] = await Promise.all([loadEvidence(), loadPathPolicy()]);
  assert.equal(typeof evidence.resolveEvidenceChain, "function", BLOCKING);
  assert.equal(typeof pathPolicy.assertContainedEvidencePath, "function", BLOCKING);
  return {
    resolveEvidenceChain: evidence.resolveEvidenceChain as (input: unknown) => unknown,
    assertContainedEvidencePath: pathPolicy.assertContainedEvidencePath as (evidenceRoot: unknown, candidate: unknown) => string
  };
};

const refuses = (call: () => unknown): void => {
  assert.throws(call, { message: BLOCKING }, BLOCKING);
};

const withEvidenceRoot = (run: (root: string, outside: string) => void): void => {
  const temporary = mkdtempSync(resolve(tmpdir(), "aos-e10-002-"));
  try {
    const root = resolve(temporary, "evidence");
    const outside = resolve(temporary, "outside");
    mkdirSync(resolve(root, "reports"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(resolve(root, "reports", "artifact.txt"), ARTIFACT_BODY, "utf8");
    writeFileSync(resolve(root, "C:artifact.txt"), ARTIFACT_BODY, "utf8");
    writeFileSync(resolve(root, "reports\\artifact.txt"), ARTIFACT_BODY, "utf8");
    writeFileSync(resolve(outside, "artifact.txt"), ARTIFACT_BODY, "utf8");
    run(root, outside);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};

const validChain = (root: string, extra: Json = {}): Json => ({
  run_id: "run-a",
  evidence_root: root,
  metric: {
    metric_id: "M15",
    run_id: "run-a",
    opportunity_id: "opp-a"
  },
  opportunities: [{
    opportunity_id: "opp-a",
    run_id: "run-a",
    event_id: "event-a"
  }],
  events: [{
    event_id: "event-a",
    run_id: "run-a",
    artifact_id: "artifact-a",
    artifact_digest: ARTIFACT_DIGEST,
    excerpt: "public=kept"
  }],
  artifacts: [{
    artifact_id: "artifact-a",
    run_id: "run-a",
    path: "reports/artifact.txt",
    digest: ARTIFACT_DIGEST
  }],
  ...extra
});

const expectedChain = (root: string, excerpt = "public=kept") => ({
  run_id: "run-a",
  metric_id: "M15",
  opportunity_id: "opp-a",
  event_id: "event-a",
  artifact_id: "artifact-a",
  artifact_digest: ARTIFACT_DIGEST,
  artifact_path: realpathSync(resolve(root, "reports", "artifact.txt")),
  excerpt
});

describe("evidence-resolver", () => {
  test("valid-chain", async () => {
    const { resolveEvidenceChain } = await requireEvidence();
    withEvidenceRoot((root) => {
      const accepted = resolveEvidenceChain(validChain(root));
      assert.deepEqual(accepted, expectedChain(root), BLOCKING);

      const malformed = clone(validChain(root));
      (malformed.metric as Json).metric_id = "";
      refuses(() => resolveEvidenceChain(malformed));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const missingOpportunity = clone(validChain(root));
      (missingOpportunity.metric as Json).opportunity_id = "opp-missing";
      refuses(() => resolveEvidenceChain(missingOpportunity));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);
    });
  });

  test("missing-event", async () => {
    const { resolveEvidenceChain } = await requireEvidence();
    withEvidenceRoot((root) => {
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const missingReference = clone(validChain(root));
      ((missingReference.opportunities as Json[])[0]).event_id = "event-missing";
      refuses(() => resolveEvidenceChain(missingReference));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const missingRecord = clone(validChain(root));
      ((missingRecord.events as Json[])[0]).event_id = "event-renamed";
      refuses(() => resolveEvidenceChain(missingRecord));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const missingArtifact = clone(validChain(root));
      ((missingArtifact.events as Json[])[0]).artifact_id = "artifact-missing";
      refuses(() => resolveEvidenceChain(missingArtifact));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const duplicateEvent = clone(validChain(root));
      (duplicateEvent.events as Json[]).push(clone((duplicateEvent.events as Json[])[0]));
      refuses(() => resolveEvidenceChain(duplicateEvent));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);
    });
  });

  test("stale-digest", async () => {
    const { resolveEvidenceChain } = await requireEvidence();
    withEvidenceRoot((root) => {
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const staleEventDigest = clone(validChain(root));
      ((staleEventDigest.events as Json[])[0]).artifact_digest = STALE_DIGEST;
      refuses(() => resolveEvidenceChain(staleEventDigest));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const staleArtifactDigest = clone(validChain(root));
      ((staleArtifactDigest.artifacts as Json[])[0]).digest = STALE_DIGEST;
      refuses(() => resolveEvidenceChain(staleArtifactDigest));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      writeFileSync(resolve(root, "reports", "artifact.txt"), "tampered artifact\n", "utf8");
      refuses(() => resolveEvidenceChain(validChain(root)));
      writeFileSync(resolve(root, "reports", "artifact.txt"), ARTIFACT_BODY, "utf8");
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);
    });
  });

  test("traversal", async () => {
    const { assertContainedEvidencePath, resolveEvidenceChain } = await requireEvidence();
    withEvidenceRoot((root, outside) => {
      const contained = realpathSync(resolve(root, "reports", "artifact.txt"));
      assert.equal(assertContainedEvidencePath(root, "reports/artifact.txt"), contained, BLOCKING);

      refuses(() => assertContainedEvidencePath(root, ""));
      assert.equal(assertContainedEvidencePath(root, "reports/artifact.txt"), contained, BLOCKING);

      refuses(() => assertContainedEvidencePath(root, 42));
      assert.equal(assertContainedEvidencePath(root, "reports/artifact.txt"), contained, BLOCKING);

      refuses(() => assertContainedEvidencePath(root, null));
      assert.equal(assertContainedEvidencePath(root, "reports/artifact.txt"), contained, BLOCKING);

      for (const path of [
        "../outside/artifact.txt",
        resolve(outside, "artifact.txt"),
        "C:artifact.txt",
        "C:\\outside\\artifact.txt",
        "reports\\artifact.txt",
        "reports/./artifact.txt"
      ]) {
        refuses(() => assertContainedEvidencePath(root, path));
        assert.equal(assertContainedEvidencePath(root, "reports/artifact.txt"), contained, BLOCKING);
      }

      symlinkSync(outside, resolve(root, "escape"));
      refuses(() => assertContainedEvidencePath(root, "escape/artifact.txt"));
      assert.equal(assertContainedEvidencePath(root, "reports/artifact.txt"), contained, BLOCKING);

      const escapingChain = clone(validChain(root));
      ((escapingChain.artifacts as Json[])[0]).path = "escape/artifact.txt";
      refuses(() => resolveEvidenceChain(escapingChain));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);
      assert.equal(realpathSync(contained), contained, BLOCKING);
    });
  });

  test("wrong-run", async () => {
    const { resolveEvidenceChain } = await requireEvidence();
    withEvidenceRoot((root) => {
      const runFields: ["metric" | "opportunities" | "events" | "artifacts", string][] = [
        ["metric", "run_id"],
        ["opportunities", "run_id"],
        ["events", "run_id"],
        ["artifacts", "run_id"]
      ];

      for (const [collection, field] of runFields) {
        const wrong = clone(validChain(root));
        if (collection === "metric") {
          (wrong.metric as Json)[field] = "run-b";
        } else {
          ((wrong[collection] as Json[])[0])[field] = "run-b";
        }
        refuses(() => resolveEvidenceChain(wrong));
        assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);
      }

      const declaredRun = clone(validChain(root));
      declaredRun.run_id = "run-b";
      refuses(() => resolveEvidenceChain(declaredRun));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);
    });
  });

  test("secret-canary", async () => {
    const { resolveEvidenceChain } = await requireEvidence();
    withEvidenceRoot((root) => {
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);

      const sourceWithSecret = clone(validChain(root));
      ((sourceWithSecret.events as Json[])[0]).excerpt = `public=kept secret=${SECRET}`;
      const resolved = resolveEvidenceChain(sourceWithSecret) as Json;
      assert.deepEqual(
        resolved,
        expectedChain(root, "public=kept secret=[REDACTED]"),
        BLOCKING
      );
      assert.equal((resolved.excerpt as string).includes(SECRET), false, BLOCKING);
      assert.equal((resolved.excerpt as string).includes("public=kept"), true, BLOCKING);

      const unbounded = clone(validChain(root));
      ((unbounded.events as Json[])[0]).excerpt = `public=kept ${"x".repeat(2048)}`;
      refuses(() => resolveEvidenceChain(unbounded));
      assert.deepEqual(resolveEvidenceChain(validChain(root)), expectedChain(root), BLOCKING);
    });
  });
});
