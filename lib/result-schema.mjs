import { readFileSync } from "node:fs";

import { canonicalJson, sha256Value } from "./core.mjs";
import { fileByteDigest } from "./digest.mjs";
import { validateAgainstSchema } from "./json-schema.mjs";
import { CLAIM_STAGES, comparability, contractDigests, contractFileDigests, shippedEcdContract } from "./ecd-contract.mjs";
import { METRICS } from "./metrics.mjs";

// The canonical result: three profiles and one secondary index, built from what the #582 contract
// issued and from nothing else.
//
// This module replaces the single Operator Score as the thing a run produces. The number that used
// to sit at the top of every report folded the operator's decisions and the model's output into one
// figure, so a stronger model made the operator look better and a worse delegation made the model
// look worse. The split here is the whole point: `operator_process_profile` moves only when an
// operator-process cell moves, `system_outcome_profile` moves only when a system-outcome cell moves,
// and the composite that puts them side by side is labelled secondary because it is one.
//
// Every arithmetic in this file is an equal-weight mean that refuses to run over a gap. A withheld
// construct withholds its index; a withheld index withholds the composite; nothing missing is ever
// averaged as a zero. The renderers downstream get `projectResult`, which is strings, so that no
// renderer owns a formula of its own -- a report that recomputed would be a second scorer.
//
// What this module does not do, on purpose: compute a reliance metric (#583 owns the ten metrics;
// this file carries their seam and refuses a metric below the operational floor), decide a cap
// (#566 owns the cap policy; this file applies a cap it is handed to the surfaces a cap may touch
// and to no other), or estimate uncertainty and generalizability (#584; the honest defaults are
// carried through). And it never reads a legacy result: a record written under the old schema is
// rendered by the stored legacy scorer as the record it is, and is not back-computed into this one.

export const RESULT_SCHEMA_ID = "aos-result.v2";
export const RESULT_SCHEMA_VERSION = "2.0.0";
export const LEGACY_RESULT_SCHEMA_ID = "aos-mvp-result.v1";
export const RESULT_SCHEMA_URL = new URL("../schemas/aos-result.v2.schema.json", import.meta.url);
export const AGGREGATION_VECTORS_URL = new URL("../fixtures/scoring/profile-aggregation-vectors.v1.json", import.meta.url);

export const COMPOSITE_FORMULA = "aos-composite.v1";
export const COMPOSITE_WEIGHTS = Object.freeze({ operator_process: 0.5, system_outcome: 0.5 });

// The issue's text, character for character. The en dash in the third label is not a typo to be
// normalised: "operator–agent" names a pair, and the label is matched verbatim by the tests.
export const LABELS = Object.freeze({
  operator_process: "PROFILE-BOUND OPERATOR PROCESS INDEX",
  system_outcome: "PROFILE-BOUND SYSTEM OUTCOME INDEX",
  aos_composite: "PROFILE-BOUND OPERATOR–AGENT SYSTEM PERFORMANCE"
});

// SSOT section 21: the ten reliance metrics, carried here as a surface and computed by #583. Four
// is the operational floor a denominator has to reach before a ratio over it may be issued.
export const RELIANCE_METRIC_IDS = Object.freeze([
  "cair", "csr", "overreliance", "underreliance", "switch_gain", "switch_harm",
  "delegation_regret", "adoption_quality", "choice_independence", "confidence_calibration"
]);
export const RELIANCE_FLOOR = 4;
export const RELIANCE_STATUSES = Object.freeze(["WITHHELD", "PARTIAL", "ISSUED"]);
const RELIANCE_METRIC_STATUSES = Object.freeze(["ISSUED", "NOT_COMPUTED", "WITHHELD"]);
const SURFACE_KEYS = Object.freeze(["operator_process_profile", "reliance_calibration_profile", "system_outcome_profile", "aos_composite"]);
// A digest over bytes, or nothing. `sha256:a` is a label, and a label cannot bind an exact profile.
const PROFILE_DIGEST_TEXT = /^sha256:[0-9a-f]{64}$/u;

export const CAP_SCOPES = Object.freeze(["system_outcome", "aos_composite"]);
export const GENERALIZABILITY_STATUSES = Object.freeze(["UNESTABLISHED", "ESTABLISHED"]);
export const UNCERTAINTY_STATUSES = Object.freeze(["INSUFFICIENT_DATA", "NOT_COMPUTED", "COMPUTED"]);

export const SECTION_ORDER = Object.freeze(["operator_process", "reliance_calibration", "system_outcome", "aos_composite", "claim"]);
export const SECTION_TITLES = Object.freeze({
  operator_process: "Operator Process Profile",
  reliance_calibration: "Reliance Calibration Profile",
  system_outcome: "System Outcome Profile",
  aos_composite: "Operator–Agent System Performance (secondary)",
  claim: "Claim, Uncertainty & Generalizability"
});
export const SECONDARY_NOTE = "secondary descriptive index · not a human ability score";

const deepFreeze = (value) => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
};

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// --- aggregation -----------------------------------------------------------------------------

/**
 * The equal-weight mean of issued rows, on 0-100, or the reason there is none.
 *
 * Every row weighs the same because the contract says so: a construct with more cells, or a domain
 * with more opportunities, does not get a larger say. One row short and the whole index is withheld
 * rather than averaged over what is left -- averaging the remainder is how observing less raises a
 * number, which is the defect the dimension-level scorer had to be fixed for.
 *
 * A row that says ISSUED and carries no number is a contradiction and is thrown, not zeroed.
 */
export function equalWeightIndex(rows) {
  if (!Array.isArray(rows)) throw new Error("AOS_INVALID_ROWS equalWeightIndex takes an array of { id, estimate, status } rows");
  const withheld = [];
  let total = 0;
  for (const row of rows) {
    if (row.status === "ISSUED") {
      if (!isFiniteNumber(row.estimate)) throw new Error(`AOS_ISSUED_WITHOUT_ESTIMATE ${row.id} is ISSUED and carries no estimate`);
      total += row.estimate;
      continue;
    }
    withheld.push(row.id);
  }
  if (rows.length === 0 || withheld.length > 0) return deepFreeze({ value: null, issued: false, withheld_for: withheld });
  return deepFreeze({ value: (100 * total) / rows.length, issued: true, withheld_for: [] });
}

/**
 * `aos-composite.v1`: the arithmetic mean of the two indices, 50:50, and nothing when either is
 * withheld. SSOT section 20 fixes the formula; reliance is not in it because reliance explains C3
 * and C3 is already in the process index -- a reliance term here would count it twice.
 */
export function compositeOf(processIndex, outcomeIndex) {
  const withheld = [];
  if (!isFiniteNumber(processIndex)) withheld.push("operator_process");
  if (!isFiniteNumber(outcomeIndex)) withheld.push("system_outcome");
  if (withheld.length > 0) return deepFreeze({ value: null, issued: false, withheld_for: withheld });
  return deepFreeze({ value: (processIndex + outcomeIndex) / 2, issued: true, withheld_for: [] });
}

/**
 * The outcome domains, read from the contract that declares them.
 *
 * The grouping is not this module's to invent. #582's construct map is the one place a cell's
 * meaning is written down, so O1-O4 and their membership are declared there and read here; a
 * grouping hardcoded in this file would be a second mapping of the same cells, and swapping two
 * cells between two domains would move the outcome index with nothing to check it against.
 *
 * What is checked here is that the declaration covers exactly the contract's own required,
 * credit-bearing system-outcome cells outside the longitudinal lane: a cell with no domain would be
 * a cell the outcome index quietly ignored, and a domain naming a cell the contract does not have
 * would be a domain that could never issue.
 */
export function outcomeDomains(contract = shippedEcdContract()) {
  const declared = contract.construct_map.outcome_domains?.domains;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error("AOS_OUTCOME_DOMAINS_UNDECLARED this contract declares no outcome domains, and the outcome index is not grouped by anything this module made up");
  }
  const longitudinal = new Set(contract.construct_map.longitudinal_lane.construct_ids);
  const expected = new Set(contract.cells.cells
    .filter((cell) => cell.axis === "system_outcome" && cell.required_for_construct && cell.credit_bearing && !longitudinal.has(cell.construct_id))
    .map((cell) => cell.cell_id));
  const claimed = declared.flatMap((domain) => domain.cell_ids);
  const drift = [
    ...claimed.filter((id) => !expected.has(id)).map((id) => `${id} is declared in a domain and is not a required credit-bearing system-outcome cell of this contract`),
    ...[...expected].filter((id) => !claimed.includes(id)).map((id) => `${id} is a required credit-bearing system-outcome cell of this contract and no domain names it`)
  ];
  if (new Set(claimed).size !== claimed.length) drift.push("a cell is named by more than one domain");
  if (drift.length > 0) throw new Error(`AOS_OUTCOME_DOMAIN_DRIFT ${drift.join("; ")}`);
  return declared.map((domain) => deepFreeze({ domain_id: domain.domain_id, title: domain.title, cell_ids: [...domain.cell_ids] }));
}

// --- what may be published -------------------------------------------------------------------

// The result is the artifact an operator publishes: it goes into a repository, an issue, a report
// somebody forwards. Whatever the caller hands it that is not a declared field of a declared shape
// is therefore carried as a digest of itself rather than verbatim. A digest still binds the record
// to what produced it, and a reader can check one they hold; a provider token or a path under
// somebody's home directory published in a report is neither of those things and cannot be recalled.

// The form this module's own digest function emits, and nothing else. Sixty-four hex characters
// on their own are not evidence that a value was ever hashed: an `api_credential` facet of
// `"a".repeat(64)` matched the old spelling, was "normalised" by prefixing it, and went out as
// `sha256:aaaa...` with every character of the secret still in it. Shape cannot answer "has this
// been hashed"; only the marker this module writes can, so that marker is the whole rule. It has
// to be accepted on the way in as well as out, because a result is rebuilt from observations that
// already carry digested values and re-hashing them would make the rebuild disagree with the
// record it is checking.
const DIGEST_TEXT = /^sha256:[0-9a-f]{64}$/u;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;
/**
 * One question, asked once: is this a filesystem location of any kind?
 *
 * Every round of review has found the next spelling the previous rule did not list -- one segment,
 * then two slashes, then a UNC share. So the predicate is written as the whole class rather than as
 * the forms somebody remembered: anything rooted at a filesystem, from a home directory, from a
 * drive letter, from a UNC host, or named by a `file:` URL. Relative paths are deliberately outside
 * it: "lib/result-schema.mjs" names a file in this repository and identifies nobody.
 */
// A path character is what a path segment is spelled out of; everything else is a boundary, and
// that is the whole rule. A root that begins after a colon -- `workspace:/Users/alice/private.txt`
// -- is a root, and one that begins after a letter -- `lib/result-schema.mjs` -- is a relative path
// naming a file in this repository. The previous spelling listed the separators somebody
// remembered (whitespace, quote, `=`, `(`, `,`, `[`) and a path pasted after a colon walked out
// verbatim, which is the same class of miss as listing the credential formats somebody remembered.
const PATH_CHARACTER = "A-Za-z0-9._~";
const NOT_PATH = `(?:^|[^${PATH_CHARACTER}\\\\/-])`;
const FILESYSTEM_LOCATION = new RegExp([
  "(?:",
  `${NOT_PATH}file:\\/\\/`,                    // a file URL, with or without a host
  // `//host` is also how every URL spells its authority, so this alternative alone keeps the narrow
  // boundary: after a scheme's colon it is a URL, and a URL is not a place on this machine.
  "|(?:^|[\\s\"'`=(,\\[])\\/\\/[A-Za-z0-9._~-]", // //server/share -- POSIX double slash and SMB alike
  `|${NOT_PATH}\\\\\\\\[A-Za-z0-9._~-]`,        // \\server\share -- a Windows UNC path
  `|${NOT_PATH}~(?:[\\/\\\\]|$)`,               // a home directory, with or without a trailing path
  `|${NOT_PATH}[A-Za-z]:[\\/\\\\]`,             // C:\ or C:/ -- a drive letter is a root
  `|${NOT_PATH}\\/[A-Za-z0-9._~-]`,             // /private -- one segment is a place on this machine
  ")"
].join(""), "u");
// The shapes credentials come in, in two halves.
//
// The first is a word that names one followed by something that looks like one: sixteen characters
// or more, and carrying a digit. The digit is what separates a secret from English -- "the token
// was observed" is prose, and so is `authoritative-source-selected`, which is a subcheck this
// product declares and which the rule without that clause digested because "auth" starts it. A
// sanitiser that eats the instrument's own vocabulary is not safe, it is broken in the direction
// nobody notices until a report is missing its words.
const CREDENTIAL_TEXT = /(?:sk|pk|api|access|auth|token|secret|passwd|password|bearer|private|key)[-_]?[=:]?\s?(?=[A-Za-z0-9][A-Za-z0-9_-]{15,})(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9][A-Za-z0-9_-]{15,}/iu;
// The same thing said outright. `password=hunter2` is a credential at seven characters, and the
// length floor above -- which exists to keep "the token was observed" as prose -- let it through.
// Assignment removes the ambiguity that the floor was compensating for: a word that names a secret,
// an `=` or a `:`, and a value is a secret however short the value is.
const SECRET_WORD = "(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[-_]?key|access[-_]?key|secret[-_]?key|private[-_]?key|credential|bearer|auth[-_]?token|session[-_]?key)";
const CREDENTIAL_ASSIGNMENT = new RegExp(`\\b${SECRET_WORD}\\b\\s*[=:]\\s*\\S`, "iu");
// The same thing with nothing but a space between the word and the value. `database password
// hunter2` names a secret and hands it over, and the assignment rule and the length floor let it
// through between them. The digit this rule first asked for was the length floor's heuristic
// borrowed one layer up, and it drew the line in the wrong place: `database password
// correcthorsebatterystaple` has no digit in it and is still the secret. A word that names a
// secret, a space, and a value is the whole rule -- an operator writing a note does not type an
// equals sign before the thing that must not be published, and does not choose a passphrase to
// suit a regular expression.
const CREDENTIAL_SPACED = new RegExp(`\\b${SECRET_WORD}\\b\\s+[A-Za-z0-9][A-Za-z0-9._/+-]{3,}`, "iu");
// The second is a URL that carries who you are in it. `postgresql://alice:hunter2@db/prod` is a
// credential whatever the scheme is, and no English word names it -- the userinfo is the secret,
// so the predicate is "a URL with userinfo" rather than a list of the schemes people use.
const URL_USERINFO = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#@]+@/u;
// The third is the formats the providers actually issue, which carry their own prefix and need no
// English word beside them: an AWS key id says what it is and nothing else in a result looks like
// one. `AKIAIOSFODNN7EXAMPLE` walked through the word rule because no word named it.
const CREDENTIAL_FORMAT = new RegExp([
  "(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{12,}",              // AWS access key ids
  "gh[pousr]_[A-Za-z0-9]{20,}",                         // GitHub tokens
  "github_pat_[A-Za-z0-9_]{20,}",
  "sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}",   // OpenAI, Anthropic, Stripe-style secrets
  "rk_(?:live|test)_[A-Za-z0-9]{16,}",
  "xox[abposr]-[A-Za-z0-9-]{10,}",                      // Slack
  "AIza[0-9A-Za-z_-]{30,}",                             // Google API keys
  "ya29\\.[0-9A-Za-z_-]{20,}",                           // Google OAuth
  "glpat-[A-Za-z0-9_-]{16,}",                           // GitLab
  "npm_[A-Za-z0-9]{30,}",
  "eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]+",  // a signed JWT
  "-----BEGIN [A-Z ]*PRIVATE KEY-----"
].join("|"), "u");
// An unbroken run of letters and digits long enough to be an opaque key. Ids in this product are
// hyphenated in groups; a whole-string digest is excluded below because a digest is the safe form.
const OPAQUE_TOKEN = /[A-Za-z0-9]{32,}/u;

/**
 * Provenance is a fact about an object, not a pattern in a string.
 *
 * A published digest used to be recognised by its spelling -- `sha256:` and sixty-four hex
 * characters -- and a caller can type that. An `api_credential` facet of `"sha256:" + "a".repeat(64)`
 * was read as a value this module had already hashed and went out verbatim: the leak wearing the
 * label of the fix. No string can prove who produced it, so a value this module has sanitised is
 * carried in a box only this module can make. `publishedDeep` opens the boxes on the way out, and
 * anything not in one is a caller's value, whatever it looks like.
 */
// A String subclass, so a box reads as its own text everywhere this module inspects one on the way
// through -- `String(box)`, a regular expression, `canonicalJson` -- while `typeof` still says
// object, which is what keeps it out of every string branch of the gate.
class Sanitised extends String {}
const sanitised = (text) => new Sanitised(String(text));
const sanitisedMap = (record) => Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [key, sanitised(value)]));
const digestText = (value) => sanitised(`sha256:${sha256Value(value)}`);

// One spelling for one thing. Parts of this product write a digest as bare hex and parts write it
// prefixed, and a published result that carried both would be a result whose reader has to know
// which field is which. The prefix says what the hex is a digest under, so the prefixed form is the
// one that goes out, and a bare digest is normalised into it on the way rather than accepted as a
// second shape the schema then has to allow.
const BARE_DIGEST = /^[0-9a-f]{64}$/u;
const normalisedDigest = (value) => (typeof value === "string" && BARE_DIGEST.test(value) ? `sha256:${value}` : value);

/** Free text: kept as written unless it carries something that must not be published. */
const isUnsafeText = (text) => FILESYSTEM_LOCATION.test(text) || URL_USERINFO.test(text) ||
  CREDENTIAL_ASSIGNMENT.test(text) || CREDENTIAL_SPACED.test(text) || CREDENTIAL_TEXT.test(text) ||
  CREDENTIAL_FORMAT.test(text) || OPAQUE_TOKEN.test(text);

/**
 * The model identity record, published as the shape it is (#561).
 *
 * Not "boxed because this module made it": the record arrives from a caller, and labelling every
 * string in it as already-sanitised handed that caller a door into the published artefact that
 * nothing inspected -- a line reading `/Users/alice/private/credential.txt` went out verbatim
 * (#561 round 9). What is published is the fields this record has, each string through the same
 * gate as every other string on the result, with digests normalised first so a bare digest reads
 * as a digest rather than as an opaque token.
 */
const IDENTITY_AGENT_FIELDS = ["provenance", "cohort_provenance", "verification", "runtime_identity_digest", "runtime_identity_status", "runtime_identity_drifted", "claim_stage", "profile_bound_aggregation"];
const IDENTITY_FIELDS = [
  "schema_id", "profile_digest", "by_agent", "lines", "claim_stage", "run_diagnostic_permitted",
  "profile_bound_aggregation", "composite", "generalizability_status", "generalizability_until",
  "cross_model_comparison", "model_change_improvement_claim", "comparison_until"
];

const publishedIdentityValue = (value, republished) => {
  if (typeof value === "string") {
    const text = normalisedDigest(value);
    // Gated here, then boxed -- in that order. The gate is what makes the string safe; the box is
    // what stops the outer gate from inspecting it a second time, where `sha256:<hex>` reads as an
    // opaque token and is replaced by a digest of itself. That double pass is how the record came
    // to disagree with the result it describes. A caller-supplied digest that is not real is a
    // wrong digest, not a leak, and every consumer recomputes it anyway.
    if (DIGEST_TEXT.test(text)) return sanitised(text);
    // A digest inside a sentence is a digest, not an opaque token. The record's lines are
    // sentences naming digests -- `Profile digest: sha256:<hex>` -- and gating them whole replaced
    // each with a digest of itself, so the stored projection stopped saying what the result said.
    // What is asked of the rest of the line is what is asked of any published text.
    const withoutDigests = text.replace(/sha256:[0-9a-f]{64}/gu, "");
    if (!isUnsafeText(withoutDigests)) return sanitised(text);
    return sanitised(String(publishedText(text, republished)));
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((entry) => publishedIdentityValue(entry, republished));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      String(publishedText(key, republished)),
      publishedIdentityValue(entry, republished)
    ]));
  }
  return null;
};

const publishedIdentity = (record, republished = false) => {
  if (!isPlainObject(record)) return null;
  // Maps, because the keys come from the record rather than from this file: agent ids are the
  // operator's, and a keyed store built as a plain object is the shape this repository refuses.
  const published = new Map();
  for (const field of IDENTITY_FIELDS) {
    if (!Object.hasOwn(record, field)) continue;
    if (field === "by_agent") {
      const agents = new Map();
      for (const [agentId, entry] of Object.entries(record.by_agent ?? {})) {
        if (!isPlainObject(entry)) continue;
        const kept = new Map();
        for (const key of IDENTITY_AGENT_FIELDS) {
          if (Object.hasOwn(entry, key)) kept.set(key, publishedIdentityValue(entry[key], republished));
        }
        agents.set(String(publishedText(agentId, republished)), Object.fromEntries(kept));
      }
      published.set("by_agent", Object.fromEntries(agents));
      continue;
    }
    published.set(field, publishedIdentityValue(record[field], republished));
  }
  return Object.fromEntries(published);
};

/**
 * `republished` is the other half of provenance, and it is a fact about the call rather than about
 * the value. A rebuild is handed a result this build already published: its digests are strings by
 * then, the boxes are long gone, and hashing them again would make the rebuild disagree with the
 * record it is checking. That path writes nothing -- `verify --run` compares and discards -- so
 * trusting the spelling there costs nothing, and it is the only place it is trusted.
 */
const publishedText = (value, republished = false) => {
  if (typeof value !== "string") return value;
  if (republished && DIGEST_TEXT.test(value)) return value;
  return isUnsafeText(value) ? digestText(value) : value;
};

const publishedDeep = (value, republished = false) => {
  // A box is this module's own output, opened here and never re-examined: the whole point of
  // carrying it is that its provenance does not depend on what the text inside looks like.
  if (value instanceof Sanitised) return String(value);
  if (typeof value === "string") return opened(publishedText(value, republished));
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : opened(digestText(String(value)));
  if (Array.isArray(value)) return value.map((entry) => publishedDeep(entry, republished));
  if (isPlainObject(value)) {
    // A Map, because the keys come from the caller too: a facet named after a path is a path.
    const entries = new Map();
    for (const [key, entry] of Object.entries(value)) entries.set(opened(publishedText(key, republished)), publishedDeep(entry, republished));
    return Object.fromEntries(entries);
  }
  return opened(digestText(String(value)));
};

const opened = (value) => (value instanceof Sanitised ? String(value) : value);

const conforms = (kind, value) => {
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "integer") return Number.isInteger(value);
  if (kind === "number") return isFiniteNumber(value);
  if (kind === "digest") return typeof value === "string" && DIGEST_TEXT.test(value);
  if (kind === "timestamp") return typeof value === "string" && TIMESTAMP_TEXT.test(value);
  if (kind === "token") return typeof value === "string" && SAFE_TOKEN.test(value) && !isUnsafeText(value);
  if (kind === "token_list") return Array.isArray(value) && value.length <= 64 && value.every((entry) => conforms("token", entry));
  if (kind === "text") return typeof value === "string" && !isUnsafeText(value);
  return false;
};

/**
 * One declared record, published.
 *
 * Declared keys keep their value when it has the declared shape and carry a digest of it when it
 * does not; undeclared keys are named in `redacted` and their values digested together into
 * `additional_digest`, so the record says that something was there and what it was called without
 * saying what it said. Digesting is idempotent: a digest conforms to `digest`, so building a result
 * from an already-published record leaves it unchanged.
 */
const publishedRecord = (record, fields, where, handledElsewhere = []) => {
  if (!isPlainObject(record)) throw new Error(`AOS_RECORD_SHAPE ${where} is an object`);
  // Maps, not plain objects: the keys come from whoever built the record, and a key called
  // `__proto__` written into an object literal writes through to Object.prototype.
  const kept = new Map();
  const extra = new Map();
  const redacted = [];
  const skip = new Set(["additional_digest", "redacted", ...handledElsewhere]);
  for (const [key, value] of Object.entries(record)) {
    if (skip.has(key)) continue;
    const kind = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (kind === undefined) {
      extra.set(key, value);
      redacted.push(key);
      continue;
    }
    const candidate = kind === "digest" ? normalisedDigest(value) : value;
    if (conforms(kind, candidate) || candidate === null) {
      // A field declared to hold a digest holds one: that decision is made here, by the record's
      // declared shape, and the value is boxed as this module's own so the gate does not have to
      // read it back off the string. Every other kind stays a caller's value and meets the gate.
      const publishable = kind === "digest" && candidate !== null ? sanitised(candidate) : candidate;
      kept.set(key, Array.isArray(publishable) ? [...publishable] : publishable);
      continue;
    }
    kept.set(key, digestText(value));
    redacted.push(key);
  }
  return {
    ...Object.fromEntries(kept),
    additional_digest: extra.size === 0 ? null : digestText(Object.fromEntries([...extra].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))),
    redacted: redacted.sort()
  };
};

// What a run may say about itself on a published result. Anything else about the run belongs in the
// store, where the operator keeps it, and not in the artifact they hand to somebody else.
const RUN_FIELDS = Object.freeze({
  run_id: "token", suite: "token", suite_digest: "digest", seed: "token", seeded_families: "token_list",
  forms_completed: "token_list", profile_digest: "digest", isolation_level: "token", scoring_permitted: "boolean",
  evidence_status: "token", safety_state: "token", agents_used: "token_list", invocation_count: "integer",
  fixture_backed_agents: "token_list", unrecognised_runtime_agents: "token_list", operator_plan_digest: "digest",
  operator_plan_authored: "boolean", started_at: "timestamp", ended_at: "timestamp", mode: "token"
});

const CAP_FIELDS = Object.freeze({ code: "token", max_value: "number", reason: "text" });
const CAP_TRIGGER_FIELDS = Object.freeze({
  trigger_id: "token", construct_or_domain_id: "token", cell_id: "token", observed: "boolean",
  observation_digest: "digest", legacy_metric_id: "token", subcheck_id: "token", verifier_id: "token",
  reason: "text", detail: "text"
});

// --- seams -----------------------------------------------------------------------------------

// --- seams -----------------------------------------------------------------------------------

const validateReliance = (reliance) => {
  const supplied = reliance ?? { status: "WITHHELD", metrics: {} };
  if (!isPlainObject(supplied)) throw new Error("AOS_RELIANCE_SHAPE reliance is an object with status and metrics");
  if (!RELIANCE_STATUSES.includes(supplied.status)) throw new Error(`AOS_RELIANCE_STATUS ${String(supplied.status)} is not one of ${RELIANCE_STATUSES.join(", ")}`);
  const given = supplied.metrics ?? {};
  if (!isPlainObject(given)) throw new Error("AOS_RELIANCE_SHAPE metrics is an object keyed by metric id");
  for (const id of Object.keys(given)) {
    if (!RELIANCE_METRIC_IDS.includes(id)) throw new Error(`AOS_RELIANCE_METRIC ${id} is not one of the ten reliance metrics`);
  }
  const metricOf = (id) => {
    const row = given[id];
    if (row === undefined) return { value: null, status: "NOT_COMPUTED", numerator: null, denominator: null };
    if (!isPlainObject(row) || !RELIANCE_METRIC_STATUSES.includes(row.status)) throw new Error(`AOS_RELIANCE_METRIC ${id} must carry a status of ${RELIANCE_METRIC_STATUSES.join(", ")}`);
    if (row.status !== "ISSUED") {
      if (row.value !== null && row.value !== undefined) throw new Error(`AOS_RELIANCE_METRIC ${id} is ${row.status} and may not carry a value`);
      // SSOT section 21 withholds the *rate* below the floor and keeps the raw counts: "1 of 3" is
      // not a reliance metric, but it is the evidence that says why there is none, and dropping it
      // left a reader unable to tell a metric with too few opportunities from one nobody computed.
      const counted = (count) => (Number.isInteger(count) && count >= 0 ? count : null);
      return { value: null, status: row.status, numerator: counted(row.numerator), denominator: counted(row.denominator) };
    }
    // SSOT section 21: a ratio over fewer than four opportunities is not a reliance metric, it is an
    // anecdote with a decimal point. Refused here rather than issued and flagged.
    if (!Number.isInteger(row.numerator) || !Number.isInteger(row.denominator) || row.numerator < 0 || row.denominator < 0) {
      throw new Error(`AOS_RELIANCE_METRIC ${id} is ISSUED without integer numerator and denominator`);
    }
    if (row.denominator < RELIANCE_FLOOR) throw new Error(`AOS_RELIANCE_FLOOR ${id} rests on ${row.denominator} opportunities and the floor is ${RELIANCE_FLOOR}`);
    if (!isFiniteNumber(row.value)) throw new Error(`AOS_RELIANCE_METRIC ${id} is ISSUED without a finite value`);
    return { value: row.value, status: "ISSUED", numerator: row.numerator, denominator: row.denominator };
  };
  const metrics = Object.fromEntries(RELIANCE_METRIC_IDS.map((id) => [id, metricOf(id)]));
  const issuedCount = Object.values(metrics).filter((metric) => metric.status === "ISSUED").length;
  const consistent = supplied.status === "WITHHELD" ? issuedCount === 0
    : supplied.status === "ISSUED" ? issuedCount === RELIANCE_METRIC_IDS.length
      : issuedCount > 0 && issuedCount < RELIANCE_METRIC_IDS.length;
  if (!consistent) throw new Error(`AOS_RELIANCE_STATUS ${supplied.status} does not describe ${issuedCount} issued metric(s) of ${RELIANCE_METRIC_IDS.length}`);
  return { status: supplied.status, metrics };
};

const validateCaps = (caps, contract) => {
  if (!Array.isArray(caps)) throw new Error("AOS_CAPS_SHAPE caps is an array");
  const knownCells = new Set(contract.cells.cells.map((cell) => cell.cell_id));
  return caps.map((cap) => {
    if (!isPlainObject(cap)) throw new Error("AOS_CAPS_SHAPE a cap is an object");
    if (typeof cap.code !== "string" || cap.code.length === 0) throw new Error("AOS_CAP_CODE a cap names its code");
    if (!isFiniteNumber(cap.max_value) || cap.max_value < 0 || cap.max_value > 100) throw new Error(`AOS_CAP_VALUE ${cap.code} ceiling ${String(cap.max_value)} is not on 0-100`);
    // A cap is a ceiling on what the system produced. The operator's process is measured on its own
    // axis and a cap that reached it would let a model failure lower the operator's number, which
    // is the confound the split exists to remove.
    if (!Array.isArray(cap.scope) || cap.scope.length === 0 || cap.scope.some((scope) => !CAP_SCOPES.includes(scope))) {
      throw new Error(`AOS_CAP_SCOPE ${cap.code} may only cap ${CAP_SCOPES.join(" or ")}`);
    }
    if (typeof cap.reason !== "string") throw new Error(`AOS_CAP_REASON ${cap.code} states its reason`);
    if (!Array.isArray(cap.triggers) || cap.triggers.length === 0) throw new Error(`AOS_CAP_TRIGGERS ${cap.code} names no trigger`);
    for (const trigger of cap.triggers) {
      if (!isPlainObject(trigger) || typeof trigger.trigger_id !== "string") throw new Error(`AOS_CAP_TRIGGERS ${cap.code} carries a trigger without an id`);
      if (trigger.observed !== true) throw new Error(`AOS_CAP_UNOBSERVED ${cap.code} trigger ${trigger.trigger_id} was not observed`);
      const evidence = (Array.isArray(trigger.evidence_ids) ? trigger.evidence_ids.length : 0) + (Array.isArray(trigger.effect_event_ids) ? trigger.effect_event_ids.length : 0);
      if (evidence === 0) throw new Error(`AOS_CAP_EVIDENCE ${cap.code} trigger ${trigger.trigger_id} binds no evidence or effect event`);
      if (!knownCells.has(trigger.cell_id)) throw new Error(`AOS_CAP_CELL ${cap.code} trigger ${trigger.trigger_id} names ${String(trigger.cell_id)}, which is not a cell of this contract`);
    }
    // The cap is a record the caller wrote, and it goes out on the result. Declared fields only,
    // everything else digested: a cap's reason is prose an operator typed, which is exactly where a
    // path or a token gets in.
    return {
      ...publishedRecord(cap, CAP_FIELDS, `cap ${cap.code}`, ["scope", "triggers"]),
      scope: [...cap.scope],
      triggers: cap.triggers.map((trigger) => ({
        ...publishedRecord(trigger, CAP_TRIGGER_FIELDS, `cap ${cap.code} trigger`, ["evidence_ids", "effect_event_ids"]),
        evidence_ids: (trigger.evidence_ids ?? []).map((id) => publishedText(id)),
        effect_event_ids: (trigger.effect_event_ids ?? []).map((id) => publishedText(id))
      }))
    };
  });
};

const lowestCeiling = (caps, scope) => caps
  .filter((cap) => cap.scope.includes(scope))
  .reduce((lowest, cap) => (lowest === null || cap.max_value < lowest.max_value ? cap : lowest), null);

const validateUncertainty = (uncertainty, evaluation) => {
  if (uncertainty === undefined) return { status: evaluation.uncertainty.status, method: evaluation.uncertainty.method };
  if (!isPlainObject(uncertainty) || !UNCERTAINTY_STATUSES.includes(uncertainty.status)) {
    throw new Error(`AOS_UNCERTAINTY_STATUS uncertainty.status is one of ${UNCERTAINTY_STATUSES.join(", ")}`);
  }
  const method = uncertainty.method ?? null;
  if (uncertainty.status === "COMPUTED" && (typeof method !== "string" || method.length === 0)) {
    throw new Error("AOS_UNCERTAINTY_METHOD a COMPUTED uncertainty names the method that computed it");
  }
  if (uncertainty.status !== "COMPUTED" && method !== null) throw new Error(`AOS_UNCERTAINTY_METHOD ${uncertainty.status} carries no method`);
  return { status: uncertainty.status, method };
};

const validateGeneralizability = (status, evaluation) => {
  if (status === undefined) return "UNESTABLISHED";
  if (!GENERALIZABILITY_STATUSES.includes(status)) throw new Error(`AOS_GENERALIZABILITY_STATUS ${String(status)} is not one of ${GENERALIZABILITY_STATUSES.join(", ")}`);
  if (status === "ESTABLISHED" && evaluation.claim_stage !== "GENERALIZABILITY_SUPPORTED") {
    throw new Error(`AOS_GENERALIZABILITY_UNSUPPORTED the evaluation supports ${evaluation.claim_stage}, not a generalizability claim`);
  }
  return status;
};

const validateRun = (run) => publishedRecord(run ?? {}, RUN_FIELDS, "run");

/**
 * Only a result `evaluate` emitted, under the contract this builder was given.
 *
 * The registry of emitted results lives inside lib/ecd-contract.mjs and is not exported, on
 * purpose; `comparability` is the one door to it, and asking whether a result is comparable to
 * itself under a contract asks exactly the two questions this builder needs answered: was it
 * emitted, and was it emitted under this contract. A copy -- spread, cloned or parsed back from
 * JSON -- is refused, because a copy is an object whose numbers nothing vouches for.
 */
const emittedUnder = (evaluation, contract) => {
  if (!isPlainObject(evaluation)) throw new Error("AOS_UNEMITTED_EVALUATION buildResult takes the result evaluate emitted");
  try {
    comparability(evaluation, evaluation, contract);
  } catch (error) {
    if (/^AOS_UNEMITTED_RESULT/u.test(error.message)) throw new Error("AOS_UNEMITTED_EVALUATION buildResult takes the result evaluate emitted, not a copy of one");
    if (/^AOS_CONTRACT_MISMATCH/u.test(error.message)) throw new Error("AOS_CONTRACT_MISMATCH the evaluation was not emitted under the contract given to buildResult");
    throw error;
  }
};

// --- the result ------------------------------------------------------------------------------

const cellsOf = (evaluation, ids) => ids.map((id) => evaluation.cells.find((cell) => cell.cell_id === id)).filter(Boolean);

const missingAmong = (evaluation, ids) => {
  const mine = new Set(ids);
  return {
    not_observed: evaluation.missing.not_observed.filter((id) => mine.has(id)),
    insufficient_opportunities: evaluation.missing.insufficient_opportunities.filter((id) => mine.has(id)),
    withheld: evaluation.missing.withheld.filter((id) => mine.has(id))
  };
};

const coverageOf = (evaluation, requiredIds, optionalIds) => {
  const required = cellsOf(evaluation, requiredIds);
  const optional = cellsOf(evaluation, optionalIds);
  const issued = required.filter((cell) => cell.status === "ISSUED").map((cell) => cell.cell_id);
  return {
    required_cells: required.map((cell) => cell.cell_id),
    issued_cells: issued,
    optional_cells: optional.map((cell) => ({ cell_id: cell.cell_id, estimate: cell.estimate, status: cell.status })),
    opportunity_count: [...required, ...optional].reduce((total, cell) => total + cell.opportunity_count, 0),
    coverage: { required: required.length, issued: issued.length },
    missing: missingAmong(evaluation, [...requiredIds, ...optionalIds])
  };
};

const constructRow = (evaluation, contract, id, axis) => {
  const construct = contract.construct_map.constructs.find((entry) => entry.construct_id === id);
  const issued = evaluation.constructs.find((row) => row.construct_id === id && row.axis === axis);
  if (!construct || !issued) throw new Error(`AOS_CONSTRUCT_MISSING ${id} has no ${axis} row in the evaluation`);
  return {
    construct_id: id,
    title: construct.title,
    axis,
    estimate: issued.estimate,
    value: isFiniteNumber(issued.estimate) ? issued.estimate * 100 : null,
    status: issued.status,
    required_cells: [...issued.required_cell_ids],
    optional_cells: issued.optional_cells.map((cell) => ({ ...cell })),
    withheld_for: issued.withheld_for.map((entry) => ({ ...entry })),
    withheld_reason: issued.status === "ISSUED" ? null : withheldReason(
      issued.withheld_for,
      issued.required_cell_ids.length === 0
        ? `this contract declares no required ${axis} cell for ${id}, so there is nothing to issue from`
        : `${id} has no issued estimate on the ${axis} axis`
    )
  };
};

const domainRow = (evaluation, domain) => {
  const cells = cellsOf(evaluation, domain.cell_ids);
  const withheld = cells.filter((cell) => cell.status !== "ISSUED").map((cell) => ({ cell_id: cell.cell_id, status: cell.status }));
  const estimate = withheld.length > 0 || cells.length === 0 ? null : cells.reduce((total, cell) => total + cell.estimate, 0) / cells.length;
  return {
    domain_id: domain.domain_id,
    title: domain.title,
    axis: "system_outcome",
    estimate,
    value: estimate === null ? null : estimate * 100,
    status: estimate === null ? "WITHHELD" : "ISSUED",
    required_cells: [...domain.cell_ids],
    cells: cells.map((cell) => ({ cell_id: cell.cell_id, estimate: cell.estimate, status: cell.status, opportunity_count: cell.opportunity_count })),
    withheld_for: withheld,
    withheld_reason: estimate === null ? withheldReason(withheld, `no cell of ${domain.domain_id} was observed in this run`) : null
  };
};

/**
 * The claim a result is entitled to make, checked against what issued it.
 *
 * The stage is what a reader is allowed to conclude, so it is the one field worth editing: changing
 * only the top-level `claim_stage` from PROFILE_BOUND to GENERALIZABILITY_SUPPORTED left every
 * nested copy at PROFILE_BOUND, validated, projected, and printed the elevated claim. Three things
 * make that impossible rather than unlikely: the four surfaces carry the same stage and must agree
 * with the top level, the stage may not exceed the ceiling the contract set (which the result
 * states, so a reader can check it), and the top stage is only reachable when the result also says
 * generalizability is established. A profile-bound claim additionally needs the profile digest it
 * claims to be bound to -- an exact profile named by nothing is not an exact profile.
 */
const assertClaimState = (where, result) => {
  const stage = result.claim_stage;
  if (!CLAIM_STAGES.includes(stage)) {
    throw new Error(`AOS_CLAIM_STAGE ${where} claims ${JSON.stringify(stage)}, which is not one of ${CLAIM_STAGES.join(", ")}`);
  }
  // Internal disagreement first, because it is the more precise diagnosis: a result whose surfaces
  // say something else than its top line has been edited in one place, and saying so is more use
  // than saying it exceeded a ceiling.
  for (const key of SURFACE_KEYS) {
    const surface = result[key];
    if (!isPlainObject(surface) || surface.claim_stage !== stage) {
      throw new Error(`AOS_CLAIM_STAGE ${where} claims ${stage} and its ${key} says ${JSON.stringify(surface?.claim_stage)}; one result makes one claim`);
    }
  }
  const ceiling = result.contract?.maximum_claim_stage;
  if (!CLAIM_STAGES.includes(ceiling)) {
    throw new Error(`AOS_CLAIM_CEILING ${where} does not say what claim stage its contract permits, so the claim it makes rests on nothing`);
  }
  if (CLAIM_STAGES.indexOf(stage) > CLAIM_STAGES.indexOf(ceiling)) {
    throw new Error(`AOS_CLAIM_EXCEEDS_CONTRACT ${where} claims ${stage} and the contract it names permits ${ceiling}`);
  }
  if (stage === "GENERALIZABILITY_SUPPORTED" && result.generalizability_status !== "ESTABLISHED") {
    throw new Error(`AOS_CLAIM_STAGE ${where} claims ${stage} while its generalizability is ${JSON.stringify(result.generalizability_status)}`);
  }
  if (stage !== "RUN_DIAGNOSTIC" && !PROFILE_DIGEST_TEXT.test(String(result.profile_digest))) {
    throw new Error(`AOS_CLAIM_UNBOUND ${where} claims ${stage}, which is a claim about an exact profile, and names ${JSON.stringify(result.profile_digest)} as that profile`);
  }
};

/**
 * Issued, or withheld and why -- one state, in three fields that have to agree.
 *
 * `issued`, the number, and the list of reasons are three ways of saying the same thing, and three
 * fields nothing binds together are three fields a stored file can disagree with itself in. Taking
 * a legitimately withheld result and writing `0` over its index left `issued: false` and the
 * reasons in place, and the reader printed `0.0` with no reason beside it -- the exact reading this
 * instrument exists to refuse, produced by an edit nothing objected to.
 *
 * So it is checked where the result is built and again where a stored one is read, and the JSON
 * schema says it too, because a consumer that is not this repository reads that instead.
 */
const assertIssuanceState = (where, { issued, value, withheld_reason: reason }) => {
  if (typeof issued !== "boolean") throw new Error(`AOS_ISSUANCE_STATE ${where} does not say whether it is issued`);
  if (issued !== (value !== null) || issued !== (reason === null)) {
    throw new Error(`AOS_ISSUANCE_STATE ${where} says issued=${issued} with ${value === null ? "no number" : `the number ${value}`} and ${reason === null ? "no withheld reason" : `the reason "${reason}"`}; a withheld surface carries a reason and no number, and an issued one carries a number and no reason`);
  }
  if (value !== null && !isFiniteNumber(value)) throw new Error(`AOS_ISSUANCE_STATE ${where} carries a number that is not one`);
  if (reason !== null && (typeof reason !== "string" || reason.length === 0)) throw new Error(`AOS_ISSUANCE_STATE ${where} is withheld and its reason is not a sentence`);
};

/**
 * Why a surface is withheld, in words, always.
 *
 * The list of cells is the machine-readable half and it can legitimately be empty -- a construct
 * the contract declares no required cell for is withheld because there was never anything to issue
 * from, and no cell can be named for it. A reader still has to be told something, so the reason is
 * a string that is present exactly when the number is absent.
 */
const withheldReason = (ids, structural) => {
  if (ids.length > 0) return ids.map((entry) => (typeof entry === "string" ? entry : `${entry.cell_id} ${entry.status}`)).join(", ");
  return structural;
};

const contractDigestOf = (contract) => contractDigests(contract).combined;

/**
 * The rows a result under this contract must carry, and the cells each of them is computed over,
 * from the contract rather than from the result.
 *
 * The row sets alone said which rows a surface has. A row could still lose a member and keep its
 * shape: dropping `C2.HJ.01` from O1's cells left a validly-shaped row averaging one cell instead
 * of two, an outcome index of 100.0, a coverage still reading nine of nine, and a required cell
 * gone from the artifact with nothing to say it had ever been there. What a row averaged is as much
 * a claim about the contract as which rows exist, so the contract states it and the reader holds
 * the result to it.
 */
const requiredCellsOf = (contract, constructId, axis) => contract.cells.cells
  .filter((cell) => cell.construct_id === constructId && cell.axis === axis && cell.required_for_construct)
  .map((cell) => cell.cell_id)
  .sort();

export const declaredOver = (contract = shippedEcdContract()) => {
  const processConstructs = [...contract.construct_map.process_index.construct_ids].sort();
  const domains = outcomeDomains(contract);
  const artifactConstructs = contract.construct_map.constructs
    .filter((construct) => Object.hasOwn(construct.axes, "delegated_artifact"))
    .map((construct) => construct.construct_id)
    .sort();
  return {
    process_constructs: processConstructs,
    outcome_domains: domains.map((domain) => domain.domain_id).sort(),
    delegated_artifact_constructs: artifactConstructs,
    declared_cells: {
      operator_process: Object.fromEntries(processConstructs.map((id) => [id, requiredCellsOf(contract, id, "operator_process")])),
      system_outcome: Object.fromEntries(domains.map((domain) => [domain.domain_id, [...domain.cell_ids].sort()])),
      delegated_artifact: Object.fromEntries(artifactConstructs.map((id) => [id, requiredCellsOf(contract, id, "delegated_artifact")]))
    }
  };
};

const equalWeights = (ids) => Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));

/**
 * The observations the evaluation was computed from, carried on the result.
 *
 * A result that cannot say what it was computed from cannot be recomputed, and `aos verify --run`
 * would then be re-deriving a result's inputs from its own conclusions. These are the same records
 * `evaluate` read; what this checks is that they are observations of this instrument's metrics and
 * that no free text on them carries something unpublishable.
 */
const validateObservations = (observations) => {
  if (observations === undefined) return [];
  if (!Array.isArray(observations)) throw new Error("AOS_OBSERVATIONS_SHAPE observations is the array evaluate was given");
  const seen = new Set();
  return observations.map((observation) => {
    if (!isPlainObject(observation) || METRICS[observation.metric_id] === undefined) {
      throw new Error(`AOS_OBSERVATIONS_SHAPE ${String(observation?.metric_id)} is not a metric this instrument declares`);
    }
    if (seen.has(observation.metric_id)) throw new Error(`AOS_OBSERVATIONS_DUPLICATE ${observation.metric_id} is observed twice`);
    seen.add(observation.metric_id);
    return {
      metric_id: observation.metric_id,
      dimension: observation.dimension,
      state: observation.state,
      value: observation.value ?? null,
      verifier_id: publishedText(observation.verifier_id ?? null),
      subchecks: (observation.subchecks ?? []).map((entry) => ({ id: entry.id, pass: entry.pass })),
      evidence_ids: (observation.evidence_ids ?? []).map((id) => publishedText(id)),
      reason: publishedText(observation.reason ?? "")
    };
  });
};

/**
 * The canonical result.
 *
 * `evaluation` is the frozen result `evaluate` emitted under `contract`; everything numeric here is
 * read from it. `reliance`, `caps`, `uncertainty` and `generalizability_status` are the seams the
 * downstream issues fill, each validated to the honest default when absent. `run` is the identity
 * of the run the result belongs to and is carried, not read.
 */
export function buildResult({ evaluation, contract = shippedEcdContract(), reliance, caps = [], uncertainty, generalizability_status, run, observations, model_identity, ...rest } = {}) {
  // A legacy record is rendered by the legacy scorer and is never lifted into this schema: the
  // twenty metrics it was scored from cannot be re-read as construct estimates, and a result that
  // was back-computed would carry this schema's claims without its evidence.
  if (Object.hasOwn(rest, "legacy")) throw new Error("AOS_LEGACY_RESULT_NOT_MIGRATED a legacy result is rendered as the record it is; buildResult does not migrate it");
  emittedUnder(evaluation, contract);

  const processSpec = contract.construct_map.process_index;
  const processIds = [...processSpec.construct_ids];
  const constructs = Object.fromEntries(processIds.map((id) => [id, constructRow(evaluation, contract, id, processSpec.axis)]));
  // The contract issues this index; this file does not compute a second one. `evaluate` already
  // divides the six construct estimates by six under the contract's own rule, and re-averaging the
  // same rows here produced a number that differed from the contract's in the last bit -- two
  // answers to one question, from one instrument. The scale is the only thing added: the contract
  // works on 0-1 and every surface here is on 0-100.
  const processIndex = {
    value: evaluation.process_index.status === "ISSUED" ? evaluation.process_index.value * 100 : null,
    issued: evaluation.process_index.status === "ISSUED",
    withheld_for: [...evaluation.process_index.withheld_for]
  };
  const processCells = processIds.flatMap((id) => constructs[id].required_cells);
  const processOptional = processIds.flatMap((id) => constructs[id].optional_cells.map((cell) => cell.cell_id));

  const domains = Object.fromEntries(outcomeDomains(contract).map((domain) => [domain.domain_id, domainRow(evaluation, domain)]));
  const domainIds = Object.keys(domains);
  const outcomeRaw = equalWeightIndex(domainIds.map((id) => ({ id, estimate: domains[id].estimate, status: domains[id].status })));
  const outcomeCells = domainIds.flatMap((id) => domains[id].required_cells);

  const validCaps = validateCaps(caps, contract);
  const outcomeCeiling = lowestCeiling(validCaps, "system_outcome");
  const outcomeCapped = outcomeRaw.value !== null && outcomeCeiling !== null && outcomeCeiling.max_value < outcomeRaw.value;
  const outcomeIndex = outcomeCapped ? outcomeCeiling.max_value : outcomeRaw.value;

  const compositeRaw = compositeOf(processIndex.value, outcomeRaw.value);
  const compositeThroughOutcome = compositeOf(processIndex.value, outcomeIndex);
  const compositeCeiling = lowestCeiling(validCaps, "aos_composite");
  const compositeCapped = compositeThroughOutcome.value !== null && compositeCeiling !== null && compositeCeiling.max_value < compositeThroughOutcome.value;
  const compositeValue = compositeCapped ? compositeCeiling.max_value : compositeThroughOutcome.value;

  const relianceSeam = validateReliance(reliance);
  const relianceAxisCells = contract.cells.cells.filter((cell) => cell.axis === "reliance_calibration");
  const relianceCells = relianceAxisCells.filter((cell) => cell.required_for_construct).map((cell) => cell.cell_id);
  const relianceOptional = relianceAxisCells.filter((cell) => !cell.required_for_construct).map((cell) => cell.cell_id);
  const relianceIssued = cellsOf(evaluation, [...relianceCells, ...relianceOptional]);
  const c3Reliance = evaluation.constructs.find((row) => row.construct_id === "C3" && row.axis === "reliance_calibration") ?? null;

  const artifactIds = contract.construct_map.constructs
    .filter((construct) => Object.hasOwn(construct.axes, "delegated_artifact"))
    .map((construct) => construct.construct_id);

  // What the identity record permits, applied to the claim rather than printed beside it.
  //
  // The record was copied into the result and read by nothing: a result whose model was unknown --
  // or which carried no record at all -- still came out PROFILE_BOUND with a composite, because the
  // claim stage was the contract's alone (#561 round 9). Which model and which executable produced
  // a number is a condition on what that number may claim, so a withheld identity caps the stage at
  // RUN_DIAGNOSTIC and withholds the composite by the identity's own reason. It only ever caps: an
  // identity that issues cannot raise a claim the contract withheld.
  // `null` is a caller saying "no identity was established", and it caps like any other
  // withholding. `undefined` is a caller not speaking to the question at all -- the unit fixtures
  // in this repository that exercise the contract's own arithmetic -- and it is left alone rather
  // than answered on their behalf. What keeps the published path honest is the schema: a result
  // must carry `model_identity`, so a run that reaches an operator has been asked.
  // Recomputed from the record's own agents, never read off the field beside them. A record whose
  // agents each withhold and whose summary says `issued` is a record that contradicts itself, and
  // trusting the summary let a forged one carry a composite of 100 (#561 round 10).
  const identityAgents = isPlainObject(model_identity) ? Object.values(model_identity.by_agent ?? {}) : [];
  const identityAgentsWithhold = identityAgents.some((entry) => entry?.profile_bound_aggregation?.status !== "issued");
  const identityAggregation = isPlainObject(model_identity)
    ? (identityAgents.length === 0 || identityAgentsWithhold
      ? {
        status: "withheld",
        reason: identityAgents.length === 0
          ? "MODEL_PROVENANCE_ABSENT"
          : (identityAgents.find((entry) => entry?.profile_bound_aggregation?.status !== "issued")?.profile_bound_aggregation?.reason ?? "MODEL_PROVENANCE_ABSENT"),
        detail: identityAgents.length === 0
          ? "the record names no agent, so nothing established which model and which executable produced this result"
          : (identityAgents.find((entry) => entry?.profile_bound_aggregation?.status !== "issued")?.profile_bound_aggregation?.detail ?? "an agent in this record withheld the profile-bound claim")
      }
      : model_identity.profile_bound_aggregation ?? null)
    : null;
  const identityWithheld = model_identity === undefined
    ? null
    : (model_identity === null
      ? "MODEL_PROVENANCE_ABSENT: this result carries no model identity record, so nothing established which model and which executable produced it"
      : (identityAggregation?.status === "issued"
        ? null
        : `${identityAggregation?.reason ?? "MODEL_PROVENANCE_ABSENT"}: ${identityAggregation?.detail ?? "the model identity record withheld the profile-bound claim"}`));
  const claim = {
    claim_stage: identityWithheld === null ? evaluation.claim_stage : "RUN_DIAGNOSTIC",
    generalizability_status: validateGeneralizability(generalizability_status, evaluation),
    uncertainty: validateUncertainty(uncertainty, evaluation)
  };
  // The facets are the operator's own declaration of what the run was, which is where a workspace
  // path arrives. Copied as they are here and published by the gate on the way out, like every
  // other string on the result -- sanitising them a second time in this line was redundancy the
  // mutation run correctly reported as dead: removing it changed nothing, because the gate holds.
  // The facets carry the two derived digests -- the contract's and the profile's -- and they are
  // digests wherever they appear, in the one spelling. A result that wrote the same digest bare in
  // one field and prefixed in another is a result whose own recomputation does not match it.
  // Only the two facets this build derives are read as digests. Normalising every facet was how a
  // caller's own sixty-four hex characters became `sha256:` plus themselves: a facet is whatever
  // the operator declared, so it goes through the gate like any other string, and a value that
  // looks like a digest without being one is hashed rather than dressed as one.
  const DERIVED_DIGEST_FACETS = new Set(["contract_digest", "profile_digest"]);
  const facetIdentity = Object.fromEntries(Object.entries(evaluation.facet_coverage.declared)
    .map(([facet, value]) => [facet, DERIVED_DIGEST_FACETS.has(facet) ? sanitised(normalisedDigest(value)) : value]));

  // Checked before it is frozen, because a builder that can emit a state nobody can name is a
  // builder whose output the reader below has to guess at.
  const processWithheld = processIndex.issued ? null : withheldReason(processIndex.withheld_for, "the contract issued no process index for this run");
  const outcomeWithheld = outcomeRaw.issued ? null : withheldReason(outcomeRaw.withheld_for, "no outcome domain issued an estimate for this run");
  // The composite is issued when the contract issued it *and* the identity record permits it. A
  // number describing a run nobody can say the model of is a number about an unnamed thing.
  const compositeIssued = compositeThroughOutcome.issued && identityWithheld === null;
  const compositeWithheld = compositeIssued
    ? null
    : (identityWithheld !== null && compositeThroughOutcome.issued
      ? identityWithheld
      : withheldReason(compositeThroughOutcome.withheld_for, "neither index issued for this run"));
  assertIssuanceState("the operator process profile", { issued: processIndex.issued, value: processIndex.value, withheld_reason: processWithheld });
  assertIssuanceState("the system outcome profile", { issued: outcomeRaw.issued, value: outcomeIndex, withheld_reason: outcomeWithheld });
  assertIssuanceState("the composite", { issued: compositeIssued, value: compositeIssued ? compositeValue : null, withheld_reason: compositeWithheld });

  const result = {
    schema_id: RESULT_SCHEMA_ID,
    schema_version: RESULT_SCHEMA_VERSION,
    run: validateRun(run),
    contract: {
      id: evaluation.contract.id,
      version: evaluation.contract.version,
      // The ceiling on the result, in the result. A reader has no contract in hand, and a claim
      // checked against nothing is a claim checked by whoever wrote the file; the digests beside
      // it are what bind this ceiling to the contract that set it.
      maximum_claim_stage: contract.interpretation_use.maximum_claim_stage,
      // What the contract declared this result would be computed over. A reader has no contract in
      // hand, and checking the rows against the stored object's own keys asks the file whether it
      // is complete -- which it always answers yes to. This is the same shape as the claim ceiling
      // above: the result states what it was built over, the reader holds it to that, and `verify`
      // holds the statement to the contract.
      declared: declaredOver(contract),
      // Two digests, because they answer two questions. The canonical one is stable against key
      // order and is what `verify --run` compares to decide whether a result is comparable at all.
      // The byte one is over the contract files as they are on disk, and it is the one that moves
      // when the file moves: appending a space to a contract left the canonical digest exactly
      // where it was, so a result citing only that digest could not tell a reader whether the
      // artifact it names is the artifact this build holds. A contract that is not this build's
      // shipped one has no file to hash, and says so with null rather than borrowing these.
      digests: sanitisedMap(evaluation.contract.digests),
      artifact_bytes: contractDigestOf(contract) === contractDigestOf(shippedEcdContract()) ? sanitisedMap(contractFileDigests()) : null
    },
    profile_digest: sanitised(normalisedDigest(evaluation.profile_digest)),
    // Which model and which executable produced this result (#561). In the published artefact
    // because every projection quotes its lines, and a reader holding the result has nowhere else
    // to find them: the working record beside it is not what anybody publishes.
    model_identity: isPlainObject(model_identity) ? publishedIdentity(model_identity) : null,
    ...claim,
    permitted_interpretation: evaluation.permitted_interpretation,
    forbidden_uses: [...evaluation.forbidden_uses],
    standard_setting: null,
    category: null,
    cut_score: null,
    percentile: null,
    rank: null,
    band: null,
    incomplete_forms: [...evaluation.incomplete_forms],
    unsupported_forms: [...evaluation.unsupported_forms],
    unidentified_facets: [...evaluation.unidentified_facets],
    facet_identity: facetIdentity,
    facet_coverage: {
      levels_per_facet_observed: evaluation.facet_coverage.levels_per_facet_observed,
      variance_components: evaluation.facet_coverage.variance_components
    },
    operator_process_profile: {
      label: LABELS.operator_process,
      axis: processSpec.axis,
      interpretation: processSpec.interpretation,
      issued: processIndex.issued,
      index: processIndex.value,
      withheld_for: [...processIndex.withheld_for],
      withheld_reason: processWithheld,
      weights: equalWeights(processIds),
      constructs,
      ...coverageOf(evaluation, processCells, processOptional),
      facet_identity: { ...facetIdentity },
      ...claim
    },
    reliance_calibration_profile: {
      status: relianceSeam.status,
      explains_construct: "C3",
      floor: RELIANCE_FLOOR,
      opportunities: relianceIssued.reduce((total, cell) => total + cell.declared_opportunities, 0),
      construct: c3Reliance === null ? null : { estimate: c3Reliance.estimate, status: c3Reliance.status, withheld_for: c3Reliance.withheld_for.map((entry) => ({ ...entry })) },
      cells: Object.fromEntries(relianceIssued.map((cell) => [cell.cell_id, { estimate: cell.estimate, status: cell.status, opportunity_count: cell.opportunity_count }])),
      metrics: relianceSeam.metrics,
      // A profile with no coverage of its own cannot be read as withheld rather than as empty, and
      // "reliance is a separate surface" is exactly the claim that needs the reading. No index:
      // #583 owns the metrics and none of them is weighted into anything here.
      ...coverageOf(evaluation, relianceCells, relianceOptional),
      facet_identity: { ...facetIdentity },
      ...claim
    },
    system_outcome_profile: {
      label: LABELS.system_outcome,
      axis: "system_outcome",
      interpretation: "descriptive only",
      issued: outcomeRaw.issued,
      index: outcomeIndex,
      raw_index: outcomeRaw.value,
      withheld_reason: outcomeWithheld,
      cap_applied: outcomeCapped ? outcomeCeiling.code : null,
      caps: validCaps,
      withheld_for: [...outcomeRaw.withheld_for],
      weights: equalWeights(domainIds),
      domains,
      ...coverageOf(evaluation, outcomeCells, []),
      facet_identity: { ...facetIdentity },
      ...claim
    },
    aos_composite: {
      label: LABELS.aos_composite,
      formula: COMPOSITE_FORMULA,
      secondary: true,
      weights: { ...COMPOSITE_WEIGHTS },
      inputs: { operator_process: processIndex.value, system_outcome: outcomeIndex },
      issued: compositeIssued,
      value: compositeIssued ? compositeValue : null,
      raw_value: compositeRaw.value,
      withheld_reason: compositeWithheld,
      cap_applied: compositeCapped ? compositeCeiling.code : null,
      withheld_for: [...compositeThroughOutcome.withheld_for],
      // The evidence model files the delegated-artifact axis under this surface, and SSOT section
      // 20 fixes the surface's number as the mean of the two indices. Both hold: the artifact
      // estimates are shown here, verbatim, and none of them is in the value.
      delegated_artifact: {
        axis: "delegated_artifact",
        in_composite: false,
        constructs: Object.fromEntries(artifactIds.map((id) => [id, constructRow(evaluation, contract, id, "delegated_artifact")]))
      },
      ...claim
    },
    cells: evaluation.cells.map((cell) => structuredClone(cell)),
    missing: structuredClone(evaluation.missing),
    observations: validateObservations(observations)
  };
  assertClaimState("this result", result);
  return deepFreeze(publishedDeep(result));
}

// --- legacy separation -----------------------------------------------------------------------

/**
 * Which instrument produced this record -- and a refusal when the answer is neither.
 *
 * "Anything that is not the new schema is the old one" is fail-open dispatch: a stored file
 * claiming any other schema id was handed to the legacy renderer, which printed it as an Agent
 * Operator Score with a band under it. An instrument nobody recognises produces a result nobody
 * can read, and saying so is the whole of the correct behaviour.
 *
 * A record with no `schema_id` at all is the one exception, and only when it carries the legacy
 * scorer's own fields: results written before the id existed are in operators' stores today, and
 * they are legacy records rather than unknown ones.
 */
export function resultKind(result) {
  if (isPlainObject(result)) {
    if (result.schema_id === RESULT_SCHEMA_ID) return RESULT_SCHEMA_ID;
    if (result.schema_id === LEGACY_RESULT_SCHEMA_ID) return LEGACY_RESULT_SCHEMA_ID;
    if (result.schema_id === undefined && isPlainObject(result.scorer) && Object.hasOwn(result, "dimensions") && Object.hasOwn(result, "coverage")) {
      return LEGACY_RESULT_SCHEMA_ID;
    }
  }
  throw new Error(`AOS_UNKNOWN_RESULT_SCHEMA ${JSON.stringify(isPlainObject(result) ? result.schema_id ?? null : null)} is not ${RESULT_SCHEMA_ID} and is not the legacy record; a result of an unrecognised instrument is not rendered`);
}

export const isLegacyResult = (result) => resultKind(result) === LEGACY_RESULT_SCHEMA_ID;
export const resultSchemaOf = (result) => resultKind(result);

/**
 * One schema per cycle. A cycle's median is a median of one kind of number; a legacy score and a
 * profile index are not one kind of number, and a cycle that held both would aggregate them anyway.
 * A run record without the field predates it and is legacy; a record whose field is null had no
 * result at all and says nothing about the schema.
 */
export function assertUniformResultSchema(records, where = "cycle") {
  if (!Array.isArray(records)) throw new Error("AOS_INVALID_RECORDS assertUniformResultSchema takes the cycle's run records");
  const schemas = new Set(records
    .filter((record) => record.result_schema !== null)
    .map((record) => (typeof record.result_schema === "string" ? record.result_schema : LEGACY_RESULT_SCHEMA_ID)));
  if (schemas.size === 0) return null;
  if (schemas.size > 1) throw new Error(`AOS_MIXED_RESULT_SCHEMAS ${where} holds ${[...schemas].sort().join(" and ")} results; legacy and profile results are not aggregated together`);
  return [...schemas][0];
}

export const loadResultSchema = () => JSON.parse(readFileSync(RESULT_SCHEMA_URL, "utf8"));
// Read once. Every rendering of every result validates against this file, and re-reading it per
// projection would make the cost of the check the reason somebody moves it back out of the way.
let resultSchemaCache = null;
const cachedResultSchema = () => (resultSchemaCache ??= loadResultSchema());
/** The identity of the schema file: a digest of its bytes as they are on disk, never of parsed or re-serialised text. */
export const resultSchemaDigest = () => fileByteDigest(RESULT_SCHEMA_URL);

// --- projection ------------------------------------------------------------------------------

// One decimal, always, so "100" and "100.0" cannot be two renderings of one number.
const shown = (value) => (isFiniteNumber(value) ? (Math.round(value * 10) / 10).toFixed(1) : "withheld");
const reasonOf = (withheldFor) => (Array.isArray(withheldFor) && withheldFor.length > 0
  ? withheldFor.map((entry) => (typeof entry === "string" ? entry : `${entry.cell_id} ${entry.status}`)).join(", ")
  : null);

/**
 * The result as strings, for every renderer.
 *
 * Renderers print this and compute nothing: every number here is formatted from the stored field
 * it names, never derived from the rows beside it, so a report cannot disagree with the result it
 * was drawn from except by the result disagreeing with itself -- which the projection-consistency
 * test uses on purpose. `phrases` is the list every full renderer must print and `headline` the
 * subset the card must print; both are how "the same values and phrases" is checkable.
 */
export function projectResult(result) {
  if (isLegacyResult(result)) throw new Error("AOS_LEGACY_RESULT_NOT_PROJECTED a legacy result is rendered by the legacy renderer, not projected");
  // The schema is the authority on shape, and this is where a stored result meets it.
  //
  // Shape was being stated in four places -- here, in `buildResult`, in each renderer, and in the
  // schema -- and four statements of one rule drift: the schema required `uncertainty` and fixed
  // the composite's formula while this function checked neither, so a result with `uncertainty`
  // deleted rendered "Uncertainty: undefined" and one whose formula said `aos-composite.attacker`
  // was printed as written. Every field, enum, constant and issuance pair the schema states is now
  // checked against the schema itself, once, before anything is read off the result -- so a
  // renderer cannot see a result the schema would reject -- and what stays below is only what a
  // schema cannot say: the rows the contract declared, the arithmetic, the caps, the claim.
  const invalid = validateAgainstSchema(result, cachedResultSchema());
  if (!invalid.ok) {
    const detail = invalid.errors.slice(0, 5).map((one) => `${one.path} ${one.message}`).join("; ");
    throw new Error(`AOS_RESULT_SCHEMA_INVALID this stored result is not a ${RESULT_SCHEMA_ID} result: ${detail}`);
  }
  const process = result.operator_process_profile;
  const reliance = result.reliance_calibration_profile;
  const outcome = result.system_outcome_profile;
  const composite = result.aos_composite;
  // The claim's ceiling is a relation between the result and the contract it names, which is why it
  // stays here: the schema can say the stage is one of three words, not that this result is
  // entitled to the one it chose.
  assertClaimState("this stored result", result);
  // Floating-point noise is admitted and nothing else is: the contract divides a sum of estimates
  // where this arithmetic scales each row first, and the two agree to within this and disagree by
  // amounts nobody could mistake for rounding.
  const AGREEMENT = 1e-9;
  const disagrees = (left, right) => !(isFiniteNumber(left) && isFiniteNumber(right) && Math.abs(left - right) <= AGREEMENT);
  // The rows a surface declares are the rows it has to have.
  //
  // Iterating whatever rows happen to be there reads a result with C1 deleted as a five-construct
  // profile and a composite with its artifact surface removed as one with nothing delegated -- the
  // withheld state is not shown as zero, it is not shown at all, which is the same loss by a
  // quieter route. `weights` is what the surface says it averaged; the rows must be exactly those.
  const rowsOf = (owner, key, expectedKeys) => {
    const rows = owner[key];
    if (!isPlainObject(rows)) throw new Error(`AOS_RESULT_INCOMPLETE ${key} is missing from this result and its rows are not assumed`);
    const present = Object.keys(rows).sort();
    const expected = [...expectedKeys].sort();
    if (present.length !== expected.length || present.some((id, index) => id !== expected[index])) {
      throw new Error(`AOS_RESULT_INCOMPLETE ${key} carries ${present.length > 0 ? present.join(", ") : "no rows"} and this result says it was computed over ${expected.join(", ")}`);
    }
    return rows;
  };
  // The authority on what a result should contain is the contract it names, not the result. Asking
  // the stored object for its own expected keys is a question that answers itself: deleting a
  // construct and its weight together read as a five-construct profile, and the artifact surface
  // compared its keys with those same keys. The contract's declaration travels on the result, and
  // where this build holds that contract it is checked against it.
  const declared = result.contract?.declared;
  const expectedSets = {
    "operator_process_profile.constructs": declared?.process_constructs,
    "system_outcome_profile.domains": declared?.outcome_domains,
    "aos_composite.delegated_artifact.constructs": declared?.delegated_artifact_constructs
  };
  for (const [key, ids] of Object.entries(expectedSets)) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
      throw new Error(`AOS_RESULT_INCOMPLETE this result does not say which rows its contract declared for ${key}, so no reading of it can be complete`);
    }
  }
  const shipped = shippedEcdContract();
  if (result.contract?.digests?.combined === contractDigestOf(shipped)) {
    const mine = canonicalJson(declaredOver(shipped));
    if (canonicalJson(declared) !== mine) {
      throw new Error(`AOS_RESULT_INCOMPLETE this result names the contract this build holds and states different rows than that contract declares: ${canonicalJson(declared)} against ${mine}`);
    }
  }
  const artifact = composite.delegated_artifact;
  if (!isPlainObject(artifact) || artifact.in_composite !== false) {
    throw new Error("AOS_RESULT_INCOMPLETE the composite's delegated-artifact surface is missing, and a composite that shows no artifact rows is not the same as one that has none");
  }
  const rowSets = [
    ["operator_process_profile.constructs", rowsOf(process, "constructs", expectedSets["operator_process_profile.constructs"]), "construct_id", process.weights],
    ["system_outcome_profile.domains", rowsOf(outcome, "domains", expectedSets["system_outcome_profile.domains"]), "domain_id", outcome.weights],
    ["aos_composite.delegated_artifact.constructs", rowsOf(artifact, "constructs", expectedSets["aos_composite.delegated_artifact.constructs"]), "construct_id", null]
  ];
  // Each row against the cells the contract says it averaged. The loop below reads the row sets;
  // this one reads inside the rows, which is where a deletion survives having a valid shape.
  const declaredCells = declared?.declared_cells;
  const CELL_LISTS = {
    "operator_process_profile.constructs": ["operator_process", (row) => row.required_cells],
    "system_outcome_profile.domains": ["system_outcome", (row) => row.required_cells],
    "aos_composite.delegated_artifact.constructs": ["delegated_artifact", (row) => row.required_cells]
  };
  if (!isPlainObject(declaredCells)) {
    throw new Error("AOS_RESULT_INCOMPLETE this result does not say which cells its contract declared for each row, so a row that lost one reads as a row that never had it");
  }
  for (const [key, rowSet, idKey] of rowSets) {
    const [axis, listOf] = CELL_LISTS[key];
    for (const row of Object.values(rowSet)) {
      const declaredForRow = declaredCells[axis]?.[row[idKey]];
      if (!Array.isArray(declaredForRow)) {
        throw new Error(`AOS_RESULT_INCOMPLETE ${key} row ${String(row[idKey])} is not one this result's contract declared any cells for`);
      }
      const sameCells = (carried) => carried.length === declaredForRow.length && carried.every((id, index) => id === declaredForRow[index]);
      const required = [...listOf(row)].map(String).sort();
      if (!sameCells(required)) {
        throw new Error(`AOS_RESULT_INCOMPLETE ${key} row ${String(row[idKey])} was computed over ${required.length > 0 ? required.join(", ") : "no cells"} and its contract declares ${declaredForRow.join(", ")}`);
      }
      // A domain also carries the cells themselves, and a row averaging fewer cells than it
      // requires is the same loss written in the other list.
      if (Array.isArray(row.cells)) {
        const averaged = row.cells.map((cell) => String(cell?.cell_id)).sort();
        if (!sameCells(averaged)) {
          throw new Error(`AOS_RESULT_INCOMPLETE ${key} row ${String(row[idKey])} averaged ${averaged.length > 0 ? averaged.join(", ") : "no cells"} and its contract declares ${declaredForRow.join(", ")}`);
        }
      }
    }
  }
  for (const [key, , , weights] of rowSets) {
    if (weights === null) continue;
    // The weights say what was averaged, and every index in this instrument is an equal-weight
    // mean. Two things have to hold and neither is a shape: the weighted set is the set the
    // contract declared, and each share is one over that many. The schema rejects a weight that
    // is not a reciprocal at all; six rows each claiming a half is arithmetic, so it is caught
    // here -- a surface that says it weighted its rows unequally is describing an aggregation
    // this instrument does not perform, whatever number it printed.
    const weighted = Object.keys(weights).sort();
    const expected = [...expectedSets[key]].sort();
    if (weighted.length !== expected.length || weighted.some((id, index) => id !== expected[index])) {
      throw new Error(`AOS_RESULT_INCOMPLETE ${key.split(".")[0]} weights ${weighted.length > 0 ? weighted.join(", ") : "nothing"} and its contract declares ${expected.join(", ")}`);
    }
    const share = 1 / expected.length;
    const uneven = Object.entries(weights).filter(([, weight]) => !isFiniteNumber(weight) || Math.abs(weight - share) > AGREEMENT);
    if (uneven.length > 0) {
      throw new Error(`AOS_RESULT_INCONSISTENT ${key.split(".")[0]} weights ${uneven.map(([id, weight]) => `${id} at ${weight}`).join(", ")} where an equal-weight mean over ${expected.length} rows weights each ${share}`);
    }
  }
  // A result has to agree with itself.
  //
  // "Renderers recompute nothing" is about the display: a renderer may not work out a number to
  // show, because then the page and the record could differ and only the page would be read. It was
  // never a licence for the reader to accept a record that contradicts itself -- a process index of
  // 55.5 over six constructs all at 100, a composite of 12.3 whose own inputs and raw value say
  // 100. Those are not results this instrument can have produced, and printing them faithfully is
  // printing a number that means nothing. So the reader checks the stored numbers against the
  // stored rows, weights, inputs, raw values and caps it was handed, refuses by name when they
  // disagree, and the renderers then quote what it validated.
  //
  // The comparison is to a tolerance rather than to the bit, because the contract computes an index
  // by dividing a sum of estimates and this arithmetic scales each row first; the two agree to
  // within floating-point noise and disagree by a value nobody could mistake for noise.
  const meanOf = (values) => values.reduce((total, one) => total + one, 0) / values.length;
  const inconsistent = (what, detail) => {
    throw new Error(`AOS_RESULT_INCONSISTENT ${what} does not follow from the rest of this result: ${detail}`);
  };
  const rowValues = (rowSet) => Object.values(rowSet).map((row) => row.value);
  const processValues = rowValues(process.constructs);
  if (process.issued && (processValues.some((value) => !isFiniteNumber(value)) || disagrees(process.index, meanOf(processValues)))) {
    inconsistent("the process index", `${process.index} is not the equal-weight mean of ${processValues.join(", ")}`);
  }
  const domainValues = rowValues(outcome.domains);
  const outcomeRaw = outcome.raw_index;
  if (outcome.issued && (domainValues.some((value) => !isFiniteNumber(value)) || disagrees(outcomeRaw, meanOf(domainValues)))) {
    inconsistent("the outcome index before any cap", `${outcomeRaw} is not the equal-weight mean of ${domainValues.join(", ")}`);
  }
  // A cap lowers a number to the ceiling it names, and a number that is not the ceiling was not
  // capped by it. Both directions: an index below its raw value has to say which cap did that.
  const ceilingOf = (code, caps) => (caps ?? []).find((cap) => cap.code === code)?.max_value ?? null;
  if (outcome.issued) {
    if (outcome.cap_applied === null && disagrees(outcome.index, outcomeRaw)) {
      inconsistent("the outcome index", `${outcome.index} differs from its uncapped ${outcomeRaw} and names no cap`);
    }
    if (outcome.cap_applied !== null && disagrees(outcome.index, ceilingOf(outcome.cap_applied, outcome.caps))) {
      inconsistent("the outcome index", `${outcome.index} is not the ceiling ${outcome.cap_applied} sets`);
    }
  }
  if (composite.issued) {
    const inputs = composite.inputs;
    if (!isPlainObject(inputs) || disagrees(inputs.operator_process, process.index) || disagrees(inputs.system_outcome, outcome.index)) {
      inconsistent("the composite's inputs", `${canonicalJson(inputs)} are not the two indices beside them`);
    }
    if (disagrees(composite.raw_value, meanOf([process.index, outcomeRaw]))) {
      inconsistent("the composite before any cap", `${composite.raw_value} is not the mean of ${process.index} and ${outcomeRaw}`);
    }
    const throughOutcome = meanOf([inputs.operator_process, inputs.system_outcome]);
    if (composite.cap_applied === null && disagrees(composite.value, throughOutcome)) {
      inconsistent("the composite", `${composite.value} is not the mean of its own inputs and names no cap`);
    }
    if (composite.cap_applied !== null && disagrees(composite.value, ceilingOf(composite.cap_applied, outcome.caps))) {
      inconsistent("the composite", `${composite.value} is not the ceiling ${composite.cap_applied} sets`);
    }
  }

  const relianceMetrics = reliance.metrics;

  // Sorted by id, and the metrics in their declared order, because a result that went through
  // canonicalJson comes back with its keys sorted and the projection has to be the same either way.
  const rows = (entries, idKey) => Object.values(entries ?? {})
    .map((row) => ({ id: row[idKey], title: row.title, value: shown(row.value), status: row.status, reason: row.withheld_reason ?? reasonOf(row.withheld_for) }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const processRows = rows(process.constructs, "construct_id");
  const outcomeRows = rows(outcome.domains, "domain_id");
  const artifactRows = rows(artifact.constructs, "construct_id");
  // Keyed off the status, like every other number on this result. Formatting whatever finite value
  // was in the field printed a withheld metric as `0.00` with the word WITHHELD beside it, which is
  // the reading this instrument exists to refuse, one level below the surface that refuses it.
  const relianceRows = RELIANCE_METRIC_IDS.map((id) => ({
    id,
    value: relianceMetrics[id].status === "ISSUED" && isFiniteNumber(relianceMetrics[id].value)
      ? relianceMetrics[id].value.toFixed(2)
      : relianceMetrics[id].status === "WITHHELD" ? "withheld" : "not computed",
    status: String(relianceMetrics[id].status),
    opportunities: Number.isInteger(relianceMetrics[id].denominator) ? String(relianceMetrics[id].denominator) : null
  }));

  // Keyed off the stored reason, not off the number. Reading the reason out only when the index
  // happened to be null is what let a withheld surface print as a number with nothing beside it.
  const withheldSummary = (reason) => (typeof reason === "string" && reason.length > 0 ? `withheld · ${reason}` : null);
  const capLine = (code) => (typeof code === "string" ? `capped by ${code}` : null);

  const view = {
    schema_id: result.schema_id,
    run_id: typeof result.run?.run_id === "string" ? result.run.run_id : null,
    sections: SECTION_ORDER.map((key) => ({ key, title: SECTION_TITLES[key] })),
    summary: `process ${shown(process.index)} · outcome ${shown(outcome.index)} · composite ${shown(composite.value)}`,
    process: {
      label: process.label,
      index: shown(process.index),
      issued: process.issued === true,
      withheld_summary: withheldSummary(process.withheld_reason),
      coverage: `${process.coverage.issued} of ${process.coverage.required} required cells issued`,
      rows: processRows
    },
    reliance: {
      status: String(reliance.status),
      explains: `explains ${reliance.explains_construct}; never weighted into any index`,
      opportunities: String(reliance.opportunities),
      coverage: `${reliance.coverage.issued} of ${reliance.coverage.required} required cells issued`,
      rows: relianceRows
    },
    outcome: {
      label: outcome.label,
      index: shown(outcome.index),
      raw_index: shown(outcome.raw_index),
      issued: outcome.issued === true,
      cap: capLine(outcome.cap_applied),
      withheld_summary: withheldSummary(outcome.withheld_reason),
      coverage: `${outcome.coverage.issued} of ${outcome.coverage.required} required cells issued`,
      rows: outcomeRows
    },
    composite: {
      label: composite.label,
      value: shown(composite.value),
      raw_value: shown(composite.raw_value),
      formula: String(composite.formula),
      secondary_note: SECONDARY_NOTE,
      cap: capLine(composite.cap_applied),
      withheld_summary: withheldSummary(composite.withheld_reason),
      artifact_rows: artifactRows
    },
    claim: {
      stage: String(result.claim_stage),
      permitted_interpretation: String(result.permitted_interpretation),
      uncertainty: String(result.uncertainty?.status),
      uncertainty_method: typeof result.uncertainty?.method === "string" ? result.uncertainty.method : "none",
      generalizability: String(result.generalizability_status),
      forbidden_uses: [...(result.forbidden_uses ?? [])].map(String),
      facets: Object.keys(result.facet_identity ?? {}).sort().map((facet) => `${facet}: ${result.facet_identity[facet] === null ? "undeclared" : String(result.facet_identity[facet])}`),
      contract: `${result.contract?.id} ${result.contract?.version} · ${result.contract?.digests?.combined}`,
      schema: `${result.schema_id} ${result.schema_version}`
    }
  };

  const phrases = [
    ...view.sections.map((section) => section.title),
    view.summary,
    view.process.label, view.process.index, view.process.coverage,
    ...processRows.flatMap((row) => [`${row.id} ${row.title}`, row.value, ...(row.reason ? [row.reason] : [])]),
    view.reliance.status, view.reliance.explains, view.reliance.coverage,
    ...relianceRows.map((row) => `${row.id}: ${row.value}`),
    view.outcome.label, view.outcome.index, view.outcome.coverage,
    ...outcomeRows.flatMap((row) => [`${row.id} ${row.title}`, row.value, ...(row.reason ? [row.reason] : [])]),
    view.composite.label, view.composite.value, view.composite.formula, view.composite.secondary_note,
    // The delegated-artifact rows are content a renderer must show, so they are content the oracle
    // must name. Leaving them out let the card omit them and the test that says "every renderer
    // prints every phrase" pass over the omission -- an oracle that excludes what it should check.
    ...artifactRows.flatMap((row) => [`${row.id} ${row.title}`, row.value, ...(row.reason ? [row.reason] : [])]),
    view.claim.stage, view.claim.uncertainty, view.claim.generalizability,
    // What the result may not be used for travels with it. A projection that dropped these left the
    // number in the reader's hands and the limits on the page they did not open.
    ...view.claim.forbidden_uses,
    ...[view.process.withheld_summary, view.outcome.withheld_summary, view.composite.withheld_summary, view.outcome.cap, view.composite.cap].filter((line) => line !== null)
  ];
  const headline = [
    view.process.label, view.process.index,
    view.outcome.label, view.outcome.index,
    view.composite.label, view.composite.value, view.composite.secondary_note,
    view.claim.stage, view.claim.uncertainty, view.claim.generalizability,
    ...[view.process.withheld_summary, view.outcome.withheld_summary, view.composite.withheld_summary, view.outcome.cap, view.composite.cap].filter((line) => line !== null)
  ];
  return deepFreeze({ ...view, phrases: [...new Set(phrases)], headline: [...new Set(headline)] });
}
