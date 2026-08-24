import { validateDoctorOutput } from "../schema/doctor-contract.ts";
import { assertVerifiedEligibility, classifySession } from "../schema/session-class.ts";

const DOCTOR_REFUSAL = "doctor/session verdict is not bound to golden capabilities and required events.";
const SCORE_ELIGIBLE_VERDICTS = new Set(["COMPLETE", "DEGRADED"]);
const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_VALUES = 10_000;

type RecordValue = Record<string, unknown>;
type DoctorInput = {
  report: unknown;
  session: unknown;
  expectedDoctorBytes: string;
  doctorContract: unknown;
  capabilityMatrix: unknown;
  doctorCorpus: unknown;
  sessionContract: unknown;
};
type DoctorProjection = {
  verdict: string;
  exit_code: number;
  reasons: string[];
  human_projection: string[];
};

const refused = (): { ok: false; reason: typeof DOCTOR_REFUSAL } => ({ ok: false, reason: DOCTOR_REFUSAL });

const isPlainRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const doctorInputOf = (value: unknown): DoctorInput | null => {
  if (!isPlainRecord(value) || typeof value.expected_doctor_bytes !== "string") return null;
  return {
    report: value.report,
    session: value.session,
    expectedDoctorBytes: value.expected_doctor_bytes,
    doctorContract: value.doctor_contract,
    capabilityMatrix: value.capability_matrix,
    doctorCorpus: value.doctor_corpus,
    sessionContract: value.session_contract
  };
};

const canonicalDoctorBytes = (value: unknown): string | null => {
  const ancestors = new Set<object>();
  let values = 0;

  const serialize = (candidate: unknown, depth: number): string | null => {
    if (++values > MAX_CANONICAL_VALUES || depth > MAX_CANONICAL_DEPTH) return null;
    if (candidate === null) return "null";
    if (typeof candidate === "string" || typeof candidate === "boolean") return JSON.stringify(candidate);
    if (typeof candidate === "number") return Number.isFinite(candidate) ? JSON.stringify(candidate) : null;
    if (Array.isArray(candidate)) {
      if (ancestors.has(candidate)) return null;
      ancestors.add(candidate);
      const entries: string[] = [];
      for (const entry of candidate) {
        const serialized = serialize(entry, depth + 1);
        if (serialized === null) return null;
        entries.push(serialized);
      }
      ancestors.delete(candidate);
      return `[${entries.join(",")}]`;
    }
    if (!isPlainRecord(candidate) || ancestors.has(candidate)) return null;
    ancestors.add(candidate);
    const entries: string[] = [];
    for (const key of Object.keys(candidate).sort()) {
      const serialized = serialize(candidate[key], depth + 1);
      if (serialized === null) return null;
      entries.push(`${JSON.stringify(key)}:${serialized}`);
    }
    ancestors.delete(candidate);
    return `{${entries.join(",")}}`;
  };

  try {
    return serialize(value, 0);
  } catch {
    return null;
  }
};

const stringsOf = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : null;

const doctorProjectionOf = (value: unknown): DoctorProjection | null => {
  if (!isPlainRecord(value) || typeof value.verdict !== "string" || !Number.isSafeInteger(value.exit_code)) return null;
  const reasons = stringsOf(value.reasons);
  const humanProjection = stringsOf(value.human_projection);
  if (reasons === null || humanProjection === null) return null;
  return { verdict: value.verdict, exit_code: value.exit_code, reasons, human_projection: humanProjection };
};

const canonicalProfileOf = (corpus: unknown, doctorBytes: string): DoctorProjection | null => {
  if (!isPlainRecord(corpus)) return null;
  const matching = Object.values(corpus).filter((candidate) => canonicalDoctorBytes(candidate) === doctorBytes);
  return matching.length === 1 ? doctorProjectionOf(matching[0]) : null;
};

const hasValidatedCorpus = (input: DoctorInput): boolean => {
  if (!isPlainRecord(input.doctorCorpus)) return false;
  return Object.values(input.doctorCorpus).some((candidate) =>
    validateDoctorOutput(candidate, input.doctorContract, input.capabilityMatrix, input.doctorCorpus).ok
  );
};

export const runDoctor = (input: unknown) => {
  const request = doctorInputOf(input);
  if (request === null) return refused();

  const doctorBytes = canonicalDoctorBytes(request.report);
  if (doctorBytes === null || doctorBytes !== request.expectedDoctorBytes) return refused();
  if (!hasValidatedCorpus(request)) return refused();
  const doctor = canonicalProfileOf(request.doctorCorpus, doctorBytes);
  if (doctor === null) return refused();

  const session = classifySession(request.session, request.sessionContract);
  if (session.classification === "CONTROLLED_VERIFIED") {
    try {
      assertVerifiedEligibility(request.session, request.sessionContract);
    } catch {
      return refused();
    }
  }

  return {
    ok: true as const,
    doctor,
    session,
    score_eligible: SCORE_ELIGIBLE_VERDICTS.has(doctor.verdict) && session.official_score_eligible,
    doctor_bytes: doctorBytes
  };
};
