/**
 * Schema conformance, census, and digest gate for E1-003.
 *
 * Three things are gated here and none of them may pass by silence:
 *
 * 1. Digest gate. `SPEC_DIGEST_MANIFEST` records the SHA-256 of every document
 *    E1-001 and E1-002 froze. The failure this exists for is a schema whose bytes
 *    move without its recorded digest moving, so the manifest is a pinned literal,
 *    never a value recomputed from the files it is supposed to be gating. Both a
 *    raw-byte digest and a canonical-JSON digest are recorded: the first sees a
 *    reformat, the second sees a semantic edit that a reformat hides.
 * 2. Conformance corpus. Positive fixtures must validate and negative fixtures must
 *    be rejected for their declared reason. A negative fixture that starts passing,
 *    or a negative fixture rejected for some other reason, fails the run.
 * 3. Census. An empty corpus, a corpus with no negative half, and a gated schema
 *    with no fixture are all `ZERO_FIXTURE`. "Nothing failed" is not evidence.
 *
 * Canonicalization is platform-independent by construction: keys are sorted by
 * UTF-16 code unit (never a locale collation), there is no whitespace in the
 * output, and line endings are normalized before hashing, so a Windows checkout
 * and a Linux checkout produce the same manifest.
 *
 * The corpus is held here rather than in files under `conformance/schema/`. The
 * repository's skeleton-admission control plane (`tests/planning/workspace-skeleton.test.mjs`)
 * admits a non-source file inside the skeleton only through a `fixtures/...` glob
 * declared by a ticket, and admits a source-extension file only when a ticket names
 * that exact path. `conformance/schema/**` satisfies neither, so any file placed
 * there fails the repository suite. See OUT/report.md.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The repository's declared engines range. Node 20 cannot execute this repository's
// TypeScript and its test runner skips `.ts` files silently instead of failing, so a
// run there would report green over nothing.
export const SUPPORTED_NODE_RANGE = ">=22.18 <25";

const NODE_FLOOR = { major: 22, minor: 18 };
const NODE_CEILING_MAJOR = 25;

export const GATED_SPEC_PATHS = Object.freeze([
  "specs/aos-result.schema.json",
  "specs/aos-trace.schema.json",
  "specs/events.v0.json",
  "specs/opportunity-profile.schema.json"
]);

// Pinned. Regenerating these from the files they gate would make the gate vacuous.
export const SPEC_DIGEST_MANIFEST = Object.freeze([
  Object.freeze({
    path: "specs/aos-result.schema.json",
    bytes_sha256: "905553924eddced6a2038d604447bad761becdea9a1f79b4eaf0d1a0deeec70d",
    canonical_sha256: "baeae0ea7c904c435d43fdfc36b02597c90804c3a5b96df2093e6ffd43844114"
  }),
  Object.freeze({
    path: "specs/aos-trace.schema.json",
    bytes_sha256: "e4c8a2a57e20e2c9c184c8fd0d8d29ff60d152009301b36bc5d65807253323bc",
    canonical_sha256: "f2bb47e579e233ee27e48b250932d4ad0a4d1172ec23f830fc2854ee6b7ae96a"
  }),
  Object.freeze({
    path: "specs/events.v0.json",
    bytes_sha256: "d08720122b279235f97096321ef9683555170266992c8e84b4e5309d9df86668",
    canonical_sha256: "989748c9e44a054a7f5ea54fb82c42f5624ec174263c9d8068a6ebf62bd0d620"
  }),
  Object.freeze({
    path: "specs/opportunity-profile.schema.json",
    bytes_sha256: "ee7a6ce0a1b5aec0975810176fe3fc11a93c5403e7cdab7e34618af252069913",
    canonical_sha256: "81d57c2f7eecdf6d13b9c5e031821dc315cf073ca49a36da2d15f84344c302df"
  })
]);

// Pinned for the same reason: editing one recorded digest must break this too.
export const SPEC_DIGEST_MANIFEST_SHA256 =
  "4dddc107730066725d596ca5ecd9e3b0dfad5e29458339a54f6dc6c8a7e48739";

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

export const digestSpecText = (text) => {
  const normalized = normalizeLf(text);
  return {
    bytes_sha256: sha256Hex(normalized),
    canonical_sha256: sha256Hex(canonicalJsonBytes(JSON.parse(normalized)))
  };
};

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

const defaultReadSpec = (path) => readFileSync(resolve(root, path), "utf8");

export const verifySpecDigests = ({ readSpec = defaultReadSpec, manifest = SPEC_DIGEST_MANIFEST } = {}) => {
  const errors = [];
  const entries = Array.isArray(manifest) ? manifest : [];
  if (!Array.isArray(manifest)) errors.push("MANIFEST_MALFORMED the digest manifest must be an array");

  const declared = entries.map((entry) => (isPlainRecord(entry) ? entry.path : String(entry)));
  for (const path of GATED_SPEC_PATHS) {
    if (!declared.includes(path)) {
      errors.push(`MANIFEST_INCOMPLETE ${path} is gated but carries no recorded digest`);
    }
  }
  for (const path of declared) {
    if (!GATED_SPEC_PATHS.includes(path)) {
      errors.push(`MANIFEST_INCOMPLETE ${path} is recorded but is not a gated document`);
    }
  }

  let checked = 0;
  for (const entry of entries) {
    if (!isPlainRecord(entry) || typeof entry.path !== "string") {
      errors.push("MANIFEST_MALFORMED a manifest entry must record a path and its digests");
      continue;
    }
    if (!DIGEST_SHAPE.test(entry.bytes_sha256) || !DIGEST_SHAPE.test(entry.canonical_sha256)) {
      errors.push(`MANIFEST_MALFORMED ${entry.path} must record 64-character lowercase hex digests`);
      continue;
    }
    let text;
    try {
      text = readSpec(entry.path);
    } catch (error) {
      errors.push(`SPEC_UNREADABLE ${entry.path} could not be read: ${String(error)}`);
      continue;
    }
    let computed;
    try {
      computed = digestSpecText(text);
    } catch (error) {
      errors.push(`SPEC_UNREADABLE ${entry.path} is not parseable JSON: ${String(error)}`);
      continue;
    }
    checked += 1;
    if (computed.bytes_sha256 !== entry.bytes_sha256) {
      errors.push(
        `DIGEST_MISMATCH ${entry.path} bytes recorded ${entry.bytes_sha256} but computed ${computed.bytes_sha256}`
      );
    }
    if (computed.canonical_sha256 !== entry.canonical_sha256) {
      errors.push(
        `DIGEST_MISMATCH ${entry.path} canonical recorded ${entry.canonical_sha256} but computed ${computed.canonical_sha256}`
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

export const loadSpecRegistry = ({ readSpec = defaultReadSpec } = {}) => {
  const byTitle = {};
  const byId = {};
  const errors = [];
  for (const path of GATED_SPEC_PATHS) {
    let document;
    try {
      document = JSON.parse(normalizeLf(readSpec(path)));
    } catch (error) {
      errors.push(`SPEC_UNREADABLE ${path} could not be loaded: ${String(error)}`);
      continue;
    }
    // events.v0.json is a registry rather than a JSON Schema and carries contract_id.
    const key = typeof document.title === "string" ? document.title : document.contract_id;
    if (typeof key !== "string") {
      errors.push(`SPEC_UNREADABLE ${path} declares neither title nor contract_id`);
      continue;
    }
    byTitle[key] = document;
    if (typeof document.$id === "string") byId[document.$id] = document;
  }
  return { byTitle, byId, errors };
};

const jsonType = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
};

const typeAdmits = (declared, value) => {
  const allowed = typeof declared === "string" ? [declared] : Array.isArray(declared) ? declared : null;
  if (allowed === null) return true;
  const actual = jsonType(value);
  if (allowed.includes(actual)) return true;
  // JSON Schema treats an integer-valued number as admissible where "number" is declared.
  return actual === "integer" && allowed.includes("number");
};

const resolveRef = (ref, baseId, rootSchema, registry) => {
  if (ref.startsWith("#")) {
    let cursor = rootSchema;
    for (const rawSegment of ref.slice(1).split("/").filter(Boolean)) {
      const segment = rawSegment.split("~1").join("/").split("~0").join("~");
      if (!isPlainRecord(cursor) && !Array.isArray(cursor)) return null;
      cursor = cursor[segment];
    }
    return cursor ?? null;
  }
  const byId = registry && registry.byId ? registry.byId : {};
  if (byId[ref]) return byId[ref];
  if (typeof baseId === "string") {
    try {
      const absolute = new URL(ref, baseId).href;
      if (byId[absolute]) return byId[absolute];
    } catch {
      return null;
    }
  }
  return null;
};

const validateNode = (value, schema, context, pointer, errors) => {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push(`ADDITIONAL_PROPERTY ${pointer} is not admitted by the schema`);
    return;
  }
  if (!isPlainRecord(schema)) {
    errors.push(`SCHEMA_INVALID ${pointer} is governed by a malformed subschema`);
    return;
  }

  if (typeof schema.$ref === "string") {
    const target = resolveRef(schema.$ref, context.baseId, context.rootSchema, context.registry);
    if (target === null) {
      errors.push(`REF_UNRESOLVED ${pointer} cannot resolve ${schema.$ref}`);
      return;
    }
    const nextBase = isPlainRecord(target) && typeof target.$id === "string" ? target.$id : context.baseId;
    const nextRoot = isPlainRecord(target) && typeof target.$id === "string" ? target : context.rootSchema;
    validateNode(value, target, { ...context, baseId: nextBase, rootSchema: nextRoot }, pointer, errors);
    return;
  }

  if (Object.hasOwn(schema, "type") && !typeAdmits(schema.type, value)) {
    errors.push(
      `TYPE ${pointer} expected ${[].concat(schema.type).join("|")} but found ${jsonType(value)}`
    );
    return;
  }
  if (Object.hasOwn(schema, "const") && canonicalJsonBytes(value) !== canonicalJsonBytes(schema.const)) {
    errors.push(`CONST ${pointer} must equal ${canonicalJsonBytes(schema.const)}`);
  }
  if (Array.isArray(schema.enum)) {
    const encoded = canonicalJsonBytes(value);
    if (!schema.enum.some((allowed) => canonicalJsonBytes(allowed) === encoded)) {
      errors.push(`ENUM ${pointer} is outside the declared enumeration`);
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`MIN_LENGTH ${pointer} is shorter than ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`MAX_LENGTH ${pointer} is longer than ${schema.maxLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`PATTERN ${pointer} does not match ${schema.pattern}`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`MINIMUM ${pointer} is below ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`MAXIMUM ${pointer} is above ${schema.maximum}`);
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      errors.push(`EXCLUSIVE_MINIMUM ${pointer} must be above ${schema.exclusiveMinimum}`);
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      errors.push(`EXCLUSIVE_MAXIMUM ${pointer} must be below ${schema.exclusiveMaximum}`);
    }
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
      const quotient = value / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient))) {
        errors.push(`MULTIPLE_OF ${pointer} is not a multiple of ${schema.multipleOf}`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`MIN_ITEMS ${pointer} holds fewer than ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`MAX_ITEMS ${pointer} holds more than ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => {
        validateNode(entry, schema.items, context, `${pointer}/${index}`, errors);
      });
    }
  }

  if (isPlainRecord(value)) {
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(value, name)) {
        errors.push(`REQUIRED_MISSING ${pointer}/${name} is required`);
      }
    }
    const properties = isPlainRecord(schema.properties) ? schema.properties : {};
    for (const name of Object.keys(value).sort()) {
      if (Object.hasOwn(properties, name)) {
        validateNode(value[name], properties[name], context, `${pointer}/${name}`, errors);
        continue;
      }
      if (schema.additionalProperties === false) {
        errors.push(`ADDITIONAL_PROPERTY ${pointer}/${name} is not declared by the schema`);
        continue;
      }
      if (isPlainRecord(schema.additionalProperties)) {
        validateNode(value[name], schema.additionalProperties, context, `${pointer}/${name}`, errors);
      }
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const outcomes = schema.oneOf.map((branch) => {
      const branchErrors = [];
      validateNode(value, branch, context, pointer, branchErrors);
      return { branch, branchErrors };
    });
    const matched = outcomes.filter(({ branchErrors }) => branchErrors.length === 0);
    if (matched.length !== 1) {
      errors.push(`ONE_OF ${pointer} matched ${matched.length} of ${schema.oneOf.length} branches`);
      // Report the single type-compatible branch's own errors so a violation inside a
      // branch is attributable. With zero or several candidates there is no honest
      // attribution, so only the ONE_OF failure is reported.
      const candidates = outcomes.filter(
        ({ branch }) => !isPlainRecord(branch) || !Object.hasOwn(branch, "type") || typeAdmits(branch.type, value)
      );
      if (matched.length === 0 && candidates.length === 1) {
        errors.push(...candidates[0].branchErrors);
      }
    }
  }
};

export const validateDocument = (document, schema, registry) => {
  const errors = [];
  if (!isPlainRecord(schema)) {
    return { ok: false, errors: ["SCHEMA_INVALID # no schema was supplied"] };
  }
  const context = {
    registry: registry ?? { byId: {}, byTitle: {} },
    rootSchema: schema,
    baseId: typeof schema.$id === "string" ? schema.$id : undefined
  };
  validateNode(document, schema, context, "#", errors);
  return { ok: errors.length === 0, errors };
};

const DIGEST = "a".repeat(64);
const RUN_ID = "run-e1-003";

const traceEvent = (extra = {}) => ({
  event_id: "evt-1",
  run_id: RUN_ID,
  task_id: null,
  timestamp: "2026-08-19T00:00:00.000Z",
  actor: "agent",
  event_type: "assessment.started",
  event_group: "run_lifecycle",
  parent_id: null,
  correlation_id: "corr-e1-003",
  identity: "codex|gpt-5.6-sol|aos-controlled-wrapper-v0",
  evidence_digest: DIGEST,
  redaction_state: "none",
  payload: null,
  ...extra
});

const trace = (extra = {}) => ({
  schema_id: "aos-trace",
  schema_version: "aos-trace.schema.v0",
  run_id: RUN_ID,
  events: [traceEvent()],
  ...extra
});

const profile = (extra = {}) => ({
  suite: "coding-core-v0",
  family: "six-family",
  form_version: "A",
  language: "typescript",
  runtime: "codex",
  adapter_version: "aos-controlled-wrapper-v0",
  model_id: "gpt-5.6-sol",
  model_revision: "2026-08-08",
  reasoning_settings: "default",
  harness_profile: "native",
  harness_digest: DIGEST,
  skill_hook_mcp: "none",
  skill_hook_mcp_digest: DIGEST,
  tool_surface: "standard",
  permission_profile: "restricted",
  network_profile: "deny-all",
  context_budget: "standard",
  token_budget: "standard",
  time_budget: "45m",
  tool_call_budget: "standard",
  intervention_policy: "declared-takeover-only",
  repository_digest: DIGEST,
  environment_digest: DIGEST,
  ...extra
});

const result = (extra = {}) => ({
  schema_id: "aos-result",
  schema_version: "aos-result.schema.v0",
  run_id: RUN_ID,
  status: "EXPERIMENTAL / PROVISIONAL",
  score: { raw: 78.4, display: 80 },
  factors: { F1: 0.75, F2: 0.75, F3: 0.75, F4: 0.5, F5: 0.8, F6: 0.4 },
  safety: { level: "S0", state: "SAFE" },
  coverage: 0.86,
  score_digest: DIGEST,
  scorer_digest: DIGEST,
  suite_digest: DIGEST,
  adapter_digest: DIGEST,
  declared_manual_takeover: false,
  external_mutation: false,
  attribution: "agent",
  attribution_confidence: 1,
  retest_type: "none",
  comparison_eligible: false,
  opportunity_profile: profile(),
  limitations: "EXPERIMENTAL / PROVISIONAL. No percentile. Matched N<300.",
  ...extra
});

const accept = (id, schema, document) => Object.freeze({ id, schema, expect: "accept", reason: null, document });
const reject = (id, schema, reason, document) => Object.freeze({ id, schema, expect: "reject", reason, document });

const withoutKey = (document, key) => {
  const copy = { ...document };
  delete copy[key];
  return copy;
};

export const CONFORMANCE_CORPUS = Object.freeze([
  accept("trace/minimal-accept", "aos-trace", trace()),
  accept(
    "trace/attribution-accept",
    "aos-trace",
    trace({
      events: [
        traceEvent(),
        traceEvent({
          event_id: "evt-2",
          parent_id: "evt-1",
          actor: "actor.attribution_unknown",
          event_type: "actor.attribution_unknown",
          event_group: "attribution",
          provenance: "wrapper-inferred",
          confidence: 0.5,
          from_actor: "agent",
          to_actor: "actor.attribution_unknown",
          redaction_state: "redacted",
          payload: "[redacted]"
        })
      ]
    })
  ),
  reject("trace/unknown-field", "aos-trace", "ADDITIONAL_PROPERTY", trace({ produced_at: "2026-08-19" })),
  reject("trace/missing-run-id", "aos-trace", "REQUIRED_MISSING", withoutKey(trace(), "run_id")),
  reject("trace/empty-events", "aos-trace", "MIN_ITEMS", trace({ events: [] })),
  reject(
    "trace/oversized-payload",
    "aos-trace",
    "MAX_LENGTH",
    trace({ events: [traceEvent({ payload: "x".repeat(2049) })] })
  ),
  reject("trace/bad-actor", "aos-trace", "ENUM", trace({ events: [traceEvent({ actor: "nobody" })] })),
  reject(
    "trace/bad-timestamp",
    "aos-trace",
    "PATTERN",
    trace({ events: [traceEvent({ timestamp: "2026-08-19" })] })
  ),
  reject(
    "trace/confidence-not-dropped",
    "aos-trace",
    "EXCLUSIVE_MAXIMUM",
    trace({
      events: [traceEvent({ actor: "actor.attribution_unknown", provenance: "wrapper-inferred", confidence: 0.7 })]
    })
  ),
  reject("trace/task-id-wrong-type", "aos-trace", "TYPE", trace({ events: [traceEvent({ task_id: 42 })] })),

  accept("result/issuable-accept", "aos-result", result()),
  accept(
    "result/diagnostic-accept",
    "aos-result",
    result({
      status: "DIAGNOSTIC ONLY",
      score: null,
      score_digest: null,
      attribution: "actor.attribution_unknown",
      attribution_confidence: 0.5
    })
  ),
  reject("result/percentile-field", "aos-result", "ADDITIONAL_PROPERTY", result({ percentile: 99 })),
  reject("result/bad-status", "aos-result", "ENUM", result({ status: "PASS" })),
  reject(
    "result/display-not-multiple-of-five",
    "aos-result",
    "MULTIPLE_OF",
    result({ score: { raw: 78.4, display: 78 } })
  ),
  reject("result/coverage-out-of-range", "aos-result", "MAXIMUM", result({ coverage: 1.5 })),
  reject("result/factor-out-of-range", "aos-result", "MINIMUM", result({
    factors: { F1: -0.1, F2: 0.75, F3: 0.75, F4: 0.5, F5: 0.8, F6: 0.4 }
  })),
  reject("result/bad-digest", "aos-result", "PATTERN", result({ scorer_digest: "not-a-digest" })),
  reject("result/wrong-schema-id", "aos-result", "CONST", result({ schema_id: "aos-trace" })),
  reject("result/score-wrong-type", "aos-result", "ONE_OF", result({ score: 78.4 })),
  reject(
    "result/missing-profile",
    "aos-result",
    "REQUIRED_MISSING",
    withoutKey(result(), "opportunity_profile")
  ),
  reject(
    "result/profile-unknown-field",
    "aos-result",
    "ADDITIONAL_PROPERTY",
    result({ opportunity_profile: profile({ operator_name: "isaac" }) })
  ),

  accept("profile/accept", "opportunity-profile", profile()),
  reject("profile/short-string", "opportunity-profile", "MIN_LENGTH", profile({ suite: "" }))
]);

const deriveCensus = (corpus) => {
  const census = { total: 0, positive: 0, negative: 0, by_schema: {} };
  for (const fixture of corpus) {
    const schema = fixture.schema;
    if (!census.by_schema[schema]) census.by_schema[schema] = { total: 0, positive: 0, negative: 0 };
    census.total += 1;
    census.by_schema[schema].total += 1;
    const side = fixture.expect === "accept" ? "positive" : "negative";
    census[side] += 1;
    census.by_schema[schema][side] += 1;
  }
  return census;
};

export const CORPUS_CENSUS = Object.freeze(deriveCensus(CONFORMANCE_CORPUS));

// Every schema the corpus must exercise from both sides. A schema that quietly loses its
// fixtures is the same defect as an empty corpus, one level down.
const CENSUS_REQUIRED_SCHEMAS = Object.freeze(["aos-result", "aos-trace", "opportunity-profile"]);

export const runSchemaConformance = ({
  corpus = CONFORMANCE_CORPUS,
  census = CORPUS_CENSUS,
  manifest = SPEC_DIGEST_MANIFEST,
  readSpec = defaultReadSpec,
  nodeVersion = process.versions.node
} = {}) => {
  const errors = [];

  const supported = isSupportedNodeVersion(nodeVersion);
  if (!supported) {
    errors.push(`UNSUPPORTED_RUNTIME node ${String(nodeVersion)} is outside ${SUPPORTED_NODE_RANGE}`);
  }

  const digests = verifySpecDigests({ readSpec, manifest });
  errors.push(...digests.errors);

  const registry = loadSpecRegistry({ readSpec });
  errors.push(...registry.errors);

  const fixtures = Array.isArray(corpus) ? corpus : [];
  if (!Array.isArray(corpus)) errors.push("CORPUS_MALFORMED the corpus must be an array of fixtures");

  const derived = deriveCensus(fixtures);
  if (derived.total === 0) errors.push("ZERO_FIXTURE the conformance corpus is empty");
  if (derived.positive === 0) errors.push("ZERO_FIXTURE the conformance corpus holds no positive fixture");
  if (derived.negative === 0) errors.push("ZERO_FIXTURE the conformance corpus holds no negative fixture");
  for (const schema of CENSUS_REQUIRED_SCHEMAS) {
    const counts = derived.by_schema[schema];
    if (!counts) {
      errors.push(`ZERO_FIXTURE ${schema} has no fixture in the conformance corpus`);
      continue;
    }
    if (counts.positive === 0) errors.push(`ZERO_FIXTURE ${schema} has no positive fixture`);
    if (counts.negative === 0) errors.push(`ZERO_FIXTURE ${schema} has no negative fixture`);
  }
  if (census !== null && census !== undefined && canonicalJsonBytes(derived) !== canonicalJsonBytes(census)) {
    errors.push(
      `CENSUS_MISMATCH declared ${canonicalJsonBytes(census)} but the corpus is ${canonicalJsonBytes(derived)}`
    );
  }

  for (const fixture of fixtures) {
    const schema = registry.byTitle[fixture.schema];
    if (!schema) {
      errors.push(`UNKNOWN_SCHEMA ${fixture.id} names ${String(fixture.schema)}, which is not a gated document`);
      continue;
    }
    const verdict = validateDocument(fixture.document, schema, registry);
    if (fixture.expect === "accept") {
      if (!verdict.ok) {
        errors.push(`POSITIVE_FIXTURE_REJECTED ${fixture.id} was refused: ${verdict.errors.join("; ")}`);
      }
      continue;
    }
    if (verdict.ok) {
      errors.push(`NEGATIVE_FIXTURE_ACCEPTED ${fixture.id} was accepted by ${fixture.schema}`);
      continue;
    }
    if (!verdict.errors.some((entry) => entry.startsWith(`${fixture.reason} `))) {
      errors.push(
        `NEGATIVE_FIXTURE_REASON_MISMATCH ${fixture.id} declared ${String(fixture.reason)} but was refused for: ${verdict.errors.join("; ")}`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    census: derived,
    digest_manifest_sha256: digests.manifest_sha256,
    runtime: { node: nodeVersion, supported, range: SUPPORTED_NODE_RANGE }
  };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = runSchemaConformance();
  if (!run.ok) {
    console.error(`SCHEMA_CONFORMANCE_FAIL ${run.errors.length}`);
    for (const error of run.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `SCHEMA_CONFORMANCE_PASS specs=${GATED_SPEC_PATHS.length} fixtures=${run.census.total} positive=${run.census.positive} negative=${run.census.negative} manifest_sha256=${run.digest_manifest_sha256} node=${run.runtime.node}`
  );
}
