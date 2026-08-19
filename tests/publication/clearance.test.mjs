import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const DECISION_PATH = "docs/decisions/PUBLICATION-CLEARANCE.md";
const LEGAL_PATH = "docs/clearance/PUBLICATION-LEGAL-CLEARANCE.md";
const LICENSE_PATH = "LICENSE";
const NOTICES_PATH = "THIRD_PARTY_NOTICES.md";
const SECURITY_PATH = "SECURITY.md";
const NAME_CLEARANCE_PATH = "docs/clearance/MINIMUM-NAME-CLEARANCE.md";
const CONTRIBUTING_PATH = "CONTRIBUTING.md";

// The E14/G4 requirement set this ticket must resolve or block on. Held here rather than read
// from the record under test, so a record that simply drops a requirement cannot make itself
// complete.
const REQUIRED_IDS = [
  "contributor_terms",
  "formal_publication_review",
  "license",
  "redistribution",
  "security_policy",
  "third_party_notices"
];
const REQUIREMENT_KEYS = ["artifact", "evidence", "id", "reason", "status", "title"];
const CLEARANCE_STATUSES = ["CONFLICT", "RESOLVED", "UNRESOLVED"];
const REVIEW_KEYS = ["limits", "query", "result", "reviewed_at", "source", "status"];

// The whole point of the ticket in one function: any requirement that is not RESOLVED blocks
// publication, redistribution, and external contribution acceptance. Nothing here reads the
// document's own verdict, so a document that asserts CLEARED while an item is open disagrees
// with this derivation and fails.
const derivePublicationVerdict = (requirements) => {
  const blockedBy = requirements
    .filter(({ status }) => status !== "RESOLVED")
    .map(({ id }) => id)
    .sort();
  const cleared = blockedBy.length === 0;
  return {
    verdict: cleared ? "CLEARED" : "BLOCKED",
    blocked_by: blockedBy,
    permits_publication: cleared,
    permits_redistribution: cleared,
    permits_external_contribution_acceptance: cleared
  };
};

const readOwnedDocument = (relativePath) => {
  const absolute = resolve(repositoryRoot, relativePath);
  let entry;
  try {
    entry = lstatSync(absolute);
  } catch {
    assert.fail(`E14-001 owned document is absent: ${relativePath}`);
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    assert.fail(`E14-001 owned document is not a regular file: ${relativePath}`);
  }
  const text = readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
  assert.ok(text.trim().length > 0, `E14-001 owned document is empty: ${relativePath}`);
  return text;
};

const readRepositoryJson = (relativePath) =>
  JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));

// `## Heading` immediately followed by one fenced JSON block. Same shape the D0 name-clearance
// record already uses, so a reader learns one format for both.
const parseRecordBlocks = (text, label) => {
  const matches = [...text.matchAll(/^## (?<heading>.+)\n\n```json\n(?<json>[\s\S]*?)\n```/gm)];
  assert.ok(matches.length > 0, `${label} declares no machine-readable record`);
  const records = matches.map(({ groups }) => {
    let record;
    try {
      record = JSON.parse(groups.json);
    } catch {
      assert.fail(`${label} record under "${groups.heading}" is not valid JSON`);
    }
    return { heading: groups.heading, record };
  });
  const headings = records.map(({ heading }) => heading);
  assert.equal(new Set(headings).size, headings.length, `${label} repeats a record heading`);
  return new Map(records.map(({ heading, record }) => [heading, record]));
};

const loadDecision = () => {
  const text = readOwnedDocument(DECISION_PATH);
  const blocks = parseRecordBlocks(text, DECISION_PATH);
  const ledger = blocks.get("Requirement ledger");
  assert.ok(ledger, `${DECISION_PATH} has no "Requirement ledger" record`);
  assert.ok(Array.isArray(ledger.requirements), `${DECISION_PATH} ledger has no requirements array`);
  const byId = new Map(ledger.requirements.map((requirement) => [requirement.id, requirement]));
  return { text, blocks, ledger, requirements: ledger.requirements, byId };
};

const loadLegalReview = () => {
  const text = readOwnedDocument(LEGAL_PATH);
  return { text, blocks: parseRecordBlocks(text, LEGAL_PATH) };
};

// A requirement and the observation it cites must agree. A ledger entry that points at a review
// record with a different status is the exact drift this pairing exists to catch.
const assertRequirement = ({ byId }, legal, id, expectedStatus, expectedArtifact) => {
  const requirement = byId.get(id);
  assert.ok(requirement, `${DECISION_PATH} ledger omits requirement ${id}`);
  assert.deepEqual(Object.keys(requirement).sort(), REQUIREMENT_KEYS, `requirement ${id} keys`);
  assert.ok(CLEARANCE_STATUSES.includes(requirement.status), `requirement ${id} status ${requirement.status}`);
  assert.equal(requirement.status, expectedStatus, `requirement ${id} status`);
  assert.equal(requirement.artifact, expectedArtifact, `requirement ${id} artifact`);
  assert.ok(
    existsSync(resolve(repositoryRoot, requirement.artifact)),
    `requirement ${id} names an artifact that does not exist: ${requirement.artifact}`
  );
  assert.ok(typeof requirement.reason === "string" && requirement.reason.length > 0, `requirement ${id} reason`);
  const review = legal.blocks.get(requirement.evidence);
  assert.ok(review, `${LEGAL_PATH} has no review record "${requirement.evidence}" cited by requirement ${id}`);
  assert.deepEqual(Object.keys(review).sort(), REVIEW_KEYS, `review "${requirement.evidence}" keys`);
  for (const field of ["source", "query", "result", "limits"]) {
    assert.ok(typeof review[field] === "string" && review[field].length > 0, `review "${requirement.evidence}" ${field}`);
  }
  assert.match(review.reviewed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, `review "${requirement.evidence}" reviewed_at`);
  assert.equal(review.status, requirement.status, `review "${requirement.evidence}" status disagrees with requirement ${id}`);
  return requirement;
};

test("license", () => {
  const license = readOwnedDocument(LICENSE_PATH);
  const decision = loadDecision();
  const legal = loadLegalReview();

  assert.match(
    license,
    /^Copyright \(c\) \d{4} the maintainers of MongLong0214\/agent-operator-score\.$/m,
    "LICENSE does not name a copyright holder grounded in the repository of record"
  );
  assert.ok(
    license.includes("No open-source license has been granted for this repository."),
    "LICENSE does not state the outbound grant status"
  );
  assert.ok(
    license.includes("All rights are reserved by the copyright holder."),
    "LICENSE does not state the reserved-rights default"
  );
  assert.ok(license.includes(DECISION_PATH), "LICENSE does not point at the clearance decision record");

  // Forbidden scope: choosing a license without review. A grant that appears here without the
  // ledger recording a reviewed selection is exactly that.
  for (const grant of [
    /Permission is hereby granted, free of charge/,
    /Licensed under the Apache License/,
    /GNU GENERAL PUBLIC LICENSE/,
    /Mozilla Public License/,
    /Redistribution and use in source and binary forms/
  ]) {
    assert.doesNotMatch(license, grant, "LICENSE carries an open-source grant that no reviewed selection authorizes");
  }

  assertRequirement(decision, legal, "license", "UNRESOLVED", LICENSE_PATH);
});

test("contributor", () => {
  const decision = loadDecision();
  const legal = loadLegalReview();
  const requirement = assertRequirement(decision, legal, "contributor_terms", "UNRESOLVED", CONTRIBUTING_PATH);

  const redistribution = decision.blocks.get("Redistribution conditions");
  assert.ok(redistribution, `${DECISION_PATH} has no "Redistribution conditions" record`);
  assert.equal(
    redistribution.permits?.external_contribution_acceptance,
    false,
    "contributor terms are unresolved yet the record permits external contribution acceptance"
  );

  // The contributor-facing document must still refuse acceptance while this requirement is open.
  // CONTRIBUTING.md is owned elsewhere; this reads it and never edits it.
  const contributing = readFileSync(resolve(repositoryRoot, CONTRIBUTING_PATH), "utf8");
  assert.ok(
    contributing.includes(
      "Contribution acceptance and redistribution remain blocked until the E14/G4 LICENSE and publication gate clears."
    ),
    "CONTRIBUTING.md no longer refuses contribution acceptance while contributor terms are unresolved"
  );
  assert.match(requirement.reason, /\S/);
});

test("notices", () => {
  const notices = readOwnedDocument(NOTICES_PATH);
  const decision = loadDecision();
  const legal = loadLegalReview();
  const blocks = parseRecordBlocks(notices, NOTICES_PATH);

  const packages = blocks.get("Redistributed third-party packages");
  assert.ok(packages, `${NOTICES_PATH} has no "Redistributed third-party packages" record`);
  assert.equal(packages.derived_from, "package-lock.json", "notices do not name the enumeration source");

  // Re-derive the enumeration instead of trusting it. Every lock entry must be the root, a local
  // workspace with a manifest, or a link to one; anything else is an external package that the
  // notices file has to name.
  const lock = readRepositoryJson("package-lock.json");
  const entries = Object.entries(lock.packages ?? {});
  assert.ok(entries.length > 0, "package-lock.json declares no packages");
  const external = entries
    .filter(([key, value]) => key.startsWith("node_modules/") && value?.link !== true)
    .map(([key]) => key.slice("node_modules/".length))
    .sort();
  for (const [key] of entries) {
    if (key === "" || key.startsWith("node_modules/")) continue;
    assert.ok(
      existsSync(resolve(repositoryRoot, key, "package.json")),
      `package-lock.json declares ${key} as a workspace but it carries no manifest`
    );
  }
  assert.deepEqual(
    [...(packages.packages ?? [])].sort(),
    external,
    "third-party notices disagree with the packages package-lock.json actually declares"
  );

  const runtime = blocks.get("External runtime requirements");
  assert.ok(runtime, `${NOTICES_PATH} has no "External runtime requirements" record`);
  const manifest = readRepositoryJson("package.json");
  assert.deepEqual(
    runtime.requirements,
    [
      {
        component: "Node.js",
        range: manifest.engines.node,
        redistributed: false,
        source: "package.json engines.node"
      }
    ],
    "the declared runtime requirement does not match the engine range this repository declares"
  );
  assert.ok(
    notices.includes(
      "Node.js is required at runtime and is not vendored or redistributed by this repository; its own license terms are not restated here."
    ),
    "notices do not state the limit of the runtime entry"
  );

  assertRequirement(decision, legal, "third_party_notices", "RESOLVED", NOTICES_PATH);
});

test("security", () => {
  const security = readOwnedDocument(SECURITY_PATH);
  const decision = loadDecision();
  const legal = loadLegalReview();

  assert.ok(
    security.includes("https://github.com/MongLong0214/agent-operator-score/security/advisories/new"),
    "SECURITY.md names no private reporting channel"
  );
  assert.ok(
    security.includes("Do not open a public issue for a suspected vulnerability."),
    "SECURITY.md does not refuse public disclosure as the reporting path"
  );
  assert.ok(
    security.includes("This policy is not a security assurance, audit result, or certification."),
    "SECURITY.md does not bound its own claim"
  );
  assert.ok(
    security.includes(
      "Whether private vulnerability reporting is enabled on this repository is a platform setting and is not observable from the tree."
    ),
    "SECURITY.md does not record the limit of its reporting channel"
  );

  assertRequirement(decision, legal, "security_policy", "RESOLVED", SECURITY_PATH);
});

test("license-contribution-redistribution", () => {
  const decision = loadDecision();
  const legal = loadLegalReview();
  const license = readOwnedDocument(LICENSE_PATH);

  for (const id of ["license", "contributor_terms", "redistribution"]) {
    assert.ok(decision.byId.has(id), `${DECISION_PATH} ledger omits requirement ${id}`);
  }
  assertRequirement(decision, legal, "redistribution", "UNRESOLVED", DECISION_PATH);

  const redistribution = decision.blocks.get("Redistribution conditions");
  assert.ok(redistribution, `${DECISION_PATH} has no "Redistribution conditions" record`);
  assert.equal(redistribution.granted, false, "redistribution is granted while its conditions are unresolved");
  assert.ok(
    Array.isArray(redistribution.conditions) && redistribution.conditions.length > 0,
    "redistribution conditions are not defined"
  );
  for (const condition of redistribution.conditions) {
    assert.ok(typeof condition === "string" && condition.length > 0, "a redistribution condition is not stated");
  }
  assert.deepEqual(
    redistribution.permits,
    {
      redistribution: false,
      external_contribution_acceptance: false,
      npm_publication: false,
      public_visibility_change: false
    },
    "the redistribution record permits something its unresolved conditions do not authorize"
  );

  assert.ok(
    license.includes(
      "Until that record reports a CLEARED verdict, redistribution and external contribution acceptance are refused."
    ),
    "LICENSE does not carry the joint refusal the unresolved requirements imply"
  );

  // The conjunction must propagate: one unresolved member of the trio is enough to block, and it
  // must be the member that is named.
  const resolvedAll = decision.requirements.map((requirement) => ({ ...requirement, status: "RESOLVED" }));
  for (const id of ["license", "contributor_terms", "redistribution"]) {
    const oneOpen = resolvedAll.map((requirement) =>
      requirement.id === id ? { ...requirement, status: "UNRESOLVED" } : requirement);
    assert.deepEqual(derivePublicationVerdict(oneOpen), {
      verdict: "BLOCKED",
      blocked_by: [id],
      permits_publication: false,
      permits_redistribution: false,
      permits_external_contribution_acceptance: false
    }, `an unresolved ${id} did not block on its own`);
  }
});

test("unresolved-block", () => {
  const decision = loadDecision();
  const legal = loadLegalReview();

  assert.deepEqual(
    decision.requirements.map(({ id }) => id).sort(),
    REQUIRED_IDS,
    "the requirement ledger does not enumerate the E14/G4 requirement set exactly"
  );
  for (const requirement of decision.requirements) {
    assert.ok(
      CLEARANCE_STATUSES.includes(requirement.status),
      `requirement ${requirement.id} carries status ${requirement.status}`
    );
    const review = legal.blocks.get(requirement.evidence);
    assert.ok(review, `${LEGAL_PATH} has no review record "${requirement.evidence}"`);
    assert.equal(review.status, requirement.status, `review "${requirement.evidence}" disagrees with requirement ${requirement.id}`);
  }

  // The formal review is the claim that would be easiest to fake, so it is pinned as open and
  // required to say why.
  const formal = decision.byId.get("formal_publication_review");
  assert.ok(formal, `${DECISION_PATH} ledger omits requirement formal_publication_review`);
  assert.equal(formal.status, "UNRESOLVED", "a formal publication and legal review is claimed as resolved");
  assert.match(
    legal.blocks.get(formal.evidence).result,
    /not performed/,
    "the formal-review record does not state that no review was performed"
  );

  const recorded = decision.blocks.get("Derived verdict");
  assert.ok(recorded, `${DECISION_PATH} has no "Derived verdict" record`);
  assert.deepEqual(
    recorded,
    derivePublicationVerdict(decision.requirements),
    "the recorded verdict is not the one this requirement ledger derives"
  );
  assert.equal(recorded.verdict, "BLOCKED", "publication is cleared while E14/G4 requirements are open");
  assert.ok(recorded.blocked_by.length > 0, "a blocking verdict names nothing that blocks it");

  // Selectivity: the derivation is not a constant.
  const allResolved = decision.requirements.map((requirement) => ({ ...requirement, status: "RESOLVED" }));
  assert.deepEqual(derivePublicationVerdict(allResolved), {
    verdict: "CLEARED",
    blocked_by: [],
    permits_publication: true,
    permits_redistribution: true,
    permits_external_contribution_acceptance: true
  }, "a fully resolved ledger still blocks, so the verdict carries no information");
  assert.equal(
    derivePublicationVerdict(allResolved.map((requirement, index) =>
      index === 0 ? { ...requirement, status: "CONFLICT" } : requirement)).verdict,
    "BLOCKED",
    "a CONFLICT does not block"
  );

  // D0 minimum name clearance is an input by reference, never repeated here.
  assert.equal(
    decision.ledger.name_clearance_reference,
    NAME_CLEARANCE_PATH,
    "the decision does not cite the canonical-identity clearance it depends on"
  );
  const nameClearance = readFileSync(resolve(repositoryRoot, NAME_CLEARANCE_PATH), "utf8");
  const nameSources = [...nameClearance.matchAll(/^## .+\n\n```json\n([\s\S]*?)\n```/gm)]
    .map(([, json]) => JSON.parse(json).source);
  assert.equal(nameSources.length, 4, "the canonical-identity clearance no longer carries four records");
  for (const source of nameSources) {
    assert.ok(!decision.text.includes(source), `${DECISION_PATH} repeats the D0 clearance source: ${source}`);
    assert.ok(!legal.text.includes(source), `${LEGAL_PATH} repeats the D0 clearance source: ${source}`);
  }
  assert.ok(
    legal.text.includes("This record does not repeat the D0 minimum name clearance and does not substitute for it."),
    `${LEGAL_PATH} does not disclaim repeating the D0 clearance`
  );
});
