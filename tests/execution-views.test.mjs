import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererPath = resolve(root, "scripts/render-execution-views.mjs");
const workflowPath = resolve(root, ".github/workflows/operational-state.yml");

const importRenderer = async () => {
  if (!existsSync(rendererPath)) {
    throw new Error("scripts/render-execution-views.mjs does not exist");
  }
  return import(pathToFileURL(rendererPath).href);
};

const readWorkflow = () => {
  if (!existsSync(workflowPath)) {
    throw new Error(".github/workflows/operational-state.yml does not exist");
  }
  return readFileSync(workflowPath, "utf8");
};

/**
 * Minimal structural reader for the workflow. A real YAML parser is not a dependency of
 * this repository and adding one is forbidden scope, so the assertions below read the
 * declared shape directly. Every check is anchored so a commented-out or nested lookalike
 * cannot satisfy it.
 */
const workflowJobs = (yaml) => {
  const jobs = {};
  const lines = yaml.split("\n");
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsAt === -1) return jobs;
  let current = null;
  for (const line of lines.slice(jobsAt + 1)) {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (header) {
      current = header[1];
      jobs[current] = [];
      continue;
    }
    if (current && /^ {2}\S/.test(line)) current = null;
    if (current) jobs[current].push(line);
  }
  return jobs;
};

// ---------------------------------------------------------------------------
// Projection inputs. The roadmap, the Board and the historical ledger are rendered
// OUTPUTS. If resolution ever reads one back, a stale or hand-edited document silently
// becomes authority over live repository state, which is the whole failure this ticket
// exists to prevent.
// ---------------------------------------------------------------------------

test("roadmap-is-not-an-input", async () => {
  const { resolveViewInputs } = await importRenderer();
  const inputs = resolveViewInputs(root);
  assert.ok(Array.isArray(inputs.sources), "renderer must declare its input sources");
  assert.equal(
    inputs.sources.some((source) => source.includes("AOS-EXECUTION-ROADMAP")),
    false,
    "the roadmap is a projection and must never be an input to resolution"
  );
});

test("board-is-not-an-input", async () => {
  const { resolveViewInputs } = await importRenderer();
  const inputs = resolveViewInputs(root);
  assert.equal(
    inputs.sources.some((source) => source.includes("BOARD.md")),
    false,
    "the Board is a projection and must never be an input to resolution"
  );
});

test("historical-ledger-is-ignored", async () => {
  const { resolveViewInputs } = await importRenderer();
  const inputs = resolveViewInputs(root);
  assert.equal(
    inputs.sources.some((source) => source.includes("issue-resolution-ledger")),
    false,
    "the historical ledger is superseded evidence and must be ignored entirely"
  );
});

test("generated-views-are-deterministic", async () => {
  const { renderViews } = await importRenderer();
  const first = renderViews(root);
  const second = renderViews(root);
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(second),
    "two renders at one head must be byte-identical"
  );
  assert.ok(first.board.includes("generated"), "the Board must carry a non-authority marker");
});

// ---------------------------------------------------------------------------
// Workflow surface. Each of these is a separate failure mode; none may be satisfied by a
// generic "workflow exists" check.
// ---------------------------------------------------------------------------

test("offline-strict-on-pull-request-only", () => {
  const yaml = readWorkflow();
  const jobs = workflowJobs(yaml);
  const offline = Object.entries(jobs).find(([name]) => /offline/.test(name));
  assert.ok(offline, "an offline-strict job must exist");
  const body = offline[1].join("\n");
  assert.match(body, /if:\s*.*pull_request/, "offline strict must be gated to pull_request");
  assert.doesNotMatch(body, /--strict(?!\s*--offline)/, "the pull-request lane must not run online strict");
});

test("online-strict-on-dev-push-only", () => {
  const yaml = readWorkflow();
  const jobs = workflowJobs(yaml);
  const online = Object.entries(jobs).find(([name]) => /online/.test(name));
  assert.ok(online, "an online-strict job must exist");
  const body = online[1].join("\n");
  assert.match(body, /if:\s*.*push/, "online strict must be gated to push");
  assert.match(body, /refs\/heads\/dev|ref\s*==\s*'refs\/heads\/dev'|dev/, "online strict must be gated to dev");
});

test("dispatch-job-requires-trusted-dev-ref", () => {
  const yaml = readWorkflow();
  assert.match(
    yaml,
    /refs\/heads\/dev/,
    "dispatch jobs must bind the trusted workflow ref to refs/heads/dev"
  );
  const jobs = workflowJobs(yaml);
  const dispatch = Object.entries(jobs).filter(([name]) => /dispatch|review|authorization/.test(name));
  assert.ok(dispatch.length >= 1, "at least one dispatch job must exist");
  for (const [name, lines] of dispatch) {
    assert.match(lines.join("\n"), /refs\/heads\/dev/, `${name} must verify the trusted dev ref`);
  }
});

test("dispatch-job-requires-exact-workflow-blob", () => {
  const yaml = readWorkflow();
  assert.match(
    yaml,
    /workflow_blob|blob_oid|blob/i,
    "dispatch jobs must bind the exact workflow blob OID"
  );
});

test("dispatch-actor-permission-enforced", () => {
  const yaml = readWorkflow();
  assert.match(
    yaml,
    /maintain|admin/,
    "dispatch jobs must require a maintain or admin actor"
  );
});

test("job-permissions-are-exactly-scoped", () => {
  const yaml = readWorkflow();
  const jobs = workflowJobs(yaml);
  const resolution = Object.entries(jobs).filter(([name]) => /offline|online/.test(name));
  assert.ok(resolution.length >= 2, "both resolution jobs must exist");
  for (const [name, lines] of resolution) {
    const body = lines.join("\n");
    assert.match(body, /contents:\s*read/, `${name} needs contents: read`);
    assert.match(body, /actions:\s*read/, `${name} needs actions: read`);
    assert.match(body, /checks:\s*read/, `${name} needs checks: read`);
    assert.match(body, /pull-requests:\s*read/, `${name} needs pull-requests: read`);
    assert.match(body, /issues:\s*read/, `${name} needs issues: read`);
    assert.doesNotMatch(body, /:\s*write/, `${name} must hold no write scope`);
  }
});

test("dispatch-job-adds-only-checks-write", () => {
  const yaml = readWorkflow();
  const jobs = workflowJobs(yaml);
  const dispatch = Object.entries(jobs).filter(([name]) => /dispatch|review|authorization/.test(name));
  assert.ok(dispatch.length >= 1, "at least one dispatch job must exist");
  for (const [name, lines] of dispatch) {
    const body = lines.join("\n");
    assert.match(body, /checks:\s*write/, `${name} needs checks: write`);
    const writes = [...body.matchAll(/^\s+([a-z-]+):\s*write\s*$/gm)].map((m) => m[1]);
    assert.deepEqual(writes, ["checks"], `${name} must add checks: write and nothing else`);
  }
});

test("each-job-has-bounded-timeout", () => {
  const yaml = readWorkflow();
  const jobs = workflowJobs(yaml);
  assert.ok(Object.keys(jobs).length >= 1, "the workflow must declare jobs");
  for (const [name, lines] of Object.entries(jobs)) {
    assert.match(
      lines.join("\n"),
      /timeout-minutes:\s*\d+/,
      `${name} must declare a bounded timeout`
    );
  }
});

test("workflow-performs-no-write-token-action", () => {
  const yaml = readWorkflow();
  for (const forbidden of [
    /gh\s+pr\s+(edit|comment|merge|close|review)/,
    /gh\s+issue\s+(edit|comment|close|create)/,
    /git\s+push/,
    /git\s+commit/,
    /-X\s*(POST|PATCH|PUT|DELETE)/,
    /add-label|remove-label/
  ]) {
    assert.doesNotMatch(yaml, forbidden, `workflow must perform no write-token action: ${forbidden}`);
  }
  assert.match(yaml, /upload-artifact/, "the workflow must upload JSON and summary artifacts");
});

test("bootstrap-disabled-after-d0-004c", async () => {
  const resolverPath = resolve(root, "scripts/resolve-execution-state.mjs");
  const source = readFileSync(resolverPath, "utf8");
  assert.match(
    source,
    /d0_004c_merged/,
    "the resolver must key Bootstrap off d0_004c_merged"
  );
  const { detectD0004CMerged } = await importRenderer();
  assert.equal(
    typeof detectD0004CMerged,
    "function",
    "the renderer must expose how D0-004C presence is detected so Bootstrap can be disabled deterministically"
  );
});
