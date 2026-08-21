import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { G0_DIGEST_MANIFEST } from "../../scripts/verify-g0.mjs";

// Namespace/dynamic import: a missing module or named export must stay undefined
// so each case can fail with its pinned message. A static named import would be a
// module-load error, which the RED contract treats as an unrelated stop.
const loadGate = async () => {
  try {
    return await import("../../scripts/verify-release.mjs");
  } catch {
    return {};
  }
};

const PINNED =
  "no independent environment has reproduced exact public fixture bytes.";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const VERDICT_PATH = "docs/decisions/G4-VERDICT.md";
const CLEARANCE_PATH = "docs/decisions/PUBLICATION-CLEARANCE.md";
const FEASIBILITY_PATH = "docs/decisions/FEASIBILITY-VERDICT.md";
const SCHEMA_PIN_PATH = "specs/aos-result.schema.json";
const VERIFIER = { id: "verifier-host" };
const INDEPENDENT = { id: "independent-host", os: "linux", arch: "x64" };
const NAMED_HOST_A = "named-host-A";
const NAMED_HOST_B = "named-host-B";
const CLI_REPRODUCTION_PATH = "reproduction.json";
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STALE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST_SHAPE = /^[a-f0-9]{64}$/;
const ZERO_DIGEST = "0".repeat(64);

type Json = Record<string, unknown>;
type DigestEntry = { path: string; bytes_sha256: string };
type GateResult = {
  ok?: boolean;
  verdict?: string | null;
  errors?: string[];
  reproduction?: {
    independent?: boolean;
    signature_ok?: boolean;
    bytes_ok?: boolean;
    head_ok?: boolean;
  };
  gates?: Record<string, string>;
  permits_publication?: boolean;
};
type CanonicalJsonBytes = (value: unknown) => string;
type RunG4Gate = (input?: Json) => GateResult;

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const readRepositoryFile = (path: string) => readFileSync(resolve(root, path), "utf8");

const has = (result: GateResult | undefined, needle: string) =>
  Boolean(result?.errors?.some((entry) => typeof entry === "string" && entry.includes(needle)));

const assertExported = (value: unknown, message: string) =>
  assert.equal(typeof value, "function", message);

const pinnedOutputDigests = (): DigestEntry[] =>
  (G0_DIGEST_MANIFEST as DigestEntry[]).map((entry) => ({
    path: entry.path,
    bytes_sha256: entry.bytes_sha256
  }));

const schemaPin = () => {
  const entry = pinnedOutputDigests().find((item) => item.path === SCHEMA_PIN_PATH);
  assert.ok(entry, `${SCHEMA_PIN_PATH} is missing from the G0 pin`);
  return entry;
};

const allResolvedPublication = () => [
  { id: "contributor_terms", status: "RESOLVED" },
  { id: "formal_publication_review", status: "RESOLVED" },
  { id: "license", status: "RESOLVED" },
  { id: "redistribution", status: "RESOLVED" },
  { id: "security_policy", status: "RESOLVED" },
  { id: "third_party_notices", status: "RESOLVED" }
];

const resolvedGates = () => ({ G0: "RESOLVED", G1: "RESOLVED", G2: "RESOLVED", G3: "RESOLVED" });
const E12_CONTINUE = "PASS_TO_CONTINUE";
const E12_INCONCLUSIVE = "INCONCLUSIVE";
const E12_PIVOT = "PIVOT_REQUIRED";
const E12_FORBIDDEN_RESOLVED = "RESOLVED";

const parseRecordBlocks = (text: string) => {
  const matches = [...text.matchAll(/^## (?<heading>.+)\n\n```json\n(?<json>[\s\S]*?)\n```/gm)];
  return new Map(
    matches.map(({ groups }) => [groups!.heading, JSON.parse(groups!.json) as Json])
  );
};

const upsertRecordBlock = (text: string, heading: string, record: Json) => {
  const block = `## ${heading}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
  const pattern = new RegExp(`## ${heading}\\n\\n\`\`\`json\\n[\\s\\S]*?\\n\`\`\``);
  return pattern.test(text) ? text.replace(pattern, block) : `${text.trimEnd()}\n\n${block}\n`;
};

const signBody = (
  canonicalJsonBytes: CanonicalJsonBytes,
  body: Json,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]
) => {
  const signature = sign(null, Buffer.from(canonicalJsonBytes(body)), privateKey).toString("base64");
  return { ...body, signature };
};

const makeIndependentReproduction = (
  canonicalJsonBytes: CanonicalJsonBytes,
  overrides: Json = {}
) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const output_digests = (overrides.output_digests as DigestEntry[] | undefined) ?? pinnedOutputDigests();
  const environment = (asObject(overrides.environment) ?? INDEPENDENT) as Json;
  const body: Json = {
    version: 1,
    kind: typeof overrides.kind === "string" ? overrides.kind : "independent-reproduction",
    environment,
    toolchain: asObject(overrides.toolchain) ?? {
      node: "22.18.0",
      engines: ">=22.18 <25"
    },
    head_sha: typeof overrides.head_sha === "string" ? overrides.head_sha : HEAD,
    output_digests,
    public_key: publicKey.export({ type: "spki", format: "der" }).toString("base64")
  };
  return signBody(canonicalJsonBytes, body, privateKey);
};

// Comparator input only. Must not carry a caller-minted publication ledger, G1–G3
// status, or G0 stub. G1 is the E12 feasibility record; G2 and G3 are deferred
// calibration studies the n=20 record cannot close; G0 is runG0Gate.
const completeInput = (canonicalJsonBytes: CanonicalJsonBytes, overrides: Json = {}) => ({
  localEnvironment: VERIFIER,
  headSha: HEAD,
  reproduction: makeIndependentReproduction(canonicalJsonBytes),
  ...overrides
});

const withVerdictRecords = (records: Record<string, Json>) => {
  let text = readRepositoryFile(VERDICT_PATH);
  for (const [heading, record] of Object.entries(records)) {
    text = upsertRecordBlock(text, heading, record);
  }
  return (path: string) => (path === VERDICT_PATH ? text : readRepositoryFile(path));
};

const withAllowlistedPrincipal = (
  reproduction: Json,
  principalId: string,
  extraFiles: Record<string, string> = {}
) => {
  const trusted = withVerdictRecords({
    "Trusted principals": {
      principals: [{ id: principalId, public_key: reproduction.public_key }]
    }
  });
  return (path: string) => (Object.hasOwn(extraFiles, path) ? extraFiles[path] : trusted(path));
};

const withDocuments = (files: Record<string, string>) => (path: string) =>
  Object.hasOwn(files, path) ? files[path] : readRepositoryFile(path);

const feasibilityDocument = (gates: { G1: string; G2: string; G3: string }) =>
  [
    "# Feasibility verdict",
    "",
    "## Gate verdicts",
    "",
    "```json",
    JSON.stringify(gates, null, 2),
    "```",
    ""
  ].join("\n");

const withFeasibility = (gates: { G1: string; G2: string; G3: string }) =>
  withDocuments({ [FEASIBILITY_PATH]: feasibilityDocument(gates) });

const CLEARED_PUBLICATION_VERDICT = {
  verdict: "CLEARED",
  blocked_by: [] as string[],
  permits_publication: true,
  permits_redistribution: true,
  permits_external_contribution_acceptance: true
};

const blockedPublicationVerdict = (blockedBy: string[]) => ({
  verdict: "BLOCKED",
  blocked_by: [...blockedBy].sort(),
  permits_publication: false,
  permits_redistribution: false,
  permits_external_contribution_acceptance: false
});

const livePublicationRows = () => {
  const text = readRepositoryFile(CLEARANCE_PATH);
  const ledger = parseRecordBlocks(text).get("Requirement ledger");
  assert.ok(ledger, `${CLEARANCE_PATH} has no Requirement ledger`);
  const rows = Array.isArray(ledger.requirements) ? (ledger.requirements as Json[]) : [];
  return { text, ledger, rows };
};

const publicationClearanceDocument = (requirements: Json[], derived: Json) => {
  const { text, ledger } = livePublicationRows();
  let next = upsertRecordBlock(text, "Requirement ledger", { ...ledger, requirements });
  next = upsertRecordBlock(next, "Derived verdict", derived);
  return next;
};

const resolvedPublicationRows = () =>
  livePublicationRows().rows.map((row) => ({ ...row, status: "RESOLVED" }));

const resolvedPublicationLedgerText = () =>
  publicationClearanceDocument(resolvedPublicationRows(), CLEARED_PUBLICATION_VERDICT);

const withProtocolWorldAndClearance = (
  canonicalJsonBytes: CanonicalJsonBytes,
  clearanceText: string
) => {
  const world = protocolPassWorld(canonicalJsonBytes);
  return {
    world,
    readFile: (path: string) => (path === CLEARANCE_PATH ? clearanceText : world.readFile(path))
  };
};

// Documents the executable reads. E12 may claim G2/G3 PASS_TO_CONTINUE; SSOT §7.3
// says that n=20 record cannot close those deferred studies, so this world still
// cannot mint G4_PASS. Caller-supplied publicationRequirements, gateStatus, and
// runG0 remain ignored.
const protocolPassWorld = (canonicalJsonBytes: CanonicalJsonBytes) => {
  const reproduction = makeIndependentReproduction(canonicalJsonBytes);
  let verdict = readRepositoryFile(VERDICT_PATH);
  verdict = upsertRecordBlock(verdict, "Trusted principals", {
    principals: [{ id: INDEPENDENT.id, public_key: reproduction.public_key }]
  });
  verdict = upsertRecordBlock(verdict, "Live reproduction", reproduction);
  return {
    reproduction,
    readFile: withDocuments({
      [VERDICT_PATH]: verdict,
      [CLEARANCE_PATH]: resolvedPublicationLedgerText(),
      [FEASIBILITY_PATH]: feasibilityDocument({
        G1: E12_CONTINUE,
        G2: E12_CONTINUE,
        G3: E12_CONTINUE
      })
    })
  };
};

describe("external-reproduction", () => {
  test("independent-manifest", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const minted = makeIndependentReproduction(canonicalize);
    const ramMinted = run(completeInput(canonicalize, { reproduction: minted }));
    assert.equal(
      ramMinted.reproduction?.signature_ok,
      true,
      "a cryptographically valid signature was refused before the principal was checked"
    );
    assert.equal(
      ramMinted.reproduction?.independent,
      false,
      "a self-chosen id plus an embedded key was treated as an independent host"
    );
    assert.ok(
      has(ramMinted, "UNTRUSTED_PRINCIPAL"),
      "a public key that is not on the G4-VERDICT allowlist was not refused as UNTRUSTED_PRINCIPAL"
    );
    assert.equal(has(ramMinted, "SELF_ATTESTED"), false, "an embedded-key host was treated as self-attested");
    assert.equal(has(ramMinted, "UNSIGNED"), false, "signed independent manifest was treated as unsigned");

    const trustedReadFile = withVerdictRecords({
      "Trusted principals": {
        principals: [{ id: INDEPENDENT.id, public_key: minted.public_key }]
      }
    });
    const allowlisted = run(
      completeInput(canonicalize, { reproduction: minted, readFile: trustedReadFile })
    );
    assert.equal(
      allowlisted.reproduction?.independent,
      true,
      "an allowlisted principal with a different environment id was not accepted as independent"
    );
    assert.equal(allowlisted.reproduction?.signature_ok, true, "allowlisted signature failed verification");
    assert.equal(
      has(allowlisted, "UNTRUSTED_PRINCIPAL"),
      false,
      "an allowlisted principal was refused as UNTRUSTED_PRINCIPAL"
    );

    const fromTree = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile: withVerdictRecords({
        "Live reproduction": minted,
        "Trusted principals": {
          principals: [{ id: INDEPENDENT.id, public_key: minted.public_key }]
        }
      })
    });
    assert.equal(
      has(fromTree, "NO_INDEPENDENT_REPRODUCTION"),
      false,
      "a tree-resident signed manifest in G4-VERDICT.md was not consumed"
    );
    assert.equal(
      fromTree.reproduction?.independent,
      true,
      "the tree-resident allowlisted manifest was not marked independent"
    );

    const selfAttested = run(
      completeInput(canonicalize, {
        reproduction: makeIndependentReproduction(canonicalize, { environment: { ...INDEPENDENT, id: VERIFIER.id } })
      })
    );
    assert.equal(selfAttested.ok, false, "self-attested reproduction was accepted");
    assert.equal(selfAttested.verdict, null, "self-attested reproduction emitted a passing verdict");
    assert.equal(selfAttested.reproduction?.independent, false, "self-attested reproduction was marked independent");
    assert.ok(has(selfAttested, "SELF_ATTESTED"), "self-attested reproduction was not refused as SELF_ATTESTED");

    const unsignedBody = makeIndependentReproduction(canonicalize);
    delete unsignedBody.signature;
    const unsigned = run(completeInput(canonicalize, { reproduction: unsignedBody }));
    assert.equal(unsigned.ok, false, "unsigned reproduction was accepted");
    assert.equal(unsigned.reproduction?.signature_ok, false, "unsigned reproduction was marked signature-ok");
    assert.ok(has(unsigned, "UNSIGNED"), "unsigned reproduction was not refused as UNSIGNED");

    const forged = makeIndependentReproduction(canonicalize);
    forged.signature = "A".repeat(88);
    const badSignature = run(completeInput(canonicalize, { reproduction: forged }));
    assert.equal(badSignature.ok, false, "invalid signature was accepted");
    assert.ok(
      has(badSignature, "INVALID_SIGNATURE"),
      "invalid signature was not refused as INVALID_SIGNATURE"
    );
  });

  test("exact-bytes", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const pin = pinnedOutputDigests();
    const schema = schemaPin();
    assert.ok(pin.length > 0, "public fixture digest census is empty");
    for (const entry of pin) {
      assert.match(entry.bytes_sha256, DIGEST_SHAPE, `${entry.path} digest is not a sha256 hex`);
    }
    assert.equal(
      schema.bytes_sha256,
      "905553924eddced6a2038d604447bad761becdea9a1f79b4eaf0d1a0deeec70d",
      "exact-bytes is not aimed at the G0 pin for specs/aos-result.schema.json"
    );

    const matched = run(
      completeInput(canonicalize, {
        reproduction: makeIndependentReproduction(canonicalize, { output_digests: pin })
      })
    );
    assert.equal(matched.reproduction?.bytes_ok, true, "exact public fixture bytes were not compared");
    assert.equal(has(matched, "WRONG_DIGEST"), false, "matching public fixture bytes were reported as WRONG_DIGEST");
    assert.equal(
      has(matched, "MANIFEST_INCOMPLETE"),
      false,
      "a complete public digest set was reported as MANIFEST_INCOMPLETE"
    );

    const mutatedText = "MUTATED-NOT-THE-PIN";
    const mutatedHash = sha256Hex(mutatedText);
    const mutatedReadFile = (path: string) =>
      path === SCHEMA_PIN_PATH ? mutatedText : readRepositoryFile(path);

    const dirtMatchesDirt = run(
      completeInput(canonicalize, {
        readFile: mutatedReadFile,
        runG0: () => ({ ok: true, errors: [] }),
        reproduction: makeIndependentReproduction(canonicalize, {
          output_digests: pin.map((entry) =>
            entry.path === SCHEMA_PIN_PATH ? { ...entry, bytes_sha256: mutatedHash } : entry
          )
        })
      })
    );
    assert.equal(
      dirtMatchesDirt.reproduction?.bytes_ok,
      false,
      "a reproduction of the verifier's current dirty bytes was accepted as the public pin"
    );
    assert.ok(
      has(dirtMatchesDirt, "WRONG_DIGEST"),
      "dirty-tree bytes were not refused as WRONG_DIGEST against the G0 pin"
    );
    assert.ok(
      dirtMatchesDirt.errors?.some(
        (entry) => entry.includes(SCHEMA_PIN_PATH) && entry.includes(schema.bytes_sha256)
      ),
      "WRONG_DIGEST did not name the G0 pin for the mutated path"
    );
    assert.notEqual(
      mutatedHash,
      schema.bytes_sha256,
      "mutated fixture hash accidentally equals the G0 pin"
    );

    const dirtMatchesPin = run(
      completeInput(canonicalize, {
        readFile: mutatedReadFile,
        runG0: () => ({ ok: true, errors: [] }),
        reproduction: makeIndependentReproduction(canonicalize, { output_digests: pin })
      })
    );
    assert.equal(
      dirtMatchesPin.reproduction?.bytes_ok,
      true,
      "a host that reproduced the G0 pin was rejected because the verifier tree is dirty"
    );
    assert.equal(
      has(dirtMatchesPin, "WRONG_DIGEST"),
      false,
      "pinned public fixture bytes were reported as WRONG_DIGEST against dirty verifier bytes"
    );
  });

  test("wrong-digest", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const pin = pinnedOutputDigests();
    const target = pin[0];
    const forged = pin.map((entry) =>
      entry.path === target.path ? { ...entry, bytes_sha256: ZERO_DIGEST } : entry
    );
    const wrong = run(
      completeInput(canonicalize, {
        reproduction: makeIndependentReproduction(canonicalize, { output_digests: forged })
      })
    );
    assert.equal(wrong.ok, false, "wrong output digest was accepted");
    assert.equal(wrong.verdict, null, "wrong output digest emitted a passing verdict");
    assert.equal(wrong.reproduction?.bytes_ok, false, "wrong output digest was marked bytes-ok");
    assert.ok(has(wrong, "WRONG_DIGEST"), "wrong output digest was not refused as WRONG_DIGEST");
    assert.ok(
      wrong.errors?.some((entry) => entry.includes(target.path)),
      "wrong output digest did not name the drifted path"
    );

    const truncated = run(
      completeInput(canonicalize, {
        reproduction: makeIndependentReproduction(canonicalize, { output_digests: pin.slice(1) })
      })
    );
    assert.equal(truncated.ok, false, "incomplete digest set was accepted");
    assert.ok(
      has(truncated, "MANIFEST_INCOMPLETE") || has(truncated, "WRONG_DIGEST"),
      "incomplete digest set was not refused"
    );

    const extra = run(
      completeInput(canonicalize, {
        reproduction: makeIndependentReproduction(canonicalize, {
          output_digests: [...pin, { path: "SECRET", bytes_sha256: ZERO_DIGEST }]
        })
      })
    );
    assert.equal(extra.ok, false, "an extra ungated path was accepted");
    assert.equal(extra.reproduction?.bytes_ok, false, "an extra ungated path was marked bytes-ok");
    assert.ok(
      extra.errors?.some((entry) => entry.includes("SECRET") && entry.includes("MANIFEST_INCOMPLETE")),
      "an extra ungated path was not refused as MANIFEST_INCOMPLETE"
    );

    const duplicated = run(
      completeInput(canonicalize, {
        reproduction: makeIndependentReproduction(canonicalize, {
          output_digests: [{ path: target.path, bytes_sha256: ZERO_DIGEST }, ...pin]
        })
      })
    );
    assert.equal(
      duplicated.reproduction?.bytes_ok,
      false,
      "a duplicate gated path last-write-wins'd the correct digest over a wrong first digest"
    );
    assert.ok(
      has(duplicated, "WRONG_DIGEST") || has(duplicated, "MANIFEST_MALFORMED"),
      "a duplicate gated path was not refused"
    );
  });

  test("stale-head", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const stale = run(
      completeInput(canonicalize, {
        headSha: HEAD,
        reproduction: makeIndependentReproduction(canonicalize, { head_sha: STALE })
      })
    );
    assert.equal(stale.ok, false, "stale head was accepted");
    assert.equal(stale.verdict, null, "stale head emitted a passing verdict");
    assert.equal(stale.reproduction?.head_ok, false, "stale head was marked head-ok");
    assert.ok(has(stale, "STALE_HEAD"), "stale head was not refused as STALE_HEAD");

    const current = run(
      completeInput(canonicalize, {
        headSha: HEAD,
        reproduction: makeIndependentReproduction(canonicalize, { head_sha: HEAD })
      })
    );
    assert.equal(current.reproduction?.head_ok, true, "current head was treated as stale");
    assert.equal(has(current, "STALE_HEAD"), false, "current head was reported as STALE_HEAD");
  });

  test("unresolved-gate", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const live = run();
    assert.equal(live.ok, false, "live G4 gate passed while blockers remain");
    assert.equal(live.verdict, null, "live G4 gate emitted PASS while blockers remain");
    assert.equal(live.permits_publication, false, "live G4 gate permitted publication");
    assert.ok(has(live, "UNRESOLVED_GATE"), "live unresolved G0-G4 blocker did not fail");
    assert.ok(
      has(live, "contributor_terms") || has(live, "formal_publication_review"),
      "live unresolved publication requirements were not named"
    );
    assert.ok(has(live, "G1") || has(live, "G2") || has(live, "G3"), "live unresolved G1-G3 blockers were not named");
    assert.ok(has(live, "NO_INDEPENDENT_REPRODUCTION"), "live tree-resident reproduction absence was not named");
    assert.equal(live.gates?.G0, "RESOLVED", "live G0 is not RESOLVED on this tree");
    assert.equal(existsSync(resolve(root, FEASIBILITY_PATH)), false, "unexpected E12 feasibility record is present");

    const fakeRequirement = run(
      completeInput(canonicalize, {
        publicationRequirements: [{ id: "not-a-real-requirement", status: "RESOLVED" }]
      })
    );
    assert.equal(fakeRequirement.ok, false, "a caller-minted requirement id minted G4_PASS");
    assert.equal(fakeRequirement.permits_publication, false, "a caller-minted requirement id permitted publication");
    assert.ok(
      has(fakeRequirement, "contributor_terms"),
      "the E14 ledger's contributor_terms was not consulted when a fake requirement array was injected"
    );
    assert.ok(
      has(fakeRequirement, "formal_publication_review"),
      "the E14 ledger's formal_publication_review was not consulted when a fake requirement array was injected"
    );

    const licenseOnly = run(
      completeInput(canonicalize, {
        publicationRequirements: [{ id: "license", status: "RESOLVED" }]
      })
    );
    assert.equal(licenseOnly.ok, false, "a partial caller-supplied ledger minted G4_PASS");
    assert.ok(has(licenseOnly, "contributor_terms"), "license-only injection skipped contributor_terms");
    assert.ok(
      has(licenseOnly, "formal_publication_review"),
      "license-only injection skipped formal_publication_review"
    );

    const pretendedClearance = run(
      completeInput(canonicalize, {
        publicationRequirements: allResolvedPublication()
      })
    );
    assert.equal(pretendedClearance.ok, false, "an injected all-RESOLVED publication array minted G4_PASS");
    assert.ok(
      has(pretendedClearance, "contributor_terms"),
      "injected RESOLVED publication skipped the live E14 contributor_terms ledger row"
    );

    const publicationOpen = run(completeInput(canonicalize));
    assert.equal(publicationOpen.ok, false, "unresolved contributor_terms did not block");
    assert.ok(has(publicationOpen, "UNRESOLVED_GATE"), "unresolved contributor_terms was not UNRESOLVED_GATE");
    assert.ok(has(publicationOpen, "contributor_terms"), "unresolved contributor_terms was not named");

    const pretendedGates = run(
      completeInput(canonicalize, {
        gateStatus: resolvedGates()
      })
    );
    assert.equal(pretendedGates.ok, false, "injected G1–G3 RESOLVED minted G4_PASS");
    assert.ok(has(pretendedGates, "G1"), "injected G1 RESOLVED skipped the live E12 feasibility record");
    assert.ok(has(pretendedGates, "G2"), "injected G2 RESOLVED closed a deferred calibration study");
    assert.ok(has(pretendedGates, "G3"), "injected G3 RESOLVED closed a deferred calibration study");

    const pretendedE12Tokens = run(
      completeInput(canonicalize, {
        gateStatus: { G0: "RESOLVED", G1: E12_CONTINUE, G2: E12_CONTINUE, G3: E12_CONTINUE }
      })
    );
    assert.equal(pretendedE12Tokens.ok, false, "injected G1–G3 PASS_TO_CONTINUE minted G4_PASS");
    assert.ok(
      has(pretendedE12Tokens, "UNRESOLVED_GATE G1"),
      "injected PASS_TO_CONTINUE skipped the live E12 feasibility record"
    );

    const e12Continue = run(completeInput(canonicalize, { readFile: withFeasibility({ G1: E12_CONTINUE, G2: E12_CONTINUE, G3: E12_CONTINUE }) }));
    assert.equal(e12Continue.ok, false, "E12 PASS_TO_CONTINUE closed publication and independence blockers");
    assert.equal(has(e12Continue, "UNRESOLVED_GATE G1"), false, "E12 PASS_TO_CONTINUE left G1 unresolved");
    assert.ok(has(e12Continue, "UNRESOLVED_GATE G2"), "E12 PASS_TO_CONTINUE closed G2");
    assert.ok(has(e12Continue, "UNRESOLVED_GATE G3"), "E12 PASS_TO_CONTINUE closed G3");
    assert.equal(e12Continue.gates?.G1, "RESOLVED", "G4 did not close G1 on E12 PASS_TO_CONTINUE");
    assert.equal(e12Continue.gates?.G2, "UNRESOLVED", "E12 PASS_TO_CONTINUE closed G2");
    assert.equal(e12Continue.gates?.G3, "UNRESOLVED", "E12 PASS_TO_CONTINUE closed G3");

    const e12ResolvedToken = run(
      completeInput(canonicalize, {
        readFile: withFeasibility({
          G1: E12_FORBIDDEN_RESOLVED,
          G2: E12_FORBIDDEN_RESOLVED,
          G3: E12_FORBIDDEN_RESOLVED
        })
      })
    );
    assert.equal(e12ResolvedToken.ok, false, "E12-forbidden RESOLVED token minted G4_PASS");
    assert.ok(
      has(e12ResolvedToken, "UNRESOLVED_GATE G1"),
      "E12-forbidden RESOLVED token was treated as a G1 pass"
    );
    assert.ok(
      has(e12ResolvedToken, "UNRESOLVED_GATE G2"),
      "an E12 token closed deferred G2"
    );
    assert.ok(
      has(e12ResolvedToken, "UNRESOLVED_GATE G3"),
      "an E12 token closed deferred G3"
    );

    const e12Inconclusive = run(
      completeInput(canonicalize, {
        readFile: withFeasibility({ G1: E12_INCONCLUSIVE, G2: E12_CONTINUE, G3: E12_CONTINUE })
      })
    );
    assert.ok(has(e12Inconclusive, "UNRESOLVED_GATE G1"), "E12 INCONCLUSIVE was treated as a G1 pass");
    assert.ok(has(e12Inconclusive, "UNRESOLVED_GATE G2"), "E12 PASS_TO_CONTINUE closed G2 next to G1 INCONCLUSIVE");
    assert.ok(has(e12Inconclusive, "UNRESOLVED_GATE G3"), "E12 PASS_TO_CONTINUE closed G3 next to G1 INCONCLUSIVE");

    const e12Pivot = run(
      completeInput(canonicalize, {
        readFile: withFeasibility({ G1: E12_CONTINUE, G2: E12_PIVOT, G3: E12_CONTINUE })
      })
    );
    assert.ok(has(e12Pivot, "UNRESOLVED_GATE G2"), "an E12 token closed deferred G2");
    assert.ok(has(e12Pivot, "UNRESOLVED_GATE G3"), "E12 PASS_TO_CONTINUE closed G3 next to G2 PIVOT_REQUIRED");
    assert.equal(has(e12Pivot, "UNRESOLVED_GATE G1"), false, "G1 PASS_TO_CONTINUE was ignored next to G2 PIVOT_REQUIRED");

    const e12Other = run(
      completeInput(canonicalize, {
        readFile: withFeasibility({ G1: "YES", G2: E12_CONTINUE, G3: E12_CONTINUE })
      })
    );
    assert.ok(has(e12Other, "UNRESOLVED_GATE G1"), "a non-empty non-E12 token was treated as a G1 pass");
    assert.ok(has(e12Other, "UNRESOLVED_GATE G2"), "E12 PASS_TO_CONTINUE closed G2 next to a non-E12 G1 token");
    assert.ok(has(e12Other, "UNRESOLVED_GATE G3"), "E12 PASS_TO_CONTINUE closed G3 next to a non-E12 G1 token");

    const g1Open = run(completeInput(canonicalize));
    assert.equal(g1Open.ok, false, "unresolved G1 did not block");
    assert.ok(has(g1Open, "UNRESOLVED_GATE"), "unresolved G1 was not UNRESOLVED_GATE");
    assert.ok(has(g1Open, "G1"), "unresolved G1 was not named");

    const mutatedReadFile = (path: string) =>
      path === SCHEMA_PIN_PATH ? "MUTATED-NOT-THE-PIN" : readRepositoryFile(path);
    const g0Fail = run(
      completeInput(canonicalize, {
        readFile: mutatedReadFile,
        runG0: () => ({ ok: true, errors: [] })
      })
    );
    assert.equal(g0Fail.ok, false, "failed G0 did not block");
    assert.ok(has(g0Fail, "UNRESOLVED_GATE"), "failed G0 was not UNRESOLVED_GATE");
    assert.ok(has(g0Fail, "G0"), "failed G0 was not named");

    let unread: GateResult | undefined;
    assert.doesNotThrow(() => {
      unread = run(
        completeInput(canonicalize, {
          readFile: (path: string) => {
            throw new Error(`ENOENT ${path}`);
          }
        })
      );
    }, "unreadable gated file threw instead of emitting a registered G4 terminal state");
    assert.equal(unread?.ok, false, "unreadable gated file did not fail closed");
    assert.equal(unread?.verdict, null, "unreadable gated file emitted a passing verdict");
    assert.ok(
      has(unread, "STALE_DIGEST") || has(unread, "UNREADABLE") || has(unread, "could not be read"),
      "unreadable gated file was not a registered terminal state"
    );

    const closed = run(completeInput(canonicalize));
    assert.equal(closed.ok, false, "RAM comparator input minted G4_PASS against live unresolved objects");
    assert.ok(has(closed, "UNRESOLVED_GATE"), "live unresolved objects were not reported");
    assert.ok(has(closed, "contributor_terms"), "live E14 contributor_terms was not reported");
    assert.ok(has(closed, "G1"), "live E12 G1 absence was not reported");

    const verdictAbsolute = resolve(root, VERDICT_PATH);
    let verdictEntry;
    try {
      verdictEntry = lstatSync(verdictAbsolute);
    } catch {
      assert.fail(`${VERDICT_PATH} is absent`);
    }
    assert.equal(verdictEntry.isSymbolicLink(), false, `${VERDICT_PATH} is a symbolic link`);
    assert.equal(verdictEntry.isFile(), true, `${VERDICT_PATH} is not a regular file`);
    const verdictText = readFileSync(verdictAbsolute, "utf8").replaceAll("\r\n", "\n");
    const blocks = parseRecordBlocks(verdictText);
    const recorded = blocks.get("Derived verdict");
    assert.ok(recorded, `${VERDICT_PATH} has no "Derived verdict" record`);
    assert.equal(recorded.verdict, "FAIL", "live G4 verdict is not FAIL");
    assert.equal(recorded.permits_publication, false, "live G4 verdict permits publication");
    assert.equal(recorded.permits_npm_publication, false, "live G4 verdict permits npm publication");
    assert.ok(
      Array.isArray(recorded.blocked_by) && (recorded.blocked_by as string[]).length > 0,
      "live G4 verdict names nothing that blocks it"
    );
    const recordedGates = blocks.get("Gate blockers");
    assert.ok(recordedGates, `${VERDICT_PATH} has no "Gate blockers" record`);
    assert.equal(
      recordedGates.G0,
      live.gates?.G0,
      "G4-VERDICT G0 status does not match the live gate"
    );
    for (const name of recorded.blocked_by as string[]) {
      const needle = name === "independent_reproduction" ? "NO_INDEPENDENT_REPRODUCTION" : name;
      assert.ok(has(live, needle), `G4-VERDICT blocked_by ${name} is not in the live error list`);
    }
    assert.ok(
      verdictText.includes("MIT is the outbound copyright grant")
        && verdictText.includes("It is not contributor terms")
        && verdictText.includes("it is not a publication clearance"),
      "G4 verdict treats MIT as publication clearance or contributor terms"
    );
    assert.ok(
      verdictText.includes("No public package has been approved."),
      "G4 verdict omits that no public package has been approved"
    );
    assert.doesNotMatch(verdictText, /\bCLEARED\b/, "live G4 verdict claims CLEARED");

    const clearance = readRepositoryFile(CLEARANCE_PATH);
    assert.match(clearance, /"id": "contributor_terms"[\s\S]*?"status": "UNRESOLVED"/);
    assert.match(clearance, /"id": "formal_publication_review"[\s\S]*?"status": "UNRESOLVED"/);
  });

  test("full-pass", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const world = protocolPassWorld(canonicalize);
    const passed = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile: world.readFile
    });
    assert.equal(passed.ok, false, "G4 passed while G2 and G3 deferred studies are absent");
    assert.equal(passed.verdict, null, "G4 emitted G4_PASS while G2 and G3 deferred studies are absent");
    assert.equal(passed.permits_publication, false, "G4 permitted publication while G2 and G3 are unresolved");
    assert.deepEqual(
      passed.errors,
      ["UNRESOLVED_GATE G2", "UNRESOLVED_GATE G3"],
      "the closable G0/G1/reproduction/publication world did not fail specifically on deferred G2 and G3"
    );
    assert.equal(passed.reproduction?.independent, true, "full-pass world was not independent");
    assert.equal(passed.reproduction?.signature_ok, true, "full-pass world failed signature verification");
    assert.equal(passed.reproduction?.bytes_ok, true, "full-pass world did not compare exact bytes");
    assert.equal(passed.reproduction?.head_ok, true, "full-pass world did not bind the current head");
    assert.equal(passed.gates?.G0, "RESOLVED", "full-pass world left G0 unresolved");
    assert.equal(passed.gates?.G1, "RESOLVED", "full-pass world left G1 unresolved against E12 PASS_TO_CONTINUE");
    assert.equal(passed.gates?.G2, "UNRESOLVED", "E12 PASS_TO_CONTINUE closed deferred G2");
    assert.equal(passed.gates?.G3, "UNRESOLVED", "E12 PASS_TO_CONTINUE closed deferred G3");
    assert.equal(has(passed, "UNRESOLVED_GATE G1"), false, "E12 PASS_TO_CONTINUE left G1 unresolved");
    assert.ok(has(passed, "UNRESOLVED_GATE G2"), "E12 PASS_TO_CONTINUE closed G2");
    assert.ok(has(passed, "UNRESOLVED_GATE G3"), "E12 PASS_TO_CONTINUE closed G3");
    assert.equal(has(passed, "SELF_ATTESTED"), false, "full-pass world was treated as self-attested");
    assert.equal(has(passed, "UNTRUSTED_PRINCIPAL"), false, "full-pass world refused an allowlisted principal");
    assert.equal(
      existsSync(resolve(root, VERDICT_PATH)),
      true,
      `${VERDICT_PATH} is absent after the G4 protocol exists`
    );

    const injectedPass = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      publicationRequirements: allResolvedPublication(),
      gateStatus: resolvedGates(),
      runG0: () => ({ ok: true, errors: [] }),
      reproduction: makeIndependentReproduction(canonicalize)
    });
    assert.equal(injectedPass.ok, false, "the library injection path minted G4_PASS");
    assert.equal(injectedPass.permits_publication, false, "the library injection path permitted publication");
    assert.notEqual(injectedPass.verdict, "G4_PASS", "the library injection path emitted G4_PASS");
  });

  test("cli-kind", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const wrongKind = makeIndependentReproduction(canonicalize, { kind: "self-report" });
    const fromCli = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      reproductionPath: CLI_REPRODUCTION_PATH,
      readFile: withAllowlistedPrincipal(wrongKind, INDEPENDENT.id, {
        [CLI_REPRODUCTION_PATH]: JSON.stringify(wrongKind)
      })
    });
    assert.equal(
      fromCli.reproduction?.independent,
      false,
      "the CLI path accepted a signed allowlisted manifest whose kind is not independent-reproduction"
    );
    assert.ok(
      has(fromCli, "NO_INDEPENDENT_REPRODUCTION"),
      "the CLI path did not apply the tree-slot kind check"
    );
    assert.equal(
      has(fromCli, "UNTRUSTED_PRINCIPAL"),
      false,
      "a wrong-kind CLI manifest was evaluated as an untrusted principal instead of being refused as not a reproduction"
    );

    const fromTree = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile: withVerdictRecords({
        "Live reproduction": wrongKind,
        "Trusted principals": {
          principals: [{ id: INDEPENDENT.id, public_key: wrongKind.public_key }]
        }
      })
    });
    assert.equal(
      fromTree.reproduction?.independent,
      false,
      "the tree slot accepted a signed allowlisted manifest whose kind is not independent-reproduction"
    );
    assert.ok(
      has(fromTree, "NO_INDEPENDENT_REPRODUCTION"),
      "the tree slot kind check was not applied"
    );

    const correctKind = makeIndependentReproduction(canonicalize);
    const cliCorrect = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      reproductionPath: CLI_REPRODUCTION_PATH,
      readFile: withAllowlistedPrincipal(correctKind, INDEPENDENT.id, {
        [CLI_REPRODUCTION_PATH]: JSON.stringify(correctKind)
      })
    });
    assert.equal(
      cliCorrect.reproduction?.independent,
      true,
      "the CLI path refused a signed allowlisted independent-reproduction"
    );
    assert.equal(
      has(cliCorrect, "NO_INDEPENDENT_REPRODUCTION"),
      false,
      "the CLI path treated a well-kinded independent-reproduction as absent"
    );
  });

  test("named-principal", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const borrowedKey = makeIndependentReproduction(canonicalize, {
      environment: { ...INDEPENDENT, id: NAMED_HOST_B }
    });
    const mismatched = run(
      completeInput(canonicalize, {
        reproduction: borrowedKey,
        readFile: withAllowlistedPrincipal(borrowedKey, NAMED_HOST_A)
      })
    );
    assert.equal(
      mismatched.reproduction?.signature_ok,
      true,
      "the same public key failed to verify when the allowlist id differed from environment.id"
    );
    assert.equal(
      mismatched.reproduction?.independent,
      false,
      "an allowlisted key attested a different environment.id as an independent principal"
    );
    assert.ok(
      has(mismatched, "UNTRUSTED_PRINCIPAL"),
      "a named-host-A key attesting named-host-B was not refused as UNTRUSTED_PRINCIPAL"
    );
    assert.equal(
      has(mismatched, "SELF_ATTESTED"),
      false,
      "a different-id same-key attestation was treated as self-attested"
    );

    const matched = run(
      completeInput(canonicalize, {
        reproduction: borrowedKey,
        readFile: withAllowlistedPrincipal(borrowedKey, NAMED_HOST_B)
      })
    );
    assert.equal(
      matched.reproduction?.independent,
      true,
      "the same key bound to named-host-B was refused when environment.id was named-host-B"
    );
    assert.equal(
      has(matched, "UNTRUSTED_PRINCIPAL"),
      false,
      "a matching named host and key was refused as UNTRUSTED_PRINCIPAL"
    );
  });

  test("independent-bytes", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const pin = pinnedOutputDigests();
    const forged = pin.map((entry, index) =>
      index === 0 ? { ...entry, bytes_sha256: ZERO_DIGEST } : entry
    );
    const wrongBytes = makeIndependentReproduction(canonicalize, { output_digests: forged });
    const wrong = run(
      completeInput(canonicalize, {
        reproduction: wrongBytes,
        readFile: withAllowlistedPrincipal(wrongBytes, INDEPENDENT.id)
      })
    );
    assert.equal(wrong.reproduction?.signature_ok, true, "the zero-digest manifest failed signature verification");
    assert.equal(wrong.reproduction?.bytes_ok, false, "a 64-zero first digest was marked bytes-ok");
    assert.equal(wrong.reproduction?.head_ok, true, "the zero-digest manifest was treated as a stale head");
    assert.ok(has(wrong, "WRONG_DIGEST"), "a 64-zero first digest was not refused as WRONG_DIGEST");
    assert.equal(
      wrong.reproduction?.independent,
      false,
      "a signed allowlisted manifest whose first digest is 64 zeros was marked independent"
    );

    const staleMinted = makeIndependentReproduction(canonicalize, { head_sha: STALE });
    const stale = run(
      completeInput(canonicalize, {
        reproduction: staleMinted,
        readFile: withAllowlistedPrincipal(staleMinted, INDEPENDENT.id)
      })
    );
    assert.equal(stale.reproduction?.signature_ok, true, "the stale-head allowlisted manifest failed signature verification");
    assert.equal(stale.reproduction?.bytes_ok, true, "the stale-head allowlisted manifest did not match the G0 pin");
    assert.equal(stale.reproduction?.head_ok, false, "a stale head was marked head-ok");
    assert.equal(
      stale.reproduction?.independent,
      false,
      "a signed allowlisted manifest at a stale head was marked independent"
    );
  });

  test("seventh-unresolved-publication-requirement-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // The sixth floor ids stay RESOLVED. The independent variable is a seventh
    // ledger row the frozen id list cannot name because it was not compiled in.
    const seventhId = "export_control_review";
    const seventh = {
      id: seventhId,
      title: "Export control review",
      status: "UNRESOLVED",
      artifact: CLEARANCE_PATH,
      evidence: "Formal publication and legal review",
      reason: "A requirement added to the ledger after G4_PUBLICATION_REQUIREMENT_IDS was frozen."
    };
    const clearance = publicationClearanceDocument(
      [...resolvedPublicationRows(), seventh],
      blockedPublicationVerdict([seventhId])
    );
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(gated.ok, false, "a seventh unresolved ledger row minted a publication pass");
    assert.ok(
      has(gated, `UNRESOLVED_GATE ${seventhId}`),
      `the ledger's seventh unresolved id ${seventhId} was not named; the gate is still walking the frozen six-id list`
    );
    assert.equal(
      has(gated, "UNRESOLVED_GATE contributor_terms"),
      false,
      "resolved floor rows were named, so this case is not isolating the seventh row"
    );
  });

  test("publication-floor-id-missing-from-ledger-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // Remaining rows are RESOLVED and Derived is CLEARED. Deleting a floor id
    // must still gate — a quiet deletion must not open publication.
    const floorId = "license";
    const clearance = publicationClearanceDocument(
      resolvedPublicationRows().filter((row) => row.id !== floorId),
      CLEARED_PUBLICATION_VERDICT
    );
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(gated.ok, false, "deleting a floor publication id from the ledger minted a publication pass");
    assert.ok(
      has(gated, `UNRESOLVED_GATE ${floorId}`),
      `a ledger that silently dropped ${floorId} was not refused as UNRESOLVED_GATE ${floorId}`
    );
  });

  test("publication-derived-verdict-disagrees-with-ledger-rows-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // Every row is RESOLVED. The document still records BLOCKED. Publication
    // clearance.md says the verdict is derived from the ledger and the two
    // must agree; a CLEARED/BLOCKED disagreement is not a publication pass.
    const clearance = publicationClearanceDocument(
      resolvedPublicationRows(),
      blockedPublicationVerdict(["contributor_terms"])
    );
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(
      gated.ok,
      false,
      "a BLOCKED derived verdict was ignored because every ledger row was RESOLVED"
    );
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "the gate did not read Derived verdict, or treated disagreement as a pass"
    );
    assert.equal(
      has(gated, "UNRESOLVED_GATE contributor_terms"),
      false,
      "resolved rows were named, so this case is not isolating the derived-verdict disagreement"
    );
  });

  test("publication-derived-cleared-token-with-false-permits-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // Verdict token matches the rows. permits_publication does not. The
    // clearance record derives the three permits flags from CLEARED; a
    // CLEARED token that withholds publication is still disagreement.
    const clearance = publicationClearanceDocument(resolvedPublicationRows(), {
      ...CLEARED_PUBLICATION_VERDICT,
      permits_publication: false
    });
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(gated.ok, false, "CLEARED with permits_publication false minted a publication pass");
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "a CLEARED token was treated as agreement even though permits_publication was false"
    );
  });

  test("publication-clearance-with-a-duplicate-json-member-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // Written as raw text on purpose. JSON.parse keeps the last duplicate member, so an object
    // fixture cannot express this: by the time the object exists the first value is gone. The
    // visible document says permits_publication false and blocked_by nonempty; the parsed object
    // says the opposite, and every comparison downstream would run on the parsed object.
    const clearance = [
      "## Requirement ledger",
      "",
      "```json",
      JSON.stringify({ requirements: resolvedPublicationRows() }, null, 2),
      "```",
      "",
      "## Derived verdict",
      "",
      "```json",
      "{",
      '  "verdict": "CLEARED",',
      '  "blocked_by": ["contributor_terms"],',
      '  "blocked_by": [],',
      '  "permits_publication": false,',
      '  "permits_publication": true,',
      '  "permits_redistribution": true,',
      '  "permits_external_contribution_acceptance": true',
      "}",
      "```",
      ""
    ].join("\n");

    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(gated.ok, false, "a clearance record with duplicate members minted a publication pass");
    assert.ok(
      gated.errors.some((entry) => entry.includes("more than once")),
      `an ambiguous clearance record was normalised instead of refused: ${gated.errors.join(" | ")}`
    );
  });

  test("publication-derived-verdict-token-alone-disagreeing-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // The other verdict cases move the token together with blocked_by and the permit flags, so
    // deleting the verdict comparison alone kills none of them. Here the token is the only
    // variable: BLOCKED beside an empty blocked_by and all permits true, which the rows derive as
    // CLEARED.
    const clearance = publicationClearanceDocument(resolvedPublicationRows(), {
      ...CLEARED_PUBLICATION_VERDICT,
      verdict: "BLOCKED"
    });
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(gated.ok, false, "a disagreeing verdict token alone minted a publication pass");
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "the verdict token was not compared when every other field agreed"
    );
  });

  test("publication-derived-blocked-by-with-an-empty-string-entry-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // The previous comparison joined blocked_by with NUL, so [""] and [] both serialised to ""
    // and a malformed nonempty list read as agreement with an empty derived one. Without this
    // case the fix has no oracle: restoring the join leaves every other case green.
    const clearance = publicationClearanceDocument(resolvedPublicationRows(), {
      ...CLEARED_PUBLICATION_VERDICT,
      blocked_by: [""]
    });
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(gated.ok, false, "a blocked_by entry that is an empty string minted a publication pass");
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "an empty-string blocked_by entry was treated as agreement with an empty derived list"
    );
  });

  test("publication-derived-cleared-token-with-an-unenumerated-false-permit-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // The G4 record requires agreement on every permits_* flag. Comparing a list of names
    // compiled when the code was written let a fourth flag through: all three known permits are
    // true beside a CLEARED token, and permits_npm_publication is false. Nothing named it.
    const clearance = publicationClearanceDocument(resolvedPublicationRows(), {
      ...CLEARED_PUBLICATION_VERDICT,
      permits_npm_publication: false
    } as unknown as typeof CLEARED_PUBLICATION_VERDICT);
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(
      gated.ok,
      false,
      "CLEARED with an unenumerated false permit minted a publication pass"
    );
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "a permits_* flag the code does not name was not compared"
    );
  });

  test("publication-derived-cleared-token-with-false-permits-redistribution-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // Verdict token and permits_publication match the rows. The clearance
    // record derives the three permits flags as one conjunction; flipping
    // only permits_redistribution is still disagreement.
    const clearance = publicationClearanceDocument(resolvedPublicationRows(), {
      ...CLEARED_PUBLICATION_VERDICT,
      permits_redistribution: false
    });
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(
      gated.ok,
      false,
      "CLEARED with permits_redistribution false minted a publication pass"
    );
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "a CLEARED token was treated as agreement even though permits_redistribution was false"
    );
  });

  test("publication-derived-cleared-token-with-false-permits-external-contribution-acceptance-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    // Verdict token and the other two permits flags match the rows. The
    // clearance record derives all three as one conjunction; flipping only
    // permits_external_contribution_acceptance is still disagreement.
    const clearance = publicationClearanceDocument(resolvedPublicationRows(), {
      ...CLEARED_PUBLICATION_VERDICT,
      permits_external_contribution_acceptance: false
    });
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(
      gated.ok,
      false,
      "CLEARED with permits_external_contribution_acceptance false minted a publication pass"
    );
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "a CLEARED token was treated as agreement even though permits_external_contribution_acceptance was false"
    );
  });

  test("publication-derived-cleared-token-with-blocked-by-gates", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const clearance = publicationClearanceDocument(resolvedPublicationRows(), {
      ...CLEARED_PUBLICATION_VERDICT,
      blocked_by: ["contributor_terms"]
    });
    const { readFile } = withProtocolWorldAndClearance(canonicalize, clearance);
    const gated = run({
      localEnvironment: VERIFIER,
      headSha: HEAD,
      readFile
    });
    assert.equal(gated.ok, false, "CLEARED with a nonempty blocked_by minted a publication pass");
    assert.ok(
      has(gated, "UNRESOLVED_GATE publication derived verdict disagrees with ledger rows"),
      "a CLEARED token was treated as agreement even though blocked_by was nonempty"
    );
  });
});
