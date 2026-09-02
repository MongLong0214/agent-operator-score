// What an assessed agent is allowed to see of the operator's machine.
//
// The agent CLI used to be spawned with `{ ...process.env }`. AOS is run from the operator's own
// shell, which is where AWS keys, GH_TOKEN, database URLs and an SSH agent socket live. A task
// prompt that says nothing about credentials does not stop the agent, or the model behind it, from
// reading them and putting them somewhere else.
//
// The first fix subtracted the dangerous names from the operator's environment. That was still the
// operator's environment, and subtraction cannot be finished: measured on a developer machine, a
// `DYLD_INSERT_LIBRARIES` sitting in the shell reached the spawned agent and dyld killed it trying
// to load the named library before the agent ran a line of its own. The variable was in no list
// because nobody had thought of it, which is the permanent condition of a denylist.
//
// So the child environment is now built rather than filtered. `lib/env-policy.mjs` holds what an
// adapter may declare and which classes no flag can unlock; this file walks the operator's
// environment and copies across only what that policy names. A variable invented next year is
// absent because nothing named it, not because somebody patched a list.
//
// The honest fix is still not "deny the network". Codex and Claude need their provider, and
// claiming otherwise in a report would be false. What AOS can do is decide which of the operator's
// secrets travel into the run, and say in the result which level and which policy were used.

import { envDecision, envPolicyFor } from "./env-policy.mjs";

// The credential-shaped-name rule now lives beside the policy it belongs to. It is re-exported
// here because this is where every caller already imports it from, and because a name rule that
// only the CLI could see was a rule the policy object did not know about.
export { isSensitiveName } from "./env-policy.mjs";

export const ISOLATION_LEVELS = ["STRICT", "BEST_EFFORT_CLI", "NONE"];

// Levels that can carry an issued score. NONE cannot: it means the operator declined the boundary,
// and a number produced under no boundary is not comparable to one produced under a boundary.
export const SCORING_ISOLATION = new Set(["STRICT", "BEST_EFFORT_CLI"]);

/**
 * What kind of directory the child was given as HOME.
 *
 * A closed set, because this is the field a later reader uses to tell an authenticated run from an
 * unauthenticated one, and an open string lets a caller write a path into it. `buildAgentEnv` used
 * to accept whatever it was handed and `isolationRecord` emitted it verbatim, so
 * `homeSource: "/Users/alice/private/home"` became part of a record whose own comment promises the
 * path is never written down. Nothing in this repository passed one; the guarantee was a habit
 * rather than a rule, and this is the rule.
 */
export const HOME_SOURCES = new Set(["aos_temporary", "operator", "adapter", "absent"]);

/**
 * The only names the post-policy injection door carries.
 *
 * `injected` is merged after the policy has decided everything else, which is what makes it able to
 * add the four run-context names -- they are `AOS_*`, and `AOS_*` is stripped from the operator's
 * environment a few lines earlier so that an agent is never told where the operator's runs are.
 * That merge was unchecked, so it was also a way to put any name into the child past the allowlist:
 * a caller could have handed it `NODE_OPTIONS`. It is a door for run metadata, so it opens for run
 * metadata and for nothing else. `AOS_HOME` is not here, and that is the whole point of the door
 * being narrow.
 */
export const RUN_METADATA_ENV = ["AOS_FAMILY", "AOS_SESSION_ID", "AOS_TASK_FILE", "AOS_WORKSPACE"];

/**
 * Builds the environment an agent process is given.
 *
 * Allowlist-only, at both scoring levels. The operator's environment is read but never inherited:
 * a name travels when the policy in force names it -- structural, adapter config, verified runtime
 * auth, or approved transport -- and is absent otherwise. `removed` is therefore everything else
 * the operator had, reported by name so a result can say what the agent could not see as well as
 * what it could.
 *
 * Values are never recorded. Only names.
 */
export function buildAgentEnv(level, source, {
  policy = null,
  adapter = null,
  allow = [],
  runtimeAuth = [],
  transport = [],
  inject = {},
  home,
  homeSource = "aos_temporary",
  injected = {}
} = {}) {
  if (!ISOLATION_LEVELS.includes(level)) throw new Error(`AOS_UNKNOWN_ISOLATION ${level}`);
  if (!HOME_SOURCES.has(homeSource)) {
    throw new Error(`AOS_UNKNOWN_HOME_SOURCE ${homeSource}; one of ${[...HOME_SOURCES].join(", ")}, and never a path`);
  }
  const smuggled = Object.keys(injected).filter((name) => !RUN_METADATA_ENV.includes(name));
  if (smuggled.length > 0) {
    throw new Error(
      `AOS_ENV_POLICY_MISMATCH ${smuggled.sort().join(", ")}; the run-metadata door carries ${RUN_METADATA_ENV.join(", ")} and nothing else`
    );
  }
  // A caller that hands over a policy has already had it checked; one that does not gets the
  // generic adapter's, which is structural names and nothing else. Guessing wider for a runtime
  // nobody described would be choosing which of the operator's secrets to hand over.
  const inForce = policy ?? envPolicyFor(adapter, { allow, runtimeAuth, transport });

  const env = {};
  const removed = [];
  const blockedClasses = new Set();

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    // Before the policy, not after. An operator can hand an agent a config directory; they cannot
    // hand it the location of their own assessment records, because no runtime needs that and
    // every one of them runs with the operator's own write permissions. Replacing HOME keeps the
    // dotfiles out of reach, and then AOS_HOME would have handed over the run records, the
    // results, the holdout ledger and the cycle -- the one directory that matters more.
    if (name.startsWith("AOS_")) {
      removed.push(name);
      continue;
    }
    const decision = envDecision(inForce, name);
    if (!decision.carry) {
      removed.push(name);
      if (decision.reason.startsWith("hard_forbidden:")) blockedClasses.add(decision.reason.slice("hard_forbidden:".length));
      continue;
    }
    env[name] = value;
  }

  // Replaced rather than inherited: the agent gets a directory of its own, so `~/.aws/credentials`
  // and `~/.ssh` are not one path expansion away.
  //
  // Which *kind* of directory it was is recorded alongside, because the replacement is not free and
  // the cost is invisible in the path. Measured on darwin 26.3: under a temporary HOME the login
  // keychain is unreachable (`security` exits 44) and `codex login status` reads `Not logged in`,
  // while under the operator's own HOME both succeed. A run's record has to be able to say which of
  // those two regimes it was made under -- a later reader comparing an authenticated run with an
  // unauthenticated one would otherwise be inferring it from the fact that one of them failed.
  if (home !== undefined) {
    env.HOME = home;
    env.TMPDIR = home;
  }
  // A resolved credential is not in `source`, so it is added here. It is still bound by the policy:
  // a value injected under a name the policy does not carry would be an environment nothing in the
  // record could account for.
  for (const [name, value] of Object.entries(inject)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (!envDecision(inForce, name).carry) {
      removed.push(name);
      continue;
    }
    env[name] = value;
  }

  const finalEnv = { ...env, ...injected };
  // Everything AOS gives the child, not just the names somebody asked for. A record that listed
  // only the explicit requests would describe an environment the agent did not run in.
  //
  // Not the same as everything the child observes: an exec adds names of its own that never passed
  // through here. On darwin, CoreFoundation puts `__CF_USER_TEXT_ENCODING` into a process spawned
  // with an environment of literally `{PATH}`. Its value is written by the kernel over anything the
  // parent supplied, so it is not a carrier, and listing it would claim AOS handed it over.
  const carried = Object.keys(finalEnv).sort();
  const present = (names) => names.filter((name) => Object.hasOwn(finalEnv, name)).sort();

  return {
    env: finalEnv,
    removed: [...new Set(removed)].sort(),
    carried,
    runtime_auth: present(inForce.runtime_auth_env),
    transport: present(inForce.transport_env),
    explicit: present(inForce.config_env),
    blocked_classes: [...blockedClasses].sort(),
    policy: inForce,
    // `absent` is a real third case, not a missing value: `probeCommand` runs a version probe with
    // no HOME at all, and a record that called that "operator" would be wrong in the direction that
    // matters.
    home_source: home === undefined ? "absent" : homeSource,
    level
  };
}

/**
 * The isolation record that goes into the result.
 *
 * `issued` is false under NONE. The score would still be computable, and printing it without this
 * flag is how a number produced with no boundary ends up being compared with one produced under a
 * boundary.
 *
 * The policy is quoted by digest, never by value. An evidence bundle has to be able to say which
 * allowlist was in force without becoming a place credentials are written down, and a digest that
 * moves when the allowlist moves is the whole of what a reader needs to compare two runs.
 */
export function isolationRecord(level, {
  removed = [],
  carried = [],
  runtimeAuth = [],
  transport = [],
  explicit = [],
  blockedClasses = [],
  policy = null,
  runtimeAuthSource = null,
  home = null,
  homeSource = null
} = {}) {
  // Checked here as well as in the builder, because a record can be assembled from parts that never
  // went through one.
  if (homeSource !== null && !HOME_SOURCES.has(homeSource)) {
    throw new Error(`AOS_UNKNOWN_HOME_SOURCE ${homeSource}; one of ${[...HOME_SOURCES].join(", ")}, and never a path`);
  }
  return {
    level,
    scoring_permitted: SCORING_ISOLATION.has(level),
    removed_env_count: removed.length,
    removed_env_names: [...removed].sort(),
    allowed_env_names: [...carried].sort(),
    // Named separately because "the agent could see a credential" is a different statement about a
    // run than "the agent could see PATH", and a reader comparing two results needs to see which.
    runtime_auth_env_names: [...runtimeAuth].sort(),
    // Proxy and certificate names travel only through a separate approval, so they are reported
    // separately too: a run whose traffic could have been redirected is not the same measurement.
    transport_env_names: [...transport].sort(),
    // What the operator asked for by name, as opposed to what the structure of a process requires.
    explicit_env_names: [...explicit].sort(),
    // Which classes of process-injection variable were present in the operator's environment and
    // did not travel. Class names, so the record says what was refused without naming a value.
    blocked_env_classes: [...blockedClasses].sort(),
    env_policy_schema: policy?.schema_id ?? null,
    adapter_id: policy?.adapter_id ?? null,
    env_policy_version: policy?.policy_version ?? null,
    env_policy_digest: policy?.policy_digest ?? null,
    // How the credential got there: the operator's environment, AOS resolving it, or not at all.
    runtime_auth_source: runtimeAuthSource,
    temporary_home: home !== null,
    // Which regime the run was under, by kind rather than by path: `aos_temporary` is the directory
    // AOS makes per run, `operator` is the operator's own, `adapter` is one a runtime declared, and
    // `absent` is no HOME at all. The path itself is never recorded -- it names a directory on the
    // operator's machine and this record is meant to be quotable.
    home_source: homeSource ?? (home !== null ? "aos_temporary" : "absent")
  };
}
