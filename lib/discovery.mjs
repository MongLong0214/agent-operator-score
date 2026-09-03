import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./core.mjs";
import {
  ISSUANCE_REASONS,
  RUNTIME_CONFIG_STAGING,
  adapterForPlatform,
  isolationPolicyDigestOf,
  isolationPolicyFor,
  laneOf,
  platformLaneOf,
  runtimeConfigDigestFor,
  runtimeIdentityMatches,
  supportMatrixDecisions
} from "./confinement.mjs";
import { envPolicyFor } from "./env-policy.mjs";
import { issuancePolicyFor, resolveModelProvenance, runtimeConfigModel } from "./model-identity.mjs";
import { ADAPTERS, adapterFor, buildProfile, probeCommand } from "./profile.mjs";
import { authorizeRuntimeAuth, resolveRuntimeAuth, runtimeAuthRecord } from "./runtime-auth.mjs";
import { describeExecutable, identityDrift } from "./runtime-identity.mjs";
import { readConfig, resolveHome } from "./store.mjs";

// What the operator does not have to know.
//
// The final consumer contract (SSOT §5) says the operator supplies a repository URL and a sentence.
// Everything between that sentence and a measurement -- which runtime, which executable is really
// behind its name, whether it can log in, which model it will use, which environment names it may
// carry, whether this host can hold a boundary, and which environment profile the number will be
// filed under -- is machine-readable, and each part of it already has an owner in this codebase.
// What did not exist was the composition: an operator reached the decision by reading `agent
// doctor`, the support table and the profile digest and putting them together themselves.
//
// That is the setup this file removes, and it is also where the unsafe answers were: `aos init`
// registered whatever wore the right name on PATH, and nothing downstream asked whether the file
// behind that name was the runtime the credential belonged to.
//
// The rule this file follows everywhere is that it decides nothing that is already decided.
// `identity_status` is #554's. `adapter_runtime_match` is #556's `runtimeIdentityMatches`. Whether
// a lane may issue is #556's `issuanceGate`, read through `supportMatrixDecisions` over the
// committed observations. Whether a model binds a profile is #561's `issuancePolicyFor`. Discovery
// reads those verdicts and reports the conjunction. A copy of any of them here would be a second
// authority: correct on the day it was written, and stale the first time the original changed.

export const DISCOVERY_SCHEMA = "aos-discovery.v2";
export const TIE_BREAK_SCHEMA = "aos-discovery-tie-break.v1";
export const PROFILE_LEDGER_SCHEMA = "aos-discovery-profile-ledger.v1";

/**
 * The stages, in the order the issue declares them.
 *
 * Written as a sequence with a machine over it rather than as the order the statements happen to
 * appear in, because one of the transitions is a safety rule and not a convenience: the credential
 * lookup may not happen before the identity check. As straight-line code that is a property of how
 * somebody arranged the lines, and a later edit that moves a block breaks it silently.
 */
export const DISCOVERY_STAGES = Object.freeze([
  "DISCOVERING",
  "IDENTITY_CHECKING",
  "AUTH_CHECKING",
  "MODEL_CHECKING",
  "ENV_CHECKING",
  "ISOLATION_CHECKING",
  "PROFILE_BUILDING"
]);

export const TERMINAL_STATUSES = Object.freeze([
  "OFFICIAL_READY",
  "DIAGNOSTIC_ONLY",
  "ACTION_REQUIRED",
  "BLOCKED",
  "FAILED"
]);

export const REASON_CODES = Object.freeze({
  NO_RUNTIME: "AOS_DISCOVERY_NO_RUNTIME",
  ALL_CANDIDATES_BLOCKED: "AOS_DISCOVERY_ALL_CANDIDATES_BLOCKED",
  RUNTIME_TIE: "AOS_DISCOVERY_RUNTIME_TIE",
  PROVIDER_LOGIN_REQUIRED: "AOS_DISCOVERY_PROVIDER_LOGIN_REQUIRED",
  IDENTITY_UNVERIFIED: "AOS_DISCOVERY_IDENTITY_UNVERIFIED",
  RUNTIME_NOT_ADAPTER: "AOS_DISCOVERY_RUNTIME_NOT_ADAPTER",
  MODEL_WITHHELD: "AOS_DISCOVERY_MODEL_WITHHELD",
  MODEL_MISMATCH: "AOS_DISCOVERY_MODEL_MISMATCH",
  ENV_NOT_GRANTED: "AOS_DISCOVERY_ENV_NOT_GRANTED",
  ISOLATION_NOT_STRICT: "AOS_DISCOVERY_ISOLATION_NOT_STRICT",
  FAILED: "AOS_DISCOVERY_FAILED"
});

/**
 * Everything this module is allowed to ask for.
 *
 * The issue's prohibited list is install directory, runtime path or arguments, adapter or profile
 * name, model string, seed, form, cycle, report format and report path. None of those is here, and
 * a test holds the list to that: what the operator may be asked is to install a runtime, to let
 * the runtime's own login run, to choose between two runtimes this product cannot tell apart, and
 * to look at a runtime it refused. Nothing on the list is a configuration edit or a token.
 */
export const NEXT_ACTION_KINDS = Object.freeze([
  "install_runtime",
  "provider_login",
  "resolve_runtime_tie",
  "review_blocked_runtime"
]);

/**
 * The last tie-break, when the four before it have not separated two candidates.
 *
 * A declared order rather than a comparison invented at the point of use, so two runs on one host
 * choose the same runtime. It is deliberately last: an adapter is a description of how a runtime is
 * reached, and preferring one description over another is the weakest reason there is.
 */
export const ADAPTER_PRIORITY = Object.freeze(["codex-cli.v1", "claude-code.v1", "generic-command.v1"]);

/**
 * The runtimes this product knows how to find without being told, and the arguments that make each
 * one non-interactive.
 *
 * Those arguments are a property of the CLI, not a decision the operator makes, which is why asking
 * for them would be setup work rather than measurement. `lib/cli.mjs` registers from this same
 * list: the table was there, and a second copy here would be two answers to "what does AOS look
 * for" with nothing keeping them equal.
 */
export const DISCOVERABLE_RUNTIMES = Object.freeze([
  Object.freeze({ id: "codex", command: "codex", args: Object.freeze(["exec", "--skip-git-repo-check"]), adapter: "codex-cli.v1", runtime: "codex", allow: Object.freeze(["CODEX_HOME"]) }),
  Object.freeze({ id: "claude", command: "claude", args: Object.freeze(["-p", "--dangerously-skip-permissions"]), adapter: "claude-code.v1", runtime: "claude-code", allow: Object.freeze([]) })
]);

/**
 * Names a runtime sets in the environment of the processes it launches.
 *
 * Read from the shipped binaries rather than imagined: `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT`
 * are in this session's own environment, and `CODEX_SANDBOX` is a string in the `@openai/codex`
 * executable. What they are used for is one thing and one thing only -- ranking a candidate that
 * has already been verified on its own. An environment variable is a claim anything in the process
 * tree can make, so it may not create a candidate, upgrade a blocked one, or stand in for any part
 * of identity, auth, model or isolation. Its absence is not evidence either: a runtime that sets
 * nothing simply does not reach priority 1.
 */
const ORCHESTRATION_SIGNALS = new Map([
  ["claude-code.v1", Object.freeze(["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"])],
  ["codex-cli.v1", Object.freeze(["CODEX_SANDBOX"])]
]);

const LEDGER_FILE = "discovery-profiles.json";
const CYCLE_FILE = "cycle.json";

const fixtureRoot = () => resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "confinement");

// ------------------------------------------------------------------------------------------- //
// The machine

/**
 * The stage sequence, with the two things a sequence cannot say for itself: that nothing skips
 * ahead, and that a later stage can ask whether an earlier one really ran.
 */
export function discoveryMachine() {
  const visited = [];
  let index = -1;
  return {
    get visited() {
      return [...visited];
    },
    enter(stage) {
      const at = DISCOVERY_STAGES.indexOf(stage);
      if (at === -1) throw new Error(`AOS_DISCOVERY_STAGE_UNKNOWN ${String(stage)}`);
      if (at !== index + 1) {
        throw new Error(`AOS_DISCOVERY_STAGE_OUT_OF_ORDER ${stage} cannot follow ${DISCOVERY_STAGES[index] ?? "the start"}`);
      }
      index = at;
      visited.push(stage);
      return stage;
    },
    reached(stage) {
      return visited.includes(stage);
    }
  };
}

// ------------------------------------------------------------------------------------------- //
// Local state, read by existence and never by content

/**
 * Whether the runtime's own configuration directory holds the files it needs, without opening one.
 *
 * The file list is #556's staging declaration, not a list invented here: those are exactly the
 * files a STRICT run copies into the agent's private HOME, so "the runtime has local state" and
 * "the run will have something to stage" are the same question asked once. Existence only. A
 * credential lives in one of these files and this function must not be able to read one.
 *
 * The directory itself never leaves: it is under the operator's HOME, which is a private path.
 */
const localRuntimeConfig = (adapter, env, operatorHome) => {
  const absent = { source: null, declared: [], present: [], missing: [], complete: false };
  const spec = adapter?.config_env ? RUNTIME_CONFIG_STAGING.get(adapter.id) ?? null : null;
  if (spec === null) return absent;
  const configured = typeof env?.[adapter.config_env] === "string" && env[adapter.config_env].length > 0 ? env[adapter.config_env] : null;
  const dir = configured ?? (typeof operatorHome === "string" && operatorHome.length > 0 ? join(operatorHome, spec.dir) : null);
  if (dir === null) return absent;
  const declared = [...spec.files];
  const present = declared.filter((name) => existsSync(join(dir, name)));
  return {
    source: configured === null ? "operator-home" : "config-env",
    declared,
    present,
    missing: declared.filter((name) => !present.includes(name)),
    // A runtime whose adapter declares no file has no local file evidence, so it is not complete by
    // having nothing to be missing. Claude Code is that case on macOS: its login is in the login
    // Keychain, and a `~/.claude` directory is not a login.
    complete: declared.length > 0 && present.length === declared.length
  };
};

const valued = (env, name) => typeof env?.[name] === "string" && env[name].length > 0;

/**
 * The same sentence with this machine's own paths taken out of it.
 *
 * Every explanation on this record comes from a module written for a terminal the operator is
 * sitting at, and several of them quote absolute paths: #554's untrusted reasons name the
 * directory, `authorizeRuntimeAuth` quotes the configured command, a backend probe quotes a spawn
 * error. This record is printed, pasted into an issue and committed as a fixture, so the paths come
 * out here -- at the one boundary they all cross -- rather than at each of the places one could
 * enter. The reason survives; where it happened does not.
 *
 * The lookbehind is what keeps `openai/gpt-4o-2024-08-06` and `provider/model` intact: a path
 * segment counts only where the slash begins a token.
 */
const withoutPaths = (text) => (typeof text === "string" ? text.replace(/(?<![\w.~-])(?:\/[^\s,;:"'`]+)+/gu, "<path>") : text);

// ------------------------------------------------------------------------------------------- //
// AUTH_CHECKING

/**
 * Whether this candidate can log in, decided without a provider call and without a value leaving
 * this function.
 *
 * Two locks on the ordering, and they are not redundant. The first is the stage machine: a
 * credential looked up before IDENTITY_CHECKING is a credential handed to a program nobody
 * identified, and refusing afterwards does not put it back. The second is the identity's own
 * verdict, because a stage having run is not the same statement as this executable having passed
 * it. #554 makes the same distinction and this file would be the place to lose it.
 *
 * What leaves is a name and a source. `runtimeAuthRecord` is the reduction, and it is applied at
 * the point of resolution rather than at the point of emission so there is no window in which a
 * value is on an object that something else might copy.
 */
export function credentialReadiness(machine, candidate, {
  env = process.env,
  // The machine this is running on, never a platform a caller is describing. Both things it governs
  // -- whether the adapter's credential store exists here, and how #554 reads this filesystem -- are
  // facts about the host, and answering them for some other operating system would mean skipping
  // the ACL walk on a machine that has ACLs.
  platform = process.platform,
  operatorHome = null,
  resolveCredential = resolveRuntimeAuth
} = {}) {
  if (!machine?.reached("IDENTITY_CHECKING")) {
    throw new Error("AOS_DISCOVERY_CREDENTIAL_BEFORE_IDENTITY the identity stage has not run, so there is no verified program for a credential to be bound to");
  }
  const adapter = ADAPTERS[candidate.adapter_id] ?? ADAPTERS["generic-command.v1"];
  const identity = candidate.identity ?? null;
  const refuse = (status, reason, detail) => ({
    status, reason, detail: withoutPaths(detail), credential: null, credential_withheld: true, local_config: null
  });

  if (identity === null || identity.identity_status !== "VERIFIED") {
    return refuse("BLOCKED", REASON_CODES.IDENTITY_UNVERIFIED, `the executable behind this command is ${identity?.identity_status ?? "absent"}, so no credential is looked up for it`);
  }
  // Verified, and still not necessarily the runtime whose credential this adapter resolves. #556
  // answers that question and this reads its answer: a program the operator owns, named `claude`,
  // that is not the Claude Code package is exactly the case that got a real OAuth token before
  // #554, and a basename check is what let it.
  const stakes = RUNTIME_CONFIG_STAGING.has(adapter.id) || adapter.auth_resolver != null;
  if (stakes && candidate.adapter_runtime_match !== true) {
    return refuse("ACTION_REQUIRED", REASON_CODES.RUNTIME_NOT_ADAPTER, `the verified executable is not ${adapter.id}, so AOS resolves no credential for it`);
  }

  const local = localRuntimeConfig(adapter, env, operatorHome);
  const localRecord = { source: local.source, declared: local.declared, present: local.present, missing: local.missing };
  const authEnv = adapter.auth_env ?? [];
  const declaredEnv = candidate.entry?.runtime_auth_env_names ?? [];

  // An adapter with no credential path at all. Saying "ready" would be a claim about software
  // nobody described, and saying "action required" would send the operator after a login that does
  // not exist. It is neither, and it is never OFFICIAL.
  if (authEnv.length === 0 && !adapter.config_env && adapter.auth_resolver == null) {
    return { status: "NOT_APPLICABLE", reason: null, detail: `${adapter.id} declares no credential path, so none was checked`, credential: null, credential_withheld: false, local_config: localRecord };
  }

  // Local first, as the issue requires: the runtime's own state on this machine outranks anything
  // that would cost a call, and nothing here costs one.
  if (local.complete) {
    return { status: "PRESENT", reason: null, detail: `${adapter.id} keeps its login in its own configuration directory and every file it stages is there`, credential: { name: adapter.config_env, source: "runtime-config-directory" }, credential_withheld: false, local_config: localRecord };
  }
  const setByOperator = [...new Set([...declaredEnv, ...authEnv])].filter((name) => valued(env, name));
  if (setByOperator.length > 0) {
    return { status: "PRESENT", reason: null, detail: "the operator's environment already carries this runtime's credential variable", credential: { name: setByOperator[0], source: "environment" }, credential_withheld: false, local_config: localRecord };
  }

  // And only now the operator's credential store, through #554's gate rather than around it. The
  // gate is asked even where the answer is already known, because it is the gate that decides
  // whether AOS may reach into a keychain on this agent's behalf at all.
  const verdict = authorizeRuntimeAuth({ ...(candidate.entry ?? {}), runtime_identity: candidate.entry?.runtime_identity ?? identity }, adapter, { env, platform });
  if (!verdict.ok) {
    return refuse("BLOCKED", verdict.code ?? REASON_CODES.IDENTITY_UNVERIFIED, verdict.detail);
  }
  if (verdict.auto) {
    // Reduced here, where the value exists, and not at the point of emission. `runtimeAuthRecord`
    // keeps the name and the source and drops everything else, so there is no moment in which an
    // object holding a credential is reachable from the record this function returns.
    const credential = runtimeAuthRecord(resolveCredential(adapter, { platform, env, command: candidate.entry?.command ?? null }));
    if (credential !== null) {
      return { status: "RESOLVED", reason: null, detail: `${credential.name} resolved from the ${credential.source}; nothing to configure`, credential, credential_withheld: false, local_config: localRecord };
    }
  }
  return {
    status: "ACTION_REQUIRED",
    reason: REASON_CODES.PROVIDER_LOGIN_REQUIRED,
    detail: `${adapter.id} has no login on this machine; run the runtime's own sign-in and discovery will find it`,
    credential: null,
    credential_withheld: false,
    local_config: localRecord
  };
}

// ------------------------------------------------------------------------------------------- //
// MODEL_CHECKING

/**
 * The model this candidate would run under, and whether it may bind a profile.
 *
 * Two inputs, both of which existed before the run: the model on the runtime's own command line,
 * read through #561's `runtimeConfigModel` and the adapter's declared flags, and what the operator
 * registered. Nothing is guessed, and no file is parsed for one: a value read out of a runtime's
 * configuration file by a reader written here would be a third producer of model provenance, and
 * the cohort key would then depend on whether that reader was right.
 *
 * Whether the result issues is `issuancePolicyFor`'s answer, not one made here -- which is also
 * where the executable identity enters, since a profile-bound number is a claim about a model *and*
 * a program.
 */
const modelReadiness = (entry, adapter, identity) => {
  const configured = runtimeConfigModel(entry?.args ?? [], adapter.model_flags ?? []);
  const inputs = {
    runtimeConfig: configured === null ? null : { model: configured, provider: adapter.provider },
    declared: typeof entry?.model_id === "string" && entry.model_id !== "" ? { model: entry.model_id, provider: adapter.provider } : null
  };
  const provenance = resolveModelProvenance(inputs);
  const policy = issuancePolicyFor({ provenance, runtimeIdentity: identity });
  const issued = policy.profile_bound_aggregation.status === "issued";
  return {
    status: provenance.status === "MISMATCH" ? "MISMATCH" : issued ? "EXACT" : "WITHHELD",
    id: provenance.id,
    source: provenance.source,
    alias_class: provenance.alias_class,
    mutable_alias: provenance.mutable_alias,
    claim_stage: policy.claim_stage,
    withheld_reason: policy.profile_bound_aggregation.reason,
    inputs
  };
};

// ------------------------------------------------------------------------------------------- //
// ENV_CHECKING

/**
 * Which names this candidate's run may carry, and whether the ones its runtime cannot start without
 * will be there.
 *
 * A required name is satisfied two ways, and both are readings of somebody else's declaration. The
 * operator may have it set. Or the adapter's configuration directory is one #556 stages -- in which
 * case AOS supplies the variable itself, pointing at the copy, and requiring the operator to export
 * it would be asking for the configuration edit this issue exists to remove.
 */
const environmentReadiness = (entry, adapter, env, local) => {
  let policy;
  try {
    policy = envPolicyFor(adapter, {
      allow: entry?.allowed_env_names ?? [],
      runtimeAuth: entry?.runtime_auth_env_names ?? [],
      transport: entry?.transport_env_names ?? []
    });
  } catch (error) {
    return { status: "REFUSED", policy_digest: null, allowed_env_names: [], missing_required: [], detail: withoutPaths(error.message) };
  }
  const stagedByAos = (name) => adapter.config_env === name && RUNTIME_CONFIG_STAGING.has(adapter.id) && local.declared.length > 0 && local.present.length > 0;
  const missing = (policy.required_env ?? []).filter((name) => !valued(env, name) && !stagedByAos(name));
  return {
    status: missing.length === 0 ? "READY" : "ACTION_REQUIRED",
    policy_digest: policy.policy_digest,
    schema_id: policy.schema_id,
    allowed_env_names: [...new Set([...(policy.config_env ?? []), ...(policy.runtime_auth_env ?? [])])].sort(),
    missing_required: missing,
    detail: missing.length === 0
      ? "every name this runtime needs is either set or staged by the boundary"
      : `${adapter.id} needs ${missing.join(", ")} and neither the environment nor the staged configuration supplies it`
  };
};

// ------------------------------------------------------------------------------------------- //
// ISOLATION_CHECKING

/**
 * What boundary this host can hold for this candidate, and whether the release has proven the lane.
 *
 * Three separate facts, none of them decided here. Whether a backend exists and enforces is
 * `adapterForPlatform(...).probe()`, which runs a deny-default profile and checks that it denied.
 * Whether the release has a lane for the resulting combination is `laneOf` over the shipped table.
 * Whether that lane may issue -- boundary canary PASS, cleanup verified, every cited observation
 * present and matching its digest -- is `supportMatrixDecisions`, which is `issuanceGate` over the
 * committed evidence.
 *
 * `lane_official` is that last verdict, read. Restating any part of it here is the defect this
 * release paid the most rounds for: the copy is right on the day it is written and wrong from the
 * first time the evidence moves.
 */
const isolationReadiness = (adapter, { platform, backendFor, decisions }) => {
  let probed = { available: false, backend: "none", level_ceiling: "BEST_EFFORT_CLI", reason: `${ISSUANCE_REASONS.BACKEND_ABSENT} no STRICT backend is implemented for ${platform}` };
  try {
    probed = backendFor(platform).probe();
  } catch (error) {
    probed = { ...probed, reason: `${ISSUANCE_REASONS.BACKEND_ABSENT} ${error.message}` };
  }
  const available = probed.available === true && probed.level_ceiling === "STRICT";
  const backend = available ? probed.backend : "none";
  const level = available ? "STRICT" : "BEST_EFFORT_CLI";
  const lane = laneOf({ platform, backend, adapter: adapter.id, level });
  const row = decisions.find((one) =>
    one.platform === platform && one.backend === backend && one.level === level && (one.adapter === "*" || one.adapter === adapter.id)) ?? null;
  const reasons = row === null ? [ISSUANCE_REASONS.LANE_NOT_PROVEN] : [...row.decision.reasons];
  return {
    backend,
    backend_available: available,
    level,
    level_ceiling: probed.level_ceiling ?? "NONE",
    deprecated_backend: probed.deprecated === true,
    platform_lane: platformLaneOf({ platform, backend, adapter: adapter.id }),
    support_status: lane?.support_status ?? "NOT_OBSERVED",
    // The decision, and only the decision. A row's own `official` label is the fixture's claim about
    // itself and the gate's answer is the release's.
    lane_official: row?.decision.official === true,
    claim_stage_ceiling: row?.decision.claim_stage_ceiling ?? "RUN_DIAGNOSTIC",
    boundary_canary: row?.decision.boundary_canary?.result ?? "NOT_RUN",
    reasons,
    probe_reason: withoutPaths(probed.reason ?? null)
  };
};

// ------------------------------------------------------------------------------------------- //
// Selection

/**
 * The five priorities the issue declares, applied in order, with a tie only where all five agree.
 *
 * Written as a key list rather than as nested branches so that adding a priority cannot silently
 * reorder the ones above it, and so that each one can be exercised on its own -- a comparator whose
 * fourth term is never reached by any test is a comparator with three terms.
 */
const RANKING = Object.freeze([
  // 1. The runtime that is orchestrating this work right now, when this discovery has
  //    independently established what it is. "Reliably identified" is the whole qualifier and it is
  //    a conjunction of facts measured elsewhere in this record -- #554 verified the executable,
  //    #556 confirmed it is the adapter's runtime, nothing has drifted since it was registered, and
  //    the adapter is one this product describes rather than the generic fallback. The signal
  //    itself is an environment variable and decides nothing: it selects between candidates that
  //    have already earned their place.
  (candidate) => (candidate.orchestrating === true && candidate.reliably_identified === true ? 0 : 1),
  // 2. A profile this machine has already produced for this exact configuration. Reusing it keeps
  //    the operator's history in one cohort, which is worth more than a stronger lane elsewhere.
  (candidate) => (candidate.existing_profile === true ? 0 : 1),
  // 3. A lane the release has actually proven.
  (candidate) => (candidate.support_status === "OFFICIAL" ? 0 : 1),
  // 4. How much of the identity, credential, model and environment evidence is actually in hand.
  (candidate) => -(Number.isInteger(candidate.evidence_completeness) ? candidate.evidence_completeness : 0),
  // 5. The declared adapter order. An adapter nobody declared sorts after every one that is.
  (candidate) => {
    const at = ADAPTER_PRIORITY.indexOf(candidate.adapter_id);
    return at === -1 ? ADAPTER_PRIORITY.length : at;
  }
]);

const rankOf = (candidate) => RANKING.map((key) => key(candidate));

export function selectRuntime(candidates) {
  // A blocked candidate is not a weak candidate. It is one this product refused, and a comparison
  // that could return it would make the refusal advisory.
  const selectable = (Array.isArray(candidates) ? candidates : []).filter((one) => one.support_status !== "BLOCKED");
  if (selectable.length === 0) return { selected: null, tie: null, ranked: [] };
  const ranked = selectable
    .map((candidate) => ({ candidate, rank: rankOf(candidate) }))
    .sort((left, right) => {
      for (let at = 0; at < left.rank.length; at += 1) {
        if (left.rank[at] !== right.rank[at]) return left.rank[at] - right.rank[at];
      }
      // Only to make the listing itself stable. It is never a winner: an equal rank is a tie, and
      // the id decides the order the two are shown in, not which one is chosen.
      return String(left.candidate.id).localeCompare(String(right.candidate.id));
    });
  const best = ranked[0];
  const equal = ranked.filter((one) => one.rank.every((value, at) => value === best.rank[at]));
  if (equal.length > 1) return { selected: null, tie: equal.map((one) => one.candidate), ranked: ranked.map((one) => one.candidate) };
  return { selected: best.candidate, tie: null, ranked: ranked.map((one) => one.candidate) };
}

// ------------------------------------------------------------------------------------------- //
// The profile ledger

/**
 * The profiles this machine has produced, as a list.
 *
 * A list and not a map keyed by digest, because a JSON object read off disk carries whatever keys
 * the file has -- `__proto__` among them -- and a lookup through it is a lookup through the
 * prototype chain. The digest is a field on the entry and the search is a comparison.
 */
export function readProfileLedger(home) {
  const file = join(resolve(home), LEDGER_FILE);
  if (!existsSync(file)) return { schema_id: PROFILE_LEDGER_SCHEMA, profiles: [] };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // A damaged ledger is not an empty one, and it is certainly not permission to overwrite the
    // operator's history. It is reported as unreadable and nothing is written over it.
    return { schema_id: PROFILE_LEDGER_SCHEMA, profiles: [], unreadable: true };
  }
  if (parsed?.schema_id !== PROFILE_LEDGER_SCHEMA || !Array.isArray(parsed.profiles)) {
    return { schema_id: PROFILE_LEDGER_SCHEMA, profiles: [], unreadable: true };
  }
  return { schema_id: PROFILE_LEDGER_SCHEMA, profiles: parsed.profiles.filter((one) => one && typeof one === "object") };
}

/**
 * The profile digest the open cycle is locked to, or what is wrong instead.
 *
 * Three answers, not two. No cycle is a machine with nothing in flight; a cycle whose file cannot
 * be read is a machine with something in flight that this product cannot see, and answering "no
 * cycle" for it would tell the operator their runs are unbound when they may not be.
 */
const activeCycleDigestOf = (home) => {
  const file = join(resolve(home), CYCLE_FILE);
  if (!existsSync(file)) return { digest: null, unreadable: false };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const digest = parsed?.profile_digest;
    if (typeof digest === "string" && digest.length > 0) return { digest, unreadable: false };
    return { digest: null, unreadable: true };
  } catch {
    return { digest: null, unreadable: true };
  }
};

const sameDigest = (left, right) => {
  const bare = (value) => (typeof value === "string" ? value.replace(/^sha256:/u, "") : value);
  return bare(left) === bare(right);
};

/**
 * Files the profile this discovery produced: reused when the digest is one this machine has already
 * seen, appended when it is not, and never written over an entry that is already there.
 *
 * "Never written over" is the whole of the drift rule. A host whose binary, model, credential,
 * environment or boundary has moved produces a different digest, and the honest record of that is
 * two entries -- the one the earlier runs were filed under and the one this host is now. Rewriting
 * the first would make every result stored against it a result about a machine that no longer
 * exists, and an open cycle locked to it would silently start admitting runs from a different one.
 *
 * The open cycle is read and never touched. Discovery has no business editing it: a cycle whose
 * profile digest can be updated from outside is a cycle whose owner can retry until the
 * environment suits them, which is the loop `lib/cycle.mjs` exists to prevent.
 */
export function fileProfile(home, profile, { write = true } = {}) {
  const root = resolve(home);
  const ledger = readProfileLedger(root);
  const activeCycle = activeCycleDigestOf(root);
  const known = ledger.profiles.find((one) => sameDigest(one.profile_digest, profile.profile_digest)) ?? null;
  const entry = known ?? {
    profile_digest: profile.profile_digest,
    profile_id: profile.profile_id,
    adapter_id: profile.adapter_id,
    runtime_identity_digest: profile.runtime_identity_digest,
    isolation_level: profile.isolation_level,
    isolation_policy_digest: profile.isolation_policy_digest,
    env_policy_digest: profile.env_policy_digest,
    suite_major: profile.suite_major
  };
  const created = known === null;
  if (created && write && ledger.unreadable !== true) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const file = join(root, LEDGER_FILE);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, canonicalJson({ schema_id: PROFILE_LEDGER_SCHEMA, profiles: [...ledger.profiles, entry] }), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, file);
  }
  return {
    reused: !created,
    created,
    written: created && write && ledger.unreadable !== true,
    ledger_unreadable: ledger.unreadable === true,
    profile_digest: profile.profile_digest,
    active_cycle_profile_digest: activeCycle.digest,
    active_cycle_unreadable: activeCycle.unreadable,
    // Null when there is no open cycle, and null again when the file holding it could not be read.
    // "No cycle", "a cycle this profile does not match" and "a cycle nobody can see" are three
    // states, and a boolean would say the same word for all of them -- which is why the two that
    // are not a match are separated by the field above rather than folded into this one.
    active_cycle_matches: activeCycle.digest === null ? null : sameDigest(activeCycle.digest, profile.profile_digest)
  };
}

// ------------------------------------------------------------------------------------------- //
// The counters

/**
 * What the operator had to do, counted off the record rather than declared beside it.
 *
 * Derived, because a constant would satisfy the acceptance condition without measuring anything:
 * these are zero on a ready host because there is nothing on the record that says otherwise, and
 * they move the moment there is.
 */
export function zeroInputCounters(record) {
  const kind = record?.next_action?.kind ?? null;
  return {
    terminal_commands: kind === "provider_login" || kind === "install_runtime" ? 1 : 0,
    // No next action this module can emit is a configuration edit, which is what makes this zero
    // rather than what claims it: `NEXT_ACTION_KINDS` holds the whole vocabulary.
    config_edits: 0,
    // The one action that puts registration work back on the operator: every runtime this host
    // offers was refused, and the way out is a runtime AOS has not been given. Nothing else on the
    // list touches the store, which is why the other three kinds leave this at zero.
    manual_registration: kind === "review_blocked_runtime" ? 1 : 0,
    setup_questions: record?.tie_break === null || record?.tie_break === undefined ? 0 : 1
  };
}

// ------------------------------------------------------------------------------------------- //
// Discovery

const publicCandidate = (candidate) => ({
  id: candidate.id,
  // The name of the program, never the path to it. An absolute path under the operator's home is
  // private, and this record is printed, pasted and stored.
  runtime_command: candidate.runtime_command,
  runtime_name: candidate.runtime_name,
  adapter_id: candidate.adapter.id,
  source: candidate.source,
  orchestrating: candidate.orchestrating,
  reliably_identified: candidate.reliably_identified,
  existing_profile: candidate.existing_profile,
  evidence_completeness: candidate.evidence_completeness,
  support_status: candidate.support_status,
  blocked_reasons: candidate.blocked_reasons,
  identity: candidate.identity,
  auth: candidate.auth,
  model: candidate.model,
  env: candidate.env,
  isolation: candidate.isolation,
  profile_digest: candidate.profile_digest
});

const publicIdentity = (identity, match, drift) => {
  if (identity === null) {
    return { status: "ABSENT", identity_digest: null, realpath_digest: null, adapter_runtime_match: false, drift: [], untrusted_reasons: [], detail: "this command does not resolve to a regular executable file on this PATH" };
  }
  return {
    status: identity.identity_status,
    identity_digest: identity.identity_digest,
    realpath_digest: identity.realpath_digest,
    file_fingerprint: identity.file_fingerprint,
    adapter_runtime_match: match.ok === true,
    adapter_runtime_detail: withoutPaths(match.reason),
    drift,
    // The reasons #554 recorded, with the absolute paths they name taken off. The reason is the
    // class of problem; the path is a fact about one machine and belongs in nothing that travels.
    untrusted_reasons: [...new Set((identity.untrusted_reasons ?? []).map((reason) => reason.split(" ")[0]))].sort(),
    detail: identity.identity_status === "VERIFIED" ? "this command resolves to an executable only this account can replace" : "this command resolves to a file somebody else could replace between now and the spawn"
  };
};

const nextActionFor = ({ status, reasonCode, candidate, tie }) => {
  if (reasonCode === REASON_CODES.NO_RUNTIME) {
    return { kind: "install_runtime", detail: "no agent runtime was found on this machine; install one of the runtimes AOS supports and run discovery again", runtimes: DISCOVERABLE_RUNTIMES.map((one) => one.command) };
  }
  if (reasonCode === REASON_CODES.RUNTIME_TIE) {
    return { kind: "resolve_runtime_tie", detail: "two runtimes are indistinguishable on every rule this product has; one of them has to be named", options: tie.map((one) => one.id) };
  }
  if (reasonCode === REASON_CODES.ALL_CANDIDATES_BLOCKED) {
    return { kind: "review_blocked_runtime", detail: "every runtime found here was refused; the reasons are on each candidate and none of them is fixed by configuring AOS" };
  }
  if (reasonCode === REASON_CODES.PROVIDER_LOGIN_REQUIRED) {
    return {
      kind: "provider_login",
      detail: `${candidate.adapter_id} has no login on this machine; run its own sign-in once and nothing else changes`,
      runtime: candidate.runtime_command
    };
  }
  if (status === "ACTION_REQUIRED") {
    return { kind: "review_blocked_runtime", detail: reasonCode ?? "discovery cannot continue without a decision that is not this product's to make" };
  }
  return null;
};

/**
 * Whether a run under this candidate could carry the release's official claim.
 *
 * A conjunction, and each term is somebody else's verdict read back: #554 on the executable, #556
 * on whether that executable is the adapter's runtime and on whether the lane may issue, #561 on
 * whether the model binds a profile, #555 on the environment. What this function contributes is the
 * `&&`.
 */
const supportStatusOf = ({ identity, auth, model, env, isolation, drift }) => {
  const blocked = [];
  if (identity.status !== "VERIFIED") blocked.push(REASON_CODES.IDENTITY_UNVERIFIED);
  if (model.status === "MISMATCH") blocked.push(REASON_CODES.MODEL_MISMATCH);
  if (auth.status === "BLOCKED") blocked.push(auth.reason ?? REASON_CODES.IDENTITY_UNVERIFIED);
  if (blocked.length > 0) return { support_status: "BLOCKED", blocked_reasons: blocked };

  const withheld = [];
  if (identity.adapter_runtime_match !== true) withheld.push(REASON_CODES.RUNTIME_NOT_ADAPTER);
  if (drift.length > 0) withheld.push("AOS_RUNTIME_IDENTITY_DRIFT");
  if (auth.status !== "RESOLVED" && auth.status !== "PRESENT") withheld.push(auth.reason ?? REASON_CODES.PROVIDER_LOGIN_REQUIRED);
  if (model.status !== "EXACT") withheld.push(REASON_CODES.MODEL_WITHHELD);
  if (env.status !== "READY") withheld.push(REASON_CODES.ENV_NOT_GRANTED);
  if (isolation.lane_official !== true) withheld.push(REASON_CODES.ISOLATION_NOT_STRICT);
  return withheld.length === 0
    ? { support_status: "OFFICIAL", blocked_reasons: [] }
    : { support_status: "DIAGNOSTIC_ONLY", blocked_reasons: withheld };
};

/**
 * The order the reason for a diagnostic answer is reported in.
 *
 * Isolation last, deliberately. A host with no boundary and no model has two true reasons, and the
 * one worth saying first is the one the operator can do something about.
 */
const REASON_ORDER = Object.freeze([
  REASON_CODES.RUNTIME_NOT_ADAPTER,
  "AOS_RUNTIME_IDENTITY_DRIFT",
  REASON_CODES.PROVIDER_LOGIN_REQUIRED,
  REASON_CODES.MODEL_WITHHELD,
  REASON_CODES.ENV_NOT_GRANTED,
  REASON_CODES.ISOLATION_NOT_STRICT
]);

const firstReason = (reasons) => REASON_ORDER.find((code) => reasons.includes(code)) ?? reasons[0] ?? null;

/**
 * Every runtime this machine offers, from the two places one can come from.
 *
 * An agent the operator registered is a candidate by that registration, whatever it is. A runtime
 * on PATH that nobody registered is a candidate too, which is the zero-config half: the arguments
 * that make it non-interactive are a property of the CLI and not a decision. A registration wins
 * over a discovery of the same program, because it may carry a declared model and an approved
 * environment that the discovery has no way to know about.
 */
const candidatePool = (home, env) => {
  const pool = [];
  let registered = {};
  let unreadable = false;
  try {
    registered = readConfig(home).agents ?? {};
  } catch {
    // A store this product cannot read is not an empty store. Discovery carries on over PATH so the
    // operator still gets an answer, and the record says the history was unreadable -- without that
    // line a damaged store and a fresh machine produce the same document.
    registered = {};
    unreadable = true;
  }
  for (const entry of Object.values(registered)) pool.push({ id: entry.id, entry, source: "registered" });
  const taken = new Set(pool.map((one) => basename(String(one.entry.command ?? ""))));
  for (const found of DISCOVERABLE_RUNTIMES) {
    if (taken.has(found.command)) continue;
    if (pool.some((one) => one.id === found.id)) continue;
    pool.push({
      id: found.id,
      source: "path",
      entry: {
        id: found.id,
        display_name: found.id,
        runtime_name: found.runtime,
        command: found.command,
        args: [...found.args],
        adapter: found.adapter,
        allowed_env_names: [...found.allow],
        runtime_auth_env_names: [],
        transport_env_names: [],
        auto_runtime_auth: true,
        runtime_identity: null,
        model_id: null,
        config_digest: null
      }
    });
  }
  return { pool, unreadable };
};

/**
 * Everything the operator would otherwise have had to work out, worked out.
 *
 * Every seam here is a test seam and none of them is a policy: the platform, the backend probe, the
 * support matrix and the version probe are injected so a machine that is not darwin can still be
 * asked what darwin would answer, and the credential resolver is injected so a test never reads the
 * keychain of whoever runs the suite. Production passes none of them.
 */
export function discover({
  home = null,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  // The platform being described, and the platform this is running on. They are the same in
  // production and a test may separate them, because the two govern different things: the first
  // decides which isolation backend and which release lane apply, the second decides how this
  // filesystem is read. Handing a described platform to #554 would skip the ACL walk on a machine
  // that has ACLs -- an executable anyone could replace, reported VERIFIED -- so the identity read,
  // the credential gate and the credential store all take the host.
  hostPlatform = process.platform,
  identify = describeExecutable,
  operatorHome = null,
  matrix = null,
  matrixDir = null,
  backendFor = adapterForPlatform,
  probe = probeCommand,
  resolveCredential = resolveRuntimeAuth,
  write = true,
  log = () => {}
} = {}) {
  const root = home === null ? resolveHome({ env }) : resolve(home);
  const operator = operatorHome ?? (typeof env?.HOME === "string" && env.HOME.length > 0 ? env.HOME : homedir());
  const machine = discoveryMachine();
  // One place a record is finished. There are five ways out of this function and the next action
  // and the counters are derived from the same two fields in every one of them; the first draft
  // computed them per exit and patched the record afterwards, which is four chances for two exits
  // to disagree about what the operator was asked to do.
  const settle = ({ status, tie = null, candidate = null, ...fields }) => {
    const base = {
      schema_id: DISCOVERY_SCHEMA,
      status,
      states_visited: [...machine.visited, status],
      candidates: [],
      selected_runtime: null,
      support_matrix: [],
      profile: null,
      profile_reuse: null,
      reason_code: null,
      store_unreadable: false,
      tie_break: null,
      ...fields
    };
    const record = { ...base, next_action: nextActionFor({ status, reasonCode: base.reason_code, candidate, tie }) };
    return { ...record, zero_input: zeroInputCounters(record) };
  };

  try {
    machine.enter("DISCOVERING");
    log("DISCOVERING", "reading this machine for runtimes AOS can measure");
    const fixture = matrix ?? JSON.parse(readFileSync(join(fixtureRoot(), "support-matrix.json"), "utf8"));
    const decisions = supportMatrixDecisions(fixture, matrixDir ?? (matrix === null ? null : fixtureRoot()));
    const supportMatrix = decisions.map((row) => ({
      platform: row.platform,
      backend: row.backend,
      adapter: row.adapter,
      level: row.level,
      support_status: row.support_status,
      // The gate's verdict over the committed observations, not the fixture's own label.
      official: row.decision.official === true,
      claim_stage_ceiling: row.decision.claim_stage_ceiling,
      reasons: [...row.decision.reasons],
      constraints: [...(row.constraints ?? [])]
    }));

    const { pool, unreadable: storeUnreadable } = candidatePool(root, env);
    const ledger = readProfileLedger(root);
    const candidates = [];

    machine.enter("IDENTITY_CHECKING");
    log("IDENTITY_CHECKING", `${pool.length} candidate${pool.length === 1 ? "" : "s"} to identify`);
    for (const found of pool) {
      const adapter = adapterFor(found.entry);
      const identity = identify(found.entry.command, { env, platform: hostPlatform, adapterId: adapter.id });
      const match = identity === null ? { ok: false, reason: "there is no executable to compare" } : runtimeIdentityMatches(identity, adapter);
      const drift = found.entry.runtime_identity === null || found.entry.runtime_identity === undefined
        ? []
        : identityDrift(found.entry.runtime_identity, identity);
      candidates.push({ ...found, adapter, identity_record: identity, identity: publicIdentity(identity, match, drift), drift });
    }
    // A registered agent whose command no longer resolves is a candidate that says so. A PATH
    // runtime that is simply not installed is not a candidate at all -- there is nothing to report
    // about a program this machine does not have.
    const present = candidates.filter((one) => one.source === "registered" || one.identity_record !== null);

    machine.enter("AUTH_CHECKING");
    for (const candidate of present) {
      candidate.auth = credentialReadiness(machine, {
        adapter_id: candidate.adapter.id,
        // #554's own record, not the projection of it this file emits. A gate that reads a derived
        // object is a gate one refactor away from reading a field somebody else computed.
        identity: candidate.identity_record,
        adapter_runtime_match: candidate.identity.adapter_runtime_match,
        entry: candidate.entry
      }, { env, platform: hostPlatform, operatorHome: operator, resolveCredential });
    }
    log("AUTH_CHECKING", `${present.filter((one) => one.auth.status === "RESOLVED" || one.auth.status === "PRESENT").length} of ${present.length} can log in without help`);

    machine.enter("MODEL_CHECKING");
    for (const candidate of present) {
      candidate.model = modelReadiness(candidate.entry, candidate.adapter, candidate.identity_record);
    }
    log("MODEL_CHECKING", `${present.filter((one) => one.model.status === "EXACT").length} of ${present.length} name an exact model`);

    machine.enter("ENV_CHECKING");
    for (const candidate of present) {
      candidate.env = environmentReadiness(candidate.entry, candidate.adapter, env, candidate.auth.local_config ?? { declared: [], present: [] });
    }

    machine.enter("ISOLATION_CHECKING");
    for (const candidate of present) {
      candidate.isolation = isolationReadiness(candidate.adapter, { platform, backendFor, decisions });
      const verdict = supportStatusOf(candidate);
      candidate.support_status = verdict.support_status;
      candidate.blocked_reasons = verdict.blocked_reasons;
      candidate.runtime_command = basename(String(candidate.entry.command ?? ""));
      candidate.adapter_id = candidate.adapter.id;
      candidate.runtime_name = candidate.entry.runtime_name ?? candidate.adapter.runtime_name ?? "unknown";
      candidate.orchestrating = (ORCHESTRATION_SIGNALS.get(candidate.adapter.id) ?? []).some((name) => valued(env, name));
      // What "reliably identified" means, said once. A runtime nobody described is excluded by
      // name: `generic-command.v1` is the fallback for a command this product knows nothing about,
      // and an environment variable claiming such a command is orchestrating is a claim with
      // nothing behind it.
      candidate.reliably_identified = candidate.identity.status === "VERIFIED"
        && candidate.identity.adapter_runtime_match === true
        && candidate.drift.length === 0
        && candidate.adapter.id !== "generic-command.v1";
    }
    log("ISOLATION_CHECKING", `${present.filter((one) => one.isolation.lane_official).length} of ${present.length} reach a lane the release has proven`);

    machine.enter("PROFILE_BUILDING");
    for (const candidate of present) {
      candidate.profile = null;
      candidate.profile_digest = null;
      candidate.existing_profile = false;
      candidate.evidence_completeness = [
        candidate.identity.status === "VERIFIED" && candidate.identity.adapter_runtime_match === true && candidate.drift.length === 0,
        candidate.auth.status === "RESOLVED" || candidate.auth.status === "PRESENT",
        candidate.model.status === "EXACT",
        candidate.env.status === "READY"
      ].filter(Boolean).length;
      if (candidate.support_status === "BLOCKED") continue;
      try {
        const policy = isolationPolicyFor({ level: candidate.isolation.level, platform, backend: candidate.isolation.backend, adapter: candidate.adapter });
        candidate.profile = buildProfile({
          profileId: candidate.id,
          agent: { ...candidate.entry, runtime_identity: candidate.identity_record },
          isolation: candidate.isolation.level,
          isolationPolicyDigest: isolationPolicyDigestOf(policy),
          runtimeConfigDigest: runtimeConfigDigestFor(candidate.adapter, { ...env, HOME: operator }),
          platform,
          arch,
          probe
        });
      } catch (error) {
        // One registration this product refuses to bind is not a machine this product cannot read.
        // The candidate carries the refusal and can never be selected; every other candidate is
        // still measured, which is the difference between a report and a stack trace.
        candidate.profile = null;
        candidate.support_status = "BLOCKED";
        candidate.blocked_reasons = [...candidate.blocked_reasons, withoutPaths(error instanceof Error ? error.message : String(error))];
        continue;
      }
      candidate.profile_digest = candidate.profile.profile_digest;
      // The ledger answers one question -- have I produced this exact profile before -- and nothing
      // it holds is read as a fact about the machine. Every field above was measured again.
      candidate.existing_profile = ledger.profiles.some((one) => sameDigest(one.profile_digest, candidate.profile_digest));
    }

    const { selected, tie } = selectRuntime(present);
    const publicCandidates = present.map(publicCandidate);

    if (present.length === 0) {
      return settle({ status: "ACTION_REQUIRED", reason_code: REASON_CODES.NO_RUNTIME, support_matrix: supportMatrix, store_unreadable: storeUnreadable });
    }
    if (tie !== null) {
      const tieBreak = {
        schema_id: TIE_BREAK_SCHEMA,
        question_id: `discovery-tie-${tie.map((one) => one.id).sort().join("+")}`,
        kind: "exact_runtime_tie",
        prompt: "Two runtimes here are equal on every rule this product has. Which one should the measurement use?",
        options: tie.map((one) => ({ id: one.id, adapter_id: one.adapter.id, runtime_command: basename(String(one.entry.command ?? "")), support_status: one.support_status })),
        allowed_answers: tie.map((one) => one.id).sort(),
        asked_at_most_once: true
      };
      return settle({ status: "ACTION_REQUIRED", reason_code: REASON_CODES.RUNTIME_TIE, candidates: publicCandidates, support_matrix: supportMatrix, tie_break: tieBreak, tie, store_unreadable: storeUnreadable });
    }
    if (selected === null) {
      return settle({ status: "BLOCKED", reason_code: REASON_CODES.ALL_CANDIDATES_BLOCKED, candidates: publicCandidates, support_matrix: supportMatrix, store_unreadable: storeUnreadable });
    }

    const reuse = fileProfile(root, selected.profile, { write });
    const official = selected.support_status === "OFFICIAL";
    const reason = official ? null : firstReason(selected.blocked_reasons);
    const status = official
      ? "OFFICIAL_READY"
      : reason === REASON_CODES.PROVIDER_LOGIN_REQUIRED ? "ACTION_REQUIRED" : "DIAGNOSTIC_ONLY";
    log(status, official ? "this host can issue a profile-bound number" : `diagnostic only: ${reason}`);
    return settle({
      status,
      reason_code: reason,
      candidates: publicCandidates,
      selected_runtime: selected.id,
      support_matrix: supportMatrix,
      profile: selected.profile,
      profile_reuse: reuse,
      store_unreadable: storeUnreadable,
      candidate: selected
    });
  } catch (error) {
    // Nothing partial is issued. A discovery that fell over knows less about this machine than one
    // that has not run, and reporting its half-built candidates as findings would be the worst of
    // the two.
    return settle({
      status: "FAILED",
      reason_code: REASON_CODES.FAILED,
      detail: withoutPaths(error instanceof Error ? error.message : String(error))
    });
  }
}
