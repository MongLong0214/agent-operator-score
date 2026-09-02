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

// A snapshot is a name the provider has promised not to move. The only proof of that this product
// can read off the name is a date stamp, so a name without one is treated as one the provider
// manages -- which is fail-closed: an unproven snapshot is a mutable alias, never the reverse.
const SNAPSHOT_MARKER = /(?:^|[-_.:@])\d{4}-?\d{2}-?\d{2}(?:$|[-_.:@])/u;

const MODEL_NAME = /^[a-z0-9][a-z0-9._:@-]{0,199}$/u;

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
  const slash = trimmed.indexOf("/");
  const provider = slash > 0 ? trimmed.slice(0, slash) : (typeof fallbackProvider === "string" && fallbackProvider !== "" ? fallbackProvider.toLowerCase() : null);
  const model = slash > 0 ? trimmed.slice(slash + 1) : trimmed;
  if (!MODEL_NAME.test(model)) return null;
  if (provider !== null && !MODEL_NAME.test(provider)) return null;
  return { provider, model, id: provider === null ? model : `${provider}/${model}` };
};

const familyOf = (model) => model?.match(/^[a-z]+/u)?.[0] ?? null;

/**
 * Whether a name is an exact identity or an alias, and therefore whether a number produced under
 * it can be compared with a number produced under the same name tomorrow.
 */
export const aliasClassOf = (raw) => {
  const parsed = parseModelName(raw);
  if (parsed === null) return { alias_class: "unknown", mutable_alias: null };
  if (BARE_ALIASES.has(parsed.model)) return { alias_class: "bare-alias", mutable_alias: true };
  if (SNAPSHOT_MARKER.test(parsed.model)) return { alias_class: "exact-snapshot", mutable_alias: false };
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
  const claim = { schema_id: MODEL_PROVENANCE_SCHEMA, source: winner.source, provider, id, runtime: winner.runtime, row_digest: winner.row_digest };
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
export function observeModelEvents({ env = {}, workspace, since = 0 } = {}) {
  if (typeof workspace !== "string" || workspace === "") return [];
  const home = typeof env.HOME === "string" && env.HOME !== "" ? env.HOME : null;
  const roots = [
    ["codex", typeof env.CODEX_HOME === "string" && env.CODEX_HOME !== "" ? join(env.CODEX_HOME, "sessions") : (home === null ? null : join(home, ".codex", "sessions"))],
    ["claude-code", typeof env.CLAUDE_CONFIG_DIR === "string" && env.CLAUDE_CONFIG_DIR !== "" ? join(env.CLAUDE_CONFIG_DIR, "projects") : (home === null ? null : join(home, ".claude", "projects"))]
  ];
  const workspaces = workspaceForms(workspace);
  const seen = new Set();
  const events = [];
  const push = (event) => {
    const key = `${event.runtime}\u0000${event.provider ?? ""}\u0000${event.model}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(event);
  };
  for (const [runtime, root] of roots) {
    if (root === null) continue;
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
      if (runtime === "codex") eventsFromCodex(lines, workspaces, push);
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
export function verifyModelIdentity(bound, events = []) {
  const observed = [];
  const seen = new Set();
  for (const event of Array.isArray(events) ? events : []) {
    const candidate = candidateFrom("runtime-event", event);
    if (candidate === null || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    observed.push({ id: candidate.id, provider: candidate.provider, model: candidate.model, runtime: candidate.runtime, row_digest: candidate.row_digest });
  }
  if (bound?.status === "MISMATCH") return { status: "MISMATCH", code: "AOS_MODEL_IDENTITY_MISMATCH", observed };
  if (observed.length > 1) return { status: "AMBIGUOUS", code: "AOS_MODEL_EVENT_AMBIGUOUS", observed };
  if (observed.length === 0) return { status: "NOT_OBSERVED", code: null, observed };
  if (typeof bound?.id !== "string") return { status: "OBSERVED_UNBOUND", code: null, observed };
  const boundName = parseModelName(bound.id);
  if (boundName !== null && sameModel(boundName, observed[0])) return { status: "CONFIRMED", code: null, observed };
  return { status: "MISMATCH", code: "AOS_MODEL_IDENTITY_MISMATCH", observed };
}

// ---------------------------------------------------------------------------------------------
// Issuance

/** Reasons a profile-bound aggregate is withheld, most severe first. */
export const WITHHELD_REASONS = Object.freeze([
  "MODEL_PROVENANCE_ABSENT",
  "MODEL_IDENTITY_MISMATCH",
  "MODEL_EVENT_AMBIGUOUS",
  "MODEL_UNKNOWN",
  "MODEL_MUTABLE_ALIAS"
]);

const withheldReasonFor = (provenance, verification) => {
  if (!provenance || typeof provenance !== "object") return "MODEL_PROVENANCE_ABSENT";
  if (provenance.status === "MISMATCH" || verification?.status === "MISMATCH") return "MODEL_IDENTITY_MISMATCH";
  if (verification?.status === "AMBIGUOUS") return "MODEL_EVENT_AMBIGUOUS";
  if (provenance.status === "UNKNOWN" || typeof provenance.id !== "string") return "MODEL_UNKNOWN";
  if (provenance.mutable_alias !== false || provenance.status === "MUTABLE") return "MODEL_MUTABLE_ALIAS";
  return null;
};

const mismatchSides = (provenance, verification) => {
  if (provenance?.mismatch) return { detected: provenance.mismatch.detected, declared: provenance.mismatch.declared };
  return { detected: verification?.observed?.[0]?.id ?? "unknown", declared: provenance?.id ?? "unknown" };
};

const withheldDetail = (reason, provenance, verification) => {
  if (reason === "MODEL_PROVENANCE_ABSENT") return "this result predates model provenance and is historical/provisional";
  if (reason === "MODEL_IDENTITY_MISMATCH") {
    const sides = mismatchSides(provenance, verification);
    return `detected ${sides.detected} but declared ${sides.declared}`;
  }
  if (reason === "MODEL_EVENT_AMBIGUOUS") return `the run's transcript names ${verification.observed.length} different models: ${verification.observed.map((entry) => entry.id).join(", ")}`;
  if (reason === "MODEL_UNKNOWN") return "no runtime event, runtime config or declaration identified the model";
  if (reason === "MODEL_MUTABLE_ALIAS") {
    return provenance.alias_class === "bare-alias"
      ? `${provenance.id} is a bare alias, never an exact identity`
      : `${provenance.id} is a provider-managed alias without snapshot proof`;
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
export function issuancePolicyFor({ provenance = null, verification = null } = {}) {
  const reason = withheldReasonFor(provenance, verification);
  const withheld = reason !== null;
  return {
    claim_stage: withheld ? "RUN_DIAGNOSTIC" : "PROFILE_BOUND",
    run_diagnostic_permitted: true,
    profile_bound_aggregation: {
      status: withheld ? "withheld" : "issued",
      reason,
      detail: withheld ? withheldDetail(reason, provenance, verification) : null
    },
    composite: withheld ? "WITHHELD" : "ISSUABLE",
    generalizability_status: "UNESTABLISHED",
    generalizability_until: "#584 facet evidence",
    cross_model_comparison: "WITHHELD",
    model_change_improvement_claim: "WITHHELD",
    comparison_until: "INVARIANCE_UNESTABLISHED"
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
  if (verification?.status === "AMBIGUOUS") {
    return `ambiguous — transcript named ${verification.observed.map((entry) => entry.id).join(", ")} (AOS_MODEL_EVENT_AMBIGUOUS)`;
  }
  if (typeof provenance.id !== "string") {
    return verification?.status === "OBSERVED_UNBOUND"
      ? `unknown (transcript named ${verification.observed[0].id} after the profile was bound)`
      : "unknown";
  }
  const detected = provenance.source === "runtime-event" || provenance.source === "runtime-config" || verification?.status === "CONFIRMED";
  const qualifiers = [provenance.alias_class, provenance.mutable_alias ? "mutable" : null].filter((part) => part !== null);
  return `${detected ? "detected" : "declared"} ${provenance.id} (${qualifiers.join(", ")})`;
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
    lines.push(`Runtime executable identity (${agentId}): ${identityDigestPrefix(entry.runtime_identity_digest)}`);
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
export function modelIdentityRecord({ by_agent = {}, profile_digest = null } = {}) {
  const entries = by_agent instanceof Map ? [...by_agent.entries()] : Object.entries(by_agent);
  const agents = Object.create(null);
  let strictest = null;
  for (const [agentId, entry] of entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    const provenance = entry?.provenance ?? null;
    const verification = entry?.verification ?? null;
    const policy = issuancePolicyFor({ provenance, verification });
    agents[agentId] = {
      provenance,
      verification,
      runtime_identity_digest: typeof entry?.runtime_identity_digest === "string" ? entry.runtime_identity_digest : null,
      claim_stage: policy.claim_stage,
      profile_bound_aggregation: policy.profile_bound_aggregation
    };
    if (strictest === null || severity(policy.profile_bound_aggregation.reason) < severity(strictest.profile_bound_aggregation.reason)) strictest = policy;
  }
  const policy = strictest ?? issuancePolicyFor({ provenance: null });
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

// One verdict per agent from every run's verification. Any contradiction outranks any agreement,
// because a cycle in which one run named another model is not three runs of one model.
const VERIFICATION_RANK = new Map([["MISMATCH", 0], ["AMBIGUOUS", 1], ["OBSERVED_UNBOUND", 2], ["CONFIRMED", 3], ["NOT_OBSERVED", 4]]);

const mergeVerifications = (verifications) => {
  let merged = null;
  for (const verification of verifications) {
    if (!verification || !VERIFICATION_RANK.has(verification.status)) continue;
    if (merged === null || VERIFICATION_RANK.get(verification.status) < VERIFICATION_RANK.get(merged.status)) merged = verification;
  }
  return merged ?? { status: "NOT_OBSERVED", code: null, observed: [] };
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
      runtime_identity_digest: bound?.runtime_identity_digest ?? null
    });
  }
  return modelIdentityRecord({ by_agent: byAgent, profile_digest: binding.profile_digest ?? null });
}

/** The digest of the committed provenance schema, quoted in the close record for #561. */
export const provenanceSchemaDigest = () =>
  sha256Bytes(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "schemas", "aos-model-provenance.v1.json")));
