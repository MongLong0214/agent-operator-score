import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Namespace import: a missing named export must stay undefined so each case
// can fail with its pinned message. A static named import would be a
// module-load SyntaxError, which the RED contract treats as an unrelated stop.
import * as resolver from "../scripts/resolve-execution-state.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assertExported = (value, message) => assert.equal(typeof value, "function", message);

const otherwiseValidContract = (overrides = {}) => ({
  version: 1,
  modes: ["SOLE_OWNER_ADVISORY", "AUTHENTICATED_REVIEW"],
  current_mode: "SOLE_OWNER_ADVISORY",
  authenticated_review_activation: { active: false },
  claims_separation_of_duties: false,
  ...overrides
});

const declaredModes = (result) => (Array.isArray(result?.modes) ? result.modes.join(",") : "");

const thrownMessage = (fn, input) => {
  try {
    fn(input);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const d0004AuthoritySource = () =>
  JSON.parse(readFileSync(resolve(root, "docs/issues.json"), "utf8")).operational_authority;

const assertAdvisoryModeMutationKills = (result, message) => {
  assert.equal(declaredModes(result), "SOLE_OWNER_ADVISORY,AUTHENTICATED_REVIEW", message);
  assert.equal(result.governance_mode, "SOLE_OWNER_ADVISORY", message);
};

test("missing-governance-mode-is-contract-error", () => {
  const message = "governance mode contract error: missing current_mode";
  assertExported(resolver.parseGovernanceModeContract, message);
  const { current_mode: _omitted, ...missingCurrentMode } = otherwiseValidContract();
  void _omitted;
  assert.equal(thrownMessage(resolver.parseGovernanceModeContract, missingCurrentMode), message, message);
});

test("malformed-governance-mode-is-contract-error", () => {
  const message = "governance mode contract error: malformed contract";
  assertExported(resolver.parseGovernanceModeContract, message);
  assert.equal(thrownMessage(resolver.parseGovernanceModeContract, "not-a-contract"), message, message);
});

test("unknown-governance-mode-is-contract-error", () => {
  const message = "governance mode contract error: unknown mode";
  assertExported(resolver.parseGovernanceModeContract, message);
  const unknown = otherwiseValidContract({ current_mode: "NOT_A_REGISTERED_MODE" });
  assert.equal(thrownMessage(resolver.parseGovernanceModeContract, unknown), message, message);
});

test("contradictory-governance-mode-is-contract-error", () => {
  const message = "governance mode contract error: contradictory current_mode";
  assertExported(resolver.parseGovernanceModeContract, message);
  const contradictory = otherwiseValidContract({
    modes: ["AUTHENTICATED_REVIEW"],
    current_mode: "SOLE_OWNER_ADVISORY"
  });
  assert.equal(thrownMessage(resolver.parseGovernanceModeContract, contradictory), message, message);
});

test("d0-004-authority-source-is-rejected", () => {
  const message = "governance mode contract error: D0-004 is not an authority source";
  assertExported(resolver.parseGovernanceModeContract, message);
  assert.equal(thrownMessage(resolver.parseGovernanceModeContract, d0004AuthoritySource()), message, message);
});

test("invalid-governance-contract-never-falls-back", () => {
  const message = "governance mode contract error: invalid contract has no fallback";
  assertExported(resolver.resolveGovernanceModeResult, message);
  const { current_mode: _omitted, ...invalid } = otherwiseValidContract();
  void _omitted;
  let result;
  const actual = thrownMessage((input) => {
    result = resolver.resolveGovernanceModeResult(input);
  }, invalid);
  assert.equal(actual, message, message);
  assert.equal(result, undefined, message);
});

test("valid-governance-contract-declares-exact-modes", () => {
  const message =
    "governance mode contract positive assertion failed: declared modes must equal SOLE_OWNER_ADVISORY,AUTHENTICATED_REVIEW";
  assertExported(resolver.resolveGovernanceModeResult, message);
  const result = resolver.resolveGovernanceModeResult(otherwiseValidContract());
  assert.equal(declaredModes(result), "SOLE_OWNER_ADVISORY,AUTHENTICATED_REVIEW", message);
  assertAdvisoryModeMutationKills(result, message);
});

test("valid-sole-owner-advisory-is-canonical", () => {
  const message = "governance mode contract positive assertion failed: current_mode must equal SOLE_OWNER_ADVISORY";
  assertExported(resolver.resolveGovernanceModeResult, message);
  const result = resolver.resolveGovernanceModeResult(otherwiseValidContract());
  assert.equal(result.governance_mode, "SOLE_OWNER_ADVISORY", message);
  assertAdvisoryModeMutationKills(result, message);
});

test("valid-sole-owner-advisory-emits-empty-ready-set", () => {
  const message = "governance mode contract positive assertion failed: advisory readySet must equal []";
  assertExported(resolver.resolveGovernanceModeResult, message);
  const result = resolver.resolveGovernanceModeResult(otherwiseValidContract());
  assert.deepEqual(result.readySet, [], message);
  assertAdvisoryModeMutationKills(result, message);
});

test("valid-sole-owner-advisory-never-authorizes-red-merge-or-implementation", () => {
  const message =
    "governance mode contract positive assertion failed: advisory ticket state must deny RED and implementation and result must deny merge authorization";
  assertExported(resolver.resolveGovernanceModeResult, message);
  const result = resolver.resolveGovernanceModeResult(otherwiseValidContract());
  assert.equal(result.claims_merge_authorization, false, message);
  assert.equal(result.tickets !== null && typeof result.tickets === "object", true, message);
  for (const [, ticketState] of Object.entries(result.tickets)) {
    assert.equal(ticketState.red_authorized, false, message);
    assert.notEqual(ticketState.readiness, "ready", message);
    assert.notEqual(ticketState.phase, "ready_for_red", message);
    assert.equal(ticketState.packet, null, message);
  }
  assertAdvisoryModeMutationKills(result, message);
});

test("valid-sole-owner-advisory-has-no-artifact-freeze", () => {
  const message = "governance mode contract positive assertion failed: advisory artifact_freeze must equal null";
  assertExported(resolver.resolveGovernanceModeResult, message);
  const result = resolver.resolveGovernanceModeResult(otherwiseValidContract());
  assert.equal(result.artifact_freeze, null, message);
  assertAdvisoryModeMutationKills(result, message);
});

test("valid-sole-owner-advisory-never-claims-separation-of-duties-for-different-role-strings", () => {
  const message =
    "governance mode contract positive assertion failed: advisory claims_separation_of_duties must equal false";
  assertExported(resolver.resolveGovernanceModeResult, message);
  const result = resolver.resolveGovernanceModeResult(otherwiseValidContract(), {
    prepared_by: "local-prepared-by-role",
    approved_by: "local-approved-by-role"
  });
  assert.equal(result.claims_separation_of_duties, false, message);
  assert.notEqual("local-prepared-by-role", "local-approved-by-role", message);
  assertAdvisoryModeMutationKills(result, message);
});
