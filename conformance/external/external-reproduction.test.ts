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
const VERIFIER = { id: "verifier-host" };
const INDEPENDENT = { id: "independent-host", os: "linux", arch: "x64" };
const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STALE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DIGEST_SHAPE = /^[a-f0-9]{64}$/;

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

const liveOutputDigests = (): DigestEntry[] =>
  (G0_DIGEST_MANIFEST as DigestEntry[]).map((entry) => ({
    path: entry.path,
    bytes_sha256: sha256Hex(readRepositoryFile(entry.path).replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
  }));

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
  const output_digests = (overrides.output_digests as DigestEntry[] | undefined) ?? liveOutputDigests();
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

const completeInput = (canonicalJsonBytes: CanonicalJsonBytes, overrides: Json = {}) => ({
  localEnvironment: VERIFIER,
  headSha: HEAD,
  publicationRequirements: allResolvedPublication(),
  gateStatus: resolvedGates(),
  runG0: () => ({ ok: true, errors: [] }),
  reproduction: makeIndependentReproduction(canonicalJsonBytes),
  ...overrides
});

describe("external-reproduction", () => {
  test("independent-manifest", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const independent = run(completeInput(canonicalize));
    assert.equal(independent.reproduction?.independent, true, "signed independent manifest was not accepted");
    assert.equal(independent.reproduction?.signature_ok, true, "signed independent manifest failed signature verification");
    assert.equal(has(independent, "SELF_ATTESTED"), false, "independent environment was treated as self-attested");
    assert.equal(has(independent, "UNSIGNED"), false, "signed independent manifest was treated as unsigned");

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

    const digests = liveOutputDigests();
    assert.ok(digests.length > 0, "public fixture digest census is empty");
    for (const entry of digests) {
      assert.match(entry.bytes_sha256, DIGEST_SHAPE, `${entry.path} digest is not a sha256 hex`);
    }

    const matched = run(
      completeInput(canonicalize, {
        reproduction: makeIndependentReproduction(canonicalize, { output_digests: digests })
      })
    );
    assert.equal(matched.reproduction?.bytes_ok, true, "exact public fixture bytes were not compared");
    assert.equal(has(matched, "WRONG_DIGEST"), false, "matching public fixture bytes were reported as WRONG_DIGEST");
    assert.equal(
      has(matched, "MANIFEST_INCOMPLETE"),
      false,
      "a complete public digest set was reported as MANIFEST_INCOMPLETE"
    );
  });

  test("wrong-digest", async () => {
    const { canonicalJsonBytes, runG4Gate } = await loadGate();
    assertExported(runG4Gate, PINNED);
    assertExported(canonicalJsonBytes, PINNED);
    const run = runG4Gate as RunG4Gate;
    const canonicalize = canonicalJsonBytes as CanonicalJsonBytes;

    const digests = liveOutputDigests();
    const target = digests[0];
    const forged = digests.map((entry) =>
      entry.path === target.path ? { ...entry, bytes_sha256: "0".repeat(64) } : entry
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
        reproduction: makeIndependentReproduction(canonicalize, { output_digests: digests.slice(1) })
      })
    );
    assert.equal(truncated.ok, false, "incomplete digest set was accepted");
    assert.ok(
      has(truncated, "MANIFEST_INCOMPLETE") || has(truncated, "WRONG_DIGEST"),
      "incomplete digest set was not refused"
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

    const publicationOpen = run(
      completeInput(canonicalize, {
        publicationRequirements: allResolvedPublication().map((requirement) =>
          requirement.id === "contributor_terms" ? { ...requirement, status: "UNRESOLVED" } : requirement
        )
      })
    );
    assert.equal(publicationOpen.ok, false, "unresolved contributor_terms did not block");
    assert.ok(has(publicationOpen, "UNRESOLVED_GATE"), "unresolved contributor_terms was not UNRESOLVED_GATE");
    assert.ok(has(publicationOpen, "contributor_terms"), "unresolved contributor_terms was not named");

    const g1Open = run(
      completeInput(canonicalize, {
        gateStatus: { ...resolvedGates(), G1: "UNRESOLVED" }
      })
    );
    assert.equal(g1Open.ok, false, "unresolved G1 did not block");
    assert.ok(has(g1Open, "UNRESOLVED_GATE"), "unresolved G1 was not UNRESOLVED_GATE");
    assert.ok(has(g1Open, "G1"), "unresolved G1 was not named");

    const g0Fail = run(
      completeInput(canonicalize, {
        runG0: () => ({ ok: false, errors: ["G0_FAIL injected"] })
      })
    );
    assert.equal(g0Fail.ok, false, "failed G0 did not block");
    assert.ok(has(g0Fail, "UNRESOLVED_GATE"), "failed G0 was not UNRESOLVED_GATE");
    assert.ok(has(g0Fail, "G0"), "failed G0 was not named");

    const closed = run(completeInput(canonicalize));
    assert.equal(has(closed, "UNRESOLVED_GATE"), false, "a fully resolved gate set still reported UNRESOLVED_GATE");

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

    const passed = run(completeInput(canonicalize));
    assert.equal(passed.ok, true, "complete independent reproduction did not pass");
    assert.equal(passed.verdict, "G4_PASS", "complete independent reproduction did not emit G4_PASS");
    assert.deepEqual(passed.errors, [], "complete independent reproduction still carried errors");
    assert.equal(passed.reproduction?.independent, true, "full pass was not independent");
    assert.equal(passed.reproduction?.signature_ok, true, "full pass failed signature verification");
    assert.equal(passed.reproduction?.bytes_ok, true, "full pass did not compare exact bytes");
    assert.equal(passed.reproduction?.head_ok, true, "full pass did not bind the current head");
    assert.equal(has(passed, "UNRESOLVED_GATE"), false, "full pass still reported UNRESOLVED_GATE");
    assert.equal(has(passed, "SELF_ATTESTED"), false, "full pass was treated as self-attested");
    assert.equal(
      existsSync(resolve(root, VERDICT_PATH)),
      true,
      `${VERDICT_PATH} is absent after the G4 protocol exists`
    );
  });
});
