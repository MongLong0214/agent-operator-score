import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LOOPBACK, hostAllowed, mintToken, startDashboard, tokenMatches } from "../../lib/dashboard.mjs";
import { METRICS, METRIC_IDS, observationOf } from "../../lib/metrics.mjs";
import { scoreRun } from "../../lib/scorer-v1.mjs";
import { createRun, initHome, writeResult } from "../../lib/store.mjs";
import { renderHtml, renderMarkdown } from "../../lib/report.mjs";

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
    assert.match(body, /PROFILE-BOUND/);
    assert.match(body, /Dimensions/);

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
