import assert from "node:assert/strict";
import { describe, test } from "node:test";

const REFUSAL = "duplicate retry side effect and illegal transition are not detected.";

const KEY = "idem-order-481";
const EFFECT_ID = "effect-charge-481";
const EFFECT_DIGEST = "sha256:2c7a4a4432fbb8d4f0d4ed2df76882900da3a351f8cde290f8e3ac0f045a27c6";
const EVIDENCE_DIGEST = "sha256:581b9a573466e651e0f4107d70c5e6e2480d350a79bdabeb170e1f6788a06a48";

type LedgerEntry = {
  from: string;
  to: string;
  idempotency_key: string;
};

type Effect = {
  effect_id: string;
  effect_digest: string;
  idempotency_key: string;
};

type IdempotencyRun = {
  idempotency_key: string;
  ledger: LedgerEntry[];
  effects: Effect[];
  acknowledgement: {
    status: string;
    effect_id: string;
    effect_digest: string;
    idempotency_key: string;
    evidence_revision: string;
    evidence_digest: string;
  };
};

type Grade = { ok: boolean };
type GradeIdempotency = (input: unknown) => Grade;

const validRun = (): IdempotencyRun => ({
  idempotency_key: KEY,
  ledger: [
    { from: "PENDING", to: "EFFECT_APPLIED", idempotency_key: KEY },
    { from: "EFFECT_APPLIED", to: "ACKNOWLEDGEMENT_AMBIGUOUS", idempotency_key: KEY },
    { from: "ACKNOWLEDGEMENT_AMBIGUOUS", to: "RETRY_PENDING", idempotency_key: KEY },
    { from: "RETRY_PENDING", to: "ACKNOWLEDGED", idempotency_key: KEY }
  ],
  effects: [{ effect_id: EFFECT_ID, effect_digest: EFFECT_DIGEST, idempotency_key: KEY }],
  acknowledgement: {
    status: "ambiguous",
    effect_id: EFFECT_ID,
    effect_digest: EFFECT_DIGEST,
    idempotency_key: KEY,
    evidence_revision: "revision-2",
    evidence_digest: EVIDENCE_DIGEST
  }
});

const loadGradeIdempotency = async (): Promise<GradeIdempotency> => {
  let loaded: { gradeIdempotency?: unknown } = {};
  try {
    loaded = await import("../src/scorer/graders/idempotency.ts");
  } catch {
    loaded = {};
  }
  assert.equal(typeof loaded.gradeIdempotency, "function", REFUSAL);
  return loaded.gradeIdempotency as GradeIdempotency;
};

const assertVerdict = (gradeIdempotency: GradeIdempotency, input: IdempotencyRun, expected: boolean) => {
  assert.equal(gradeIdempotency(input).ok, expected, REFUSAL);
};

describe("fam4-idempotency", () => {
  test("single-effect", async () => {
    const gradeIdempotency = await loadGradeIdempotency();
    assertVerdict(gradeIdempotency, validRun(), true);

    const missingEffect = validRun();
    missingEffect.effects = [];
    assertVerdict(gradeIdempotency, missingEffect, false);

    const unboundEffect = validRun();
    unboundEffect.acknowledgement.effect_id = "effect-other";
    assertVerdict(gradeIdempotency, unboundEffect, false);

    const emptyEffect = validRun();
    emptyEffect.effects[0].effect_id = "";
    emptyEffect.acknowledgement.effect_id = "";
    assertVerdict(gradeIdempotency, emptyEffect, false);

    const unregisteredEffect = validRun();
    unregisteredEffect.effects[0].effect_id = "effect-charge-other";
    unregisteredEffect.acknowledgement.effect_id = "effect-charge-other";
    assertVerdict(gradeIdempotency, unregisteredEffect, false);

    const unregisteredDigest = validRun();
    unregisteredDigest.effects[0].effect_digest = "sha256:cd274e944df4b1b83f9d0de6207d65306f58705157ec64bc3df5bc0fd7b78b0a";
    unregisteredDigest.acknowledgement.effect_digest = "sha256:cd274e944df4b1b83f9d0de6207d65306f58705157ec64bc3df5bc0fd7b78b0a";
    assertVerdict(gradeIdempotency, unregisteredDigest, false);
  });

  test("duplicate-effect", async () => {
    const gradeIdempotency = await loadGradeIdempotency();
    assertVerdict(gradeIdempotency, validRun(), true);

    const repeatedEffect = validRun();
    repeatedEffect.effects.push({ ...repeatedEffect.effects[0] });
    assertVerdict(gradeIdempotency, repeatedEffect, false);

    const secondEffect = validRun();
    secondEffect.effects.push({
      effect_id: "effect-charge-482",
      effect_digest: "sha256:cd274e944df4b1b83f9d0de6207d65306f58705157ec64bc3df5bc0fd7b78b0a",
      idempotency_key: KEY
    });
    assertVerdict(gradeIdempotency, secondEffect, false);
  });

  test("wrong-key", async () => {
    const gradeIdempotency = await loadGradeIdempotency();
    assertVerdict(gradeIdempotency, validRun(), true);

    const wrongRunKey = validRun();
    wrongRunKey.idempotency_key = "idem-order-other";
    assertVerdict(gradeIdempotency, wrongRunKey, false);

    for (const ledgerIndex of validRun().ledger.keys()) {
      const wrongLedgerKey = validRun();
      wrongLedgerKey.ledger[ledgerIndex].idempotency_key = "idem-order-other";
      assertVerdict(gradeIdempotency, wrongLedgerKey, false);
    }

    const wrongEffectKey = validRun();
    wrongEffectKey.effects[0].idempotency_key = "idem-order-other";
    assertVerdict(gradeIdempotency, wrongEffectKey, false);

    const wrongAcknowledgementKey = validRun();
    wrongAcknowledgementKey.acknowledgement.idempotency_key = "idem-order-other";
    assertVerdict(gradeIdempotency, wrongAcknowledgementKey, false);

    const allWrongKeys = validRun();
    allWrongKeys.idempotency_key = "idem-order-other";
    for (const entry of allWrongKeys.ledger) entry.idempotency_key = "idem-order-other";
    allWrongKeys.effects[0].idempotency_key = "idem-order-other";
    allWrongKeys.acknowledgement.idempotency_key = "idem-order-other";
    assertVerdict(gradeIdempotency, allWrongKeys, false);
  });

  test("illegal-transition", async () => {
    const gradeIdempotency = await loadGradeIdempotency();
    assertVerdict(gradeIdempotency, validRun(), true);

    const missingTransition = validRun();
    missingTransition.ledger.pop();
    assertVerdict(gradeIdempotency, missingTransition, false);

    const repeatedTransition = validRun();
    repeatedTransition.ledger.push({ ...repeatedTransition.ledger[3] });
    assertVerdict(gradeIdempotency, repeatedTransition, false);

    for (const ledgerIndex of validRun().ledger.keys()) {
      const wrongSource = validRun();
      wrongSource.ledger[ledgerIndex].from = "INVALID_SOURCE";
      assertVerdict(gradeIdempotency, wrongSource, false);

      const wrongTarget = validRun();
      wrongTarget.ledger[ledgerIndex].to = "INVALID_TARGET";
      assertVerdict(gradeIdempotency, wrongTarget, false);
    }
  });

  test("stale-ack", async () => {
    const gradeIdempotency = await loadGradeIdempotency();
    assertVerdict(gradeIdempotency, validRun(), true);

    const resolvedAcknowledgement = validRun();
    resolvedAcknowledgement.acknowledgement.status = "resolved";
    assertVerdict(gradeIdempotency, resolvedAcknowledgement, false);

    const staleRevision = validRun();
    staleRevision.acknowledgement.evidence_revision = "revision-1";
    assertVerdict(gradeIdempotency, staleRevision, false);

    const staleDigest = validRun();
    staleDigest.acknowledgement.evidence_digest = "sha256:4c08091fca4b02c894a0150fc2da0ca9010a892ed9fcfbb834d4813dd93db753";
    assertVerdict(gradeIdempotency, staleDigest, false);

    const mismatchedEffectDigest = validRun();
    mismatchedEffectDigest.acknowledgement.effect_digest = "sha256:42e5b2c6d2ba3e7b263af98a427e497476d98dd2cf7ce133533d198c4f096f52";
    assertVerdict(gradeIdempotency, mismatchedEffectDigest, false);
  });
});
