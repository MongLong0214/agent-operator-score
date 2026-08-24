import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const FAILURE = "doctor/session verdict is not bound to golden capabilities and required events.";

type RecordValue = Record<string, unknown>;
type RunDoctor = (input: RecordValue) => RecordValue;

const fixture = (path: string): RecordValue =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as RecordValue;

const doctorContract = fixture("specs/doctor-output.v0.json");
const capabilityMatrix = fixture("specs/adapter-capabilities.v0.json");
const sessionContract = fixture("specs/session-class.v0.json");

const fixtureNames = [
  "blocked-and-imported.json",
  "blocked.json",
  "blocking-and-degraded.json",
  "blocking-and-imported.json",
  "complete.json",
  "degraded.json",
  "imported-and-degraded.json",
  "imported-only.json"
];

const doctorCorpus = Object.fromEntries(
  fixtureNames.map((name) => [name, fixture(`fixtures/doctor/${name}`)])
) as RecordValue;

const canonicalBytes = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as RecordValue;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalBytes(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const report = (name: string): RecordValue => {
  const entry = doctorCorpus[name];
  assert.equal(entry !== null && typeof entry === "object" && !Array.isArray(entry), true, FAILURE);
  return structuredClone(entry as RecordValue);
};

const session = (sessionId: string): RecordValue => {
  const sessions = sessionContract.canonical_sessions;
  assert.equal(Array.isArray(sessions), true, FAILURE);
  const entry = (sessions as RecordValue[]).find((candidate) => {
    const value = candidate.session;
    return value !== null && typeof value === "object" && !Array.isArray(value) &&
      (value as RecordValue).session_id === sessionId;
  });
  assert.equal(entry !== undefined, true, FAILURE);
  const value = (entry as RecordValue).session;
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true, FAILURE);
  return structuredClone(value as RecordValue);
};

const loadDoctor = async (): Promise<RecordValue> => {
  try {
    return await import("../src/runner/doctor.ts");
  } catch {
    return {};
  }
};

const requireRunDoctor = async (): Promise<RunDoctor> => {
  const mod = await loadDoctor();
  assert.equal(typeof mod.runDoctor, "function", FAILURE);
  return mod.runDoctor as RunDoctor;
};

const run = (runDoctor: RunDoctor, doctorReport: RecordValue, sessionRecord: RecordValue, expectedBytes: string): RecordValue =>
  runDoctor({
    report: doctorReport,
    session: sessionRecord,
    expected_doctor_bytes: expectedBytes,
    doctor_contract: doctorContract,
    capability_matrix: capabilityMatrix,
    doctor_corpus: doctorCorpus,
    session_contract: sessionContract
  });

const accepted = (value: RecordValue): RecordValue => {
  assert.equal(value.ok, true, FAILURE);
  return value;
};

const doctor = (value: RecordValue): RecordValue => {
  const detail = value.doctor;
  assert.equal(detail !== null && typeof detail === "object" && !Array.isArray(detail), true, FAILURE);
  return detail as RecordValue;
};

const sessionVerdict = (value: RecordValue): RecordValue => {
  const detail = value.session;
  assert.equal(detail !== null && typeof detail === "object" && !Array.isArray(detail), true, FAILURE);
  return detail as RecordValue;
};

const assertProfile = (
  value: RecordValue,
  verdict: string,
  classification: string,
  eligible: boolean,
  expectedBytes: string
): void => {
  const result = accepted(value);
  assert.equal(doctor(result).verdict, verdict, FAILURE);
  assert.equal(sessionVerdict(result).classification, classification, FAILURE);
  assert.equal(result.score_eligible, eligible, FAILURE);
  assert.equal(result.doctor_bytes, expectedBytes, FAILURE);
};

describe("conformance", () => {
  test("complete", async () => {
    const runDoctor = await requireRunDoctor();
    const doctorReport = report("complete.json");
    const expectedBytes = canonicalBytes(doctorReport);
    assertProfile(run(runDoctor, doctorReport, session("controlled-complete"), expectedBytes), "COMPLETE", "CONTROLLED_VERIFIED", true, expectedBytes);
  });

  test("degraded", async () => {
    const runDoctor = await requireRunDoctor();
    const doctorReport = report("degraded.json");
    const expectedBytes = canonicalBytes(doctorReport);
    assertProfile(run(runDoctor, doctorReport, session("controlled-complete"), expectedBytes), "DEGRADED", "CONTROLLED_VERIFIED", true, expectedBytes);
  });

  test("blocked", async () => {
    const runDoctor = await requireRunDoctor();
    const doctorReport = report("blocked.json");
    const expectedBytes = canonicalBytes(doctorReport);
    assertProfile(run(runDoctor, doctorReport, session("controlled-complete"), expectedBytes), "SCORE_BLOCKED", "CONTROLLED_VERIFIED", false, expectedBytes);
  });

  test("imported", async () => {
    const runDoctor = await requireRunDoctor();
    const doctorReport = report("imported-only.json");
    const expectedBytes = canonicalBytes(doctorReport);
    assertProfile(run(runDoctor, doctorReport, session("imported"), expectedBytes), "IMPORTED_ONLY", "IMPORTED_DIAGNOSTIC", false, expectedBytes);
  });

  test("event-missing", async () => {
    const runDoctor = await requireRunDoctor();
    const doctorReport = report("complete.json");
    const expectedBytes = canonicalBytes(doctorReport);
    const complete = run(runDoctor, doctorReport, session("controlled-complete"), expectedBytes);
    assertProfile(complete, "COMPLETE", "CONTROLLED_VERIFIED", true, expectedBytes);

    const missing = session("controlled-complete");
    const events = missing.events;
    assert.equal(Array.isArray(events), true, FAILURE);
    missing.events = (events as RecordValue[]).filter((event) => event.event_group !== "evidence_claim");
    const refused = accepted(run(runDoctor, doctorReport, missing, expectedBytes));
    assert.equal(doctor(refused).verdict, "COMPLETE", FAILURE);
    assert.equal(sessionVerdict(refused).classification, "IMPORTED_DIAGNOSTIC", FAILURE);
    assert.equal(refused.score_eligible, false, FAILURE);

    const rechecked = session("controlled-complete");
    const verifiedEvents = rechecked.events;
    assert.equal(Array.isArray(verifiedEvents), true, FAILURE);
    let eventReads = 0;
    Object.defineProperty(rechecked, "events", {
      configurable: true,
      enumerable: true,
      get: () => {
        eventReads += 1;
        return eventReads <= 3 ? verifiedEvents : [];
      }
    });
    const eligibilityRefused = run(runDoctor, doctorReport, rechecked, expectedBytes);
    assert.equal(eligibilityRefused.ok, false, FAILURE);
    assert.equal(eligibilityRefused.reason, FAILURE, FAILURE);
  });

  test("digest-change", async () => {
    const runDoctor = await requireRunDoctor();
    const baseline = report("complete.json");
    const baselineBytes = canonicalBytes(baseline);
    assertProfile(run(runDoctor, baseline, session("controlled-complete"), baselineBytes), "COMPLETE", "CONTROLLED_VERIFIED", true, baselineBytes);

    const otherProfileBytes = canonicalBytes(report("degraded.json"));
    assert.equal(otherProfileBytes === baselineBytes, false, FAILURE);
    const bytesRefused = run(runDoctor, baseline, session("controlled-complete"), otherProfileBytes);
    assert.equal(bytesRefused.ok, false, FAILURE);
    assert.equal(bytesRefused.reason, FAILURE, FAILURE);

    const changed = structuredClone(baseline);
    const digest = changed.capability_digest;
    assert.equal(digest !== null && typeof digest === "object" && !Array.isArray(digest), true, FAILURE);
    (digest as RecordValue).runtime_version = "codex-0.0.1-fixture";
    const projection = changed.human_projection;
    assert.equal(Array.isArray(projection), true, FAILURE);
    const digestLine = projection[2];
    assert.equal(typeof digestLine, "string", FAILURE);
    projection[2] = (digestLine as string).replace("codex-0.0.0-fixture", "codex-0.0.1-fixture");
    const changedBytes = canonicalBytes(changed);
    assert.equal(changedBytes === baselineBytes, false, FAILURE);
    const profileRefused = run(runDoctor, changed, session("controlled-complete"), changedBytes);
    assert.equal(profileRefused.ok, false, FAILURE);
    assert.equal(profileRefused.reason, FAILURE, FAILURE);

    const incompleteMatrix = structuredClone(capabilityMatrix);
    const requiredGroups = incompleteMatrix.unconditional_required_event_groups;
    assert.equal(Array.isArray(requiredGroups), true, FAILURE);
    requiredGroups.pop();
    const matrixRefused = runDoctor({
      report: baseline,
      session: session("controlled-complete"),
      expected_doctor_bytes: baselineBytes,
      doctor_contract: doctorContract,
      capability_matrix: incompleteMatrix,
      doctor_corpus: doctorCorpus,
      session_contract: sessionContract
    });
    assert.equal(matrixRefused.ok, false, FAILURE);
    assert.equal(matrixRefused.reason, FAILURE, FAILURE);
  });
});
