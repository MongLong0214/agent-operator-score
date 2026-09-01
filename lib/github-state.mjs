import { spawnSync } from "node:child_process";

import { COMPLETION_SCHEMA, SNAPSHOT_SCHEMA } from "./execution-plan.mjs";

// Reading GitHub as a snapshot, so that the checks do not care where the answer came from.
//
// The suite runs offline against a committed fixture and the release audit runs against the live
// API, and both have to be the *same* comparison -- a live path with looser rules is how a release
// passes an audit the suite would have failed.
//
// What this module adds beyond fetching is that it does not believe a completion record, and does
// not believe three separately true facts either. A SHA that exists, a merged pull request and a
// successful workflow run can all be real and have nothing to do with each other; the record is
// only confirmed when they are the *same* piece of work. So the pull request must be the one whose
// merge produced that commit, and the runs must have executed on a commit belonging to it.

export { SNAPSHOT_SCHEMA };

/** Repository roles that can actually push. `COLLABORATOR` alone does not imply any of them. */
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

const token = () => {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim();
  return null;
};

/** The live transport. Injectable so the tests can exercise the logic without the network. */
export const httpGet = async (path, auth) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "agent-operator-score-execution-audit",
      ...(auth ? { authorization: `Bearer ${auth}` } : {})
    }
  });
  if (!response.ok) {
    const error = new Error(`GitHub ${path} -> ${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return { body: await response.json(), link: response.headers.get("link") };
};

/**
 * Every page, following the Link header until GitHub says there is no next one.
 *
 * A fixed page bound is a silent truncation dressed as a limit: with it, "the last record wins"
 * quietly becomes "the last record within the bound wins", and the correction posted after it is
 * never seen. The guard rail here is a very high ceiling that *fails* rather than returning short.
 */
export const requestAll = async (path, auth, get = httpGet) => {
  const out = [];
  let next = `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=1`;
  for (let page = 1; ; page += 1) {
    if (page > 1000) throw new Error(`${path}: more pages than this audit will read`);
    const { body, link } = await get(next, auth);
    if (!Array.isArray(body)) break;
    out.push(...body);
    const following = /<([^>]+)>;\s*rel="next"/.exec(link ?? "");
    if (!following) break;
    next = following[1].replace(/^https:\/\/api\.github\.com/, "");
  }
  return out;
};

/**
 * The one completion record an issue is closed on.
 *
 * Only a fenced block that names the schema counts, and only from someone who can actually push to
 * the repository. Prose that says "done" is not a record; a link to a PR is not a record; a record
 * from an account that merely has permission to comment is not an attestation. This is the only
 * place the audit reads free text, and it reads it for an exact typed object rather than for a
 * judgement about what the author meant.
 *
 * Sources arrive in chronological order and the last record wins, so a later correction supersedes
 * an earlier pass. An untrusted author cannot overwrite a trusted record, but the attempt is kept.
 */
export function parseCompletionRecord(sources) {
  let found = null;
  for (const source of sources) {
    const text = typeof source === "string" ? source : source?.body;
    if (typeof text !== "string") continue;
    const trusted = typeof source === "string" ? true : source.author_trusted === true;
    for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)) {
      let parsed;
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object" || parsed.schema !== COMPLETION_SCHEMA) continue;
      if (found?.author_trusted === true && !trusted) {
        found = { ...found, contested_by: source?.author ?? null };
        continue;
      }
      found = { ...parsed, author: source?.author ?? null, author_trusted: trusted };
    }
  }
  return found;
}

/**
 * Does this account have push access, asked of the repository rather than inferred.
 *
 * `author_association: "COLLABORATOR"` was the previous answer and it is not one: the association
 * says a person is a collaborator, not what they may do. A collaborator with the read or triage
 * role would have attested to completed work.
 */
export async function hasWriteAccess(repository, login, { auth, get = httpGet, cache = new Map() } = {}) {
  if (!login) return false;
  if (cache.has(login)) return cache.get(login);
  let allowed = false;
  try {
    const { body } = await get(`/repos/${repository}/collaborators/${encodeURIComponent(login)}/permission`, auth);
    allowed = WRITE_PERMISSIONS.has(body.permission);
  } catch {
    // A 403 or 404 here means the audit could not establish write access, and "could not
    // establish" is not "has it".
    allowed = false;
  }
  cache.set(login, allowed);
  return allowed;
}

const markerIn = (body, markers) => markers.find((marker) => typeof body === "string" && body.includes(marker)) ?? null;

/**
 * Puts a completion record back to the repository, as one claim rather than three.
 *
 * Independently true facts are easy to come by: `dev` has hundreds of commits, the repository has
 * merged pull requests, and CI has succeeded thousands of times. What is hard to fabricate is a
 * pull request whose merge produced *this* commit, closing *this* issue, with runs that executed on
 * a commit belonging to it. So the parts are cross-bound and every one of them is reported.
 */
export async function verifyCompletionRecord(repository, record, { auth, integrationBranch = "dev", get = httpGet } = {}) {
  const checked = {
    commit_exists: false,
    commit_on_integration_branch: false,
    pr_merged: false,
    pr_targets_integration_branch: false,
    pr_closes_issue: false,
    pr_produced_the_commit: false,
    ci_runs_succeeded: false,
    ci_runs_ran_on_this_work: false
  };
  if (!record) return { ...checked, verified: false };

  try {
    await get(`/repos/${repository}/commits/${record.final_sha}`, auth);
    checked.commit_exists = true;
    const { body: comparison } = await get(`/repos/${repository}/compare/${record.final_sha}...${integrationBranch}`, auth);
    // `identical` is the SHA at the branch tip; `ahead` means the branch has moved on from it.
    // `behind` and `diverged` both mean the recorded commit is not on the branch that ships.
    checked.commit_on_integration_branch = comparison.status === "identical" || comparison.status === "ahead";
  } catch {
    // Left false. A SHA the repository does not have is exactly the failure this looks for.
  }

  let pull = null;
  try {
    ({ body: pull } = await get(`/repos/${repository}/pulls/${record.pr}`, auth));
    checked.pr_merged = pull.merged_at !== null;
    checked.pr_targets_integration_branch = pull.base?.ref === integrationBranch;
    checked.pr_closes_issue = new RegExp(`\\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\\s+#${record.issue}\\b`, "i").test(pull.body ?? "");
    // The binding. Without it, any merged pull request whose body happens to close this issue
    // vouched for any commit that happened to be on the branch.
    checked.pr_produced_the_commit = pull.merge_commit_sha === record.final_sha || pull.head?.sha === record.final_sha;
  } catch {
    // Left false.
  }

  try {
    const belonging = new Set([record.final_sha, pull?.merge_commit_sha, pull?.head?.sha].filter(Boolean));
    const runs = [];
    for (const id of record.ci_run_ids ?? []) {
      const { body } = await get(`/repos/${repository}/actions/runs/${id}`, auth);
      runs.push(body);
    }
    checked.ci_runs_succeeded = runs.length > 0 && runs.every((one) => one.conclusion === "success");
    checked.ci_runs_ran_on_this_work = runs.length > 0 && runs.every((one) => belonging.has(one.head_sha));
  } catch {
    // Left false.
  }

  return { ...checked, verified: Object.values(checked).every(Boolean) };
}

/** Reads the live issues the plan names and returns them in snapshot shape. */
export async function fetchGithubState(plan, { auth = token(), integrationBranch = plan.integration_branch ?? "dev", verify = true, get = httpGet } = {}) {
  // The contract's excluded issues are read whether or not the plan still lists them, so a plan
  // that quietly dropped one cannot also make it invisible to the check.
  const numbers = [...new Set([...plan.issues.map((one) => one.issue), ...plan.excluded_issues, 579, 580, 581])];
  const markers = [plan.epic_body_marker, plan.body_marker];
  const writeAccess = new Map();
  const issues = [];

  const trust = async (login) => hasWriteAccess(plan.repository, login, { auth, get, cache: writeAccess });

  for (const number of numbers) {
    let issue;
    try {
      ({ body: issue } = await get(`/repos/${plan.repository}/issues/${number}`, auth));
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
    const comments = issue.comments > 0 ? await requestAll(`/repos/${plan.repository}/issues/${number}/comments`, auth, get) : [];
    const sources = [{ body: issue.body, author: issue.user?.login ?? null }, ...comments.map((one) => ({ body: one.body, author: one.user?.login ?? null }))];
    for (const source of sources) source.author_trusted = await trust(source.author);
    const record = parseCompletionRecord(sources);

    issues.push({
      number,
      title: issue.title,
      state: issue.state,
      state_reason: issue.state_reason ?? null,
      labels: (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)).sort(),
      milestone: issue.milestone?.number ?? null,
      body_marker: markerIn(issue.body, markers),
      close_evidence: record,
      close_evidence_checked:
        verify && issue.state === "closed" && record
          ? await verifyCompletionRecord(plan.repository, record, { auth, integrationBranch, get })
          : null,
      closing_references: comments
        .flatMap((one) => (one.body ?? "").match(/#\d+/g) ?? [])
        .filter((value, index, all) => all.indexOf(value) === index)
    });
  }

  return {
    schema: SNAPSHOT_SCHEMA,
    repository: plan.repository,
    captured_at: new Date().toISOString(),
    source: "live",
    integration_branch: integrationBranch,
    issues: issues.sort((a, b) => a.number - b.number)
  };
}
