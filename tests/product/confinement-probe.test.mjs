import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The Phase-0 evidence for #556 is two files that have to agree: a document a person reads and a
// record a machine reads. Neither one is checked by anything else in the suite, and both of them
// are the kind of artefact that decays quietly -- a backend gets added to the prose, a row gets an
// optimistic verdict typed into it, a probe that was never run keeps the shape of one that was.
//
// The failure this file exists to prevent is specific. A support matrix earns the word OFFICIAL by
// naming a boundary that was measured. A row that says `denied` because nobody looked reads exactly
// like a row that says `denied` because the kernel refused, and the first one is how a lane nobody
// tested ends up carrying a released score. So the rule enforced below is that silence is never
// coverage: an unrun probe is recorded as `not_observed`, it has to say why, and it can never sit
// under a backend the record calls supported.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const RECORD_PATH = join(root, "fixtures", "confinement", "probe.json");
const DOC_PATH = join(root, "docs", "STRICT_CONFINEMENT_FEASIBILITY.md");

const record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
const doc = readFileSync(DOC_PATH, "utf8");

const sha = (text) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");

// The gate fields the issue's issuance rule is written in. `boundary_canary` is a verdict rather
// than a boolean, so it is checked separately; the rest are three-valued -- true, false, or null
// for a backend where nothing was measured.
const BOOLEAN_GATE_FIELDS = [
  "filesystem_enforced",
  "process_enforced",
  "setup_verified",
  "authenticated_runtime",
  "cleanup_verified"
];

/**
 * Every rule the record has to satisfy, returned as a list of complaints rather than thrown one at
 * a time. Written as a function over a parsed record so the negative tests below can feed it a
 * deliberately broken copy: a validator that has only ever seen valid input is not evidence that it
 * would reject invalid input.
 */
const violations = (candidate) => {
  const problems = [];
  const complain = (message) => problems.push(message);

  if (candidate.schema !== "aos-confinement-probe.v1") complain(`unknown schema ${candidate.schema}`);
  if (candidate.code_integration_allowed !== false) complain("the feasibility phase forbids code integration");

  const propertyIds = candidate.properties.map((one) => one.id);
  if (new Set(propertyIds).size !== propertyIds.length) complain("duplicate property id");

  for (const backend of candidate.backends) {
    const where = `backend ${backend.id}`;
    if (!candidate.support_vocabulary.includes(backend.support_status)) {
      complain(`${where}: support_status ${backend.support_status} is outside the vocabulary`);
    }

    const covered = backend.observations.map((one) => one.property);
    if (new Set(covered).size !== covered.length) complain(`${where}: the same property is observed twice`);
    for (const id of propertyIds) {
      if (!covered.includes(id)) complain(`${where}: property ${id} has no observation`);
    }
    for (const id of covered) {
      if (!propertyIds.includes(id)) complain(`${where}: observes ${id}, which is not a declared property`);
    }

    for (const observation of backend.observations) {
      const row = `${where}, ${observation.property}`;
      if (!candidate.outcome_vocabulary.includes(observation.observed)) {
        complain(`${row}: ${observation.observed} is outside the outcome vocabulary`);
      }
      if (observation.observed === "not_observed") {
        // The whole point of the vocabulary. A row nobody ran must carry no command and no
        // enforcement, and must say why -- otherwise it is indistinguishable from a measured pass.
        if (observation.command !== null) complain(`${row}: not_observed but names a command`);
        if (observation.enforcement !== null) complain(`${row}: not_observed but claims enforcement`);
        if (!observation.reason) complain(`${row}: not_observed without a reason`);
      } else {
        if (!observation.command) complain(`${row}: ${observation.observed} without the command that produced it`);
        if (!observation.probe) complain(`${row}: ${observation.observed} without the probe that produced it`);
        if (!candidate.enforcement_vocabulary.includes(observation.enforcement)) {
          complain(`${row}: enforcement ${observation.enforcement} is outside the vocabulary`);
        }
      }
      if (observation.observed === "denied" && observation.enforcement === "none") {
        // Something refused it, and the record has to say what. "Denied by nothing" is the shape a
        // moved path takes when it is written up as a boundary.
        complain(`${row}: denied but nothing is named as enforcing it`);
      }
    }

    const gate = backend.strict_gate;
    for (const field of BOOLEAN_GATE_FIELDS) {
      if (!(field in gate)) complain(`${where}: issuance gate is missing ${field}`);
      const value = gate[field];
      if (value !== true && value !== false && value !== null) complain(`${where}: gate ${field} is ${value}`);
    }
    for (const field of backend.blocking_gate_fields) {
      if (!(field in gate)) complain(`${where}: blocks on ${field}, which is not a gate field`);
    }

    const supported = candidate.supported_release_set.includes(backend.support_status);
    if (supported) {
      for (const field of BOOLEAN_GATE_FIELDS) {
        if (gate[field] !== true) complain(`${where}: called ${backend.support_status} with ${field}=${gate[field]}`);
      }
      if (gate.boundary_canary !== "PASS") {
        complain(`${where}: called ${backend.support_status} with boundary_canary=${gate.boundary_canary}`);
      }
      const unmeasured = backend.observations.filter((one) => one.observed === "not_observed");
      if (unmeasured.length > 0) {
        complain(`${where}: called ${backend.support_status} with ${unmeasured.length} unobserved properties`);
      }
      if (backend.blocking_gate_fields.length > 0) {
        complain(`${where}: called ${backend.support_status} while naming blocking gate fields`);
      }
    } else if (backend.support_status === "BLOCKED" && backend.blocking_gate_fields.length === 0) {
      complain(`${where}: BLOCKED without naming what blocks it`);
    }
  }

  const stated = candidate.evidence_digest;
  const recomputed = sha(JSON.stringify({
    host: candidate.host,
    properties: candidate.properties,
    backends: candidate.backends
  }));
  if (stated !== recomputed) complain(`evidence_digest ${stated} does not describe this record`);

  return problems;
};

// A structured clone, so a negative test can break one field without the mutation leaking into the
// tests that run after it.
const copy = () => JSON.parse(JSON.stringify(record));

test("the confinement probe record parses and satisfies every rule it declares", () => {
  assert.deepEqual(violations(record), []);
});

test("the record covers every backend the feasibility document claims, and no others", () => {
  const matrix = doc.slice(doc.indexOf("\n## Matrix"));
  const documented = [...matrix.matchAll(/^### (\S+)$/gm)].map((match) => match[1]);
  assert.ok(documented.length > 0, "the document has no backend sections");
  assert.deepEqual(
    documented.slice().sort(),
    record.backends.map((one) => one.id).sort(),
    "the document and the record disagree about which backends were probed"
  );
});

test("the document states the digest of the record it describes", () => {
  assert.ok(
    doc.includes(record.evidence_digest),
    "the document does not carry the record's evidence digest, so the two can drift apart unnoticed"
  );
});

test("the sandbox profiles printed in the document are the ones the record digested", () => {
  const printed = [...doc.matchAll(/```scheme\n([\s\S]*?)```/g)].map((match) => sha(match[1].trimEnd() + "\n"));
  assert.equal(printed.length, 2, "expected the two macOS profiles to be printed in full");
  const digested = record.backends
    .filter((one) => one.policy_digest !== null)
    .map((one) => one.policy_digest);
  assert.equal(digested.length, 2);
  for (const digest of digested) {
    assert.ok(
      printed.includes(digest),
      `policy_digest ${digest} matches no profile printed in the document`
    );
  }
});

test("no backend is called supported on this stack", () => {
  // Not a style rule. The issue's completion condition needs one real runtime lane, and Phase 0
  // found none; if a later edit promotes a backend here without new observations behind it, this is
  // the line that says so.
  const supported = record.backends.filter((one) => record.supported_release_set.includes(one.support_status));
  assert.deepEqual(supported.map((one) => one.id), []);
});

test("an unrun probe recorded as a pass is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "linux-bubblewrap");
  const row = backend.observations.find((one) => one.property === "read_workspace_parent");
  row.observed = "denied";
  row.reason = undefined;
  delete row.reason;
  const problems = violations(broken);
  assert.ok(
    problems.some((one) => one.includes("without the command that produced it")),
    `expected a missing-command complaint, got ${JSON.stringify(problems)}`
  );
});

test("a denial with nothing named as enforcing it is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "macos-seatbelt-deny-default");
  backend.observations.find((one) => one.property === "read_operator_home_absolute").enforcement = "none";
  assert.ok(violations(broken).some((one) => one.includes("nothing is named as enforcing it")));
});

test("a backend that drops a property is rejected rather than silently under-covered", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "macos-seatbelt-provider-lane");
  backend.observations = backend.observations.filter((one) => one.property !== "escape_via_symlink");
  assert.ok(violations(broken).some((one) => one.includes("escape_via_symlink has no observation")));
});

test("a supported verdict over an unobserved backend is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "linux-bubblewrap");
  backend.support_status = "SUPPORTED";
  const problems = violations(broken);
  assert.ok(problems.some((one) => one.includes("unobserved properties")));
  assert.ok(problems.some((one) => one.includes("filesystem_enforced=null")));
});

test("a supported verdict over a failed boundary canary is rejected", () => {
  const broken = copy();
  const backend = broken.backends.find((one) => one.id === "macos-seatbelt-provider-lane");
  backend.support_status = "SUPPORTED_WITH_CONSTRAINTS";
  const problems = violations(broken);
  assert.ok(problems.some((one) => one.includes("boundary_canary=FAIL")));
  assert.ok(problems.some((one) => one.includes("process_enforced=false")));
});

test("an edited record whose digest was not recomputed is rejected", () => {
  const broken = copy();
  broken.backends.find((one) => one.id === "best-effort-cli").strict_gate.filesystem_enforced = true;
  assert.ok(violations(broken).some((one) => one.includes("does not describe this record")));
});

test("the record still says the feasibility phase forbade code integration", () => {
  // The phase this evidence was produced under. If a later change flips it, the artefact is being
  // reused to stand for work it did not cover.
  assert.equal(record.issue, 556);
  assert.equal(record.phase, "feasibility-proof");
  assert.equal(record.code_integration_allowed, false);
});
