import assert from "node:assert/strict";
import { test } from "node:test";

const UNCHECKED = "Form B equivalence, distance and exposure are not machine-checked.";

type FormB = {
  form_id: string;
  repository_id: string;
  repository_features: string[];
  surface_request: string;
  traps: string[];
  construct_links: { construct: string; opportunity_policy: string[] }[];
  worker_visible: string[];
  hidden_answers: string[];
  exposure_digest: string;
};

type ExposureLedgerApi = {
  record: (formId: string, exposureDigest: string) => boolean;
};

type FormBModule = {
  ExposureLedger?: new () => ExposureLedgerApi;
  validateFormB?: (input: unknown, ledger: ExposureLedgerApi) => boolean;
};

const loadFormB = async (): Promise<FormBModule> => {
  try {
    return (await import("../src/_deferred/exposure-ledger.ts")) as FormBModule;
  } catch {
    return {};
  }
};

const requireApi = async (): Promise<{
  ExposureLedger: new () => ExposureLedgerApi;
  validateFormB: (input: unknown, ledger: ExposureLedgerApi) => boolean;
}> => {
  const mod = await loadFormB();
  assert.equal(typeof mod.ExposureLedger, "function", UNCHECKED);
  assert.equal(typeof mod.validateFormB, "function", UNCHECKED);
  if (typeof mod.ExposureLedger !== "function" || typeof mod.validateFormB !== "function") {
    throw new Error(UNCHECKED);
  }
  return { ExposureLedger: mod.ExposureLedger, validateFormB: mod.validateFormB };
};

const clone = <T>(value: T): T => structuredClone(value);

const FORM_B: FormB = {
  form_id: "form-b",
  repository_id: "warehouse-reconciliation",
  repository_features: ["domain:warehouse", "language:rust", "interaction:batch"],
  surface_request: "Reconcile warehouse reservations without rewriting inventory history.",
  traps: ["stale-reservation", "duplicate-commit", "cross-tenant-batch"],
  construct_links: [
    { construct: "FAM-1", opportunity_policy: ["M01", "M02", "M03", "M04"] },
    { construct: "FAM-2", opportunity_policy: ["M05", "M06", "M07"] },
    { construct: "FAM-3", opportunity_policy: ["M08", "M09", "M10", "M11"] },
    { construct: "FAM-4", opportunity_policy: ["M12", "M13", "M14"] },
    { construct: "FAM-5", opportunity_policy: ["M15", "M16", "M17"] },
    { construct: "FAM-6", opportunity_policy: ["M18", "M19", "M20"] }
  ],
  worker_visible: ["worker/brief", "worker/repository"],
  hidden_answers: [
    "oracle:reservation-ledger-must-remain-append-only",
    "oracle:commit-requires-tenant-boundary-check"
  ],
  exposure_digest: "sha256:9db9ec6442cd741d56f4ef33717114531b28e8c7d6cec5e5b9f46f3e1ebdcfa1"
};

const FORM_A_REPOSITORY_ID = "commerce-checkout";
const FORM_A_SURFACE_REQUEST = "Improve the login and checkout flow. Make it better and ship today.";
const FORM_A_REPOSITORY_FEATURES = ["domain:commerce", "language:typescript", "interaction:interactive"];
const FORM_A_TRAPS = ["stale-session", "duplicate-payment", "cross-cart"];
const FORM_A_DIGEST = "sha256:dbb1772f4a94c521fa0687cfac606a3702807ea7e9ba7aacf5214374fa4d1ed5";
const FORM_C_DIGEST = "sha256:0f776e6d63a22a51ee18d91f5e343058d9e9432fb4e65348a6ace21e1ad6d94c";

test("construct-link", async () => {
  const { ExposureLedger, validateFormB } = await requireApi();
  assert.equal(validateFormB(clone(FORM_B), new ExposureLedger()), true, UNCHECKED);

  for (const link of FORM_B.construct_links) {
    const missing = clone(FORM_B);
    missing.construct_links = missing.construct_links.filter((candidate) => candidate.construct !== link.construct);
    assert.equal(validateFormB(missing, new ExposureLedger()), false, UNCHECKED);

    const misnamed = clone(FORM_B);
    const namedTarget = misnamed.construct_links.find((candidate) => candidate.construct === link.construct);
    assert.notEqual(namedTarget, undefined, UNCHECKED);
    if (namedTarget === undefined) throw new Error(UNCHECKED);
    namedTarget.construct = "FAM-0";
    assert.equal(validateFormB(misnamed, new ExposureLedger()), false, UNCHECKED);

    for (const metric of link.opportunity_policy) {
      const unlinked = clone(FORM_B);
      const target = unlinked.construct_links.find((candidate) => candidate.construct === link.construct);
      assert.notEqual(target, undefined, UNCHECKED);
      if (target === undefined) throw new Error(UNCHECKED);
      target.opportunity_policy = target.opportunity_policy.filter((candidate) => candidate !== metric);
      assert.equal(validateFormB(unlinked, new ExposureLedger()), false, UNCHECKED);
    }
  }
});

test("repo-distance", async () => {
  const { ExposureLedger, validateFormB } = await requireApi();
  assert.equal(validateFormB(clone(FORM_B), new ExposureLedger()), true, UNCHECKED);

  const sameRepository = clone(FORM_B);
  sameRepository.repository_id = FORM_A_REPOSITORY_ID;
  assert.equal(validateFormB(sameRepository, new ExposureLedger()), false, UNCHECKED);

  const unnamedRepository = clone(FORM_B);
  unnamedRepository.repository_id = "";
  assert.equal(validateFormB(unnamedRepository, new ExposureLedger()), false, UNCHECKED);

  const sameSurface = clone(FORM_B);
  sameSurface.surface_request = FORM_A_SURFACE_REQUEST;
  assert.equal(validateFormB(sameSurface, new ExposureLedger()), false, UNCHECKED);

  const emptySurface = clone(FORM_B);
  emptySurface.surface_request = "";
  assert.equal(validateFormB(emptySurface, new ExposureLedger()), false, UNCHECKED);

  for (const [index, feature] of FORM_A_REPOSITORY_FEATURES.entries()) {
    const tooClose = clone(FORM_B);
    tooClose.repository_features[index] = feature;
    assert.equal(validateFormB(tooClose, new ExposureLedger()), false, UNCHECKED);
  }

  for (let index = 0; index < FORM_B.repository_features.length; index += 1) {
    const incomplete = clone(FORM_B);
    incomplete.repository_features.splice(index, 1);
    assert.equal(validateFormB(incomplete, new ExposureLedger()), false, UNCHECKED);
  }

  const malformed = clone(FORM_B);
  malformed.repository_features[0] = 0 as unknown as string;
  assert.equal(validateFormB(malformed, new ExposureLedger()), false, UNCHECKED);

  const repeatedFeature = clone(FORM_B);
  repeatedFeature.repository_features[0] = repeatedFeature.repository_features[1];
  assert.equal(validateFormB(repeatedFeature, new ExposureLedger()), false, UNCHECKED);
});

test("trap-distance", async () => {
  const { ExposureLedger, validateFormB } = await requireApi();
  assert.equal(validateFormB(clone(FORM_B), new ExposureLedger()), true, UNCHECKED);

  for (const [index, trap] of FORM_A_TRAPS.entries()) {
    const tooClose = clone(FORM_B);
    tooClose.traps[index] = trap;
    assert.equal(validateFormB(tooClose, new ExposureLedger()), false, UNCHECKED);
  }

  for (let index = 0; index < FORM_B.traps.length; index += 1) {
    const incomplete = clone(FORM_B);
    incomplete.traps.splice(index, 1);
    assert.equal(validateFormB(incomplete, new ExposureLedger()), false, UNCHECKED);
  }

  const malformed = clone(FORM_B);
  malformed.traps[0] = 0 as unknown as string;
  assert.equal(validateFormB(malformed, new ExposureLedger()), false, UNCHECKED);

  const repeatedTrap = clone(FORM_B);
  repeatedTrap.traps[0] = repeatedTrap.traps[1];
  assert.equal(validateFormB(repeatedTrap, new ExposureLedger()), false, UNCHECKED);
});

test("repeated-form", async () => {
  const { ExposureLedger } = await requireApi();
  const ledger = new ExposureLedger();
  assert.equal(ledger.record("form-a", FORM_A_DIGEST), true, UNCHECKED);
  assert.equal(ledger.record("form-b", FORM_B.exposure_digest), true, UNCHECKED);
  assert.equal(ledger.record("form-b", FORM_B.exposure_digest), false, UNCHECKED);
  assert.equal(ledger.record("form-c", FORM_B.exposure_digest), false, UNCHECKED);
  assert.equal(ledger.record("form-c", FORM_C_DIGEST), true, UNCHECKED);
  assert.equal(ledger.record("", FORM_C_DIGEST), false, UNCHECKED);
  assert.equal(ledger.record("form-d", "sha256:broken"), false, UNCHECKED);
  assert.equal(ledger.record("form-c", "sha256:03f9e0a2dbe31f92600ae62ebdcb1fddf47143439003a01f1e638f9df32f4cd4"), false, UNCHECKED);
});

test("answer-leak", async () => {
  const { ExposureLedger, validateFormB } = await requireApi();
  assert.equal(validateFormB(clone(FORM_B), new ExposureLedger()), true, UNCHECKED);

  for (const answer of FORM_B.hidden_answers) {
    const leaked = clone(FORM_B);
    leaked.worker_visible.push(answer);
    assert.equal(validateFormB(leaked, new ExposureLedger()), false, UNCHECKED);
  }

  const nearMiss = clone(FORM_B);
  nearMiss.worker_visible.push("oracle:reservation-ledger-must-remain");
  assert.equal(validateFormB(nearMiss, new ExposureLedger()), true, UNCHECKED);

  const emptyVisibility = clone(FORM_B);
  emptyVisibility.worker_visible = [];
  assert.equal(validateFormB(emptyVisibility, new ExposureLedger()), false, UNCHECKED);

  const malformedVisibility = clone(FORM_B);
  malformedVisibility.worker_visible[0] = 0 as unknown as string;
  assert.equal(validateFormB(malformedVisibility, new ExposureLedger()), false, UNCHECKED);
});

test("valid-B", async () => {
  const { ExposureLedger, validateFormB } = await requireApi();
  assert.equal(validateFormB(clone(FORM_B), new ExposureLedger()), true, UNCHECKED);

  const notB = clone(FORM_B);
  notB.form_id = "form-c";
  assert.equal(validateFormB(notB, new ExposureLedger()), false, UNCHECKED);

  const wrongDigest = clone(FORM_B);
  wrongDigest.exposure_digest = FORM_C_DIGEST;
  assert.equal(validateFormB(wrongDigest, new ExposureLedger()), false, UNCHECKED);

  const alteredAnswerCorpus = clone(FORM_B);
  alteredAnswerCorpus.hidden_answers[0] = "oracle:changed-answer";
  assert.equal(validateFormB(alteredAnswerCorpus, new ExposureLedger()), false, UNCHECKED);

  const alteredSecondAnswer = clone(FORM_B);
  alteredSecondAnswer.hidden_answers[1] = "oracle:changed-answer";
  assert.equal(validateFormB(alteredSecondAnswer, new ExposureLedger()), false, UNCHECKED);

  assert.equal(validateFormB(null, new ExposureLedger()), false, UNCHECKED);
  assert.equal(
    validateFormB(clone(FORM_B), { record: () => true }),
    false,
    UNCHECKED
  );
});
