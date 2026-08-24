const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MIN_REPOSITORY_DISTANCE = 3;
const MIN_TRAP_DISTANCE = 3;

type ConstructLink = Readonly<{
  construct: string;
  opportunity_policy: readonly string[];
}>;

type FormBDefinition = Readonly<{
  form_id: string;
  repository_id: string;
  repository_features: readonly string[];
  surface_request: string;
  traps: readonly string[];
  construct_links: readonly ConstructLink[];
  worker_visible: readonly string[];
  hidden_answers: readonly string[];
  exposure_digest: string;
}>;

const FORM_A_REPOSITORY_ID = "commerce-checkout";
const FORM_A_SURFACE_REQUEST = "Improve the login and checkout flow. Make it better and ship today.";
const FORM_A_REPOSITORY_FEATURES = ["domain:commerce", "language:typescript", "interaction:interactive"] as const;
const FORM_A_TRAPS = ["stale-session", "duplicate-payment", "cross-cart"] as const;

const FORM_A_CONSTRUCT_LINKS = [
  { construct: "FAM-1", opportunity_policy: ["M01", "M02", "M03", "M04"] },
  { construct: "FAM-2", opportunity_policy: ["M05", "M06", "M07"] },
  { construct: "FAM-3", opportunity_policy: ["M08", "M09", "M10", "M11"] },
  { construct: "FAM-4", opportunity_policy: ["M12", "M13", "M14"] },
  { construct: "FAM-5", opportunity_policy: ["M15", "M16", "M17"] },
  { construct: "FAM-6", opportunity_policy: ["M18", "M19", "M20"] }
] as const;

const freezeStrings = (values: readonly string[]): readonly string[] => Object.freeze([...values]);

const freezeLinks = (links: readonly ConstructLink[]): readonly ConstructLink[] =>
  Object.freeze(
    links.map((link) =>
      Object.freeze({
        construct: link.construct,
        opportunity_policy: freezeStrings(link.opportunity_policy)
      })
    )
  );

// This corpus contains only the Form B identity, distance contract, and sealed oracle material.
// It deliberately shares Form A's construct/opportunity policy without reusing its repository,
// worker request, or traps.
export const formBScenario: FormBDefinition = Object.freeze({
  form_id: "form-b",
  repository_id: "warehouse-reconciliation",
  repository_features: freezeStrings(["domain:warehouse", "language:rust", "interaction:batch"]),
  surface_request: "Reconcile warehouse reservations without rewriting inventory history.",
  traps: freezeStrings(["stale-reservation", "duplicate-commit", "cross-tenant-batch"]),
  construct_links: freezeLinks(FORM_A_CONSTRUCT_LINKS),
  worker_visible: freezeStrings(["worker/brief", "worker/repository"]),
  hidden_answers: freezeStrings([
    "oracle:reservation-ledger-must-remain-append-only",
    "oracle:commit-requires-tenant-boundary-check"
  ]),
  exposure_digest: "sha256:9db9ec6442cd741d56f4ef33717114531b28e8c7d6cec5e5b9f46f3e1ebdcfa1"
});

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isFilledString);

const hasDistinctStrings = (values: string[]): boolean => new Set(values).size === values.length;

const hasExactStrings = (actual: unknown, expected: readonly string[]): boolean =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);

const hasConstructLink = (value: unknown, expected: ConstructLink): boolean =>
  isPlainRecord(value) &&
  value.construct === expected.construct &&
  hasExactStrings(value.opportunity_policy, expected.opportunity_policy);

const hasConstructLinks = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length === FORM_A_CONSTRUCT_LINKS.length &&
  value.every((link, index) => hasConstructLink(link, FORM_A_CONSTRUCT_LINKS[index]));

const differenceAtEachPosition = (candidate: string[], baseline: readonly string[]): number => {
  if (candidate.length !== baseline.length) return 0;
  return candidate.reduce((distance, value, index) => distance + Number(value !== baseline[index]), 0);
};

const hasNoAnswerLeak = (workerVisible: string[], hiddenAnswers: readonly string[]): boolean =>
  hiddenAnswers.every((answer) => !workerVisible.includes(answer));

export class ExposureLedger {
  readonly #exposedForms = new Set<string>();
  readonly #exposureDigests = new Set<string>();

  record(formId: string, exposureDigest: string): boolean {
    if (!isFilledString(formId) || !DIGEST.test(exposureDigest)) return false;
    if (this.#exposedForms.has(formId) || this.#exposureDigests.has(exposureDigest)) return false;
    this.#exposedForms.add(formId);
    this.#exposureDigests.add(exposureDigest);
    return true;
  }
}

export const validateFormB = (input: unknown, ledger: ExposureLedger): boolean => {
  try {
    if (!isPlainRecord(input) || !(ledger instanceof ExposureLedger)) return false;
    if (input.form_id !== formBScenario.form_id) return false;
    if (input.repository_id === FORM_A_REPOSITORY_ID || !isFilledString(input.repository_id)) return false;
    if (input.surface_request === FORM_A_SURFACE_REQUEST || !isFilledString(input.surface_request)) return false;
    if (!isStringArray(input.repository_features) || !hasDistinctStrings(input.repository_features)) return false;
    if (!isStringArray(input.traps) || !hasDistinctStrings(input.traps)) return false;
    if (!isStringArray(input.worker_visible)) {
      return false;
    }
    if (differenceAtEachPosition(input.repository_features, FORM_A_REPOSITORY_FEATURES) < MIN_REPOSITORY_DISTANCE) {
      return false;
    }
    if (differenceAtEachPosition(input.traps, FORM_A_TRAPS) < MIN_TRAP_DISTANCE) return false;
    if (!hasConstructLinks(input.construct_links)) return false;
    if (!hasExactStrings(input.hidden_answers, formBScenario.hidden_answers)) return false;
    if (!hasNoAnswerLeak(input.worker_visible, formBScenario.hidden_answers)) return false;
    if (input.exposure_digest !== formBScenario.exposure_digest) return false;
    return ledger.record(input.form_id, input.exposure_digest);
  } catch {
    return false;
  }
};
