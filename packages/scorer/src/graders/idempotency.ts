import { loadScenario, type ScenarioDefinition } from "../../../runner/src/scenario-registry.ts";

const SCENARIO_ID = "coding-core-v0/form-a/fam4-idempotency";
const REFUSAL = Object.freeze({
  ok: false as const,
  reason: "idempotency scenario violates sealed retry/evidence invariants."
});
const SHA256 = /^sha256:[a-f0-9]{64}$/;

type Fail = typeof REFUSAL;
type Pass = { ok: true; scenario_id: string; metric_id: "M13"; effect_id: string };
type Grade = Pass | Fail;

type Transition = { from: string; to: string };
type SealedOracle = {
  idempotency_key: string;
  registered_effect_id: string;
  registered_effect_digest: string;
  fresh_evidence: { revision: string; digest: string };
  transitions: readonly Transition[];
};

type SealedContract = {
  scenario: ScenarioDefinition;
  oracle: SealedOracle;
};

type Fam4IdempotencyScenario = {
  scenario: ScenarioDefinition;
  oracle: SealedOracle;
};

export const fam4IdempotencyScenario: Fam4IdempotencyScenario = {
  scenario: {
    schema_version: "scenario-registry-v1",
    suite: "coding-core-v0",
    scenario_id: "coding-core-v0/form-a/fam4-idempotency",
    family: "FAM-4",
    form: "A",
    version: "v0",
    budgets: {
      time_minutes: 7,
      token_limit: 24000,
      tool_call_limit: 120
    },
    primary_opportunity_ids: ["FAM4-OPP-M13"],
    secondary_opportunity_ids: ["FAM4-OPP-M17"],
    worker_visible: ["worker/FAM-4/prompt", "worker/FAM-4/workspace"],
    fault_digest: "sha256:071138073df3c1757ed1152872332bc7851992562619208d75f6bb888974ed88",
    oracle_digest: "sha256:08601e8f7e88baf239dd6c11b33cba4d49713f9486e14087ab3aecdb94b383d6",
    exposure_digest: "sha256:0131e309ca612490b4080e716740b4287e2c41907410c2fabe524ea1bddc01c9",
    signature: "sha256:4e05345f01bdd59a8f19ad15d6a30b52a052550d65de3a935834af8a33017dbf"
  },
  oracle: {
    idempotency_key: "idem-order-481",
    registered_effect_id: "effect-charge-481",
    registered_effect_digest: "sha256:2c7a4a4432fbb8d4f0d4ed2df76882900da3a351f8cde290f8e3ac0f045a27c6",
    fresh_evidence: {
      revision: "revision-2",
      digest: "sha256:581b9a573466e651e0f4107d70c5e6e2480d350a79bdabeb170e1f6788a06a48"
    },
    transitions: [
      { from: "PENDING", to: "EFFECT_APPLIED" },
      { from: "EFFECT_APPLIED", to: "ACKNOWLEDGEMENT_AMBIGUOUS" },
      { from: "ACKNOWLEDGEMENT_AMBIGUOUS", to: "RETRY_PENDING" },
      { from: "RETRY_PENDING", to: "ACKNOWLEDGED" }
    ]
  }
};

type LedgerEntry = { from: string; to: string; idempotency_key: string };
type Effect = { effect_id: string; effect_digest: string; idempotency_key: string };
type Acknowledgement = {
  status: string;
  effect_id: string;
  effect_digest: string;
  idempotency_key: string;
  evidence_revision: string;
  evidence_digest: string;
};
type IdempotencyRun = {
  idempotency_key: string;
  ledger: LedgerEntry[];
  effects: Effect[];
  acknowledgement: Acknowledgement;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const hasExactly = (record: Record<string, unknown>, fields: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
};

const recordOf = (value: unknown, fields: readonly string[]): Record<string, unknown> | null =>
  isPlainRecord(value) && hasExactly(value, fields) ? value : null;

const transitionOf = (value: unknown): Transition | null => {
  const record = recordOf(value, ["from", "to"]);
  if (record === null || !isFilledString(record.from) || !isFilledString(record.to)) return null;
  return { from: record.from, to: record.to };
};

const oracleOf = (value: unknown): SealedOracle | null => {
  const record = recordOf(value, [
    "idempotency_key",
    "registered_effect_id",
    "registered_effect_digest",
    "fresh_evidence",
    "transitions"
  ]);
  if (
    record === null
    || !isFilledString(record.idempotency_key)
    || !isFilledString(record.registered_effect_id)
    || !isFilledString(record.registered_effect_digest)
    || !SHA256.test(record.registered_effect_digest)
    || !Array.isArray(record.transitions)
    || record.transitions.length === 0
  ) return null;

  const fresh = recordOf(record.fresh_evidence, ["digest", "revision"]);
  if (fresh === null || !isFilledString(fresh.revision) || !isFilledString(fresh.digest) || !SHA256.test(fresh.digest)) {
    return null;
  }

  const transitions = record.transitions.map(transitionOf);
  if (transitions.some((transition): transition is null => transition === null)) return null;
  return Object.freeze({
    idempotency_key: record.idempotency_key,
    registered_effect_id: record.registered_effect_id,
    registered_effect_digest: record.registered_effect_digest,
    fresh_evidence: Object.freeze({ revision: fresh.revision, digest: fresh.digest }),
    transitions: Object.freeze(transitions)
  });
};

const loadContract = (): SealedContract | null => {
  try {
    const loaded = loadScenario(fam4IdempotencyScenario.scenario);
    if (
      !loaded.ok
      || loaded.scenario.scenario_id !== SCENARIO_ID
      || loaded.scenario.family !== "FAM-4"
      || loaded.scenario.form !== "A"
      || !loaded.scenario.primary_opportunity_ids.includes("FAM4-OPP-M13")
    ) return null;

    const oracle = oracleOf(fam4IdempotencyScenario.oracle);
    return oracle === null ? null : Object.freeze({ scenario: loaded.scenario, oracle });
  } catch {
    return null;
  }
};

const contract = loadContract();

const ledgerEntryOf = (value: unknown): LedgerEntry | null => {
  const record = recordOf(value, ["from", "idempotency_key", "to"]);
  if (
    record === null
    || !isFilledString(record.from)
    || !isFilledString(record.to)
    || !isFilledString(record.idempotency_key)
  ) return null;
  return { from: record.from, to: record.to, idempotency_key: record.idempotency_key };
};

const effectOf = (value: unknown): Effect | null => {
  const record = recordOf(value, ["effect_digest", "effect_id", "idempotency_key"]);
  if (
    record === null
    || !isFilledString(record.effect_id)
    || !isFilledString(record.effect_digest)
    || !SHA256.test(record.effect_digest)
    || !isFilledString(record.idempotency_key)
  ) return null;
  return {
    effect_id: record.effect_id,
    effect_digest: record.effect_digest,
    idempotency_key: record.idempotency_key
  };
};

const acknowledgementOf = (value: unknown): Acknowledgement | null => {
  const record = recordOf(value, [
    "effect_digest",
    "effect_id",
    "evidence_digest",
    "evidence_revision",
    "idempotency_key",
    "status"
  ]);
  if (
    record === null
    || !isFilledString(record.status)
    || !isFilledString(record.effect_id)
    || !isFilledString(record.effect_digest)
    || !SHA256.test(record.effect_digest)
    || !isFilledString(record.idempotency_key)
    || !isFilledString(record.evidence_revision)
    || !isFilledString(record.evidence_digest)
    || !SHA256.test(record.evidence_digest)
  ) return null;
  return {
    status: record.status,
    effect_id: record.effect_id,
    effect_digest: record.effect_digest,
    idempotency_key: record.idempotency_key,
    evidence_revision: record.evidence_revision,
    evidence_digest: record.evidence_digest
  };
};

const runOf = (value: unknown): IdempotencyRun | null => {
  const record = recordOf(value, ["acknowledgement", "effects", "idempotency_key", "ledger"]);
  if (
    record === null
    || !isFilledString(record.idempotency_key)
    || !Array.isArray(record.ledger)
    || !Array.isArray(record.effects)
  ) return null;

  const ledger = record.ledger.map(ledgerEntryOf);
  const effects = record.effects.map(effectOf);
  const acknowledgement = acknowledgementOf(record.acknowledgement);
  if (
    ledger.some((entry): entry is null => entry === null)
    || effects.some((effect): effect is null => effect === null)
    || acknowledgement === null
  ) return null;
  return { idempotency_key: record.idempotency_key, ledger, effects, acknowledgement };
};

const matchesTransitions = (ledger: readonly LedgerEntry[], expected: readonly Transition[]): boolean =>
  ledger.length === expected.length
  && expected.every(
    (transition, index) => ledger[index].from === transition.from && ledger[index].to === transition.to
  );

export const gradeIdempotency = (input: unknown): Grade => {
  try {
    const run = runOf(structuredClone(input));
    if (run === null || contract === null) return REFUSAL;

    const { oracle, scenario } = contract;
    const effect = run.effects[0];
    const keyIsStable = run.idempotency_key === oracle.idempotency_key
      && run.ledger.every((entry) => entry.idempotency_key === oracle.idempotency_key)
      && run.effects.every((entry) => entry.idempotency_key === oracle.idempotency_key)
      && run.acknowledgement.idempotency_key === oracle.idempotency_key;
    const oneRegisteredEffect = run.effects.length === 1
      && effect.effect_id === oracle.registered_effect_id
      && effect.effect_digest === oracle.registered_effect_digest;
    const acknowledgementIsCurrent = run.acknowledgement.status === "ambiguous"
      && run.acknowledgement.effect_id === effect.effect_id
      && run.acknowledgement.effect_digest === effect.effect_digest
      && run.acknowledgement.evidence_revision === oracle.fresh_evidence.revision
      && run.acknowledgement.evidence_digest === oracle.fresh_evidence.digest;
    if (
      !keyIsStable
      || !oneRegisteredEffect
      || !matchesTransitions(run.ledger, oracle.transitions)
      || !acknowledgementIsCurrent
    ) return REFUSAL;

    return { ok: true, scenario_id: scenario.scenario_id, metric_id: "M13", effect_id: effect.effect_id };
  } catch {
    return REFUSAL;
  }
};
