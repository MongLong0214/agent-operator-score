import { spawnSync } from "node:child_process";

import { COMPLETION_SCHEMA } from "./execution-plan.mjs";

// Reading GitHub as a snapshot, so that the checks do not care where the answer came from.
//
// The suite runs offline against a committed fixture and the release audit runs against the live
// API, and both have to be the *same* comparison -- a live path with looser rules is how a release
// passes an audit the suite would have failed.

export const SNAPSHOT_SCHEMA = "aos-github-issue-state.v1";

const token = () => {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  const gh = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  if (gh.status === 0 && gh.stdout.trim()) return gh.stdout.trim();
  return null;
};

const api = async (path, auth) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "agent-operator-score-execution-audit",
      ...(auth ? { authorization: `Bearer ${auth}` } : {})
    }
  });
  if (!response.ok) throw new Error(`GitHub ${path} -> ${response.status} ${response.statusText}`);
  return response.json();
};

/**
 * The one completion record an issue is closed on.
 *
 * The last one wins, and only a fenced block that names the schema counts. Prose that says "done"
 * is not a record; a link to a PR is not a record. This is the only place the audit reads free
 * text, and it reads it for an exact typed object rather than for a judgement about what the
 * author meant -- an audit that has to interpret a comment is an audit an LLM can talk out of.
 */
export function parseCompletionRecord(texts) {
  let found = null;
  for (const text of texts) {
    if (typeof text !== "string") continue;
    for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)) {
      let parsed;
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        continue;
      }
      if (parsed && typeof parsed === "object" && parsed.schema === COMPLETION_SCHEMA) found = parsed;
    }
  }
  return found;
}

const markerIn = (body, markers) => markers.find((marker) => typeof body === "string" && body.includes(marker)) ?? null;

/** Reads the live issues the plan names and returns them in snapshot shape. */
export async function fetchGithubState(plan, { auth = token() } = {}) {
  const numbers = [...plan.issues.map((one) => one.issue), ...plan.excluded_issues];
  const markers = [plan.epic_body_marker, plan.body_marker];
  const issues = [];

  for (const number of numbers) {
    let issue;
    try {
      issue = await api(`/repos/${plan.repository}/issues/${number}`, auth);
    } catch (error) {
      if (String(error.message).includes("404")) continue;
      throw error;
    }
    const comments = issue.comments > 0 ? await api(`/repos/${plan.repository}/issues/${number}/comments?per_page=100`, auth) : [];
    issues.push({
      number,
      title: issue.title,
      state: issue.state,
      labels: (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)).sort(),
      milestone: issue.milestone?.number ?? null,
      body_marker: markerIn(issue.body, markers),
      close_evidence: parseCompletionRecord([issue.body, ...comments.map((one) => one.body)]),
      closing_references: comments
        .filter((one) => /#\d+/.test(one.body ?? ""))
        .flatMap((one) => (one.body.match(/#\d+/g) ?? []))
        .filter((value, index, all) => all.indexOf(value) === index)
    });
  }

  return {
    schema: SNAPSHOT_SCHEMA,
    repository: plan.repository,
    captured_at: new Date().toISOString(),
    source: "live",
    issues: issues.sort((a, b) => a.number - b.number)
  };
}
