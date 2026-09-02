import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { join } from "node:path";

import { htmlEscape, readJsonIfExists, validId } from "./core.mjs";
import { listRuns, runPaths } from "./store.mjs";
import { renderHtml } from "./report.mjs";
import { aggregateCycle } from "./cycle.mjs";
import { cycleModelIdentity, issuancePolicyFor, modelIdentityLines } from "./model-identity.mjs";

// The only thing in this product that listens on a socket.
//
// It exists so an operator can look at their own runs in a browser, and everything about it is
// arranged so that being on the same machine -- or on the same network as the machine -- is not
// enough to read them. It binds to loopback, it serves nothing without a token minted at launch, it
// refuses a request whose Host header names anything but this machine, and it has no route that
// returns a transcript.
//
// A dashboard that guarded only the port would be readable by every other process on the machine,
// and one that guarded only the token would still be reachable by any page the operator happened to
// have open, through a name that resolves to 127.0.0.1.

export const LOOPBACK = "127.0.0.1";
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const mintToken = () => randomBytes(24).toString("base64url");

/**
 * A number, or nothing.
 *
 * A result and a cycle are files on disk in a directory an assessed agent runs beside, and this
 * page is served to the operator's own browser. A string where a number belongs used to be
 * interpolated raw, which makes it markup.
 */
const number = (value) => (Number.isFinite(value) ? String(value) : "—");

/**
 * Constant-time comparison.
 *
 * `===` on a secret leaks its prefix through timing. It is a small leak against a local attacker
 * and there is no reason to accept it when the alternative is one function call.
 *
 * No test can tell this from `===`: the two return the same answer for every input, and timing is
 * not observable from a test in this suite. It is here on the argument, not on a red-green cycle,
 * and that is worth saying rather than leaving it looking covered.
 */
export function tokenMatches(expected, given) {
  if (typeof given !== "string" || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

/**
 * Whether the Host header names this machine.
 *
 * Without this, a page on any site can point a name it controls at 127.0.0.1 and read the response,
 * because the browser will happily send the request and the server will happily answer it. The
 * token makes that hard; refusing the host makes it pointless.
 */
export function hostAllowed(host) {
  if (typeof host !== "string" || host.length === 0) return false;
  const name = host.replace(/:\d+$/, "");
  return ALLOWED_HOSTS.has(name);
}

const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>:root{--bg:#fff;--text:#171717;--muted:#5c5c5c;--border:#e2e2e2;--accent:#1a5fb4}@media(prefers-color-scheme:dark){:root{--bg:#111;--text:#ededed;--muted:#a3a3a3;--border:#333;--accent:#7aa7e0}}body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;line-height:1.45}a{color:var(--accent)}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}.muted{color:var(--muted);font-size:13px}.card{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin:12px 0}.score{font-size:48px;font-weight:750;letter-spacing:-.03em;line-height:1}.withheld{font-size:26px;font-weight:650}</style></head><body>${body}</body></html>`;

/**
 * The cycle, when there is one.
 *
 * The operator score is the thing this product exists to produce, and it lives above the runs it
 * was computed from -- with the seeds it was locked to and every run that was not counted, because
 * a summary that hid an exclusion would read as a cycle that never ran it.
 */
const cycleSection = (home) => {
  const stored = readJsonIfExists(join(home, "cycle.json"));
  if (stored === null) return "";
  const summary = aggregateCycle(stored);
  // The same gate the cycle command applies, from the same two functions. This surface recomputed
  // the aggregate and printed the number with a literal PROFILE-BOUND line under it, so a cycle
  // recorded before model provenance existed -- or one over a model nobody named -- was promoted
  // here after the CLI had refused it (#561). A projection that answers differently from the
  // command is a second opinion the operator has no way to reconcile.
  const identity = cycleModelIdentity({ binding: stored.model_identity ?? null, runs: stored.runs ?? [] });
  const policy = identity ?? issuancePolicyFor({ provenance: null });
  const issued = summary.complete && policy.profile_bound_aggregation.status === "issued";
  const headline = issued
    ? `<div class="score">${number(summary.operator_score)}</div><div class="muted">Operator Score · median of ${number(summary.valid_runs)} valid run(s)</div>`
    : `<div class="withheld">Operator Score withheld</div><div class="muted">${summary.complete
      ? `${htmlEscape(policy.profile_bound_aggregation.reason)}: ${htmlEscape(policy.profile_bound_aggregation.detail ?? "")}`
      : `${number(summary.valid_runs)} of 3 valid run(s)`}</div>`;
  const excluded = summary.excluded
    .map((entry) => `<li>${htmlEscape(entry.seed)} — ${htmlEscape(entry.reason ?? "")}</li>`)
    .join("");
  return `<section class="card"><h2>${htmlEscape(summary.cycle_id)}</h2>${headline}
<p class="muted">seeds ${htmlEscape(summary.seeds.join(", "))}</p>
${issued ? `<p class="muted">spread ${number(summary.spread)} · deviation ${number(summary.mad)} · stability ${htmlEscape(summary.stability)} · local repeat evidence ${htmlEscape(summary.local_repeat_evidence)}</p>` : ""}
${excluded ? `<p class="muted">not counted:</p><ul class="muted">${excluded}</ul>` : ""}
<ul class="muted">${(identity?.lines ?? modelIdentityLines(null)).map((line) => `<li>${htmlEscape(line)}</li>`).join("")}</ul>
${issued ? `<p class="muted">PROFILE-BOUND: this number describes the declared environment and task pack.</p>` : ""}</section>`;
};

const runRow = (home, runId, token) => {
  const result = readJsonIfExists(runPaths(home, runId).result);
  const score = result?.score ? `${number(result.score.final)} (${result.score.band})` : "withheld";
  return `<tr><td><a href="/run/${encodeURIComponent(runId)}?t=${encodeURIComponent(token)}">${htmlEscape(runId)}</a></td><td>${htmlEscape(result?.status ?? "no result")}</td><td>${htmlEscape(score)}</td><td>${result ? `${number(result.coverage?.observed)} / ${number(result.coverage?.total)}` : "—"}</td></tr>`;
};

/**
 * Builds the request handler.
 *
 * Exported on its own so every refusal can be tested without opening a socket -- a security check
 * that is only reachable through a live server is one that gets tested once.
 */
export function createHandler({ home, token }) {
  return (request, response) => {
    const send = (status, body, type = "text/html; charset=utf-8") => {
      response.writeHead(status, {
        "content-type": type,
        // No sharing with anything. There is no origin that should be able to read this.
        "cross-origin-resource-policy": "same-origin",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        // The pages are self-contained, so nothing legitimate is lost by forbidding everything.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
      });
      response.end(body);
    };

    // Read-only means read-only. A dashboard that accepted a POST would be a way to change a
    // recorded result from a browser.
    if (request.method !== "GET" && request.method !== "HEAD") return send(405, page("Not allowed", "<p>Read only.</p>"));
    if (!hostAllowed(request.headers.host)) return send(403, page("Refused", "<p>This server answers only to this machine.</p>"));

    let url;
    try {
      url = new URL(request.url, `http://${LOOPBACK}`);
    } catch {
      return send(400, page("Bad request", "<p>Unreadable request.</p>"));
    }
    if (!tokenMatches(token, url.searchParams.get("t") ?? "")) {
      return send(403, page("Refused", "<p>This link needs the token printed when the dashboard started.</p>"));
    }

    if (url.pathname === "/") {
      const runs = listRuns(home);
      const rows = runs.map((runId) => runRow(home, runId, token)).join("");
      return send(
        200,
        page(
          "AOS runs",
          `<h1>Runs</h1>${cycleSection(home)}<p class="muted">${number(runs.length)} run(s) in this home. Read only; nothing here can be changed from a browser.</p><table><thead><tr><th>Run</th><th>Status</th><th>Score</th><th>Observed</th></tr></thead><tbody>${rows}</tbody></table>`
        )
      );
    }

    const match = /^\/run\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const runId = decodeURIComponent(match[1]);
      // The id shape is the containment: it never reaches a path join unless it is a plain
      // identifier, so `..` and a separator are refused before anything touches the filesystem.
      if (!validId(runId)) return send(400, page("Bad request", "<p>Not a run id.</p>"));
      const result = readJsonIfExists(runPaths(home, runId).result);
      if (result === null) return send(404, page("Not found", "<p>No result for that run.</p>"));
      return send(200, renderHtml(result));
    }

    // Everything else, including any path that might have served a transcript. There is no route
    // that returns raw session content, and adding one would put the operator's own work on a
    // socket.
    return send(404, page("Not found", "<p>No such page.</p>"));
  };
}

/**
 * Starts the dashboard on a port the operating system chooses.
 *
 * Loopback only: passing a host would be the difference between a tool for one person and a service.
 */
export function startDashboard({ home, token = mintToken(), port = 0 } = {}) {
  const server = createServer(createHandler({ home, token }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => {
      const address = server.address();
      resolve({
        server,
        token,
        port: address.port,
        url: `http://${LOOPBACK}:${address.port}/?t=${encodeURIComponent(token)}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}
