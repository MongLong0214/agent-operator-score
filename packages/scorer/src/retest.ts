type RetestContext = Readonly<{
  operator: string;
  environment: string;
}>;

type RetestInput = Readonly<{
  baseline: RetestContext;
  retest: RetestContext;
}>;

type TransferInput = Readonly<{
  verification_quality: "verified" | "degraded";
  safety: "safe" | "unsafe";
  exposure: "isolated" | "exposed";
}>;

export type RetestClassification = "operator" | "environment" | "combined" | "unclassified";

export type TransferSignal = Readonly<{
  state: "transfer-supported" | "transfer-withheld";
  reason: "verified" | "verification-degraded" | "unsafe" | "exposure";
}>;

const TRANSFER_SUPPORTED: TransferSignal = Object.freeze({ state: "transfer-supported", reason: "verified" });
const VERIFICATION_DEGRADED: TransferSignal = Object.freeze({ state: "transfer-withheld", reason: "verification-degraded" });
const UNSAFE: TransferSignal = Object.freeze({ state: "transfer-withheld", reason: "unsafe" });
const EXPOSED: TransferSignal = Object.freeze({ state: "transfer-withheld", reason: "exposure" });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const parseContext = (value: unknown): RetestContext | null => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["operator", "environment"])) return null;
  if (!isFilledString(value.operator) || !isFilledString(value.environment)) return null;
  return { operator: value.operator, environment: value.environment };
};

const parseRetest = (value: unknown): RetestInput | null => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["baseline", "retest"])) return null;
  const baseline = parseContext(value.baseline);
  const retest = parseContext(value.retest);
  return baseline === null || retest === null ? null : { baseline, retest };
};

const parseTransfer = (value: unknown): TransferInput | null => {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["verification_quality", "safety", "exposure"])) return null;
  if (value.verification_quality !== "verified" && value.verification_quality !== "degraded") return null;
  if (value.safety !== "safe" && value.safety !== "unsafe") return null;
  if (value.exposure !== "isolated" && value.exposure !== "exposed") return null;
  return {
    verification_quality: value.verification_quality,
    safety: value.safety,
    exposure: value.exposure
  };
};

// A valid retest with no changed attribution source is deliberately distinct from an
// invalid input: callers receive `unclassified` only for the former and `null` for the latter.
export const classifyRetest = (input: unknown): RetestClassification | null => {
  const retest = parseRetest(input);
  if (retest === null) return null;

  const operatorChanged = retest.baseline.operator !== retest.retest.operator;
  const environmentChanged = retest.baseline.environment !== retest.retest.environment;
  if (operatorChanged && environmentChanged) return "combined";
  if (operatorChanged) return "operator";
  if (environmentChanged) return "environment";
  return "unclassified";
};

// Transfer is supportable only after verification remains intact, the retest is safe,
// and the evidence remains isolated from prior exposure.
export const evaluateTransferSignal = (input: unknown): TransferSignal | null => {
  const transfer = parseTransfer(input);
  if (transfer === null) return null;
  if (transfer.verification_quality !== "verified") return VERIFICATION_DEGRADED;
  if (transfer.safety !== "safe") return UNSAFE;
  if (transfer.exposure !== "isolated") return EXPOSED;
  return TRANSFER_SUPPORTED;
};
