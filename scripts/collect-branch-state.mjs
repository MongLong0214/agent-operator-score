#!/usr/bin/env node
// The live half of #572's cleanup gate.
//
// The audit is a document, and a document cannot observe anything. Everything a deletion decision
// turns on -- which refs exist, which pull requests are open, what protection and the rulesets say,
// what the published install source is, and every graph fact asserted about a branch -- is state
// that moves while the document sits still. So this collector, and not the audit, is where those
// facts enter: it runs each read-only command and records the command line, exit code, byte count
// and a SHA-256 of its raw stdout beside the answer.
//
// Three properties are load-bearing, and each was absent in an earlier version of this file.
//
// *Every asserted derivation is collected here.* It is not enough to receipt a neighbouring query.
// If a branch record claims it is contained in dev, the `git merge-base --is-ancestor` that decides
// it runs here with its exit code recorded; if it claims nothing in the tree refers to it, the
// `git grep` that establishes that runs here too. A claim whose command was never run is a claim
// nobody made.
//
// *Every list is enumerated to the end.* `per_page=100` without pagination turns a pull request on
// the second page into an absent pull request, and the deletion gate reads absence as "no PR open".
// So the list endpoints paginate, and the search endpoint compares what it received against the
// count the API reports and refuses to pretend otherwise.
//
// *The digest covers the content, recursively.* `JSON.stringify(value, Object.keys(value))` looks
// like a canonicaliser and is not: an array replacer is a key allowlist applied at every level, so
// nested objects come back as `{}` and every head, pull request and receipt in the record hashes to
// the same digest as any other. `canonicalize` below is the real thing.
//
// What none of this can do is prove the observation came from GitHub rather than a text editor. An
// offline checker cannot authenticate a transcript. That is why `liveEligibility` in
// scripts/branch-audit.mjs refuses to name anything eligible without a freshly collected observation,
// and why the receipts exist -- so a human or a credentialed job can re-run any line and compare
// digests before acting on one.
//
// Read-only by construction. Every command below reads; none creates, deletes or updates a ref.

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

import { sha256Bytes } from "../lib/digest.mjs";

export const OBSERVATION_SCHEMA = "aos-branch-live-observation.v3";

/** The files that decide how someone installs this project. A cleanup may not change them. */
export const INSTALL_SOURCE_FILES = Object.freeze([".claude-plugin/marketplace.json", ".claude-plugin/plugin.json"]);

/** The derivations a branch record is allowed to assert. Each one is a command run here. */
export const REQUIRED_DERIVATIONS = Object.freeze([
  "last_commit",
  "ancestor_of_dev",
  "ancestor_of_main",
  "unique_vs_dev",
  "unique_vs_main",
  "behind_dev",
  "behind_main",
  "unique_vs_dev_and_main",
  // The commits themselves, not only how many. A SUPERSEDED record accounts for every commit that
  // reaches neither integration line, and a count cannot say whether the ids it lists are those
  // commits: eighteen zero-padded strings satisfy a count of eighteen.
  "unique_commit_ids_vs_dev_and_main",
  "tags_containing",
  "tree_scan",
  "pr_history"
]);

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");

/**
 * Key-ordered, recursive JSON. Two structurally equal values canonicalize identically whatever order
 * they were assembled in, and any difference anywhere changes the output.
 */
export const canonicalize = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
};

export const contentDigest = (value) => sha256Bytes(Buffer.from(canonicalize(value), "utf8"));

/** Stable identity for an observation: everything in it except the digest field naming it. */
export const observationDigest = (observation) => {
  const { digest: _named, ...rest } = observation;
  return contentDigest(rest);
};

/**
 * Runs one read-only command and keeps the bytes it produced, not only what was parsed out of them.
 *
 * `allowExit` exists because some of these commands answer with their exit status:
 * `git merge-base --is-ancestor` returns 1 for "no", and `git grep` returns 1 for "no matches". A
 * non-zero exit that is the answer is recorded; any other non-zero exit throws.
 */
const receipted = (receipts, source, command, args, { allowExit = [0], ...options } = {}) => {
  const result = spawnSync(command, args, { encoding: "buffer", ...options });
  const stdout = result.stdout ?? Buffer.alloc(0);
  receipts.push({
    source,
    command: [command, ...args].join(" "),
    exit_code: result.status,
    bytes: stdout.length,
    digest: sha256Bytes(stdout)
  });
  if (!allowExit.includes(result.status)) {
    const stderr = (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim().split("\n").slice(-3).join(" ");
    throw new Error(`${source}: \`${[command, ...args].join(" ")}\` exited ${result.status}: ${stderr}`);
  }
  return { text: stdout.toString("utf8"), status: result.status, source };
};

/**
 * A list endpoint read to the end.
 *
 * `--paginate --slurp` returns one array element per page; flattening it is the complete list. The
 * receipt covers the raw bytes of every page together, so a truncated read cannot digest the same
 * as a complete one.
 *
 * `complete` is returned rather than assumed. A caller that reads a bounded slice -- `--limit`, a
 * single page, a search cut off at its cap -- has not established that what it did not see is not
 * there, and the difference has to survive into the record for a consumer to refuse it. Every caller
 * here reads to the end; the flag exists so that one which stops early cannot be mistaken for one
 * that found nothing.
 */
const apiList = (receipts, source, path) => {
  // A successful `gh api` always emits JSON. Empty stdout is a command that produced nothing, and
  // reading it as an empty list is how "no pull request is open on this branch" gets manufactured
  // out of silence -- which authorized a real deletion of an open PR's head.
  const body = receipted(receipts, source, "gh", ["api", "--paginate", "--slurp", path]).text.trim();
  if (body === "") throw new Error(`${source}: the request succeeded but returned nothing, which is not an empty list`);
  const pages = JSON.parse(body);
  if (!Array.isArray(pages)) throw new Error(`${source}: expected one array element per page`);
  return { items: pages.flat(), complete: true };
};

const apiOne = (receipts, source, path) => {
  const body = receipted(receipts, source, "gh", ["api", path]).text.trim();
  if (body === "") throw new Error(`${source}: the request succeeded but returned nothing`);
  return JSON.parse(body);
};

/**
 * The GitHub search endpoint, with its own completeness proof.
 *
 * Search pages report `total_count` and `incomplete_results`, so unlike an ordinary list this one
 * can say whether it returned everything. It is recorded either way: a sweep that was truncated is
 * a sweep that did not establish "nothing refers to this branch".
 */
const apiSearch = (receipts, source, query) => {
  const body = receipted(receipts, source, "gh", ["api", "--paginate", "--slurp", `search/issues?q=${encodeURIComponent(query)}&per_page=100`]).text.trim();
  if (body === "") throw new Error(`${source}: the search succeeded but returned nothing, which is not "no results"`);
  const pages = JSON.parse(body);
  // No page at all is not "no results". `--paginate --slurp` emits one element per HTTP page and a
  // search that matched nothing still returns one page saying `total_count: 0`, so an empty array
  // is a read that did not happen -- and resolving it to `{complete: true, total_count: 0}` would
  // manufacture "nothing on GitHub refers to this branch" out of silence, in the one function whose
  // job is to say whether the sweep established anything.
  if (!Array.isArray(pages) || pages.length === 0) throw new Error(`${source}: the search returned no page at all, which is not a complete sweep with no results`);
  const items = pages.flatMap((page) => page.items ?? []);
  const totalCount = pages[0].total_count;
  return {
    query,
    complete: items.length === totalCount && !pages.some((page) => page.incomplete_results),
    total_count: totalCount,
    hits: items.map((item) => ({ number: item.number, is_pull_request: item.pull_request != null, state: item.state, title: item.title }))
  };
};

/**
 * Collect everything a deletion decision reads, from the live repository, in one pass.
 *
 * One pass matters: an earlier version collected the head list, then collected again to sweep the
 * names it had found, so a branch created between the two passes was swept by neither. The branch
 * names come from the head list this same call took.
 *
 * `repository` builds the API paths; the git half uses the checkout's `origin`, so the two head
 * lists are independent sources for the same question rather than one source read twice.
 */
export const collect = ({ repository, cwd = process.cwd() } = {}) => {
  const receipts = [];
  const collectedAt = nowIso();

  const heads = receipted(receipts, "git-ls-remote", "git", ["ls-remote", "--heads", "origin"], { cwd }).text
    .split("\n").filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split(/\s+/u);
      return { name: ref.replace("refs/heads/", ""), sha };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const restHeads = apiList(receipts, "rest-branches", `repos/${repository}/branches?per_page=100`).items
    .map((branch) => ({ name: branch.name, sha: branch.commit.sha, protected: branch.protected }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const openPrs = apiList(receipts, "rest-open-prs", `repos/${repository}/pulls?state=open&per_page=100`).items
    .map((pr) => ({ number: pr.number, head_branch: pr.head.ref, head_sha: pr.head.sha, base: pr.base.ref, state: "OPEN" }))
    .sort((a, b) => a.number - b.number);

  const tags = [...receipted(receipts, "git-ls-remote-tags", "git", ["ls-remote", "--tags", "origin"], { cwd }).text
    .split("\n").filter(Boolean)
    .reduce((map, line) => {
      const [sha, ref] = line.split(/\s+/u);
      const name = ref.replace("refs/tags/", "");
      if (name.endsWith("^{}")) map.get(name.slice(0, -3)).commit_sha = sha;
      else map.set(name, { name, ref_sha: sha, commit_sha: sha });
      return map;
    }, new Map()).values()].sort((a, b) => a.name.localeCompare(b.name));

  // The whole protection object, not three booleans out of it. A projection cannot report that a
  // field it never carried has changed.
  const protection = Object.fromEntries(
    ["main", "dev"].map((ref) => [ref, apiOne(receipts, `rest-protection-${ref}`, `repos/${repository}/branches/${ref}/protection`)])
  );

  const rulesets = apiList(receipts, "rest-rulesets", `repos/${repository}/rulesets?per_page=100`).items;
  const repo = apiOne(receipts, "rest-repo", `repos/${repository}`);
  const settings = { default_branch: repo.default_branch, delete_branch_on_merge: repo.delete_branch_on_merge };

  // Read by repository-relative path, and reported by it too: an ENOENT carries the absolute path it
  // tried, which on a real checkout is somebody's home directory, and these messages end up in
  // findings that get committed and rendered.
  const read = (path) => {
    try {
      return readFileSync(`${cwd}/${path}`);
    } catch (error) {
      throw new Error(`${path}: ${error.code ?? "could not be read"}`);
    }
  };
  const installSource = {
    files: INSTALL_SOURCE_FILES.map((path) => ({ path, digest: sha256Bytes(read(path)) })),
    package: (() => {
      const pkg = JSON.parse(read("package.json").toString("utf8"));
      return { name: pkg.name, bin: pkg.bin, files: pkg.files };
    })()
  };

  const owner = repository.split("/")[0];
  const devSha = heads.find((head) => head.name === "dev")?.sha;
  const mainSha = heads.find((head) => head.name === "main")?.sha;

  // Every graph fact a branch record is allowed to assert, derived here, each with its own receipt.
  // Fetching first, because a fact about a commit the checkout does not have is not a fact.
  const auditable = heads.filter((head) => head.name !== "main" && head.name !== "dev");
  // Fetch the objects, never a ref: `git fetch <sha>` writes to the object store and leaves every
  // local ref where it was. An earlier version ran `--tags --force`, which rewrites local tags -- a
  // write, in a collector whose whole claim is that it only reads.
  const wanted = [...new Set([...heads.map((head) => head.sha), ...tags.map((tag) => tag.commit_sha)])];
  if (wanted.length > 0) receipted(receipts, "git-fetch-observed", "git", ["fetch", "-q", "origin", ...wanted], { cwd });

  // `Number("")` is 0, so empty stdout would read as "no commits unique to this branch" -- the same
  // absence-as-success shape, on the count the deletion decision turns on.
  const count = (source, args) => {
    const text = receipted(receipts, source, "git", ["rev-list", "--count", ...args], { cwd }).text.trim();
    // Not claimed as a mutation guard: git cannot be made to exit 0 with empty stdout here from an
    // offline test, so a mutant survives for want of a way to reach it rather than for want of a
    // rule. `Number("")` is 0, which would read as no commits unique to the branch.
    if (!/^\d+$/u.test(text)) throw new Error(`${source}: rev-list --count returned ${JSON.stringify(text)}, not a count`);
    return Number(text);
  };
  const derivations = Object.fromEntries(auditable.map(({ name, sha }) => {
    const log = receipted(receipts, `git-log-${name}`, "git", ["log", "-1", "--format=%cI%x09%an%x09%ae", sha], { cwd }).text.trim().split("\t");
    // Against the integration line, not this checkout's HEAD: "nothing in the tree refers to this
    // branch" is a claim about the repository, and a collector run from some other branch would
    // otherwise miss a reference that is on dev.
    const grep = receipted(receipts, `git-grep-${name}`, "git", ["grep", "-n", "--fixed-strings", name, devSha, "--", ":!docs/STALE_BRANCH_AUDIT.md", ":!fixtures/stale-branches/"], { cwd, allowExit: [0, 1] });
    const prs = apiList(receipts, `pr-history-${name}`, `repos/${repository}/pulls?state=all&head=${owner}:${name}&per_page=100`);
    return [name, {
      last_commit: { date: log[0], author_name: log[1], author_email: log[2], source: `git-log-${name}` },
      ancestor_of_dev: { value: receipted(receipts, `is-ancestor-dev-${name}`, "git", ["merge-base", "--is-ancestor", sha, devSha], { cwd, allowExit: [0, 1] }).status === 0, source: `is-ancestor-dev-${name}` },
      ancestor_of_main: { value: receipted(receipts, `is-ancestor-main-${name}`, "git", ["merge-base", "--is-ancestor", sha, mainSha], { cwd, allowExit: [0, 1] }).status === 0, source: `is-ancestor-main-${name}` },
      unique_vs_dev: { value: count(`rev-list-dev-${name}`, [`${devSha}..${sha}`]), source: `rev-list-dev-${name}` },
      unique_vs_main: { value: count(`rev-list-main-${name}`, [`${mainSha}..${sha}`]), source: `rev-list-main-${name}` },
      behind_dev: { value: count(`rev-list-behind-dev-${name}`, [`${sha}..${devSha}`]), source: `rev-list-behind-dev-${name}` },
      behind_main: { value: count(`rev-list-behind-main-${name}`, [`${sha}..${mainSha}`]), source: `rev-list-behind-main-${name}` },
      // Neither difference alone answers "what would be lost": a commit on dev but not main is still
      // elsewhere. This is the count deletion turns on.
      unique_vs_dev_and_main: { value: count(`rev-list-neither-${name}`, [sha, "--not", devSha, mainSha]), source: `rev-list-neither-${name}` },
      // The same question asked for its answer rather than its size, so a record that claims to
      // account for these commits can be compared against them. `git rev-list` exits 0 with empty
      // stdout when nothing reaches neither line, which is the honest empty rather than a silence:
      // the receipt records the exit status beside it.
      unique_commit_ids_vs_dev_and_main: {
        value: receipted(receipts, `rev-list-ids-neither-${name}`, "git", ["rev-list", sha, "--not", devSha, mainSha], { cwd }).text.split("\n").filter(Boolean),
        source: `rev-list-ids-neither-${name}`
      },
      // Derived against the tag commits `git ls-remote --tags origin` reported, one ancestry test per
      // tag. `git tag --contains` would answer from the local tag set instead, which is neither the
      // repository's nor stable across checkouts.
      // One ancestry test per tag decides this, so one receipt cannot be its source. It cited the
      // receipt for whichever tag sorted first -- a command that had answered "not contained" while
      // the value it was cited for listed seven tags it is contained in. The citation is the whole
      // comparison now: every tag's receipt, including the ones that answered no, because the tags
      // that are absent from the value are established by exactly those.
      tags_containing: {
        value: tags
          .filter((tag) => receipted(receipts, `tag-contains-${tag.name}-${name}`, "git", ["merge-base", "--is-ancestor", sha, tag.commit_sha], { cwd, allowExit: [0, 1] }).status === 0)
          .map((tag) => tag.name)
          .sort(),
        source: tags.map((tag) => `tag-contains-${tag.name}-${name}`)
      },
      tree_scan: { value: grep.text.split("\n").filter(Boolean).map((line) => line.split(":").slice(0, 2).join(":")), source: `git-grep-${name}` },
      pr_history: {
        value: prs.items.map((pr) => ({ number: pr.number, state: pr.state.toUpperCase(), merged_at: pr.merged_at, base: pr.base.ref, head_sha: pr.head.sha })),
        complete: prs.complete,
        source: `pr-history-${name}`
      }
    }];
  }));

  const referenceSweep = auditable.map(({ name }) => ({ branch: name, ...apiSearch(receipts, `search-${name}`, `repo:${repository} "${name}"`) }));

  return {
    schema: OBSERVATION_SCHEMA,
    repository,
    collected_at: collectedAt,
    collector: "scripts/collect-branch-state.mjs",
    heads,
    rest_heads: restHeads,
    open_prs: openPrs,
    tags,
    protection,
    rulesets,
    settings,
    install_source: installSource,
    derivations,
    reference_sweep: referenceSweep,
    receipts
  };
};

/**
 * The receipts a derivation names as its source.
 *
 * A derivation decided by one command cites a string; one decided by a command per candidate -- tag
 * containment is the only such derivation today -- cites the list. Both spellings normalise here so
 * that no consumer has to know which is which, and an unusable citation normalises to nothing rather
 * than to something that happens to be present.
 */
export const citedSources = (derivation) => {
  const source = derivation?.source;
  if (typeof source === "string") return [source];
  if (Array.isArray(source)) return source.filter((one) => typeof one === "string");
  return [];
};

/** The tag a per-tag containment receipt answered about, recovered from the name it was given. */
const tagOfContainmentSource = (source, branch) => {
  const prefix = "tag-contains-";
  const suffix = `-${branch}`;
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) return null;
  return source.slice(prefix.length, source.length - suffix.length);
};

/**
 * Whether the commands a derivation cites actually answered what the derivation records.
 *
 * A receipt that exists is not a receipt that agrees. `tags_containing` cited a `merge-base
 * --is-ancestor` whose recorded exit status was 1 -- "not contained" -- for a value listing seven
 * tags the branch *is* contained in, and every check passed, because one of them asked only whether
 * the named receipt was present and the other compared the record against the same record. So the
 * exit status of each cited command is compared against the answer it is cited for, in both
 * directions: a listed tag whose receipt said no, and an omitted tag whose receipt said yes.
 */
const derivationAnswerFindings = (branch, derivation, receiptBySource) => {
  const findings = [];
  for (const [field, line] of [["ancestor_of_dev", "dev"], ["ancestor_of_main", "main"]]) {
    const one = derivation[field];
    const receipt = receiptBySource.get(citedSources(one)[0]);
    if (!one || !receipt || typeof receipt.exit_code !== "number") continue;
    if ((receipt.exit_code === 0) !== (one.value === true)) {
      findings.push(`${branch}: ${field} records ${JSON.stringify(one.value)} but the ancestry test it cites exited ${receipt.exit_code}`);
    }
  }

  const containment = derivation.tags_containing;
  if (!containment || !Array.isArray(containment.value)) return findings;
  const listed = new Set(containment.value);
  const answered = new Set();
  for (const source of citedSources(containment)) {
    const receipt = receiptBySource.get(source);
    const tag = tagOfContainmentSource(source, branch);
    if (!receipt || tag === null || typeof receipt.exit_code !== "number") continue;
    answered.add(tag);
    const contained = receipt.exit_code === 0;
    if (contained !== listed.has(tag)) {
      findings.push(`${branch}: release-tag containment ${listed.has(tag) ? "lists" : "omits"} ${tag} but the ancestry test it cites for it exited ${receipt.exit_code}`);
    }
  }
  for (const tag of listed) {
    if (!answered.has(tag)) findings.push(`${branch}: release-tag containment lists ${tag} without citing the ancestry test that established it`);
  }
  return findings;
};

/**
 * What an observation has to look like before anything is decided on it.
 *
 * Shape only -- this cannot tell a collected transcript from a written one, and says so. What it
 * does establish is that the record is internally consistent: the digest names its own content, the
 * receipts exist and succeeded, every derivation cites a receipt that is actually present, that
 * cited receipt's own answer is the one the derivation records, and no reference sweep silently
 * returned a truncated page.
 */
export const verifyObservation = (observation) => {
  const findings = [];
  if (!observation) return ["there is no observation"];
  if (observation.schema !== OBSERVATION_SCHEMA) findings.push(`the observation is "${observation.schema}", not ${OBSERVATION_SCHEMA}`);
  if (!Array.isArray(observation.receipts) || observation.receipts.length === 0) return [...findings, "the observation carries no command receipts, so nothing says where its facts came from"];

  const sources = new Set();
  const receiptBySource = new Map();
  for (const receipt of observation.receipts) {
    if (typeof receipt.command !== "string" || receipt.command.length < 5) findings.push("a receipt does not say what was run");
    if (!/^sha256:[0-9a-f]{64}$/u.test(receipt.digest ?? "")) findings.push(`${receipt.command}: no digest of what it returned`);
    if (typeof receipt.exit_code !== "number") findings.push(`${receipt.command}: no exit code`);
    sources.add(receipt.source);
    receiptBySource.set(receipt.source, receipt);
  }
  for (const [branch, derivation] of Object.entries(observation.derivations ?? {})) {
    for (const field of REQUIRED_DERIVATIONS) {
      const one = derivation[field];
      if (!one) {
        findings.push(`${branch}: the observation derives no ${field}`);
        continue;
      }
      const cited = citedSources(one);
      // A derivation citing nothing is the shape the receipts exist to refuse, and `sources.has`
      // over an absent field would have looked like a single missing receipt rather than none.
      if (cited.length === 0) findings.push(`${branch}: ${field} names no receipt at all, so nothing says where it came from`);
      for (const source of cited) {
        if (!sources.has(source)) findings.push(`${branch}: ${field} cites receipt "${source}", which the observation does not carry`);
      }
    }
    findings.push(...derivationAnswerFindings(branch, derivation, receiptBySource));
  }
  for (const sweep of observation.reference_sweep ?? []) {
    if (sweep.complete !== true) findings.push(`${sweep.branch}: the reference sweep returned ${sweep.hits.length} of ${sweep.total_count} results, so "nothing refers to it" was not established`);
  }
  for (const [branch, derivation] of Object.entries(observation.derivations ?? {})) {
    if (derivation.pr_history && derivation.pr_history.complete !== true) {
      findings.push(`${branch}: the pull request history was read as a bounded slice, so "no pull request ever used this branch as a head" was not established`);
    }
  }
  // Omission is not observation. A gate that reads `open_prs ?? []` treats a missing family as an
  // empty one, so the families every decision reads have to be present before any of it is believed.
  for (const family of ["heads", "rest_heads", "open_prs", "tags", "rulesets", "reference_sweep"]) {
    if (!Array.isArray(observation[family])) findings.push(`the observation records no ${family}, which is not the same as observing none`);
  }
  for (const ref of ["main", "dev"]) {
    if (!observation.protection?.[ref]) findings.push(`the observation records no protection for ${ref}`);
  }
  if (!observation.settings || !observation.install_source) findings.push("the observation records no repository settings or install source");

  for (const branch of (observation.heads ?? []).map((head) => head.name)) {
    if (branch === "main" || branch === "dev") continue;
    if (!observation.derivations?.[branch]) findings.push(`${branch} is on the repository but the observation derives nothing about it`);
  }
  return findings;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const repository = process.argv[2] ?? "MongLong0214/agent-operator-score";
  const out = process.argv[3];
  const observation = collect({ repository });
  observation.digest = observationDigest(observation);
  const findings = verifyObservation(observation);
  if (findings.length > 0) {
    console.error(`the observation does not hold its own shape:\n  ${findings.join("\n  ")}`);
    process.exit(1);
  }
  const text = `${JSON.stringify(observation, null, 2)}\n`;
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}
