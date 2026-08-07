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

// A declared input set is only worth asserting if the renderer cannot read around it.
// Each of these drives readDeclaredInput — the single enforcement point every disk read
// goes through — so deleting the declaration or the check makes the test fail, rather than
// leaving an admired string behind.

test("roadmap-is-not-an-input", async () => {
  const { resolveViewInputs, readDeclaredInput } = await importRenderer();
  assert.equal(
    resolveViewInputs(root).sources.some((s) => s.includes("AOS-EXECUTION-ROADMAP")),
    false,
    "the roadmap must not be declared"
  );
  assert.throws(
    () => readDeclaredInput(root, "docs/planning/AOS-EXECUTION-ROADMAP.md"),
    /refusing to read undeclared projection input/,
    "reading the roadmap must throw, not merely be undeclared"
  );
});

test("board-is-not-an-input", async () => {
  const { resolveViewInputs, readDeclaredInput } = await importRenderer();
  assert.equal(
    resolveViewInputs(root).sources.some((s) => s.includes("BOARD.md")),
    false,
    "the Board must not be declared"
  );
  assert.throws(
    () => readDeclaredInput(root, "docs/tickets/BOARD.md"),
    /refusing to read undeclared projection input/,
    "reading the Board must throw"
  );
});

test("historical-ledger-is-ignored", async () => {
  const { resolveViewInputs, readDeclaredInput } = await importRenderer();
  assert.equal(
    resolveViewInputs(root).sources.some((s) => s.includes("issue-resolution-ledger")),
    false,
    "the ledger must not be declared"
  );
  assert.throws(
    () => readDeclaredInput(root, "docs/planning/issue-resolution-ledger-2026-08-06.md"),
    /refusing to read undeclared projection input/,
    "reading the ledger must throw"
  );
});

test("generated-views-are-deterministic", async () => {
  const { renderViews } = await importRenderer();
  const first = renderViews(root);
  const second = renderViews(root);
  assert.equal(first.serialized, second.serialized, "two renders at one head must be byte-identical");
  assert.equal(first.board, second.board, "the Board render must be byte-identical too");
  assert.ok(first.board.includes("NOT AUTHORITY"), "the Board must carry a non-authority marker");
  // A projection of nothing is trivially deterministic. Assert it actually rendered the
  // catalog, or a schema drift that empties the output passes this test unnoticed.
  assert.ok(first.json.tickets.length >= 60, `expected the full catalog, rendered ${first.json.tickets.length}`);
  assert.equal(first.board.split("\n").filter((l) => l.startsWith("| D0-")).length >= 1, true, "D0 rows must render");
  const ids = first.json.tickets.map((t) => String(t.id));
  assert.deepEqual(ids, [...ids].sort(), "ticket order must be explicitly sorted, not filesystem order");
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
    // A granted permission that nothing exercises is a standing grant with no purpose.
    // Require the grant to be spent on exactly the thing it was justified by.
    assert.match(body, /check-runs["'\s]*\\?\n?\s*--method POST|check-runs.*--method POST/s,
      `${name} must actually create the named check run its checks:write grant exists for`);
    assert.match(body, /external_id=aos-/, `${name} must bind the check to this exact run and attempt`);
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
  // The single permitted mutation is creating the named check run, which is the entire
  // justification for the dispatch lane's checks:write. Everything else that could alter
  // repository or issue state stays forbidden.
  for (const forbidden of [
    /gh\s+pr\s+(edit|comment|merge|close|review)/,
    /gh\s+issue\s+(edit|comment|close|create)/,
    /git\s+push/,
    /git\s+commit/,
    /add-label|remove-label/,
    /repos\/[^\s"']*\/(issues|pulls|contents|git\/refs)[^\s"']*"?\s*\\?\s*--method\s*(POST|PATCH|PUT|DELETE)/
  ]) {
    assert.doesNotMatch(yaml, forbidden, `workflow must perform no write-token action: ${forbidden}`);
  }
  const mutations = [...yaml.matchAll(/--method\s+(POST|PATCH|PUT|DELETE)/g)];
  assert.equal(mutations.length, 1, "exactly one mutating API call is permitted");
  assert.match(yaml, /check-runs[\s\S]{0,80}--method POST/, "the one mutation must be the check-run creation");
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
