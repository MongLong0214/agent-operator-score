const REFUSED = "treatment/adherence/deviation/cost and baseline changes cannot be distinguished.";
const SPRINT_DAYS = 7;

type Failure = { ok: false; reason: string };
type Success = { ok: true };
type Result = Success | Failure;
type Treatment = { id: string; levers: readonly string[] };
type Adherence = { treatmentId: string; day: number };
type Deviation = { day: number; reason: string };
type Cost = { day: number; amount: number };
type Change = { scope: "local" | "baseline"; change: string };
type Snapshot = {
  state: "open" | "closed";
  durationDays: 7;
  baseline: string;
  treatment: Treatment | null;
  adherence: readonly Adherence[];
  deviations: readonly Deviation[];
  costs: readonly Cost[];
  localChanges: readonly string[];
};
type Ledger = {
  ok: true;
  recordTreatment: (input: unknown) => Result;
  recordAdherence: (input: unknown) => Result;
  recordDeviation: (input: unknown) => Result;
  recordCost: (input: unknown) => Result;
  recordChange: (input: unknown) => Result;
  close: () => Result;
  snapshot: () => Snapshot;
};

const refuse = (): Failure => ({ ok: false, reason: REFUSED });
const accept = (): Success => ({ ok: true });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isSprintDay = (value: unknown): value is number =>
  Number.isSafeInteger(value) && value >= 1 && value <= SPRINT_DAYS;

const copyTreatment = (treatment: Treatment): Treatment => ({ id: treatment.id, levers: Object.freeze([...treatment.levers]) });

const copyAdherence = (adherence: Adherence): Adherence => ({ ...adherence });

const copyDeviation = (deviation: Deviation): Deviation => ({ ...deviation });

const copyCost = (cost: Cost): Cost => ({ ...cost });

const parseBaseline = (input: unknown): string | null =>
  isPlainRecord(input) && isFilledString(input.baseline) ? input.baseline : null;

const parseTreatment = (input: unknown): Treatment | null => {
  if (!isPlainRecord(input) || !isFilledString(input.id) || !Array.isArray(input.levers)) return null;
  if (input.levers.length !== 1 || !input.levers.every(isFilledString)) return null;
  return { id: input.id, levers: Object.freeze([...input.levers]) };
};

const parseAdherence = (input: unknown): Adherence | null => {
  if (!isPlainRecord(input) || !isSprintDay(input.day)) return null;
  return { treatmentId: input.treatmentId as string, day: input.day };
};

const parseDeviation = (input: unknown): Deviation | null => {
  if (!isPlainRecord(input) || !isSprintDay(input.day) || !isFilledString(input.reason)) return null;
  return { day: input.day, reason: input.reason };
};

const parseCost = (input: unknown): Cost | null => {
  if (!isPlainRecord(input) || !isSprintDay(input.day) || !Number.isSafeInteger(input.amount) || input.amount < 1) return null;
  return { day: input.day, amount: input.amount };
};

const parseChange = (input: unknown): Change | null => {
  if (!isPlainRecord(input) || !isFilledString(input.change)) return null;
  return { scope: input.scope as Change["scope"], change: input.change };
};

class SevenDaySprintLedger implements Ledger {
  readonly ok = true as const;
  readonly #baseline: string;
  #state: "open" | "closed" = "open";
  #treatment: Treatment | null = null;
  readonly #adherence: Adherence[] = [];
  readonly #deviations: Deviation[] = [];
  readonly #costs: Cost[] = [];
  readonly #localChanges: string[] = [];

  constructor(baseline: string) {
    this.#baseline = baseline;
  }

  #isOpen(): boolean {
    return this.#state === "open";
  }

  recordTreatment(input: unknown): Result {
    const treatment = parseTreatment(input);
    if (!this.#isOpen() || treatment === null || this.#treatment !== null) return refuse();
    this.#treatment = treatment;
    return accept();
  }

  recordAdherence(input: unknown): Result {
    const adherence = parseAdherence(input);
    const treatmentId = this.#treatment?.id;
    if (!this.#isOpen() || adherence === null || adherence.treatmentId !== treatmentId) {
      return refuse();
    }
    this.#adherence.push(adherence);
    return accept();
  }

  recordDeviation(input: unknown): Result {
    const deviation = parseDeviation(input);
    if (!this.#isOpen() || deviation === null) return refuse();
    this.#deviations.push(deviation);
    return accept();
  }

  recordCost(input: unknown): Result {
    const cost = parseCost(input);
    if (!this.#isOpen() || cost === null) return refuse();
    this.#costs.push(cost);
    return accept();
  }

  recordChange(input: unknown): Result {
    const change = parseChange(input);
    if (!this.#isOpen() || change === null || change.scope !== "local") return refuse();
    this.#localChanges.push(change.change);
    return accept();
  }

  close(): Result {
    if (!this.#isOpen()) return refuse();
    this.#state = "closed";
    return accept();
  }

  snapshot(): Snapshot {
    return Object.freeze({
      state: this.#state,
      durationDays: SPRINT_DAYS,
      baseline: this.#baseline,
      treatment: this.#treatment === null ? null : Object.freeze(copyTreatment(this.#treatment)),
      adherence: Object.freeze(this.#adherence.map(copyAdherence)),
      deviations: Object.freeze(this.#deviations.map(copyDeviation)),
      costs: Object.freeze(this.#costs.map(copyCost)),
      localChanges: Object.freeze([...this.#localChanges])
    });
  }
}

export const SprintLedger = (input: unknown): Ledger | Failure => {
  const baseline = parseBaseline(input);
  return baseline === null ? refuse() : new SevenDaySprintLedger(baseline);
};
