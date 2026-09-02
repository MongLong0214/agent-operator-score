// Which model a run actually used, and what that entitles the result to claim.
//
// Until #561 the profile carried a `model_id` read by a regular expression over the runtime's
// `--version` output. No runtime this product knows prints its model there, so every real run was
// filed under `model unknown`, three of them were issued as a profile-bound Operator Score anyway,
// and a provider-managed alias that moved underneath the operator between two runs was the same
// cohort as far as the ledger could tell. The number described an environment nobody had named.
//
// This module is the model half of a profile. It produces one provenance record per run from the
// sources the issue ranks -- a structured event in the run's own transcript, the runtime's own
// configuration, an explicit declaration, or nothing -- and it says, by name, when two of those
// disagree, when the name is an alias the provider may move, and what may therefore be issued.
// The executable half stays where #554 put it (`lib/runtime-identity.mjs`); this file binds to
// it and never describes a program itself.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./core.mjs";
import { sha256Bytes } from "./digest.mjs";
import { containsSecretMaterial } from "./redact.mjs";
import { shippedEcdContract } from "./ecd-contract.mjs";
import { identityDigestPrefix } from "./runtime-identity.mjs";

export const MODEL_PROVENANCE_SCHEMA = "aos-model-provenance.v1";
export const MODEL_IDENTITY_SCHEMA = "aos-model-identity.v1";

/** The sources a model name can come from, highest precedence first. */
export const MODEL_SOURCES = Object.freeze(["runtime-event", "runtime-config", "declared", "unknown"]);

// Confidence is a property of the source, not a judgement made per record: a transcript row is
// what the runtime itself wrote during the run, a command-line flag is what the operator asked the
// runtime for, and a declaration is what the operator told AOS. Nothing here raises one.
const CONFIDENCE_BY_SOURCE = new Map([
  ["runtime-event", "HIGH"],
  ["runtime-config", "MEDIUM"],
  ["declared", "LOW"],
  ["unknown", "NONE"]
]);

/**
 * Names that are not a model. `latest` and `default` say nothing; `gpt`, `sonnet`, `opus`, `haiku`
 * name a family the provider re-points at will. The issue lists the first four; the last two are
 * the same kind of name under the other provider and are held to the same rule.
 */
export const BARE_ALIASES = new Set(["latest", "default", "gpt", "sonnet", "opus", "haiku"]);

// A snapshot is a name the provider has promised not to move, and the only proof of that this
// product can read off a name is a date stamp under a naming scheme it knows. Three conditions,
// because the marker alone was accepting `latest-9999-99-99`: the digits must be a real calendar
// date, the root of the name must not be one of the words that says the provider moves it, and
// the provider and family must be ones whose snapshot naming this product has been told. Anything
// else is a provider-managed alias -- fail-closed, an unproven snapshot is never read as exact.
const SNAPSHOT_MARKER = /(?:^|[-_.:@])(\d{4})-?(\d{2})-?(\d{2})(?:$|[-_.:@])/u;

// Whose date-stamped names mean a frozen model. Only the providers this product actually reads
// runs from: a family nobody here has naming rules for is not refused -- it runs, and it produces
// run diagnostics -- but its name is not called exact on a guess. `Date.parse` is not used; a
// month and a day are arithmetic, and a parser that accepts `2026-02-30` as March 2nd is exactly
// the leniency this is here to remove.
const SNAPSHOT_FAMILIES = new Map([
  ["openai", new Set(["gpt", "o1", "o3", "o4", "codex", "chatgpt"])],
  ["anthropic", new Set(["claude"])]
]);

// The words that say the provider moves this name, wherever they stand in it. Distinct from
// BARE_ALIASES, which are whole names: `gpt` alone is an alias and `gpt-4o-2024-08-06` is not,
// while `latest-2026-01-01` is the pointer with a date written beside it.
const MOVING_ROOTS = new Set(["latest", "default"]);

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isCalendarDate = (year, month, day) => {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  return day <= days;
};

/** The first token of a model name: `latest` in `latest-2026-01-01`, `gpt` in `gpt-4o-…`. */
const rootToken = (model) => model.split(/[-_.:@]/u)[0];

// A family this product has naming rules for. With a provider named, only that provider's rules
// apply; without one -- a bare `gpt-4o-2024-08-06` on a command line -- any known provider's do,
// because the adapter supplies the provider in every path that reaches a profile.
const recognisedFamily = (provider, root) => (provider === null
  ? [...SNAPSHOT_FAMILIES.values()].some((families) => families.has(root))
  : SNAPSHOT_FAMILIES.get(provider)?.has(root) === true);

// What may stand between the family and the date in a snapshot name. Version tokens -- `4`, `4o`,
// `4.1`, `3`, `5` -- and the tier words the two providers ship. Anything else is a segment this
// product cannot recognise, and a name it cannot read is not proof of anything: `gpt-not-a-real-
// model-2024-01-01` has a real family, a real date and names no model.
const VERSION_SEGMENT = /^\d+(?:\.\d+)*[a-z]?$/u;
const TIER_SEGMENTS = new Map([
  ["openai", new Set(["mini", "nano", "turbo", "preview", "instruct", "chat", "pro", "max", "high", "low", "sol", "terra"])],
  ["anthropic", new Set(["sonnet", "opus", "haiku", "instant"])]
]);

const recognisedSegment = (provider, segment) => {
  if (VERSION_SEGMENT.test(segment)) return true;
  if (provider === null) return [...TIER_SEGMENTS.values()].some((tiers) => tiers.has(segment));
  return TIER_SEGMENTS.get(provider)?.has(segment) === true;
};

const snapshotProof = (provider, model) => {
  const marker = model.match(SNAPSHOT_MARKER);
  if (marker === null) return false;
  if (!isCalendarDate(Number(marker[1]), Number(marker[2]), Number(marker[3]))) return false;
  const segments = model.split(/[-_.:@]/u);
  if (!recognisedFamily(provider, segments[0])) return false;
  // Everything between the family and the date has to be a token this product can read: a version
  // or a tier this provider ships. That covers a moving root wherever it stands --
  // `gpt-latest-2024-01-01` reads like a snapshot and `latest` is not a version or a tier -- so
  // there is no separate scan for one, which would be a second rule saying the same thing. The
  // date itself is whatever the marker matched, and is dropped from the check by digit shape.
  const middle = segments.slice(1).filter((segment) => !/^\d{2,8}$/u.test(segment));
  return middle.every((segment) => recognisedSegment(provider, segment));
};

// A model name is short, and its alphabet is small. Both halves of that are load-bearing: the
// value being tested arrives from a transcript file a child process wrote, so it is attacker
// text, and the previous bound -- two hundred characters of anything spellable -- accepted an API
// key, which this module then printed in JSON, on the CLI, in Markdown and in HTML. The longest
// real name any provider ships is around thirty characters.
const MODEL_NAME = /^[a-z0-9][a-z0-9._:@-]{0,47}$/u;
const PROVIDER_NAME = /^[a-z0-9][a-z0-9._-]{0,31}$/u;

/**
 * Splits `provider/model` and normalises both halves.
 *
 * Case is folded because providers accept either and two spellings of one snapshot are one
 * snapshot; the fold is recorded in the id, not hidden behind it. A name that is not a plausible
 * model name at all is treated as absent rather than as a model nobody can look up.
 */
export const parseModelName = (raw, fallbackProvider = null) => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return null;
  // Shape is not the only guard, because a short credential is spellable as a model name. A value
  // carrying material the redactor recognises is refused here rather than masked downstream: this
  // function's output is an identifier that gets printed, and there is no such thing as a
  // partially printed identifier.
  if (containsSecretMaterial(trimmed)) return null;
  const slash = trimmed.indexOf("/");
  const provider = slash > 0 ? trimmed.slice(0, slash) : (typeof fallbackProvider === "string" && fallbackProvider !== "" ? fallbackProvider.toLowerCase() : null);
  const model = slash > 0 ? trimmed.slice(slash + 1) : trimmed;
  if (!MODEL_NAME.test(model)) return null;
  if (provider !== null && !PROVIDER_NAME.test(provider)) return null;
  return { provider, model, id: provider === null ? model : `${provider}/${model}` };
};

/** A provider name from a transcript, or null. Separate so a junk provider does not lose the model. */
const safeProvider = (raw) => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return PROVIDER_NAME.test(trimmed) && !containsSecretMaterial(trimmed) ? trimmed : null;
};

const familyOf = (model) => model?.match(/^[a-z]+/u)?.[0] ?? null;

/**
 * Whether a name is an exact identity or an alias, and therefore whether a number produced under
 * it can be compared with a number produced under the same name tomorrow.
 */
export const aliasClassOf = (raw, fallbackProvider = null) => {
  const parsed = parseModelName(raw, fallbackProvider);
  if (parsed === null) return { alias_class: "unknown", mutable_alias: null };
  // A whole name that is a family, or a name rooted in a word that says the provider moves it:
  // `latest-2026-01-01` reads like a snapshot and is the pointer with a date written beside it.
  if (BARE_ALIASES.has(parsed.model) || MOVING_ROOTS.has(rootToken(parsed.model))) {
    return { alias_class: "bare-alias", mutable_alias: true };
  }
  if (snapshotProof(parsed.provider, parsed.model)) return { alias_class: "exact-snapshot", mutable_alias: false };
  if (!recognisedFamily(parsed.provider, rootToken(parsed.model))) {
    // Named apart from the alias below, because the remedy differs: this one is not the operator's
    // to fix, it is a family whose naming rules this product does not carry.
    return { alias_class: "unrecognised-family", mutable_alias: true };
  }
  return { alias_class: "provider-managed-alias", mutable_alias: true };
};

/**
 * The model named on the runtime's own command line, read through the adapter's declared flags.
 *
 * Only through those flags: the generic adapter declares none, so an argument that happens to be
 * spelled `--model` on a command nobody described is not a configuration this product read. Two
 * different values on one line is not one configuration either, and is refused rather than
 * resolved by position.
 */
export function runtimeConfigModel(args, flags) {
  if (!Array.isArray(args) || !Array.isArray(flags) || flags.length === 0) return null;
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (typeof argument !== "string") continue;
    if (flags.includes(argument)) {
      if (typeof args[index + 1] === "string") values.push(args[index + 1]);
      index += 1;
      continue;
    }
    for (const flag of flags) {
      if (argument.startsWith(`${flag}=`)) values.push(argument.slice(flag.length + 1));
    }
  }
  const distinct = [...new Set(values.map((value) => value.trim().toLowerCase()))];
  if (distinct.length > 1) throw new Error(`AOS_MODEL_CONFIG_AMBIGUOUS ${distinct.join(", ")}`);
  return distinct[0] ?? null;
}

const candidateFrom = (source, input) => {
  if (!input || typeof input !== "object") return null;
  const parsed = parseModelName(input.model, input.provider ?? null);
  if (parsed === null) return null;
  return {
    source,
    ...parsed,
    runtime: typeof input.runtime === "string" ? input.runtime : null,
    row_digest: typeof input.row_digest === "string" ? input.row_digest : null
  };
};

// Two candidates name the same model when the model halves agree and, where both know a provider,
// the providers agree too. A declaration without a provider does not contradict an event with one.
const sameModel = (left, right) =>
  left.model === right.model && (left.provider === null || right.provider === null || left.provider === right.provider);

const claimDigest = (claim) => sha256Bytes(Buffer.from(canonicalJson(claim), "utf8"));

/**
 * The provenance record for one run.
 *
 * `runtimeEvent` is a row the runtime wrote in its own transcript during the run; `runtimeConfig`
 * the model named in the runtime's arguments; `declared` what the operator registered. The first
 * present source wins, the others may only agree with it. When one disagrees the record is a
 * MISMATCH with no id: the run happened, but under a model this product cannot name, and nothing
 * downstream is entitled to pick a side.
 */
export function resolveModelProvenance({ runtimeEvent = null, runtimeConfig = null, declared = null } = {}) {
  const candidates = [
    candidateFrom("runtime-event", runtimeEvent),
    candidateFrom("runtime-config", runtimeConfig),
    candidateFrom("declared", declared)
  ].filter((candidate) => candidate !== null);

  if (candidates.length === 0) {
    return {
      schema_id: MODEL_PROVENANCE_SCHEMA,
      provider: null,
      family: null,
      id: null,
      source: "unknown",
      confidence: "NONE",
      evidence_digest: null,
      mutable_alias: null,
      alias_class: "unknown",
      status: "UNKNOWN",
      mismatch: null,
      corroborated_by: [],
      evidence: null
    };
  }

  const [winner, ...rest] = candidates;
  const disagreeing = rest.find((candidate) => !sameModel(winner, candidate));
  if (disagreeing !== undefined) {
    const claim = { schema_id: MODEL_PROVENANCE_SCHEMA, conflict: candidates.map(({ source, id, runtime, row_digest }) => ({ source, id, runtime, row_digest })) };
    return {
      schema_id: MODEL_PROVENANCE_SCHEMA,
      provider: null,
      family: null,
      id: null,
      source: "unknown",
      confidence: "NONE",
      evidence_digest: claimDigest(claim),
      mutable_alias: null,
      alias_class: "unknown",
      status: "MISMATCH",
      mismatch: {
        code: "AOS_MODEL_IDENTITY_MISMATCH",
        detected: winner.id,
        detected_source: winner.source,
        declared: disagreeing.id,
        declared_source: disagreeing.source
      },
      corroborated_by: [],
      evidence: { claim, row_digest: winner.row_digest }
    };
  }

  // The winner's provider may be null while a lower source knew one; the id still binds to the
  // more specific name, since the two were just shown to agree.
  const provider = winner.provider ?? rest.find((candidate) => candidate.provider !== null)?.provider ?? null;
  const id = provider === null ? winner.model : `${provider}/${winner.model}`;
  const alias = aliasClassOf(id);
  // The claim, not the row. The evidence digest goes into the profile digest, and a cohort key
  // that carried the transcript row's digest would make every repeat of one measurement its own
  // profile -- three runs of one model would never form a cycle. The row is recorded beside the
  // claim, and the verification carries it too, so nothing is lost by keeping it out of the key.
  const claim = { schema_id: MODEL_PROVENANCE_SCHEMA, source: winner.source, provider, id, runtime: winner.runtime };
  return {
    schema_id: MODEL_PROVENANCE_SCHEMA,
    provider,
    family: familyOf(winner.model),
    id,
    source: winner.source,
    confidence: CONFIDENCE_BY_SOURCE.get(winner.source),
    evidence_digest: claimDigest(claim),
    mutable_alias: alias.mutable_alias,
    alias_class: alias.alias_class,
    status: alias.mutable_alias ? "MUTABLE" : "EXACT",
    mismatch: null,
    corroborated_by: rest.map((candidate) => candidate.source),
    evidence: { claim, row_digest: winner.row_digest }
  };
}

/**
 * The provenance a cycle locks when it opens: the model the operator bound, as the runtime that
 * will run it is expected to state it.
 *
 * The digest covers the provenance record -- source, confidence and evidence with it -- and a run
 * resolves its provenance from its own transcript before its digest is taken. So a cycle that
 * locked the pre-run binding would exclude every run the runtime confirmed, which is the opposite
 * of what the cohort is for. What it locks instead is the profile it expects: confirmed by this
 * runtime, for this model. A run that was not confirmed, or was confirmed as something else, does
 * not land on that digest and `runValidity` names it PROFILE_CHANGED.
 */
export function expectedRunProvenance({ runtimeConfig = null, declared = null, runtime = null } = {}) {
  const bound = resolveModelProvenance({ runtimeConfig, declared });
  if (typeof runtime !== "string" || runtime === "" || typeof bound.id !== "string") return bound;
  return resolveModelProvenance({
    runtimeEvent: { model: bound.id, provider: bound.provider, runtime },
    runtimeConfig,
    declared
  });
}

/** Refuses to bind a contradiction. Called wherever a profile digest is about to be locked. */
export function assertModelIdentity(record) {
  if (record?.status === "MISMATCH") {
    throw new Error(`AOS_MODEL_IDENTITY_MISMATCH detected ${record.mismatch.detected} (${record.mismatch.detected_source}), declared ${record.mismatch.declared} (${record.mismatch.declared_source})`);
  }
  return record;
}

// ---------------------------------------------------------------------------------------------
// Runtime events

const MAX_TRANSCRIPT_FILES = 10000;
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MAX_WALK_DEPTH = 8;

const walkJsonl = (root, since, out, depth = 0) => {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_TRANSCRIPT_FILES) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_TRANSCRIPT_FILES) return;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(path, since, out, depth + 1);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    // Modified before the run began is somebody else's session, whatever it names.
    if (stat.mtimeMs < since || stat.size > MAX_TRANSCRIPT_BYTES) continue;
    out.push(path);
  }
};

const workspaceForms = (workspace) => {
  const forms = new Set([workspace]);
  try {
    forms.add(realpathSync(workspace));
  } catch {
    // A workspace that no longer exists still has the one spelling the runtime recorded.
  }
  return forms;
};

const parseRow = (line) => {
  try {
    const row = JSON.parse(line.toString("utf8"));
    return row && typeof row === "object" ? row : null;
  } catch {
    return null;
  }
};

const eventsFromCodex = (lines, workspaces, push) => {
  let provider = null;
  for (const line of lines) {
    const row = parseRow(line);
    if (row === null || !row.payload || typeof row.payload !== "object") continue;
    if (!workspaces.has(row.payload.cwd)) continue;
    if (row.type === "session_meta" && typeof row.payload.model_provider === "string") {
      provider = row.payload.model_provider;
      continue;
    }
    if (row.type === "turn_context" && typeof row.payload.model === "string") {
      push({ runtime: "codex", provider, model: row.payload.model, row_digest: sha256Bytes(line) });
    }
  }
};

const eventsFromClaude = (lines, workspaces, push) => {
  for (const line of lines) {
    const row = parseRow(line);
    if (row === null || row.type !== "assistant" || !workspaces.has(row.cwd)) continue;
    const model = row.message?.model;
    // `<synthetic>` is what Claude Code writes for a turn it produced itself, not the model.
    if (typeof model !== "string" || model.startsWith("<")) continue;
    push({ runtime: "claude-code", provider: "anthropic", model, row_digest: sha256Bytes(line) });
  }
};

const splitLines = (bytes) => {
  const lines = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    if (index > start) lines.push(bytes.subarray(start, index));
    start = index + 1;
  }
  if (start < bytes.length) lines.push(bytes.subarray(start));
  return lines;
};

/**
 * The canonical form of one model event: which runtime, which provider, which model, and nothing
 * else. The committed canary is digested over this, so the fixture can be checked against itself
 * rather than carrying digests nothing verifies (#561).
 */
export const canonicalModelEventLine = (event) =>
  JSON.stringify({ runtime: event?.runtime ?? null, provider: event?.provider ?? null, model: event?.model ?? null });

/**
 * The models the runtimes said they used, read from the transcripts they wrote during this run.
 *
 * Codex writes `~/.codex/sessions/**\/rollout-*.jsonl` with a `turn_context` row per turn; Claude
 * Code writes `~/.claude/projects/<slug>/*.jsonl` with `message.model` on every assistant row.
 * Both record the working directory, which is how a row is tied to this run rather than to a
 * session the operator happened to have open. Rows are digested as the bytes on disk, so the
 * evidence a record quotes is the row itself and not this module's reading of it.
 *
 * `env` is the child's environment: HOME and the config directories as the runtime saw them.
 */
export function observeModelEvents({ env = {}, workspace, since = 0, runtime = null } = {}) {
  if (typeof workspace !== "string" || workspace === "") return [];
  // The tree the configured adapter writes, and no other. Reading both meant a run under one
  // runtime was corroborated by a transcript in the other's shape, which any process with write
  // access to the temporary HOME can produce. An adapter with no transcript shape reads nothing.
  if (typeof runtime !== "string" || runtime === "") return [];
  const home = typeof env.HOME === "string" && env.HOME !== "" ? env.HOME : null;
  const roots = [
    ["codex", typeof env.CODEX_HOME === "string" && env.CODEX_HOME !== "" ? join(env.CODEX_HOME, "sessions") : (home === null ? null : join(home, ".codex", "sessions"))],
    ["claude-code", typeof env.CLAUDE_CONFIG_DIR === "string" && env.CLAUDE_CONFIG_DIR !== "" ? join(env.CLAUDE_CONFIG_DIR, "projects") : (home === null ? null : join(home, ".claude", "projects"))]
  ];
  const workspaces = workspaceForms(workspace);
  const seen = new Set();
  const events = [];
  // The single place a transcript's own text becomes an event. Everything past it is either a
  // name this module is willing to print or the digest of one it is not: the transcript is a file
  // the child process wrote, and a value that fails the name shape leaves as `sha256:…` so that a
  // reader can still tell the row apart without anybody printing what it said.
  const push = (event) => {
    const provider = safeProvider(event.provider);
    const named = parseModelName(event.model, provider);
    const safe = named === null
      ? {
        runtime: event.runtime,
        provider,
        model: null,
        value_digest: sha256Bytes(Buffer.from(typeof event.model === "string" ? event.model : "", "utf8")),
        row_digest: event.row_digest
      }
      : { runtime: event.runtime, provider: named.provider, model: named.model, value_digest: null, row_digest: event.row_digest };
    const key = `${safe.runtime}\u0000${safe.provider ?? ""}\u0000${safe.model ?? safe.value_digest}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(safe);
  };
  for (const [kind, root] of roots) {
    if (root === null || kind !== runtime) continue;
    const files = [];
    walkJsonl(root, since, files);
    for (const file of files.sort()) {
      let bytes;
      try {
        bytes = readFileSync(file);
      } catch {
        continue;
      }
      const lines = splitLines(bytes);
      if (kind === "codex") eventsFromCodex(lines, workspaces, push);
      else eventsFromClaude(lines, workspaces, push);
    }
  }
  return events;
}

/**
 * What the transcript said against what the profile bound.
 *
 * The profile digest is locked before the run, from the sources that exist before the run. A
 * runtime event arrives afterwards, so it cannot join the digest; what it can do is confirm the
 * binding, contradict it by name, or fail to appear. An unknown binding is not promoted by an
 * event that arrived after the digest was locked -- the digest already says "unknown", and a
 * number filed under it stays filed there.
 */
export function verifyModelIdentity(bound, events = [], { runtime = null } = {}) {
  const observed = [];
  const unnameable = [];
  const seen = new Set();
  // Only the runtime that was configured can corroborate its own binding. Comparing the model
  // name alone meant any process able to write a Codex-shaped row under the run's HOME confirmed
  // a declaration -- including an agent whose adapter is not Codex at all. An adapter this product
  // has no transcript shape for (`runtime` null) can never be corroborated, which is the
  // fail-closed half: it withholds rather than accepting whatever is lying in the directory.
  const fromRuntime = (Array.isArray(events) ? events : []).filter((event) => typeof runtime === "string" && runtime !== "" && event?.runtime === runtime);
  for (const event of fromRuntime) {
    const candidate = candidateFrom("runtime-event", event);
    if (candidate === null) {
      // A row this module will not name is still a row that was there. It is reported by digest,
      // because the alternative -- dropping it -- reads downstream as a transcript that said
      // nothing, and a transcript that named something unprintable is not silence.
      if (typeof event?.value_digest === "string") unnameable.push({ id: null, value_digest: event.value_digest, runtime: event.runtime ?? null, row_digest: event.row_digest ?? null });
      continue;
    }
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    observed.push({ id: candidate.id, provider: candidate.provider, model: candidate.model, runtime: candidate.runtime, row_digest: candidate.row_digest });
  }
  if (bound?.status === "MISMATCH") return { status: "MISMATCH", code: "AOS_MODEL_IDENTITY_MISMATCH", observed, unnameable };
  if (unnameable.length > 0) return { status: "UNNAMEABLE", code: "AOS_MODEL_EVENT_UNNAMEABLE", observed, unnameable };
  if (observed.length > 1) return { status: "AMBIGUOUS", code: "AOS_MODEL_EVENT_AMBIGUOUS", observed, unnameable };
  // Named, not silent: "no event" is a state an operator can act on -- the runtime wrote no
  // transcript, or wrote it somewhere this run could not see -- and a state with no code is a
  // state nothing downstream can quote.
  if (observed.length === 0) return { status: "NOT_OBSERVED", code: "AOS_MODEL_EVENT_NOT_OBSERVED", observed, unnameable };
  if (typeof bound?.id !== "string") return { status: "OBSERVED_UNBOUND", code: "AOS_MODEL_EVENT_UNBOUND", observed, unnameable };
  const boundName = parseModelName(bound.id);
  if (boundName !== null && sameModel(boundName, observed[0])) return { status: "CONFIRMED", code: null, observed, unnameable };
  return { status: "MISMATCH", code: "AOS_MODEL_IDENTITY_MISMATCH", observed, unnameable };
}

// ---------------------------------------------------------------------------------------------
// Issuance

/** Reasons a profile-bound aggregate is withheld, most severe first. */
/**
 * Every verdict this module emits. The set is closed and checked, because the absent case used to
 * be "null or NOT_OBSERVED" -- so `{}`, a status from some other vocabulary, or a hand-made object
 * passed every gate and issued. A verification this module did not produce is not evidence.
 */
export const VERIFICATION_STATUSES = Object.freeze([
  "CONFIRMED", "MISMATCH", "AMBIGUOUS", "UNNAMEABLE", "NOT_OBSERVED", "OBSERVED_UNBOUND"
]);

const knownVerification = (verification) =>
  verification !== null && typeof verification === "object" && VERIFICATION_STATUSES.includes(verification.status);

export const WITHHELD_REASONS = Object.freeze([
  // Not a fault in the model or the executable: a run that is a diagnostic by construction has
  // nothing to issue whatever it was run under, and it says so under its own name rather than
  // borrowing whichever model reason happens to apply (#561).
  "DIAGNOSTIC_RUN",
  "MODEL_PROVENANCE_ABSENT",
  "MODEL_IDENTITY_MISMATCH",
  "MODEL_EVENT_UNNAMEABLE",
  "MODEL_EVENT_AMBIGUOUS",
  "MODEL_UNKNOWN",
  "MODEL_MUTABLE_ALIAS",
  "MODEL_EVENT_UNATTESTED",
  "RUNTIME_IDENTITY_UNVERIFIED"
]);

/** The executable half of a profile is bound only when #554 verified the program it names. */
const runtimeIdentityVerified = (runtimeIdentity) =>
  typeof runtimeIdentity?.identity_digest === "string" && runtimeIdentity.identity_status === "VERIFIED";

const withheldReasonFor = (provenance, rawVerification, runtimeIdentity) => {
  // Anything this module did not emit is treated as no verification at all.
  const verification = knownVerification(rawVerification) ? rawVerification : null;
  if (!provenance || typeof provenance !== "object") return "MODEL_PROVENANCE_ABSENT";
  if (provenance.status === "MISMATCH" || verification?.status === "MISMATCH") return "MODEL_IDENTITY_MISMATCH";
  if (verification?.status === "UNNAMEABLE") return "MODEL_EVENT_UNNAMEABLE";
  if (verification?.status === "AMBIGUOUS") return "MODEL_EVENT_AMBIGUOUS";
  if (provenance.status === "UNKNOWN" || typeof provenance.id !== "string") return "MODEL_UNKNOWN";
  if (provenance.mutable_alias !== false || provenance.status === "MUTABLE") return "MODEL_MUTABLE_ALIAS";
  // The model is exact and nothing contradicted it, and that is still only half a profile. A
  // profile-bound number says "this operator, this model, this program"; issuance used to read
  // only the model, so a result whose executable identity was missing, untrusted or unverifiable
  // was issued under a cohort key whose executable half nobody had established.
  // Corroboration is necessary and never sufficient. The transcript is read out of the HOME the
  // assessed child was given, so that child can write it: a model named only there is a claim the
  // assessed artifact made about itself, and a claim stage it could raise by writing a file is a
  // claim stage it controls. What the transcript may do is confirm or contradict something the
  // operator stated -- a declaration or the runtime's own command line -- and that is what
  // `corroborated_by` records.
  if (provenance.source === "runtime-event" && !provenance.corroborated_by?.some((source) => source === "declared" || source === "runtime-config")) {
    return "MODEL_EVENT_UNATTESTED";
  }
  if (!runtimeIdentityVerified(runtimeIdentity)) return "RUNTIME_IDENTITY_UNVERIFIED";
  // Nothing below this line depends on the transcript being present, and that is deliberate. The
  // row is written by the assessed process into a HOME it was given, so whichever way the rule
  // points, the child must not be the input that decides. Requiring corroboration handed it the
  // flip -- declaration alone withheld, declaration plus the row the child wrote issued -- so the
  // trust runs the other way: what may issue is the operator's own statement of the model, and
  // what the transcript may do is contradict it, which is handled above by name. Its absence is
  // reported (`MODEL_EVENT_NOT_OBSERVED` on the verification) and withholds nothing.
  return null;
};

const mismatchSides = (provenance, verification) => {
  if (provenance?.mismatch) return { detected: provenance.mismatch.detected, declared: provenance.mismatch.declared };
  return { detected: verification?.observed?.[0]?.id ?? "unknown", declared: provenance?.id ?? "unknown" };
};

const withheldDetail = (reason, provenance, rawVerification, runtimeIdentity) => {
  const verification = knownVerification(rawVerification) ? rawVerification : null;
  if (reason === "MODEL_PROVENANCE_ABSENT") return "this result predates model provenance and is historical/provisional";
  if (reason === "MODEL_IDENTITY_MISMATCH") {
    const sides = mismatchSides(provenance, verification);
    return `detected ${sides.detected} but declared ${sides.declared}`;
  }
  if (reason === "MODEL_EVENT_UNNAMEABLE") {
    return `the run's transcript named ${verification.unnameable.length} value(s) that are not model names (${verification.unnameable.map((entry) => entry.value_digest).join(", ")})`;
  }
  if (reason === "MODEL_EVENT_AMBIGUOUS") return `the run's transcript names ${verification.observed.length} different models: ${verification.observed.map((entry) => entry.id).join(", ")}`;
  if (reason === "MODEL_UNKNOWN") return "no runtime event, runtime config or declaration identified the model";
  if (reason === "MODEL_MUTABLE_ALIAS") {
    return provenance.alias_class === "bare-alias"
      ? `${provenance.id} is a bare alias, never an exact identity`
      : `${provenance.id} is a provider-managed alias without snapshot proof`;
  }
  if (reason === "MODEL_EVENT_UNATTESTED") {
    return `${provenance.id} was named only by the transcript the assessed process wrote; a run diagnostic, until the operator's own configuration or declaration says the same`;
  }
  if (reason === "RUNTIME_IDENTITY_UNVERIFIED") {
    const status = typeof runtimeIdentity?.identity_status === "string" ? runtimeIdentity.identity_status : "MIGRATION_REQUIRED";
    return `the executable identity is ${status}; a profile-bound number names the program it was produced by`;
  }
  return null;
};

/**
 * What a run under this provenance is entitled to.
 *
 * A run diagnostic is always permitted: the run happened and its own raw score is a fact about
 * it. A profile-bound aggregate is not, unless the model is exact and nothing contradicted it.
 * Generalisation to the person is #584's evidence and stays UNESTABLISHED here; comparison across
 * models is #585's invariance evidence and stays WITHHELD here. Both are states this module names
 * and does not decide.
 */
/**
 * What the measurement contract says about generalising and about comparing across models.
 *
 * Read from the artifact, not restated here. These were four literals in this file --
 * `UNESTABLISHED`, `WITHHELD`, `INVARIANCE_UNESTABLISHED` -- which agreed with the contract on the
 * day they were written and would have gone on agreeing with nothing in particular afterwards. The
 * contract owns the rule; this projection reports it (#561, #584, #585).
 */
export function modelIdentityProjection({ contract = shippedEcdContract() } = {}) {
  const use = contract.interpretation_use;
  const invariance = use.comparability_rules.find((rule) => rule.rule_id === "invariance-required") ?? null;
  // A contract with no invariance rule is not a contract that permits the comparison; it is one
  // whose evidence for it is missing, which is the same answer as UNESTABLISHED. This read
  // `invariance !== null && …`, so an empty rule list came back PERMITTED -- absent evidence
  // failing open, which is the shape of defect this whole issue is about.
  const withheld = invariance === null || invariance.status !== "ENFORCED";
  return {
    generalizability_status: use.generalizability_status,
    generalizability_until: "#584 facet evidence",
    cross_model_comparison: withheld ? "WITHHELD" : "PERMITTED",
    model_change_improvement_claim: withheld ? "WITHHELD" : "PERMITTED",
    comparison_until: invariance?.refusal_reason ?? "INVARIANCE_RULE_ABSENT"
  };
}

export function issuancePolicyFor({ provenance = null, verification = null, runtimeIdentity = null } = {}) {
  const reason = withheldReasonFor(provenance, verification, runtimeIdentity);
  const withheld = reason !== null;
  return {
    claim_stage: withheld ? "RUN_DIAGNOSTIC" : "PROFILE_BOUND",
    run_diagnostic_permitted: true,
    profile_bound_aggregation: {
      status: withheld ? "withheld" : "issued",
      reason,
      detail: withheld ? withheldDetail(reason, provenance, verification, runtimeIdentity) : null
    },
    composite: withheld ? "WITHHELD" : "ISSUABLE",
    ...modelIdentityProjection()
  };
}

// ---------------------------------------------------------------------------------------------
// The record and its projection

const modelPhrase = ({ provenance, verification }) => {
  if (!provenance || typeof provenance !== "object") return "unknown (historical result, no provenance record)";
  if (provenance.status === "MISMATCH" || verification?.status === "MISMATCH") {
    const sides = mismatchSides(provenance, verification);
    return `mismatch — detected ${sides.detected}, declared ${sides.declared} (AOS_MODEL_IDENTITY_MISMATCH)`;
  }
  if (verification?.status === "UNNAMEABLE") {
    return `unnameable — the transcript named ${verification.unnameable.length} value(s) this product will not print (AOS_MODEL_EVENT_UNNAMEABLE)`;
  }
  if (verification?.status === "AMBIGUOUS") {
    return `ambiguous — transcript named ${verification.observed.map((entry) => entry.id).join(", ")} (AOS_MODEL_EVENT_AMBIGUOUS)`;
  }
  if (typeof provenance.id !== "string") {
    return verification?.status === "OBSERVED_UNBOUND"
      ? `unknown (transcript named ${verification.observed[0].id} after the profile was bound)`
      : "unknown";
  }
  // The verb is the record's own source and nothing else. It used to read "detected" whenever a
  // transcript confirmed the declaration, so the JSON said `source: "declared", confidence: "LOW"`
  // while the line beside it claimed the runtime had been observed saying it. Confirmation is a
  // qualifier -- it is what the transcript adds to a declaration, not what the declaration became.
  const verb = provenance.source === "runtime-event"
    ? "detected"
    : provenance.source === "runtime-config" ? "configured" : "declared";
  const qualifiers = [
    provenance.alias_class,
    provenance.mutable_alias ? "mutable" : null,
    verification?.status === "CONFIRMED" && provenance.source !== "runtime-event" ? "confirmed by the runtime's own transcript" : null
  ].filter((part) => part !== null);
  return `${verb} ${provenance.id} (${qualifiers.join(", ")})`;
};

const aggregationLine = (policy) =>
  policy.status === "issued"
    ? "Profile-bound aggregation: issued"
    : `Profile-bound aggregation: withheld — ${policy.reason}: ${policy.detail}`;

/**
 * The lines every projection shows, as one list so that JSON, CLI, Markdown and HTML cannot drift.
 *
 * A null record is a result that predates the record, and says so: a historical result is not
 * read as an exact one because the line that would have said otherwise is missing.
 */
export function modelIdentityLines(record) {
  if (!record || typeof record !== "object") {
    const policy = issuancePolicyFor({ provenance: null }).profile_bound_aggregation;
    return [
      "Model: unknown (historical result, no provenance record)",
      "Runtime executable identity: unverified",
      "Profile digest: unknown",
      aggregationLine(policy)
    ];
  }
  const lines = [];
  for (const [agentId, entry] of Object.entries(record.by_agent ?? {}).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    lines.push(`Model (${agentId}): ${modelPhrase(entry)}`);
    const status = typeof entry.runtime_identity_status === "string" ? entry.runtime_identity_status : "MIGRATION_REQUIRED";
    const executable = identityDigestPrefix(entry.runtime_identity_digest);
    lines.push(`Runtime executable identity (${agentId}): ${status === "VERIFIED" ? executable : `${executable} (${status})`}`);
  }
  lines.push(`Profile digest: ${typeof record.profile_digest === "string" && record.profile_digest !== "" ? record.profile_digest : "unknown"}`);
  lines.push(aggregationLine(record.profile_bound_aggregation));
  return lines;
}

const severity = (reason) => (reason === null ? WITHHELD_REASONS.length : WITHHELD_REASONS.indexOf(reason));

/**
 * The model identity of one result or cycle: every agent's provenance, the policy that follows,
 * and the projection lines.
 *
 * With more than one agent the strictest withholding wins. A result over two agents of which one
 * is unknown is not partly profile-bound; the aggregate is either issued for the whole result or
 * withheld for it.
 */
/** What a Run that is a diagnostic by construction may claim, whatever it was run under. */
const diagnosticPolicy = () => ({
  claim_stage: "RUN_DIAGNOSTIC",
  run_diagnostic_permitted: true,
  profile_bound_aggregation: {
    status: "withheld",
    reason: "DIAGNOSTIC_RUN",
    detail: "a project observation or imported evidence is one run against the operator's own material, not a measurement"
  },
  composite: "WITHHELD",
  ...modelIdentityProjection()
});

export function modelIdentityRecord({ by_agent = {}, profile_digest = null, ceiling = null } = {}) {
  const entries = by_agent instanceof Map ? [...by_agent.entries()] : Object.entries(by_agent);
  const agents = Object.create(null);
  let strictest = null;
  for (const [agentId, entry] of entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    const provenance = entry?.provenance ?? null;
    // Normalised where the record is built, so nothing downstream reads a verdict this module did
    // not emit: an unknown shape is dropped rather than carried into the projection and the gates.
    const verification = knownVerification(entry?.verification) ? entry.verification : null;
    const runtimeIdentity = {
      identity_digest: typeof entry?.runtime_identity_digest === "string" ? entry.runtime_identity_digest : null,
      identity_status: typeof entry?.runtime_identity_status === "string" ? entry.runtime_identity_status : "MIGRATION_REQUIRED"
    };
    const policy = ceiling === "RUN_DIAGNOSTIC"
      ? diagnosticPolicy()
      : issuancePolicyFor({ provenance, verification, runtimeIdentity });
    agents[agentId] = {
      provenance,
      verification,
      runtime_identity_digest: runtimeIdentity.identity_digest,
      runtime_identity_status: runtimeIdentity.identity_status,
      // Whether the program that ran is the one the agent was registered with. `null` where there
      // was no spawn to compare against -- a cycle binding, a historical record.
      runtime_identity_drifted: entry?.runtime_identity_drifted ?? null,
      claim_stage: policy.claim_stage,
      profile_bound_aggregation: policy.profile_bound_aggregation
    };
    if (strictest === null || severity(policy.profile_bound_aggregation.reason) < severity(strictest.profile_bound_aggregation.reason)) strictest = policy;
  }
  const capped = ceiling === "RUN_DIAGNOSTIC" ? diagnosticPolicy() : null;
  const policy = capped ?? strictest ?? issuancePolicyFor({ provenance: null });
  const record = {
    schema_id: MODEL_IDENTITY_SCHEMA,
    profile_digest: typeof profile_digest === "string" ? profile_digest : null,
    by_agent: { ...agents },
    claim_stage: policy.claim_stage,
    run_diagnostic_permitted: policy.run_diagnostic_permitted,
    profile_bound_aggregation: policy.profile_bound_aggregation,
    composite: policy.composite,
    generalizability_status: policy.generalizability_status,
    generalizability_until: policy.generalizability_until,
    cross_model_comparison: policy.cross_model_comparison,
    model_change_improvement_claim: policy.model_change_improvement_claim,
    comparison_until: policy.comparison_until
  };
  return { ...record, lines: modelIdentityLines(record) };
}

// One verdict per agent from every run's verification, and the weakest run decides. Any
// contradiction outranks any agreement, because a cycle in which one run named another model is
// not three runs of one model -- and so does a run nobody corroborated: CONFIRMED is last here,
// so [CONFIRMED, NOT_OBSERVED, NOT_OBSERVED] merges to NOT_OBSERVED rather than letting two
// unverified runs disappear into the one that was verified.
const VERIFICATION_RANK = new Map([["MISMATCH", 0], ["UNNAMEABLE", 1], ["AMBIGUOUS", 2], ["OBSERVED_UNBOUND", 3], ["NOT_OBSERVED", 4], ["CONFIRMED", 5]]);

const mergeVerifications = (verifications) => {
  let merged = null;
  for (const verification of verifications) {
    if (!verification || !VERIFICATION_RANK.has(verification.status)) continue;
    if (merged === null || VERIFICATION_RANK.get(verification.status) < VERIFICATION_RANK.get(merged.status)) merged = verification;
  }
  return merged ?? { status: "NOT_OBSERVED", code: "AOS_MODEL_EVENT_NOT_OBSERVED", observed: [], unnameable: [] };
};

/**
 * The identity of a whole cycle: the binding made when it was opened, verified by every valid run
 * recorded into it since.
 *
 * A cycle opened before this record existed has no binding and returns null: it is historical,
 * and nothing recorded later can promote it to an exact profile, because the digest its runs were
 * filed under never named a model. So does a bound cycle holding a valid run that carries no
 * record of its own -- a cycle this product cannot verify is not one it may issue.
 *
 * The aggregate is judged over the agents the valid runs used: an agent that is configured and
 * never ran contributed nothing to the number. Before the first valid run there is nothing to
 * narrow by, and the record describes every agent the cycle was bound to.
 */
export function cycleModelIdentity({ binding = null, runs = [] } = {}) {
  if (!binding || typeof binding !== "object" || !binding.by_agent || typeof binding.by_agent !== "object") return null;
  const valid = runs.filter((run) => run && typeof run === "object" && run.valid === true);
  if (valid.some((run) => !run.model_identity?.by_agent || typeof run.model_identity.by_agent !== "object")) return null;
  const used = new Set(valid.flatMap((run) => Object.keys(run.model_identity.by_agent)));
  const judged = used.size === 0 ? Object.keys(binding.by_agent) : [...used];
  const byAgent = new Map();
  for (const agentId of judged) {
    const bound = Object.hasOwn(binding.by_agent, agentId) ? binding.by_agent[agentId] : null;
    const verifications = valid.map((run) => run.model_identity.by_agent[agentId]?.verification ?? null);
    byAgent.set(agentId, {
      provenance: bound?.provenance ?? null,
      verification: mergeVerifications(verifications),
      runtime_identity_digest: bound?.runtime_identity_digest ?? null,
      runtime_identity_status: bound?.runtime_identity_status ?? "MIGRATION_REQUIRED",
      runtime_identity_drifted: bound?.runtime_identity_drifted ?? null
    });
  }
  return modelIdentityRecord({ by_agent: byAgent, profile_digest: binding.profile_digest ?? null });
}

/** The digest of the committed provenance schema, quoted in the close record for #561. */
export const provenanceSchemaDigest = () =>
  sha256Bytes(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "schemas", "aos-model-provenance.v1.json")));
