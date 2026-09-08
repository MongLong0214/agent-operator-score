import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  EQUIVALENCE_STATUSES,
  EXPOSURE_POLICIES,
  FORM_BANK_RECORD_SCHEMA_ID,
  FORM_CLASS_REGISTRY,
  FORM_CLASSES,
  FORM_LINKING_SCHEMA_ID,
  LINKING_METHOD_INTERFACE,
  formBankRecord
} from "../../lib/form-class.mjs";
import { formManifest } from "../../lib/suite.mjs";

test("form class identities and definitions come from the declaring task model", () => {
  const model = JSON.parse(readFileSync(new URL("../../contracts/aos-task-model.v2.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.values(FORM_CLASS_REGISTRY).map(({ class_id, definition }) => ({ class_id, definition })), model.form_classes);
  assert.deepEqual([...FORM_CLASSES], model.form_classes.map((entry) => entry.class_id));
});

test("invariance facets come from the interpretation use contract", async () => {
  const { INVARIANCE_FACETS } = await import("../../lib/form-class.mjs");
  const contract = JSON.parse(readFileSync(new URL("../../contracts/aos-interpretation-use-argument.v1.json", import.meta.url), "utf8"));
  assert.deepEqual([...INVARIANCE_FACETS], contract.comparability_rules.find((rule) => rule.rule_id === "invariance-required").facets);
});

// #585 (this round). Five review rounds hardened a predicate here (`isRealLinkingScaffold`, once a
// named function in `lib/form-class.mjs`) by requiring one more field each round, and each next
// round's forgery satisfied it -- this fixture, `wellFormedLinkingClaim`, is that final-round
// forgery: a registered method and version, a method interface quoting that exact registered
// contract, an anchor set meeting its declared floor, a drift record consistent with LINKED, and
// the digests the evidence is supposed to rest on. It still reached LINKED, because every one of
// those fields is exactly as caller-supplied as the single field the first round checked. The
// predicate is gone now -- `formBankRecord` and `scoreChangeClaim` do not ask a `linking` object
// anything before deciding whether to trust it -- and this fixture is kept only to prove the
// closure holds against the strongest artifact these tests can construct.
const wellFormedLinkingClaim = (overrides = {}) => ({
  schema_id: FORM_LINKING_SCHEMA_ID,
  equivalence_decision: true,
  inputs_missing: [],
  equivalence_status: "LINKED",
  left_form_id: "FAM-1.form-2b",
  right_form_id: "FAM-1.form-3c",
  left_form_contract_digest: `sha256:${"c".repeat(64)}`,
  right_form_contract_digest: `sha256:${"d".repeat(64)}`,
  task_model_digest: `sha256:${"9".repeat(64)}`,
  exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
  linking_method: { method: "anchored-delta.v1", method_version: "1.0.0" },
  method_interface: LINKING_METHOD_INTERFACE,
  anchor_ids: ["C1.GF.01", "C1.GF.02", "C1.GF.03"],
  drift: { thresholds: { maximum_anchor_delta: 0.1 }, status: "WITHIN_THRESHOLDS", maximum_observed_delta: 0.02 },
  ...overrides
});

// ---------------------------------------------------------------------------------------------
// Form classes and the machine-readable registry (#585)
//
// The four classes are the specification's, by name. The registry is what makes them
// machine-readable: a consumer that wants to know whether a WARMUP administration may reach an
// official cycle reads the registry field, not a comment.

test("form class registry declares the four classes with their scoring and exposure policy", () => {
  assert.deepEqual([...FORM_CLASSES], ["WARMUP", "PRACTICE", "OPERATIONAL", "TRANSFER"]);
  assert.deepEqual(Object.keys(FORM_CLASS_REGISTRY).sort(), [...FORM_CLASSES].sort());
  for (const classId of FORM_CLASSES) {
    const entry = FORM_CLASS_REGISTRY[classId];
    assert.equal(entry.class_id, classId);
    assert.equal(typeof entry.scored, "boolean");
    assert.equal(typeof entry.official_cycle_eligible, "boolean");
    assert.equal(typeof entry.repeatable, "boolean");
    assert.equal(EXPOSURE_POLICIES.includes(entry.exposure_policy), true, `${classId} names an unknown exposure policy`);
  }
  // The specification's own table: warmup and practice are never scored, an operational form is
  // scored once, transfer is research-lane only.
  assert.equal(FORM_CLASS_REGISTRY.WARMUP.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.PRACTICE.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.official_cycle_eligible, true);
  assert.equal(FORM_CLASS_REGISTRY.TRANSFER.official_cycle_eligible, false);
  assert.equal(FORM_CLASS_REGISTRY.WARMUP.exposure_policy, "unscored-repeatable");
  assert.equal(FORM_CLASS_REGISTRY.PRACTICE.exposure_policy, "unscored-repeatable");
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.exposure_policy, "scored-once");
  assert.equal(FORM_CLASS_REGISTRY.TRANSFER.exposure_policy, "research-only");
  assert.equal(FORM_CLASS_REGISTRY.OPERATIONAL.repeatable, false);
  assert.equal(Object.isFrozen(FORM_CLASS_REGISTRY), true);
  assert.equal(Object.isFrozen(FORM_CLASS_REGISTRY.OPERATIONAL), true);
});

test("a form bank record derives its policy from its class and refuses a contradiction", () => {
  const record = formBankRecord({
    form_id: "FAM-3.form-2a",
    form_class: "OPERATIONAL",
    construct_opportunity_ids: ["C3.RD.01"],
    language: "ko",
    interface: "agent-relay",
    model_profile_class: "cli-agent",
    oracle_digest: `sha256:${"a".repeat(64)}`
  });
  assert.equal(record.schema_id, FORM_BANK_RECORD_SCHEMA_ID);
  assert.equal(record.exposure_policy, "scored-once");
  assert.equal(record.equivalence_status, "UNESTABLISHED");
  assert.equal(Object.isFrozen(record), true);
  // A record that declares a policy its class contradicts is refused rather than trusted: the
  // registry, not the stored artifact, owns the policy. A stored artifact that authorizes itself
  // is this repository's second-oldest defect class.
  assert.throws(() => formBankRecord({
    form_id: "FAM-3.form-2a",
    form_class: "WARMUP",
    construct_opportunity_ids: [],
    oracle_digest: `sha256:${"a".repeat(64)}`,
    exposure_policy: "scored-once"
  }), /AOS_FORM_POLICY_CONTRADICTION/);
  assert.throws(() => formBankRecord({ form_id: "x", form_class: "EXAM", construct_opportunity_ids: [], oracle_digest: `sha256:${"a".repeat(64)}` }), /AOS_FORM_CLASS_UNKNOWN/);
  assert.throws(() => formBankRecord({ form_id: "x", form_class: "OPERATIONAL", construct_opportunity_ids: [], oracle_digest: "not-a-digest" }), /AOS_FORM_ORACLE_DIGEST/);
});

test("a form bank record cannot declare itself linked; equivalence stays unestablished without linking evidence", () => {
  // `equivalence_status` is derived, never accepted from the caller: a bank record that could say
  // LINKED about itself would be a stored artifact authorizing its own strongest claim.
  const record = formBankRecord({
    form_id: "FAM-1.form-2b",
    form_class: "OPERATIONAL",
    construct_opportunity_ids: ["C1.GF.01"],
    oracle_digest: `sha256:${"b".repeat(64)}`,
    equivalence_status: "LINKED"
  });
  assert.equal(record.equivalence_status, "UNESTABLISHED");
  assert.equal(EQUIVALENCE_STATUSES.includes(record.equivalence_status), true);
});

test("formLifecycleState is closed too: a caller's equivalence and drift claims are recorded, never issued", async () => {
  // 여섯 번째 게이트. 다섯 개를 닫은 라운드가 이 함수를 빠뜨렸고, 리뷰가 실행으로 잡았다:
  // 손으로 쓴 `{equivalence_status:"LINKED", drift:{status:"WITHIN_THRESHOLD"}}` 가 그대로
  // 권위 있는 값으로 나왔다. `linkForms` 가 더 이상 LINKED 를 못 내보내므로 여기서 그 값의 유일한
  // 생산자는 위조뿐이었다. `drift_status` 는 enum 검사조차 없어 아무 문자열이나 통과했다.
  const { formLifecycleState, createExposureLedger } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"ab".repeat(32)}`;
  const state = formLifecycleState(createExposureLedger(), {
    form_contract_digest: digest,
    linking: { equivalence_status: "LINKED", drift: { status: "WITHIN_THRESHOLD" } }
  });
  assert.equal(state.equivalence_status, "UNESTABLISHED", "a caller-supplied equivalence status was issued as authoritative");
  assert.equal(state.drift_status, "NOT_MONITORED", "a caller-supplied drift status was issued as authoritative");
  // 주장 자체는 사라지지 않는다 -- 인증되지 않았다고 이름 붙여 기록한다.
  assert.equal(state.unauthenticated_claim.claimed_equivalence_status, "LINKED");
  assert.equal(state.unauthenticated_claim.claimed_drift_status, "WITHIN_THRESHOLD");
  assert.match(state.unauthenticated_claim.reason, /AOS_LINKING_UNAUTHENTICATED/u);
  // 아무 문자열이나 넣어도 마찬가지다: enum 검사가 없던 자리가 닫혔는지 본다.
  const forged = formLifecycleState(createExposureLedger(), {
    form_contract_digest: digest,
    linking: { drift: { status: "TOTALLY_FINE_TRUST_ME" } }
  });
  assert.equal(forged.drift_status, "NOT_MONITORED");
});

test("a form bank record's equivalence status is closed by construction: a perfect linking claim still yields UNESTABLISHED", () => {
  // #585 (this round). This test replaces three that checked individual clauses of a predicate
  // (`isRealLinkingScaffold`) that no longer exists: five review rounds hardened it one field at a
  // time, and each next round's forgery satisfied the new field. `formBankRecord` no longer asks a
  // `linking` object anything at all -- `equivalence_status` is always UNESTABLISHED, proven here
  // against the most complete linking claim these tests can construct, not merely an incomplete one
  // a leftover clause happens to still catch.
  const base = { form_id: "FAM-1.form-2b", form_class: "OPERATIONAL", construct_opportunity_ids: ["C1.GF.01"], oracle_digest: `sha256:${"b".repeat(64)}` };
  const record = formBankRecord({ ...base, linking: wellFormedLinkingClaim() });
  assert.equal(record.equivalence_status, "UNESTABLISHED", "a perfect linking claim must not authorize LINKED");
  assert.equal(EQUIVALENCE_STATUSES.includes(record.equivalence_status), true);
  assert.equal(Object.isFrozen(record), true);
  // What the caller supplied is recorded, but only ever as an explicit, named, unauthenticated
  // claim -- never folded into the derived field, never a second decision vocabulary.
  assert.equal(record.unauthenticated_claim.claimed_equivalence_status, "LINKED");
  assert.equal(record.unauthenticated_claim.claimed_schema_id, FORM_LINKING_SCHEMA_ID);
  assert.match(record.unauthenticated_claim.reason, /AOS_LINKING_UNAUTHENTICATED/);

  // The schema tag alone -- no method, no interface, no anchors, no drift, no digests -- is exactly
  // as inert, and its (much thinner) claim is recorded too.
  const bare = formBankRecord({ ...base, linking: { equivalence_status: "LINKED" } });
  assert.equal(bare.equivalence_status, "UNESTABLISHED");
  assert.equal(bare.unauthenticated_claim.claimed_equivalence_status, "LINKED");
  assert.equal(bare.unauthenticated_claim.claimed_schema_id, null);

  // No linking claim at all: nothing to record.
  const none = formBankRecord({ ...base });
  assert.equal(none.equivalence_status, "UNESTABLISHED");
  assert.equal(none.unauthenticated_claim, null);
});

test("the shipped operational form manifest speaks the form class contract's own words", () => {
  const manifest = formManifest("2a");
  assert.equal(manifest.form_class, "OPERATIONAL");
  assert.equal(manifest.exposure_policy, FORM_CLASS_REGISTRY.OPERATIONAL.exposure_policy);
  // #585's enum, not the pre-#585 word. "UNCALIBRATED" was a status no contract declared; two
  // vocabularies for one tri-state question is the representation collapse this repository has
  // produced five times.
  assert.equal(manifest.equivalence_status, "UNESTABLISHED");
  assert.equal(EQUIVALENCE_STATUSES.includes(manifest.equivalence_status), true);
  for (const family of Object.keys(manifest.family_manifests)) {
    const row = manifest.family_manifests[family];
    assert.equal(EQUIVALENCE_STATUSES.includes(row.equivalence_status), true, `${family} claims a form relation outside the #585 vocabulary`);
    assert.equal(row.equivalence_status, "UNESTABLISHED", `${family} claims a form relation this suite has no linking evidence for`);
    // #585 item 5. `familyFormManifest` derives this from the task-model contract's own
    // `scored_once_per_aos_home` field, not from a constant -- so a contract whose forms stopped
    // declaring themselves scored-once (or a reader still keyed on the old `scored_once_per_cycle`
    // name after the contract moved to `scored_once_per_aos_home`) reads `undefined` from a form
    // that no longer has that property and reports every family NOT_OBSERVED instead of scored-once.
    assert.equal(row.exposure_policy, "scored-once", `${family} does not carry the task-model contract's own scored_once_per_aos_home declaration`);
  }
});

// ---------------------------------------------------------------------------------------------
// Exposure ledger and the scored-once policy (#585)

test("the exposure ledger records sequence position, administration interval and prior exposure", async () => {
  const { createExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const digestA = `sha256:${"1".repeat(64)}`;
  const digestB = `sha256:${"2".repeat(64)}`;
  const base = createExposureLedger();
  assert.equal(base.schema_id, "aos-exposure-ledger.v2");
  assert.deepEqual(base.entries, []);
  const first = recordExposure(base, { form_id: "aos-operational-002a", form_contract_digest: digestA, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T10:00:00.000Z", scored: true });
  const second = recordExposure(first.ledger, { form_id: "aos-operational-002b", form_contract_digest: digestB, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T11:00:00.000Z", scored: true });
  const third = recordExposure(second.ledger, { form_id: "aos-operational-002a", form_contract_digest: digestA, declared_class: "OPERATIONAL", administered_class: "PRACTICE", occurred_at: "2026-09-06T12:30:00.000Z", scored: false });
  assert.deepEqual(third.ledger.entries.map((entry) => entry.sequence_position), [1, 2, 3]);
  assert.equal(first.entry.interval_ms, null, "the first administration has no interval to report, and null says so");
  assert.equal(second.entry.interval_ms, 3600000);
  assert.equal(third.entry.interval_ms, 5400000);
  assert.deepEqual(third.ledger.entries.map((entry) => entry.prior_exposure_count), [0, 0, 1]);
  assert.equal(third.entry.administered_class, "PRACTICE");
  assert.equal(Object.isFrozen(third.ledger), true);
  // The ledger it grew from is untouched: exposure history cannot be edited in place.
  assert.equal(second.ledger.entries.length, 2);
});

test("an operational form is scored once; its replay is classified practice and refused official scoring", async () => {
  const { classifyAdministration, createExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"3".repeat(64)}`;
  const ledger = createExposureLedger();
  const fresh = classifyAdministration(ledger, { form_id: "aos-operational-0031", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  assert.equal(fresh.administered_class, "OPERATIONAL");
  assert.equal(fresh.official_scoring_permitted, true);
  assert.equal(fresh.refusal_code, null);
  const { ledger: exposed } = recordExposure(ledger, { form_id: "aos-operational-0031", form_contract_digest: digest, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T10:00:00.000Z", scored: true });
  const replay = classifyAdministration(exposed, { form_id: "aos-operational-0031", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  assert.equal(replay.administered_class, "PRACTICE", "a different seed makes a different form; the same digest makes the same form, and its second run is practice");
  assert.equal(replay.official_scoring_permitted, false);
  assert.equal(replay.refusal_code, "AOS_FORM_ALREADY_EXPOSED");
  assert.equal(replay.prior_exposure_count, 1);
  assert.equal(replay.prior_scored_count, 1);
  assert.ok(replay.reasons.length > 0 && replay.reasons[0].includes("scored-once"), "the refusal names the policy it enforces");
  // Warmup and practice administrations never reach official scoring, first run or not, and an
  // unscored prior exposure still makes an operational run a replay.
  const warmup = classifyAdministration(exposed, { form_id: "warmup-1", form_contract_digest: `sha256:${"4".repeat(64)}`, declared_class: "WARMUP" });
  assert.equal(warmup.official_scoring_permitted, false);
  assert.equal(warmup.refusal_code, "AOS_FORM_CLASS_UNSCORED");
  assert.equal(warmup.administered_class, "WARMUP");
  const transfer = classifyAdministration(exposed, { form_id: "t-1", form_contract_digest: `sha256:${"5".repeat(64)}`, declared_class: "TRANSFER" });
  assert.equal(transfer.official_scoring_permitted, false);
  assert.equal(transfer.refusal_code, "AOS_FORM_CLASS_LONGITUDINAL");
});

test("a corrupt exposure ledger refuses rather than reading as empty", async () => {
  const { openExposureLedger, createExposureLedger } = await import("../../lib/form-class.mjs");
  // `undefined` is the one true absence -- no ledger file exists yet.
  assert.deepEqual(openExposureLedger(undefined), createExposureLedger());
  // A ledger that cannot be read is not an empty one: reading it as empty would grant an exposed
  // form a second official scoring, which is exactly the gate this file exists to hold. A file
  // holding the JSON literal `null` is one of these shapes, not a second spelling of absence -- it
  // silently recorded 0 runs before this test existed, which is indistinguishable from a home that
  // never administered anything even though the two are not the same claim.
  assert.throws(() => openExposureLedger(null), /AOS_EXPOSURE_LEDGER_CORRUPT/);
  assert.throws(() => openExposureLedger({ schema_id: "something-else", entries: [] }), /AOS_EXPOSURE_LEDGER_CORRUPT/);
  assert.throws(() => openExposureLedger({ schema_id: "aos-exposure-ledger.v1", entries: "not-a-list" }), /AOS_EXPOSURE_LEDGER_CORRUPT/);
  // Calendar, not Date.parse: an instant that does not exist cannot anchor an interval.
  const { recordExposure } = await import("../../lib/form-class.mjs");
  assert.throws(() => recordExposure(createExposureLedger(), {
    form_id: "f", form_contract_digest: `sha256:${"0".repeat(64)}`, declared_class: "OPERATIONAL", occurred_at: "2026-02-30T10:00:00.000Z"
  }), /AOS_EXPOSURE_OCCURRED_AT/);
});

test("a malformed entry inside an otherwise well-formed ledger is refused, not silently dropped", async () => {
  // `priorEntries` filters on `form_contract_digest`, so an entry that lost or malformed that
  // field would fall out of every such filter and read as a form that was never administered --
  // permitting a form with a corrupt prior exposure as fresh. An unreadable exposure is not the
  // absence of one, so the ledger must refuse rather than quietly read past the bad row.
  //
  // #585 round 3. The well-formed row here used to be a hand-typed object literal with no
  // `revision` or `chain_digest` field, because those fields did not exist yet. Passed through
  // `openExposureLedger` unchanged it now reads as a pre-integrity-binding ledger and is refused
  // with `AOS_EXPOSURE_LEDGER_MIGRATION_REQUIRED` before this test's own malformed-entry checks
  // ever run -- see the dedicated migration test below for that refusal in isolation. So the
  // well-formed row here is `recordExposure`'s own real output instead: it carries a real
  // `revision` and `chain_digest` the way every ledger this release ever writes does, and only the
  // ONE field each case deliberately drops is missing, isolating the malformed-entry check this
  // test exists for from the migration check a hand-typed literal would otherwise trip first.
  const { createExposureLedger, openExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"9".repeat(64)}`;
  const { ledger: base } = recordExposure(createExposureLedger(), {
    form_id: "f", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: "2026-09-06T10:00:00.000Z", scored: true
  });
  const wellFormed = base.entries[0];
  // A row with no `form_contract_digest` at all: exactly the shape that would vanish from
  // `priorEntries` and let a second administration of the digest above read as a first one.
  const { form_contract_digest: _dropped, ...missingDigest } = wellFormed;
  assert.throws(() => openExposureLedger({ ...base, entries: [missingDigest] }), /AOS_EXPOSURE_ENTRY_CORRUPT/);
  // A row with the right shape but no entry schema tag -- the same "any object naming the right
  // fields" gap this ledger already refuses at its own top level.
  const { schema_id: _tag, ...untagged } = wellFormed;
  assert.throws(() => openExposureLedger({ ...base, entries: [untagged] }), /AOS_EXPOSURE_ENTRY_CORRUPT/);
  // A row with no `chain_digest` at all -- the new field this round adds, checked the same way.
  const { chain_digest: _digest, ...unchained } = wellFormed;
  assert.throws(() => openExposureLedger({ ...base, entries: [unchained] }), /AOS_EXPOSURE_ENTRY_CORRUPT/);
  // The well-formed row alone is read without complaint.
  assert.equal(openExposureLedger(base).entries.length, 1);
});

test("a ledger written before revision/chain/head integrity binding existed fails closed rather than being read as verified", async () => {
  // #585 round 3, governing directive 20. This is the exact hand-typed v1 entry shape every
  // exposure-ledger test in this file used before this round -- a real historical shape, not a
  // fabricated one. A ledger like this predates `revision` and `head_digest` entirely, and reading
  // it as though its entries had passed a chain check they never went through would promote
  // pre-chain history to VERIFIED on the strength of a chain it never had, which is exactly what
  // directive 20 forbids. There is no explicit migration in this release (see the comment above
  // `openExposureLedger`'s migration check for why); the alternative this release picked is to fail
  // closed, named distinctly from ordinary corruption.
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"9".repeat(64)}`;
  const legacyEntry = {
    schema_id: "aos-exposure-entry.v1", form_id: "f", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administered_class: "OPERATIONAL", occasion_id: null, occurred_at: "2026-09-06T10:00:00.000Z", run_id: null,
    cycle_id: null, scored: true, score: null, duration_ms: null, sequence_position: 1, interval_ms: null,
    prior_exposure_count: 0, prior_scored_count: 0, prior_same_form_id_count: 1
  };
  assert.throws(
    () => openExposureLedger({ schema_id: "aos-exposure-ledger.v1", entries: [legacyEntry] }),
    /AOS_EXPOSURE_LEDGER_MIGRATION_REQUIRED/
  );
  // An entirely empty pre-chain ledger (no entries yet, but also no `revision`/`head_digest` --
  // for instance a ledger some other pre-#585-round-3 tool wrote with an empty history) is refused
  // the same way; absence of entries is not evidence the ledger ever went through this release's
  // integrity binding.
  assert.throws(
    () => openExposureLedger({ schema_id: "aos-exposure-ledger.v1", entries: [] }),
    /AOS_EXPOSURE_LEDGER_MIGRATION_REQUIRED/
  );
});

test("a ledger relabeled with the pre-chain id is refused as migration-required, even if it is otherwise a real, chain-verified ledger", async () => {
  // #585 (this round). The pre-chain shape and the revision/chain/head-digest-bound shape used to
  // share one schema id (`aos-exposure-ledger.v1`), so which shape a raw object actually was
  // depended on whether `revision`/`head_digest` happened to be present, not on the id it claimed.
  // A real, internally consistent v2 ledger -- straight out of this library's own write path,
  // chain-verified and all -- relabeled with the OLD id used to be accepted anyway, because the
  // migration check only fired when `revision` and `head_digest` were BOTH absent. Now the id alone
  // decides: the pre-chain id is refused unconditionally, whatever fields the object also carries.
  const { createExposureLedger, openExposureLedger, recordExposure, EXPOSURE_LEDGER_SCHEMA_ID, EXPOSURE_LEDGER_SCHEMA_ID_V2 } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"7".repeat(64)}`;
  const { ledger: real } = recordExposure(createExposureLedger(), {
    form_id: "f", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: "2026-09-06T10:00:00.000Z", scored: true
  });
  assert.equal(real.schema_id, EXPOSURE_LEDGER_SCHEMA_ID_V2, "a fresh ledger from this library's own write path carries the chained shape's own id");
  // The exact same bytes, opened without complaint under their real id.
  assert.equal(openExposureLedger(real).entries.length, 1);
  // Relabeled with the pre-chain id and nothing else changed: still a fully well-formed, chain-
  // verified v2 ledger by every field it carries, but claiming the OLD id.
  const relabeled = { ...real, schema_id: EXPOSURE_LEDGER_SCHEMA_ID };
  assert.throws(() => openExposureLedger(relabeled), /AOS_EXPOSURE_LEDGER_MIGRATION_REQUIRED/);
});

// ---------------------------------------------------------------------------------------------
// Exposure ledger integrity binding: revision, transition digest chain, head, uniqueness (#585
// round 3, governing directive 19 and the detectable half of 13). `openExposureLedger` validates
// each entry's own shape; none of that says anything about entries reordered, one deleted from the
// middle, one inserted, or a field inside a committed entry altered afterward. These tests build a
// real ledger through the library's own write path -- never a hand-typed literal claiming a chain
// it never earned -- then apply exactly one tamper and check the one named refusal it produces.

test("a well-formed exposure ledger with a real transition chain opens normally, and each commit advances revision and head", async () => {
  const { createExposureLedger, openExposureLedger, recordExposure, reserveExposure } = await import("../../lib/form-class.mjs");
  const digestA = `sha256:${"1".repeat(64)}`;
  const digestB = `sha256:${"2".repeat(64)}`;
  const fresh = createExposureLedger();
  assert.equal(fresh.revision, 0);
  assert.equal(fresh.head_digest, `sha256:${"0".repeat(64)}`);

  const first = recordExposure(fresh, { form_id: "f1", form_contract_digest: digestA, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T10:00:00.000Z", scored: true });
  assert.equal(first.ledger.revision, 1, "one committed transition consumes exactly one revision");
  assert.equal(first.entry.revision, 1, "the entry a transition touches is stamped with that same revision");
  assert.notEqual(first.ledger.head_digest, fresh.head_digest, "an appended entry must move the head digest off genesis");
  assert.equal(first.ledger.head_digest, first.entry.chain_digest, "the head digest is the last entry's own chain digest");

  const second = recordExposure(first.ledger, { form_id: "f2", form_contract_digest: digestB, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T11:00:00.000Z", scored: true });
  assert.equal(second.ledger.revision, 2, "a second commit advances the revision by exactly one");
  assert.equal(second.ledger.entries[0].chain_digest, first.entry.chain_digest, "an untouched earlier entry keeps its own digest");
  assert.equal(second.ledger.head_digest, second.entry.chain_digest);

  // A reservation, its reveal and its terminal transition are three separate commits on one row:
  // three revisions consumed, one entry.
  const reserved = reserveExposure(second.ledger, { form_id: "f3", form_contract_digest: digestA, declared_class: "OPERATIONAL", administration_id: "admin-integrity-1", occurred_at: "2026-09-06T12:00:00.000Z" });
  assert.equal(reserved.ledger.revision, 3);
  const revealed = (await import("../../lib/form-class.mjs")).markRevealed(reserved.ledger, { administration_id: "admin-integrity-1", occurred_at: "2026-09-06T12:01:00.000Z" });
  assert.equal(revealed.ledger.revision, 4);
  const terminal = recordExposure(revealed.ledger, { form_id: "f3", form_contract_digest: digestA, declared_class: "OPERATIONAL", administration_id: "admin-integrity-1", occurred_at: "2026-09-06T12:02:00.000Z", scored: true });
  assert.equal(terminal.ledger.revision, 5, "reserve, reveal and terminal are three commits on one row, so revision 5 with still 3 entries");
  assert.equal(terminal.ledger.entries.length, 3);

  // Round-tripped through JSON, exactly as the CLI persists and re-reads it, the ledger still opens.
  const roundTripped = openExposureLedger(JSON.parse(JSON.stringify(terminal.ledger)));
  assert.equal(roundTripped.entries.length, 3);
  assert.equal(roundTripped.revision, 5);
  assert.equal(roundTripped.head_digest, terminal.ledger.head_digest);
});

/** A real 3-entry ledger via the library's own write path, for the tamper tests below. */
const realThreeEntryLedger = async () => {
  const { createExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const digests = [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`, `sha256:${"3".repeat(64)}`];
  let ledger = createExposureLedger();
  for (const [index, digest] of digests.entries()) {
    ledger = recordExposure(ledger, {
      form_id: `f${index + 1}`, form_contract_digest: digest, declared_class: "OPERATIONAL",
      occurred_at: `2026-09-06T1${index}:00:00.000Z`, scored: true
    }).ledger;
  }
  // Plain, JSON-round-tripped data -- the same shape `openExposureLedger` reads off disk, not a
  // frozen/live object a test could accidentally mutate in place.
  return JSON.parse(JSON.stringify(ledger));
};

// The chain-broken message is asserted by name (not only the generic corrupt prefix) in the four
// tests below, on purpose: the per-entry chain check and the head-digest check overlap in what
// they catch (any change that cascades to the end also moves the head), so a generic assertion
// would stay green even with the per-entry check deleted outright, entirely masked by the head
// check firing instead with a different message. The specific message is what makes the per-entry
// check's own mutation guard load-bearing rather than redundant with the head guard's.
const CHAIN_BROKEN = /the transition digest chain is broken at entry \d+/;

test("deleting a middle exposure entry breaks the transition digest chain", async () => {
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const raw = await realThreeEntryLedger();
  raw.entries.splice(1, 1); // delete the middle entry; head_digest and revision are left as they were
  assert.throws(() => openExposureLedger(raw), CHAIN_BROKEN);
});

test("reordering two committed exposure entries breaks the transition digest chain", async () => {
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const raw = await realThreeEntryLedger();
  [raw.entries[0], raw.entries[1]] = [raw.entries[1], raw.entries[0]];
  assert.throws(() => openExposureLedger(raw), CHAIN_BROKEN);
});

test("inserting an exposure entry breaks the transition digest chain", async () => {
  // Not one of the eight named required refusals, but named in the scope's own list of tamper
  // shapes alongside the other three. Left on the generic corrupt assertion (not `CHAIN_BROKEN`):
  // copying an existing entry's `revision` for the inserted row also collides with that row's own
  // revision, so in practice this specific construction is refused by the duplicate-revision check
  // before the chain is ever recomputed -- itself further evidence the tamper is caught, just not
  // by the one specific line the other three tests isolate.
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const raw = await realThreeEntryLedger();
  raw.entries.splice(1, 0, { ...raw.entries[0], form_contract_digest: `sha256:${"4".repeat(64)}` });
  assert.throws(() => openExposureLedger(raw), /AOS_EXPOSURE_LEDGER_CORRUPT/);
});

test("tampering a committed exposure entry's form contract digest breaks the transition digest chain", async () => {
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const raw = await realThreeEntryLedger();
  // The field is rewritten; `chain_digest` is left exactly as it was committed, the way an edit
  // that does not also know to recompute a hash chain always looks.
  raw.entries[1].form_contract_digest = `sha256:${"9".repeat(64)}`;
  assert.throws(() => openExposureLedger(raw), CHAIN_BROKEN);
});

test("duplicating a revision across two stored exposure entries is refused", async () => {
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const raw = await realThreeEntryLedger();
  raw.entries[2].revision = raw.entries[0].revision;
  // Asserted by the specific message: deduplicating a revision this way also makes the highest
  // entry revision (2) disagree with the ledger's own revision counter (3), so the gap/decrease
  // check below the duplicate check would also refuse this ledger, with a different message, if
  // the duplicate check alone were ever removed.
  assert.throws(() => openExposureLedger(raw), /two stored exposure entries share one revision/);
});

test("an exposure ledger revision inflated beyond what any entry claims is refused", async () => {
  // The other half of monotonic revision: no duplicate, no missing entry, nothing about the chain
  // moved -- only the ledger's own top-level counter no longer matches its most recently committed
  // entry. Neither the duplicate check nor the chain/head checks fire for this one; only the
  // gap/decrease check does.
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const raw = await realThreeEntryLedger();
  raw.revision += 50;
  assert.throws(() => openExposureLedger(raw), /the ledger's revision does not match its most recently committed entry/);
});

test("truncating the tail of the exposure ledger is refused even if the revision counter is patched to match", async () => {
  const { openExposureLedger } = await import("../../lib/form-class.mjs");
  const raw = await realThreeEntryLedger();
  raw.entries.pop();
  // A naive truncation (leaving `revision` and `head_digest` untouched) is already caught by the
  // revision-vs-entries check above; patching `revision` down to match the remaining entries
  // isolates the head digest binding as the check that still catches it -- directive 19 item 3
  // exists because the per-entry chain alone does not.
  raw.revision = 2;
  assert.throws(() => openExposureLedger(raw), /the ledger's head digest does not match its last entry/);
});

test("two stored exposure entries sharing one administration_id are refused, even with an internally consistent chain", async () => {
  const { createExposureLedger, openExposureLedger, reserveExposure } = await import("../../lib/form-class.mjs");
  const { sha256Value } = await import("../../lib/core.mjs");
  const digestA = `sha256:${"1".repeat(64)}`;
  const digestB = `sha256:${"2".repeat(64)}`;
  const first = reserveExposure(createExposureLedger(), { form_id: "f1", form_contract_digest: digestA, declared_class: "OPERATIONAL", administration_id: "admin-dup-1", occurred_at: "2026-09-06T10:00:00.000Z" });
  const second = reserveExposure(first.ledger, { form_id: "f2", form_contract_digest: digestB, declared_class: "OPERATIONAL", administration_id: "admin-dup-2", occurred_at: "2026-09-06T11:00:00.000Z" });
  const raw = JSON.parse(JSON.stringify(second.ledger));
  raw.entries[1].administration_id = raw.entries[0].administration_id;
  // A forger careful enough to recompute the whole chain after the rename still cannot pass: the
  // administration_id uniqueness check is independent of the chain, exactly because a duplicated id
  // does not by itself change any entry's content in a way the chain alone would notice. With the
  // chain and revisions both left internally consistent, disabling the uniqueness check itself
  // would leave nothing else in this file to refuse it at all.
  const GENESIS = `sha256:${"0".repeat(64)}`;
  let previous = GENESIS;
  for (const entry of raw.entries) {
    delete entry.chain_digest;
    const digest = `sha256:${sha256Value({ previous_digest: previous, entry })}`;
    entry.chain_digest = digest;
    previous = digest;
  }
  raw.head_digest = previous;
  assert.throws(() => openExposureLedger(raw), /share one administration_id/);
});

test("a cycle excludes a practice-classified administration from the official aggregate", async () => {
  const { createCycle, recordRun, aggregateCycle } = await import("../../lib/cycle.mjs");
  const { classifyAdministration, createExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const seeds = ["0000000000000001", "0000000000000002", "0000000000000003"];
  const digest = `sha256:${"6".repeat(64)}`;
  const runOn = (seed, classification) => ({
    seed, run_id: `r-${seed}`, profile_digest: "p", suite_major: 1, scorer_major: 1,
    failure: null, terminal_committed: true, issued: true, final_score: 70, dimensions: {},
    form_classification: classification
  });
  const { ledger } = recordExposure(createExposureLedger(), { form_id: "aos-operational-0000000000000001", form_contract_digest: digest, declared_class: "OPERATIONAL", occurred_at: "2026-09-06T10:00:00.000Z", scored: true });
  const replay = classifyAdministration(ledger, { form_id: "aos-operational-0000000000000001", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  const cycle = recordRun(createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, seeds, cycleId: "cycle-B" }), runOn(seeds[0], replay));
  assert.equal(cycle.runs[0].valid, false, "a replayed operational form was counted as official aggregate evidence");
  assert.equal(cycle.runs[0].invalid_reason, "AOS_FORM_ALREADY_EXPOSED");
  const aggregate = aggregateCycle(cycle);
  assert.deepEqual(aggregate.excluded, [{ seed: seeds[0], reason: "AOS_FORM_ALREADY_EXPOSED" }]);
  assert.equal(aggregate.valid_runs, 0);
  // Counterfactual one way: a first-exposure operational administration still counts.
  const official = classifyAdministration(createExposureLedger(), { form_id: "aos-operational-0000000000000001", form_contract_digest: digest, declared_class: "OPERATIONAL" });
  const counted = recordRun(createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, seeds, cycleId: "cycle-C" }), runOn(seeds[0], official));
  assert.equal(counted.runs[0].valid, true);
  // Counterfactual the other way: a run recorded before the ledger existed carries no
  // classification, and stays what it always was -- the ledger cannot testify about
  // administrations it never saw, and refusing history it has no evidence about would be an
  // absence scored as a value.
  const historical = recordRun(createCycle({ profileDigest: "p", suiteMajor: 1, scorerMajor: 1, seeds, cycleId: "cycle-D" }), runOn(seeds[0], undefined));
  assert.equal(historical.runs[0].valid, true);
});

// ---------------------------------------------------------------------------------------------
// The CLI entry point, end to end: the ledger lives in the home, `aos assess` records every graded
// administration into it, and `aos cycle run` refuses official aggregation for a replayed form.

test("a replayed operational form crosses runs as practice, never as official aggregate evidence", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { addAgent, makePlan, run, verifiedRunner } = await import("./helpers.mjs");
  const { runPaths } = await import("../../lib/store.mjs");

  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const cli = join(root, "bin", "aos.mjs");
  const SEEDS = ["0000000000000031", "0000000000000032", "0000000000000033"];
  const FIXTURE_MODEL = "openai/gpt-4o-2024-08-06";
  const UNBLOCK = Array.from({ length: 12 }, () => "\n\n\ny\nAOS-TEST-UNBLOCK proceed\n").join("");
  const cwd = mkdtempSync(join(tmpdir(), "aos-form-exposure-"));
  const home = join(cwd, ".aos");
  const spawn = (args) => spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", input: UNBLOCK, timeout: 300000,
    env: { ...process.env, AOS_HOME: home, FAKE_AGENT_PROFILE: "needs-instruction", FAKE_AGENT_MODEL: FIXTURE_MODEL }
  });
  const ledgerOf = () => JSON.parse(readFileSync(join(home, "exposure-ledger.json"), "utf8"));
  const cycleOf = () => JSON.parse(readFileSync(join(home, "cycle.json"), "utf8"));
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo", undefined, ["--model-id", FIXTURE_MODEL, "--adapter", "codex-cli.v1"], verifiedRunner(cwd));
    const plan = makePlan(cwd, { default: "solo" });

    // A bare preview of the first seed. It is an administration -- the operator has now met the
    // form -- so it lands in the ledger as practice, outside any cycle.
    spawn(["assess", "--plan", plan, "--checkpoints", "--seed", SEEDS[0]]);
    const afterPreview = ledgerOf();
    assert.equal(afterPreview.entries.length, 1);
    assert.equal(afterPreview.entries[0].administered_class, "PRACTICE", "a bare assess of an operational form is a practice administration");
    assert.equal(afterPreview.entries[0].scored, false);
    assert.equal(afterPreview.entries[0].sequence_position, 1);
    assert.equal(afterPreview.entries[0].cycle_id, null);
    // #585. The wall clock the command itself measured, on every administration whether or not it
    // scores -- without it `speed_only_improvement` can never leave null from real use.
    assert.equal(typeof afterPreview.entries[0].duration_ms, "number");
    assert.equal(afterPreview.entries[0].duration_ms >= 0, true);

    // The previewed seed inside a cycle: the ledger has seen the exact form, so the run is
    // classified practice and excluded from the official aggregate, by name.
    run(cwd, ["cycle", "start", ...SEEDS.flatMap((seed) => ["--seed", seed])]);
    const replayed = spawn(["cycle", "run", "--plan", plan, "--checkpoints"]);
    assert.match(replayed.stdout, /practice lane: AOS_FORM_ALREADY_EXPOSED/u, "the refusal is printed where the operator can read it");
    const cycleAfterReplay = cycleOf();
    assert.equal(cycleAfterReplay.runs[0].seed, SEEDS[0]);
    assert.equal(cycleAfterReplay.runs[0].valid, false, "a previewed form was counted as official aggregate evidence");
    assert.equal(cycleAfterReplay.runs[0].invalid_reason, "AOS_FORM_ALREADY_EXPOSED");
    assert.equal(cycleAfterReplay.runs[0].form_classification.administered_class, "PRACTICE");
    // #585. The ledger classified and refused this one -- named on the run itself, not folded into
    // the same "not counted" shape a run the ledger never saw would also produce.
    assert.equal(cycleAfterReplay.runs[0].exposure_verification, "REFUSED");
    assert.equal(ledgerOf().entries.length, 2);
    assert.equal(ledgerOf().entries[1].prior_exposure_count, 1);

    // #585 item 3. A PRACTICE terminal used to sit beside an unchanged result: `buildResult` had
    // already computed whatever the graded run measured before the ledger classification above
    // ever ran, and nothing withheld the composite or the two profile surfaces afterward, so a
    // PRACTICE terminal shipped next to a result still claiming an issued operational estimate.
    // Read straight off disk -- the exact artifact an operator opens -- rather than off anything
    // this test computed itself.
    const replayedResult = JSON.parse(readFileSync(runPaths(home, cycleAfterReplay.runs[0].run_id).result, "utf8"));
    assert.equal(replayedResult.aos_composite.issued, false, "a PRACTICE administration must not ship an issued composite");
    assert.equal(replayedResult.aos_composite.value, null);
    assert.match(replayedResult.aos_composite.withheld_reason, /AOS_FORM_ALREADY_EXPOSED/u, "the withheld reason must be the ledger's own refusal, not whatever buildResult computed before classification ran");
    assert.equal(replayedResult.operator_process_profile.issued, false, "a PRACTICE administration must not ship an issued operator-process profile");
    assert.equal(replayedResult.operator_process_profile.index, null);
    assert.equal(replayedResult.system_outcome_profile.issued, false, "a PRACTICE administration must not ship an issued system-outcome profile");
    assert.equal(replayedResult.system_outcome_profile.index, null);

    // The next locked seed is a first exposure: an operational administration, scored once, and
    // its facet records carry the occasion and sequence position the ledger assigned.
    const official = spawn(["cycle", "run", "--plan", plan, "--checkpoints"]);
    assert.match(official.stdout, new RegExp(`seed ${SEEDS[1]}`, "u"));
    const cycleAfterOfficial = cycleOf();
    const officialRun = cycleAfterOfficial.runs[1];
    assert.equal(officialRun.form_classification.official_scoring_permitted, true);
    assert.equal(officialRun.form_classification.administered_class, "OPERATIONAL");
    assert.notEqual(officialRun.invalid_reason, "AOS_FORM_ALREADY_EXPOSED");
    // #585. Verified, not merely valid: the ledger itself checked this exact administration and
    // said so, which is the fact "valid: true" alone does not distinguish from a pre-ledger run.
    assert.equal(officialRun.exposure_verification, "VERIFIED");
    const finalLedger = ledgerOf();
    assert.equal(finalLedger.entries.length, 3);
    assert.equal(finalLedger.entries[2].administered_class, "OPERATIONAL");
    assert.equal(finalLedger.entries[2].scored, true);
    assert.equal(finalLedger.entries[2].cycle_id, cycleAfterOfficial.cycle_id);
    assert.equal(finalLedger.entries[2].sequence_position, 3);
    const result = JSON.parse(readFileSync(runPaths(home, officialRun.run_id).result, "utf8"));
    assert.deepEqual(result.facet_coverage.occasions.observed_levels, [finalLedger.entries[2].occasion_id], "the run's facet records do not carry the administration occasion the ledger assigned");
    // #585. `score` and `duration_ms` travel onto the ledger entry from this exact run, not as a
    // fabricated number: the ledger's score is the run's own issued composite value, whatever it
    // is (including null, if the composite withheld) -- never a number this administration did not
    // earn. Without this, `memorization_indicator` and `speed_only_improvement` could never leave
    // null from real use, whatever `practiceAnalysis` computes from a form with two administrations.
    assert.equal(finalLedger.entries[2].score, result.aos_composite.value, "the ledger's score must be the run's own issued composite, not left null while a real one exists");
    assert.equal(typeof finalLedger.entries[2].duration_ms, "number");
    assert.equal(finalLedger.entries[2].duration_ms >= 0, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a cycle run's published sequence_position is the ledger's own committed reservation, not the stale unlocked snapshot cycle run read", async () => {
  // #585 item 4. `cycle run` used to read `exposureLedger.entries.length` for its own unlocked
  // snapshot and hand that number down as `options.administration.sequence_position`, trusted
  // as-is by the facet evidence `assess` later publishes. A concurrent administration reserving
  // between that read and `assess`'s own locked `reserveExposure` call makes the snapshot stale --
  // this hook reproduces exactly that window without needing a second real process.
  const { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { addAgent, assessAtATerminal, makePlan, run } = await import("./helpers.mjs");
  const { runPaths, withExposureLedgerLock } = await import("../../lib/store.mjs");
  const { openExposureLedger, reserveExposure } = await import("../../lib/form-class.mjs");
  const { exposureLedgerTestHooks } = await import("../../lib/cli.mjs");

  const cwd = mkdtempSync(join(tmpdir(), "aos-sequence-race-"));
  const home = join(cwd, ".aos");
  const ledgerFile = join(home, "exposure-ledger.json");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    run(cwd, ["cycle", "start", "--seed", "0000000000000041", "--seed", "0000000000000042", "--seed", "0000000000000043"]);

    // Fires once, synchronously, in this same process, right after `cycle run` takes its own
    // unlocked snapshot -- before `assess` performs its own locked reservation. Committed here,
    // under the real lock, exactly the way a second real `aos` process would. This is this home's
    // very first administration, so the ledger file does not exist on disk yet -- exactly the
    // absence `openExposureLedger(undefined)` reads as a fresh, empty ledger.
    exposureLedgerTestHooks.afterCycleRunSnapshot = () => {
      exposureLedgerTestHooks.afterCycleRunSnapshot = null;
      withExposureLedgerLock(home, () => {
        const before = openExposureLedger(existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : undefined);
        const reserved = reserveExposure(before, {
          form_id: "aos-concurrent-administration",
          form_contract_digest: `sha256:${"c".repeat(64)}`,
          declared_class: "OPERATIONAL",
          administration_id: "concurrent-admin-1",
          run_id: "concurrent-admin-1",
          occurred_at: new Date().toISOString()
        });
        writeFileSync(ledgerFile, JSON.stringify(reserved.ledger));
      });
    };

    await assessAtATerminal(cwd, ["cycle", "run", "--plan", plan], { env: {} });

    const finalLedger = JSON.parse(readFileSync(ledgerFile, "utf8"));
    const cycle = JSON.parse(readFileSync(join(home, "cycle.json"), "utf8"));
    const runId = cycle.runs[0].run_id;
    const ownEntry = finalLedger.entries.find((entry) => entry.administration_id === runId);
    assert.notEqual(ownEntry, undefined, "this run's own reservation is missing from the ledger");
    // The concurrent entry took position 1 (the ledger was empty when the hook fired), so this
    // run's own reservation -- made afterward, under the lock -- must be position 2: the position
    // reserveExposure actually committed, never the position 1 the pre-race snapshot predicted.
    assert.equal(ownEntry.sequence_position, 2, "the concurrent reservation did not land where this test needs it to, so it proves nothing");

    const result = JSON.parse(readFileSync(runPaths(home, runId).result, "utf8"));
    const positions = new Set(result.observations
      .map((observation) => observation.facet_record?.sequence_position)
      .filter((value) => value !== null && value !== undefined));
    // Before the fix this read `options.administration.sequence_position` -- the stale snapshot --
    // and every scored observation would have published 1 instead of the 2 the ledger's own row
    // for this exact run actually holds.
    assert.deepEqual([...positions], [2], "the published sequence_position must be the ledger's own committed reservation, not the stale snapshot cycle run read before the race");
  } finally {
    exposureLedgerTestHooks.afterCycleRunSnapshot = null;
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a corrupt exposure ledger refuses the whole assessment rather than committing a run with no ledger row", async () => {
  const { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { addAgent, makePlan, run } = await import("./helpers.mjs");

  const cwd = mkdtempSync(join(tmpdir(), "aos-exposure-ledger-corrupt-"));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });

    // Valid JSON, an absurd ledger: `openExposureLedger` must refuse this the same as any other
    // shape it does not recognise, not read it as a home that never administered anything.
    const ledgerFile = join(home, "exposure-ledger.json");
    writeFileSync(ledgerFile, "null\n");
    assert.equal(readdirSync(join(home, "runs")).length, 0, "the fixture starts with no runs");

    // The corrupt ledger is caught before the run is created -- not after it is scored and
    // committed. A refusal here is the only shape that does not leave a committed run behind with
    // no ledger row to show it happened.
    const attempt = run(cwd, ["assess", "--plan", plan, "--seed", "0000000000000099"], 2);
    assert.match(attempt.stderr, /AOS_EXPOSURE_LEDGER_CORRUPT/);
    assert.equal(readdirSync(join(home, "runs")).length, 0, "a refused assessment must create no run directory at all");

    // And the ledger itself was not quietly rewritten as fresh; the corruption is still there for
    // the operator to see and fix.
    assert.equal(readFileSync(ledgerFile, "utf8").trim(), "null");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a truncated or otherwise invalid exposure-ledger.json is a named refusal, not an empty ledger", async () => {
  // A ledger that cannot even be parsed as JSON is not the same failure `openExposureLedger`
  // catches -- `readJson` (lib/core.mjs) throws before any of this file's own shape checks ever
  // run. What matters here is only that this file's read path goes through that same protected
  // reader rather than, say, defaulting to an empty ledger on a read or parse failure.
  const { mkdtempSync, readdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { addAgent, makePlan, run } = await import("./helpers.mjs");

  const cwd = mkdtempSync(join(tmpdir(), "aos-exposure-ledger-malformed-json-"));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });

    const ledgerFile = join(home, "exposure-ledger.json");
    writeFileSync(ledgerFile, '{"schema_id": "aos-exposure-ledger.v1", "entries": [');
    const attempt = run(cwd, ["assess", "--plan", plan, "--seed", "0000000000000098"], 2);
    assert.match(attempt.stderr, /AOS_MALFORMED_JSON/);
    assert.equal(attempt.stderr.includes("AOS_INTERNAL_ERROR"), false);
    assert.equal(readdirSync(join(home, "runs")).length, 0, "a refused assessment must create no run directory at all");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a replayed seed is committed PRACTICE, not ISSUED -- classified before the terminal, not after it", async () => {
  // #585 round-1 review: `writeResult`/`commitTerminal` used to run before the ledger was ever
  // consulted, so a replayed administration was scored, written and committed with status ISSUED,
  // and only the later `cycle run` bookkeeping asked the ledger's opinion. Assessing the same exact
  // seed twice against one home administers the same form_contract_digest twice; the second
  // administration's own terminal must say so, not merely the ledger nobody read back.
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { addAgent, makePlan, newestRunId, run } = await import("./helpers.mjs");
  const { runPaths } = await import("../../lib/store.mjs");

  const cwd = mkdtempSync(join(tmpdir(), "aos-terminal-practice-"));
  const home = join(cwd, ".aos");
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });
    const terminalOf = (runId) => JSON.parse(readFileSync(runPaths(home, runId).terminal, "utf8"));

    run(cwd, ["assess", "--plan", plan, "--seed", "5"], 3);
    const first = terminalOf(newestRunId(cwd));
    // Unchanged from before this fix: a fresh, never-before-seen form_contract_digest is still
    // classified OPERATIONAL by the ledger, so its own composite completeness alone decides ISSUED
    // vs. INCOMPLETE, exactly as every other test exercising this fixture already expects.
    assert.equal(first.status, "INCOMPLETE");

    // The exact same seed, same home: the second administration meets the identical
    // form_contract_digest the first one just recorded, whatever either one scored.
    run(cwd, ["assess", "--plan", plan, "--seed", "5"], 3);
    const second = terminalOf(newestRunId(cwd));
    assert.equal(second.status, "PRACTICE", "a replayed form_contract_digest must never be committed as ISSUED or read identically to a first exposure");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Alternate-form linking: equivalence, drift, retirement (#585)

const linkingFixtures = () => {
  const digestL = `sha256:${"7".repeat(64)}`;
  const digestR = `sha256:${"8".repeat(64)}`;
  const left = { form_id: "aos-operational-00aa", form_contract_digest: digestL, construct_opportunity_ids: ["C1.GF.01", "C2.SC.01", "C3.RD.01", "C4.IQ.01"] };
  const right = { form_id: "aos-operational-00ab", form_contract_digest: digestR, construct_opportunity_ids: ["C1.GF.01", "C2.SC.01", "C3.RD.01", "C5.VF.01"] };
  const anchors = ["C1.GF.01", "C2.SC.01", "C3.RD.01"];
  const empirical = {
    method: "anchored-delta.v1",
    method_version: "1.0.0",
    sample_per_form: { left: 25, right: 25 },
    anchor_deltas: { "C1.GF.01": 0.02, "C2.SC.01": -0.03, "C3.RD.01": 0.01 }
  };
  return { left, right, anchors, empirical };
};

test("different seeds alone never link two forms: equivalence stays unestablished with the missing evidence named", async () => {
  const { linkForms } = await import("../../lib/form-class.mjs");
  const { left, right } = linkingFixtures();
  const scaffold = linkForms({ left_form: left, right_form: right });
  assert.equal(scaffold.equivalence_decision, null, "no empirical linking data is a null, not a verdict either way");
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.claim_stage_ceiling, "PROFILE_BOUND");
  assert.equal(scaffold.drift.status, "NOT_MONITORED");
  for (const missing of ["anchor_opportunity_ids", "exposure_history", "task_model_digest", "cross_form_response_patterns"]) {
    assert.equal(scaffold.inputs_missing.includes(missing), true, `${missing} is absent and the scaffold does not say so`);
  }
  // The coverage comparison is computable without any empirical study, and is reported.
  assert.deepEqual(scaffold.coverage.shared, ["C1.GF.01", "C2.SC.01", "C3.RD.01"]);
  assert.deepEqual(scaffold.coverage.left_only, ["C4.IQ.01"]);
  assert.deepEqual(scaffold.coverage.right_only, ["C5.VF.01"]);
});

test("a small linking sample never passes: the decision stays null and names the floor", async () => {
  const { linkForms, LINKING_METHOD_INTERFACE } = await import("../../lib/form-class.mjs");
  const { left, right, anchors, empirical } = linkingFixtures();
  const scaffold = linkForms({
    left_form: left, right_form: right, anchor_ids: anchors,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`,
    response_patterns: { ...empirical, sample_per_form: { left: LINKING_METHOD_INTERFACE.minimum_sample_per_form - 1, right: 25 } }
  });
  assert.equal(scaffold.equivalence_decision, null);
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.reasons.some((reason) => reason.includes("AOS_LINKING_SAMPLE_BELOW_MINIMUM")), true);
});

test("caller linking findings stay unauthenticated in both directions; disjoint anchors still fail", async () => {
  // #585 (this round). This is the exact scenario every review round's forgery, and this test
  // itself before this round, was built to reach: every floor met, every digest present, drift
  // within the registered threshold. `linkForms` never sets `equivalence_decision: true` /
  // `equivalence_status: "LINKED"` from this branch any more, whatever the caller's numbers say --
  // AOS has no trust root for the study behind them. What those numbers implied is recorded on
  // `unauthenticated_claim` instead. A negative finding also needs an authenticated study.
  // Disjoint anchors still fail the structural check without making an observation claim.
  const { linkForms } = await import("../../lib/form-class.mjs");
  const { left, right, anchors, empirical } = linkingFixtures();
  const complete = {
    left_form: left, right_form: right, anchor_ids: anchors,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`
  };
  const wouldHaveLinked = linkForms({ ...complete, response_patterns: empirical });
  assert.equal(wouldHaveLinked.equivalence_decision, null, "a complete calibration must not authorize a decision");
  assert.equal(wouldHaveLinked.equivalence_status, "UNESTABLISHED");
  assert.equal(wouldHaveLinked.claim_stage_ceiling, "PROFILE_BOUND");
  assert.equal(wouldHaveLinked.drift.status, "NOT_MONITORED", "the authoritative drift field must not report a determination this function never authorized");
  assert.deepEqual(wouldHaveLinked.inputs_missing, [], "the artifact really was complete; nothing here is a shape refusal");
  assert.equal(wouldHaveLinked.unauthenticated_claim.claimed_equivalence_status, "LINKED");
  assert.equal(wouldHaveLinked.unauthenticated_claim.maximum_observed_delta < 0.1, true);
  assert.match(wouldHaveLinked.unauthenticated_claim.reason, /AOS_LINKING_UNAUTHENTICATED/);

  const drifted = linkForms({ ...complete, response_patterns: { ...empirical, anchor_deltas: { ...empirical.anchor_deltas, "C3.RD.01": 0.4 } } });
  assert.equal(drifted.equivalence_decision, null, "caller drift must remain unknown");
  assert.equal(drifted.equivalence_status, "UNESTABLISHED");
  assert.equal(drifted.claim_stage_ceiling, "PROFILE_BOUND");
  assert.equal(drifted.drift.status, "NOT_MONITORED");
  assert.equal(drifted.drift.maximum_observed_delta, null);
  assert.equal(drifted.unauthenticated_claim.claimed_equivalence_status, "DRIFTED");
  assert.equal(drifted.unauthenticated_claim.maximum_observed_delta, 0.4);
  assert.match(drifted.unauthenticated_claim.reason, /AOS_LINKING_UNAUTHENTICATED/);
  const disjoint = linkForms({ ...complete, anchor_ids: ["C9.XX.01", "C1.GF.01", "C2.SC.01"], response_patterns: empirical });
  assert.equal(disjoint.equivalence_decision, false);
  assert.equal(disjoint.equivalence_status, "FAILED");
  assert.equal(disjoint.reasons.some((reason) => reason.includes("AOS_LINKING_ANCHORS_NOT_SHARED")), true);
  assert.equal(disjoint.unauthenticated_claim, null);
  // Linking a form to itself is not a question this scaffold answers.
  assert.throws(() => linkForms({ ...complete, right_form: left, response_patterns: empirical }), /AOS_LINKING_SAME_FORM/);
  // And a complete calibration is still not what lets a bank record say LINKED: `formBankRecord`
  // does not even look at `linking.equivalence_status` any more.
  const { formBankRecord: bank } = await import("../../lib/form-class.mjs");
  const record = bank({ form_id: left.form_id, form_class: "OPERATIONAL", construct_opportunity_ids: left.construct_opportunity_ids, oracle_digest: `sha256:${"c".repeat(64)}`, linking: wouldHaveLinked });
  assert.equal(record.equivalence_status, "UNESTABLISHED");
  assert.equal(record.unauthenticated_claim.claimed_equivalence_status, "UNESTABLISHED", "formBankRecord echoes what linkForms actually decided, not what the caller's numbers implied");
});

test("fewer anchors than the method declares never links, whatever the samples and deltas say", async () => {
  const { linkForms, LINKING_METHOD_INTERFACE } = await import("../../lib/form-class.mjs");
  const { left, right, empirical } = linkingFixtures();
  // The method declares `minimum_anchor_count: 3`; two anchors is one short of it, and every other
  // input -- adequate samples, deltas within threshold -- is otherwise complete. Checking only
  // `=== 0` let this read as a full anchor set and reach LINKED, removing the claim-stage ceiling
  // on evidence the method never certified as enough.
  assert.equal(LINKING_METHOD_INTERFACE.minimum_anchor_count, 3);
  const short = ["C1.GF.01", "C2.SC.01"];
  assert.ok(short.length < LINKING_METHOD_INTERFACE.minimum_anchor_count);
  const scaffold = linkForms({
    left_form: left, right_form: right, anchor_ids: short,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`,
    response_patterns: empirical
  });
  assert.equal(scaffold.equivalence_decision, null, "two anchors is not the declared floor, and a short sample is not a smaller yes");
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.claim_stage_ceiling, "PROFILE_BOUND");
  assert.ok(scaffold.inputs_missing.includes("anchor_opportunity_ids"));
});

test("repeating one shared anchor to reach the count never satisfies the anchor minimum", async () => {
  // The three-anchor minimum was checked against `anchorIds.length` while the anchors this scaffold
  // actually reports are deduplicated (`anchor_ids: sortedUnique(anchorIds)`), so repeating one
  // shared anchor three times satisfied the raw-length floor on a single distinct anchor and reached
  // LINKED from evidence the registered method never certified as enough.
  const { linkForms, LINKING_METHOD_INTERFACE } = await import("../../lib/form-class.mjs");
  const { left, right, empirical } = linkingFixtures();
  assert.equal(LINKING_METHOD_INTERFACE.minimum_anchor_count, 3);
  const repeated = ["C1.GF.01", "C1.GF.01", "C1.GF.01"];
  assert.equal(repeated.length, LINKING_METHOD_INTERFACE.minimum_anchor_count, "the raw array meets the floor; only the distinct count does not");
  const scaffold = linkForms({
    left_form: left, right_form: right, anchor_ids: repeated,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`,
    response_patterns: empirical
  });
  assert.equal(scaffold.equivalence_decision, null, "one distinct anchor is not the declared floor, however many times it is repeated");
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.claim_stage_ceiling, "PROFILE_BOUND");
  assert.ok(scaffold.inputs_missing.includes("anchor_opportunity_ids"));
  assert.deepEqual(scaffold.anchor_ids, ["C1.GF.01"], "the emitted anchor set is already deduplicated to one distinct anchor");
});

// Directive 22.4/22.5: only a registered method/version pair may reach LINKED, and only that
// method's own registered contract may set the drift threshold a comparison is measured against.

test("an unregistered linking method never reaches LINKED, whatever the rest of the evidence says", async () => {
  const { linkForms } = await import("../../lib/form-class.mjs");
  const { left, right, anchors, empirical } = linkingFixtures();
  // Every other input here is otherwise complete -- adequate samples, deltas within threshold --
  // so a LINKED result would mean the method name itself was never actually checked.
  const scaffold = linkForms({
    left_form: left, right_form: right, anchor_ids: anchors,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`,
    response_patterns: { ...empirical, method: "unregistered-method.v1" }
  });
  assert.notEqual(scaffold.equivalence_status, "LINKED");
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.equivalence_decision, null);
  assert.ok(scaffold.inputs_missing.includes("linking_method_unregistered"), "an unregistered method must be named as missing, not silently accepted as a real calibration");
});

test("an unregistered version of a registered method never reaches LINKED", async () => {
  const { linkForms } = await import("../../lib/form-class.mjs");
  const { left, right, anchors, empirical } = linkingFixtures();
  // anchored-delta.v1 is registered only at 1.0.0; a different version string is not a smaller
  // study, it is a method version nobody built a contract for.
  const scaffold = linkForms({
    left_form: left, right_form: right, anchor_ids: anchors,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`,
    response_patterns: { ...empirical, method_version: "9.9.9" }
  });
  assert.notEqual(scaffold.equivalence_status, "LINKED");
  assert.equal(scaffold.equivalence_status, "UNESTABLISHED");
  assert.equal(scaffold.equivalence_decision, null);
  assert.ok(scaffold.inputs_missing.includes("linking_method_unregistered"));
});

test("a caller-supplied drift threshold is ignored in both directions; only the registered threshold decides", async () => {
  const { linkForms } = await import("../../lib/form-class.mjs");
  const { left, right, anchors, empirical } = linkingFixtures();
  const complete = {
    left_form: left, right_form: right, anchor_ids: anchors,
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`
  };
  // A caller widening the threshold to 999 must not launder a genuinely drifting comparison into
  // LINKED.
  const widened = linkForms({
    ...complete,
    response_patterns: { ...empirical, anchor_deltas: { ...empirical.anchor_deltas, "C3.RD.01": 0.4 } },
    drift_thresholds: { maximum_anchor_delta: 999 }
  });
  assert.equal(widened.equivalence_status, "UNESTABLISHED");
  assert.equal(widened.equivalence_decision, null);
  assert.equal(widened.unauthenticated_claim.claimed_equivalence_status, "DRIFTED", "the registered threshold still governs the caller claim");
  // And a caller narrowing the threshold must not turn a comparison genuinely within the
  // registered threshold into a refusal either -- the caller's field is ignored, not merged with
  // the registered one in either direction. #585 (this round): the comparison genuinely within the
  // registered threshold is itself closed by construction now, so this stays UNESTABLISHED (never
  // LINKED) with the caller's numbers recorded as an unauthenticated claim -- the assertion this
  // test replaces was itself the thing #585 closes.
  const narrowed = linkForms({ ...complete, response_patterns: empirical, drift_thresholds: { maximum_anchor_delta: 0.0001 } });
  assert.equal(narrowed.equivalence_status, "UNESTABLISHED", "a caller threshold tighter than the registered one must not be honoured either; only the registered contract decides, and that contract's own comparison is unauthenticated");
  assert.equal(narrowed.equivalence_decision, null);
  assert.equal(narrowed.unauthenticated_claim.claimed_equivalence_status, "LINKED", "the registered threshold, not the caller's 0.0001, is what the claim reports as having been met");
});

test("the exposure ledger drives form retirement: any exposure retires a form from official use", async () => {
  const { createExposureLedger, formLifecycleState, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"d".repeat(64)}`;
  const fresh = formLifecycleState(createExposureLedger(), { form_contract_digest: digest });
  assert.equal(fresh.retirement_status, "ACTIVE");
  assert.equal(fresh.exposure_count, 0);
  assert.equal(fresh.equivalence_status, "UNESTABLISHED");
  assert.equal(fresh.drift_status, "NOT_MONITORED");
  const { ledger } = recordExposure(createExposureLedger(), { form_id: "f", form_contract_digest: digest, declared_class: "OPERATIONAL", administered_class: "PRACTICE", occurred_at: "2026-09-06T10:00:00.000Z", scored: false });
  const exposed = formLifecycleState(ledger, { form_contract_digest: digest });
  assert.equal(exposed.retirement_status, "RETIRED_FROM_OFFICIAL_USE", "an unscored exposure still burns the form: the operator has met the oracle");
  assert.equal(exposed.exposure_count, 1);
  assert.equal(exposed.scored_count, 0);
});

test("an abandoned reservation does not retire the form in formLifecycleState either", async () => {
  // classifyAdministration already reads this exact row as no exposure at all (see "a reservation
  // abandoned before it revealed anything does not retire the form" further below); formLifecycleState
  // must not disagree with it about the same ledger row, or one API reports a form fresh and
  // officially permitted while the other reports it retired with a nonzero exposure count.
  const { createExposureLedger, formLifecycleState, reserveExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"1a".repeat(32)}`;
  const reserved = reserveExposure(createExposureLedger(), {
    form_id: "aos-operational-lifecycle-abandoned", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-lifecycle-abandoned-1", occurred_at: "2026-09-06T10:00:00.000Z"
  });
  const state = formLifecycleState(reserved.ledger, { form_contract_digest: digest });
  assert.equal(state.retirement_status, "ACTIVE", "an unrevealed reservation retired the form here while classifyAdministration kept it fresh");
  assert.equal(state.exposure_count, 0);
  assert.equal(state.scored_count, 0);
});

// ---------------------------------------------------------------------------------------------
// Practice and occasion effects (#585)

test("practice contamination is recorded with its exact reason and excludes the form from generalizability evidence", async () => {
  const { createExposureLedger, practiceAnalysis, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"e".repeat(64)}`;
  const record = (ledger, at, score, duration) => recordExposure(ledger, {
    form_id: "aos-operational-00e1", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: at, scored: false, score, duration_ms: duration
  }).ledger;
  // Nothing administered: nothing to analyse, and null says so rather than a clean bill.
  const empty = practiceAnalysis(createExposureLedger(), { form_contract_digest: digest });
  assert.equal(empty.practice_contaminated, null);
  assert.equal(empty.generalizability_evidence_eligible, null);
  // One first exposure: uncontaminated, eligible.
  const once = practiceAnalysis(record(createExposureLedger(), "2026-09-06T10:00:00.000Z", 60, 900000), { form_contract_digest: digest });
  assert.equal(once.practice_contaminated, false);
  assert.equal(once.generalizability_evidence_eligible, true);
  assert.deepEqual(once.exclusion_reasons, []);
  // A replay with improvement: contaminated, excluded, with the exact reasons on the record.
  const twice = record(record(createExposureLedger(), "2026-09-06T10:00:00.000Z", 60, 900000), "2026-09-07T10:00:00.000Z", 85, 600000);
  const analysis = practiceAnalysis(twice, { form_contract_digest: digest });
  assert.equal(analysis.practice_contaminated, true);
  assert.equal(analysis.generalizability_evidence_eligible, false);
  assert.equal(analysis.exclusion_reasons.some((reason) => reason.includes("AOS_PRACTICE_SAME_FORM_REEXPOSURE")), true);
  assert.equal(analysis.memorization_indicator, true, "improvement on a replayed form is memorisation evidence, not skill evidence");
  assert.equal(analysis.exclusion_reasons.some((reason) => reason.includes("AOS_PRACTICE_MEMORIZATION_SUSPECTED")), true);
  assert.equal(analysis.same_form_exposure_count, 2);
  assert.equal(analysis.oracle_familiarity_count, 1, "the second administration met an oracle the operator had already seen once");
  assert.deepEqual(analysis.administrations.map((entry) => entry.sequence_position), [1, 2]);
  assert.equal(analysis.administrations[1].interval_ms, 86400000);
});

test("an abandoned reservation is not counted as an administration by practiceAnalysis", async () => {
  // classifyAdministration already excludes a RESERVED row that never revealed anything from
  // exposure; practiceAnalysis used to count it anyway, making a nonempty row set out of a form
  // never actually shown to anybody -- turning practice_contaminated false and
  // generalizability_evidence_eligible true for an administration that never occurred.
  const { createExposureLedger, practiceAnalysis, reserveExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"1b".repeat(32)}`;
  const reserved = reserveExposure(createExposureLedger(), {
    form_id: "aos-operational-practice-abandoned", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-practice-abandoned-1", occurred_at: "2026-09-06T10:00:00.000Z"
  });
  const analysis = practiceAnalysis(reserved.ledger, { form_contract_digest: digest });
  assert.equal(analysis.same_form_exposure_count, null, "an abandoned reservation supplied no administration to analyse");
  assert.equal(analysis.practice_contaminated, null, "nothing was administered, so there is nothing to analyse -- not a clean bill");
  assert.equal(analysis.generalizability_evidence_eligible, null);
  assert.deepEqual(analysis.administrations, []);
});

test("practice analysis leaves unadministered counts unknown and records observed zero familiarity", async () => {
  const { createExposureLedger, markRevealed, practiceAnalysis, recordExposure, reserveExposure } = await import("../../lib/form-class.mjs");
  const form = { form_id: "practice-absence", form_contract_digest: `sha256:${"ca".repeat(32)}`, declared_class: "OPERATIONAL" };
  const empty = createExposureLedger();
  const reserved = reserveExposure(empty, { ...form, administration_id: "unrevealed", occurred_at: "2026-01-01T00:00:00.000Z" }).ledger;
  for (const ledger of [empty, reserved]) {
    const analysis = practiceAnalysis(ledger, form);
    assert.equal(analysis.similar_form_exposure_count, null, "unadministered similar-form exposure is unknown");
    assert.equal(analysis.oracle_familiarity_count, null, "unadministered oracle familiarity is unknown");
    assert.equal(analysis.same_form_exposure_count, null, "unadministered same-form exposure is unknown");
    assert.equal(analysis.practice_contaminated, null);
  }
  const similar = reserveExposure(reserved, { ...form, form_contract_digest: `sha256:${"cb".repeat(32)}`, administration_id: "similar-unrevealed", occurred_at: "2026-01-01T00:00:01.000Z" }).ledger;
  const revealed = markRevealed(similar, { administration_id: "unrevealed", occurred_at: "2026-01-01T00:00:02.000Z" }).ledger;
  const once = practiceAnalysis(revealed, form);
  assert.equal(once.same_form_exposure_count, 1);
  assert.equal(once.similar_form_exposure_count, 0, "an unrevealed similar form is not exposure");
  assert.equal(once.oracle_familiarity_count, 0);
  assert.equal(once.practice_contaminated, false, "AOS-recorded absence of prior exposure remains a negative observation");
  const different = recordExposure(revealed, { ...form, form_contract_digest: `sha256:${"cc".repeat(32)}`, occurred_at: "2026-01-01T00:00:03.000Z" }).ledger;
  assert.equal(practiceAnalysis(different, form).similar_form_exposure_count, 1);
});

test("an incomplete phase A preserves unknown collaborative success", async () => {
  const { assessTransfer } = await import("../../lib/form-class.mjs");
  assert.equal(assessTransfer().phase_a, null);
  for (const phaseA of [{}, { collaborative_success: null }, { collaborative_success: "false" }]) {
    const report = assessTransfer({ phase_a: phaseA });
    assert.equal(report.phase_a.collaborative_success, null, "missing phase A success must remain unknown");
    assert.equal(report.phase_a.contributes_to_transfer_decision, false);
    assert.equal(report.near_transfer, null);
  }
  for (const success of [true, false]) {
    assert.equal(assessTransfer({ phase_a: { collaborative_success: success } }).phase_a.collaborative_success, success);
  }
});

test("speed-only improvement is an indicator on the record, never a skill gain", async () => {
  const { createExposureLedger, practiceAnalysis, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"f".repeat(64)}`;
  const grow = (ledger, at, score, duration) => recordExposure(ledger, {
    form_id: "aos-operational-00f1", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: at, scored: false, score, duration_ms: duration
  }).ledger;
  const ledger = grow(grow(createExposureLedger(), "2026-09-06T10:00:00.000Z", 70, 900000), "2026-09-07T10:00:00.000Z", 70, 300000);
  const analysis = practiceAnalysis(ledger, { form_contract_digest: digest });
  assert.equal(analysis.speed_only_improvement, true);
  assert.equal(analysis.memorization_indicator, false, "a flat score is not score improvement");
  assert.equal(analysis.exclusion_reasons.some((reason) => reason.includes("AOS_PRACTICE_SPEED_ONLY")), true);
  // Without durations the indicator is unobserved, not false.
  const scoreless = grow(grow(createExposureLedger(), "2026-09-06T10:00:00.000Z", null, null), "2026-09-07T10:00:00.000Z", null, null);
  assert.equal(practiceAnalysis(scoreless, { form_contract_digest: digest }).speed_only_improvement, null);
});

test("raw improvement is never marked as skill gain: replay suggests memorisation, and closed by construction no linking claim ever observes a change", async () => {
  const { linkForms, scoreChangeClaim } = await import("../../lib/form-class.mjs");
  const digestA = `sha256:${"a1".repeat(32)}`;
  const digestB = `sha256:${"b2".repeat(32)}`;
  const earlier = { form_contract_digest: digestA, score: 55 };
  const later = { form_contract_digest: digestA, score: 90 };
  const replay = scoreChangeClaim({ earlier, later });
  assert.equal(replay.delta, 35);
  assert.equal(replay.interpretable_change, false, "the same form cannot measure the same operator twice");
  assert.equal(replay.interpretation, "MEMORIZATION_SUSPECTED");
  // Two different forms with no established equivalence: an easier form explains the delta as
  // well as skill does, so the claim is withheld -- not made with a caveat.
  const unlinked = scoreChangeClaim({ earlier, later: { form_contract_digest: digestB, score: 90 } });
  assert.equal(unlinked.interpretable_change, null);
  assert.equal(unlinked.interpretation, "WITHHELD_EQUIVALENCE_UNESTABLISHED");
  // #585 (this round). A self-authored object naming only the schema tag, LINKED/true and the two
  // digests is not a real `linkForms` scaffold -- it carries no `inputs_missing`, no registered
  // method, no sample floor, no anchors and no drift evidence -- and this is now doubly refused:
  // `scoreChangeClaim` does not check any of those fields any more, closed by construction, so this
  // stays withheld whatever shape the object has.
  const forged = { schema_id: "aos-form-linking-scaffold.v1", equivalence_status: "LINKED", equivalence_decision: true, left_form_contract_digest: digestA, right_form_contract_digest: digestB };
  const withForged = scoreChangeClaim({ earlier, later: { form_contract_digest: digestB, score: 90 }, linking: forged });
  assert.equal(withForged.interpretable_change, null, "a self-authored linking object must not put two scores on one scale");
  assert.equal(withForged.interpretation, "WITHHELD_EQUIVALENCE_UNESTABLISHED");
  assert.equal(withForged.unauthenticated_claim.claimed_equivalence_status, "LINKED");

  // #585 (this round). Closed by construction: even a real, complete calibration through
  // `linkForms` itself -- a registered method, adequate samples, anchors within the drift threshold
  // -- no longer reaches LINKED (see `linkForms`'s own closure test), so it cannot put two scores on
  // one scale here either. The fixture below is exactly the one this test used, pre-#585, to prove
  // the opposite; it now demonstrates the closure holds end to end, from `linkForms`'s own output
  // through to `scoreChangeClaim`.
  const left = { form_id: "aos-operational-score-a", form_contract_digest: digestA, construct_opportunity_ids: ["C1.GF.01", "C2.SC.01", "C3.RD.01"] };
  const right = { form_id: "aos-operational-score-b", form_contract_digest: digestB, construct_opportunity_ids: ["C1.GF.01", "C2.SC.01", "C3.RD.01"] };
  const wouldHaveLinked = linkForms({
    left_form: left, right_form: right, anchor_ids: ["C1.GF.01", "C2.SC.01", "C3.RD.01"],
    exposure_history: { left_prior_exposure_count: 0, right_prior_exposure_count: 0 },
    task_model_digest: `sha256:${"9".repeat(64)}`,
    response_patterns: {
      method: "anchored-delta.v1", method_version: "1.0.0",
      sample_per_form: { left: 25, right: 25 },
      anchor_deltas: { "C1.GF.01": 0.02, "C2.SC.01": -0.03, "C3.RD.01": 0.01 }
    }
  });
  assert.equal(wouldHaveLinked.equivalence_status, "UNESTABLISHED", "linkForms itself must not authorize LINKED any more");
  assert.equal(wouldHaveLinked.unauthenticated_claim.claimed_equivalence_status, "LINKED", "the fixture must actually be complete enough to have claimed LINKED, for the rest of this test to say anything");
  const stillWithheld = scoreChangeClaim({ earlier, later: { form_contract_digest: digestB, score: 90 }, linking: wouldHaveLinked });
  assert.equal(stillWithheld.interpretable_change, null);
  assert.equal(stillWithheld.interpretation, "WITHHELD_EQUIVALENCE_UNESTABLISHED");
  assert.equal(stillWithheld.unauthenticated_claim.claimed_equivalence_status, "UNESTABLISHED", "scoreChangeClaim echoes what linkForms actually decided about these two forms, not what its numbers implied");
  // A linking record about two other forms is not evidence about these two.
  const foreign = { ...wouldHaveLinked, left_form_contract_digest: `sha256:${"c3".repeat(32)}`, right_form_contract_digest: `sha256:${"d4".repeat(32)}` };
  assert.equal(scoreChangeClaim({ earlier, later: { form_contract_digest: digestB, score: 90 }, linking: foreign }).interpretable_change, null);
});

// ---------------------------------------------------------------------------------------------
// C7 learning and transfer scaffold (#585)

test("the transfer protocol is versioned, phase B is held out, and C7 never enters the core composite", async () => {
  const { TRANSFER_PROTOCOL, assessTransfer } = await import("../../lib/form-class.mjs");
  assert.equal(TRANSFER_PROTOCOL.schema_id, "aos-transfer-protocol.v1");
  assert.equal(TRANSFER_PROTOCOL.version, "1.0.0");
  assert.equal(TRANSFER_PROTOCOL.separate_from_core_composite, true);
  const phaseB = TRANSFER_PROTOCOL.phases.find((phase) => phase.phase_id === "B");
  assert.equal(phaseB.agent_available, false);
  assert.equal(phaseB.transcript_available, false);
  assert.equal(TRANSFER_PROTOCOL.phases.find((phase) => phase.phase_id === "A").contributes_to_transfer_decision, false);
  assert.deepEqual([...TRANSFER_PROTOCOL.outputs], ["near_transfer", "far_transfer", "retention_transfer", "independent_verification_behavior"]);
  // No longitudinal study exists: every output is null and the status says UNESTABLISHED. That is
  // the release-permitted honest answer, not a placeholder for a number.
  const unmeasured = assessTransfer({});
  assert.equal(unmeasured.schema_id, "aos-transfer-report.v1");
  for (const output of TRANSFER_PROTOCOL.outputs) assert.equal(unmeasured[output], null, `${output} invented a value with no phase B evidence`);
  assert.equal(unmeasured.status, "UNESTABLISHED");
  assert.equal(unmeasured.included_in_core_composite, false);
  assert.equal(unmeasured.core_composite_contribution, null);
  // A phase B that still had the agent or the transcript is not a held-out phase B at all.
  assert.throws(() => assessTransfer({ phase_b: { agent_available: true, transcript_available: false, tasks: [] } }), /AOS_TRANSFER_PHASE_B_NOT_HELD_OUT/);
  assert.throws(() => assessTransfer({ phase_b: { agent_available: false, transcript_available: true, tasks: [] } }), /AOS_TRANSFER_PHASE_B_NOT_HELD_OUT/);
});

test("an empty phase B task array is not an observation: every output stays null and the status stays UNESTABLISHED", async () => {
  // A properly held-out phase B object with zero administered tasks is presence of the container,
  // not evidence in it. `transferDecision` already answers null for every output on an empty array,
  // but `status`/`uncertainty` used to key off whether `phase_b` was non-null at all, so this exact
  // shape reported OBSERVED with uncertainty SINGLE_OCCASION while all four transfer answers stayed
  // null -- promoting an empty container to an observation of nothing administered.
  const { TRANSFER_PROTOCOL, assessTransfer } = await import("../../lib/form-class.mjs");
  const report = assessTransfer({ phase_b: { agent_available: false, transcript_available: false, tasks: [] } });
  for (const output of TRANSFER_PROTOCOL.outputs) assert.equal(report[output], null, `${output} was not null with zero phase B tasks`);
  assert.equal(report.status, "UNESTABLISHED", "an empty task array must not read as an observed occasion");
  assert.equal(report.uncertainty.status, "NOT_ADMINISTERED");
  // Presence of `phase_b` alone is not evidence: `phaseBAdministered` has to key on `tasks`
  // actually holding an observed task, not merely on `phase_b !== null` -- if it did, an empty
  // tasks array would still populate `unauthenticated_claim`.
  assert.equal(report.unauthenticated_claim, null, "an empty tasks array is not administered evidence, so there is nothing to claim");
});

test("a phase B task array holding only empty objects is not an observation either: status stays UNESTABLISHED", async () => {
  // #585 (this round). `tasks: [{}]` cleared the old `tasks.length > 0` check and reported OBSERVED
  // / SINGLE_OCCASION with all four transfer answers still null, because the array held a slot with
  // none of the fields any output actually reads (`relatedness`, `delayed`, `passed`,
  // `independent_verification_observed` are all `undefined` on `{}`). A slot in the array is not an
  // administered task, whatever `tasks.length` says about it.
  const { TRANSFER_PROTOCOL, assessTransfer } = await import("../../lib/form-class.mjs");
  const report = assessTransfer({ phase_b: { agent_available: false, transcript_available: false, tasks: [{}, {}] } });
  for (const output of TRANSFER_PROTOCOL.outputs) assert.equal(report[output], null, `${output} was not null with only empty phase B task objects`);
  assert.equal(report.status, "UNESTABLISHED", "a tasks array holding only empty objects must not read as an observed occasion");
  assert.equal(report.uncertainty.status, "NOT_ADMINISTERED");
  // A nonempty tasks array is not by itself an observation: `isObservedTask` is what has to decide
  // this, not `tasks.length > 0` -- if it were, this array of two empty slots would still populate
  // `unauthenticated_claim` (with every claimed_* field null, since neither slot answers anything,
  // but a claim nonetheless) even though nothing here was ever administered.
  assert.equal(report.unauthenticated_claim, null, "two empty task slots are not administered evidence, so there is nothing to claim");

  // A single genuinely observed task among otherwise-empty slots is enough to count as
  // administered -- but #585 (this round) closes assessTransfer by construction, so "counts as
  // administered" now means only that `unauthenticated_claim` is populated with what the caller's
  // data would have implied; `status` and the four real outputs never move off their closed
  // defaults, whatever a caller-supplied phase B claims.
  const mixed = assessTransfer({
    phase_b: {
      agent_available: false,
      transcript_available: false,
      tasks: [{}, { task_id: "near-1", relatedness: "near", passed: true, independent_verification_observed: true, delayed: false }]
    }
  });
  assert.equal(mixed.status, "UNESTABLISHED", "a caller-supplied phase B must never authorize OBSERVED, however real one of its tasks looks");
  assert.equal(mixed.near_transfer, null);
  assert.equal(mixed.unauthenticated_claim.claimed_status, "OBSERVED", "what the caller's data would have implied is still recorded, unauthenticated");
  assert.equal(mixed.unauthenticated_claim.claimed_near_transfer, true);
  assert.match(mixed.unauthenticated_claim.reason, /AOS_TRANSFER_UNAUTHENTICATED/);
});

test("collaborative success with solo transfer failure stays a C7 fact, and the held-out result is closed by construction", async () => {
  const { readFileSync } = await import("node:fs");
  const { assessTransfer } = await import("../../lib/form-class.mjs");
  const fixture = JSON.parse(readFileSync(new URL("../../fixtures/transfer/c7-collaborative-success-solo-fail.json", import.meta.url), "utf8"));
  const report = assessTransfer(fixture);
  assert.equal(report.phase_a.collaborative_success, true, "phase A is recorded");
  // #585 (this round). `assessTransfer` is closed by construction: even this fixture's real,
  // properly held-out-shaped phase B -- a genuine failed near task -- never promotes `status` past
  // UNESTABLISHED or any of the four outputs off null, because AOS has no trust root confirming the
  // agent and transcript really were withheld from an administration it never witnessed.
  assert.equal(report.near_transfer, null, "a caller-claimed held-out result must not authorize a real transfer verdict");
  assert.equal(report.far_transfer, null);
  assert.equal(report.retention_transfer, null);
  assert.equal(report.independent_verification_behavior, null);
  assert.equal(report.status, "UNESTABLISHED");
  assert.equal(report.included_in_core_composite, false);
  assert.equal(report.core_composite_contribution, null);
  assert.equal(Object.isFrozen(report), true);
  // What the fixture claimed is still recorded, unauthenticated -- this is the same fact the
  // pre-#585 version of this test read straight off the real outputs.
  assert.equal(report.unauthenticated_claim.claimed_status, "OBSERVED");
  assert.equal(report.unauthenticated_claim.claimed_near_transfer, false, "the held-out related task failed and the claim says so");
  assert.equal(report.unauthenticated_claim.claimed_far_transfer, null, "no far task was administered; null, not failure");
  assert.equal(report.unauthenticated_claim.claimed_retention_transfer, null);
  assert.equal(report.unauthenticated_claim.claimed_independent_verification_behavior, false);
  assert.match(report.unauthenticated_claim.reason, /AOS_TRANSFER_UNAUTHENTICATED/);
  // The counterfactual: phase A alone, however successful, moves nothing, and claims nothing either.
  const phaseAOnly = assessTransfer({ phase_a: fixture.phase_a });
  assert.equal(phaseAOnly.near_transfer, null, "collaborative success is not independent transfer");
  assert.equal(phaseAOnly.status, "UNESTABLISHED");
  assert.equal(phaseAOnly.unauthenticated_claim, null, "phase A alone claims no held-out administration at all");
});

test("held-out passes are closed by construction: they never establish a real transfer verdict, only an unauthenticated claim", async () => {
  // #585 (this round). Before this round, a fully-passing, correctly-shaped held-out phase B
  // established real transfer per relatedness. It no longer can: AOS has no trust root for a
  // caller-claimed held-out administration, so this stays UNESTABLISHED with all four outputs null,
  // whatever the caller's tasks report -- the same closure `linkForms` and `comparisonGate` apply to
  // their own strongest, most complete caller-supplied artifacts.
  const { assessTransfer } = await import("../../lib/form-class.mjs");
  const report = assessTransfer({
    phase_b: {
      agent_available: false,
      transcript_available: false,
      tasks: [
        { task_id: "near-1", relatedness: "near", passed: true, independent_verification_observed: true, delayed: false },
        { task_id: "far-1", relatedness: "far", passed: true, independent_verification_observed: true, delayed: true }
      ]
    }
  });
  assert.equal(report.near_transfer, null);
  assert.equal(report.far_transfer, null);
  assert.equal(report.retention_transfer, null);
  assert.equal(report.independent_verification_behavior, null);
  assert.equal(report.status, "UNESTABLISHED");
  assert.equal(report.uncertainty.status, "NOT_ADMINISTERED");
  assert.equal(report.included_in_core_composite, false);
  assert.equal(report.unauthenticated_claim.claimed_status, "OBSERVED");
  assert.equal(report.unauthenticated_claim.claimed_near_transfer, true);
  assert.equal(report.unauthenticated_claim.claimed_far_transfer, true);
  assert.equal(report.unauthenticated_claim.claimed_retention_transfer, true);
  assert.equal(report.unauthenticated_claim.claimed_independent_verification_behavior, true);
});

// ---------------------------------------------------------------------------------------------
// DIF / invariance gate: comparison withholding (#585)

test("every cross-facet comparison is withheld until invariance evidence exists, for each declared facet", async () => {
  const { INVARIANCE_FACETS, comparisonGate } = await import("../../lib/form-class.mjs");
  const { modelIdentityProjection } = await import("../../lib/model-identity.mjs");
  // Acceptance names are independent of the implementation's contract-derived domain.
  const requiredFacets = ["language", "interface", "model", "runtime", "harness", "platform", "domain_familiarity", "administration_version"];
  assert.deepEqual([...INVARIANCE_FACETS], requiredFacets);
  for (const facet of requiredFacets) {
    const gate = comparisonGate({ facet, left_level: "a", right_level: "b" });
    assert.equal(gate.decision, null, `${facet}: no invariance evidence is a null, not a verdict`);
    assert.equal(gate.comparison, "WITHHELD", `${facet}: the comparison must be withheld, not made with a caveat`);
    assert.equal(gate.reasons.some((reason) => reason.includes("INVARIANCE_UNESTABLISHED")), true, facet);
  }
  assert.throws(() => comparisonGate({ facet: "hair_colour", left_level: "a", right_level: "b" }), /AOS_COMPARISON_FACET_UNKNOWN/);
  // Same operator, new model: the projection this product already publishes and this gate answer
  // the same question the same way, from the same contract state.
  const projection = modelIdentityProjection();
  assert.equal(projection.cross_model_comparison, "WITHHELD");
  assert.equal(comparisonGate({ facet: "model", left_level: "gpt-x", right_level: "gpt-y" }).comparison, "WITHHELD");
});

test("translation alone is not invariance: a re-expressed form's comparison is withheld outright", async () => {
  const { comparisonGate, DIF_RUNNER_REPORT_SCHEMA_ID, DIF_RUNNER_INTERFACE } = await import("../../lib/form-class.mjs");
  const translated = comparisonGate({ facet: "language", left_level: "ko", right_level: "en" });
  assert.equal(translated.comparison, "WITHHELD");
  assert.equal(translated.decision, null);
  // Evidence about another facet, or about other levels, is not evidence about this comparison.
  const foreignFacet = comparisonGate({
    facet: "language", left_level: "ko", right_level: "en",
    invariance_evidence: { schema_id: DIF_RUNNER_REPORT_SCHEMA_ID, interface_version: DIF_RUNNER_INTERFACE.version, facet: "interface", levels: ["cli", "web"], sample_per_group: { "cli": 40, "web": 40 }, dif_detected: false }
  });
  assert.equal(foreignFacet.comparison, "WITHHELD");
  assert.equal(foreignFacet.reasons.some((reason) => reason.includes("AOS_COMPARISON_EVIDENCE_SCOPE")), true);
  const foreignLevels = comparisonGate({
    facet: "language", left_level: "ko", right_level: "en",
    invariance_evidence: { schema_id: DIF_RUNNER_REPORT_SCHEMA_ID, interface_version: DIF_RUNNER_INTERFACE.version, facet: "language", levels: ["en", "ja"], sample_per_group: { en: 40, ja: 40 }, dif_detected: false }
  });
  assert.equal(foreignLevels.comparison, "WITHHELD");
});

test("DIF findings stay unauthenticated in both directions and incomplete studies stay withheld", async () => {
  const { comparisonGate, DIF_RUNNER_INTERFACE, DIF_RUNNER_REPORT_SCHEMA_ID } = await import("../../lib/form-class.mjs");
  assert.equal(DIF_RUNNER_INTERFACE.schema_id, "aos-dif-runner-interface.v1");
  assert.equal(DIF_RUNNER_INTERFACE.version, "1.0.0");
  // #585. The declared inputs and outputs `DIF_RUNNER_INTERFACE` lists beside `dif_detected` and
  // the sample counts: without them a report naming only its schema and a verdict would be
  // permitted on its own say-so, which is the fix this fixture exists to keep exercising honestly.
  const anchorIds = ["C1.GF.01", "C2.SC.01"];
  const responsesOf = (count) => Array.from({ length: count }, (_, index) => index);
  const evidence = (overrides = {}) => ({
    schema_id: DIF_RUNNER_REPORT_SCHEMA_ID,
    interface_version: DIF_RUNNER_INTERFACE.version,
    facet: "language",
    levels: ["ko", "en"],
    sample_per_group: { ko: DIF_RUNNER_INTERFACE.minimum_sample_per_group, en: DIF_RUNNER_INTERFACE.minimum_sample_per_group },
    anchor_opportunity_ids: anchorIds,
    responses_per_group: {
      ko: responsesOf(DIF_RUNNER_INTERFACE.minimum_sample_per_group),
      en: responsesOf(DIF_RUNNER_INTERFACE.minimum_sample_per_group)
    },
    per_anchor_statistics: Object.fromEntries(anchorIds.map((anchor) => [anchor, { delta: 0.01 }])),
    dif_detected: false,
    ...overrides
  });
  const small = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ sample_per_group: { ko: 5, en: 200 } }) });
  assert.equal(small.decision, null, "a small sample is not a smaller yes");
  assert.equal(small.comparison, "WITHHELD");
  assert.equal(small.reasons.some((reason) => reason.includes("AOS_COMPARISON_SAMPLE_BELOW_MINIMUM")), true);
  // #585 (this round). This is the complete, well-formed DIF report every field above exists to
  // build: every declared input present, adequate samples per group, no detected differential
  // functioning. Closed by construction now -- it stays WITHHELD, never PERMITTED, and what the
  // report reported is recorded as an unauthenticated claim instead.
  const passed = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence() });
  assert.equal(passed.decision, null, "a complete DIF report must not authorize a decision");
  assert.equal(passed.comparison, "WITHHELD");
  assert.equal(passed.reasons.some((reason) => reason.includes("AOS_COMPARISON_UNAUTHENTICATED")), true);
  assert.equal(passed.unauthenticated_claim.claimed_comparison, "PERMITTED");
  assert.equal(passed.unauthenticated_claim.reported_dif_detected, false);
  const detected = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ dif_detected: true }) });
  assert.equal(detected.decision, null, "caller DIF must remain unknown");
  assert.equal(detected.comparison, "WITHHELD");
  assert.equal(detected.unauthenticated_claim.claimed_comparison, "REFUSED");
  assert.equal(detected.unauthenticated_claim.reported_dif_detected, true);
  assert.match(detected.reasons.join(" "), /AOS_COMPARISON_UNAUTHENTICATED/);
  // An undeclared level is not an equal one: two silences do not compare.
  const undeclared = comparisonGate({ facet: "language", left_level: null, right_level: null });
  assert.equal(undeclared.comparison, "WITHHELD");
  assert.equal(undeclared.decision, null);
  assert.equal(undeclared.reasons.some((reason) => reason.includes("AOS_COMPARISON_FACET_UNDECLARED")), true);
  // The same declared level on both sides is not a cross-facet comparison at all.
  const same = comparisonGate({ facet: "language", left_level: "ko", right_level: "ko" });
  assert.equal(same.decision, true);
  assert.equal(same.comparison, "PERMITTED");
  // A runner that does not speak the versioned interface establishes nothing.
  const wrongRunner = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ schema_id: "somebody-elses-dif.v9" }) });
  assert.equal(wrongRunner.comparison, "WITHHELD");
  assert.equal(wrongRunner.reasons.some((reason) => reason.includes("AOS_COMPARISON_RUNNER_MISMATCH")), true);
  // A report naming only its schema, adequate sample counts and a bare `dif_detected: false` --
  // none of the anchor opportunities, per-group response data or per-anchor statistics its own
  // interface declares -- is the report approving itself, and must withhold rather than permit.
  const bare = { schema_id: DIF_RUNNER_REPORT_SCHEMA_ID, interface_version: DIF_RUNNER_INTERFACE.version, facet: "language", levels: ["ko", "en"], sample_per_group: evidence().sample_per_group, dif_detected: false };
  const noAnchors = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: bare });
  assert.equal(noAnchors.comparison, "WITHHELD");
  assert.equal(noAnchors.decision, null);
  assert.equal(noAnchors.reasons.some((reason) => reason.includes("AOS_COMPARISON_EVIDENCE_INCOMPLETE")), true);
  // Anchors named, but no response data behind them.
  const noResponses = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ responses_per_group: null }) });
  assert.equal(noResponses.comparison, "WITHHELD");
  assert.equal(noResponses.reasons.some((reason) => reason.includes("AOS_COMPARISON_EVIDENCE_INCOMPLETE")), true);
  // Response data present, but no per-anchor statistics -- the interface's own declared output.
  const noStatistics = comparisonGate({ facet: "language", left_level: "ko", right_level: "en", invariance_evidence: evidence({ per_anchor_statistics: {} }) });
  assert.equal(noStatistics.comparison, "WITHHELD");
  assert.equal(noStatistics.reasons.some((reason) => reason.includes("AOS_COMPARISON_EVIDENCE_INCOMPLETE")), true);
  // Thirty slots is not thirty observations: a `null` per response used to satisfy the length check
  // on its own.
  const nullResponses = comparisonGate({
    facet: "language", left_level: "ko", right_level: "en",
    invariance_evidence: evidence({
      responses_per_group: {
        ko: Array(DIF_RUNNER_INTERFACE.minimum_sample_per_group).fill(null),
        en: Array(DIF_RUNNER_INTERFACE.minimum_sample_per_group).fill(null)
      }
    })
  });
  assert.equal(nullResponses.comparison, "WITHHELD", "an array of null entries is not response data, whatever its length");
  assert.equal(nullResponses.reasons.some((reason) => reason.includes("AOS_COMPARISON_EVIDENCE_INCOMPLETE")), true);
  // A property is not a statistic: an empty object per anchor used to satisfy `hasOwnProperty`
  // alone, with a real dif_detected:false then permitting the comparison on nothing computed.
  const emptyPerAnchorStatistics = comparisonGate({
    facet: "language", left_level: "ko", right_level: "en",
    invariance_evidence: evidence({ per_anchor_statistics: Object.fromEntries(anchorIds.map((anchor) => [anchor, {}])) })
  });
  assert.equal(emptyPerAnchorStatistics.comparison, "WITHHELD", "an empty statistics object per anchor is a slot, not a computed statistic");
  assert.equal(emptyPerAnchorStatistics.reasons.some((reason) => reason.includes("AOS_COMPARISON_EVIDENCE_INCOMPLETE")), true);
});

// ---------------------------------------------------------------------------------------------
// Reservation before reveal (#585 round 2)
//
// I2: a reservation must be durable BEFORE content reveal. I3: once revealed, `content_revealed`
// must be durable. I4: a revealed-but-unfinished administration must not read as fresh. These four
// tests exercise the RESERVED -> REVEALED -> TERMINAL state machine directly against the ledger
// functions, plus one CLI-level test that observes the reserve-before-reveal ordering as bytes on
// disk rather than by reading `lib/cli.mjs`.

test("a reservation abandoned before it revealed anything does not retire the form", async () => {
  // Governing directive 18.1. A reservation that never revealed content and a reveal that never
  // terminated used to be the same refusal, so a form was retired forever by an administration
  // that had shown nobody anything -- and the cross-process suite reproduced exactly that from
  // ordinary lock contention rather than a crash: the process that lost the race left a RESERVED
  // row behind and the form became permanently unusable, recoverable only by hand-editing the
  // ledger. Nothing about the form reached an agent, so nothing about it is spent.
  const { classifyAdministration, createExposureLedger, markRevealed, reserveExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"22".repeat(32)}`;
  const reserved = reserveExposure(createExposureLedger(), {
    form_id: "aos-operational-abandoned", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-abandoned-1", run_id: "run-abandoned-1", occurred_at: "2026-09-06T10:00:00.000Z"
  });
  assert.equal(reserved.entry.state, "RESERVED");
  assert.equal(reserved.entry.content_revealed, false);

  const nextAttempt = classifyAdministration(reserved.ledger, {
    form_id: "aos-operational-abandoned", form_contract_digest: digest, declared_class: "OPERATIONAL"
  });
  assert.equal(nextAttempt.administered_class, "OPERATIONAL", "an unrevealed reservation retired the form for every later attempt");
  assert.equal(nextAttempt.official_scoring_permitted, true);
  // Abandoned, not forgotten: the row is still accounted for by name, so an abandoned reservation
  // and a form nobody ever reserved do not read identically.
  assert.deepEqual(nextAttempt.aborted_before_reveal, ["admin-abandoned-1"]);

  // The moment that same reservation reveals, the form IS spent and the next attempt is refused.
  const revealed = markRevealed(reserved.ledger, { administration_id: "admin-abandoned-1", occurred_at: "2026-09-06T10:00:05.000Z" });
  const afterReveal = classifyAdministration(revealed.ledger, {
    form_id: "aos-operational-abandoned", form_contract_digest: digest, declared_class: "OPERATIONAL"
  });
  assert.equal(afterReveal.official_scoring_permitted, false, "a revealed form stayed available after the reveal transition");
  assert.equal(afterReveal.refusal_code, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL");
});

test("an abandoned reservation does not durably inflate the next reservation's own prior_exposure_count", async () => {
  // `classifyAdministration` already excludes an abandoned (RESERVED, never revealed) row from
  // prior exposure -- the test above proves the next attempt is classified OPERATIONAL, not
  // PRACTICE. But `reserveExposure` computed its OWN `prior_exposure_count` field from the
  // unfiltered prior rows, so the abandoned row was durably recorded as one prior exposure on the
  // very next reservation for this exact form -- a fact baked into the ledger forever, not
  // recomputed later, and disagreeing with the classification of the administration it sits on.
  const { createExposureLedger, reserveExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"33".repeat(32)}`;
  const abandoned = reserveExposure(createExposureLedger(), {
    form_id: "aos-operational-abandoned-count", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-abandoned-count-1", run_id: "run-abandoned-count-1", occurred_at: "2026-09-06T10:00:00.000Z"
  });
  assert.equal(abandoned.entry.state, "RESERVED");
  assert.equal(abandoned.entry.content_revealed, false);

  const next = reserveExposure(abandoned.ledger, {
    form_id: "aos-operational-abandoned-count", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-abandoned-count-2", run_id: "run-abandoned-count-2", occurred_at: "2026-09-06T10:00:05.000Z"
  });
  assert.equal(next.entry.prior_exposure_count, 0, "an abandoned reservation was counted as prior exposure on the next reservation");
  assert.equal(next.entry.prior_same_form_id_count, 0, "an abandoned reservation is not same-form exposure");

  // The same bug's fifth site: `recordExposure`'s direct, one-shot append path (no reservation)
  // computed the same field from the same unfiltered rows.
  const { recordExposure } = await import("../../lib/form-class.mjs");
  const bareAppended = recordExposure(abandoned.ledger, {
    form_id: "aos-operational-abandoned-count", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: "2026-09-06T10:00:10.000Z", run_id: "run-abandoned-count-3"
  });
  assert.equal(bareAppended.entry.prior_exposure_count, 0, "an abandoned reservation was counted as prior exposure on a bare-appended entry");
  assert.equal(bareAppended.entry.prior_same_form_id_count, 0, "a bare append must use the same exposure history as a reservation");
});

test("an administration revealed but never finalized is exposure a later attempt cannot read as fresh", async () => {
  const { classifyAdministration, createExposureLedger, markRevealed, recordExposure, reserveExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"11".repeat(32)}`;
  const reserved = reserveExposure(createExposureLedger(), {
    form_id: "aos-operational-crash", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-crash-1", run_id: "run-crash-1", occurred_at: "2026-09-06T10:00:00.000Z"
  });
  assert.equal(reserved.entry.state, "RESERVED");
  assert.equal(reserved.entry.content_revealed, false);

  // The reveal transition -- the agent has now seen the form -- with no terminal ever written after
  // it. This is the crash simulated in-process: the process that revealed this form never reached
  // `recordExposure`.
  const revealed = markRevealed(reserved.ledger, { administration_id: "admin-crash-1", occurred_at: "2026-09-06T10:00:05.000Z" });
  assert.equal(revealed.entry.state, "REVEALED");
  assert.equal(revealed.entry.content_revealed, true);

  // A second, independent administration attempt of the exact same form_contract_digest -- the
  // "just run it again" a naive recovery would try after the crash -- must not read as fresh.
  const secondAttempt = classifyAdministration(revealed.ledger, {
    form_id: "aos-operational-crash", form_contract_digest: digest, declared_class: "OPERATIONAL"
  });
  assert.equal(secondAttempt.administered_class, "PRACTICE", "a revealed-but-unfinished administration was classified a fresh OPERATIONAL one");
  assert.equal(secondAttempt.official_scoring_permitted, false);
  assert.equal(secondAttempt.refusal_code, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL");
  assert.ok(secondAttempt.reasons[0].includes("admin-crash-1"), "the refusal does not name the administration that revealed the form");

  // Counterfactual: once the first administration actually reaches TERMINAL, the refusal reverts to
  // the ordinary already-exposed code, not the crash-shaped one -- proving the two are genuinely
  // distinct answers and not one message covering both cases.
  const terminal = recordExposure(revealed.ledger, {
    form_id: "aos-operational-crash", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-crash-1", occurred_at: "2026-09-06T10:05:00.000Z", scored: true
  });
  const thirdAttempt = classifyAdministration(terminal.ledger, {
    form_id: "aos-operational-crash", form_contract_digest: digest, declared_class: "OPERATIONAL"
  });
  assert.equal(thirdAttempt.refusal_code, "AOS_FORM_ALREADY_EXPOSED");
});

test("a terminal exposure requires a committed reveal transition", async () => {
  const { createExposureLedger, markRevealed, openExposureLedger, recordExposure, reserveExposure } = await import("../../lib/form-class.mjs");
  const form = { form_id: "reveal-required", form_contract_digest: `sha256:${"dd".repeat(32)}`, declared_class: "OPERATIONAL", administration_id: "reveal-required" };
  const reserved = reserveExposure(createExposureLedger(), { ...form, occurred_at: "2026-01-01T00:00:00.000Z" });
  const terminalInput = { ...form, occurred_at: "2026-01-01T00:00:02.000Z" };
  assert.throws(() => recordExposure(reserved.ledger, terminalInput), /AOS_EXPOSURE_NOT_REVEALED/, "RESERVED must not finalize without a reveal");
  assert.equal(reserved.entry.revealed_at, null);
  const revealed = markRevealed(reserved.ledger, { administration_id: form.administration_id, occurred_at: "2026-01-01T00:00:01.000Z" });
  const terminal = recordExposure(revealed.ledger, terminalInput);
  assert.equal(openExposureLedger(terminal.ledger).entries[0].revealed_at, revealed.entry.revealed_at);
  assert.equal(terminal.entry.content_revealed, true);
});

test("opening a chained terminal exposure requires reveal evidence", async () => {
  const { createExposureLedger, markRevealed, openExposureLedger, recordExposure, reserveExposure } = await import("../../lib/form-class.mjs");
  const { sha256Value } = await import("../../lib/core.mjs");
  const form = { form_id: "reveal-evidence", form_contract_digest: `sha256:${"de".repeat(32)}`, declared_class: "OPERATIONAL", administration_id: "reveal-evidence" };
  let ledger = reserveExposure(createExposureLedger(), { ...form, occurred_at: "2026-01-01T00:00:00.000Z" }).ledger;
  ledger = markRevealed(ledger, { administration_id: form.administration_id, occurred_at: "2026-01-01T00:00:01.000Z" }).ledger;
  ledger = recordExposure(ledger, { ...form, occurred_at: "2026-01-01T00:00:02.000Z" }).ledger;
  for (const patch of [{ revealed_at: null }, { content_revealed: false }, { terminal_at: null }]) {
    const raw = structuredClone(ledger);
    Object.assign(raw.entries[0], patch);
    const { chain_digest: ignored, ...payload } = raw.entries[0];
    raw.entries[0].chain_digest = `sha256:${sha256Value({ previous_digest: createExposureLedger().head_digest, entry: payload })}`;
    raw.head_digest = raw.entries[0].chain_digest;
    assert.throws(() => openExposureLedger(raw), /AOS_EXPOSURE_ENTRY_CORRUPT/, "terminal reveal evidence must be present even in a coherent chain");
  }
});

test("the terminal transition updates the reserved entry in place; exactly one entry per administration", async () => {
  const { createExposureLedger, markRevealed, recordExposure, reserveExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"22".repeat(32)}`;
  const reserved = reserveExposure(createExposureLedger(), {
    form_id: "aos-operational-once", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-once-1", run_id: "run-once-1", occurred_at: "2026-09-06T09:00:00.000Z"
  });
  assert.equal(reserved.ledger.entries.length, 1);
  const revealed = markRevealed(reserved.ledger, { administration_id: "admin-once-1", occurred_at: "2026-09-06T09:00:01.000Z" });
  assert.equal(revealed.ledger.entries.length, 1, "the reveal transition appended a second entry instead of updating the reservation");
  // A reservation cannot be revealed twice.
  assert.throws(() => markRevealed(revealed.ledger, { administration_id: "admin-once-1", occurred_at: "2026-09-06T09:00:02.000Z" }), /AOS_EXPOSURE_RESERVATION_STATE/);

  const terminal = recordExposure(revealed.ledger, {
    form_id: "aos-operational-once", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-once-1", administered_class: "OPERATIONAL", occasion_id: "occasion-once-1",
    occurred_at: "2026-09-06T09:05:00.000Z", run_id: "run-once-1", cycle_id: "cycle-once-1", scored: true, score: 88, duration_ms: 12000
  });
  assert.equal(terminal.ledger.entries.length, 1, "the terminal transition appended a second entry instead of updating the reservation");
  assert.equal(terminal.entry.state, "TERMINAL");
  assert.equal(terminal.entry.content_revealed, true);
  assert.equal(terminal.entry.administered_class, "OPERATIONAL");
  assert.equal(terminal.entry.scored, true);
  assert.equal(terminal.entry.score, 88);
  assert.equal(terminal.entry.duration_ms, 12000);
  assert.equal(terminal.entry.occasion_id, "occasion-once-1");
  assert.equal(terminal.entry.cycle_id, "cycle-once-1");
  // Facts fixed at reservation time travel unchanged onto the terminal entry: they describe where
  // this administration sat in the ledger's history when it began, not when it finished.
  assert.equal(terminal.entry.sequence_position, reserved.entry.sequence_position);
  assert.equal(terminal.entry.prior_exposure_count, reserved.entry.prior_exposure_count);

  // Reusing the administration id for a second reservation, or finalizing the same one twice, is
  // refused rather than silently accepted as a second write to the same row.
  assert.throws(() => reserveExposure(terminal.ledger, {
    form_id: "aos-operational-once", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-once-1", occurred_at: "2026-09-06T09:06:00.000Z"
  }), /AOS_EXPOSURE_ADMINISTRATION_ID_REUSED/);
  assert.throws(() => recordExposure(terminal.ledger, {
    form_id: "aos-operational-once", form_contract_digest: digest, declared_class: "OPERATIONAL",
    administration_id: "admin-once-1", occurred_at: "2026-09-06T09:07:00.000Z", scored: true
  }), /AOS_EXPOSURE_ALREADY_TERMINAL/);
});

test("a pre-reservation entry with no state field still classifies as a completed prior administration, not an active reservation", async () => {
  const { classifyAdministration, createExposureLedger, openExposureLedger, recordExposure } = await import("../../lib/form-class.mjs");
  const digest = `sha256:${"33".repeat(32)}`;
  // Written the pre-round-2 way: a bare `recordExposure` call, with no `administration_id` and no
  // `state` field on the entry it produces. This is what every entry on disk before this round
  // looked like, and round-2 directive item 5 says it is a completed historical administration --
  // never silently upgraded into a fresh reservation, and never read as one still in flight.
  const { ledger } = recordExposure(createExposureLedger(), {
    form_id: "aos-operational-legacy", form_contract_digest: digest, declared_class: "OPERATIONAL",
    occurred_at: "2026-01-01T00:00:00.000Z", scored: true
  });
  assert.equal(ledger.entries[0].state, undefined, "the fixture drifted from the pre-reservation shape this test means to exercise");
  const opened = openExposureLedger(ledger);
  assert.equal(opened.entries.length, 1, "a legacy entry with no state field was refused rather than read");

  const classification = classifyAdministration(ledger, {
    form_id: "aos-operational-legacy", form_contract_digest: digest, declared_class: "OPERATIONAL"
  });
  assert.equal(classification.administered_class, "PRACTICE");
  assert.equal(classification.official_scoring_permitted, false);
  // The ordinary already-exposed code, never the crash-shaped one: a missing `state` is a completed
  // administration, not one caught mid-reservation.
  assert.equal(classification.refusal_code, "AOS_FORM_ALREADY_EXPOSED");
  assert.notEqual(classification.refusal_code, "AOS_FORM_EXPOSED_WITHOUT_TERMINAL");
});

test("the reserved exposure entry exists on disk before prepareScenario reveals any scenario content", async () => {
  const { existsSync, mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { addAgent, assessAtATerminal, makePlan, run } = await import("./helpers.mjs");
  const { runPaths } = await import("../../lib/store.mjs");
  const { exposureLedgerTestHooks } = await import("../../lib/cli.mjs");

  const cwd = mkdtempSync(join(tmpdir(), "aos-reserve-before-reveal-"));
  const home = join(cwd, ".aos");
  const ledgerFile = join(home, "exposure-ledger.json");
  const observed = { reserve: null, reveal: null };
  try {
    run(cwd, ["init"]);
    addAgent(cwd, "solo");
    const plan = makePlan(cwd, { default: "solo" });

    // The test-only hook `lib/cli.mjs` exports for exactly this: it fires synchronously, in this
    // same process, right after each ledger transition is written, so the callback can read the
    // ledger file straight off disk -- an actual observation of what is durable at that instant,
    // not a claim about program order taken on the diff's word.
    exposureLedgerTestHooks.afterReserve = ({ runId }) => {
      const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
      const fam1 = join(runPaths(home, runId).workspaces, "FAM-1");
      observed.reserve = { runId, ledger, fam1TaskFileExists: existsSync(join(fam1, "task.md")) };
    };
    exposureLedgerTestHooks.afterReveal = ({ runId, workspace }) => {
      const ledger = JSON.parse(readFileSync(ledgerFile, "utf8"));
      observed.reveal = { runId, ledger, fam1TaskFileExists: existsSync(join(workspace, "task.md")) };
    };

    await assessAtATerminal(cwd, ["assess", "--plan", plan, "--seed", "00000000000000a1"], { env: {} });
  } finally {
    exposureLedgerTestHooks.afterReserve = null;
    exposureLedgerTestHooks.afterReveal = null;
    rmSync(cwd, { recursive: true, force: true });
  }

  assert.notEqual(observed.reserve, null, "afterReserve never fired; the reservation step did not run");
  assert.notEqual(observed.reveal, null, "afterReveal never fired; the reveal transition did not run");

  const reserveEntry = observed.reserve.ledger.entries.find((entry) => entry.administration_id === observed.reserve.runId);
  assert.ok(reserveEntry, "no reserved entry for this administration existed on disk when prepareScenario was about to reveal it");
  assert.equal(reserveEntry.state, "RESERVED");
  assert.equal(reserveEntry.content_revealed, false);
  // The actual observation for I2: FAM-1's scenario file does not exist on disk yet at the moment
  // the reservation is already durable on disk.
  assert.equal(observed.reserve.fam1TaskFileExists, false, "prepareScenario had already revealed FAM-1's scenario before the reservation was written");

  const revealEntry = observed.reveal.ledger.entries.find((entry) => entry.administration_id === observed.reveal.runId);
  assert.ok(revealEntry, "no entry for this administration existed on disk at the reveal transition");
  assert.equal(revealEntry.state, "REVEALED");
  assert.equal(revealEntry.content_revealed, true);
  // #585 round 4, governing directive 16: FAM-1's scenario file must NOT exist yet at the moment
  // the reveal transition becomes durable. Round 2 committed REVEALED right after prepareScenario
  // ran, so this observation used to be true and this assertion asserted that ordering; that was
  // the defect item 1 describes -- a kill between prepareScenario's write and the reveal commit
  // left content on disk under a row `isAbandonedReservation` still read as fresh and reusable.
  // Marking revealed first can only ever cost one spent form on an unlucky kill in between, which
  // is the trade the directive accepts, so the file must still be absent here.
  assert.equal(observed.reveal.fam1TaskFileExists, false, "prepareScenario had already materialized FAM-1's scenario before the reveal transition became durable");
  assert.equal(revealEntry.administration_id, reserveEntry.administration_id);
  assert.equal(observed.reveal.ledger.entries.length, observed.reserve.ledger.entries.length, "the reveal transition appended a second entry instead of updating the reservation");
});
