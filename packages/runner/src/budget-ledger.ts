const REFUSED = "concurrent calls and retries can overspend or replay a different fault.";

type Fail = { ok: false; reason: string };
type BudgetState = { limit: number; reserved: number; committed: number };
type ReservationState = "reserved" | "committed" | "released" | "timed_out";
type Reservation = {
  id: string;
  effectId: string;
  costs: Record<string, number>;
  expiresAt: number | null;
};
type RecordedReservation = Reservation & { state: ReservationState };
type ReservationOk = { ok: true; reservation: Reservation };
type Snapshot = {
  ok: true;
  budgets: Record<string, { limit: number; reserved: number; committed: number }>;
  effects: string[];
};
type Ledger = {
  ok: true;
  reserve: (input: unknown) => Promise<ReservationOk | Fail>;
  commit: (input: unknown) => Promise<ReservationOk | Fail>;
  release: (input: unknown) => Promise<ReservationOk | Fail>;
  snapshot: () => Snapshot;
};

const refuse = (): Fail => ({ ok: false, reason: REFUSED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const isAmount = (value: unknown): value is number => Number.isSafeInteger(value) && value >= 0;

const ordinaryKey = (value: string): boolean => value !== "__proto__" && value !== "constructor" && value !== "prototype";

const copyReservation = (reservation: RecordedReservation): Reservation => ({
  id: reservation.id,
  effectId: reservation.effectId,
  costs: { ...reservation.costs },
  expiresAt: reservation.expiresAt
});

const parseBudgets = (value: unknown): Map<string, BudgetState> | null => {
  if (!isPlainRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  const budgets = new Map<string, BudgetState>();
  for (const [name, limit] of entries) {
    if (!ordinaryKey(name) || !isAmount(limit) || budgets.has(name)) return null;
    budgets.set(name, { limit, reserved: 0, committed: 0 });
  }
  return budgets;
};

const parseCosts = (value: unknown, budgets: Map<string, BudgetState>): Record<string, number> | null => {
  if (!isPlainRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  const costs: Record<string, number> = {};
  let hasCost = false;
  for (const [name, amount] of entries) {
    if (!ordinaryKey(name) || !isAmount(amount) || !budgets.has(name)) return null;
    costs[name] = amount;
    hasCost ||= amount > 0;
  }
  return hasCost ? costs : null;
};

const parseReservation = (value: unknown, budgets: Map<string, BudgetState>): Reservation | null => {
  if (!isPlainRecord(value)) return null;
  if (!isFilledString(value.id) || !isFilledString(value.effectId)) return null;
  const costs = parseCosts(value.costs, budgets);
  if (costs === null) return null;
  const expiresAt = value.expiresAt === undefined ? null : value.expiresAt;
  if (expiresAt !== null && !isAmount(expiresAt)) return null;
  return { id: value.id, effectId: value.effectId, costs, expiresAt };
};

const parseCommit = (value: unknown): { id: string; at: number } | null => {
  if (!isPlainRecord(value) || !isFilledString(value.id) || !isAmount(value.at)) return null;
  return { id: value.id, at: value.at };
};

const parseRelease = (value: unknown): string | null =>
  isPlainRecord(value) && isFilledString(value.id) ? value.id : null;

const canReserve = (budgets: Map<string, BudgetState>, costs: Record<string, number>): boolean =>
  Object.entries(costs).every(([name, amount]) => {
    const budget = budgets.get(name);
    return budget !== undefined && budget.reserved + budget.committed + amount <= budget.limit;
  });

const addReserved = (budgets: Map<string, BudgetState>, costs: Record<string, number>): void => {
  for (const [name, amount] of Object.entries(costs)) {
    const budget = budgets.get(name);
    if (budget !== undefined) budget.reserved += amount;
  }
};

const removeReserved = (budgets: Map<string, BudgetState>, costs: Record<string, number>): void => {
  for (const [name, amount] of Object.entries(costs)) {
    const budget = budgets.get(name);
    if (budget !== undefined) budget.reserved -= amount;
  }
};

const commitReserved = (budgets: Map<string, BudgetState>, costs: Record<string, number>): void => {
  for (const [name, amount] of Object.entries(costs)) {
    const budget = budgets.get(name);
    if (budget !== undefined) {
      budget.reserved -= amount;
      budget.committed += amount;
    }
  }
};

export const BudgetLedger = (input: unknown): Ledger | Fail => {
  if (!isPlainRecord(input)) return refuse();
  const budgets = parseBudgets(input.budgets);
  if (budgets === null) return refuse();

  const reservations = new Map<string, RecordedReservation>();
  const effects = new Set<string>();
  let tail = Promise.resolve();

  // The availability check intentionally yields before mutation. Callers that overlap therefore
  // need this boundary: without it they can all observe the same balance before any claim lands.
  const serialized = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const previous = tail;
    let unlock: (() => void) | undefined;
    tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      unlock?.();
    }
  };

  const reserve = (value: unknown): Promise<ReservationOk | Fail> =>
    serialized(async () => {
      const reservation = parseReservation(value, budgets);
      if (reservation === null || reservations.has(reservation.id) || effects.has(reservation.effectId)) return refuse();
      if (!canReserve(budgets, reservation.costs)) return refuse();
      await Promise.resolve();
      addReserved(budgets, reservation.costs);
      reservations.set(reservation.id, { ...reservation, state: "reserved" });
      effects.add(reservation.effectId);
      return { ok: true, reservation: copyReservation({ ...reservation, state: "reserved" }) };
    });

  const commit = (value: unknown): Promise<ReservationOk | Fail> =>
    serialized(async () => {
      const request = parseCommit(value);
      if (request === null) return refuse();
      const reservation = reservations.get(request.id);
      if (reservation === undefined || reservation.state !== "reserved") return refuse();
      if (reservation.expiresAt !== null && request.at > reservation.expiresAt) {
        removeReserved(budgets, reservation.costs);
        reservation.state = "timed_out";
        return refuse();
      }
      commitReserved(budgets, reservation.costs);
      reservation.state = "committed";
      return { ok: true, reservation: copyReservation(reservation) };
    });

  const release = (value: unknown): Promise<ReservationOk | Fail> =>
    serialized(async () => {
      const id = parseRelease(value);
      if (id === null) return refuse();
      const reservation = reservations.get(id);
      if (reservation === undefined || reservation.state !== "reserved") return refuse();
      removeReserved(budgets, reservation.costs);
      reservation.state = "released";
      return { ok: true, reservation: copyReservation(reservation) };
    });

  const snapshot = (): Snapshot => {
    const current: Record<string, { limit: number; reserved: number; committed: number }> = {};
    for (const [name, budget] of budgets) {
      current[name] = { limit: budget.limit, reserved: budget.reserved, committed: budget.committed };
    }
    return { ok: true, budgets: current, effects: [...effects] };
  };

  return { ok: true, reserve, commit, release, snapshot };
};
