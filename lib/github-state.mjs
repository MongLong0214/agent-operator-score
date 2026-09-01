import { spawnSync } from "node:child_process";

import { COMPLETION_SCHEMA, SNAPSHOT_SCHEMA } from "./execution-plan.mjs";

// Reading GitHub as a snapshot, so that the checks do not care where the answer came from.
//
// The suite runs offline against a committed fixture and the release audit runs against the live
// API, and both have to be the *same* comparison -- a live path with looser rules is how a release
// passes an audit the suite would have failed.
//
// What this module adds beyond fetching is that it does not believe a completion record. Forty hex
// characters, a positive integer and a non-empty array are things a fabricated record has too. So
// each claim is put back to the repository -- is that SHA an ancestor of the integration branch,
// was that pull request merged, did those workflow runs succeed -- and the answers travel into the
// snapshot as booleans. The offline audit then compares against facts that were established rather
// than against assertions that were typed.

export { SNAPSHOT_SCHEMA };

/** Who is allowed to close an issue on the record. Anyone can comment; not everyone can attest. */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const token = () => {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim();
  return null;
};

const request = async (path, auth) => {
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
  return response.json();
};

/**
 * Every page, not the first hundred.
 *
 * A single `per_page=100` read meant "the last record wins" silently became "the last record on
 * page one wins", so a corrective HOLD posted after a hundred comments would never be seen.
 */
const requestAll = async (path, auth) => {
  const out = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await request(`${path}${separator}per_page=100&page=${page}`, auth);
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
};

/**
 * The one completion record an issue is closed on.
 *
 * Only a fenced block that names the schema counts, and only from someone with write access to the
 * repository. Prose that says "done" is not a record; a link to a PR is not a record; a record from
 * an account that merely has permission to comment is not an attestation. This is the only place
 * the audit reads free text, and it reads it for an exact typed object rather than for a judgement
 * about what the author meant -- an audit that has to interpret a comment is an audit that can be
 * talked out of its verdict.
 *
 * Sources arrive in chronological order and the last record wins, so a later correction supersedes
 * an earlier pass. An untrusted author cannot overwrite a trusted record, but the fact that they
 * tried is reported rather than dropped.
 */
export function parseCompletionRecord(sources) {
  let found = null;
  for (const source of sources) {
    const text = typeof source === "string" ? source : source?.body;
    if (typeof text !== "string") continue;
    const trusted = typeof source === "string" ? true : TRUSTED_ASSOCIATIONS.has(source.author_association);
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

const markerIn = (body, markers) => markers.find((marker) => typeof body === "string" && body.includes(marker)) ?? null;

/**
 * Puts each claim in a completion record back to the repository.
 *
 * Returns booleans, never prose, so the result is a fact the offline audit can check rather than a
 * summary it has to trust.
 */
export async function verifyCompletionRecord(repository, record, { auth, integrationBranch = "dev" } = {}) {
  const checked = { commit_exists: false, commit_on_integration_branch: false, pr_merged: false, pr_closes_issue: false, ci_runs_succeeded: false };
  if (!record) return { ...checked, verified: false };

  try {
    await request(`/repos/${repository}/commits/${record.final_sha}`, auth);
    checked.commit_exists = true;
    const comparison = await request(`/repos/${repository}/compare/${record.final_sha}...${integrationBranch}`, auth);
    // `identical` is the SHA at the branch tip; `ahead` means the branch has moved on from it.
    // `behind` and `diverged` both mean the recorded commit is not on the branch that ships.
    checked.commit_on_integration_branch = comparison.status === "identical" || comparison.status === "ahead";
  } catch {
    // Left false. A SHA the repository does not have is exactly the failure this looks for.
  }

  try {
    const pull = await request(`/repos/${repository}/pulls/${record.pr}`, auth);
    checked.pr_merged = pull.merged_at !== null;
    checked.pr_closes_issue = new RegExp(`\\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed))\\s+#${record.issue}\\b`, "i").test(pull.body ?? "");
  } catch {
    // Left false.
  }

  try {
    const conclusions = [];
    for (const id of record.ci_run_ids ?? []) {
      const run = await request(`/repos/${repository}/actions/runs/${id}`, auth);
      conclusions.push(run.conclusion);
    }
    checked.ci_runs_succeeded = conclusions.length > 0 && conclusions.every((one) => one === "success");
  } catch {
    // Left false.
  }

  return { ...checked, verified: Object.values(checked).every(Boolean) };
}

/** Reads the live issues the plan names and returns them in snapshot shape. */
export async function fetchGithubState(plan, { auth = token(), integrationBranch = "dev", verify = true } = {}) {
  // The contract's excluded issues are read whether or not the plan still lists them, so a plan
  // that quietly dropped one cannot also make it invisible to the check.
  const numbers = [...new Set([...plan.issues.map((one) => one.issue), ...plan.excluded_issues, 579, 580, 581])];
  const markers = [plan.epic_body_marker, plan.body_marker];
  const issues = [];

  for (const number of numbers) {
    let issue;
    try {
      issue = await request(`/repos/${plan.repository}/issues/${number}`, auth);
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
    const comments = issue.comments > 0 ? await requestAll(`/repos/${plan.repository}/issues/${number}/comments`, auth) : [];
    const record = parseCompletionRecord([
      { body: issue.body, author_association: issue.author_association, author: issue.user?.login ?? null },
      ...comments.map((one) => ({ body: one.body, author_association: one.author_association, author: one.user?.login ?? null }))
    ]);

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
          ? await verifyCompletionRecord(plan.repository, record, { auth, integrationBranch })
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
