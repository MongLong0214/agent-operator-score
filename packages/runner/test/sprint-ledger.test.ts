import assert from "node:assert/strict";
import { describe, test } from "node:test";

const REFUSED = "treatment/adherence/deviation/cost and baseline changes cannot be distinguished.";

type Failure = { ok: false; reason: string };
type Success = { ok: true };
type Result = Success | Failure;
type Treatment = { id: string; levers: readonly string[] };
type Adherence = { treatmentId: string; day: number };
type Deviation = { day: number; reason: string };
type Cost = { day: number; amount: number };
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
type SprintApi = { SprintLedger: (input: unknown) => Ledger | Failure };

// A missing module or export must reach every RED case as the pinned refusal. A static import
// would instead end the file before Node can report the six case names.
const loadSprint = async () => {
  try {
    return await import("../src/sprint-ledger.ts");
  } catch {
    return {};
  }
};

const requireSprint = async (): Promise<SprintApi> => {
  const mod = await loadSprint();
  assert.equal(typeof mod.SprintLedger, "function", REFUSED);
  return mod as SprintApi;
};

const accepted = (result: { ok: boolean }): void => {
  assert.equal(result.ok, true, REFUSED);
};

const refused = (result: { ok: boolean; reason?: string }): void => {
  assert.equal(result.ok, false, REFUSED);
  if (!result.ok) assert.equal(result.reason, REFUSED, REFUSED);
};

const sprint = (api: SprintApi, baseline = "sleep begins at 23:00"): Ledger => {
  const created = api.SprintLedger({ baseline });
  accepted(created);
  if (!created.ok) throw new Error(REFUSED);
  return created;
};

const treatment = (id = "sleep-window", levers: readonly string[] = ["move bedtime earlier"]): Treatment => ({ id, levers });

describe("sprint-ledger", () => {
  test("one-treatment", async () => {
    const api = await requireSprint();
    const subject = sprint(api);

    accepted(subject.recordTreatment(treatment()));
    accepted(subject.recordAdherence({ treatmentId: "sleep-window", day: 1 }));
    const noTreatment = sprint(api);
    refused(noTreatment.recordAdherence({ treatmentId: "sleep-window", day: 1 }));
    refused(subject.recordAdherence({ treatmentId: "sleep-window", day: 0 }));
    refused(subject.recordAdherence({ treatmentId: "sleep-window", day: 1.5 }));
    accepted(subject.recordAdherence({ treatmentId: "sleep-window", day: 7 }));
    refused(subject.recordAdherence({ treatmentId: "sleep-window", day: 8 }));
    refused(subject.recordAdherence({ treatmentId: "another-treatment", day: 1 }));
    assert.deepEqual(
      subject.snapshot(),
      {
        state: "open",
        durationDays: 7,
        baseline: "sleep begins at 23:00",
        treatment: treatment(),
        adherence: [
          { treatmentId: "sleep-window", day: 1 },
          { treatmentId: "sleep-window", day: 7 }
        ],
        deviations: [],
        costs: [],
        localChanges: []
      },
      REFUSED
    );
  });

  test("two-treatment", async () => {
    const api = await requireSprint();

    const bundled = sprint(api);
    refused(bundled.recordTreatment(treatment("sleep-window", ["move bedtime earlier", "get morning light"])));

    const noLever = sprint(api);
    refused(noLever.recordTreatment(treatment("sleep-window", [])));

    const blankLever = sprint(api);
    refused(blankLever.recordTreatment(treatment("sleep-window", [""])));

    const blankId = sprint(api);
    refused(blankId.recordTreatment(treatment("", ["move bedtime earlier"])));

    const nonList = sprint(api);
    refused(nonList.recordTreatment({ id: "sleep-window", levers: "x" }));

    const malformed = sprint(api);
    refused(malformed.recordTreatment(null));

    const single = sprint(api);
    accepted(single.recordTreatment(treatment()));

    const second = sprint(api);
    accepted(second.recordTreatment(treatment()));
    refused(second.recordTreatment(treatment("morning-light", ["get morning light"])));
  });

  test("baseline-mutation", async () => {
    const api = await requireSprint();
    const subject = sprint(api);
    const local = { scope: "local", change: "move the reminder to 21:30" };
    const baseline = { scope: "baseline", change: "move the reminder to 21:30" };
    const unknownScope = { scope: "outside", change: "move the reminder to 21:30" };

    accepted(subject.recordChange(local));
    refused(subject.recordChange(baseline));
    refused(subject.recordChange(unknownScope));
    assert.deepEqual(
      subject.snapshot(),
      {
        state: "open",
        durationDays: 7,
        baseline: "sleep begins at 23:00",
        treatment: null,
        adherence: [],
        deviations: [],
        costs: [],
        localChanges: ["move the reminder to 21:30"]
      },
      REFUSED
    );
  });

  test("deviation", async () => {
    const api = await requireSprint();
    const subject = sprint(api);

    accepted(subject.recordTreatment(treatment()));
    accepted(subject.recordAdherence({ treatmentId: "sleep-window", day: 3 }));
    accepted(subject.recordDeviation({ day: 3, reason: "work deadline" }));
    refused(subject.recordDeviation({ day: 3, reason: "" }));
    accepted(subject.recordDeviation({ day: 7, reason: "travel" }));
    refused(subject.recordDeviation({ day: 8, reason: "travel" }));
    accepted(subject.recordCost({ day: 3, amount: 1 }));
    refused(subject.recordCost({ day: 3, amount: 0 }));
    refused(subject.recordCost({ day: 3, amount: 1.5 }));
    accepted(subject.recordCost({ day: 7, amount: 2 }));
    refused(subject.recordCost({ day: 8, amount: 2 }));
    assert.deepEqual(
      subject.snapshot(),
      {
        state: "open",
        durationDays: 7,
        baseline: "sleep begins at 23:00",
        treatment: treatment(),
        adherence: [{ treatmentId: "sleep-window", day: 3 }],
        deviations: [
          { day: 3, reason: "work deadline" },
          { day: 7, reason: "travel" }
        ],
        costs: [
          { day: 3, amount: 1 },
          { day: 7, amount: 2 }
        ],
        localChanges: []
      },
      REFUSED
    );
  });

  test("local-only", async () => {
    const api = await requireSprint();
    const invalid = api.SprintLedger({ baseline: "" });
    refused(invalid);
    refused(api.SprintLedger(null));
    const nullPrototype = Object.assign(Object.create(null), { baseline: "sleep begins at 23:00" });
    refused(api.SprintLedger(nullPrototype));

    const subject = sprint(api);
    accepted(subject.recordChange({ scope: "local", change: "prepare clothes before bed" }));
    refused(subject.recordChange({ scope: "local", change: "" }));
    refused(subject.recordChange(null));
    assert.deepEqual(
      subject.snapshot(),
      {
        state: "open",
        durationDays: 7,
        baseline: "sleep begins at 23:00",
        treatment: null,
        adherence: [],
        deviations: [],
        costs: [],
        localChanges: ["prepare clothes before bed"]
      },
      REFUSED
    );
  });

  test("close-state", async () => {
    const api = await requireSprint();
    const subject = sprint(api);

    accepted(subject.recordDeviation({ day: 1, reason: "work deadline" }));
    accepted(subject.close());
    refused(subject.recordDeviation({ day: 1, reason: "work deadline" }));
    refused(subject.close());
    assert.deepEqual(
      subject.snapshot(),
      {
        state: "closed",
        durationDays: 7,
        baseline: "sleep begins at 23:00",
        treatment: null,
        adherence: [],
        deviations: [{ day: 1, reason: "work deadline" }],
        costs: [],
        localChanges: []
      },
      REFUSED
    );
  });
});
