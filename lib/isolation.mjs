// What an assessed agent is allowed to see of the operator's machine.
//
// The agent CLI used to be spawned with `{ ...process.env }`. AOS is run from the operator's own
// shell, which is where AWS keys, GH_TOKEN, database URLs and an SSH agent socket live. A task
// prompt that says nothing about credentials does not stop the agent, or the model behind it, from
// reading them and putting them somewhere else.
//
// The honest fix is not "deny the network". Codex and Claude need their provider, and claiming
// otherwise in a report would be false. What AOS can do is decide which of the operator's secrets
// travel into the run, and say in the result which level was used.

export const ISOLATION_LEVELS = ["STRICT", "BEST_EFFORT_CLI", "NONE"];

// Levels that can carry an issued score. NONE cannot: it means the operator declined the boundary,
// and a number produced under no boundary is not comparable to one produced under a boundary.
export const SCORING_ISOLATION = new Set(["STRICT", "BEST_EFFORT_CLI"]);

// Kept for the run to work at all. HOME is replaced, not inherited, so a stray token in a dotfile
// is not reachable by accident.
const STRUCTURAL = ["PATH", "LANG", "LC_ALL", "TERM", "TZ", "SHELL", "USER", "LOGNAME"];

// Named because they are known credential carriers. This list alone is not the defence -- an
// unknown name would walk straight past it -- which is why the shape rules below run as well.
const DENIED_NAMES = new Set([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "SSH_AUTH_SOCK",
  "NPM_TOKEN",
  "NODE_OPTIONS"
]);

// `AOS_` is here for a different reason than the cloud prefixes. Replacing HOME keeps the
// operator's dotfiles out of reach, and then AOS_HOME handed the agent the one directory that
// matters more than any of them: the run records, the results, the holdout ledger and the cycle.
// An assessed agent runs as the operator, so a path is all it needs.
//
// The four names AOS gives an agent on purpose -- session, family, workspace, task file -- are
// injected after this filter and are unaffected.
const DENIED_PREFIXES = ["AWS_", "GOOGLE_", "AZURE_", "GCP_", "GCLOUD_", "DIGITALOCEAN_", "CLOUDFLARE_", "AOS_"];

// A name-shape rule, so a variable nobody listed still does not travel. `ACME_FAKE_SECRET` and
// `ACME_PROD_DB_PASSWORD` are both caught here and neither is in any list.
const DENIED_SHAPE = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|APIKEY|PRIVATE)(?:_|$)/i;

export function isSensitiveName(name) {
  if (DENIED_NAMES.has(name)) return true;
  if (DENIED_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return DENIED_SHAPE.test(name);
}

/**
 * Builds the environment an agent process is given.
 *
 * STRICT is deny-by-default: only structural names and whatever the operator named explicitly.
 * BEST_EFFORT_CLI keeps the rest of the environment so an already-logged-in CLI still works, but
 * removes everything that looks like a credential. Both record which names were removed and which
 * were let through on purpose, because a report that cannot say what the agent could see is not
 * evidence about isolation.
 *
 * Values are never recorded. Only names.
 */
export function buildAgentEnv(level, source, { allow = [], home, injected = {} } = {}) {
  if (!ISOLATION_LEVELS.includes(level)) throw new Error(`AOS_UNKNOWN_ISOLATION ${level}`);
  const allowed = new Set(allow);
  const env = {};
  const removed = [];
  const carried = [];

  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    // Before the allow list, not after. An operator can hand an agent a config directory; they
    // cannot hand it the location of their own assessment records, because no runtime needs that
    // and every one of them runs with the operator's own write permissions.
    if (name.startsWith("AOS_")) {
      removed.push(name);
      continue;
    }
    if (allowed.has(name)) {
      // Explicit, and reported by name so it is visible in the result rather than assumed.
      env[name] = value;
      carried.push(name);
      continue;
    }
    if (isSensitiveName(name)) {
      removed.push(name);
      continue;
    }
    if (level === "STRICT" && !STRUCTURAL.includes(name)) {
      removed.push(name);
      continue;
    }
    env[name] = value;
  }

  // Replaced rather than inherited: the agent gets a directory of its own, so `~/.aws/credentials`
  // and `~/.ssh` are not one path expansion away.
  if (home !== undefined) {
    env.HOME = home;
    env.TMPDIR = home;
  }
  return { env: { ...env, ...injected }, removed: removed.sort(), carried: carried.sort(), level };
}

/**
 * The isolation record that goes into the result.
 *
 * `issued` is false under NONE. The score would still be computable, and printing it without this
 * flag is how a number produced with no boundary ends up being compared with one produced under a
 * boundary.
 */
export function isolationRecord(level, { removed = [], carried = [], home = null } = {}) {
  return {
    level,
    scoring_permitted: SCORING_ISOLATION.has(level),
    removed_env_count: removed.length,
    removed_env_names: [...removed].sort(),
    allowed_env_names: [...carried].sort(),
    temporary_home: home !== null
  };
}
