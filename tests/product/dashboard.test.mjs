import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOOPBACK, hostAllowed, mintToken, startDashboard, tokenMatches } from "../../lib/dashboard.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { scoreRun as scoreRunUnbounded } from "../../lib/scorer-v1.mjs";
import { createRun, initHome, runPaths, writeResult } from "../../lib/store.mjs";
import { writeJson } from "../../lib/core.mjs";
import { summariseCycle } from "../../lib/cycle.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";
import { modelIdentityRecord, resolveModelProvenance, verifyModelIdentity } from "../../lib/model-identity.mjs";
import { identityDigestOf, IDENTITY_SCHEMA } from "../../lib/runtime-identity.mjs";

// A cycle bound to an exact model on a verified executable, and one run that confirmed it: what
// the dashboard is entitled to show a number for (#561).
const EXACT = "openai/gpt-4o-2024-08-06";

const identityRecord = () => {
  const base = {
    schema_id: IDENTITY_SCHEMA,
    command_input: "codex",
    resolved_realpath: "/usr/bin/codex",
    realpath_digest: `sha256:${"a".repeat(64)}`,
    file_fingerprint: { size: 1024, mtime_ms: 1, inode: 2, device: 3 },
    interpreter_digest: null,
    interpreter_chain: [],
    owner_uid: 501,
    mode: "0755",
    parent_security: { world_writable: false, group_writable_untrusted: false, foreign_owner: false, acl_writable: false },
    platform_identity: { macos_codesign_team: null, macos_requirement_digest: null },
    adapter_id: "codex-cli.v1",
    identity_status: "VERIFIED",
    untrusted_reasons: [],
    verified_at: "2026-09-02T00:00:00.000Z"
  };
  return { ...base, identity_digest: identityDigestOf(base) };
};

const provenance = () => resolveModelProvenance({ declared: { model: EXACT, provider: null } });

const confirmedRun = () => modelIdentityRecord({
  by_agent: {
    solo: {
      provenance: provenance(),
      verification: verifyModelIdentity(provenance(), [{ runtime: "codex", provider: "openai", model: "gpt-4o-2024-08-06", row_digest: `sha256:${"1".repeat(64)}` }], { runtime: "codex" }),
      runtime_identity_digest: identityRecord().identity_digest,
      runtime_identity_status: "VERIFIED"
    }
  },
  profile_digest: "d".repeat(64)
});

const bound = () => modelIdentityRecord({
  by_agent: { solo: { provenance: provenance(), verification: null, runtime_identity_digest: identityRecord().identity_digest, runtime_identity_status: "VERIFIED" } },
  profile_digest: "d".repeat(64)
});

// #556: `scoreRun` withholds issuance unless the confinement gate says the run was official, and
// absent evidence withholds like a negative verdict. These tests are about the arithmetic and the
// metric gates, so the boundary is stated once here rather than at every call.
const UNDER_AN_OFFICIAL_BOUNDARY = { isolationLevel: "STRICT", officialIssuance: { official: true, reasons: [] } };
const scoreRun = (observations, context = {}) => scoreRunUnbounded(observations, { ...UNDER_AN_OFFICIAL_BOUNDARY, ...context });


const homeWithRun = () => {
  const home = mkdtempSync(join(tmpdir(), "aos-dash-"));
  initHome(home);
  const { runId } = createRun(home, { mode: "TEST" });
  const metrics = METRIC_IDS.map((id) =>
    observationOf({
      metric_id: id,
      verifier_id: "dash.test",
      subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: true })),
      evidence_ids: ["e"],
      reason: "fixture"
    })
  );
  const result = { ...scoreRun(metrics), run_id: runId, metrics, limitations: ["local"] };
  writeResult(home, runId, result, renderMarkdown(result), renderHtml(result));
  return { home, runId };
};

const withServer = async (body) => {
  const { home, runId } = homeWithRun();
  const dashboard = await startDashboard({ home });
  try {
    return await body({ ...dashboard, home, runId });
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
};

const get = (port, path, headers = {}) =>
  fetch(`http://${LOOPBACK}:${port}${path}`, { headers, redirect: "manual" });

// fetch refuses to set Host -- it is a forbidden header there -- so the rebinding check has to go
// through the raw client. A test that could not set it would be testing nothing.
const rawGet = (port, path, host) =>
  new Promise((resolve, reject) => {
    const request = httpRequest({ host: LOOPBACK, port, path, method: "GET", headers: { host } }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
    request.end();
  });

test("it listens on loopback and a port nobody chose", async () => {
  // A host argument would be the difference between a tool for one person and a service.
  await withServer(async ({ port, server }) => {
    const address = server.address();
    assert.equal(address.address, LOOPBACK);
    assert.equal(port > 0, true);
  });
});

test("nothing is served without the token minted at launch", async () => {
  await withServer(async ({ port, token, runId }) => {
    assert.equal((await get(port, "/")).status, 403);
    assert.equal((await get(port, "/?t=")).status, 403);
    assert.equal((await get(port, "/?t=wrong")).status, 403);
    assert.equal((await get(port, `/run/${runId}`)).status, 403);
    assert.equal((await get(port, `/?t=${token}`)).status, 200);
  });
});

test("a token is compared in constant time and by full length", () => {
  // `===` leaks a secret's prefix through timing. It is a small leak against a local attacker and
  // there is no reason to take it when the alternative is one call.
  const token = mintToken();
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(token, token.slice(0, -1)), false);
  assert.equal(tokenMatches(token, `${token}x`), false);
  assert.equal(tokenMatches(token, ""), false);
  assert.equal(tokenMatches(token, null), false);
  assert.equal(mintToken() === mintToken(), false, "the token must not be predictable");
  // The constant-time comparison itself is not observable from here: `===` returns the same answers
  // for every input above. It is kept because timing is a real channel and the alternative costs one
  // call, and it is recorded as untestable rather than left looking covered.
});

test("a request naming any other host is refused", async () => {
  // Without this, a page on any site can point a name it controls at 127.0.0.1 and read the
  // response. The token makes that hard; refusing the host makes it pointless.
  await withServer(async ({ port, token }) => {
    assert.equal((await rawGet(port, `/?t=${token}`, "evil.example")).status, 403);
    assert.equal((await rawGet(port, `/?t=${token}`, `aos.evil.example:${port}`)).status, 403);
    assert.equal((await rawGet(port, `/?t=${token}`, `localhost:${port}`)).status, 200);
    assert.equal((await rawGet(port, `/?t=${token}`, `${LOOPBACK}:${port}`)).status, 200);
  });
  assert.equal(hostAllowed("127.0.0.1:8080"), true);
  assert.equal(hostAllowed("localhost"), true);
  assert.equal(hostAllowed("aos.evil.example"), false);
  assert.equal(hostAllowed("127.0.0.1.evil.example"), false);
  // A suffix match would accept this: anybody can register a name ending in the allowed one.
  assert.equal(hostAllowed("evil.localhost"), false);
  assert.equal(hostAllowed("notlocalhost"), false);
  assert.equal(hostAllowed("x127.0.0.1"), false);
  assert.equal(hostAllowed(undefined), false);
  assert.equal(hostAllowed(""), false);
});

test("read only means read only", async () => {
  // A dashboard that accepted a POST would be a way to change a recorded result from a browser.
  await withServer(async ({ port, token }) => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const response = await fetch(`http://${LOOPBACK}:${port}/?t=${token}`, { method });
      assert.equal(response.status, 405, method);
    }
  });
});

test("a run id that is not an id never reaches the filesystem", async () => {
  await withServer(async ({ port, token }) => {
    // `/run/..` normalises to `/` before it reaches the router and lands on the listing, which is
    // harmless. What matters is that nothing outside the run directory is ever read, and that a
    // path which does reach the run route with a non-id is refused before any join.
    for (const attempt of ["..", "../../etc/passwd", "%2e%2e%2f%2e%2e%2fetc%2fpasswd", "a/b", "%2e%2e", "..%2f..%2fetc%2fpasswd"]) {
      const response = await get(port, `/run/${attempt}?t=${token}`);
      const body = await response.text();
      assert.equal(body.includes("root:"), false, `${attempt} returned file content`);
      assert.equal(body.includes("<h1>Runs</h1>") || [400, 404].includes(response.status), true, `${attempt} returned ${response.status}`);
    }
    // The shape check itself, where the router does see the id.
    assert.equal((await get(port, `/run/${encodeURIComponent("../../etc/passwd")}?t=${token}`)).status, 400);
  });
});

test("there is no route that returns a transcript", async () => {
  // Adding one would put the operator's own sessions on a socket.
  await withServer(async ({ port, token }) => {
    for (const path of ["/events", "/session", "/sessions", "/raw", "/workspaces", "/manifest.json", "/runs/x/events.ndjson"]) {
      const response = await get(port, `${path}?t=${token}`);
      assert.equal(response.status, 404, path);
    }
  });
});

test("a run's report is served, and one that has no result is not invented", async () => {
  await withServer(async ({ port, token, runId }) => {
    const found = await get(port, `/run/${runId}?t=${token}`);
    assert.equal(found.status, 200);
    const body = await found.text();
    // The report's claim line. This fixture run names no model, so what it is entitled to say is
    // RUN-DIAGNOSTIC; the page used to print the profile-bound sentence for every run (#561).
    assert.match(body, /RUN-DIAGNOSTIC —/);
    // "Dimensions" reads as jargon to someone opening this once; the section is "The six areas"
    // now. What the dashboard has to serve is the real report, so this checks a section of it.
    assert.match(body, /The six areas/);

    const missing = await get(port, `/run/run-does-not-exist?t=${token}`);
    assert.equal(missing.status, 404);
  });
});

test("the listing links every run and says what it scored", async () => {
  await withServer(async ({ port, token, runId }) => {
    const body = await (await get(port, `/?t=${token}`)).text();
    assert.match(body, new RegExp(runId));
    assert.match(body, /SCORED/);
    assert.match(body, /100 \(HIGH RELIABILITY\)/);
    assert.match(body, /Read only/);
  });
});

test("no response invites another origin to read it", async () => {
  await withServer(async ({ port, token }) => {
    const response = await get(port, `/?t=${token}`);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  });
});

test("the operator score sits above the runs it was computed from", async () => {
  // The thing this product exists to produce. A summary that hid an exclusion would read as a
  // cycle that never ran it, so every uncounted run is named with its reason.
  //
  // The cycle below carries a model identity binding, because since #561 a cycle without one is
  // historical and its aggregate is withheld -- see the test after this one, which is that case.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-cycle-"));
  initHome(home);
  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-abc",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    model_identity: bound(),
    seeds: ["0000000000000001", "0000000000000002", "0000000000000003", "0000000000000004"],
    runs: [
      { seed: "0000000000000001", valid: true, invalid_reason: null, final_score: 71, dimensions: { D1: 80 }, model_identity: confirmedRun() },
      { seed: "0000000000000002", valid: true, invalid_reason: null, final_score: 74, dimensions: { D1: 80 }, model_identity: confirmedRun() },
      { seed: "0000000000000003", valid: true, invalid_reason: null, final_score: 77, dimensions: { D1: 80 }, model_identity: confirmedRun() },
      // Identified like the others: since #561 a cycle holding a run it cannot identify withholds,
      // and a run that did not issue is still a run the cycle ran. Its exclusion is about the
      // score, not about who ran it.
      { seed: "0000000000000004", valid: false, invalid_reason: "NOT_ISSUED", final_score: null, dimensions: {}, model_identity: confirmedRun() }
    ]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /cycle-abc/);
    assert.match(body, />74</, "the median of the valid runs");
    assert.match(body, /Operator Score/);
    assert.match(body, /0000000000000004 — NOT_ISSUED/);
    assert.match(body, /local repeat evidence/);
    assert.match(body, /PROFILE-BOUND/);
    assert.match(body, /Model \(solo\): declared openai\/gpt-4o-2024-08-06/, "the same identity lines every other surface shows");
    assert.equal(/confidence/i.test(body), false);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the run listing says what each run may claim, not only what it scored", async () => {
  // The listing showed a score, a status and a coverage count. Two runs identical on all three can
  // be a profile-bound measurement and a run diagnostic over a model nobody named, and the row
  // that cannot tell them apart is the row an operator reads first (#561).
  const home = mkdtempSync(join(tmpdir(), "aos-dash-claim-"));
  initHome(home);
  const { runId } = createRun(home, { mode: "TEST" });
  const metrics = METRIC_IDS.map((id) => observationOf({
    metric_id: id, verifier_id: "aos-verify.v1",
    subchecks: METRICS[id].subchecks.map((subcheck) => ({ id: subcheck, pass: true })),
    evidence_ids: ["e"], reason: "fixture"
  }));
  const unknown = modelIdentityRecord({
    by_agent: { solo: { provenance: resolveModelProvenance({}), verification: null, runtime_identity_digest: null, runtime_identity_status: "MIGRATION_REQUIRED" } },
    profile_digest: "e".repeat(64)
  });
  writeResult(home, runId, { ...scoreRun(metrics), run_id: runId, metrics, model_identity: unknown, limitations: [] }, "# r", "<h1>r</h1>");
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /RUN_DIAGNOSTIC/);
    assert.match(body, /MODEL_UNKNOWN/);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the dashboard quotes the stored cycle decision rather than deriving its own", async () => {
  // Two surfaces each rebuilt the aggregate and the model policy from the raw cycle, so the page
  // and the command were two opinions that happened to agree. The decision is computed once, when
  // the cycle is written, and both surfaces quote it -- the same rule the run renderers follow.
  // The sentinel is how that is tested: a derived line cannot contain it.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-stored-"));
  initHome(home);
  const stored = {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-stored",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    model_identity: bound(),
    seeds: ["0000000000000001", "0000000000000002", "0000000000000003"],
    runs: [
      { seed: "0000000000000001", valid: true, invalid_reason: null, final_score: 71, dimensions: { D1: 80 }, model_identity: confirmedRun() },
      { seed: "0000000000000002", valid: true, invalid_reason: null, final_score: 74, dimensions: { D1: 80 }, model_identity: confirmedRun() },
      { seed: "0000000000000003", valid: true, invalid_reason: null, final_score: 77, dimensions: { D1: 80 }, model_identity: confirmedRun() }
    ]
  };
  stored.decision = { ...summariseCycle(stored), model_identity: { ...summariseCycle(stored).model_identity, lines: ["SENTINEL_FROM_THE_STORED_CYCLE"] } };
  writeJson(join(home, "cycle.json"), stored);
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /SENTINEL_FROM_THE_STORED_CYCLE/);
    assert.equal(/Model \(solo\)/.test(body), false, "the page derived its own lines");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a cycle nothing bound a model to is not shown as an operator score", async () => {
  // The dashboard recomputed the aggregate with `aggregateCycle` and printed the number with a
  // literal PROFILE-BOUND line under it, so a cycle recorded before model provenance existed --
  // or one over a model nobody named -- was promoted on this surface after the CLI had refused it
  // (#561). Every projection shows the same withholding state or none of them mean anything.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-historical-"));
  initHome(home);
  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-historical",
    profile_digest: "e".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: ["0000000000000001", "0000000000000002", "0000000000000003"],
    runs: [
      { seed: "0000000000000001", valid: true, invalid_reason: null, final_score: 71, dimensions: { D1: 80 } },
      { seed: "0000000000000002", valid: true, invalid_reason: null, final_score: 74, dimensions: { D1: 80 } },
      { seed: "0000000000000003", valid: true, invalid_reason: null, final_score: 77, dimensions: { D1: 80 } }
    ]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /cycle-historical/);
    assert.equal(/>74</.test(body), false, "a historical cycle was promoted to a number");
    assert.match(body, /Operator Score withheld/);
    assert.match(body, /MODEL_PROVENANCE_ABSENT/);
    assert.equal(/PROFILE-BOUND/.test(body), false);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a home with no cycle shows the runs and invents nothing", async () => {
  await withServer(async ({ port, token }) => {
    const body = await (await get(port, `/?t=${token}`)).text();
    assert.equal(body.includes("Operator Score"), false);
    assert.match(body, /<h1>Runs<\/h1>/);
  });
});

test("markup in a stored record never becomes markup in the dashboard", async () => {
  // Same reason as the report: these files sit in a directory an assessed agent runs beside, and
  // the page is served to the operator's own browser.
  const payload = '"><script>alert(1)</script>';
  const home = mkdtempSync(join(tmpdir(), "aos-dash-hostile-"));
  initHome(home);
  const { runId } = createRun(home, { mode: "TEST" });
  writeResult(home, runId, {
    run_id: runId, status: payload,
    score: { final: payload, raw: payload, band: payload }, provisional_raw: payload,
    dimensions: { D1: null, D2: null, D3: null, D4: null, D5: null, D6: null },
    coverage: { observed: payload, total: payload }, caps: [], blockers: [], metrics: [], limitations: [payload]
  }, "md", "<html></html>");
  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1", cycle_id: payload, profile_digest: "d".repeat(64),
    suite_major: 1, scorer_major: 1, seeds: [payload],
    runs: [{ seed: payload, valid: false, invalid_reason: payload, final_score: null, dimensions: {} }]
  });

  const dashboard = await startDashboard({ home });
  try {
    for (const path of ["/", `/run/${encodeURIComponent(runId)}`]) {
      const body = await (await get(dashboard.port, `${path}?t=${dashboard.token}`)).text();
      assert.equal(/<script>alert\(1\)<\/script>/.test(body), false, path);
      assert.equal(/<script/i.test(body), false, path);
    }
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a cycle with no recorded result schema is not described as a legacy aggregate", async () => {
  // #568 round 2 BLOCKER. `assertUniformResultSchema` returns `null` when no run in the cycle
  // recorded a result schema at all -- an empty cycle is exactly that shape -- and the dashboard's
  // `schema !== null && schema !== "aos-mvp-result.v1"` guard let `null` fall through to the same
  // branch as a confirmed legacy schema, which then printed "a legacy scorer aggregate, rendered as
  // stored" unconditionally. Nothing here was ever observed to be a legacy aggregate; an absence is
  // not a value, and a cycle nobody ran anything against must not be captioned as one kind of
  // scorer's output over another's.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-unknown-schema-"));
  initHome(home);
  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-empty",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: [],
    runs: []
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /cycle-empty/);
    assert.equal(/LEGACY \/ NOT COMPARABLE/.test(body), false, "an unknown schema was rendered as a legacy aggregate");
    assert.equal(/legacy scorer aggregate/.test(body), false, "an unknown schema was rendered as a legacy aggregate");
    // Round 6 changed the wording, not the fact: this cycle now gets the ordinary card -- keeping
    // its seeds and its `N of 3 valid run(s)` progress, which the old stripped card dropped from
    // every freshly created cycle -- and only its provenance line differs. Withheld is still
    // withheld, and the provenance is still explicitly unclaimed rather than assumed legacy.
    assert.match(body, /Operator Score withheld/);
    assert.match(body, /PROVENANCE UNRECORDED/);
    assert.match(body, /recorded no result schema/);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the legacy aggregate is captioned by a run the median counted, not one it excluded", async () => {
  // #568 round 2 NIT. `legacyCycleScorerName` used to read whichever run's result file it found
  // readable first in array order, with no regard for `valid` -- so a run the median excluded (a
  // superseded seed, an infrastructure retry) could caption an aggregate it took no part in. The
  // excluded run is listed first and carries a different scorer id than the counted run, so reading
  // array order instead of `valid` would print the wrong one.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-scorer-"));
  initHome(home);
  const legacyResult = (runId, scorerId) => ({
    run_id: runId, status: "SCORED",
    score: { final: 80, raw: 80, band: "STRONG" },
    dimensions: { D1: 80, D2: 80, D3: 80, D4: 80, D5: 80, D6: 80 },
    coverage: { observed: 6, total: 6 },
    caps: [], blockers: [], metrics: [], limitations: [],
    scorer: { id: scorerId, version: "1.0.0" }
  });
  const { runId: excludedRunId } = createRun(home, { mode: "TEST" });
  writeResult(home, excludedRunId, legacyResult(excludedRunId, "scorer-excluded"), "md", "<h1>r</h1>");
  const { runId: countedRunId } = createRun(home, { mode: "TEST" });
  writeResult(home, countedRunId, legacyResult(countedRunId, "scorer-counted"), "md", "<h1>r</h1>");

  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-scorer",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: ["s1", "s2"],
    runs: [
      { seed: "s1", run_id: excludedRunId, valid: false, invalid_reason: "NOT_ISSUED", final_score: null, dimensions: {} },
      { seed: "s2", run_id: countedRunId, valid: true, invalid_reason: null, final_score: 80, dimensions: { D1: 80 } }
    ]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    // The per-run "Legacy results" table below names every run's own scorer, including the
    // excluded one, on purpose -- that table is about what each run individually claims, not what
    // the cycle's aggregate is. The assertion is scoped to the cycle card's own caption line, which
    // is the one string this fix changes.
    assert.match(body, /scorer-counted 1\.0\.0 · a legacy scorer aggregate/);
    assert.equal(/scorer-excluded 1\.0\.0 · a legacy scorer aggregate/.test(body), false, "the cycle caption named the excluded run's scorer");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the legacy caption says the counted runs disagree on scorer, rather than naming the first one in array order", async () => {
  // #568 round 3 BLOCKER (a). The first pass used to return as soon as it found one counted run's
  // readable result, with nothing checking that every other counted run named the same scorer -- so
  // two counted runs recorded under two different scorer identities had the first one in array
  // order captioned as the whole aggregate's provenance, and the disagreement never reached the
  // page. Both runs here are counted (`valid: true`) and readable, and they name different scorers.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-scorer-disagree-"));
  initHome(home);
  const legacyResult = (runId, scorerId) => ({
    run_id: runId, status: "SCORED",
    score: { final: 80, raw: 80, band: "STRONG" },
    dimensions: { D1: 80, D2: 80, D3: 80, D4: 80, D5: 80, D6: 80 },
    coverage: { observed: 6, total: 6 },
    caps: [], blockers: [], metrics: [], limitations: [],
    scorer: { id: scorerId, version: "1.0.0" }
  });
  const { runId: firstRunId } = createRun(home, { mode: "TEST" });
  writeResult(home, firstRunId, legacyResult(firstRunId, "scorer-first"), "md", "<h1>r</h1>");
  const { runId: secondRunId } = createRun(home, { mode: "TEST" });
  writeResult(home, secondRunId, legacyResult(secondRunId, "scorer-second"), "md", "<h1>r</h1>");

  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-disagree",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: ["s1", "s2"],
    runs: [
      { seed: "s1", run_id: firstRunId, valid: true, invalid_reason: null, final_score: 80, dimensions: { D1: 80 } },
      { seed: "s2", run_id: secondRunId, valid: true, invalid_reason: null, final_score: 80, dimensions: { D1: 80 } }
    ]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /LEGACY \/ NOT COMPARABLE · the counted runs disagree on scorer · a legacy scorer aggregate/);
    assert.equal(/scorer-first 1\.0\.0 · a legacy scorer aggregate/.test(body), false, "the cycle caption named one counted run's scorer over the other's");
    assert.equal(/scorer-second 1\.0\.0 · a legacy scorer aggregate/.test(body), false, "the cycle caption named one counted run's scorer over the other's");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the legacy caption withholds a name rather than borrowing one from an excluded run when the counted run's file is missing", async () => {
  // #568 round 3 BLOCKER (b). The fallback pass used to read any run at all -- including one the
  // median excluded -- the moment no counted run's file was readable, and printed that run's scorer
  // as though it were the aggregate's own, with nothing in the caption saying the name came from a
  // run that took no part in producing the number beside it. This cycle records `valid` on every
  // run (it is not the pre-`valid` shape the fallback exists for), and the counted run's own result
  // file is never written -- `createRun` allocates the run's id and directory but nothing is scored
  // into it -- so the fallback must not reach past it to the excluded run's own readable file.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-scorer-missing-"));
  initHome(home);
  const legacyResult = (runId, scorerId) => ({
    run_id: runId, status: "SCORED",
    score: { final: 80, raw: 80, band: "STRONG" },
    dimensions: { D1: 80, D2: 80, D3: 80, D4: 80, D5: 80, D6: 80 },
    coverage: { observed: 6, total: 6 },
    caps: [], blockers: [], metrics: [], limitations: [],
    scorer: { id: scorerId, version: "1.0.0" }
  });
  const { runId: excludedRunId } = createRun(home, { mode: "TEST" });
  writeResult(home, excludedRunId, legacyResult(excludedRunId, "scorer-excluded"), "md", "<h1>r</h1>");
  const { runId: countedRunId } = createRun(home, { mode: "TEST" });

  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-missing",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: ["s1", "s2"],
    runs: [
      { seed: "s1", run_id: excludedRunId, valid: false, invalid_reason: "NOT_ISSUED", final_score: null, dimensions: {} },
      { seed: "s2", run_id: countedRunId, valid: true, invalid_reason: null, final_score: 80, dimensions: { D1: 80 } }
    ]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /LEGACY \/ NOT COMPARABLE · unrecorded legacy scorer · a legacy scorer aggregate/);
    assert.equal(/scorer-excluded 1\.0\.0 · a legacy scorer aggregate/.test(body), false, "the cycle caption named the excluded run's scorer though the counted run's own file was never readable");
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a counted run whose result file is not a legacy result cannot caption the aggregate", async () => {
  // #568 round 5 BLOCKER. `assertUniformResultSchema` decides "this cycle is legacy" from the run
  // records in cycle.json, never from the files they point at, while the caption read whatever JSON
  // was on disk. A result file of any other shape carrying a `scorer` field was therefore captioned
  // as this aggregate's provenance on its own say-so -- a stored artifact vouching for itself. It
  // now counts as no result, which is what a missing file already counted as.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-scorer-forged-"));
  initHome(home);
  // Exactly ONE counted run, and its file is the forged one. With a second, honest counted run in
  // the cycle the forged name would merely DISAGREE with it and the disagreement branch would
  // withhold the caption for a reason that has nothing to do with the schema -- the test would pass
  // with the schema check deleted, which is what a first draft of it did.
  const { runId: forgedRunId } = createRun(home, { mode: "TEST" });
  // Not a legacy result by any field this build reads -- it only claims a scorer.
  writeJson(runPaths(home, forgedRunId).result, { schema_id: "not-a-real-schema.v9", scorer: { id: "scorer-forged", version: "9.9.9" } });

  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-forged",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: ["s1", "s2"],
    runs: [
      { seed: "s1", run_id: forgedRunId, valid: true, invalid_reason: null, final_score: 80, dimensions: { D1: 80 } }
    ]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.equal(/scorer-forged/.test(body), false, "a file that is not a legacy result captioned the aggregate on its own say-so");
    assert.match(body, /LEGACY \/ NOT COMPARABLE · unrecorded legacy scorer · a legacy scorer aggregate/);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the legacy caption withholds a name when only some of the counted runs still have a result on disk", async () => {
  // #568 round 4 BLOCKER. The counted runs whose result file could not be read were filtered out
  // before the names were compared, so silence agreed with whatever was still on disk: two counted
  // runs, one readable, and the readable one's scorer was captioned as the whole aggregate's
  // provenance while the run that recorded nothing could not disagree with it. The agreement being
  // tested has to hold among the runs the median counted, not among the ones that happen to still
  // be readable.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-scorer-partial-"));
  initHome(home);
  const legacyResult = (runId, scorerId) => ({
    run_id: runId, status: "SCORED",
    score: { final: 80, raw: 80, band: "STRONG" },
    dimensions: { D1: 80, D2: 80, D3: 80, D4: 80, D5: 80, D6: 80 },
    coverage: { observed: 6, total: 6 },
    caps: [], blockers: [], metrics: [], limitations: [],
    scorer: { id: scorerId, version: "1.0.0" }
  });
  const { runId: readableRunId } = createRun(home, { mode: "TEST" });
  writeResult(home, readableRunId, legacyResult(readableRunId, "scorer-readable"), "md", "<h1>r</h1>");
  // Counted by the median, but nothing was ever scored into its directory.
  const { runId: unreadableRunId } = createRun(home, { mode: "TEST" });

  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-partial",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: ["s1", "s2"],
    runs: [
      { seed: "s1", run_id: readableRunId, valid: true, invalid_reason: null, final_score: 80, dimensions: { D1: 80 } },
      { seed: "s2", run_id: unreadableRunId, valid: true, invalid_reason: null, final_score: 80, dimensions: { D1: 80 } }
    ]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.equal(
      /scorer-readable 1\.0\.0 · a legacy scorer aggregate/.test(body), false,
      "one readable counted run's scorer was captioned as the whole aggregate's, though another counted run recorded none"
    );
    assert.match(body, /not every counted run&#39;s scorer is on disk/u);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a cycle whose runs recorded a schema this build does not recognise is not described as a profile result", async () => {
  // #568 round 3 NIT 1. `assertUniformResultSchema` returns whatever single string every run in
  // the cycle agreed on, and it never checks that string against a schema this build can actually
  // project -- so a run recorded under a schema id nobody here recognises used to fall into the
  // `schema !== "aos-mvp-result.v1"` branch and get printed as "profile result(s)", asserting a
  // provenance that was never observed.
  const home = mkdtempSync(join(tmpdir(), "aos-dash-unrecognised-schema-"));
  initHome(home);
  writeJson(join(home, "cycle.json"), {
    schema_id: "aos-cycle.v1",
    cycle_id: "cycle-unrecognised",
    profile_digest: "d".repeat(64),
    suite_major: 1,
    scorer_major: 1,
    seeds: ["s1"],
    runs: [{ seed: "s1", valid: false, invalid_reason: "NOT_ISSUED", final_score: null, dimensions: {}, result_schema: "aos-result.v99" }]
  });
  const dashboard = await startDashboard({ home });
  try {
    const body = await (await get(dashboard.port, `/?t=${dashboard.token}`)).text();
    assert.match(body, /cycle-unrecognised/);
    assert.equal(/profile result\(s\)/.test(body), false, "an unrecognised schema was rendered as a profile result");
    assert.match(body, /cycle aggregation withheld/);
    assert.match(body, /aos-result\.v99/);
  } finally {
    await dashboard.close();
    rmSync(home, { recursive: true, force: true });
  }
});
