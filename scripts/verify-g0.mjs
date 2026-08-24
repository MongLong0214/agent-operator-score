/**
 * G0 scorer-truth reproducibility gate for E2-005.
 *
 * One fail-closed run binds schema, scorer, and fixture bytes, executes the
 * published formula vectors, kills every registered mutant, and compares the
 * Node 22 and Node 24 evidence hashes. The verdict is fixture truth only.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAosCodingP0 } from "../src/scorer/score.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SUPPORTED_NODE_RANGE = ">=22.18 <25";

const NODE_FLOOR = { major: 22, minor: 18 };
const NODE_CEILING_MAJOR = 25;

export const G0_FAMILIES = Object.freeze([
  "reference-pass",
  "reference-fail",
  "false-completion",
  "stale-evidence",
  "duplicate-run",
  "unsafe-action",
  "insufficient-evidence",
  "manual-takeover",
  "prescription"
]);

const SCHEMA_PATHS = Object.freeze([
  "specs/aos-result.schema.json",
  "specs/aos-trace.schema.json",
  "specs/events.v0.json",
  "specs/opportunity-profile.schema.json",
  "specs/scoring.v0.json",
  "specs/issuance.v0.json"
]);

const SCORER_PATHS = Object.freeze([
  "src/reporter/diagnosis/select-lever.ts",
  "src/scorer/eligibility.ts",
  "src/scorer/graders/context.ts",
  "src/scorer/graders/graph.ts",
  "src/scorer/graders/intent.ts",
  "src/scorer/issuance.ts",
  "src/scorer/safety.ts",
  "src/scorer/score.ts",
  "src/_deferred/opportunity-audit.ts",
  "src/_deferred/pack-budget.ts"
]);

const CORPUS_FILES = Object.freeze(["manifest.json", "input.json", "expected.json", "mutation.json"]);
const VECTOR_PATH = "fixtures/scoring/vectors.json";
const SCORING_CONTRACT_PATH = "specs/scoring.v0.json";

const fixturePaths = G0_FAMILIES.flatMap((family) =>
  CORPUS_FILES.map((name) => `fixtures/${family}/corpus/${name}`)
);

export const GATED_G0_PATHS = Object.freeze([
  ...SCHEMA_PATHS,
  ...SCORER_PATHS,
  ...fixturePaths,
  VECTOR_PATH
]);

const KIND_OF = Object.fromEntries([
  ...SCHEMA_PATHS.map((path) => [path, "schema"]),
  ...SCORER_PATHS.map((path) => [path, "scorer"]),
  ...fixturePaths.map((path) => [path, "fixture"]),
  [VECTOR_PATH, "fixture"]
]);

// Pinned. Regenerating these from the files they gate would make the gate vacuous.
export const G0_DIGEST_MANIFEST = Object.freeze([
  Object.freeze({ path: "specs/aos-result.schema.json", kind: "schema", bytes_sha256: "905553924eddced6a2038d604447bad761becdea9a1f79b4eaf0d1a0deeec70d" }),
  Object.freeze({ path: "specs/aos-trace.schema.json", kind: "schema", bytes_sha256: "1bd8ab335e68ec7aad39887661531a2b818cef401bef80bafb70bbb574c3a98e" }),
  Object.freeze({ path: "specs/events.v0.json", kind: "schema", bytes_sha256: "af671c135903ff11c3f743119cf7ff8052dfa657fee2b760b10710d8dde13e44" }),
  Object.freeze({ path: "specs/opportunity-profile.schema.json", kind: "schema", bytes_sha256: "ee7a6ce0a1b5aec0975810176fe3fc11a93c5403e7cdab7e34618af252069913" }),
  Object.freeze({ path: "specs/scoring.v0.json", kind: "schema", bytes_sha256: "2a4169c4175fa59c8bd895ae6c1341e5f117ff33e44f9190cb271615e7c1f5bd" }),
  Object.freeze({ path: "specs/issuance.v0.json", kind: "schema", bytes_sha256: "a99959bb0667af38647fee95f9c04c4c5ca594a0bbbbff6dc9d8fcca86b8eeb3" }),
  Object.freeze({ path: "src/reporter/diagnosis/select-lever.ts", kind: "scorer", bytes_sha256: "dbb1a7fa388ba4483732fa265a7e3ac1792b38b52576091a3ddf4e20b10af645" }),
  Object.freeze({ path: "src/scorer/eligibility.ts", kind: "scorer", bytes_sha256: "b21dbd6bb6c7223c6affcffe8f30f717a8b5f0987170ccc940ea40650fd1f4f8" }),
  Object.freeze({ path: "src/scorer/graders/context.ts", kind: "scorer", bytes_sha256: "3905231b0cfc5c75523a988af5dc9728ec01700852c6657b02442e86a2d7a3a5" }),
  Object.freeze({ path: "src/scorer/graders/graph.ts", kind: "scorer", bytes_sha256: "293cf17af4c143ef982256b135b98260ce943823c2649fa49df7f4a043fdbd3c" }),
  Object.freeze({ path: "src/scorer/graders/intent.ts", kind: "scorer", bytes_sha256: "d0d8937756e557d58fa0057cc3cdee0cd484ba8e6bec87465331ece01e676598" }),
  Object.freeze({ path: "src/scorer/issuance.ts", kind: "scorer", bytes_sha256: "fada45bf5be4c55e5d0999dbb8dd7d3aac517875a9a9e9da7ff45df8d302d78e" }),
  Object.freeze({ path: "src/scorer/safety.ts", kind: "scorer", bytes_sha256: "4f5f76266de00dd250735f0d84e78ec00039210b601538ecedd34bc07386a61d" }),
  Object.freeze({ path: "src/scorer/score.ts", kind: "scorer", bytes_sha256: "8b06f970bc481ee4c87fa8e1de7fc95dcf09417a6d0c8443094ea5ebb9fa8966" }),
  Object.freeze({ path: "src/_deferred/opportunity-audit.ts", kind: "scorer", bytes_sha256: "c8a8685f7e94ceb0368158a7222503b8feba3a600db0d6ff2578498932c00edd" }),
  Object.freeze({ path: "src/_deferred/pack-budget.ts", kind: "scorer", bytes_sha256: "ced578b4e577770aa132af8eb48272b83de0c5588ad47bacb9fa6710563ccc11" }),
  Object.freeze({ path: "fixtures/reference-pass/corpus/manifest.json", kind: "fixture", bytes_sha256: "03ba91981a863fc85090fd3fbbf88f52753ebc55b16fc9f32f8ac3f261dba6fa" }),
  Object.freeze({ path: "fixtures/reference-pass/corpus/input.json", kind: "fixture", bytes_sha256: "0b92a238660875c6766b40e7078c16edcc4a059b1667efdc6c016594c52a42ea" }),
  Object.freeze({ path: "fixtures/reference-pass/corpus/expected.json", kind: "fixture", bytes_sha256: "e7fda02b53e51fd379e32b163c64b5c6d0a3ee16fb71760f59c08bf926177d1c" }),
  Object.freeze({ path: "fixtures/reference-pass/corpus/mutation.json", kind: "fixture", bytes_sha256: "12b268529854f4dd6cf1945fd5833422088cc0bdf825274446a22c6692773b2f" }),
  Object.freeze({ path: "fixtures/reference-fail/corpus/manifest.json", kind: "fixture", bytes_sha256: "982719c6182919b0f37c1f24a8fa5a8122cea6c4e3174f6644e4adadb9c90b2e" }),
  Object.freeze({ path: "fixtures/reference-fail/corpus/input.json", kind: "fixture", bytes_sha256: "be61de4c369f64fd092c4c3faa08bcb4335424b453e5c652f24951d074fa497e" }),
  Object.freeze({ path: "fixtures/reference-fail/corpus/expected.json", kind: "fixture", bytes_sha256: "a3b937bdb2e9f9f5c0207153c62224cb99e9fde924a60a599dbccd18d8d139cc" }),
  Object.freeze({ path: "fixtures/reference-fail/corpus/mutation.json", kind: "fixture", bytes_sha256: "1f921b28347294623c7dae70fac5f84ac34ce59594c3558b5ae853c2fcdaa5da" }),
  Object.freeze({ path: "fixtures/false-completion/corpus/manifest.json", kind: "fixture", bytes_sha256: "a17b9f06c10c4ccd9e62ee32b884aca5622b0900bfcfa62d44112306233fd4b1" }),
  Object.freeze({ path: "fixtures/false-completion/corpus/input.json", kind: "fixture", bytes_sha256: "f4107e9d8de2b96628742d21b99dbf906b40f56db4475c98d01c7e5950704d72" }),
  Object.freeze({ path: "fixtures/false-completion/corpus/expected.json", kind: "fixture", bytes_sha256: "01d15368f9c0565aa97ae7f457cfdf2901fdfa8bc2b3265171c0ea443c2c70fa" }),
  Object.freeze({ path: "fixtures/false-completion/corpus/mutation.json", kind: "fixture", bytes_sha256: "03e3679695ddce13aacc944ee6c51d549371d9a4de49981e2a851ea4d9921895" }),
  Object.freeze({ path: "fixtures/stale-evidence/corpus/manifest.json", kind: "fixture", bytes_sha256: "7a37aca30db2a79f63ee1e0fece622058b078a4c60ce96d579bdd2c5d471ed38" }),
  Object.freeze({ path: "fixtures/stale-evidence/corpus/input.json", kind: "fixture", bytes_sha256: "4b7c6dedf1c2534ab1358202c21fbf945fc46ad20dd7174d0e13a6a1b8e9ebe0" }),
  Object.freeze({ path: "fixtures/stale-evidence/corpus/expected.json", kind: "fixture", bytes_sha256: "382d33db100f5c31635626337ace06ba91fb96658f025a0b479e5792b0912eb0" }),
  Object.freeze({ path: "fixtures/stale-evidence/corpus/mutation.json", kind: "fixture", bytes_sha256: "46c878b3612462222f8738095ac06177487d5cdf260ac645f64086023079acb1" }),
  Object.freeze({ path: "fixtures/duplicate-run/corpus/manifest.json", kind: "fixture", bytes_sha256: "484986b86a93d0bcdc2655f10a39786b4aae3d086eb743fbee6275def8fbfc5f" }),
  Object.freeze({ path: "fixtures/duplicate-run/corpus/input.json", kind: "fixture", bytes_sha256: "db95ce5134f96a064f322716e1bb8656b93a658814cd88f47141c18d0e9582bb" }),
  Object.freeze({ path: "fixtures/duplicate-run/corpus/expected.json", kind: "fixture", bytes_sha256: "638e35fad9eb670bcefeb7af4ddda4dd7d733d57a87d11ee34d088c8a96d4229" }),
  Object.freeze({ path: "fixtures/duplicate-run/corpus/mutation.json", kind: "fixture", bytes_sha256: "fc67c4341a2cc991c79276b48e58bc1647c6b0480ff16166ccfb07c33e783428" }),
  Object.freeze({ path: "fixtures/unsafe-action/corpus/manifest.json", kind: "fixture", bytes_sha256: "606d594e2fc09cd88d81aade3c9d45ed111b02487a6207f122ad799ef02258a9" }),
  Object.freeze({ path: "fixtures/unsafe-action/corpus/input.json", kind: "fixture", bytes_sha256: "9175f37f571cabb23136042a456626db61cdf6715564b65206783ab87623b488" }),
  Object.freeze({ path: "fixtures/unsafe-action/corpus/expected.json", kind: "fixture", bytes_sha256: "283f086c083ad428f40cf62dbaba38a466fe64fe8c33df638d0de8ac790e227c" }),
  Object.freeze({ path: "fixtures/unsafe-action/corpus/mutation.json", kind: "fixture", bytes_sha256: "2f1baef66d127ca78fd6da78820424bf9c78d3c9425d6f50ffaddbd9e72c9df5" }),
  Object.freeze({ path: "fixtures/insufficient-evidence/corpus/manifest.json", kind: "fixture", bytes_sha256: "e0e1ca600aaa132b906de665689e943d36e154dc94a2353e71ad4ea2b0010bc8" }),
  Object.freeze({ path: "fixtures/insufficient-evidence/corpus/input.json", kind: "fixture", bytes_sha256: "cb1603514a5d77b20074d56b6aae62036bf2de71de46a729e5e4684b5f3b066f" }),
  Object.freeze({ path: "fixtures/insufficient-evidence/corpus/expected.json", kind: "fixture", bytes_sha256: "601ce25c6b939da9fbc2710f973581a65dc9430d858a54de5ddafef775e6b9a1" }),
  Object.freeze({ path: "fixtures/insufficient-evidence/corpus/mutation.json", kind: "fixture", bytes_sha256: "1fe8e2c3eade9ac1bfaf7e3b861a6fadfaadf67f40b24aa87ead4a7d366f3c3a" }),
  Object.freeze({ path: "fixtures/manual-takeover/corpus/manifest.json", kind: "fixture", bytes_sha256: "ef4573d4a7dbd6200fd66965c7089629370b174ac459b44b9ca6f54f7fcd8928" }),
  Object.freeze({ path: "fixtures/manual-takeover/corpus/input.json", kind: "fixture", bytes_sha256: "2751a9c48ac9b4d03df99eaa3f9571f143cebe9b9c7f385417695b30b2be2e77" }),
  Object.freeze({ path: "fixtures/manual-takeover/corpus/expected.json", kind: "fixture", bytes_sha256: "43bc58e0a725db4fdd7531c1375ae7eebab324c8a2521401964f0fa960e55460" }),
  Object.freeze({ path: "fixtures/manual-takeover/corpus/mutation.json", kind: "fixture", bytes_sha256: "d61da5f7469159c12afcf8839ce6b5ebabd756c14d1a4f8e825818600d3aa5c7" }),
  Object.freeze({ path: "fixtures/prescription/corpus/manifest.json", kind: "fixture", bytes_sha256: "ddb887cd8bc243e9c1e56dc141ea774ca9364dc2d6402c416b0675ed83ce252f" }),
  Object.freeze({ path: "fixtures/prescription/corpus/input.json", kind: "fixture", bytes_sha256: "eef5432087f2702b906f7cc844b9a6f89962ea95efd5fb64951d485b9ad1c368" }),
  Object.freeze({ path: "fixtures/prescription/corpus/expected.json", kind: "fixture", bytes_sha256: "a9d3baff719ccfec6ecc5f1fa9a1120dac2afc9185c0d3151017eb7d264945f0" }),
  Object.freeze({ path: "fixtures/prescription/corpus/mutation.json", kind: "fixture", bytes_sha256: "ac4cacec13cd896e963a54d4da64a13d8560318e08fe9de0d5b3bd1c23d9d7c6" }),
  Object.freeze({ path: "fixtures/scoring/vectors.json", kind: "fixture", bytes_sha256: "cde6ac59b25ea68ec9e769da84441f63fbeb4eea5dade7ac7dfd87c891da299e" })
]);

const DIGEST_SHAPE = /^[a-f0-9]{64}$/;

const isPlainRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const canonicalJsonBytes = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonBytes).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonBytes(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const sha256Hex = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const normalizeLf = (text) => text.split("\r\n").join("\n").split("\r").join("\n");

export const digestFileText = (text) => sha256Hex(normalizeLf(String(text)));

// Pinned. Editing one recorded digest must break this too.
export const G0_DIGEST_MANIFEST_SHA256 =
  "0a5b3f30447d5aab01abe8e9113ecc68443f7afdc48937bc2e6e87ae4fac4327";

export const isSupportedNodeVersion = (version) => {
  if (typeof version !== "string") return false;
  const parsed = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!parsed) return false;
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);
  if (major >= NODE_CEILING_MAJOR) return false;
  if (major < NODE_FLOOR.major) return false;
  if (major === NODE_FLOOR.major && minor < NODE_FLOOR.minor) return false;
  return true;
};

const defaultReadFile = (path) => readFileSync(resolve(root, path), "utf8");

const WORKSPACES = Object.freeze([
  ["packages/schema", "@aos/schema"],
  ["packages/scorer", "@aos/scorer"],
  ["packages/runner", "@aos/runner"],
  ["packages/reporter", "@aos/reporter"],
  ["adapters/codex", "@aos/adapter-codex"],
  ["adapters/claude-code", "@aos/adapter-claude-code"]
]);

const verifyInstall = (lockfile) => {
  if (!isPlainRecord(lockfile)) return false;
  if (lockfile.lockfileVersion !== 3) return false;
  if (lockfile.name !== "agent-operator-score") return false;
  if (lockfile.version !== "0.0.0") return false;
  if (lockfile.requires !== true) return false;
  const packages = lockfile.packages;
  if (!isPlainRecord(packages)) return false;
  const rootPackage = packages[""];
  if (!isPlainRecord(rootPackage)) return false;
  if (!isPlainRecord(rootPackage.engines) || rootPackage.engines.node !== SUPPORTED_NODE_RANGE) return false;
  const expectedKeys = [
    "",
    ...WORKSPACES.map(([path]) => path),
    ...WORKSPACES.map(([, name]) => `node_modules/${name}`)
  ].sort();
  if (Object.keys(packages).sort().join("\0") !== expectedKeys.join("\0")) return false;
  for (const [path, name] of WORKSPACES) {
    const pkg = packages[path];
    if (!isPlainRecord(pkg) || pkg.name !== name || pkg.version !== "0.0.0") return false;
    const link = packages[`node_modules/${name}`];
    if (!isPlainRecord(link) || link.resolved !== path || link.link !== true) return false;
  }
  return true;
};

export const verifyG0Digests = ({
  readFile = defaultReadFile,
  manifest = G0_DIGEST_MANIFEST
} = {}) => {
  const errors = [];
  const entries = Array.isArray(manifest) ? manifest : [];
  if (!Array.isArray(manifest)) errors.push("MANIFEST_MALFORMED the digest manifest must be an array");

  const declared = entries.map((entry) => (isPlainRecord(entry) ? entry.path : String(entry)));
  for (const path of GATED_G0_PATHS) {
    if (!declared.includes(path)) {
      errors.push(`MANIFEST_INCOMPLETE ${path} is gated but carries no recorded digest`);
    }
  }
  for (const path of declared) {
    if (!GATED_G0_PATHS.includes(path)) {
      errors.push(`MANIFEST_INCOMPLETE ${path} is recorded but is not a gated document`);
    }
  }

  let checked = 0;
  for (const entry of entries) {
    if (!isPlainRecord(entry) || typeof entry.path !== "string") {
      errors.push("MANIFEST_MALFORMED a manifest entry must record a path and its digest");
      continue;
    }
    if (!DIGEST_SHAPE.test(entry.bytes_sha256)) {
      errors.push(`MANIFEST_MALFORMED ${entry.path} must record a 64-character lowercase hex digest`);
      continue;
    }
    if (entry.kind !== KIND_OF[entry.path]) {
      errors.push(`MANIFEST_MALFORMED ${entry.path} must record kind ${KIND_OF[entry.path] ?? "gated"}`);
    }
    let text;
    try {
      text = readFile(entry.path);
    } catch (error) {
      errors.push(`STALE_DIGEST ${entry.path} could not be read: ${String(error)}`);
      continue;
    }
    const computed = digestFileText(text);
    checked += 1;
    if (computed !== entry.bytes_sha256) {
      errors.push(
        `STALE_DIGEST ${entry.path} recorded ${entry.bytes_sha256} but computed ${computed}`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checked,
    manifest_sha256: sha256Hex(canonicalJsonBytes(entries))
  };
};

const loadDiskFamilies = (readFile) =>
  G0_FAMILIES.map((family) => ({
    family,
    input: JSON.parse(readFile(`fixtures/${family}/corpus/input.json`)),
    expected: JSON.parse(readFile(`fixtures/${family}/corpus/expected.json`)),
    mutation: JSON.parse(readFile(`fixtures/${family}/corpus/mutation.json`))
  }));

const originalInputOf = (family) => {
  const record = isPlainRecord(family.input) ? family.input : null;
  return record && Object.hasOwn(record, "canonical") ? record.canonical : family.input;
};

const mutationOf = (family) => {
  const record = isPlainRecord(family.mutation) ? family.mutation : null;
  if (!record || !Object.hasOwn(record, "input") || !Object.hasOwn(record, "expected")) return null;
  return { input: record.input, expected: record.expected };
};

const scoreVectors = (vectors, contract, score = scoreAosCodingP0) => {
  const errors = [];
  const results = [];
  let scored = 0;
  for (const vector of vectors) {
    if (!isPlainRecord(vector) || typeof vector.vector_id !== "string") {
      errors.push("SCORER_MISMATCH a published vector is malformed");
      continue;
    }
    const inputs = isPlainRecord(vector.inputs) ? vector.inputs : {};
    const expected = isPlainRecord(vector.expected) ? vector.expected : {};
    let verdict;
    try {
      verdict = score({ contract, metrics: inputs.metrics, safety: inputs.safety });
    } catch (error) {
      errors.push(`SCORER_MISMATCH ${vector.vector_id} threw: ${String(error)}`);
      continue;
    }
    const comparable = {
      outcome_index: verdict.outcome_index,
      process_index: verdict.process_index,
      factors: verdict.factors,
      safety_state: verdict.safety_state,
      safety_handling: verdict.safety_handling,
      safety_warning: verdict.safety_warning,
      issued: verdict.issued,
      status: verdict.status,
      raw_score: verdict.raw_score,
      display_score: verdict.display_score
    };
    const wanted = {
      outcome_index: expected.outcome_index ?? null,
      process_index: expected.process_index ?? null,
      factors: expected.factors,
      safety_state: expected.safety_state,
      safety_handling: expected.safety_handling,
      safety_warning: expected.safety_warning,
      issued: expected.issued,
      status: expected.status,
      raw_score: expected.raw_score ?? null,
      display_score: expected.display_score ?? null
    };
    if (canonicalJsonBytes(comparable) !== canonicalJsonBytes(wanted) || verdict.ok !== true) {
      errors.push(`SCORER_MISMATCH ${vector.vector_id} did not reproduce the published verdict`);
      continue;
    }
    scored += 1;
    results.push({ vector_id: vector.vector_id, verdict: comparable });
  }
  return { errors, scored, results };
};

export const runG0Gate = ({
  nodeVersion = process.versions.node,
  readFile = defaultReadFile,
  manifest = G0_DIGEST_MANIFEST,
  families,
  vectors,
  lockfile,
  byteSources,
  score = scoreAosCodingP0
} = {}) => {
  const errors = [];
  const supported = isSupportedNodeVersion(nodeVersion);
  if (!supported) {
    errors.push(`UNSUPPORTED_RUNTIME node ${String(nodeVersion)} is outside ${SUPPORTED_NODE_RANGE}`);
  }

  let parsedLockfile = lockfile;
  if (parsedLockfile === undefined) {
    try {
      parsedLockfile = JSON.parse(readFile("package-lock.json"));
    } catch (error) {
      parsedLockfile = null;
      errors.push(`INSTALL_DIRTY package-lock.json could not be read: ${String(error)}`);
    }
  }
  const installClean = verifyInstall(parsedLockfile);
  if (!installClean) errors.push("INSTALL_DIRTY the lockfile is not the clean published install");

  const digests = verifyG0Digests({ readFile, manifest });
  errors.push(...digests.errors);

  let loadedFamilies = [];
  try {
    loadedFamilies = Array.isArray(families) ? families : loadDiskFamilies(readFile);
  } catch (error) {
    errors.push(`ZERO_FIXTURE fixture corpus could not be read: ${String(error)}`);
    loadedFamilies = [];
  }

  const familyIds = loadedFamilies.map((family) => family.family);
  if (loadedFamilies.length === 0) {
    errors.push("ZERO_FIXTURE the G0 fixture corpus is empty");
  } else if (
    loadedFamilies.length !== G0_FAMILIES.length
    || G0_FAMILIES.some((family) => !familyIds.includes(family))
  ) {
    errors.push("ZERO_FIXTURE the G0 fixture corpus does not bind every required family");
  }

  let mutationsKilled = 0;
  for (const family of loadedFamilies) {
    const mutation = mutationOf(family);
    if (!mutation) {
      errors.push(`MUTANT_LIVE ${String(family.family)} has no mutation payload`);
      continue;
    }
    const inputChanged = canonicalJsonBytes(mutation.input) !== canonicalJsonBytes(originalInputOf(family));
    const expectedChanged = canonicalJsonBytes(mutation.expected) !== canonicalJsonBytes(family.expected);
    if (!inputChanged || !expectedChanged) {
      errors.push(`MUTANT_LIVE ${String(family.family)} still produces the original expected bytes`);
      continue;
    }
    mutationsKilled += 1;
  }

  let loadedVectors;
  let contract;
  try {
    contract = JSON.parse(readFile(SCORING_CONTRACT_PATH));
    loadedVectors = Array.isArray(vectors)
      ? vectors
      : JSON.parse(readFile(VECTOR_PATH)).vectors;
  } catch (error) {
    errors.push(`ZERO_FIXTURE published vectors could not be read: ${String(error)}`);
    loadedVectors = [];
    contract = {};
  }
  if (!Array.isArray(loadedVectors) || loadedVectors.length === 0) {
    errors.push("ZERO_FIXTURE the published formula vector pack is empty");
    loadedVectors = [];
  }

  const scored = scoreVectors(loadedVectors, contract, score);

  errors.push(...scored.errors);

  const evidence = {
    bytes_kind: "g0-fixture-truth",
    families: loadedFamilies.map((family) => ({
      family: family.family,
      expected: family.expected
    })),
    install: { clean: installClean, engines: SUPPORTED_NODE_RANGE },
    manifest,
    scorer: scored.results
  };
  const canonical = canonicalJsonBytes(evidence);
  const source22 = byteSources && Object.hasOwn(byteSources, "node22") ? byteSources.node22 : canonical;
  const source24 = byteSources && Object.hasOwn(byteSources, "node24") ? byteSources.node24 : canonical;
  const node22 = sha256Hex(String(source22));
  const node24 = sha256Hex(String(source24));
  if (node22 !== node24) {
    errors.push(`BYTE_DRIFT node22 ${node22} != node24 ${node24}`);
  }

  const ok = errors.length === 0;
  return {
    ok,
    verdict: ok ? "G0_FIXTURE_TRUTH" : null,
    errors,
    digest_manifest_sha256: digests.manifest_sha256,
    canonical_bytes: canonical,
    bytes: { node22, node24 },
    runtime: { node: nodeVersion, supported, range: SUPPORTED_NODE_RANGE },
    install: { clean: installClean },
    census: {
      families: loadedFamilies.length,
      mutations_killed: mutationsKilled,
      vectors: loadedVectors.length
    },
    scorer: { ok: scored.errors.length === 0 && scored.scored > 0, scored: scored.scored }
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = runG0Gate();
  if (!run.ok) {
    console.error(`G0_FAIL ${run.errors.length}`);
    for (const error of run.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `G0_FIXTURE_TRUTH families=${run.census.families} mutations_killed=${run.census.mutations_killed} vectors=${run.census.vectors} scored=${run.scorer.scored} manifest_sha256=${run.digest_manifest_sha256} node=${run.runtime.node}`
  );
}
