import assert from "node:assert/strict";
import { describe, test } from "node:test";

const REFUSED = "concurrent calls and retries can overspend or replay a different fault.";

type Fail = { ok: false; reason: string };
type Reservation = { id: string; effectId: string; costs: Record<string, number>; expiresAt: number | null };
type ReservationOk = { ok: true; reservation: Reservation };
type CommitOk = { ok: true; reservation: Reservation };
type ReleaseOk = { ok: true; reservation: Reservation };
type BudgetSnapshot = {
  ok: true;
  budgets: Record<string, { limit: number; reserved: number; committed: number }>;
  effects: string[];
};
type BudgetLedger = {
  ok: true;
  reserve: (input: unknown) => Promise<ReservationOk | Fail>;
  commit: (input: unknown) => Promise<CommitOk | Fail>;
  release: (input: unknown) => Promise<ReleaseOk | Fail>;
  snapshot: () => BudgetSnapshot;
};
type Fault = { version: string; seed: string; sequence: number; effectId: string; kind: string };
type FaultOk = { ok: true; fault: Fault };
type FaultController = {
  ok: true;
  next: (input: unknown) => FaultOk | Fail;
  replay: (input: unknown) => FaultOk | Fail;
};
type Approval = { effectId: string; decision: "grant" | "deny"; sequence: number };
type ApprovalOk = { ok: true; approval: Approval };
type ApprovalGate = {
  ok: true;
  append: (input: unknown) => ApprovalOk | Fail;
  authorize: (input: unknown) => { ok: true; approval: Approval } | Fail;
  events: () => readonly Approval[];
};
type BudgetApi = { BudgetLedger: (input: unknown) => BudgetLedger | Fail };
type FaultApi = { FaultController: (input: unknown) => FaultController | Fail };
type ApprovalApi = { ApprovalGate: (input?: unknown) => ApprovalGate | Fail };

// A missing module or export must reach each case as undefined. Static imports turn the RED
// contract into a module-load error and erase the case-specific pinned refusal.
const loadBudget = async () => {
  try {
    return await import("../src/budget-ledger.ts");
  } catch {
    return {};
  }
};

const loadFaults = async () => {
  try {
    return await import("../src/faults.ts");
  } catch {
    return {};
  }
};

const loadApproval = async () => {
  try {
    return await import("../src/approval.ts");
  } catch {
    return {};
  }
};

const requireBudget = async (): Promise<BudgetApi> => {
  const mod = await loadBudget();
  assert.equal(typeof mod.BudgetLedger, "function", REFUSED);
  return mod as BudgetApi;
};

const requireFaults = async (): Promise<FaultApi> => {
  const mod = await loadFaults();
  assert.equal(typeof mod.FaultController, "function", REFUSED);
  return mod as FaultApi;
};

const requireApproval = async (): Promise<ApprovalApi> => {
  const mod = await loadApproval();
  assert.equal(typeof mod.ApprovalGate, "function", REFUSED);
  return mod as ApprovalApi;
};

const accepted = (result: { ok: boolean }): void => {
  assert.equal(result.ok, true, REFUSED);
};

const refused = (result: { ok: boolean; reason?: string }): void => {
  assert.equal(result.ok, false, REFUSED);
  if (!result.ok) assert.equal(result.reason, REFUSED, REFUSED);
};

const ledger = (api: BudgetApi, budgets: Record<string, number>): BudgetLedger => {
  const created = api.BudgetLedger({ budgets });
  accepted(created);
  if (!created.ok) throw new Error(REFUSED);
  return created;
};

const controller = (api: FaultApi, seed: string): FaultController => {
  const created = api.FaultController({ version: "v1", seed });
  accepted(created);
  if (!created.ok) throw new Error(REFUSED);
  return created;
};

const gate = (api: ApprovalApi): ApprovalGate => {
  const created = api.ApprovalGate();
  accepted(created);
  if (!created.ok) throw new Error(REFUSED);
  return created;
};

describe("budget-fault", () => {
  test("concurrent-budget", async () => {
    const api = await requireBudget();
    const subject = ledger(api, { tokens: 90 });

    // All calls enter before any result is awaited. A check-then-yield implementation lets every
    // call observe the same available balance, while a reservation critical section admits three.
    const overlapping = Array.from({ length: 5 }, (_, index) =>
      subject.reserve({
        id: `concurrent-${index}`,
        effectId: `concurrent-effect-${index}`,
        costs: { tokens: 30 },
        expiresAt: 10
      })
    );
    const results = await Promise.all(overlapping);
    assert.equal(results.filter((result) => result.ok).length, 3, REFUSED);
    assert.equal(results.filter((result) => !result.ok).length, 2, REFUSED);
    for (const result of results) {
      if (!result.ok) assert.equal(result.reason, REFUSED, REFUSED);
    }
    const snapshot = subject.snapshot();
    assert.equal(snapshot.budgets.tokens.reserved, 90, REFUSED);
    assert.equal(snapshot.budgets.tokens.committed, 0, REFUSED);
  });

  test("refund", async () => {
    const api = await requireBudget();
    const subject = ledger(api, { tokens: 100 });

    const tooLarge = await subject.reserve({ id: "too-large", effectId: "too-large", costs: { tokens: 101 } });
    refused(tooLarge);
    const first = await subject.reserve({ id: "refundable", effectId: "refundable", costs: { tokens: 60 } });
    accepted(first);
    if (!first.ok) throw new Error(REFUSED);
    const released = await subject.release({ id: first.reservation.id });
    accepted(released);
    const replacement = await subject.reserve({ id: "replacement", effectId: "replacement", costs: { tokens: 100 } });
    accepted(replacement);
  });

  test("timeout", async () => {
    const api = await requireBudget();
    const subject = ledger(api, { tokens: 10 });

    const expired = await subject.reserve({ id: "expired", effectId: "expired", costs: { tokens: 10 }, expiresAt: 10 });
    accepted(expired);
    if (!expired.ok) throw new Error(REFUSED);
    const afterDeadline = await subject.commit({ id: expired.reservation.id, at: 11 });
    refused(afterDeadline);
    const replacement = await subject.reserve({ id: "after-timeout", effectId: "after-timeout", costs: { tokens: 10 }, expiresAt: 20 });
    accepted(replacement);
    if (!replacement.ok) throw new Error(REFUSED);
    const atDeadline = await subject.commit({ id: replacement.reservation.id, at: 20 });
    accepted(atDeadline);
  });

  test("seed-replay", async () => {
    const api = await requireFaults();
    const sameSeed = controller(api, "seed-alpha");
    const issued = sameSeed.next({ effectId: "timeout-effect" });
    accepted(issued);
    if (!issued.ok) throw new Error(REFUSED);
    assert.equal(issued.fault.version, "v1", REFUSED);
    assert.equal(issued.fault.seed, "seed-alpha", REFUSED);
    const replayed = sameSeed.replay(issued.fault);
    accepted(replayed);
    if (!replayed.ok) throw new Error(REFUSED);
    assert.deepEqual(replayed.fault, issued.fault, REFUSED);
    refused(sameSeed.replay({ ...issued.fault, version: "v2" }));

    const differentSeed = controller(api, "seed-bravo").next({ effectId: "timeout-effect" });
    accepted(differentSeed);
    if (!differentSeed.ok) throw new Error(REFUSED);
    assert.notEqual(differentSeed.fault.kind, issued.fault.kind, REFUSED);
  });

  test("approval-deny", async () => {
    const api = await requireApproval();
    const subject = gate(api);

    const denied = subject.append({ effectId: "denied-effect", decision: "deny" });
    accepted(denied);
    const deniedAuthorization = subject.authorize({ effectId: "denied-effect" });
    refused(deniedAuthorization);
    const granted = subject.append({ effectId: "granted-effect", decision: "grant" });
    accepted(granted);
    const grantedAuthorization = subject.authorize({ effectId: "granted-effect" });
    accepted(grantedAuthorization);
    const approvals = subject.events();
    assert.equal(approvals.length, 2, REFUSED);
    assert.equal(approvals[0].decision, "deny", REFUSED);
    assert.equal(approvals[1].decision, "grant", REFUSED);
  });

  test("duplicate-effect", async () => {
    const api = await requireBudget();
    const subject = ledger(api, { tokens: 30 });

    const first = await subject.reserve({ id: "effect-first", effectId: "exactly-once", costs: { tokens: 10 } });
    accepted(first);
    const duplicate = await subject.reserve({ id: "effect-retry", effectId: "exactly-once", costs: { tokens: 10 } });
    refused(duplicate);
    const distinct = await subject.reserve({ id: "effect-distinct", effectId: "different-effect", costs: { tokens: 10 } });
    accepted(distinct);
    assert.deepEqual(subject.snapshot().effects, ["exactly-once", "different-effect"], REFUSED);
  });
});
