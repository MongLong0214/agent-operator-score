// #561. The model a run actually used is part of what its number means, and until now nothing
// bound one to the other. The profile digest carried `model_id` read from a regex over `--version`
// output -- which no runtime this product knows prints -- so every real run was filed under
// `model unknown` and three of them were issued as a profile-bound Operator Score anyway. A
// provider-managed alias that moved underneath the operator between Monday and Wednesday was the
// same cohort as far as the ledger could tell.
//
// What is asserted here: a provenance record with a source and a confidence; a mismatch between
// what was detected and what was declared that fails closed by name; an alias policy under which
// `latest` is never an exact identity; a profile digest that moves for every field the issue lists;
// and a cycle that withholds its profile-bound aggregate rather than issuing one over a model
// nobody identified.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, htmlEscape } from "../../lib/core.mjs";
import { runValidity } from "../../lib/cycle.mjs";
import { comparability, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { isolationPolicyDigestOf } from "../../lib/isolation.mjs";
import {
  aliasClassOf,
  issuancePolicyFor,
  modelIdentityLines,
  modelIdentityRecord,
  MODEL_PROVENANCE_SCHEMA,
  observeModelEvents,
  provenanceSchemaDigest,
  resolveModelProvenance,
  runtimeConfigModel,
  verifyModelIdentity
} from "../../lib/model-identity.mjs";
import { ADAPTERS, buildProfile, profileDigestOf } from "../../lib/profile.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { boundRuntimeIdentity, identityDigestOf, IDENTITY_SCHEMA } from "../../lib/runtime-identity.mjs";
import { addAgent, makePlan, newestResult, run } from "./helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "aos.mjs");

const EXACT_A = "openai/gpt-4o-2024-08-06";
const EXACT_B = "openai/gpt-4o-2024-11-20";

// An identity record the #554 contract would produce: every field the digest is taken over, and
// the digest taken over them. Written this way because binding recomputes it -- a fixture with a
// digit-repeat digest is exactly the forged record the binding now refuses.
const identity = (over = {}) => {
  const base = {
    schema_id: IDENTITY_SCHEMA,
    command_input: "codex",
    resolved_realpath: "/usr/bin/codex",
    realpath_digest: `sha256:${"a".repeat(64)}`,
    file_fingerprint: { size: 1024, mtime_ms: 1, inode: 2, device: 3 },
    interpreter_digest: null,
    interpreter_chain: [],
    owner_uid: 501,
    mode: "0755",
    parent_security: { world_writable: false, group_writable_untrusted: false, foreign_owner: false, acl_writable: false },
    platform_identity: { macos_codesign_team: null, macos_requirement_digest: null },
    adapter_id: "codex-cli.v1",
    identity_status: "VERIFIED",
    untrusted_reasons: [],
    verified_at: "2026-09-02T00:00:00.000Z",
    ...over
  };
  return { ...base, identity_digest: over.identity_digest ?? identityDigestOf(base) };
};

const agent = (over = {}) => ({
  id: "main",
  runtime_name: "codex",
  command: "/usr/bin/codex",
  args: [],
  adapter: "codex-cli.v1",
  config_digest: "sha256:abc",
  runtime_identity: identity(),
  model_id: EXACT_A,
  ...over
});

const build = (over = {}) =>
  buildProfile({ agent: agent(), platform: "darwin", arch: "arm64", nodeVersion: "22.18.0", probe: () => null, ...over });

const declared = (model) => ({ model, provider: null });

// ---------------------------------------------------------------------------------------------
// The provenance record

test("a provenance record carries exactly the issue's fields, with the source that produced it", () => {
  const record = resolveModelProvenance({ declared: declared(EXACT_A) });
  assert.equal(record.schema_id, MODEL_PROVENANCE_SCHEMA);
  assert.equal(record.provider, "openai");
  assert.equal(record.family, "gpt");
  assert.equal(record.id, EXACT_A);
  assert.equal(record.source, "declared");
  assert.equal(record.confidence, "LOW");
  assert.match(record.evidence_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(record.mutable_alias, false);
  assert.equal(record.status, "EXACT");
  assert.equal(record.mismatch, null);
});

test("source precedence is runtime event, then runtime config, then declared, then unknown", () => {
  const event = { model: "gpt-4o-2024-08-06", provider: "openai", runtime: "codex", row_digest: "sha256:" + "0".repeat(64) };
  const config = { model: EXACT_A, provider: null };
  const all = resolveModelProvenance({ runtimeEvent: event, runtimeConfig: config, declared: declared(EXACT_A) });
  assert.equal(all.source, "runtime-event");
  assert.equal(all.confidence, "HIGH");
  const noEvent = resolveModelProvenance({ runtimeConfig: config, declared: declared(EXACT_A) });
  assert.equal(noEvent.source, "runtime-config");
  assert.equal(noEvent.confidence, "MEDIUM");
  const onlyDeclared = resolveModelProvenance({ declared: declared(EXACT_A) });
  assert.equal(onlyDeclared.source, "declared");
  assert.equal(onlyDeclared.confidence, "LOW");
  const nothing = resolveModelProvenance({});
  assert.equal(nothing.source, "unknown");
  assert.equal(nothing.confidence, "NONE");
  assert.equal(nothing.id, null);
  assert.equal(nothing.evidence_digest, null);
  assert.equal(nothing.mutable_alias, null);
  assert.equal(nothing.status, "UNKNOWN");
});

test("the evidence digest is over the claim's bytes and is stable across two identical claims", () => {
  const first = resolveModelProvenance({ declared: declared(EXACT_A) });
  const second = resolveModelProvenance({ declared: declared(EXACT_A) });
  assert.equal(first.evidence_digest, second.evidence_digest);
  // Reproducible from the record's own claim, so a reader can check it without trusting the field.
  assert.equal(first.evidence_digest, sha256Bytes(Buffer.from(canonicalJson(first.evidence.claim), "utf8")));
  assert.notEqual(first.evidence_digest, resolveModelProvenance({ declared: declared(EXACT_B) }).evidence_digest);
});

test("detected A vs declared B is a named mismatch that fails closed", () => {
  const event = { model: "gpt-4o-2024-11-20", provider: "openai", runtime: "codex", row_digest: "sha256:" + "0".repeat(64) };
  const record = resolveModelProvenance({ runtimeEvent: event, declared: declared(EXACT_A) });
  assert.equal(record.status, "MISMATCH");
  assert.equal(record.mismatch.code, "AOS_MODEL_IDENTITY_MISMATCH");
  assert.equal(record.mismatch.detected, EXACT_B);
  assert.equal(record.mismatch.declared, EXACT_A);
  // Never resolved to either side: a mismatch has no exact identity to bind.
  assert.equal(record.id, null);
  assert.equal(record.source, "unknown");
  assert.equal(record.confidence, "NONE");
  assert.equal(issuancePolicyFor({ provenance: record }).profile_bound_aggregation.status, "withheld");
  assert.equal(issuancePolicyFor({ provenance: record }).profile_bound_aggregation.reason, "MODEL_IDENTITY_MISMATCH");
  // The same conflict between the runtime's own config and the declaration is the same mismatch.
  const configured = resolveModelProvenance({ runtimeConfig: { model: EXACT_B, provider: null }, declared: declared(EXACT_A) });
  assert.equal(configured.mismatch?.code, "AOS_MODEL_IDENTITY_MISMATCH");
  // And a profile cannot be built over one: the digest would bind a contradiction.
  assert.throws(() => build({ agent: agent({ args: ["--model", "gpt-4o-2024-11-20"] }) }), /AOS_MODEL_IDENTITY_MISMATCH/u);
});

test("a declaration that agrees with the detection is confirmed, not mismatched", () => {
  const event = { model: "gpt-4o-2024-08-06", provider: "openai", runtime: "codex", row_digest: "sha256:" + "0".repeat(64) };
  const record = resolveModelProvenance({ runtimeEvent: event, declared: declared(EXACT_A) });
  assert.equal(record.status, "EXACT");
  assert.equal(record.source, "runtime-event");
  assert.equal(record.id, EXACT_A);
});

// ---------------------------------------------------------------------------------------------
// The alias policy

test("latest, default, gpt and sonnet are mutable aliases, never exact identities", () => {
  for (const name of ["latest", "default", "gpt", "sonnet", "Latest", "openai/latest"]) {
    const record = resolveModelProvenance({ declared: declared(name) });
    assert.equal(record.mutable_alias, true, name);
    assert.equal(record.alias_class, "bare-alias", name);
    assert.equal(record.status, "MUTABLE", name);
  }
});

test("a provider-managed name without a snapshot marker is a mutable alias", () => {
  for (const name of ["gpt-5.6-terra", "claude-opus-5", "gpt-4o", "o3", "anthropic/claude-sonnet-4-5"]) {
    assert.equal(aliasClassOf(name).alias_class, "provider-managed-alias", name);
    assert.equal(aliasClassOf(name).mutable_alias, true, name);
  }
  for (const name of ["gpt-4o-2024-08-06", "claude-3-5-sonnet-20241022", "claude-opus-4-1-20250805", "openai/gpt-4.1-2025-04-14"]) {
    assert.equal(aliasClassOf(name).alias_class, "exact-snapshot", name);
    assert.equal(aliasClassOf(name).mutable_alias, false, name);
  }
  assert.equal(aliasClassOf(null).alias_class, "unknown");
  assert.equal(aliasClassOf(null).mutable_alias, null);
});

test("a mutable alias may run, but its claim stage is capped and profile-bound aggregation withheld by name", () => {
  const record = resolveModelProvenance({ runtimeConfig: { model: "gpt-5.6-terra", provider: "openai" } });
  const policy = issuancePolicyFor({ provenance: record });
  assert.equal(policy.claim_stage, "RUN_DIAGNOSTIC");
  assert.equal(policy.run_diagnostic_permitted, true);
  assert.equal(policy.profile_bound_aggregation.status, "withheld");
  assert.equal(policy.profile_bound_aggregation.reason, "MODEL_MUTABLE_ALIAS");
  assert.equal(policy.composite, "WITHHELD");
});

test("an unknown model may run, but profile-bound aggregation is withheld by name", () => {
  const policy = issuancePolicyFor({ provenance: resolveModelProvenance({}) });
  assert.equal(policy.claim_stage, "RUN_DIAGNOSTIC");
  assert.equal(policy.run_diagnostic_permitted, true);
  assert.equal(policy.profile_bound_aggregation.status, "withheld");
  assert.equal(policy.profile_bound_aggregation.reason, "MODEL_UNKNOWN");
});

test("an exact model issues profile-bound aggregation and still leaves generalizability and cross-model comparison withheld", () => {
  // Both halves of the profile: the model that was named, and the program #554 verified.
  const policy = issuancePolicyFor({
    provenance: resolveModelProvenance({ declared: declared(EXACT_A) }),
    runtimeIdentity: boundRuntimeIdentity(identity())
  });
  assert.equal(policy.claim_stage, "PROFILE_BOUND");
  assert.equal(policy.profile_bound_aggregation.status, "issued");
  assert.equal(policy.profile_bound_aggregation.reason, null);
  assert.equal(policy.composite, "ISSUABLE");
  // Same model and same profile do not make a statement about the person: #584 owns that evidence.
  assert.equal(policy.generalizability_status, "UNESTABLISHED");
  // And nothing here compares across models: #585 owns invariance.
  assert.equal(policy.cross_model_comparison, "WITHHELD");
  assert.equal(policy.model_change_improvement_claim, "WITHHELD");
});

// ---------------------------------------------------------------------------------------------
// Runtime config and runtime events

test("the model named on the runtime's own command line is runtime config, read by the adapter's flags", () => {
  assert.equal(runtimeConfigModel(["--model", "gpt-4o-2024-08-06"], ADAPTERS["codex-cli.v1"].model_flags), "gpt-4o-2024-08-06");
  assert.equal(runtimeConfigModel(["--model=gpt-4o-2024-08-06"], ADAPTERS["codex-cli.v1"].model_flags), "gpt-4o-2024-08-06");
  assert.equal(runtimeConfigModel(["-m", "gpt-4o-2024-08-06", "exec"], ADAPTERS["codex-cli.v1"].model_flags), "gpt-4o-2024-08-06");
  assert.equal(runtimeConfigModel(["exec", "--full-auto"], ADAPTERS["codex-cli.v1"].model_flags), null);
  // Two model flags on one line is not one configuration.
  assert.throws(() => runtimeConfigModel(["--model", "a-2024-01-01", "--model", "b-2024-01-01"], ["--model"]), /AOS_MODEL_CONFIG_AMBIGUOUS/u);
  // The generic adapter declares no flags, so nothing is parsed out of a command nobody described.
  assert.deepEqual(ADAPTERS["generic-command.v1"].model_flags, []);
  assert.equal(runtimeConfigModel(["--model", "x-2024-01-01"], ADAPTERS["generic-command.v1"].model_flags), null);
  const profile = build({ agent: agent({ model_id: undefined, args: ["--model", "gpt-4o-2024-08-06"] }) });
  assert.equal(profile.model_source, "runtime-config");
  assert.equal(profile.model_id, EXACT_A);
});

test("a fixture replay of Codex and Claude transcript rows yields the model, digested from the row's bytes", () => {
  const home = mkdtempSync(join(tmpdir(), "aos-model-events-"));
  try {
    const workspace = "/tmp/aos-runs/run-1/workspaces/FAM-1";
    const codexDir = join(home, ".codex", "sessions", "2026", "09", "02");
    mkdirSync(codexDir, { recursive: true });
    const codexRows = [
      JSON.stringify({ type: "session_meta", payload: { cwd: workspace, model_provider: "openai", cli_version: "0.1.0" } }),
      JSON.stringify({ type: "turn_context", payload: { cwd: workspace, model: "gpt-5.6-terra", effort: "high" } }),
      JSON.stringify({ type: "turn_context", payload: { cwd: "/somewhere/else", model: "gpt-other" } })
    ];
    writeFileSync(join(codexDir, "rollout-1.jsonl"), `${codexRows.join("\n")}\n`);
    const claudeDir = join(home, ".claude", "projects", "-tmp-aos-runs-run-1-workspaces-FAM-1");
    mkdirSync(claudeDir, { recursive: true });
    const claudeRows = [
      JSON.stringify({ type: "user", cwd: workspace, message: { role: "user", content: "hi" } }),
      JSON.stringify({ type: "assistant", cwd: workspace, message: { model: "<synthetic>", role: "assistant" } }),
      JSON.stringify({ type: "assistant", cwd: workspace, message: { model: "claude-opus-5", role: "assistant" } })
    ];
    writeFileSync(join(claudeDir, "s1.jsonl"), `${claudeRows.join("\n")}\n`);
    // A transcript older than the run is not this run's evidence, whatever it says.
    writeFileSync(join(claudeDir, "stale.jsonl"), `${JSON.stringify({ type: "assistant", cwd: workspace, message: { model: "claude-old" } })}\n`);
    utimesSync(join(claudeDir, "stale.jsonl"), new Date(Date.now() - 86_400_000), new Date(Date.now() - 86_400_000));

    const events = observeModelEvents({ env: { HOME: home }, workspace, since: Date.now() - 60_000 });
    const codex = events.find((entry) => entry.runtime === "codex");
    assert.equal(codex.model, "gpt-5.6-terra");
    assert.equal(codex.provider, "openai");
    assert.equal(codex.row_digest, sha256Bytes(Buffer.from(codexRows[1], "utf8")));
    const claude = events.find((entry) => entry.runtime === "claude-code");
    assert.equal(claude.model, "claude-opus-5");
    assert.equal(claude.provider, "anthropic");
    assert.equal(claude.row_digest, sha256Bytes(Buffer.from(claudeRows[2], "utf8")));
    assert.equal(events.some((entry) => entry.model === "gpt-other" || entry.model === "claude-old"), false);

    // The event is source 1 when a provenance is resolved from it.
    const resolved = resolveModelProvenance({ runtimeEvent: codex });
    assert.equal(resolved.source, "runtime-event");
    assert.equal(resolved.confidence, "HIGH");
    assert.equal(resolved.id, "openai/gpt-5.6-terra");
    assert.equal(resolved.mutable_alias, true);
    assert.equal(resolved.evidence.row_digest, codex.row_digest);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a runtime event confirms a bound identity, contradicts it by name, or was not observed", () => {
  const bound = resolveModelProvenance({ declared: declared(EXACT_A) });
  const same = { model: "gpt-4o-2024-08-06", provider: "openai", runtime: "codex", row_digest: "sha256:" + "0".repeat(64) };
  const other = { ...same, model: "gpt-4o-2024-11-20" };
  assert.equal(verifyModelIdentity(bound, [same]).status, "CONFIRMED");
  const contradicted = verifyModelIdentity(bound, [other]);
  assert.equal(contradicted.status, "MISMATCH");
  assert.equal(contradicted.code, "AOS_MODEL_IDENTITY_MISMATCH");
  assert.equal(contradicted.observed[0].id, EXACT_B);
  assert.equal(verifyModelIdentity(bound, []).status, "NOT_OBSERVED");
  // Two different models in one run is not one model.
  assert.equal(verifyModelIdentity(bound, [same, other]).status, "AMBIGUOUS");
  // An unknown binding is not confirmed by an event that arrived after the digest was locked.
  const unknown = resolveModelProvenance({});
  assert.equal(verifyModelIdentity(unknown, [same]).status, "OBSERVED_UNBOUND");
  assert.equal(issuancePolicyFor({ provenance: unknown, verification: verifyModelIdentity(unknown, [same]) }).profile_bound_aggregation.reason, "MODEL_UNKNOWN");
  assert.equal(issuancePolicyFor({ provenance: bound, verification: contradicted }).profile_bound_aggregation.reason, "MODEL_IDENTITY_MISMATCH");
  assert.equal(issuancePolicyFor({ provenance: bound, verification: verifyModelIdentity(bound, [same, other]) }).profile_bound_aggregation.reason, "MODEL_EVENT_AMBIGUOUS");
});

test("a transcript value that is not a plausible model name leaves as a digest, never as text", () => {
  // The transcript is written by the child process, so its `model` field is attacker-controlled
  // text that this product then prints in JSON, the CLI, Markdown and HTML. A credential written
  // there was reprinted verbatim, bypassing the stdout redactor entirely.
  const home = mkdtempSync(join(tmpdir(), "aos-model-credential-"));
  try {
    const workspace = "/tmp/aos-runs/run-2/workspaces/FAM-1";
    const dir = join(home, ".claude", "projects", "-tmp-aos-runs-run-2-workspaces-FAM-1");
    mkdirSync(dir, { recursive: true });
    const secret = "sk-supersecretcredential1234567890";
    const rows = [
      JSON.stringify({ type: "assistant", cwd: workspace, message: { model: secret } }),
      JSON.stringify({ type: "assistant", cwd: workspace, message: { model: "x".repeat(300) } })
    ];
    writeFileSync(join(dir, "s1.jsonl"), `${rows.join("\n")}\n`);
    const events = observeModelEvents({ env: { HOME: home }, workspace, since: Date.now() - 60_000 });
    assert.equal(events.length, 2);
    for (const event of events) {
      assert.equal(event.model, null);
      assert.match(event.value_digest, /^sha256:[0-9a-f]{64}$/u);
    }
    assert.equal(events[0].value_digest, sha256Bytes(Buffer.from(secret, "utf8")));

    const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
    const verification = verifyModelIdentity(provenance, events);
    assert.equal(verification.status, "UNNAMEABLE");
    assert.equal(verification.code, "AOS_MODEL_EVENT_UNNAMEABLE");
    const record = modelIdentityRecord({
      by_agent: { main: { provenance, verification, runtime_identity_digest: null, runtime_identity_status: "VERIFIED" } },
      profile_digest: "d".repeat(64)
    });
    assert.equal(record.profile_bound_aggregation.reason, "MODEL_EVENT_UNNAMEABLE");
    const surfaces = [canonicalJson(record), record.lines.join("\n"), renderMarkdown({
      run_id: "r", status: "SCORED", score: null, provisional_raw: 0, coverage: { observed: 0, total: 20 },
      metrics: [], dimensions: {}, limitations: [], model_identity: record
    })];
    for (const surface of surfaces) {
      assert.equal(surface.includes(secret), false);
      assert.equal(surface.includes("supersecret"), false);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a run whose transcript said nothing names that blocker rather than reporting silence", () => {
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const verification = verifyModelIdentity(provenance, []);
  assert.equal(verification.status, "NOT_OBSERVED");
  assert.equal(verification.code, "AOS_MODEL_EVENT_NOT_OBSERVED");
  // Naming the blocker does not withhold the aggregate: the declaration is still the binding the
  // digest was locked on, and a runtime that writes no transcript is not a contradiction.
  assert.equal(issuancePolicyFor({
    provenance, verification, runtimeIdentity: boundRuntimeIdentity(identity())
  }).profile_bound_aggregation.status, "issued");
});

// ---------------------------------------------------------------------------------------------
// The profile digest

test("declared A vs declared B gives a different profile digest", () => {
  assert.notEqual(build({ agent: agent({ model_id: EXACT_A }) }).profile_digest, build({ agent: agent({ model_id: EXACT_B }) }).profile_digest);
});

test("the profile digest moves for each model, runtime, adapter, environment, isolation and language field on its own", () => {
  const base = build();
  const fields = [
    ["model_provider", { model_provider: "other" }],
    ["model_family", { model_family: "other" }],
    ["model_id", { model_id: EXACT_B }],
    ["model_source", { model_source: "runtime-config" }],
    ["model_confidence", { model_confidence: "HIGH" }],
    ["model_evidence_digest", { model_evidence_digest: "sha256:" + "f".repeat(64) }],
    ["model_mutable_alias", { model_mutable_alias: true }],
    ["runtime_identity_digest", { runtime_identity_digest: "sha256:" + "2".repeat(64) }],
    ["adapter_id", { adapter_id: "claude-code.v1" }],
    ["adapter_version", { adapter_version: 2 }],
    ["env_policy_digest", { env_policy_digest: "sha256:" + "3".repeat(64) }],
    ["isolation_policy_digest", { isolation_policy_digest: "sha256:" + "4".repeat(64) }],
    ["language", { language: "ko" }],
    ["interface", { interface: "ide" }]
  ];
  for (const [field, over] of fields) {
    assert.notEqual(profileDigestOf({ ...base, ...over }), base.profile_digest, field);
  }
});

test("the profile carries the isolation policy by digest, and the digest moves with the level and the home regime", () => {
  const profile = build();
  assert.equal(profile.isolation_policy_digest, isolationPolicyDigestOf({ level: "BEST_EFFORT_CLI", homeSource: "aos_temporary" }));
  assert.match(profile.isolation_policy_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(isolationPolicyDigestOf({ level: "STRICT" }), isolationPolicyDigestOf({ level: "BEST_EFFORT_CLI" }));
  assert.notEqual(isolationPolicyDigestOf({ level: "STRICT", homeSource: "operator" }), isolationPolicyDigestOf({ level: "STRICT" }));
  assert.throws(() => isolationPolicyDigestOf({ level: "SANDBOXED" }), /AOS_UNKNOWN_ISOLATION/u);
  assert.throws(() => isolationPolicyDigestOf({ level: "STRICT", homeSource: "/Users/alice" }), /AOS_UNKNOWN_HOME_SOURCE/u);
});

test("the profile binds the executable through the #554 identity contract and refuses a foreign identity record", () => {
  const bound = build();
  assert.equal(bound.runtime_identity_digest, identity().identity_digest);
  assert.equal(bound.runtime_identity_status, "VERIFIED");
  // A record under some other schema is not an identity this product verified.
  const foreign = build({ agent: agent({ runtime_identity: identity({ schema_id: "somebody-elses.v9" }) }) });
  assert.equal(foreign.runtime_identity_digest, null);
  assert.equal(foreign.runtime_identity_status, "MIGRATION_REQUIRED");
  assert.deepEqual(boundRuntimeIdentity(null), { identity_digest: null, identity_status: "MIGRATION_REQUIRED" });
  assert.deepEqual(boundRuntimeIdentity({ identity_digest: "sha256:" + "a".repeat(64) }), { identity_digest: null, identity_status: "MIGRATION_REQUIRED" });
});

test("a runtime identity whose digest does not recompute is not bound, however well-formed it looks", () => {
  // The shape of #554's record with a digest nobody computed from it: three fields spelled right
  // was the whole test, so a hand-made object bound as VERIFIED and carried a cohort key.
  const forged = { schema_id: IDENTITY_SCHEMA, identity_digest: `sha256:${"a".repeat(64)}`, identity_status: "VERIFIED" };
  assert.deepEqual(boundRuntimeIdentity(forged), { identity_digest: null, identity_status: "UNVERIFIABLE" });
  const tampered = identity();
  assert.deepEqual(
    boundRuntimeIdentity({ ...tampered, resolved_realpath: "/tmp/somebody-elses-codex" }),
    { identity_digest: null, identity_status: "UNVERIFIABLE" }
  );
  assert.equal(build({ agent: agent({ runtime_identity: forged }) }).runtime_identity_status, "UNVERIFIABLE");
  // An identity the contract itself marked UNTRUSTED binds under that name, and is never VERIFIED.
  const untrusted = identity({ identity_status: "UNTRUSTED", untrusted_reasons: ["world_writable /usr/bin"] });
  assert.equal(boundRuntimeIdentity(untrusted).identity_status, "UNTRUSTED");
});

test("a missing, untrusted or unverifiable executable identity withholds the aggregate by its own name", () => {
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const cases = [
    ["MIGRATION_REQUIRED", null],
    ["UNTRUSTED", identity({ identity_status: "UNTRUSTED", untrusted_reasons: ["world_writable /usr/bin"] })],
    ["UNVERIFIABLE", { schema_id: IDENTITY_SCHEMA, identity_digest: `sha256:${"a".repeat(64)}`, identity_status: "VERIFIED" }]
  ];
  for (const [status, record] of cases) {
    const bound = boundRuntimeIdentity(record);
    assert.equal(bound.identity_status, status, status);
    const policy = issuancePolicyFor({ provenance, runtimeIdentity: bound });
    assert.equal(policy.profile_bound_aggregation.status, "withheld", status);
    assert.equal(policy.profile_bound_aggregation.reason, "RUNTIME_IDENTITY_UNVERIFIED", status);
    assert.equal(policy.profile_bound_aggregation.detail.includes(status), true, status);
    assert.equal(policy.claim_stage, "RUN_DIAGNOSTIC", status);
  }
  // The exact model with a verified executable is the only combination that issues.
  const verified = issuancePolicyFor({ provenance, runtimeIdentity: boundRuntimeIdentity(identity()) });
  assert.equal(verified.profile_bound_aggregation.status, "issued");
  // And the record built for a projection carries the status it was bound under.
  const record = modelIdentityRecord({
    by_agent: { main: { provenance, verification: null, runtime_identity_digest: null, runtime_identity_status: "MIGRATION_REQUIRED" } },
    profile_digest: "d".repeat(64)
  });
  assert.equal(record.profile_bound_aggregation.reason, "RUNTIME_IDENTITY_UNVERIFIED");
  assert.equal(record.lines.includes("Runtime executable identity (main): unverified (MIGRATION_REQUIRED)"), true);
});

// ---------------------------------------------------------------------------------------------
// Comparability

test("same exact model with a different executable identity is not one cohort", () => {
  const left = build();
  const right = build({ agent: agent({ runtime_identity: identity({ file_fingerprint: { size: 2048, mtime_ms: 9, inode: 9, device: 9 } }) }) });
  assert.equal(left.model_id, right.model_id);
  assert.notEqual(left.runtime_identity_digest, right.runtime_identity_digest);
  assert.notEqual(left.profile_digest, right.profile_digest);
  // The live guard, not a second formula: a cycle opened under one profile refuses a run made
  // under the other, and says which field of the cycle it failed.
  const cycle = { seeds: [1], profile_digest: left.profile_digest, suite_major: 0, scorer_major: 0 };
  const run = { seed: 1, profile_digest: right.profile_digest, suite_major: 0, scorer_major: 0, terminal_committed: true, issued: true };
  assert.deepEqual(runValidity(cycle, run), { valid: false, reason: "PROFILE_CHANGED" });
  assert.deepEqual(runValidity(cycle, { ...run, profile_digest: left.profile_digest }), { valid: true, reason: null });
});

test("same model id with a different adapter, environment policy or isolation is not one cohort", () => {
  const base = build();
  const cycle = { seeds: [1], profile_digest: base.profile_digest, suite_major: 0, scorer_major: 0 };
  const variants = [
    ["adapter", build({ agent: agent({ adapter: "claude-code.v1", runtime_name: "claude-code" }) })],
    ["environment policy", build({ agent: agent({ allowed_env_names: ["ACME_TOOLCHAIN_DIR"] }) })],
    ["isolation", build({ isolation: "STRICT" })]
  ];
  for (const [label, other] of variants) {
    assert.equal(other.model_id, base.model_id, label);
    assert.notEqual(other.profile_digest, base.profile_digest, label);
    const run = { seed: 1, profile_digest: other.profile_digest, suite_major: 0, scorer_major: 0, terminal_committed: true, issued: true };
    assert.equal(runValidity(cycle, run).reason, "PROFILE_CHANGED", label);
  }
});

test("provider default drift cannot form a cohort: two identical unknown-model profiles withhold the aggregate", () => {
  const left = build({ agent: agent({ model_id: undefined }) });
  const right = build({ agent: agent({ model_id: undefined }) });
  // Same digest -- which is exactly why the digest alone may not decide. What refuses is the
  // issuance policy, by name, and it refuses both of them.
  assert.equal(left.profile_digest, right.profile_digest);
  for (const profile of [left, right]) {
    const policy = issuancePolicyFor({
      provenance: profile.model_provenance,
      runtimeIdentity: { identity_digest: profile.runtime_identity_digest, identity_status: profile.runtime_identity_status }
    });
    assert.equal(policy.profile_bound_aggregation.status, "withheld");
    assert.equal(policy.profile_bound_aggregation.reason, "MODEL_UNKNOWN");
  }
  const alias = build({ agent: agent({ model_id: "latest" }) });
  assert.equal(issuancePolicyFor({
    provenance: alias.model_provenance,
    runtimeIdentity: { identity_digest: alias.runtime_identity_digest, identity_status: alias.runtime_identity_status }
  }).profile_bound_aggregation.reason, "MODEL_MUTABLE_ALIAS");
});

test("same exact profile with a verified executable is the only combination that issues", () => {
  const left = build();
  const right = build();
  assert.equal(left.profile_digest, right.profile_digest);
  const policy = issuancePolicyFor({
    provenance: left.model_provenance,
    runtimeIdentity: { identity_digest: left.runtime_identity_digest, identity_status: left.runtime_identity_status }
  });
  assert.equal(policy.profile_bound_aggregation.status, "issued");
  assert.equal(policy.claim_stage, "PROFILE_BOUND");
});

test("cross-model comparison is the shipped contract's rule, and this issue ships no second formula beside it", async () => {
  // The first draft of #561 wrote its own comparability function in lib/profile.mjs. Nothing in
  // the product called it, and it accepted any object shaped like a profile, so it was a parallel
  // contract with its own answer. The authority is the ECD artifact, which takes only results it
  // emitted and applies every rule the contract declares.
  const profileModule = await import("../../lib/profile.mjs");
  assert.equal(Object.hasOwn(profileModule, "comparabilityOf"), false);
  assert.equal(Object.hasOwn(profileModule, "sameCohort"), false);
  assert.throws(() => comparability({}, {}), /AOS_UNEMITTED_RESULT/u);
  const rule = shippedEcdContract().interpretation_use.comparability_rules.find((entry) => entry.rule_id === "invariance-required");
  assert.equal(rule.status, "UNESTABLISHED");
  assert.equal(rule.refusal_reason, "INVARIANCE_UNESTABLISHED");
  assert.equal(rule.facets.includes("model"), true);
  // And what this issue does emit says the same thing rather than deciding it here.
  const record = modelIdentityRecord({
    by_agent: { main: { provenance: resolveModelProvenance({ declared: declared(EXACT_A) }), verification: null, runtime_identity_digest: null, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  assert.equal(record.cross_model_comparison, "WITHHELD");
  assert.equal(record.comparison_until, "INVARIANCE_UNESTABLISHED");
  assert.equal(record.model_change_improvement_claim, "WITHHELD");
});

// ---------------------------------------------------------------------------------------------
// The projection every surface shows

test("the model identity lines are the same strings for JSON, CLI and Markdown", () => {
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const record = modelIdentityRecord({
    by_agent: { main: { provenance, verification: verifyModelIdentity(provenance, []), runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  const lines = modelIdentityLines(record);
  assert.deepEqual(lines, [
    `Model (main): declared ${EXACT_A} (exact-snapshot)`,
    `Runtime executable identity (main): ${identity().identity_digest.slice("sha256:".length, "sha256:".length + 12)}`,
    `Profile digest: ${"d".repeat(64)}`,
    "Profile-bound aggregation: issued"
  ]);
  // JSON carries the lines verbatim; Markdown and HTML quote them verbatim.
  assert.deepEqual(record.lines, lines);
  const result = {
    run_id: "r", status: "SCORED", score: null, provisional_raw: 0, coverage: { observed: 0, total: 20 },
    metrics: [], dimensions: {}, limitations: [], model_identity: record
  };
  const markdown = renderMarkdown(result);
  for (const line of lines) assert.equal(markdown.includes(`- ${line}`), true, line);
  for (const line of lines) assert.equal(renderHtml(result).includes(`<li>${htmlEscape(line)}</li>`), true, line);
});

test("Markdown and HTML quote the stored identity lines instead of deriving them again", () => {
  // Deriving the expectation from the same function the renderer calls is not a test of the
  // contract: replacing the stored lines left JSON carrying one thing and Markdown another, and
  // the assertion above still passed. So the stored lines are made to disagree on purpose.
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const record = modelIdentityRecord({
    by_agent: { main: { provenance, verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  const stored = { ...record, lines: ["SENTINEL_FROM_THE_STORED_RECORD"] };
  const result = {
    run_id: "r", status: "SCORED", score: null, provisional_raw: 0, coverage: { observed: 0, total: 20 },
    metrics: [], dimensions: {}, limitations: [], model_identity: stored
  };
  const markdown = renderMarkdown(result);
  assert.equal(markdown.includes("- SENTINEL_FROM_THE_STORED_RECORD"), true);
  assert.equal(markdown.includes(`Model (main): declared ${EXACT_A}`), false);
  const html = renderHtml(result);
  assert.equal(html.includes("<li>SENTINEL_FROM_THE_STORED_RECORD</li>"), true);
  assert.equal(html.includes(`Model (main): declared ${EXACT_A}`), false);
});

test("a report whose aggregate is withheld does not also print the profile-bound claim", () => {
  const unknown = modelIdentityRecord({
    by_agent: { main: { provenance: resolveModelProvenance({}), verification: null, runtime_identity_digest: null, runtime_identity_status: "MIGRATION_REQUIRED" } },
    profile_digest: "d".repeat(64)
  });
  const base = {
    run_id: "r", status: "SCORED", score: null, provisional_raw: 0, coverage: { observed: 0, total: 20 },
    metrics: [], dimensions: {}, limitations: []
  };
  const withheld = renderMarkdown({ ...base, model_identity: unknown });
  assert.equal(withheld.includes("PROFILE-BOUND —"), false);
  assert.equal(withheld.includes("RUN-DIAGNOSTIC —"), true);
  assert.equal(withheld.includes("Profile-bound aggregation: withheld"), true);
  const issued = modelIdentityRecord({
    by_agent: { main: { provenance: resolveModelProvenance({ declared: declared(EXACT_A) }), verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  const bound = renderMarkdown({ ...base, model_identity: issued });
  assert.equal(bound.includes("PROFILE-BOUND —"), true);
  assert.equal(bound.includes("RUN-DIAGNOSTIC —"), false);
  // A historical result carries no record at all, and claims the weaker of the two.
  assert.equal(renderMarkdown({ ...base, model_identity: null }).includes("RUN-DIAGNOSTIC —"), true);
});

test("a mutable, unknown or mismatched model is said in the Model line and in the withheld reason", () => {
  const mutable = resolveModelProvenance({ runtimeConfig: { model: "gpt-5.6-terra", provider: "openai" } });
  const mutableLines = modelIdentityLines(modelIdentityRecord({ by_agent: { main: { provenance: mutable, verification: null, runtime_identity_digest: null } }, profile_digest: "d".repeat(64) }));
  assert.equal(mutableLines[0], "Model (main): detected openai/gpt-5.6-terra (provider-managed-alias, mutable)");
  assert.equal(mutableLines[1], "Runtime executable identity (main): unverified (MIGRATION_REQUIRED)");
  assert.equal(mutableLines[3], "Profile-bound aggregation: withheld — MODEL_MUTABLE_ALIAS: openai/gpt-5.6-terra is a provider-managed alias without snapshot proof");

  const unknown = resolveModelProvenance({});
  const unknownLines = modelIdentityLines(modelIdentityRecord({ by_agent: { main: { provenance: unknown, verification: null, runtime_identity_digest: null } }, profile_digest: "d".repeat(64) }));
  assert.equal(unknownLines[0], "Model (main): unknown");
  assert.equal(unknownLines[3], "Profile-bound aggregation: withheld — MODEL_UNKNOWN: no runtime event, runtime config or declaration identified the model");

  const bound = resolveModelProvenance({ declared: declared(EXACT_A) });
  const other = { model: "gpt-4o-2024-11-20", provider: "openai", runtime: "codex", row_digest: "sha256:" + "0".repeat(64) };
  const mismatchLines = modelIdentityLines(modelIdentityRecord({ by_agent: { main: { provenance: bound, verification: verifyModelIdentity(bound, [other]), runtime_identity_digest: null } }, profile_digest: "d".repeat(64) }));
  assert.equal(mismatchLines[0], `Model (main): mismatch — detected ${EXACT_B}, declared ${EXACT_A} (AOS_MODEL_IDENTITY_MISMATCH)`);
  assert.equal(mismatchLines[3], `Profile-bound aggregation: withheld — MODEL_IDENTITY_MISMATCH: detected ${EXACT_B} but declared ${EXACT_A}`);

  // A result that predates the record is historical, and says so instead of reading as exact.
  assert.deepEqual(modelIdentityLines(null), [
    "Model: unknown (historical result, no provenance record)",
    "Runtime executable identity: unverified",
    "Profile digest: unknown",
    "Profile-bound aggregation: withheld — MODEL_PROVENANCE_ABSENT: this result predates model provenance and is historical/provisional"
  ]);
});

test("the provenance schema fixture is committed and its digest is the model identity digest", () => {
  const fixture = readFileSync(join(root, "schemas", "aos-model-provenance.v1.json"));
  const parsed = JSON.parse(fixture.toString("utf8"));
  assert.equal(parsed.schema_id, MODEL_PROVENANCE_SCHEMA);
  assert.deepEqual(Object.keys(parsed.record).sort(), ["confidence", "evidence_digest", "family", "id", "mutable_alias", "provider", "source"]);
  assert.deepEqual(parsed.source_precedence, ["runtime-event", "runtime-config", "declared", "unknown"]);
  assert.equal(provenanceSchemaDigest(), sha256Bytes(fixture));
  // The example record in the fixture is what this module would produce for it.
  const produced = resolveModelProvenance({ declared: { model: parsed.record.id, provider: null } });
  for (const field of ["provider", "family", "id", "source", "confidence", "evidence_digest", "mutable_alias"]) {
    assert.equal(produced[field], parsed.record[field], field);
  }
});

// ---------------------------------------------------------------------------------------------
// The CLI, end to end

const SEEDS = ["0000000000000021", "0000000000000022", "0000000000000023"];
const UNBLOCK = Array.from({ length: 12 }, () => "\n\n\ny\nAOS-TEST-UNBLOCK proceed\n").join("");
const cycleRun = (cwd, plan) =>
  spawnSync(process.execPath, [cli, "cycle", "run", "--plan", plan, "--checkpoints"], {
    cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
    env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: "needs-instruction" }
  });

test("an agent registered with a declared exact model carries it, and a declaration that contradicts its own flags is refused", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-agent-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "exact", undefined, ["--model-id", EXACT_A]);
    const listed = JSON.parse(run(cwd, ["agent", "list", "--json"]).stdout);
    assert.equal(listed.find((entry) => entry.id === "exact").model_id, EXACT_A);
    // The declaration is part of what the agent is, so it is in the configuration digest.
    addAgent(cwd, "other", undefined, ["--model-id", EXACT_B]);
    const again = JSON.parse(run(cwd, ["agent", "list", "--json"]).stdout);
    assert.notEqual(again.find((entry) => entry.id === "exact").config_digest, again.find((entry) => entry.id === "other").config_digest);
    const refused = spawnSync(process.execPath, [cli, "agent", "add", "clash", "--command", process.execPath, "--adapter", "codex-cli.v1",
      "--arg", "--model", "--arg", "gpt-4o-2024-11-20", "--model-id", EXACT_A], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /AOS_MODEL_IDENTITY_MISMATCH/u);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a scored run records model provenance, and the CLI and Markdown show the same lines as the JSON", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-run-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "exact", undefined, ["--model-id", EXACT_A]);
    const plan = makePlan(cwd, { default: "exact" });
    const printed = spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]], {
      cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: "needs-instruction" }
    });
    const result = newestResult(cwd);
    const record = result.model_identity;
    assert.equal(record.by_agent.exact.provenance.id, EXACT_A);
    assert.equal(record.by_agent.exact.provenance.source, "declared");
    assert.equal(record.by_agent.exact.verification.status, "NOT_OBSERVED");
    assert.equal(record.profile_bound_aggregation.status, "issued");
    assert.equal(record.claim_stage, "PROFILE_BOUND");
    assert.equal(record.generalizability_status, "UNESTABLISHED");
    assert.equal(record.cross_model_comparison, "WITHHELD");
    assert.equal(record.profile_digest, result.profile_digest);
    for (const line of record.lines) assert.equal(printed.stdout.includes(line), true, `CLI lacks: ${line}`);
    const markdown = readFileSync(join(cwd, ".aos", "runs", result.run_id, "report.md"), "utf8");
    for (const line of record.lines) assert.equal(markdown.includes(`- ${line}`), true, `Markdown lacks: ${line}`);
    const html = readFileSync(join(cwd, ".aos", "runs", result.run_id, "report.html"), "utf8");
    for (const line of record.lines) assert.equal(html.includes(`<li>${htmlEscape(line)}</li>`), true, `HTML lacks: ${line}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a cycle over an unknown model completes its runs and withholds the profile-bound aggregate by name", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-cycle-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    run(cwd, ["cycle", "start", ...SEEDS.flatMap((seed) => ["--seed", seed])]);
    const opened = JSON.parse(readFileSync(join(cwd, ".aos", "cycle.json"), "utf8"));
    assert.equal(opened.model_identity.profile_bound_aggregation.reason, "MODEL_UNKNOWN");
    for (let index = 0; index < 3; index += 1) {
      const output = cycleRun(cwd, plan).stdout;
      // Run diagnostics are still produced: the run has a score of its own.
      assert.match(output, /^Score: \d+ \//mu);
    }
    const report = spawnSync(process.execPath, [cli, "cycle", "--json"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") } });
    const summary = JSON.parse(report.stdout);
    assert.equal(summary.valid_runs, 3, JSON.stringify(summary.excluded));
    assert.equal(summary.complete, true);
    assert.equal(summary.issued, false);
    assert.equal(summary.operator_score, null);
    assert.equal(summary.composite, "WITHHELD");
    assert.equal(summary.claim_stage, "RUN_DIAGNOSTIC");
    assert.equal(summary.profile_bound_aggregation.status, "withheld");
    assert.equal(summary.profile_bound_aggregation.reason, "MODEL_UNKNOWN");
    assert.notEqual(report.status, 0);
    const text = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") } });
    assert.match(text.stdout, /Operator Score withheld — MODEL_UNKNOWN/u);
    assert.equal(/Operator Score: \d+/u.test(text.stdout), false);
    for (const line of summary.model_identity.lines) assert.equal(text.stdout.includes(line), true, `cycle output lacks: ${line}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a historical cycle without a provenance record is never promoted to an exact profile", () => {
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-historical-"));
  try {
    run(cwd, ["init"]);
    const historical = {
      schema_id: "aos-cycle.v1", cycle_id: "cycle-historical", profile_digest: "e".repeat(64), suite_major: 1, scorer_major: 1,
      seeds: SEEDS,
      runs: SEEDS.map((seed, index) => ({
        seed, run_id: `run-${index}`, profile_digest: "e".repeat(64), suite_major: 1, scorer_major: 1, failure: null,
        terminal_committed: true, issued: true, final_score: 70 + index, dimensions: {}, valid: true, invalid_reason: null
      }))
    };
    writeFileSync(join(cwd, ".aos", "cycle.json"), `${JSON.stringify(historical)}\n`);
    const report = spawnSync(process.execPath, [cli, "cycle", "--json"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") } });
    const summary = JSON.parse(report.stdout);
    assert.equal(summary.valid_runs, 3);
    assert.equal(summary.issued, false);
    assert.equal(summary.operator_score, null);
    assert.equal(summary.profile_bound_aggregation.reason, "MODEL_PROVENANCE_ABSENT");
    assert.equal(summary.provisional, true);
    assert.notEqual(report.status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
