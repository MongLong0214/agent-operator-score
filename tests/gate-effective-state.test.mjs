import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Namespace imports: a missing named export must stay undefined so each case
// can fail with its pinned message. A static named import would be a
// module-load SyntaxError, which the RED contract treats as an unrelated stop.
import * as administration from "../scripts/validate-gate-administration.mjs";
import * as resolver from "../scripts/resolve-execution-state.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(root, "fixtures/governance/effective-state");
const canonicalRegistryRelativePath = "docs/decisions/maintainer-gate-registry.v2.json";
const LEGACY_UNAUTHENTICATED = "LEGACY_UNAUTHENTICATED";
const EFFECTIVE_STATE_MISMATCH = (actual, required) =>
  `effective state mismatch: actual ${actual}; required ${required}`;
const FREEZE_CONTRIBUTION_MESSAGE = "legacy unauthenticated row still contributes a freeze input";

const assertExported = (value, message) => assert.equal(typeof value, "function", message);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const loadFixture = (id) =>
  JSON.parse(readFileSync(resolve(fixtureRoot, `${id}.json`), "utf8"));

const thrownMessage = (fn, input) => {
  try {
    fn(input);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const deriveInputFromFixture = (fixture) => {
  const sourceRegistry = fixture.source_registry;
  const encoded = Buffer.from(JSON.stringify(sourceRegistry), "utf8");
  return {
    source_registry: sourceRegistry,
    source_bytes: encoded,
    source_sha256: Object.hasOwn(fixture, "source_sha256") ? fixture.source_sha256 : sha256(encoded),
    source_path: fixture.source_path,
    github_approval_facts: fixture.github_approval_facts
  };
};

const liveRegistryInput = () => {
  const sourceBytes = readFileSync(resolve(root, canonicalRegistryRelativePath));
  return {
    source_registry: JSON.parse(sourceBytes.toString("utf8")),
    source_bytes: sourceBytes,
    source_sha256: sha256(sourceBytes),
    github_approval_facts: []
  };
};

const freezeInputsOf = (batches) => {
  const inputs = [];
  for (const batch of Array.isArray(batches) ? batches : []) {
    if (batch?.status !== "ACCEPTED") continue;
    for (const artifact of Array.isArray(batch.artifacts) ? batch.artifacts : []) {
      if (typeof artifact?.path === "string" && typeof artifact?.sha256 === "string" && typeof artifact?.kind === "string") {
        inputs.push(`${artifact.kind}:${artifact.path}:${artifact.sha256}`);
      }
    }
  }
  return inputs.sort();
};

const factsFromRegistry = (sourceRegistry) => ({
  gateBatches: Array.isArray(sourceRegistry?.batches) ? sourceRegistry.batches.map((batch) => ({ ...batch })) : []
});

const actualEffectiveState = (derived, index = 0) => {
  const record = derived?.records?.[index];
  return typeof record?.effective_gate_state === "string" ? record.effective_gate_state : "ACCEPTED";
};

test("accepted-self-authored-row-is-legacy-unauthenticated", () => {
  const fixture = loadFixture("accepted-self-authored");
  const derived = typeof administration.deriveEffectiveGateState === "function"
    ? administration.deriveEffectiveGateState(deriveInputFromFixture(fixture))
    : null;
  const actual = actualEffectiveState(derived);
  assert.equal(actual, LEGACY_UNAUTHENTICATED, EFFECTIVE_STATE_MISMATCH(actual, LEGACY_UNAUTHENTICATED));
  const record = derived?.records?.[0];
  assert.equal(record.source_record_id, "accepted-self-authored-row", EFFECTIVE_STATE_MISMATCH(actual, LEGACY_UNAUTHENTICATED));
  assert.equal(record.structural_state, "ACCEPTED", EFFECTIVE_STATE_MISMATCH(actual, LEGACY_UNAUTHENTICATED));
  assert.equal(typeof record.source_digest, "string", EFFECTIVE_STATE_MISMATCH(actual, LEGACY_UNAUTHENTICATED));
  assert.match(record.source_digest, /^[a-f0-9]{64}$/, EFFECTIVE_STATE_MISMATCH(actual, LEGACY_UNAUTHENTICATED));
  assert.equal(typeof record.effective_gate_state_reason, "string", EFFECTIVE_STATE_MISMATCH(actual, LEGACY_UNAUTHENTICATED));
  assert.notEqual(record.effective_gate_state_reason.length, 0, EFFECTIVE_STATE_MISMATCH(actual, LEGACY_UNAUTHENTICATED));
});

test("legacy-unauthenticated-row-does-not-freeze-artifacts", () => {
  const fixture = loadFixture("accepted-self-authored");
  const facts = factsFromRegistry(fixture.source_registry);
  const structuralFreeze = freezeInputsOf(facts.gateBatches);
  assert.notEqual(structuralFreeze.length, 0, FREEZE_CONTRIBUTION_MESSAGE);
  assert.equal(
    structuralFreeze.some((entry) => entry.includes(fixture.node_22_18_correction_digest)),
    true,
    FREEZE_CONTRIBUTION_MESSAGE
  );

  let appliedFreeze = structuralFreeze;
  if (
    typeof administration.deriveEffectiveGateState === "function" &&
    typeof resolver.applyEffectiveGateStateToGateFacts === "function"
  ) {
    const derived = administration.deriveEffectiveGateState(deriveInputFromFixture(fixture));
    const applied = resolver.applyEffectiveGateStateToGateFacts(facts, derived);
    appliedFreeze = Array.isArray(applied?.freeze_inputs)
      ? [...applied.freeze_inputs].sort()
      : freezeInputsOf(applied?.gateBatches ?? facts.gateBatches);
  }

  assert.deepEqual(appliedFreeze, [], FREEZE_CONTRIBUTION_MESSAGE);
  assert.equal(
    appliedFreeze.some((entry) => String(entry).includes(fixture.node_22_18_correction_digest)),
    false,
    FREEZE_CONTRIBUTION_MESSAGE
  );
});

test("effective-state-census-covers-every-accepted-row", () => {
  const message = "effective-state census does not cover every structurally ACCEPTED row";
  assertExported(administration.deriveEffectiveGateState, message);
  const input = liveRegistryInput();
  const accepted = (input.source_registry.batches ?? []).filter((batch) => batch?.status === "ACCEPTED");
  assert.notEqual(accepted.length, 0, message);
  const derived = administration.deriveEffectiveGateState(input);
  assert.equal(Array.isArray(derived?.records), true, message);
  assert.equal(derived.records.length, accepted.length, message);
  const byId = new Map(derived.records.map((record) => [record.source_record_id, record]));
  for (const batch of accepted) {
    const record = byId.get(batch.id);
    assert.equal(record !== undefined, true, message);
    assert.equal(record.structural_state, "ACCEPTED", message);
    assert.equal(record.effective_gate_state, LEGACY_UNAUTHENTICATED, message);
    assert.match(record.source_digest, /^[a-f0-9]{64}$/, message);
    assert.equal(typeof record.effective_gate_state_reason, "string", message);
    assert.notEqual(record.effective_gate_state_reason.length, 0, message);
  }
});

test("effective-state-missing-input-is-rejected", () => {
  const message = "effective state rejected: missing input";
  assertExported(administration.deriveEffectiveGateState, message);
  assert.equal(thrownMessage(administration.deriveEffectiveGateState), message, message);
  assert.equal(thrownMessage(administration.deriveEffectiveGateState, {}), message, message);
  if (typeof resolver.applyEffectiveGateStateToGateFacts === "function") {
    const applied = resolver.applyEffectiveGateStateToGateFacts({ gateBatches: [] }, { ok: false });
    assert.deepEqual(applied?.freeze_inputs ?? ["unexpected-freeze"], [], message);
  }
});

test("effective-state-duplicate-input-is-rejected", () => {
  const message = "effective state rejected: duplicate input";
  assertExported(administration.deriveEffectiveGateState, message);
  const fixture = loadFixture("duplicate-input");
  assert.equal(
    thrownMessage(administration.deriveEffectiveGateState, deriveInputFromFixture(fixture)),
    message,
    message
  );
});

test("effective-state-unsafe-input-is-rejected", () => {
  const message = "effective state rejected: unsafe input";
  assertExported(administration.deriveEffectiveGateState, message);
  const fixture = loadFixture("unsafe-input");
  assert.equal(
    thrownMessage(administration.deriveEffectiveGateState, deriveInputFromFixture(fixture)),
    message,
    message
  );
});

test("effective-state-malformed-input-is-rejected", () => {
  const message = "effective state rejected: malformed input";
  assertExported(administration.deriveEffectiveGateState, message);
  const fixture = loadFixture("malformed-input");
  assert.equal(
    thrownMessage(administration.deriveEffectiveGateState, deriveInputFromFixture(fixture)),
    message,
    message
  );
  assert.equal(thrownMessage(administration.deriveEffectiveGateState, "not-a-source"), message, message);
});

test("effective-state-unverified-input-is-rejected", () => {
  const message = "effective state rejected: unverified input";
  assertExported(administration.deriveEffectiveGateState, message);
  const fixture = loadFixture("unverified-input");
  assert.equal(
    thrownMessage(administration.deriveEffectiveGateState, deriveInputFromFixture(fixture)),
    message,
    message
  );
});
