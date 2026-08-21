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
    kind: "independent-reproduction",
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
// status, or G0 stub — those objects live in the E14 ledger, the E12 feasibility
// record, and runG0Gate.
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
    assert.ok(has(pretendedGates, "G2"), "injected G2 RESOLVED skipped the live E12 feasibility record");
    assert.ok(has(pretendedGates, "G3"), "injected G3 RESOLVED skipped the live E12 feasibility record");

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

    const live = run();
    assert.equal(live.ok, false, "live G4 gate passed without independent reproduction and closed blockers");
    assert.notEqual(live.verdict, "G4_PASS", "live G4 gate emitted G4_PASS");
    assert.equal(live.permits_publication, false, "live G4 gate permitted publication");
    assert.ok(has(live, "NO_INDEPENDENT_REPRODUCTION"), "live G4 did not consume the tree-resident reproduction slot");

    const passed = run(completeInput(canonicalize));
    assert.equal(passed.ok, false, "RAM-minted comparator input minted G4_PASS");
    assert.notEqual(passed.verdict, "G4_PASS", "RAM-minted comparator input emitted G4_PASS");
    assert.equal(passed.permits_publication, false, "RAM-minted comparator input permitted publication");
    assert.equal(passed.reproduction?.signature_ok, true, "full-pass comparator lost signature verification");
    assert.equal(passed.reproduction?.bytes_ok, true, "full-pass comparator did not compare the G0 pin");
    assert.equal(passed.reproduction?.head_ok, true, "full-pass comparator did not bind the current head");
    assert.equal(
      passed.reproduction?.independent,
      false,
      "full-pass treated a self-chosen embedded key as an independent host"
    );
    assert.ok(has(passed, "UNTRUSTED_PRINCIPAL"), "full-pass did not refuse an unallowlisted principal");
    assert.ok(has(passed, "UNRESOLVED_GATE"), "full-pass skipped live G0–G4 blockers");
    assert.ok(has(passed, "contributor_terms"), "full-pass skipped the live E14 contributor_terms row");
    assert.ok(has(passed, "G1"), "full-pass skipped the live E12 G1 record");
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
  });
});
