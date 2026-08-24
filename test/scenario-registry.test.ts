import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const UNSEALED = "scenario can start without sealed budgets/opportunities/oracle/exposure.";

type LoadResult = { ok: boolean; scenario?: Record<string, unknown> };
type ScenarioRegistryApi = { loadScenario?: (input: unknown) => LoadResult };

const loadRegistry = async (): Promise<ScenarioRegistryApi> => {
  try {
    return (await import("../src/_deferred/scenario-registry.ts")) as ScenarioRegistryApi;
  } catch {
    return {};
  }
};

const requireLoader = async (): Promise<(input: unknown) => LoadResult> => {
  const registry = await loadRegistry();
  assert.equal(typeof registry.loadScenario, "function", UNSEALED);
  if (typeof registry.loadScenario !== "function") throw new Error(UNSEALED);
  return registry.loadScenario;
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const digest = (value: unknown): string => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const accepted = (result: LoadResult): Record<string, unknown> => {
  assert.equal(result.ok, true, UNSEALED);
  assert.equal(isRecord(result.scenario), true, UNSEALED);
  if (!isRecord(result.scenario)) throw new Error(UNSEALED);
  return result.scenario;
};

const refused = (result: LoadResult): void => {
  assert.equal(result.ok, false, UNSEALED);
};

const PRIMARY = ["FAM4-OPP-M12", "FAM4-OPP-M13", "FAM4-OPP-M14"];
const SECONDARY = ["FAM4-OPP-M17", "FAM4-OPP-M18"];
const WORKER_VISIBLE = ["worker/FAM-4/prompt", "worker/FAM-4/workspace"];
const BUDGETS = { time_minutes: 7, token_limit: 24000, tool_call_limit: 120 };
const FAULT_DIGEST = `sha256:${"a".repeat(64)}`;
const ORACLE_DIGEST = `sha256:${"b".repeat(64)}`;
const EXPOSURE_DIGEST = `sha256:${"c".repeat(64)}`;

const body = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema_version: "scenario-registry-v1",
  suite: "coding-core-v0",
  scenario_id: "coding-core-v0/form-a/fam-4-loop-state",
  family: "FAM-4",
  form: "A",
  version: "v0",
  budgets: { ...BUDGETS },
  primary_opportunity_ids: [...PRIMARY],
  secondary_opportunity_ids: [...SECONDARY],
  worker_visible: [...WORKER_VISIBLE],
  fault_digest: FAULT_DIGEST,
  oracle_digest: ORACLE_DIGEST,
  exposure_digest: EXPOSURE_DIGEST,
  ...changes
});

const sealed = (changes: Record<string, unknown> = {}): Record<string, unknown> => {
  const unsigned = body(changes);
  return { ...unsigned, signature: digest(unsigned) };
};

const without = (field: string): Record<string, unknown> => {
  const unsigned = body();
  delete unsigned[field];
  if (field === "signature") return unsigned;
  return { ...unsigned, signature: digest(unsigned) };
};

describe("scenario-registry", () => {
  test("valid", async () => {
    const loadScenario = await requireLoader();
    const fromRegistry = JSON.parse(readFileSync(new URL("../suites/coding-core-v0/registry.json", import.meta.url), "utf8")) as unknown;
    assert.deepEqual(accepted(loadScenario(fromRegistry)), sealed(), UNSEALED);
    accepted(loadScenario(sealed()));

    for (const field of ["schema_version", "suite", "scenario_id", "family", "form", "version"]) {
      refused(loadScenario(sealed({ [field]: "" })));
    }

    const unsealedExtra = sealed();
    unsealedExtra.unregistered_field = "not-sealed";
    refused(loadScenario(unsealedExtra));
    refused(loadScenario(sealed({ budgets: {} })));
    refused(loadScenario(sealed({ budgets: "not-a-budget" })));
    for (const field of ["time_minutes", "token_limit", "tool_call_limit"]) {
      refused(loadScenario(sealed({ budgets: { ...BUDGETS, [field]: 0 } })));
      refused(loadScenario(sealed({ budgets: { ...BUDGETS, [field]: -1 } })));
    }
  });

  test("late-edit", async () => {
    const loadScenario = await requireLoader();
    const source = sealed();
    const loaded = accepted(loadScenario(source));
    const sourceBudgets = source.budgets;
    const sourcePrimary = source.primary_opportunity_ids;
    const sourceVisible = source.worker_visible;
    if (isRecord(sourceBudgets)) sourceBudgets.time_minutes = 1;
    if (Array.isArray(sourcePrimary)) sourcePrimary[0] = "FAM4-OPP-M99";
    if (Array.isArray(sourceVisible)) sourceVisible[0] = "worker/FAM-4/late-edit";
    source.fault_digest = `sha256:${"d".repeat(64)}`;

    assert.deepEqual(loaded.budgets, BUDGETS, UNSEALED);
    assert.deepEqual(loaded.primary_opportunity_ids, PRIMARY, UNSEALED);
    assert.deepEqual(loaded.worker_visible, WORKER_VISIBLE, UNSEALED);
    assert.equal(loaded.fault_digest, FAULT_DIGEST, UNSEALED);
    assert.equal(Object.isFrozen(loaded), true, UNSEALED);
    assert.equal(Object.isFrozen(loaded.budgets), true, UNSEALED);
    assert.equal(Object.isFrozen(loaded.primary_opportunity_ids), true, UNSEALED);
    assert.equal(Object.isFrozen(loaded.worker_visible), true, UNSEALED);
    assert.throws(() => {
      const visible = loaded.worker_visible;
      if (Array.isArray(visible)) visible.push("worker/FAM-4/late-edit");
    }, undefined, UNSEALED);

    const edited = sealed({ primary_opportunity_ids: ["FAM4-OPP-M12", "FAM4-OPP-M99", "FAM4-OPP-M14"] });
    edited.signature = digest(body());
    refused(loadScenario(edited));

    const unstable = sealed();
    let familyReads = 0;
    Object.defineProperty(unstable, "family", {
      enumerable: true,
      get: () => {
        familyReads += 1;
        return familyReads === 1 ? "FAM-4" : "FAM-4-late-edit";
      }
    });
    assert.equal(accepted(loadScenario(unstable)).family, "FAM-4", UNSEALED);
    accepted(loadScenario(sealed()));
  });

  test("oracle-visible", async () => {
    const loadScenario = await requireLoader();
    accepted(loadScenario(sealed()));
    refused(loadScenario(sealed({ worker_visible: "not-a-visibility-list" })));
    refused(loadScenario(sealed({ worker_visible: [] })));
    refused(loadScenario(sealed({ worker_visible: [WORKER_VISIBLE[0], WORKER_VISIBLE[0]] })));
    refused(loadScenario(sealed({ worker_visible: ["oracle/FAM-4/sealed"] })));
    refused(loadScenario(sealed({ worker_visible: [ORACLE_DIGEST] })));
    accepted(loadScenario(sealed({ worker_visible: ["worker/FAM-4/prompt"] })));
  });

  test("over-primary", async () => {
    const loadScenario = await requireLoader();
    accepted(loadScenario(sealed()));
    refused(loadScenario(sealed({ primary_opportunity_ids: "not-an-opportunity-list" })));
    refused(loadScenario(sealed({ primary_opportunity_ids: [] })));
    accepted(loadScenario(sealed({ primary_opportunity_ids: [...PRIMARY, "FAM4-OPP-M16"] })));
    refused(loadScenario(sealed({ primary_opportunity_ids: [...PRIMARY, "FAM4-OPP-M16", "FAM4-OPP-M19"] })));
    refused(loadScenario(sealed({ primary_opportunity_ids: ["", PRIMARY[1], PRIMARY[2]] })));
    refused(loadScenario(sealed({ secondary_opportunity_ids: [] })));
    refused(loadScenario(sealed({ secondary_opportunity_ids: "not-an-opportunity-list" })));
    refused(loadScenario(sealed({ secondary_opportunity_ids: [SECONDARY[0], ""] })));
    accepted(loadScenario(sealed({ secondary_opportunity_ids: [SECONDARY[0]] })));
  });

  test("duplicate-opportunity", async () => {
    const loadScenario = await requireLoader();
    accepted(loadScenario(sealed()));
    refused(loadScenario(sealed({ primary_opportunity_ids: [PRIMARY[0], PRIMARY[0], PRIMARY[2]] })));
    refused(loadScenario(sealed({ secondary_opportunity_ids: [SECONDARY[0], SECONDARY[0]] })));
    refused(loadScenario(sealed({ secondary_opportunity_ids: [SECONDARY[0], PRIMARY[1]] })));
    accepted(loadScenario(sealed({ primary_opportunity_ids: ["FAM4-OPP-M12", "FAM4-OPP-M13"] })));
    accepted(loadScenario(sealed({ secondary_opportunity_ids: ["FAM4-OPP-M17", "FAM4-OPP-M20"] })));
  });

  test("exposure-missing", async () => {
    const loadScenario = await requireLoader();
    accepted(loadScenario(sealed()));
    for (const field of ["fault_digest", "oracle_digest", "exposure_digest", "signature"]) {
      refused(loadScenario(without(field)));
    }
    for (const field of ["fault_digest", "oracle_digest", "exposure_digest"]) {
      refused(loadScenario(sealed({ [field]: "sha256:broken" })));
    }
    refused(loadScenario(sealed({ signature: `sha256:${"e".repeat(64)}` })));
  });
});
