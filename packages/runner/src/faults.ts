const REFUSED = "concurrent calls and retries can overspend or replay a different fault.";
const VERSION = "v1";

type Fail = { ok: false; reason: string };
type Fault = { version: string; seed: string; sequence: number; effectId: string; kind: string };
type FaultOk = { ok: true; fault: Fault };
type Controller = {
  ok: true;
  next: (input: unknown) => FaultOk | Fail;
  replay: (input: unknown) => FaultOk | Fail;
};

const refuse = (): Fail => ({ ok: false, reason: REFUSED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isSequence = (value: unknown): value is number => Number.isSafeInteger(value) && value >= 0;

// This intentionally derives the issued fault, rather than merely echoing the seed. A constant
// kind would make different seeds indistinguishable while still looking replayable in a trace.
const selector = (seed: string, effectId: string, sequence: number): string => {
  let value = 2166136261;
  for (const character of `${seed}\u0000${effectId}\u0000${sequence}`) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
};

const faultFor = (seed: string, effectId: string, sequence: number): Fault => ({
  version: VERSION,
  seed,
  sequence,
  effectId,
  kind: `fault-${selector(seed, effectId, sequence)}`
});

const parseEffectId = (value: unknown): string | null =>
  isPlainRecord(value) && isFilledString(value.effectId) ? value.effectId : null;

const parseFault = (value: unknown): Fault | null => {
  if (!isPlainRecord(value)) return null;
  if (!isFilledString(value.version) || !isFilledString(value.seed) || !isSequence(value.sequence) || !isFilledString(value.effectId) || !isFilledString(value.kind)) {
    return null;
  }
  return {
    version: value.version,
    seed: value.seed,
    sequence: value.sequence,
    effectId: value.effectId,
    kind: value.kind
  };
};

export const FaultController = (input: unknown): Controller | Fail => {
  if (!isPlainRecord(input) || input.version !== VERSION || !isFilledString(input.seed)) return refuse();
  const seed = input.seed;
  const issued = new Map<string, Fault>();

  const next = (input: unknown): FaultOk | Fail => {
    const effectId = parseEffectId(input);
    if (effectId === null) return refuse();
    const existing = issued.get(effectId);
    if (existing !== undefined) return { ok: true, fault: { ...existing } };
    const fault = faultFor(seed, effectId, issued.size);
    issued.set(effectId, fault);
    return { ok: true, fault: { ...fault } };
  };

  const replay = (input: unknown): FaultOk | Fail => {
    const recorded = parseFault(input);
    if (recorded === null || recorded.version !== VERSION || recorded.seed !== seed) return refuse();
    const expected = faultFor(seed, recorded.effectId, recorded.sequence);
    if (recorded.kind !== expected.kind) return refuse();
    return { ok: true, fault: expected };
  };

  return { ok: true, next, replay };
};
