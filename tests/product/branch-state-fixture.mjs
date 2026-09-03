import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A real repository and a real GitHub, small enough to build in a test.
//
// This exists so that `runDeletion` can be exercised without the module exposing a way to hand it a
// collector or an observation. An earlier version exported a runner factory for the tests to inject
// through, which is the same parameter list the previous entry point was faulted for, wearing a
// factory: a door in the gate reachable by any caller in this repository. There is no seam now, so
// the only way to drive the gate is to give it a repository to look at.
//
// `origin` is a real bare repository with real branches, tags and commits, so every git derivation in
// the collector -- merge-base, rev-list, tag --contains, grep, ls-remote -- runs for real against it.
// The GitHub half is a `gh` executable placed first on PATH that answers from a table built after the
// repository exists, so the SHAs it reports are the SHAs the repository actually has.

const run = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The one thing a caller has to remember: PATH is process-wide, so put it back. */
export const withFakeGitHub = (fixture, body) => {
  const original = process.env.PATH;
  process.env.PATH = `${fixture.binDir}:${original}`;
  try {
    return body();
  } finally {
    process.env.PATH = original;
  }
};

export const buildFixtureRepository = ({ repository = "fixture-owner/fixture-repo", blockersCleared = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "aos-branch-fixture-"));
  const originDir = join(root, "origin.git");
  const work = join(root, "work");
  const binDir = join(root, "bin");
  mkdirSync(binDir);

  execFileSync("git", ["init", "--bare", "-b", "main", originDir], { encoding: "utf8" });
  execFileSync("git", ["init", "-b", "main", work], { encoding: "utf8" });
  const git = (...args) => run(args, work);
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("remote", "add", "origin", originDir);

  // The prerequisite snapshot belongs to the repository being operated on, so the fixture carries its
  // own. `blockersCleared: false` gives the blocked case its own repository rather than a flag.
  mkdirSync(join(work, "fixtures", "execution-plan"), { recursive: true });
  mkdirSync(join(work, ".claude-plugin"));
  writeFileSync(join(work, ".claude-plugin", "marketplace.json"), '{"name":"fixture"}\n');
  writeFileSync(join(work, ".claude-plugin", "plugin.json"), '{"name":"fixture-plugin"}\n');
  writeFileSync(join(work, "package.json"), '{"name":"fixture","bin":{"fx":"./bin/fx.mjs"},"files":["bin/"]}\n');
  writeFileSync(join(work, "README.md"), "fixture\n");
  writeFileSync(join(work, "fixtures", "execution-plan", "github-state.json"), `${JSON.stringify({
    schema: "aos-github-issue-state.v1",
    repository,
    source: "snapshot",
    issues: [578, 588].map((number) => ({
      number,
      state: blockersCleared ? "closed" : "open",
      close_evidence: blockersCleared ? { audit_report_digest: `sha256:${"a".repeat(64)}` } : null
    }))
  }, null, 2)}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  const mainSha = git("rev-parse", "HEAD");

  // An annotated tag, so the ref object and the commit it peels to are different ids.
  git("tag", "-a", "v0.1.0", "-m", "first release");

  // A branch that never moved off main: contained in both lines, nothing unique to it.
  git("branch", "tmp/merged-thing", mainSha);

  git("checkout", "-q", "-b", "dev");
  writeFileSync(join(work, "README.md"), "fixture\nmore\n");
  git("commit", "-qam", "dev moves on");
  const devSha = git("rev-parse", "HEAD");

  // A branch with work on it and a pull request open: must never be touched.
  git("checkout", "-q", "-b", "task/active-work");
  writeFileSync(join(work, "feature.txt"), "in progress\n");
  git("add", "-A");
  git("commit", "-qm", "active work");
  const activeSha = git("rev-parse", "HEAD");

  git("checkout", "-q", "dev");
  git("push", "-q", "origin", "main", "dev", "tmp/merged-thing", "task/active-work", "--tags");

  const owner = repository.split("/")[0];
  const protection = {
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    enforce_admins: { enabled: true },
    required_status_checks: { strict: true, contexts: ["test"] },
    required_pull_request_reviews: { required_approving_review_count: 1 },
    required_linear_history: { enabled: false },
    required_conversation_resolution: { enabled: true },
    lock_branch: { enabled: false },
    block_creations: { enabled: false }
  };
  const openPr = { number: 1, state: "open", merged_at: null, base: { ref: "dev" }, head: { ref: "task/active-work", sha: activeSha } };
  const emptySearch = { total_count: 0, incomplete_results: false, items: [] };

  /** What the fake GitHub answers, keyed by the API path the collector asks for. */
  const responses = {
    [`repos/${repository}/branches?per_page=100`]: [
      { name: "dev", commit: { sha: devSha }, protected: true },
      { name: "main", commit: { sha: mainSha }, protected: true },
      { name: "task/active-work", commit: { sha: activeSha }, protected: false },
      { name: "tmp/merged-thing", commit: { sha: mainSha }, protected: false }
    ],
    [`repos/${repository}/pulls?state=open&per_page=100`]: [openPr],
    [`repos/${repository}/pulls?state=all&head=${owner}:task/active-work&per_page=100`]: [openPr],
    [`repos/${repository}/pulls?state=all&head=${owner}:tmp/merged-thing&per_page=100`]: [],
    [`repos/${repository}/rulesets?per_page=100`]: [],
    [`repos/${repository}/branches/main/protection`]: protection,
    [`repos/${repository}/branches/dev/protection`]: protection,
    [`repos/${repository}`]: { default_branch: "dev", delete_branch_on_merge: true }
  };
  for (const branch of ["task/active-work", "tmp/merged-thing"]) {
    responses[`search/issues?q=${encodeURIComponent(`repo:${repository} "${branch}"`)}&per_page=100`] = emptySearch;
  }

  const table = join(root, "responses.json");
  writeFileSync(table, JSON.stringify(responses));
  // `gh api [--paginate --slurp] <path>`. With --slurp the real gh returns one array element per
  // page, so the shim wraps its answer the same way; without it the object is returned as it is.
  writeFileSync(join(binDir, "gh"), `#!/usr/bin/env node
import { readFileSync } from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] !== "api") { process.stderr.write("fixture gh: only 'api' is implemented\\n"); process.exit(2); }
const slurp = argv.includes("--slurp");
const path = argv.filter((one) => one !== "api" && !one.startsWith("--")).at(-1);
const table = JSON.parse(readFileSync(${JSON.stringify(table)}, "utf8"));
if (!(path in table)) { process.stderr.write("fixture gh: no canned response for " + path + "\\n"); process.exit(3); }
const answer = table[path];
// The sentinel reproduces a command that exits 0 and prints nothing, which is what turned an
// unreachable list into "there is nothing there".
if (answer === "__EMPTY__") process.exit(0);
process.stdout.write(JSON.stringify(slurp ? [answer] : answer));
`);
  chmodSync(join(binDir, "gh"), 0o755);

  return {
    root,
    work,
    binDir,
    repository,
    responses: table,
    shas: { main: mainSha, dev: devSha, active: activeSha },
    /** Delete a branch on origin, which is what `perform` does for real in Phase B. */
    deleteBranch: (name) => run(["push", "-q", "origin", "--delete", name], work),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
};

/**
 * The smallest audit that is true of the fixture repository, built from the observation rather than
 * written beside it -- the same rule the committed audit follows, so `derivationFindings` has
 * something real to compare against.
 */
export const auditFor = (observation, { repository }) => {
  const snapshot = observation.heads;
  const audited = snapshot.filter((head) => head.name !== "main" && head.name !== "dev");
  const prByBranch = new Map(observation.open_prs.map((pr) => [pr.head_branch, pr]));
  return {
    schema: "aos-stale-branch-audit.v4",
    repository,
    issue: 572,
    phase: "read-only-audit",
    generated_at: observation.collected_at,
    excluded_refs: ["main", "dev"],
    live_observation: observation,
    ls_remote_snapshot: snapshot,
    submission_branch: null,
    heads_created_after_this_snapshot: [],
    invariant_baseline: {
      main_sha: snapshot.find((head) => head.name === "main").sha,
      dev_sha: snapshot.find((head) => head.name === "dev").sha,
      tags: observation.tags,
      protection: observation.protection,
      rulesets: observation.rulesets,
      install_source: observation.install_source,
      settings: observation.settings,
      open_pr_heads: observation.open_prs.map((pr) => ({ pr: pr.number, branch: pr.head_branch, sha: pr.head_sha, base: pr.base }))
    },
    branches: audited.map(({ name, sha }) => {
      const derived = observation.derivations[name];
      const pr = prByBranch.get(name) ?? null;
      const sweep = observation.reference_sweep.find((one) => one.branch === name);
      return {
        name,
        head_sha: sha,
        author_name: derived.last_commit.author_name,
        author_email: derived.last_commit.author_email,
        last_commit_date: derived.last_commit.date,
        age_days: 0,
        classification: pr ? "ACTIVE" : "MERGED",
        merged_into_dev: derived.ancestor_of_dev.value,
        merged_into_main: derived.ancestor_of_main.value,
        unique_commits_vs_dev: derived.unique_vs_dev.value,
        unique_commits_vs_main: derived.unique_vs_main.value,
        unique_commits_vs_dev_and_main: derived.unique_vs_dev_and_main.value,
        behind_dev: derived.behind_dev.value,
        behind_main: derived.behind_main.value,
        release_tags_containing: derived.tags_containing.value,
        open_pr: pr ? { number: pr.number, url: `https://example.invalid/${pr.number}`, state: "OPEN", base: pr.base, head_sha: pr.head_sha } : null,
        superseding: null,
        preserve: pr ? ["the commit on this branch, which reaches neither integration line"] : [],
        references: {
          tree_scan: { command: observation.receipts.find((one) => one.source === `git-grep-${name}`).command, digest: observation.receipts.find((one) => one.source === `git-grep-${name}`).digest, hits: derived.tree_scan.value },
          github_search: { query: sweep.query, complete: sweep.complete, total_count: sweep.total_count, issues: [], prs: [] },
          pr_history: derived.pr_history.value,
          workflows: [], skills: [], commands: [], scripts: [], schemas: [], contracts: [], docs: derived.tree_scan.value
        },
        branch_protected: (observation.rest_heads.find((head) => head.name === name) ?? {}).protected === true,
        unestablished: [],
        recommendation: pr ? "must_be_preserved" : "safe_to_delete_after_578",
        reason: pr
          ? "Head of an open pull request under review; the work on it reaches neither integration line."
          : "Contained in both dev and main with no commit reaching neither line, and no pull request has ever used it as a head."
      };
    })
  };
};
