const REFUSED = "timeout/interruption can leave nonterminal state or active child.";

type Fail = { ok: false; reason: string };
type Progress = { sequence: number; evidenceDigest: string; observedAt: number };
type Verdict = { ok: true; state: "RUNNING" | "STALLED" | "TIMED_OUT"; reason?: "STALLED" | "TIMED_OUT" };
type WatchdogResult = { ok: true; check: () => Verdict | Fail };

const refuse = (): Fail => ({ ok: false, reason: REFUSED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTimestamp = (value: unknown): value is number =>
  Number.isSafeInteger(value) && value >= 0;

const progressOf = (value: unknown, now: number): Progress | null => {
  if (!isPlainRecord(value)) return null;
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || typeof value.evidenceDigest !== "string" || value.evidenceDigest.length === 0) {
    return null;
  }
  if (!isTimestamp(value.observedAt) || value.observedAt > now) return null;
  return { sequence: value.sequence, evidenceDigest: value.evidenceDigest, observedAt: value.observedAt };
};

const copyVerdict = (verdict: Verdict): Verdict =>
  verdict.reason === undefined ? { ok: true, state: verdict.state } : { ok: true, state: verdict.state, reason: verdict.reason };

export const Watchdog = (input: unknown): WatchdogResult | Fail => {
  if (!isPlainRecord(input) || typeof input.now !== "function" || typeof input.observeProgress !== "function") return refuse();
  if (!isTimestamp(input.stallAfterMs) || input.stallAfterMs === 0 || !isTimestamp(input.timeoutAt)) return refuse();

  const now = input.now as () => unknown;
  const observeProgress = input.observeProgress as () => unknown;
  const stallAfterMs = input.stallAfterMs;
  const timeoutAt = input.timeoutAt;
  let lastProgress: Progress | undefined;
  let terminal: Verdict | undefined;

  const check = (): Verdict | Fail => {
    if (terminal !== undefined) return copyVerdict(terminal);
    let currentTime: unknown;
    let observed: unknown;
    try {
      currentTime = now();
      if (!isTimestamp(currentTime)) return refuse();
      observed = observeProgress();
    } catch {
      return refuse();
    }
    const progress = progressOf(observed, currentTime);
    if (progress === null) return refuse();

    if (lastProgress === undefined) {
      lastProgress = progress;
    } else if (progress.sequence > lastProgress.sequence) {
      if (progress.observedAt <= lastProgress.observedAt) return refuse();
      lastProgress = progress;
    } else if (
      progress.sequence !== lastProgress.sequence ||
      progress.observedAt !== lastProgress.observedAt ||
      progress.evidenceDigest !== lastProgress.evidenceDigest
    ) {
      return refuse();
    }

    if (currentTime >= timeoutAt) {
      terminal = { ok: true, state: "TIMED_OUT", reason: "TIMED_OUT" };
      return copyVerdict(terminal);
    }
    // A check may observe a static artifact repeatedly, but only a changed observation advances
    // this timestamp; refreshing it here would turn the watchdog itself into a heartbeat source.
    if (currentTime - lastProgress.observedAt >= stallAfterMs) {
      terminal = { ok: true, state: "STALLED", reason: "STALLED" };
      return copyVerdict(terminal);
    }
    return { ok: true, state: "RUNNING" };
  };

  return { ok: true, check };
};
