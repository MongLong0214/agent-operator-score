import { spawnSync } from "node:child_process";

import { canonicalJson, sha256Value } from "./core.mjs";
import { ADAPTER_ENV_POLICIES, envPolicyFor } from "./env-policy.mjs";
import { buildAgentEnv, ISOLATION_LEVELS, isolationPolicyDigestOf, SCORING_ISOLATION } from "./isolation.mjs";
import { assertModelIdentity, resolveModelProvenance, runtimeConfigModel } from "./model-identity.mjs";
import { boundRuntimeIdentity } from "./runtime-identity.mjs";

// What a score is conditional on.
//
// A number produced with one agent, one model and one isolation level is not the same measurement
// as a number produced with another, and the product has no way to remove the difference. So it
// records the difference instead: everything that changes what the number means goes into a digest,
// and two runs are comparable exactly when their digests match.
//
// That is the whole content of PROFILE-BOUND. Without it, "78" invites a comparison the instrument
// cannot support.

export const PROFILE_SCHEMA = "aos-environment-profile.v1";

// The language the suite's prompts are written in (`lib/suite.mjs`), and the surface every adapter
// here drives. Both are facets the ECD contract requires for comparability, so both are in the
// digest even though this release ships exactly one value of each: the day a second one exists,
// results from the two must already be filed apart.
export const SUITE_LANGUAGE = "en";

/**
 * How a runtime is reached and what can be learned about it.
 *
 * An adapter is a description, not a dependency: `generic-command` accepts a runtime this product
 * has never heard of, and adding one is a pool edit rather than a change here. What an adapter owns
 * is the part that differs -- how to ask for a version, and how to read the answer.
 */
export const ADAPTERS = {
  "codex-cli.v1": {
    id: "codex-cli.v1",
    version: 1,
    runtime_name: "codex",
    // Which provider's models this runtime reaches, and which surface it is. A model named without
    // a provider prefix is filed under this provider; the interface is a comparability facet.
    provider: "openai",
    interface: "cli",
    // The transcript tree this runtime writes about itself, and the only one a run under it may be
    // corroborated by (#561). An adapter with none cannot be corroborated at all -- which is the
    // fail-closed answer, not an oversight: a generic command that happens to write a Codex-shaped
    // file under the run's HOME is not Codex saying what it used.
    transcript: "codex",
    version_args: ["--version"],
    // `codex-cli 0.12.3` and `0.12.3` both appear depending on the build.
    version_of: (text) => text.match(/(\d+\.\d+\.\d+[\w.-]*)/)?.[1] ?? null,
    // The flags under which this runtime takes a model on its command line. Reading them is what
    // "runtime config" means for it; `--version` output names no model and is not read for one.
    model_flags: ["--model", "-m"],
    provider_network: "required",
    supported_isolation: ["BEST_EFFORT_CLI", "NONE"],
    // Codex reads its credential from CODEX_HOME/auth.json, so the config directory really is
    // enough for it. The API key is listed because a key-authenticated install exists too.
    auth_env: ADAPTER_ENV_POLICIES["codex-cli.v1"].auth_env,
    config_env: "CODEX_HOME",
    // What this runtime may ask the operator for beyond the structural minimum. Nothing is granted
    // by appearing here: a transport name still needs the operator to approve it by name, and the
    // approval moves the profile digest. What the declaration settles is that a proxy is a thing
    // this runtime can legitimately need, which the generic adapter cannot claim.
    //
    // `required_env` is the stronger statement, and only Codex makes it: its credential is a file
    // under `CODEX_HOME`, whose default is `$HOME/.codex` -- and a run replaces HOME, so an unset
    // one leaves the runtime with no configuration at all. Measured on darwin 26.3, that is an
    // HTTP 401 that reads like a login problem. `agent doctor` names it instead.
    env_policy: ADAPTER_ENV_POLICIES["codex-cli.v1"]
  },
  "claude-code.v1": {
    id: "claude-code.v1",
    version: 1,
    runtime_name: "claude-code",
    provider: "anthropic",
    interface: "cli",
    transcript: "claude-code",
    version_args: ["--version"],
    version_of: (text) => text.match(/(\d+\.\d+\.\d+[\w.-]*)/)?.[1] ?? null,
    model_flags: ["--model"],
    provider_network: "required",
    supported_isolation: ["BEST_EFFORT_CLI", "NONE"],
    // On macOS this runtime keeps its credential in the login Keychain, and the Keychain is found
    // through HOME -- which this tool replaces. A config directory does not carry it: there is no
    // file to point at unless the operator exports the token themselves. These are the names the
    // binary actually reads, and `claude setup-token` exists to mint the first one.
    auth_env: ADAPTER_ENV_POLICIES["claude-code.v1"].auth_env,
    // Where the credential actually is when HOME has not been moved, so AOS can carry it over
    // instead of asking the operator to mint one. `CLAUDE_CODE_OAUTH_TOKEN` is read before the
    // keychain in this runtime's own lookup order, so handing it over also keeps the isolated
    // process away from the keychain entirely -- which is what stops the per-invocation dialogs.
    auth_resolver: {
      platform: "darwin",
      env: "CLAUDE_CODE_OAUTH_TOKEN",
      keychain: { service: "Claude Code-credentials", path: ["claudeAiOauth", "accessToken"] },
      // Which command may receive it. The adapter id is the operator's claim about what they
      // registered; this is what has to be true before AOS reads their keychain on its behalf.
      binary: "claude"
    },
    // Carries the credential only if the operator put one in that directory. On macOS the login
    // is in the Keychain, so pointing at a config directory alone leaves it empty.
    config_env: "CLAUDE_CONFIG_DIR",
    // Declared but not required: on macOS this runtime's credential is in the login Keychain, which
    // AOS resolves by name, so an unset config directory is an ordinary state rather than a
    // blocker. Marking it required would fail doctor for every correctly configured install.
    env_policy: ADAPTER_ENV_POLICIES["claude-code.v1"]
  },
  "generic-command.v1": {
    id: "generic-command.v1",
    version: 1,
    runtime_name: null,
    // No provider and no model flags: a runtime nobody described has no command line this product
    // can read a model off, so its model is what the operator declares or unknown.
    provider: null,
    interface: "cli",
    // Nothing. A runtime nobody described writes no transcript this product knows how to read, so
    // a run under it is never corroborated and never profile-bound (#561).
    transcript: null,
    version_args: ["--version"],
    version_of: (text) => text.match(/(\d+\.\d+\.\d+[\w.-]*)/)?.[1] ?? null,
    model_flags: [],
    // Unknown, not "none". Claiming a runtime nobody described needs no network would be a
    // statement about somebody else's software.
    provider_network: "unknown",
    supported_isolation: ["STRICT", "BEST_EFFORT_CLI", "NONE"],
    // Empty, not permissive. Naming a credential variable for a runtime nobody described would be
    // guessing which of the operator's secrets to hand over.
    auth_env: ADAPTER_ENV_POLICIES["generic-command.v1"].auth_env,
    config_env: null,
    // Empty for the same reason `auth_env` is. A runtime nobody described gets the structural
    // minimum: no credential, no preload, no proxy. Declaring a transport need on its behalf would
    // be a statement about somebody else's software.
    env_policy: ADAPTER_ENV_POLICIES["generic-command.v1"]
  }
};

export const adapterFor = (agent) => {
  const named = agent?.adapter && ADAPTERS[agent.adapter];
  if (named) return named;
  const byRuntime = Object.values(ADAPTERS).find((entry) => entry.runtime_name && entry.runtime_name === agent?.runtime_name);
  return byRuntime ?? ADAPTERS["generic-command.v1"];
};

/**
 * Runs a runtime's version probe under the same environment rules as the run itself.
 *
 * A probe that inherits the operator's shell can read credentials the assessed agent is not
 * allowed to see, and it runs before anybody has decided the run is safe to start.
 */
export const probeCommand = (command, args, { timeoutMs = 5000, env = process.env } = {}) => {
  if (typeof command !== "string" || command.length === 0) return null;
  try {
    const built = buildAgentEnv("STRICT", env, {});
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      shell: false,
      env: built.env
    });
    if (result.error || result.status !== 0) return null;
    return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || null;
  } catch {
    return null;
  }
};

/**
 * A fact about the runtime and where it came from.
 *
 * `detected` was read from the runtime, `declared` was typed by the operator, `unknown` is neither.
 * The three are kept apart because they carry different weight, and because a missing value must
 * not block a score -- the honest answer is to record that nobody knows, not to refuse the run.
 */
const observed = (detected, declared) => {
  if (typeof detected === "string" && detected.length > 0) return { value: detected, source: "detected" };
  if (typeof declared === "string" && declared.length > 0) return { value: declared, source: "declared" };
  return { value: null, source: "unknown" };
};

/**
 * The fields that change what a number means.
 *
 * `profile_id` is not among them: it is a label the operator chose, and two identically configured
 * environments must aggregate whether or not they were given the same name. The digest is not in
 * its own input either.
 */
export const profileDigestOf = (profile) =>
  sha256Value({
    schema_id: profile.schema_id,
    os: profile.os,
    arch: profile.arch,
    node_version: profile.node_version,
    adapter_id: profile.adapter_id,
    runtime_name: profile.runtime_name,
    runtime_version: profile.runtime_version,
    // The exact executable, not only its self-reported version. A runtime rebuilt without moving
    // its version string, or a name that now resolves to a different file, produces a different
    // number and must not aggregate with what came before it. #554 records this identity once and
    // this is where a score becomes bound to it.
    runtime_identity_digest: profile.runtime_identity_digest,
    // The model identity, and only the identity: which provider, which family, which exact name,
    // and whether that name is one the provider may move. Not `source`, `confidence` or the
    // evidence digest -- those say how this product came to know the name, and the cohort is what
    // ran, not how it was learned. They were in here, and that made the issue's own precedence
    // unusable: the digest is locked when a cycle opens and the runtime's own event arrives after
    // it, so upgrading the record to the higher-precedence source would have re-cohorted the run
    // it confirmed (#561). A mutable alias is still a name that may not mean tomorrow what it
    // means today, so that one stays.
    model_provider: profile.model_provider ?? null,
    model_family: profile.model_family ?? null,
    model_id: profile.model_id,
    model_mutable_alias: profile.model_mutable_alias ?? null,
    adapter_version: profile.adapter_version ?? null,
    agent_config_digest: profile.agent_config_digest,
    tool_policy: profile.tool_policy,
    provider_network: profile.provider_network,
    isolation_level: profile.isolation_level,
    allowed_env_names: [...(profile.allowed_env_names ?? [])].sort(),
    // The environment policy, by digest. Two runs whose adapter declares different names, or whose
    // operator approved a proxy for one and not the other, are not the same measurement -- and
    // without this the digest could not tell them apart, because neither difference shows up in
    // any other field.
    env_policy_digest: profile.env_policy_digest ?? null,
    // Whether AOS may reach into the operator's credential store for this agent. It changes which
    // names the child is built with, and this digest is computed before anything is spawned -- so
    // without it, `--no-auto-auth` and its opposite filed as the same cohort. What the profile
    // still cannot cover is whether the reach *found* anything: that is a fact about the machine at
    // the moment of the run, and it is recorded per invocation as the applied `env_policy_digest`,
    // which a reader compares against this one.
    auto_runtime_auth: profile.auto_runtime_auth ?? true,
    // What the isolation level committed the run to, by digest, beside the level's name: the
    // scoring rule, the HOME regime and the prefixes withheld before any policy is read.
    isolation_policy_digest: profile.isolation_policy_digest ?? null,
    // Two facets the ECD contract gates comparability on. One value of each ships today, and the
    // digest carries them so that a second value is a second cohort from its first run.
    language: profile.language ?? null,
    interface: profile.interface ?? null,
    suite_major: profile.suite_major
  });

export function buildProfile({
  profileId = "default",
  agent,
  isolation = "BEST_EFFORT_CLI",
  suiteMajor = 1,
  toolPolicy = "workspace-read-write",
  allowedEnvNames = [],
  platform = process.platform,
  arch = process.arch,
  nodeVersion = process.versions.node,
  language = SUITE_LANGUAGE,
  probe = probeCommand
} = {}) {
  if (!ISOLATION_LEVELS.includes(isolation)) throw new Error(`AOS_UNKNOWN_ISOLATION ${isolation}`);
  const adapter = adapterFor(agent);
  const envPolicy = envPolicyFor(adapter, {
    allow: agent?.allowed_env_names ?? allowedEnvNames,
    runtimeAuth: agent?.runtime_auth_env_names ?? [],
    transport: agent?.transport_env_names ?? []
  });
  const text = probe(agent?.command, adapter.version_args) ?? "";
  const version = observed(adapter.version_of(text), agent?.runtime_version);
  // The model is never read off `--version`. What can be known before the run is what the runtime
  // was told on its command line and what the operator declared; a runtime event arrives during
  // the run and verifies this binding rather than joining it (`lib/model-identity.mjs`). A
  // configuration that contradicts the declaration is refused here, before a digest could bind it.
  const configuredModel = runtimeConfigModel(agent?.args ?? [], adapter.model_flags);
  const modelInputs = {
    runtimeConfig: configuredModel === null ? null : { model: configuredModel, provider: adapter.provider },
    declared: typeof agent?.model_id === "string" ? { model: agent.model_id, provider: adapter.provider } : null
  };
  const model = assertModelIdentity(resolveModelProvenance(modelInputs));
  const runtimeIdentity = boundRuntimeIdentity(agent?.runtime_identity);

  const profile = {
    schema_id: PROFILE_SCHEMA,
    profile_id: profileId,
    os: platform,
    arch,
    // The major only. Pinning the patch would make every Node update a separate cohort, which
    // would leave the operator unable to compare this week with last week for no reason anybody
    // could act on.
    node_version: `${nodeVersion.replace(/^v/, "").split(".")[0]}.x`,
    agent_id: agent?.id ?? null,
    runtime_name: agent?.runtime_name ?? adapter.runtime_name ?? "unknown",
    runtime_version: version.value,
    runtime_version_source: version.source,
    model_provider: model.provider,
    model_family: model.family,
    model_id: model.id,
    model_source: model.source,
    model_confidence: model.confidence,
    model_evidence_digest: model.evidence_digest,
    model_mutable_alias: model.mutable_alias,
    model_alias_class: model.alias_class,
    model_provenance: model,
    adapter_id: adapter.id,
    adapter_version: adapter.version,
    // Which transcript tree may corroborate a run under this profile, and the two inputs the
    // provenance was resolved from. Neither is in the digest: the first is a property of the
    // adapter the digest already names, and the second is kept so the record can be resolved
    // again once the run's own event is in hand, without moving the cohort key (#561).
    runtime_transcript: adapter.transcript ?? null,
    model_inputs: modelInputs,
    // Through the #554 contract, so that only an identity this product verified is bound.
    runtime_identity_digest: runtimeIdentity.identity_digest,
    runtime_identity_status: runtimeIdentity.identity_status,
    agent_config_digest: agent?.config_digest ?? null,
    tool_policy: toolPolicy,
    provider_network: adapter.provider_network,
    isolation_level: isolation,
    isolation_policy_digest: isolationPolicyDigestOf({ level: isolation }),
    scoring_permitted: SCORING_ISOLATION.has(isolation),
    language,
    interface: adapter.interface,
    allowed_env_names: [...allowedEnvNames].sort(),
    transport_env_names: [...envPolicy.transport_env],
    auto_runtime_auth: agent?.auto_runtime_auth !== false,
    env_policy_schema: envPolicy.schema_id,
    env_policy_digest: envPolicy.policy_digest,
    suite_major: suiteMajor
  };
  return { ...profile, profile_digest: profileDigestOf(profile) };
}

// Comparability is not decided here. The first draft of #561 wrote `comparabilityOf`/`sameCohort`
// in this file: a second formula over profile-shaped objects, called by nothing in the product,
// beside the shipped authority in `lib/ecd-contract.mjs` (`comparability`, which takes only
// results it emitted and applies every rule the contract declares). Two contracts answering one
// question is the defect, not the coverage. What this file contributes to that answer is the
// digest below -- the cohort key `lib/cycle.mjs` checks every run against -- and the model
// provenance the issuance policy in `lib/model-identity.mjs` reads.

/** A short line for any surface that shows a score, so the boundary travels with the number. */
export const profileLabel = (profile) =>
  [
    profile.runtime_name,
    profile.runtime_version ?? `version ${profile.runtime_version_source}`,
    profile.model_id ?? `model ${profile.model_source}`,
    `${profile.os} ${profile.arch}`,
    profile.isolation_level
  ].join(" · ");

