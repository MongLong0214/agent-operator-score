import { spawnSync } from "node:child_process";

import { canonicalJson, sha256Value } from "./core.mjs";
import { buildAgentEnv, ISOLATION_LEVELS, SCORING_ISOLATION } from "./isolation.mjs";

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
    runtime_name: "codex",
    version_args: ["--version"],
    // `codex-cli 0.12.3` and `0.12.3` both appear depending on the build.
    version_of: (text) => text.match(/(\d+\.\d+\.\d+[\w.-]*)/)?.[1] ?? null,
    model_of: (text) => text.match(/model[:\s=]+([\w.:-]+)/i)?.[1] ?? null,
    provider_network: "required",
    supported_isolation: ["BEST_EFFORT_CLI", "NONE"]
  },
  "claude-code.v1": {
    id: "claude-code.v1",
    runtime_name: "claude-code",
    version_args: ["--version"],
    version_of: (text) => text.match(/(\d+\.\d+\.\d+[\w.-]*)/)?.[1] ?? null,
    model_of: (text) => text.match(/model[:\s=]+([\w.:-]+)/i)?.[1] ?? null,
    provider_network: "required",
    supported_isolation: ["BEST_EFFORT_CLI", "NONE"]
  },
  "generic-command.v1": {
    id: "generic-command.v1",
    runtime_name: null,
    version_args: ["--version"],
    version_of: (text) => text.match(/(\d+\.\d+\.\d+[\w.-]*)/)?.[1] ?? null,
    model_of: () => null,
    // Unknown, not "none". Claiming a runtime nobody described needs no network would be a
    // statement about somebody else's software.
    provider_network: "unknown",
    supported_isolation: ["STRICT", "BEST_EFFORT_CLI", "NONE"]
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
    model_id: profile.model_id,
    model_source: profile.model_source,
    agent_config_digest: profile.agent_config_digest,
    tool_policy: profile.tool_policy,
    provider_network: profile.provider_network,
    isolation_level: profile.isolation_level,
    allowed_env_names: [...(profile.allowed_env_names ?? [])].sort(),
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
  probe = probeCommand
} = {}) {
  if (!ISOLATION_LEVELS.includes(isolation)) throw new Error(`AOS_UNKNOWN_ISOLATION ${isolation}`);
  const adapter = adapterFor(agent);
  const text = probe(agent?.command, adapter.version_args) ?? "";
  const version = observed(adapter.version_of(text), agent?.runtime_version);
  const model = observed(adapter.model_of(text), agent?.model_id);

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
    model_id: model.value,
    model_source: model.source,
    adapter_id: adapter.id,
    agent_config_digest: agent?.config_digest ?? null,
    tool_policy: toolPolicy,
    provider_network: adapter.provider_network,
    isolation_level: isolation,
    scoring_permitted: SCORING_ISOLATION.has(isolation),
    allowed_env_names: [...allowedEnvNames].sort(),
    suite_major: suiteMajor
  };
  return { ...profile, profile_digest: profileDigestOf(profile) };
}

/**
 * Whether two runs may be aggregated.
 *
 * Same digest, same cohort. Anything else is two measurements of different things, and averaging
 * them produces a number that describes neither.
 */
export const sameCohort = (a, b) => a?.profile_digest === b?.profile_digest;

/** A short line for any surface that shows a score, so the boundary travels with the number. */
export const profileLabel = (profile) =>
  [
    profile.runtime_name,
    profile.runtime_version ?? `version ${profile.runtime_version_source}`,
    profile.model_id ?? `model ${profile.model_source}`,
    `${profile.os} ${profile.arch}`,
    profile.isolation_level
  ].join(" · ");

