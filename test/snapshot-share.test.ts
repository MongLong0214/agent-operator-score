import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const allowlistPath = resolve(here, "../specs/share-allowlist.v0.json");
const sourcePath = resolve(here, "../src/_deferred/snapshot-share.ts");

// The ticket's pinned pre-GREEN reason. It is the refusal message and the message of every
// assertion in this file, so a lane that goes quiet cannot be mistaken for a lane that passed.
const LEAK = "unknown/private fields may leak into a share card.";

// SSOT §5.2 family names, transcribed independently of any schema in the tree.
const FAMILIES = [
  "FAM-1 Intent & Contracting",
  "FAM-2 Context, RAG & Decoy",
  "FAM-3 Graph & Orchestration",
  "FAM-4 Loop, State & Continuity",
  "FAM-5 Verification & False Completion",
  "FAM-6 Recovery, Safety & Efficiency"
];

const LIMITATIONS = "Snapshot is an ESTIMATE only. It is not a performed assessment.";
const VERSION = "aos-snapshot.v0";

// The whole Snapshot, as E13-001 froze it. Six fields go in.
const SNAPSHOT_FIELDS = [
  "estimate_band",
  "recommended_family",
  "next_command",
  "watermark",
  "limitations",
  "version"
];

// Five come out. `next_command` is operator-supplied free text that can carry a local path,
// so it is withheld from anything that leaves the machine. Default-deny, stated as a list.
const SHARE_FIELDS = [
  "estimate_band",
  "recommended_family",
  "watermark",
  "limitations",
  "version"
];

const WITHHELD_FIELDS = ["next_command"];

// Generation is never implicit. Exactly this request, and nothing wider, yields a card.
const explicitRequest = () => ({ command: "share" });

const validSnapshot = () => ({
  estimate_band: "developing",
  recommended_family: "FAM-4 Loop, State & Continuity",
  next_command: "aos run --form A",
  watermark: "ESTIMATE",
  limitations: LIMITATIONS,
  version: VERSION
});

// Byte-exact card for the fixture above, pinned three ways: literal, length, and digest.
const CARD = [
  "ESTIMATE",
  "estimate_band: developing",
  "recommended_family: FAM-4 Loop, State & Continuity",
  `limitations: ${LIMITATIONS}`,
  `version: ${VERSION}`
].join("\n");
const CARD_BYTES = 187;
const CARD_SHA256 = "27564954de4529750ad03d394911598a12be242f2723567bda808e1025296988";
const SHARE_JSON_SHA256 = "e472e902e176568093d0474001e186aa294f24319624e369adec11d18228af7b";

// Names that must never be admitted, and values that must never leave with the card.
const PRIVATE_CANARIES: Record<string, string> = {
  raw_prompt: "the operator typed this and it is not shareable",
  prompt: "the operator typed this and it is not shareable",
  path: "/Users/operator/projects/private-repo",
  file_path: "/Users/operator/projects/private-repo/src/secret.ts",
  cwd: "/Users/operator/projects/private-repo",
  home: "/Users/operator",
  secret: "canary-secret-value",
  api_key: "canary-api-key-value",
  token: "canary-token-value",
  model: "runtime-model-identifier",
  model_id: "runtime-model-identifier",
  run_id: "run-canary-identifier",
  session_id: "session-canary-identifier",
  env: "CANARY_ENVIRONMENT_VALUE"
};

const loadShare = async () => {
  try {
    return await import("../src/_deferred/snapshot-share.ts");
  } catch {
    return {};
  }
};

const requireExports = async () => {
  const mod = await loadShare();
  assert.equal(typeof mod.projectSnapshotShare, "function", LEAK);
  assert.equal(typeof mod.renderSnapshotCard, "function", LEAK);
  return mod as {
    projectSnapshotShare: (snapshot: unknown, request?: unknown) => Record<string, unknown>;
    renderSnapshotCard: (share: unknown) => string;
  };
};

const moduleSurface = async () => Object.keys(await loadShare()).sort();

const frozenAllowlist = () => JSON.parse(readFileSync(allowlistPath, "utf8"));

const productionSource = () => readFileSync(sourcePath, "utf8");

const refuses = (call: () => unknown, label: string) => {
  assert.throws(
    call,
    (error: unknown) => error instanceof Error && error.message === LEAK,
    `${LEAK} (${label})`
  );
};

const scanSource = (source: string, patterns: RegExp[], label: string) => {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    assert.equal(pattern.test(source), false, `${LEAK} (${label} matched ${pattern})`);
  }
};

test("allowlist", async () => {
  const { projectSnapshotShare, renderSnapshotCard } = await requireExports();
  const allowlist = frozenAllowlist();

  // The frozen list is the contract, and the projection is exactly it.
  assert.deepEqual(allowlist.allowlisted_fields, SHARE_FIELDS, LEAK);
  assert.deepEqual(
    allowlist.withheld_snapshot_fields.map((entry: { field: string }) => entry.field),
    WITHHELD_FIELDS,
    LEAK
  );
  for (const entry of allowlist.withheld_snapshot_fields) {
    assert.equal(typeof entry.reason, "string", LEAK);
    assert.ok(entry.reason.length > 0, LEAK);
  }
  assert.deepEqual(
    [...allowlist.allowlisted_fields, ...WITHHELD_FIELDS].sort(),
    [...SNAPSHOT_FIELDS].sort(),
    LEAK
  );

  const share = projectSnapshotShare(validSnapshot(), explicitRequest());
  assert.deepEqual(Object.keys(share), SHARE_FIELDS, LEAK);
  assert.equal(share.estimate_band, "developing", LEAK);
  assert.equal(share.recommended_family, "FAM-4 Loop, State & Continuity", LEAK);
  assert.ok(FAMILIES.includes(share.recommended_family as string), LEAK);
  assert.equal(share.watermark, "ESTIMATE", LEAK);
  assert.equal(share.limitations, LIMITATIONS, LEAK);
  assert.equal(share.version, VERSION, LEAK);

  // A withheld field is absent by name and by value, in the object and in the card.
  const card = renderSnapshotCard(share);
  for (const field of WITHHELD_FIELDS) {
    assert.equal(Object.hasOwn(share, field), false, `${LEAK} (${field})`);
    assert.equal(JSON.stringify(share).includes(field), false, `${LEAK} (${field})`);
    assert.equal(card.includes(field), false, `${LEAK} (${field})`);
  }
  assert.equal(JSON.stringify(share).includes("aos run --form A"), false, LEAK);
  assert.equal(card.includes("aos run --form A"), false, LEAK);

  // Every allowlisted field reaches the card. A silent drop is a failure, not a saving.
  assert.equal(card.split("\n")[0], "ESTIMATE", LEAK);
  for (const field of SHARE_FIELDS) {
    if (field === "watermark") continue;
    assert.ok(card.includes(`${field}: ${share[field] as string}`), `${LEAK} (${field})`);
  }
  assert.equal(card.split("\n").length, SHARE_FIELDS.length, LEAK);

  // The artifact cannot be widened after it is handed back.
  assert.equal(Object.isFrozen(share), true, LEAK);
  assert.throws(() => {
    (share as Record<string, unknown>).leaked_after_projection = "x";
  });

  // A snapshot missing any allowlisted field is refused rather than projected thinner.
  for (const field of SHARE_FIELDS) {
    const partial = validSnapshot() as Record<string, unknown>;
    delete partial[field];
    refuses(() => projectSnapshotShare(partial, explicitRequest()), `missing ${field}`);
  }
  // And so is a snapshot missing the field this projection deliberately withholds: the
  // projection reads a whole Snapshot, it does not accept a pre-trimmed one.
  for (const field of WITHHELD_FIELDS) {
    const partial = validSnapshot() as Record<string, unknown>;
    delete partial[field];
    refuses(() => projectSnapshotShare(partial, explicitRequest()), `missing ${field}`);
  }
});

test("unknown-field", async () => {
  const { projectSnapshotShare, renderSnapshotCard } = await requireExports();
  const share = projectSnapshotShare(validSnapshot(), explicitRequest());

  // Unknown input keys are refused, whatever they are called.
  for (const key of ["nickname", "score", "p0", "percentile", "status", "safety", "rank", "extra"]) {
    refuses(
      () => projectSnapshotShare({ ...validSnapshot(), [key]: "anything" }, explicitRequest()),
      `input ${key}`
    );
  }

  // Unknown keys on the request are refused too; a wider request is not a share command.
  refuses(
    () => projectSnapshotShare(validSnapshot(), { ...explicitRequest(), unknown: true }),
    "request unknown"
  );

  // The renderer re-checks the allowlist. A share widened between projection and render
  // never reaches bytes.
  refuses(() => renderSnapshotCard({ ...share, leaked: "x" }), "render unknown");
  for (const field of SHARE_FIELDS) {
    const widened = { ...share } as Record<string, unknown>;
    delete widened[field];
    refuses(() => renderSnapshotCard(widened), `render missing ${field}`);
  }
  refuses(() => renderSnapshotCard({ ...share, next_command: "aos run --form A" }), "render withheld");

  // Non-objects are not partially trusted.
  for (const value of [null, undefined, "share", 0, [], true]) {
    refuses(() => projectSnapshotShare(value, explicitRequest()), `input ${String(value)}`);
    refuses(() => renderSnapshotCard(value), `render ${String(value)}`);
  }
});

test("private-canaries", async () => {
  const { projectSnapshotShare, renderSnapshotCard } = await requireExports();
  const allowlist = frozenAllowlist();
  const share = projectSnapshotShare(validSnapshot(), explicitRequest());
  const card = renderSnapshotCard(share);
  const serialized = JSON.stringify(share);

  // Named private fields are refused on the way in.
  for (const [key, value] of Object.entries(PRIVATE_CANARIES)) {
    refuses(
      () => projectSnapshotShare({ ...validSnapshot(), [key]: value }, explicitRequest()),
      `canary ${key}`
    );
    refuses(() => renderSnapshotCard({ ...share, [key]: value }), `render canary ${key}`);
    assert.equal(allowlist.allowlisted_fields.includes(key), false, `${LEAK} (${key})`);
  }

  // And they are absent from the artifact by name and by value.
  for (const [key, value] of Object.entries(PRIVATE_CANARIES)) {
    assert.equal(serialized.includes(key), false, `${LEAK} (${key})`);
    assert.equal(serialized.includes(value), false, `${LEAK} (${key})`);
    assert.equal(card.includes(key), false, `${LEAK} (${key})`);
    assert.equal(card.includes(value), false, `${LEAK} (${key})`);
  }

  // A private value smuggled inside an allowlisted field is refused as well. A key
  // allowlist that does not check values is not a privacy boundary.
  const smuggled = [
    ["estimate_band", "developing /Users/operator/projects/private-repo"],
    ["estimate_band", "developing (run 42)"],
    ["estimate_band", "canary-secret-value"],
    ["estimate_band", "developing\nsecret: canary-secret-value"],
    ["estimate_band", ""],
    ["recommended_family", "FAM-4 Loop, State & Continuity /Users/operator"],
    ["recommended_family", "FAM-7 Invented Family"],
    ["watermark", "VERIFIED"],
    ["watermark", "ESTIMATE /Users/operator"],
    ["limitations", `${LIMITATIONS} /Users/operator`],
    ["limitations", "This assessment was performed and verified."],
    ["version", `${VERSION} /Users/operator`],
    ["version", "aos-result.v0"]
  ];
  for (const [field, value] of smuggled) {
    refuses(
      () => projectSnapshotShare({ ...validSnapshot(), [field]: value }, explicitRequest()),
      `smuggled ${field}=${value}`
    );
  }

  // Non-string values in allowlisted positions are refused rather than coerced.
  for (const field of SHARE_FIELDS) {
    for (const value of [null, 1, true, {}, []]) {
      refuses(
        () => projectSnapshotShare({ ...validSnapshot(), [field]: value }, explicitRequest()),
        `typed ${field}`
      );
    }
  }

  // The frozen list names the canaries it refuses, so the refusal is reviewable.
  for (const key of Object.keys(PRIVATE_CANARIES)) {
    assert.ok(
      allowlist.forbidden_field_names.includes(key),
      `${LEAK} (allowlist omits ${key})`
    );
  }
});

test("explicit-only", async () => {
  const { projectSnapshotShare } = await requireExports();
  const allowlist = frozenAllowlist();

  assert.equal(allowlist.generation, "explicit_command_only", LEAK);
  assert.equal(allowlist.command, "share", LEAK);
  assert.equal(allowlist.default_generation, "never", LEAK);

  // Nothing implicit generates a card.
  refuses(() => projectSnapshotShare(validSnapshot()), "no request");
  for (const request of [undefined, null, {}, true, 1, "share", ["share"], { command: "" }]) {
    refuses(() => projectSnapshotShare(validSnapshot(), request), `request ${String(request)}`);
  }
  refuses(() => projectSnapshotShare(validSnapshot(), { command: "render" }), "wrong command");
  refuses(() => projectSnapshotShare(validSnapshot(), { command: "SHARE" }), "wrong case");
  refuses(() => projectSnapshotShare(validSnapshot(), { command: "share", auto: true }), "widened");

  // Exactly the explicit command works.
  const share = projectSnapshotShare(validSnapshot(), explicitRequest());
  assert.deepEqual(Object.keys(share), SHARE_FIELDS, LEAK);

  // The module exports the two owned symbols and nothing else.
  assert.deepEqual(await moduleSurface(), ["projectSnapshotShare", "renderSnapshotCard"], LEAK);

  // Generation cannot start itself: the module reads no argument vector, touches no
  // filesystem, and writes to no stream.
  scanSource(
    productionSource(),
    [
      /\bprocess\b/,
      /\bargv\b/,
      /node:fs\b/,
      /\breadFile/,
      /\bwriteFile/,
      /\bconsole\b/,
      /\bsetTimeout\b/,
      /\bsetInterval\b/,
      /\bqueueMicrotask\b/
    ],
    "explicit-only"
  );
});

test("no-network", async () => {
  const { projectSnapshotShare, renderSnapshotCard } = await requireExports();

  // A live sentinel on every network entry point this runtime exposes.
  let calls = 0;
  const trip = (name: string) => (...args: unknown[]) => {
    calls += 1;
    throw new Error(`${LEAK} (${name} called with ${args.length} arguments)`);
  };
  const entryPoints = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"];
  const originals = entryPoints.map((name) => [name, Reflect.get(globalThis, name)] as const);
  try {
    for (const name of entryPoints) Reflect.set(globalThis, name, trip(name));
    const share = projectSnapshotShare(validSnapshot(), explicitRequest());
    const card = renderSnapshotCard(share);
    assert.equal(card, CARD, LEAK);
    // Refusals must not reach the network either.
    refuses(() => projectSnapshotShare({ ...validSnapshot(), secret: "x" }, explicitRequest()), "refusal");
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) Reflect.deleteProperty(globalThis, name);
      else Reflect.set(globalThis, name, value);
    }
  }
  assert.equal(calls, 0, LEAK);

  // And statically: the module reaches nothing it could send bytes through, because it
  // imports nothing at all.
  const source = productionSource();
  assert.equal(/^\s*import\b/m.test(source), false, `${LEAK} (the module imports something)`);
  assert.equal(/\brequire\s*\(/.test(source), false, `${LEAK} (the module requires something)`);
  scanSource(
    source,
    [
      /\bfetch\b/i,
      /XMLHttpRequest/,
      /WebSocket/i,
      /EventSource/,
      /\bhttps?\b/i,
      /node:(?:net|dns|tls|http|https|dgram)\b/,
      /\bundici\b/i,
      /\baxios\b/i,
      /\bsocket\b/i,
      /\bnavigator\b/i,
      /\bsendBeacon\b/i
    ],
    "no-network"
  );
});

test("stable-bytes", async () => {
  const { projectSnapshotShare, renderSnapshotCard } = await requireExports();

  const first = projectSnapshotShare(validSnapshot(), explicitRequest());
  const second = projectSnapshotShare(validSnapshot(), explicitRequest());
  assert.deepEqual(Object.keys(first), Object.keys(second), LEAK);
  assert.deepEqual(first, second, LEAK);
  assert.equal(JSON.stringify(first), JSON.stringify(second), LEAK);

  const firstCard = renderSnapshotCard(first);
  const secondCard = renderSnapshotCard(second);
  const reRendered = renderSnapshotCard(first);
  assert.equal(firstCard, secondCard, LEAK);
  assert.equal(reRendered, firstCard, LEAK);

  // Pinned bytes: literal, length, and digest, so a drifting card cannot pass as stable.
  assert.equal(firstCard, CARD, LEAK);
  assert.equal(Buffer.byteLength(firstCard, "utf8"), CARD_BYTES, LEAK);
  assert.equal(createHash("sha256").update(firstCard, "utf8").digest("hex"), CARD_SHA256, LEAK);
  assert.equal(
    createHash("sha256").update(JSON.stringify(first), "utf8").digest("hex"),
    SHARE_JSON_SHA256,
    LEAK
  );
  assert.equal(firstCard.endsWith("\n"), false, LEAK);

  // Deterministic means locally derived: no clock, no randomness, no counter.
  scanSource(
    productionSource(),
    [
      /\bDate\b/,
      /\brandom\b/i,
      /\bperformance\b/,
      /\bhrtime\b/,
      /\bcrypto\b/i,
      /\brandomUUID\b/i,
      /\buuid\b/i,
      /\btoLocale/,
      /\bIntl\b/
    ],
    "stable-bytes"
  );
});
