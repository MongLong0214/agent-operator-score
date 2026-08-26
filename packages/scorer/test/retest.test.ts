import { describe, test } from "node:test";
import assert from "node:assert/strict";

const CONFLATED = "operator/environment/combined changes and transfer gates are conflated.";
const modulePath = "../src/retest.ts";

type RetestClassification = "operator" | "environment" | "combined" | "unclassified" | null;
type TransferSignal = Readonly<{
  state: "transfer-supported" | "transfer-withheld";
  reason: "verified" | "verification-degraded" | "unsafe" | "exposure";
}>;
type ClassifyRetest = (input: unknown) => RetestClassification;
type EvaluateTransferSignal = (input: unknown) => TransferSignal | null;

const loadModule = async (): Promise<Record<string, unknown>> => {
  try {
    return (await import(modulePath)) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const requireExports = async (): Promise<{
  classifyRetest: ClassifyRetest;
  evaluateTransferSignal: EvaluateTransferSignal;
}> => {
  const module = await loadModule();
  assert.equal(typeof module.classifyRetest, "function", CONFLATED);
  assert.equal(typeof module.evaluateTransferSignal, "function", CONFLATED);
  return {
    classifyRetest: module.classifyRetest as ClassifyRetest,
    evaluateTransferSignal: module.evaluateTransferSignal as EvaluateTransferSignal
  };
};

const baseline = { operator: "operator-a", environment: "environment-a" };
const noChange = { baseline, retest: { operator: "operator-a", environment: "environment-a" } };
const supportedTransfer = {
  verification_quality: "verified",
  safety: "safe",
  exposure: "isolated"
};

describe("retest", () => {
  test("operator", async () => {
    const { classifyRetest } = await requireExports();
    assert.equal(
      classifyRetest({ baseline, retest: { operator: "operator-b", environment: "environment-a" } }),
      "operator",
      CONFLATED
    );
    assert.equal(
      classifyRetest({
        baseline: { operator: "operator-b", environment: "environment-a" },
        retest: { operator: "operator-a", environment: "environment-a" }
      }),
      "operator",
      CONFLATED
    );
    assert.equal(classifyRetest(noChange), "unclassified", CONFLATED);
  });

  test("environment", async () => {
    const { classifyRetest } = await requireExports();
    assert.equal(
      classifyRetest({ baseline, retest: { operator: "operator-a", environment: "environment-b" } }),
      "environment",
      CONFLATED
    );
    assert.equal(
      classifyRetest({
        baseline: { operator: "operator-a", environment: "environment-b" },
        retest: { operator: "operator-a", environment: "environment-a" }
      }),
      "environment",
      CONFLATED
    );
    assert.equal(classifyRetest(noChange), "unclassified", CONFLATED);
  });

  test("combined", async () => {
    const { classifyRetest } = await requireExports();
    assert.equal(
      classifyRetest({ baseline, retest: { operator: "operator-b", environment: "environment-b" } }),
      "combined",
      CONFLATED
    );
    assert.equal(
      classifyRetest({ baseline, retest: { operator: "operator-a", environment: "environment-b" } }),
      "environment",
      CONFLATED
    );
    assert.equal(
      classifyRetest({ baseline, retest: { operator: "operator-b", environment: "environment-a" } }),
      "operator",
      CONFLATED
    );
  });

  test("unclassified", async () => {
    const { classifyRetest } = await requireExports();
    assert.equal(classifyRetest(noChange), "unclassified", CONFLATED);
    assert.equal(classifyRetest({ baseline, retest: { operator: "operator-a" } }), null, CONFLATED);
    assert.equal(
      classifyRetest({ baseline, retest: { operator: "operator-b", environment: "environment-a" } }),
      "operator",
      CONFLATED
    );
  });

  test("verification-degrade", async () => {
    const { evaluateTransferSignal } = await requireExports();
    assert.deepEqual(evaluateTransferSignal(supportedTransfer), { state: "transfer-supported", reason: "verified" }, CONFLATED);
    assert.deepEqual(
      evaluateTransferSignal({ ...supportedTransfer, verification_quality: "degraded" }),
      { state: "transfer-withheld", reason: "verification-degraded" },
      CONFLATED
    );
  });

  test("unsafe", async () => {
    const { evaluateTransferSignal } = await requireExports();
    assert.deepEqual(evaluateTransferSignal(supportedTransfer), { state: "transfer-supported", reason: "verified" }, CONFLATED);
    assert.deepEqual(
      evaluateTransferSignal({ ...supportedTransfer, safety: "unsafe" }),
      { state: "transfer-withheld", reason: "unsafe" },
      CONFLATED
    );
  });

  test("exposure", async () => {
    const { evaluateTransferSignal } = await requireExports();
    assert.deepEqual(evaluateTransferSignal(supportedTransfer), { state: "transfer-supported", reason: "verified" }, CONFLATED);
    assert.deepEqual(
      evaluateTransferSignal({ ...supportedTransfer, exposure: "exposed" }),
      { state: "transfer-withheld", reason: "exposure" },
      CONFLATED
    );
  });

  test("positive", async () => {
    const { evaluateTransferSignal } = await requireExports();
    assert.deepEqual(evaluateTransferSignal(supportedTransfer), { state: "transfer-supported", reason: "verified" }, CONFLATED);
  });
});
