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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, htmlEscape, sha256Value } from "../../lib/core.mjs";
import { runValidity } from "../../lib/cycle.mjs";
import { comparability, evaluate, shippedEcdContract } from "../../lib/ecd-contract.mjs";
import { sha256Bytes } from "../../lib/digest.mjs";
import { isolationPolicyDigestOf } from "../../lib/isolation.mjs";
import {
  aliasClassOf,
  cycleModelIdentity,
  cohortProvenance,
  issuancePolicyFor,
  modelIdentityLines,
  modelIdentityProjection,
  modelIdentityRecord,
  MODEL_PROVENANCE_SCHEMA,
  observeModelEvents,
  parseModelName,
  provenanceSchemaDigest,
  resolveModelProvenance,
  runtimeConfigModel,
  verifyModelIdentity
} from "../../lib/model-identity.mjs";
import { ADAPTERS, appliedProfile, buildProfile, profileDigestOf } from "../../lib/profile.mjs";
import { buildResult } from "../../lib/result-schema.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { contractWithAPopulatedIndex, identified, observationsWith } from "./ecd-fixtures.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { renderCard } from "../../lib/report-card.mjs";
import { renderProfileCard, renderProfileHtml, renderProfileMarkdown } from "../../lib/profile-report.mjs";
import { boundRuntimeIdentity, identityDigestOf, IDENTITY_SCHEMA, LEGACY_IDENTITY_SCHEMA } from "../../lib/runtime-identity.mjs";
import { addAgent, makePlan, newestResult, run, verifiedRunner } from "./helpers.mjs";

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

// The identity shape a previous release wrote: the same fields, its own schema id, and a digest
// taken over everything except the status -- which is exactly why the status was not evidence.
const legacyDigestOf = (record) => `sha256:${sha256Value({
  schema_id: record.schema_id,
  resolved_realpath: record.resolved_realpath,
  realpath_digest: record.realpath_digest,
  file_fingerprint: record.file_fingerprint,
  interpreter_digest: record.interpreter_digest,
  owner_uid: record.owner_uid,
  mode: record.mode,
  parent_security: record.parent_security,
  platform_identity: {
    macos_codesign_team: record.platform_identity.macos_codesign_team,
    macos_requirement_digest: record.platform_identity.macos_requirement_digest
  },
  adapter_id: record.adapter_id
})}`;

const legacyIdentity = (over = {}) => {
  const base = { ...identity(), schema_id: LEGACY_IDENTITY_SCHEMA, ...over };
  return { ...base, identity_digest: legacyDigestOf(base) };
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

// A complete, all-passing evaluation: the shape a result is built from when nothing about the
// measurement is withheld, so what withholds in these tests is the identity and only the identity.
const allPassObservations = () => METRIC_IDS.map((id) => observationOf({
  metric_id: id,
  verifier_id: "aos-verify.v1",
  subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: true })),
  evidence_ids: ["fixture"],
  reason: "fixture"
}));

// The contract whose index is populated, so the composite actually issues and what withholds it in
// these tests is the identity: against the shipped contract the process index is withheld anyway,
// and a gate tested where the thing it gates was already off is not tested.
const issuingContract = () => contractWithAPopulatedIndex();

const allPassEvaluation = () => evaluate(allPassObservations(), {
  // Every facet identified, so the contract itself reaches PROFILE_BOUND and what withholds in
  // these tests is the identity record and only the identity record.
  facets: { language: "en", interface: "cli", harness: "aos@test", runtime: "codex", model: EXACT_A, operator: "fixture-operator", occasion: "1" },
  profile_digest: "d".repeat(64),
  forms_completed: ["FAM-1", "FAM-2", "FAM-3", "FAM-4", "FAM-5", "FAM-6"]
}, shippedEcdContract());

const runBlock = () => ({
  run_id: "run-fixture", mode: "ASSESS", suite: "aos-coding-p0", suite_digest: `sha256:${"a".repeat(64)}`,
  seed: "0000000000000021", seeded_families: ["FAM-1"], forms_completed: ["FAM-1"],
  profile_digest: "d".repeat(64), isolation_level: "BEST_EFFORT_CLI", scoring_permitted: true,
  evidence_status: "COMPLETE", safety_state: "S0", agents_used: ["main"], invocation_count: 1,
  fixture_backed_agents: [], unrecognised_runtime_agents: [], operator_plan_digest: `sha256:${"b".repeat(64)}`,
  operator_plan_authored: true
});

// The two provenance states a profile can be digested under: what a cycle locks when it opens (the
// bound model as the configured runtime is expected to confirm it) and what a run resolves once
// its own transcript is in hand.
const withProvenance = (profile, provenance) => ({
  ...profile,
  model_provider: provenance.provider,
  model_family: provenance.family,
  model_id: provenance.id,
  model_source: provenance.source,
  model_confidence: provenance.confidence,
  model_evidence_digest: provenance.evidence_digest,
  model_mutable_alias: provenance.mutable_alias,
  model_alias_class: provenance.alias_class,
  model_provenance: provenance
});

// The profile a cohort key is taken over: what the operator bound, and a contradiction when the
// run's own transcript named something else.
const cohortProfile = (profile, events = []) => withProvenance(profile, cohortProvenance({
  ...profile.model_inputs,
  runtime: profile.runtime_transcript,
  events
}));

const resolvedProfile = (profile, events) => {
  const fromRuntime = events.filter((event) => event.runtime === profile.runtime_transcript);
  return withProvenance(profile, resolveModelProvenance({ ...profile.model_inputs, runtimeEvent: fromRuntime[0] ?? null }));
};

// The transcript row a runtime writes for the model it used. Corroboration is now part of what a
// profile-bound claim needs (#561 round 2), so a fixture that asserts issuance has to carry one.
const confirming = (model) => {
  const [provider, name] = model.includes("/") ? model.split("/") : [null, model];
  return { runtime: "codex", provider, model: name, row_digest: `sha256:${"1".repeat(64)}` };
};

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
  // Two runs of one model under one runtime make the same claim, whatever rows they wrote. The
  // digest is a profile-digest input, so carrying the transcript row into it would make every
  // repeat of one measurement its own profile and no cycle could ever complete. The row is
  // recorded beside the claim instead.
  const monday = resolveModelProvenance({ runtimeEvent: { ...confirming(EXACT_A), row_digest: `sha256:${"1".repeat(64)}` }, declared: declared(EXACT_A) });
  const tuesday = resolveModelProvenance({ runtimeEvent: { ...confirming(EXACT_A), row_digest: `sha256:${"2".repeat(64)}` }, declared: declared(EXACT_A) });
  assert.equal(monday.evidence_digest, tuesday.evidence_digest);
  assert.notEqual(monday.evidence.row_digest, tuesday.evidence.row_digest);
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
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const policy = issuancePolicyFor({
    provenance,
    verification: verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" }),
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

    const events = [
      ...observeModelEvents({ env: { HOME: home }, workspace, since: Date.now() - 60_000, runtime: "codex" }).events,
      ...observeModelEvents({ env: { HOME: home }, workspace, since: Date.now() - 60_000, runtime: "claude-code" }).events
    ];
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
  assert.equal(verifyModelIdentity(bound, [same], { runtime: "codex" }).status, "CONFIRMED");
  const contradicted = verifyModelIdentity(bound, [other], { runtime: "codex" });
  assert.equal(contradicted.status, "MISMATCH");
  assert.equal(contradicted.code, "AOS_MODEL_IDENTITY_MISMATCH");
  assert.equal(contradicted.observed[0].id, EXACT_B);
  assert.equal(verifyModelIdentity(bound, [], { runtime: "codex" }).status, "NOT_OBSERVED");
  // Two different models in one run is not one model.
  assert.equal(verifyModelIdentity(bound, [same, other], { runtime: "codex" }).status, "AMBIGUOUS");
  // An unknown binding is not confirmed by an event that arrived after the digest was locked.
  const unknown = resolveModelProvenance({});
  assert.equal(verifyModelIdentity(unknown, [same], { runtime: "codex" }).status, "OBSERVED_UNBOUND");
  assert.equal(issuancePolicyFor({ provenance: unknown, verification: verifyModelIdentity(unknown, [same], { runtime: "codex" }) }).profile_bound_aggregation.reason, "MODEL_UNKNOWN");
  assert.equal(issuancePolicyFor({ provenance: bound, verification: contradicted }).profile_bound_aggregation.reason, "MODEL_IDENTITY_MISMATCH");
  assert.equal(issuancePolicyFor({ provenance: bound, verification: verifyModelIdentity(bound, [same, other], { runtime: "codex" }) }).profile_bound_aggregation.reason, "MODEL_EVENT_AMBIGUOUS");
});

test("the transcript scan is bounded, and exhausting the budget is a named answer", () => {
  // The scan runs after the child has exited, so it is outside the timeout that bounds the child.
  // Ten thousand files of sixty-four megabytes each is a cheap thing for an assessed program to
  // leave behind and about six hundred gigabytes of synchronous reading for this to do (#561
  // round 6). The budget is over the whole scan, and running out of it is an answer -- not a
  // reason to keep reading.
  const home = mkdtempSync(join(tmpdir(), "aos-model-budget-"));
  try {
    const workspace = "/tmp/aos-runs/run-9/workspaces/FAM-1";
    const dir = join(home, ".codex", "sessions", "2026", "09", "03");
    mkdirSync(dir, { recursive: true });
    const row = `${JSON.stringify({ type: "session_meta", payload: { cwd: workspace, model_provider: "openai" } })}\n${JSON.stringify({ type: "turn_context", payload: { cwd: workspace, model: "gpt-4o-2024-08-06" } })}\n`;
    // Well under the per-file cap and far over the budget in aggregate.
    const filler = `${JSON.stringify({ type: "noise", payload: { pad: "x".repeat(4000) } })}\n`.repeat(300);
    for (let index = 0; index < 40; index += 1) writeFileSync(join(dir, `rollout-${index}.jsonl`), filler);
    writeFileSync(join(dir, "rollout-answer.jsonl"), row);

    const generous = observeModelEvents({ env: { HOME: home }, workspace, since: 0, runtime: "codex" });
    assert.equal(generous.events.length, 1, "the answer is still found when the budget allows it");
    assert.equal(generous.exhausted, false);

    // Entries examined, not files accepted: a directory of files this reader never opens is still
    // a directory this reader walked, and a child can make hundreds of thousands of them.
    const noise = join(home, ".codex", "sessions", "2026", "09", "04");
    mkdirSync(noise, { recursive: true });
    for (let index = 0; index < 200; index += 1) writeFileSync(join(noise, `pad-${index}.txt`), "x");
    const walked = observeModelEvents({ env: { HOME: home }, workspace, since: 0, runtime: "codex", budget: { entries: 20 } });
    assert.equal(walked.exhausted, true, "entries nothing reads still cost nothing");
    assert.equal(walked.reason, "AOS_MODEL_SCAN_BUDGET");

    const starved = observeModelEvents({ env: { HOME: home }, workspace, since: 0, runtime: "codex", budget: { bytes: 4096, files: 2 } });
    assert.equal(starved.exhausted, true);
    assert.equal(starved.reason, "AOS_MODEL_SCAN_BUDGET");
    // A scan that ran out of budget is not corroboration and says which blocker stopped it.
    const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
    const verification = verifyModelIdentity(provenance, starved.events, { runtime: "codex", scan: starved });
    assert.equal(verification.status, "NOT_OBSERVED");
    assert.equal(verification.code, "AOS_MODEL_SCAN_BUDGET");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a name this product cannot read as a model name is digested, whoever's prefix it wears", () => {
  // The shape check was a charset and a length, so anything spellable passed -- and the secret
  // detector only knows the vendors it was taught. A Hugging Face token in a transcript's `model`
  // field became `openai/hf_…` in the provenance, in the line, and in JSON, CLI, Markdown and
  // HTML. Chasing prefixes is the losing half of that trade: a model name has a shape -- short
  // segments that are families, versions, tiers or dates -- and a string that is not that shape is
  // not printed at all, whichever vendor invents the next prefix (#561 round 8).
  // Assembled rather than written out. These are invented values, and a file carrying the literal
  // shapes is a file secret scanners stop at the push -- the test needs the shape, not the string.
  const shaped = (prefix, body, separator = "_") => `${prefix}${separator}${body}`;
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const credentials = [
    shaped("hf", `${alphabet}0123456`),
    shaped("ghp", `${alphabet}012345`),
    shaped("xoxb", `1234567890-${alphabet.slice(0, 20)}`, "-"),
    "a".repeat(32),
    shaped("nvapi", "9f8e7d6c5b4a39281706abcdefabcdef", "-"),
    // Short enough to read as a name, and still an assignment the redactor knows: the shape check
    // and the secret check each catch cases the other does not.
    "api_key:abcdefghij"
  ];
  for (const value of credentials) {
    assert.equal(parseModelName(value, "openai"), null, value);
    const record = resolveModelProvenance({ runtimeEvent: { runtime: "codex", provider: "openai", model: value, row_digest: `sha256:${"4".repeat(64)}` } });
    assert.equal(record.id, null, value);
    assert.equal(canonicalJson(record).includes(value.slice(0, 12)), false, value);
  }
  // Real names, including ones from a provider this product has no snapshot rules for, still read.
  for (const value of ["gpt-4o-2024-08-06", "claude-3-5-sonnet-20241022", "gpt-5.6-sol", "claude-fable-5-1", "o3-mini-2025-01-31", "llama-3.1-405b-instruct-fp8", "qwen3-embedding"]) {
    assert.notEqual(parseModelName(value, "openai"), null, value);
  }
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
    const events = observeModelEvents({ env: { HOME: home }, workspace, since: Date.now() - 60_000, runtime: "claude-code" }).events;
    assert.equal(events.length, 2);
    for (const event of events) {
      assert.equal(event.model, null);
      assert.match(event.value_digest, /^sha256:[0-9a-f]{64}$/u);
    }
    assert.equal(events[0].value_digest, sha256Bytes(Buffer.from(secret, "utf8")));

    const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
    const verification = verifyModelIdentity(provenance, events, { runtime: "claude-code" });
    assert.equal(verification.status, "UNNAMEABLE");
    assert.equal(verification.code, "AOS_MODEL_EVENT_UNNAMEABLE");
    const record = modelIdentityRecord({
      by_agent: { main: { provenance, verification, runtime_identity_digest: null, runtime_identity_status: "VERIFIED" } },
      profile_digest: "d".repeat(64)
    });
    assert.equal(record.profile_bound_aggregation.reason, "MODEL_EVENT_UNNAMEABLE");
    const surfaces = [canonicalJson(record), record.lines.join("\n"), renderMarkdown({
      schema_id: "aos-mvp-result.v1",
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

test("the assessed process cannot flip a run from withheld to issued", () => {
  // The child writes the transcript into the HOME it was given, so whichever way the corroboration
  // rule points, the deciding input must not be that file. Round 3 made a missing transcript
  // withhold, which handed the child the flip: declaration alone withheld, declaration plus the
  // row it wrote issued. Trust runs the other way now -- the operator's declaration is what may
  // issue, and the transcript may only contradict it.
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const verified = boundRuntimeIdentity(identity());
  const policyWith = (verification) => issuancePolicyFor({ provenance, verification, runtimeIdentity: verified });
  const silent = policyWith(verifyModelIdentity(provenance, [], { runtime: "codex" }));
  const corroborated = policyWith(verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" }));
  // The child's row is the only difference between these two, and it changes nothing.
  assert.equal(silent.profile_bound_aggregation.status, "issued");
  assert.equal(corroborated.profile_bound_aggregation.status, "issued");
  assert.equal(silent.claim_stage, corroborated.claim_stage);
  // What it can do is contradict, and that withholds.
  const contradicted = policyWith(verifyModelIdentity(provenance, [confirming(EXACT_B)], { runtime: "codex" }));
  assert.equal(contradicted.profile_bound_aggregation.reason, "MODEL_IDENTITY_MISMATCH");
  // And a model the operator never stated is never issued, however confidently the child says it.
  const onlyChild = resolveModelProvenance({ runtimeEvent: confirming(EXACT_A) });
  assert.equal(issuancePolicyFor({
    provenance: onlyChild,
    verification: verifyModelIdentity(onlyChild, [confirming(EXACT_A)], { runtime: "codex" }),
    runtimeIdentity: verified
  }).profile_bound_aggregation.reason, "MODEL_EVENT_UNATTESTED");
});

test("a transcript that never appeared is reported by name and decides nothing", () => {
  // The absence is a fact about the run and is recorded as one -- a runtime that wrote no
  // transcript, or wrote it somewhere this run could not see. What it is not is a verdict on the
  // operator's declaration: the file is the assessed process's to write, so making its absence
  // withhold would have handed that process the decision (see the test above).
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const verification = verifyModelIdentity(provenance, [], { runtime: "codex" });
  assert.equal(verification.status, "NOT_OBSERVED");
  assert.equal(verification.code, "AOS_MODEL_EVENT_NOT_OBSERVED");
  const record = modelIdentityRecord({
    by_agent: { main: { provenance, verification, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  assert.equal(record.by_agent.main.verification.code, "AOS_MODEL_EVENT_NOT_OBSERVED");
  assert.equal(record.profile_bound_aggregation.status, "issued");
  // And the line does not claim a confirmation that never happened.
  assert.equal(record.lines[0].includes("confirmed by the runtime's own transcript"), false, record.lines[0]);
  assert.equal(record.lines[0], `Model (main): declared ${EXACT_A} (exact-snapshot)`);
});

test("a verdict this product did not produce is ignored, never read as agreement", () => {
  // Only `null` and NOT_OBSERVED counted as absent, so a shape nothing here emits -- `{}`, an
  // unknown status, a status borrowed from another vocabulary -- was carried into the record and
  // read by every check that asks what the verification said. The set of verdicts is closed: a
  // shape outside it is dropped, so it can neither claim a confirmation nor mask a contradiction.
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  for (const verification of [{}, { status: "UNKNOWN" }, { status: "WITHHELD" }, { status: null }, "CONFIRMED", 7]) {
    const record = modelIdentityRecord({
      by_agent: { main: { provenance, verification, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
      profile_digest: "d".repeat(64)
    });
    assert.equal(record.by_agent.main.verification, null, JSON.stringify(verification));
    assert.equal(record.lines[0].includes("confirmed"), false, JSON.stringify(verification));
  }
  // A real mismatch is not something a hand-made object can talk over: the provenance carries it.
  const mismatched = resolveModelProvenance({ runtimeEvent: confirming(EXACT_B), declared: declared(EXACT_A) });
  const talkedOver = modelIdentityRecord({
    by_agent: { main: { provenance: mismatched, verification: { status: "CONFIRMED" }, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  assert.equal(talkedOver.profile_bound_aggregation.reason, "MODEL_IDENTITY_MISMATCH");
});

test("a transcript the assessed process could have written is never sufficient on its own", () => {
  // The transcript is read out of the HOME the assessed child was given, so the child can write
  // it. Round 3 made corroboration necessary; this is the other half -- it is never sufficient.
  // A model named only by that transcript is a claim the assessed artifact made about itself.
  const fabricated = { runtime: "codex", provider: "openai", model: "gpt-4o-2024-08-06", row_digest: `sha256:${"3".repeat(64)}` };
  const onlyTranscript = resolveModelProvenance({ runtimeEvent: fabricated });
  assert.equal(onlyTranscript.id, EXACT_A);
  assert.equal(onlyTranscript.source, "runtime-event");
  assert.deepEqual(onlyTranscript.corroborated_by, []);
  const policy = issuancePolicyFor({
    provenance: onlyTranscript,
    verification: verifyModelIdentity(onlyTranscript, [fabricated], { runtime: "codex" }),
    runtimeIdentity: boundRuntimeIdentity(identity())
  });
  assert.equal(policy.profile_bound_aggregation.status, "withheld");
  assert.equal(policy.profile_bound_aggregation.reason, "MODEL_EVENT_UNATTESTED");
  assert.equal(policy.claim_stage, "RUN_DIAGNOSTIC");
  // The operator's own declaration is what the transcript may confirm. Both together issue.
  const attested = resolveModelProvenance({ runtimeEvent: fabricated, declared: declared(EXACT_A) });
  assert.deepEqual(attested.corroborated_by, ["declared"]);
  assert.equal(issuancePolicyFor({
    provenance: attested,
    verification: verifyModelIdentity(attested, [fabricated], { runtime: "codex" }),
    runtimeIdentity: boundRuntimeIdentity(identity())
  }).profile_bound_aggregation.status, "issued");
});

test("a date-shaped substring is not snapshot proof", () => {
  // Any four-two-two run of digits counted as a provider's promise not to move the name, so
  // `latest-9999-99-99` was an exact identity: an impossible date, under a root that says the
  // provider moves it, in a family this product has never been told the naming rules for.
  for (const name of [
    "openai/latest-9999-99-99", "anthropic/sonnet-2026-13-40", "openai/gpt-2026-02-30",
    "openai/not-a-real-model-20260101", "newco/llm-2026-01-01",
    // A moving root anywhere in the name, not only at the front, and a segment under a family this
    // product does know that names nothing it can recognise. Both read as snapshots and are not.
    "openai/gpt-latest-2024-01-01", "anthropic/claude-default-3-5-20241022",
    "openai/gpt-not-a-real-model-2024-01-01", "anthropic/claude-fabricated-tier-20241022"
  ]) {
    const record = resolveModelProvenance({ declared: { model: name, provider: null } });
    assert.equal(record.mutable_alias, true, name);
    assert.notEqual(record.status, "EXACT", name);
    assert.equal(issuancePolicyFor({
      provenance: record, verification: null, runtimeIdentity: boundRuntimeIdentity(identity())
    }).profile_bound_aggregation.reason, "MODEL_MUTABLE_ALIAS", name);
  }
  // A real calendar date under a family whose snapshot naming this product knows is still exact,
  // including a leap day.
  for (const name of [
    EXACT_A, "anthropic/claude-3-5-sonnet-20241022", "openai/gpt-4o-2024-02-29",
    "anthropic/claude-opus-4-1-20250805", "openai/gpt-4.1-2025-04-14", "openai/o3-mini-2025-01-31"
  ]) {
    const record = resolveModelProvenance({ declared: { model: name, provider: null } });
    assert.equal(record.mutable_alias, false, name);
    assert.equal(record.alias_class, "exact-snapshot", name);
  }
  assert.deepEqual(aliasClassOf("openai/latest-2026-01-01"), { alias_class: "bare-alias", mutable_alias: true });
  assert.deepEqual(aliasClassOf("newco/llm-2026-01-01"), { alias_class: "unrecognised-family", mutable_alias: true });
});

test("a cycle's runtime identity is the runs' own, not the registration it was opened with", () => {
  // The binding carried the registration's runtime status while every run described the executable
  // it actually spawned, and the cycle read only the binding -- so a stale VERIFIED registration
  // turned a run whose executable was UNTRUSTED into an issued cycle (#561 round 9). The runs are
  // where the executable was seen; the weakest of them decides.
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const confirmed = verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" });
  const binding = modelIdentityRecord({
    by_agent: { solo: { provenance, verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  const runWith = (status) => ({
    valid: true,
    model_identity: modelIdentityRecord({
      by_agent: { solo: { provenance, verification: confirmed, runtime_identity_digest: identity().identity_digest, runtime_identity_status: status } },
      profile_digest: "d".repeat(64)
    })
  });
  const untrusted = cycleModelIdentity({ binding, runs: [runWith("VERIFIED"), runWith("UNTRUSTED"), runWith("VERIFIED")] });
  assert.equal(untrusted.by_agent.solo.runtime_identity_status, "UNTRUSTED");
  assert.equal(untrusted.profile_bound_aggregation.reason, "RUNTIME_IDENTITY_UNVERIFIED");
  const verified = cycleModelIdentity({ binding, runs: [runWith("VERIFIED"), runWith("VERIFIED"), runWith("VERIFIED")] });
  assert.equal(verified.profile_bound_aggregation.status, "issued");
});

test("a cycle is judged over the agents that ran, whether or not their runs earned a number", () => {
  // Whether a run's composite issued is an outcome question. Which agents ran, and under which
  // model, is a fact of the run either way -- and reading only the issued runs narrowed the cohort
  // to nothing, so the cycle was judged over every registered agent instead, including two the
  // plan never used. A healthy cycle of an exactly-named model then reported MODEL_UNKNOWN and
  // the report dropped its profile-bound sentence (#561 round 10).
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const confirmed = verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" });
  const agent = (id, entry) => ({ [id]: entry });
  const binding = modelIdentityRecord({
    by_agent: {
      ...agent("solo", { provenance, verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" }),
      ...agent("never-ran", { provenance: resolveModelProvenance({}), verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" })
    },
    profile_digest: "d".repeat(64)
  });
  const unissued = {
    valid: false,
    invalid_reason: "NOT_ISSUED",
    model_identity: modelIdentityRecord({
      by_agent: agent("solo", { provenance, verification: confirmed, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" }),
      profile_digest: "d".repeat(64)
    })
  };
  const cycle = cycleModelIdentity({ binding, runs: [unissued, unissued, unissued] });
  assert.deepEqual(Object.keys(cycle.by_agent), ["solo"], "an agent that never ran was judged");
  assert.equal(cycle.profile_bound_aggregation.status, "issued");
  // A run the cycle recorded with no identity record at all still closes the cycle: absence of the
  // record is not absence of the run.
  assert.equal(cycleModelIdentity({ binding, runs: [unissued, { valid: false, model_identity: null }] }), null);
});

test("one contradicted run withholds the whole cycle, however many others agreed", () => {
  // The merge takes the weakest verdict, not the strongest: a cycle in which one run named another
  // model is not three runs of one model, and two agreements do not average it away.
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const binding = modelIdentityRecord({
    by_agent: { solo: { provenance, verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  const runWith = (verification) => ({
    valid: true,
    model_identity: modelIdentityRecord({
      by_agent: { solo: { provenance, verification, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
      profile_digest: "d".repeat(64)
    })
  });
  const confirmed = verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" });
  const silent = verifyModelIdentity(provenance, [], { runtime: "codex" });
  const other = verifyModelIdentity(provenance, [confirming(EXACT_B)], { runtime: "codex" });
  const contradicted = cycleModelIdentity({ binding, runs: [runWith(confirmed), runWith(other), runWith(confirmed)] });
  assert.equal(contradicted.by_agent.solo.verification.status, "MISMATCH");
  assert.equal(contradicted.profile_bound_aggregation.reason, "MODEL_IDENTITY_MISMATCH");
  // A run whose transcript said nothing is reported as the weakest verdict too, and what keeps it
  // out of the aggregate is the cohort key, not a verdict the assessed process could have written:
  // its provenance resolved differently, so it is a different profile (see the cohort test above).
  const mixed = cycleModelIdentity({ binding, runs: [runWith(confirmed), runWith(silent), runWith(silent)] });
  assert.equal(mixed.by_agent.solo.verification.status, "NOT_OBSERVED");
  const allConfirmed = cycleModelIdentity({ binding, runs: [runWith(confirmed), runWith(confirmed), runWith(confirmed)] });
  assert.equal(allConfirmed.profile_bound_aggregation.status, "issued");
});

test("a transcript the configured runtime did not write is not evidence either way", () => {
  // Confirmation compared the model name and nothing else, so any process that could write a
  // Codex-shaped row under the run's HOME spoke for the runtime. Evidence is evidence of the
  // runtime that was configured: a row in another runtime's shape neither confirms a binding nor
  // contradicts one, because it is not that runtime's statement.
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const foreign = { runtime: "not-the-configured-runtime", provider: "openai", model: "gpt-4o-2024-08-06", row_digest: `sha256:${"2".repeat(64)}` };
  assert.equal(verifyModelIdentity(provenance, [foreign], { runtime: "codex" }).status, "NOT_OBSERVED");
  const contradictingForeign = { ...foreign, model: "gpt-4o-2024-11-20" };
  assert.equal(verifyModelIdentity(provenance, [contradictingForeign], { runtime: "codex" }).status, "NOT_OBSERVED");
  // An adapter that writes no transcript this product knows how to read is never corroborated by
  // whatever is lying in the temporary HOME.
  assert.equal(verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: null }).status, "NOT_OBSERVED");
  assert.equal(verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" }).status, "CONFIRMED");
  // And the reader only opens the tree the configured runtime writes.
  const home = mkdtempSync(join(tmpdir(), "aos-model-foreign-"));
  try {
    const workspace = "/tmp/aos-runs/run-3/workspaces/FAM-1";
    const claudeDir = join(home, ".claude", "projects", "-tmp-aos-runs-run-3-workspaces-FAM-1");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "s1.jsonl"), `${JSON.stringify({ type: "assistant", cwd: workspace, message: { model: "claude-opus-5" } })}\n`);
    assert.deepEqual(observeModelEvents({ env: { HOME: home }, workspace, since: 0, runtime: "codex" }).events, []);
    assert.equal(observeModelEvents({ env: { HOME: home }, workspace, since: 0, runtime: "claude-code" }).events.length, 1);
    assert.deepEqual(observeModelEvents({ env: { HOME: home }, workspace, since: 0, runtime: null }).events, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// The profile digest

test("declared A vs declared B gives a different profile digest", () => {
  assert.notEqual(build({ agent: agent({ model_id: EXACT_A }) }).profile_digest, build({ agent: agent({ model_id: EXACT_B }) }).profile_digest);
});

test("the profile digest covers the provenance record, source and evidence included", () => {
  // The issue names provider, family, id, source, confidence, evidence digest and mutable-alias
  // state as digest inputs. A name read off a flag and the same name the operator declared are
  // different evidence for the same claim, and a run that turned out to have different provenance
  // is a different profile -- which is what makes it fall out of a cycle's cohort by name rather
  // than being averaged into it.
  const base = build();
  for (const over of [
    { model_source: "runtime-event" },
    { model_confidence: "HIGH" },
    { model_evidence_digest: `sha256:${"f".repeat(64)}` }
  ]) {
    assert.notEqual(profileDigestOf({ ...base, ...over }), base.profile_digest, Object.keys(over)[0]);
  }
});

test("the operator's binding admits a run to the cohort; the transcript may only contradict it", () => {
  // The cohort key decides whether a run counts toward an Operator Score, so nothing the assessed
  // process writes may decide it. The cycle used to lock the provenance it expected the runtime to
  // state, which made a forged Codex row the difference between PROFILE_CHANGED and valid: three
  // fabricated rows reached the score threshold. What the key is taken over is what the operator
  // bound; a transcript that names another model is a contradiction and does move the key, which
  // is the one direction the child cannot profit from.
  const agentWith = (model) => agent({ model_id: model, adapter: "codex-cli.v1" });
  const locked = profileDigestOf(cohortProfile(build({ agent: agentWith(EXACT_A) })));
  const silent = profileDigestOf(cohortProfile(build({ agent: agentWith(EXACT_A) }), []));
  const forged = profileDigestOf(cohortProfile(build({ agent: agentWith(EXACT_A) }), [confirming(EXACT_A)]));
  assert.equal(silent, locked, "a run nothing corroborated fell out of its own cohort");
  assert.equal(forged, locked, "a transcript row changed the cohort key");
  const contradicted = profileDigestOf(cohortProfile(build({ agent: agentWith(EXACT_A) }), [confirming(EXACT_B)]));
  assert.notEqual(contradicted, locked, "a run that named another model stayed in the cohort");

  const cycle = { seeds: [1], profile_digest: locked, suite_major: 0, scorer_major: 0 };
  const run = (digest) => ({ seed: 1, profile_digest: digest, suite_major: 0, scorer_major: 0, terminal_committed: true, issued: true });
  assert.equal(runValidity(cycle, run(silent)).valid, true);
  assert.equal(runValidity(cycle, run(forged)).valid, true);
  assert.equal(runValidity(cycle, run(contradicted)).reason, "PROFILE_CHANGED");
  // Two runs of the same declaration are one cohort whatever their transcripts said, or no cycle
  // could complete without the child's cooperation.
  const second = profileDigestOf(cohortProfile(build({ agent: agentWith(EXACT_A) }), [{ ...confirming(EXACT_A), row_digest: `sha256:${"7".repeat(64)}` }]));
  assert.equal(second, locked);
});

test("the profile digest moves for each model, runtime, adapter, environment, isolation and language field on its own", () => {
  const base = build();
  const fields = [
    ["model_provider", { model_provider: "other" }],
    ["model_family", { model_family: "other" }],
    ["model_id", { model_id: EXACT_B }],
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

test("an identity a previous release wrote still binds, by a name that says what it is", () => {
  // Binding the status into the digest changed what the digest covers, and the record kept its old
  // schema id -- so every identity `dev` had already written failed to recompute and bound as
  // UNVERIFIABLE with a null digest. A cycle then locked a null executable and excluded every run
  // as PROFILE_CHANGED: agents registered before this release could not contribute a run at all,
  // silently. The new shape has its own id, and the old one is read as what it is.
  const current = identity();
  assert.equal(current.schema_id, IDENTITY_SCHEMA);
  assert.equal(boundRuntimeIdentity(current).identity_status, "VERIFIED");

  const legacy = legacyIdentity();
  assert.equal(legacy.schema_id, LEGACY_IDENTITY_SCHEMA);
  const bound = boundRuntimeIdentity(legacy);
  assert.equal(bound.identity_digest, legacy.identity_digest, "a record this product wrote was refused outright");
  assert.equal(bound.identity_status, "UNVERIFIED_LEGACY_SCHEMA");
  // Named, not silent: it does not issue, and the reason says what to do about it.
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const policy = issuancePolicyFor({ provenance, verification: null, runtimeIdentity: bound });
  assert.equal(policy.profile_bound_aggregation.reason, "RUNTIME_IDENTITY_UNVERIFIED");
  assert.match(policy.profile_bound_aggregation.detail, /re-register/u);
  // A legacy record whose own digest does not recompute is still refused.
  assert.equal(boundRuntimeIdentity({ ...legacy, owner_uid: 999 }).identity_status, "UNVERIFIABLE");
});

test("a cycle and its runs bind the executable as it is now, not as it was registered", () => {
  // The other half of the same fallout. A cycle opened from a registration written by a previous
  // release locked that record's digest, while every run described the executable at spawn and
  // reported a current one -- two different digests for one program, and PROFILE_CHANGED on every
  // run. Both sides describe the executable now, so a stale registration cannot exclude a run; the
  // drift between the two is reported instead.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-legacy-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo", undefined, ["--model-id", EXACT_A, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
    // Rewrite the stored identity the way a previous release would have left it.
    const store = join(cwd, ".aos", "agents.json");
    const config = JSON.parse(readFileSync(store, "utf8"));
    const stored = config.agents.solo.runtime_identity;
    config.agents.solo.runtime_identity = {
      ...stored,
      schema_id: LEGACY_IDENTITY_SCHEMA,
      identity_digest: legacyDigestOf({ ...stored, schema_id: LEGACY_IDENTITY_SCHEMA })
    };
    writeFileSync(store, `${JSON.stringify(config, null, 2)}\n`);

    const plan = makePlan(cwd, { default: "solo" });
    run(cwd, ["cycle", "start", "--seed", SEEDS[0], "--seed", SEEDS[1], "--seed", SEEDS[2]]);
    const cycle = JSON.parse(readFileSync(join(cwd, ".aos", "cycle.json"), "utf8"));
    spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]], {
      cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: "needs-instruction", FAKE_AGENT_MODEL: EXACT_A }
    });
    const result = newestResult(cwd);
    assert.equal(result.profile_digest, `sha256:${cycle.profile_digest}`, "a registration from a previous release excluded the run");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an untrusted identity cannot be relabelled VERIFIED without the digest saying so", () => {
  // The status was read off the record while the digest was taken over every other field, so an
  // identity #554 had recorded as UNTRUSTED -- a world-writable directory holding the binary --
  // could be relabelled VERIFIED with the digest still recomputing. A status a record asserts
  // about itself is not evidence of anything.
  const untrusted = identity({
    identity_status: "UNTRUSTED",
    parent_security: { world_writable: true, group_writable_untrusted: false, foreign_owner: false, acl_writable: false },
    untrusted_reasons: ["world_writable /tmp"]
  });
  assert.equal(boundRuntimeIdentity(untrusted).identity_status, "UNTRUSTED");
  const relabelled = { ...untrusted, identity_status: "VERIFIED" };
  const bound = boundRuntimeIdentity(relabelled);
  assert.notEqual(bound.identity_status, "VERIFIED", "an asserted status was taken as the answer");
  assert.equal(bound.identity_digest, null);

  // Two locks, and each has a case only it catches. The digest covers the status, so a record
  // marked UNTRUSTED for something the parent directories do not show -- the file itself being
  // world-writable, say -- cannot be relabelled either.
  const fileLevel = identity({ identity_status: "UNTRUSTED", untrusted_reasons: ["world_writable /usr/bin/codex"] });
  assert.equal(boundRuntimeIdentity(fileLevel).identity_status, "UNTRUSTED");
  assert.equal(boundRuntimeIdentity({ ...fileLevel, identity_status: "VERIFIED" }).identity_status, "UNVERIFIABLE");
  // And a record whose digest was computed while it said VERIFIED, over a security state that says
  // somebody else can write the directory, is refused by the second lock rather than believed.
  const selfConsistent = identity({
    identity_status: "VERIFIED",
    parent_security: { world_writable: true, group_writable_untrusted: false, foreign_owner: false, acl_writable: false }
  });
  assert.equal(identityDigestOf(selfConsistent), selfConsistent.identity_digest, "the fixture is self-consistent");
  assert.equal(boundRuntimeIdentity(selfConsistent).identity_status, "UNVERIFIABLE");
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  assert.equal(issuancePolicyFor({
    provenance,
    verification: verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" }),
    runtimeIdentity: bound
  }).profile_bound_aggregation.status, "withheld");
  // A record whose security state says nothing is wrong and whose status says VERIFIED is the only
  // combination that binds, and its digest is the one the contract computed.
  assert.equal(boundRuntimeIdentity(identity()).identity_status, "VERIFIED");
});

test("a missing, untrusted or unverifiable executable identity withholds the aggregate by its own name", () => {
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const cases = [
    ["MIGRATION_REQUIRED", null],
    ["UNTRUSTED", identity({ identity_status: "UNTRUSTED", untrusted_reasons: ["world_writable /usr/bin"] })],
    ["UNVERIFIABLE", { schema_id: IDENTITY_SCHEMA, identity_digest: `sha256:${"a".repeat(64)}`, identity_status: "VERIFIED" }]
  ];
  const verification = verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" });
  for (const [status, record] of cases) {
    const bound = boundRuntimeIdentity(record);
    assert.equal(bound.identity_status, status, status);
    const policy = issuancePolicyFor({ provenance, verification, runtimeIdentity: bound });
    assert.equal(policy.profile_bound_aggregation.status, "withheld", status);
    assert.equal(policy.profile_bound_aggregation.reason, "RUNTIME_IDENTITY_UNVERIFIED", status);
    assert.equal(policy.profile_bound_aggregation.detail.includes(status), true, status);
    assert.equal(policy.claim_stage, "RUN_DIAGNOSTIC", status);
  }
  // The exact model with a verified executable is the only combination that issues.
  const verified = issuancePolicyFor({ provenance, verification, runtimeIdentity: boundRuntimeIdentity(identity()) });
  assert.equal(verified.profile_bound_aggregation.status, "issued");
  // And the record built for a projection carries the status it was bound under.
  const record = modelIdentityRecord({
    by_agent: { main: { provenance, verification, runtime_identity_digest: null, runtime_identity_status: "MIGRATION_REQUIRED" } },
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
    verification: verifyModelIdentity(left.model_provenance, [confirming(EXACT_A)], { runtime: "codex" }),
    runtimeIdentity: { identity_digest: left.runtime_identity_digest, identity_status: left.runtime_identity_status }
  });
  assert.equal(policy.profile_bound_aggregation.status, "issued");
  assert.equal(policy.claim_stage, "PROFILE_BOUND");
});

test("cross-model and generalizability are read from the contract, not restated beside it", async () => {
  // The first draft of #561 wrote its own comparability function in lib/profile.mjs, and the
  // second restated the contract's answers as literals in this module: `UNESTABLISHED`,
  // `WITHHELD`, `INVARIANCE_UNESTABLISHED`. A literal that happens to agree today is a copy that
  // goes stale silently, so the projection reads the artifact.
  const profileModule = await import("../../lib/profile.mjs");
  assert.equal(Object.hasOwn(profileModule, "comparabilityOf"), false);
  assert.equal(Object.hasOwn(profileModule, "sameCohort"), false);
  assert.throws(() => comparability({}, {}), /AOS_UNEMITTED_RESULT/u);

  const use = shippedEcdContract().interpretation_use;
  const rule = use.comparability_rules.find((entry) => entry.rule_id === "invariance-required");
  const policy = issuancePolicyFor({ provenance: resolveModelProvenance({ declared: declared(EXACT_A) }) });
  assert.equal(policy.generalizability_status, use.generalizability_status);
  assert.equal(policy.comparison_until, rule.refusal_reason);
  assert.equal(policy.cross_model_comparison, "WITHHELD");
  assert.equal(policy.model_change_improvement_claim, "WITHHELD");
  assert.equal(rule.status, "UNESTABLISHED", "the contract still withholds cross-model comparison");
  // Read, not restated: a contract whose invariance rule is enforced would stop this projection
  // from withholding, and a contract that establishes generalizability would move that field.
  const established = modelIdentityProjection({
    contract: {
      interpretation_use: {
        generalizability_status: "SUPPORTED",
        comparability_rules: [{ rule_id: "invariance-required", status: "ENFORCED", refusal_reason: "INVARIANCE_UNESTABLISHED" }]
      }
    }
  });
  assert.equal(established.generalizability_status, "SUPPORTED");
  assert.equal(established.cross_model_comparison, "PERMITTED");
  // And a contract with no invariance rule at all is missing the evidence, not free of the rule.
  const silentContract = modelIdentityProjection({
    contract: { interpretation_use: { generalizability_status: "UNESTABLISHED", comparability_rules: [] } }
  });
  assert.equal(silentContract.cross_model_comparison, "WITHHELD");
  assert.equal(silentContract.model_change_improvement_claim, "WITHHELD");
  assert.equal(silentContract.comparison_until, "INVARIANCE_RULE_ABSENT");
});

// ---------------------------------------------------------------------------------------------
// The projection every surface shows

test("the model identity lines are the same strings for JSON, CLI and Markdown", () => {
  const provenance = resolveModelProvenance({ declared: declared(EXACT_A) });
  const record = modelIdentityRecord({
    by_agent: { main: { provenance, verification: verifyModelIdentity(provenance, [confirming(EXACT_A)], { runtime: "codex" }), runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  const lines = modelIdentityLines(record);
  assert.deepEqual(lines, [
    `Model (main): declared ${EXACT_A} (exact-snapshot, confirmed by the runtime's own transcript)`,
    `Runtime executable identity (main): ${identity().identity_digest.slice("sha256:".length, "sha256:".length + 12)}`,
    `Profile digest: sha256:${"d".repeat(64)}`,
    "Profile-bound aggregation: issued"
  ]);
  // JSON carries the lines verbatim; Markdown and HTML quote them verbatim.
  assert.deepEqual(record.lines, lines);
  const result = {
    schema_id: "aos-mvp-result.v1",
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
    schema_id: "aos-mvp-result.v1",
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

test("the card quotes the stored identity lines, every agent of them, and renders nothing missing as a zero", () => {
  // The card is the third renderer and the one that leaves the page. Markdown and HTML quote the
  // record's own lines; this derived its own from the first `by_agent` entry, so a two-agent result
  // showed one model and a stored projection could say something the card did not (#561 round 6).
  const sentinels = ["SENTINEL_MODEL_ONE", "SENTINEL_MODEL_TWO", "SENTINEL_PROFILE", "SENTINEL_AGGREGATION"];
  const stored = {
    ...modelIdentityRecord({
      by_agent: {
        first: { provenance: resolveModelProvenance({ declared: declared(EXACT_A) }), verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" },
        second: { provenance: resolveModelProvenance({ declared: declared(EXACT_B) }), verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" }
      },
      profile_digest: "d".repeat(64)
    }),
    lines: sentinels
  };
  const result = {
    schema_id: "aos-mvp-result.v1",
    run_id: "r", status: "SCORED", score: { final: 71, band: "MODERATE", raw: 71 }, coverage: { observed: 20, total: 20 },
    metrics: [], dimensions: {}, limitations: [], seed: "0000000000000011", profile_digest: "d".repeat(64),
    agent_portfolio: { used: ["first", "second"] }, model_identity: stored
  };
  for (const locale of ["en-US", "ko-KR"]) {
    const card = renderCard(result, { locale });
    for (const line of sentinels) assert.equal(card.includes(htmlEscape(line)), true, `${locale}: ${line}`);
    assert.equal(card.includes("gpt-4o-2024-08-06"), false, `${locale}: the card derived its own model line`);
  }
  // Missing is not zero: a result with no coverage says so rather than drawing a measured 0 of 20.
  const bare = renderCard({ schema_id: "aos-mvp-result.v1",
    run_id: "r", status: "INCOMPLETE", score: null, provisional_raw: 0, metrics: [], dimensions: {}, limitations: [] }, { locale: "en-US" });
  assert.equal(/0\/20/u.test(bare), false, "absent coverage was rendered as a measurement");
  assert.match(bare, /—/u);
});

test("the profile renderers quote the stored identity lines, and the profile card carries them", () => {
  // The v2 renderers recomputed the projection and the v2 card had no identity on it at all --
  // Markdown, HTML and the card each deciding for themselves what a result says about its model
  // (#561 round 9). They quote what the record stored, and a sentinel is how that is checked.
  const evaluation = allPassEvaluation();
  const named = modelIdentityRecord({
    by_agent: { main: { provenance: resolveModelProvenance({ declared: declared(EXACT_A) }), verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  const result = buildResult({ evaluation, observations: allPassObservations(), run: runBlock(), model_identity: named });
  const stored = { ...result, model_identity: { ...result.model_identity, lines: ["SENTINEL_FROM_STORED_PROFILE"] } };
  for (const locale of ["en-US", "ko-KR"]) {
    const markdown = renderProfileMarkdown(stored, { locale });
    const html = renderProfileHtml(stored, { locale });
    const card = renderProfileCard(stored, { locale });
    assert.match(markdown, /SENTINEL_FROM_STORED_PROFILE/u, `${locale}: markdown`);
    assert.match(html, /SENTINEL_FROM_STORED_PROFILE/u, `${locale}: html`);
    assert.match(card, /SENTINEL_FROM_STORED_PROFILE/u, `${locale}: card`);
    for (const surface of [markdown, html, card]) {
      assert.equal(surface.includes(`Model (main): declared ${EXACT_A}`), false, `${locale}: a surface derived its own lines`);
    }
  }
});

test("a report whose aggregate is withheld does not also print the profile-bound claim", () => {
  const unknown = modelIdentityRecord({
    by_agent: { main: { provenance: resolveModelProvenance({}), verification: null, runtime_identity_digest: null, runtime_identity_status: "MIGRATION_REQUIRED" } },
    profile_digest: "d".repeat(64)
  });
  const base = {
    schema_id: "aos-mvp-result.v1",
    run_id: "r", status: "SCORED", score: null, provisional_raw: 0, coverage: { observed: 0, total: 20 },
    metrics: [], dimensions: {}, limitations: []
  };
  const withheld = renderMarkdown({ ...base, model_identity: unknown });
  assert.equal(withheld.includes("PROFILE-BOUND —"), false);
  assert.equal(withheld.includes("RUN-DIAGNOSTIC —"), true);
  assert.equal(withheld.includes("Profile-bound aggregation: withheld"), true);
  const exact = resolveModelProvenance({ declared: declared(EXACT_A) });
  const issued = modelIdentityRecord({
    by_agent: { main: { provenance: exact, verification: verifyModelIdentity(exact, [confirming(EXACT_A)], { runtime: "codex" }), runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
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
  assert.equal(mutableLines[0], "Model (main): configured openai/gpt-5.6-terra (provider-managed-alias, mutable)");
  assert.equal(mutableLines[1], "Runtime executable identity (main): unverified (MIGRATION_REQUIRED)");
  assert.equal(mutableLines[3], "Profile-bound aggregation: withheld — MODEL_MUTABLE_ALIAS: openai/gpt-5.6-terra is a provider-managed alias without snapshot proof");

  const unknown = resolveModelProvenance({});
  const unknownLines = modelIdentityLines(modelIdentityRecord({ by_agent: { main: { provenance: unknown, verification: null, runtime_identity_digest: null } }, profile_digest: "d".repeat(64) }));
  assert.equal(unknownLines[0], "Model (main): unknown");
  assert.equal(unknownLines[3], "Profile-bound aggregation: withheld — MODEL_UNKNOWN: no runtime event, runtime config or declaration identified the model");

  const bound = resolveModelProvenance({ declared: declared(EXACT_A) });
  const other = { model: "gpt-4o-2024-11-20", provider: "openai", runtime: "codex", row_digest: "sha256:" + "0".repeat(64) };
  const mismatchLines = modelIdentityLines(modelIdentityRecord({ by_agent: { main: { provenance: bound, verification: verifyModelIdentity(bound, [other], { runtime: "codex" }), runtime_identity_digest: null } }, profile_digest: "d".repeat(64) }));
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

test("a canonical result never issues a profile-bound claim its identity record withholds", () => {
  // The record was copied into the result and read by nothing: `buildResult` computed the claim
  // stage and the composite from the contract alone, so a result with no identity at all -- or one
  // whose own policy said MODEL_UNKNOWN -- came out PROFILE_BOUND with a composite (#561 round 9).
  // The identity is a condition on the claim, not a decoration beside it.
  const evaluation = allPassEvaluation();
  const unknown = modelIdentityRecord({
    by_agent: { main: { provenance: resolveModelProvenance({}), verification: null, runtime_identity_digest: null, runtime_identity_status: "MIGRATION_REQUIRED" } },
    profile_digest: "d".repeat(64)
  });
  const withheld = buildResult({ evaluation, observations: allPassObservations(), run: runBlock(), model_identity: unknown });
  assert.equal(withheld.claim_stage, "RUN_DIAGNOSTIC");
  assert.equal(withheld.aos_composite.issued, false);
  assert.equal(withheld.aos_composite.value, null);
  // And against a contract whose index is populated -- where the composite really does issue --
  // the identity is what takes the number away, and its reason is the one printed.
  // One contract object for both: the evaluation is bound to the contract it was emitted under.
  const contract = issuingContract();
  const issuing = evaluate(observationsWith(), identified, contract);
  assert.equal(buildResult({ contract, evaluation: issuing }).aos_composite.issued, true, "the fixture must issue before the identity withholds it");
  const capped = buildResult({ contract, evaluation: issuing, model_identity: unknown });
  assert.equal(capped.aos_composite.issued, false);
  assert.equal(capped.aos_composite.value, null);
  assert.match(capped.aos_composite.withheld_reason, /MODEL_UNKNOWN/u);
  // A record that contradicts itself is read by its agents, not by its summary: a forged
  // `profile_bound_aggregation: issued` over agents that each withhold buys nothing (#561 r10).
  const forgedSummary = {
    ...unknown,
    profile_bound_aggregation: { status: "issued", reason: null, detail: null },
    claim_stage: "PROFILE_BOUND"
  };
  const refused = buildResult({ contract, evaluation: issuing, model_identity: forgedSummary });
  assert.equal(refused.claim_stage, "RUN_DIAGNOSTIC");
  assert.equal(refused.aos_composite.issued, false);
  // A record explicitly absent is in the same position: nothing established what produced it.
  const absent = buildResult({ evaluation, observations: allPassObservations(), run: runBlock(), model_identity: null });
  assert.equal(absent.claim_stage, "RUN_DIAGNOSTIC");
  assert.equal(absent.aos_composite.issued, false);
  // And the cap is the identity's: the same evaluation with a record that issues keeps the stage
  // the contract gave it, so this is a condition on the claim rather than a blanket refusal.
  const named = modelIdentityRecord({
    by_agent: { main: { provenance: resolveModelProvenance({ declared: declared(EXACT_A) }), verification: null, runtime_identity_digest: identity().identity_digest, runtime_identity_status: "VERIFIED" } },
    profile_digest: "d".repeat(64)
  });
  assert.equal(evaluation.claim_stage, "PROFILE_BOUND", "the fixture must reach the stage the identity then caps");
  assert.equal(buildResult({ evaluation, observations: allPassObservations(), run: runBlock(), model_identity: named }).claim_stage, "PROFILE_BOUND");
});

test("a caller's identity record cannot carry a path or a credential into a published result", () => {
  // The record was boxed as this module's own text so its digests would survive the gate -- which
  // handed a caller a door into the published artefact that nothing inspected (#561 round 9). The
  // record is this module's shape or it is not published: the fields are known, and every string
  // in them goes through the same gate as every other string on the result.
  const forged = {
    schema_id: "aos-model-identity.v1",
    profile_digest: `sha256:${"d".repeat(64)}`,
    by_agent: {},
    lines: ["/Users/alice/private/credential.txt", `sk-live-${"a".repeat(24)}`],
    claim_stage: "RUN_DIAGNOSTIC",
    run_diagnostic_permitted: true,
    profile_bound_aggregation: { status: "withheld", reason: "MODEL_UNKNOWN", detail: "/Users/alice/private" },
    composite: "WITHHELD",
    arbitrary: { credential: `sk-live-${"b".repeat(24)}` }
  };
  const result = buildResult({ evaluation: allPassEvaluation(), observations: allPassObservations(), run: runBlock(), model_identity: forged });
  const published = JSON.stringify(result);
  assert.equal(published.includes("/Users/alice"), false, "an absolute path reached the published result");
  assert.equal(published.includes("sk-live-"), false, "a credential reached the published result");
  assert.equal(Object.hasOwn(result.model_identity, "arbitrary"), false, "an unknown field was published verbatim");
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
    // Through a launcher inside this directory, so the executable half of the profile verifies on
    // any machine: registering the ambient Node binds whatever identity #554 gives it, and on a
    // host where that binary sits in a group-writable directory the aggregate is withheld -- which
    // is the intended posture, and not what this test is about.
    // Registered under the Codex adapter, because corroboration is evidence from the runtime that
    // was configured: an adapter that declares no transcript shape can never be corroborated, and
    // the fixture stands in for a runtime that writes one (#561 round 3).
    addAgent(cwd, "exact", undefined, ["--model-id", EXACT_A, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
    const plan = makePlan(cwd, { default: "exact" });
    const printed = spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]], {
      cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
      // The fixture runtime writes a Codex-shaped transcript naming this model, which is what a
      // real runtime does and what the binding needs before it may be called profile-bound.
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: "needs-instruction", FAKE_AGENT_MODEL: EXACT_A }
    });
    const result = newestResult(cwd);
    const record = result.model_identity;
    assert.equal(record.by_agent.exact.provenance.id, EXACT_A);
    // The runtime's own event outranks the declaration once it is in hand, and the digest the
    // cycle locked does not move for it: the stored record says the run was detected, at HIGH
    // confidence, against the transcript row's own digest.
    assert.equal(record.by_agent.exact.provenance.source, "runtime-event");
    assert.equal(record.by_agent.exact.provenance.confidence, "HIGH");
    assert.equal(record.by_agent.exact.verification.status, "CONFIRMED");
    assert.equal(record.by_agent.exact.provenance.evidence.row_digest, record.by_agent.exact.verification.observed[0].row_digest);
    assert.match(record.by_agent.exact.verification.observed[0].row_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(record.lines[0].includes("detected"), true, record.lines[0]);
    // The digest the profile was built with is the digest the result carries: upgrading the
    // provenance after the run must not silently re-cohort it.
    assert.equal(record.profile_digest, result.profile_digest);
    assert.equal(record.profile_bound_aggregation.status, "issued");
    assert.equal(record.claim_stage, "PROFILE_BOUND");
    assert.equal(record.generalizability_status, "UNESTABLISHED");
    assert.equal(record.cross_model_comparison, "WITHHELD");
    assert.equal(record.profile_digest, result.profile_digest);
    for (const line of record.lines) assert.equal(printed.stdout.includes(line), true, `CLI lacks: ${line}`);
    const markdown = readFileSync(join(cwd, ".aos", "runs", result.run_id ?? result.run.run_id, "report.md"), "utf8");
    for (const line of record.lines) assert.equal(markdown.includes(`- ${line}`), true, `Markdown lacks: ${line}`);
    const html = readFileSync(join(cwd, ".aos", "runs", result.run_id ?? result.run.run_id, "report.html"), "utf8");
    for (const line of record.lines) assert.equal(html.includes(`<li>${htmlEscape(line)}</li>`), true, `HTML lacks: ${line}`);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the agent that actually ran is the agent the identity record names", () => {
  // A checkpoint reroute changes who does the work. The used-agent set was built from the plan's
  // routes alone, so the identity record named the planned agent and the rerouted one's model was
  // never looked at: B's artifacts earned a record saying A, with A's exact model and an issued
  // aggregate. That defeats the mismatch and cohort protection this whole issue is for.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-reroute-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "primary", undefined, ["--model-id", EXACT_A], verifiedRunner(cwd));
    // The stand-in nobody declared a model for: what the operator reroutes to in a hurry.
    addAgent(cwd, "spare", undefined, [], verifiedRunner(cwd));
    const plan = makePlan(cwd, { default: "primary" });
    // Per checkpoint: no to "show the evidence", yes to "send it to another agent", then the agent
    // to send it to. `aos init` registers two default agents, so the menu asks which one.
    const reroute = Array.from({ length: 12 }, () => "\ny\nspare\n").join("");
    spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]], {
      cwd, encoding: "utf8", input: reroute, timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_MODEL: EXACT_A }
    });
    const result = newestResult(cwd);
    // The plan named one agent; the reroute put a second one to work. Both ran, so both are in the
    // executed set and both are in the record -- an identity built from the plan alone would list
    // only the first, and the number would be filed under a model the other one never used.
    const working = JSON.parse(readFileSync(join(cwd, ".aos", "runs", result.run.run_id, "record.json"), "utf8"));
    assert.deepEqual(working.agent_portfolio.planned, ["primary"], "the agent the plan named");
    assert.equal(working.agent_portfolio.executed.includes("spare"), true, "the agent the operator rerouted to");
    assert.deepEqual(Object.keys(result.model_identity.by_agent).sort(), working.agent_portfolio.executed);
    // And the rerouted agent's own model decides what may be claimed: nobody declared one for it,
    // so the aggregate is withheld rather than issued under the planned agent's exact model.
    assert.equal(result.model_identity.profile_bound_aggregation.reason, "MODEL_UNKNOWN");
    assert.equal(result.model_identity.claim_stage, "RUN_DIAGNOSTIC");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an observation whose agent cannot be run leaves no Run without a record", () => {
  // Runtime identity drift throws out of the invocation, and the Run had already been created --
  // so replacing an agent's executable and running `aos observe` left a manifest with no result
  // and no provenance record, the one shape "every Run carries a record" cannot survive (#561
  // round 8).
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-observe-fail-"));
  try {
    run(cwd, ["init"]);
    const launcher = verifiedRunner(cwd);
    // A credential at stake, so #554 re-verifies the executable before the spawn and refuses when
    // it has moved -- the throw the reviewer reproduced, from inside the invocation.
    addAgent(cwd, "exact", undefined, [
      "--model-id", EXACT_A, "--adapter", "codex-cli.v1", "--allow-runtime-auth", "OPENAI_API_KEY"
    ], launcher);
    writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@" # replaced\n`, { mode: 0o755 });
    const failed = spawnSync(process.execPath, [cli, "observe", "--agent", "exact", "--task", "look", "--json"], {
      cwd, encoding: "utf8", timeout: 300000, env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.notEqual(failed.status, 0);
    for (const runId of readdirSync(join(cwd, ".aos", "runs"))) {
      const paths = join(cwd, ".aos", "runs", runId);
      assert.equal(existsSync(join(paths, "result.json")), true, `${runId}: a Run with no result`);
      const stored = JSON.parse(readFileSync(join(paths, "result.json"), "utf8"));
      assert.equal(stored.model_identity.schema_id, "aos-model-identity.v1", runId);
      assert.equal(stored.model_identity.by_agent.exact.provenance.id, EXACT_A, runId);
      assert.equal(stored.claim_stage, "RUN_DIAGNOSTIC", runId);
      // The refusal names the file it refused, and this artefact is one an operator publishes:
      // what it keeps is the code and the redacted remainder, never the path (#561 round 10).
      const published = readFileSync(join(paths, "result.json"), "utf8");
      assert.equal(/\/(Users|home|private|var)\//u.test(published), false, `${runId}: an absolute path reached a stored result`);
      assert.match(stored.error, /AOS_RUNTIME_IDENTITY/u, runId);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an observation run carries the same provenance record as a scored one", () => {
  // `aos observe` creates and persists a Run. The issue says every Run has model and runtime
  // provenance; this one carried the raw process record and no resolved identity at all, so the
  // one command an operator points at their real project produced the artefact with the least to
  // say about what produced it.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-observe-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "exact", undefined, ["--model-id", EXACT_A, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
    const printed = spawnSync(process.execPath, [cli, "observe", "--agent", "exact", "--task", "look at this project", "--json"], {
      cwd, encoding: "utf8", timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_MODEL: EXACT_A }
    });
    const diagnostic = JSON.parse(printed.stdout);
    const record = diagnostic.model_identity;
    assert.equal(record.schema_id, "aos-model-identity.v1");
    assert.equal(record.by_agent.exact.provenance.id, EXACT_A);
    assert.equal(record.by_agent.exact.provenance.alias_class, "exact-snapshot");
    // The `sha256:` spelling a published record uses, which is the one the ledger's own digests
    // are normalised to.
    assert.match(record.profile_digest, /^sha256:[0-9a-f]{64}$/u);
    // A diagnostic never issues a profile-bound aggregate whatever the model is -- it is one run
    // against the operator's own project, not a measurement -- and it still says which model.
    assert.equal(record.claim_stage, "RUN_DIAGNOSTIC");
    assert.equal(diagnostic.claim_stage, "RUN_DIAGNOSTIC");
    for (const line of record.lines) assert.equal(printed.stdout.includes(line.slice(0, 24)), true, line);

    // The same record a scored run builds, field for field, for the same agent under the same
    // conditions. The test was named for this comparison and never made it.
    const plan = makePlan(cwd, { default: "exact" });
    spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]], {
      cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: "needs-instruction", FAKE_AGENT_MODEL: EXACT_A }
    });
    const scored = newestResult(cwd).model_identity.by_agent.exact;
    const observed = record.by_agent.exact;
    assert.equal(observed.provenance.id, scored.provenance.id);
    assert.equal(observed.provenance.source, scored.provenance.source);
    assert.equal(observed.provenance.evidence_digest, scored.provenance.evidence_digest);
    assert.equal(observed.runtime_identity_digest, scored.runtime_identity_digest);
    assert.equal(observed.runtime_identity_status, scored.runtime_identity_status);
    assert.equal(observed.verification.status, scored.verification.status);
    // What differs is the claim, and only because of what an observation is.
    assert.equal(scored.claim_stage, "PROFILE_BOUND");
    assert.equal(observed.claim_stage, "RUN_DIAGNOSTIC");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a credential typed as a model id is refused at registration, never stored and never echoed", () => {
  // `--model-id` was the one string on the registration line nothing secret-checked. The parser
  // refused it as a model, so it became UNKNOWN -- and the raw value was written into the agent
  // record and printed back by `agent add --json` and `agent list --json`. A value this product
  // will not print is a value it must not accept.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-secret-"));
  try {
    run(cwd, ["init"]);
    // Two shapes: one the redactor knows, and one it does not. The second is the point -- the
    // registration channel used to store and echo anything the model parser could not read, so a
    // vendor prefix nobody taught this product was a credential channel (#561 round 9).
    const prefixed = (prefix, body) => `${prefix}_${body}`;
    for (const value of [prefixed("hf", `${"abcdefghijklmnopqrstuvwxyz"}0123456`), prefixed("nvapi", "9f8e7d6c5b4a39281706abcdefabcdef")]) {
      const declined = spawnSync(process.execPath, [cli, "agent", "add", "unreadable", "--command", process.execPath, "--model-id", value, "--json"], {
        cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
      });
      assert.notEqual(declined.status, 0, value);
      assert.equal(`${declined.stdout}${declined.stderr}`.includes(value), false, `${value} was echoed back`);
      assert.equal(readFileSync(join(cwd, ".aos", "agents.json"), "utf8").includes(value), false, `${value} reached the store`);
    }
    const secret = "sk-supersecretcredential1234567890";
    const refused = spawnSync(process.execPath, [cli, "agent", "add", "leaky", "--command", process.execPath, "--model-id", secret, "--json"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /AOS_SECRET_IN_AGENT_CONFIG/u);
    assert.equal(refused.stdout.includes(secret), false, "the value came back on stdout");
    assert.equal(refused.stderr.includes(secret), false, "the value came back on stderr");
    const listed = run(cwd, ["agent", "list", "--json"]).stdout;
    assert.equal(listed.includes(secret), false, "the value reached the agent store");
    assert.equal(listed.includes("leaky"), false, "the agent was registered anyway");
    const stored = readFileSync(join(cwd, ".aos", "agents.json"), "utf8");
    assert.equal(stored.includes(secret), false, "the value was written to disk");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the executable a run records is the one it spawned, not the one it was registered with", () => {
  // #554 verifies the executable before a credential is handed over, and an agent with no
  // credential at stake skips that -- correctly, since it is a policy about credentials. The
  // identity a Run reports is a different question: it says which program produced this number.
  // It was read off the registration, so replacing the binary between `agent add` and the run left
  // the result claiming a VERIFIED identity for a file that no longer existed (#561 round 5).
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-swap-"));
  try {
    run(cwd, ["init"]);
    const launcher = verifiedRunner(cwd);
    addAgent(cwd, "exact", undefined, ["--model-id", EXACT_A, "--adapter", "codex-cli.v1", "--no-auto-auth"], launcher);
    const before = JSON.parse(spawnSync(process.execPath, [cli, "observe", "--agent", "exact", "--task", "look", "--json"], {
      cwd, encoding: "utf8", timeout: 300000, env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    }).stdout);
    const registered = JSON.parse(run(cwd, ["agent", "list", "--json"]).stdout).find((entry) => entry.id === "exact");
    assert.equal(before.model_identity.by_agent.exact.runtime_identity_digest, registered.runtime_identity.identity_digest);
    assert.equal(before.model_identity.by_agent.exact.runtime_identity_status, "VERIFIED");

    // The same path, a different program. Nothing re-registers it.
    writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@" # rebuilt\n`, { mode: 0o755 });
    const after = JSON.parse(spawnSync(process.execPath, [cli, "observe", "--agent", "exact", "--task", "look", "--json"], {
      cwd, encoding: "utf8", timeout: 300000, env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    }).stdout);
    const applied = after.model_identity.by_agent.exact.runtime_identity_digest;
    assert.match(applied, /^sha256:[0-9a-f]{64}$/u);
    assert.notEqual(applied, registered.runtime_identity.identity_digest, "the run reported the executable it no longer runs");
    // And the drift is named rather than left for a reader to notice by comparing digests.
    assert.equal(after.model_identity.by_agent.exact.runtime_identity_drifted, true);
    assert.equal(before.model_identity.by_agent.exact.runtime_identity_drifted, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the cohort key describes what was applied: the policy, the executable and the model", () => {
  // Three inputs the digest is supposed to bind, all of which are only known after the spawn: the
  // environment policy as applied (automatic credential resolution can add a name the declared
  // policy never had), the executable actually run, and the provenance the transcript resolved.
  // The pre-run digest knew none of them, and the cohort key was the pre-run one (#561 round 5).
  const base = build({ agent: agent({ adapter: "codex-cli.v1" }) });
  // Through the one function that builds the profile a run was actually made under, because that
  // is what the run digests: a caller that knows the applied policy and the executable that ran
  // must be able to put both into the key, and a caller that knows neither gets the profile back.
  assert.equal(profileDigestOf(appliedProfile(base)), base.profile_digest);
  assert.notEqual(
    profileDigestOf(appliedProfile(base, { envPolicyDigest: `sha256:${"c".repeat(64)}` })),
    base.profile_digest,
    "the applied environment policy"
  );
  assert.notEqual(
    profileDigestOf(appliedProfile(base, { runtimeIdentity: { identity_digest: `sha256:${"e".repeat(64)}`, identity_status: "VERIFIED" } })),
    base.profile_digest,
    "the executable that ran"
  );
  assert.notEqual(
    profileDigestOf(appliedProfile(base, { provenance: resolveModelProvenance({ runtimeEvent: confirming(EXACT_A), declared: declared(EXACT_A) }) })),
    base.profile_digest,
    "the provenance the run resolved"
  );
  // And the run's own digest is taken over the applied values, not the registration's: two runs of
  // one agent that differ in what the child could see are two measurements.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-applied-"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "exact", undefined, ["--model-id", EXACT_A, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
    const observeWith = (env) => JSON.parse(spawnSync(process.execPath, [cli, "observe", "--agent", "exact", "--task", "look", "--json"], {
      cwd, encoding: "utf8", timeout: 300000, env: { ...process.env, AOS_HOME: join(cwd, ".aos"), ...env }
    }).stdout);
    const confirmed = observeWith({ FAKE_AGENT_MODEL: EXACT_A });
    const silent = observeWith({});
    // The record's own digest and the profile digest the run stored agree -- the record is not
    // describing one profile while the ledger files it under another.
    assert.equal(confirmed.model_identity.profile_digest, `sha256:${confirmed.profile_digest}`);
    assert.equal(silent.model_identity.profile_digest, `sha256:${silent.profile_digest}`);
    // The record keeps the issue's source precedence: the runtime's own statement outranks the
    // declaration and is what the run says it used.
    assert.equal(confirmed.model_identity.by_agent.exact.provenance.source, "runtime-event");
    assert.equal(silent.model_identity.by_agent.exact.provenance.source, "declared");
    // And the cohort key does not move with it, because the transcript is the assessed child's to
    // write: what the key is taken over is the binding the operator made, recorded beside the
    // resolved provenance so both are readable (#561 round 6).
    assert.equal(confirmed.model_identity.by_agent.exact.cohort_provenance.source, "declared");
    assert.equal(confirmed.profile_digest, silent.profile_digest, "a transcript row moved the cohort key");
    assert.equal(confirmed.model_identity.by_agent.exact.runtime_identity_digest, confirmed.process.applied_runtime_identity.identity_digest);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a configured agent that never ran does not move the cohort out from under the run", () => {
  // The cycle resolved expected provenance for every configured agent while the assessment
  // resolved it only for the ones that ran, so a second configured agent -- registered and never
  // used -- put the run's digest somewhere the cycle was not, and the run was excluded as
  // PROFILE_CHANGED. Both sides resolve the same set.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-unused-"));
  try {
    run(cwd, ["init"]);
    const launcher = verifiedRunner(cwd);
    addAgent(cwd, "worker", undefined, ["--model-id", EXACT_A, "--adapter", "codex-cli.v1"], launcher);
    addAgent(cwd, "spare", undefined, ["--model-id", EXACT_B, "--adapter", "codex-cli.v1"], launcher);
    const plan = makePlan(cwd, { default: "worker" });
    run(cwd, ["cycle", "start", "--seed", SEEDS[0], "--seed", SEEDS[1], "--seed", SEEDS[2]]);
    const cycle = JSON.parse(readFileSync(join(cwd, ".aos", "cycle.json"), "utf8"));
    const assessed = spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]], {
      cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos"), FAKE_AGENT_PROFILE: "needs-instruction", FAKE_AGENT_MODEL: EXACT_A }
    });
    assert.equal(assessed.status !== null, true);
    const result = newestResult(cwd);
    assert.equal(result.profile_digest, `sha256:${cycle.profile_digest}`, "the run landed outside the cohort its own cycle locked");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an import with nothing in it creates no Run at all", () => {
  // The Run was created before the input was read, so an empty pipe left a manifest with no
  // provenance record and no result -- the one shape "every Run carries a record" cannot survive.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-empty-import-"));
  try {
    run(cwd, ["init"]);
    const empty = join(cwd, "empty.jsonl");
    writeFileSync(empty, "");
    const importing = (file) => spawnSync(process.execPath, [cli, "import", "--producer", "other-tool", "--file", file], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    const runs = join(cwd, ".aos", "runs");
    const refused = importing(empty);
    assert.notEqual(refused.status, 0);
    assert.match(`${refused.stdout}${refused.stderr}`, /AOS_EVENT_SOURCE_EMPTY/u);

    // Every event, not only the empty case: a file whose rows are not events, and a file that is
    // not JSON at all, both used to create the Run and then throw.
    const invalid = join(cwd, "invalid.jsonl");
    writeFileSync(invalid, `${JSON.stringify({})}\n`);
    assert.notEqual(importing(invalid).status, 0);
    const malformed = join(cwd, "malformed.jsonl");
    writeFileSync(malformed, "{not json\n");
    assert.notEqual(importing(malformed).status, 0);

    assert.deepEqual(existsSync(runs) ? readdirSync(runs) : [], [], "a Run was created for an import that never happened");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an imported run is a Run, so it carries a provenance record and a result on disk", () => {
  // `aos import` and `aos bridge` create a Run and used to leave it with a manifest, some events
  // and nothing else: no provenance, no runtime identity, no result written at all. "Every Run"
  // includes the ones whose evidence came from somewhere else -- what such a Run has to say is
  // that nobody here observed a model, which is a statement, not a blank.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-import-"));
  try {
    run(cwd, ["init"]);
    const events = join(cwd, "events.jsonl");
    writeFileSync(events, `${JSON.stringify({ event_type: "note.recorded", payload: { text: "from elsewhere" } })}\n`);
    const imported = run(cwd, ["import", "--producer", "other-tool", "--file", events, "--json"]).stdout;
    const parsed = JSON.parse(imported);
    assert.equal(parsed.status, "DIAGNOSTIC_ONLY");
    assert.equal(parsed.model_identity.claim_stage, "RUN_DIAGNOSTIC");
    assert.equal(parsed.model_identity.profile_bound_aggregation.reason, "DIAGNOSTIC_RUN");
    // Named, not empty. An empty map produced lines that mentioned neither a model nor an
    // executable, which reads as a Run with nothing to say rather than one saying that nothing
    // here observed either.
    assert.deepEqual(Object.keys(parsed.model_identity.by_agent), ["other-tool"]);
    assert.equal(parsed.model_identity.by_agent["other-tool"].provenance.status, "UNKNOWN");
    assert.equal(parsed.model_identity.lines[0], "Model (other-tool): unknown");
    assert.equal(parsed.model_identity.lines[1], "Runtime executable identity (other-tool): unverified (MIGRATION_REQUIRED)");
    // Persisted, not only printed: the artefact on disk is what a reader comes back to.
    const stored = JSON.parse(readFileSync(join(cwd, ".aos", "runs", parsed.run_id, "result.json"), "utf8"));
    assert.equal(stored.model_identity.schema_id, "aos-model-identity.v1");
    assert.deepEqual(stored.model_identity.lines, parsed.model_identity.lines);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a run that failed still says which model and which executable it was going to be", () => {
  // The error path committed a terminal and no result, so a Run that broke had nothing on disk
  // saying what it had been bound to -- exactly the Run whose conditions a reader most wants.
  const cwd = mkdtempSync(join(tmpdir(), "aos-model-failed-"));
  try {
    run(cwd, ["init"]);
    // An agent that fails instantly with nothing on stdout: AOS stops the run rather than scoring
    // a configuration that never started, which is the error path this is about.
    const silent = join(cwd, "silent-agent.mjs");
    writeFileSync(silent, "process.exit(1)\n");
    addAgent(cwd, "exact", silent, ["--model-id", EXACT_A, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
    const plan = makePlan(cwd, { default: "exact" });
    const failed = spawnSync(process.execPath, [cli, "assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]], {
      cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
      env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.notEqual(failed.status, 0);
    assert.match(`${failed.stdout}${failed.stderr}`, /AOS_AGENT_DID_NOT_RUN/u);
    const result = newestResult(cwd);
    assert.equal(result.schema_id, "aos-incomplete-result.v1");
    assert.equal(result.status, "INTERNAL_ERROR");
    assert.equal(result.model_identity.by_agent.exact.provenance.id, EXACT_A);
    assert.match(result.model_identity.by_agent.exact.runtime_identity_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(result.model_identity.claim_stage, "RUN_DIAGNOSTIC");
    // And the terminal names the result that was written. It carried a null digest beside a
    // persisted result, so recovery read this Run as invalid -- the provenance it does carry was
    // unreadable through the front door (#561 round 7).
    const recovered = spawnSync(process.execPath, [cli, "session", "recover", result.run_id ?? result.run.run_id, "--json"], {
      cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") }
    });
    assert.equal(`${recovered.stdout}${recovered.stderr}`.includes("terminal/result digest mismatch"), false, recovered.stdout);
    assert.notEqual(JSON.parse(recovered.stdout).action, "INVALID");
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
      // Run diagnostics are still produced: the run has profiles of its own (#559 removed the
      // single score, so what says the run happened is the profile it printed).
      assert.match(output, /Operator process:/u);
    }
    const report = spawnSync(process.execPath, [cli, "cycle", "--json"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") } });
    const summary = JSON.parse(report.stdout);
    // #559 gave a cycle of profile results no aggregate at all -- #563 owns defining one -- so what
    // this cycle prints is that withholding, and what #561 owns is the binding it was opened with:
    // three runs of a model nobody named, recorded, and no number anywhere.
    assert.equal(summary.aggregate, null);
    assert.match(summary.withheld_reason, /AOS_CYCLE_AGGREGATION_UNDEFINED/u);
    assert.match(summary.withheld_reason, /#563/u);
    assert.equal(summary.runs.length, 3);
    assert.equal(Object.hasOwn(summary, "operator_score"), false);
    assert.equal(JSON.parse(readFileSync(join(cwd, ".aos", "cycle.json"), "utf8")).model_identity.profile_bound_aggregation.reason, "MODEL_UNKNOWN");
    assert.notEqual(report.status, 0);
    const text = spawnSync(process.execPath, [cli, "cycle"], { cwd, encoding: "utf8", env: { ...process.env, AOS_HOME: join(cwd, ".aos") } });
    // #559: a cycle of profile results has no aggregate to withhold by a model's name, so what the
    // command prints is the aggregation question and whose it is. #561's answer for this cycle --
    // the model nobody named -- is in the binding the cycle was opened with, asserted above.
    assert.match(text.stdout, /AOS_CYCLE_AGGREGATION_UNDEFINED/u);
    assert.equal(text.stdout.includes("Operator Score"), false);
    assert.equal(/\b\d+ \/ 100\b/u.test(text.stdout), false);
    // And it says which model, by name, rather than printing the profile-bound sentence over a
    // cycle nobody could name one for (#561 round 10).
    assert.match(text.stdout, /Model \(solo\): unknown/u);
    assert.match(text.stdout, /MODEL_UNKNOWN/u);
    assert.equal(text.stdout.includes("PROFILE-BOUND:"), false);
    assert.match(text.stdout, /RUN-DIAGNOSTIC:/u);
    assert.equal(JSON.parse(report.stdout).model_identity.profile_bound_aggregation.reason, "MODEL_UNKNOWN");
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
