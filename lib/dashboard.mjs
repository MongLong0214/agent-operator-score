import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { join } from "node:path";

import { htmlEscape, readJsonIfExists, validId } from "./core.mjs";
import { listRuns, runPaths } from "./store.mjs";
import { renderHtml } from "./report.mjs";
import {
  RESULT_SCHEMA_ID, SUPERSEDED_PROFILE_RESULT_SCHEMA_IDS,
  assertUniformResultSchema, isLegacyResult, legacyScorerName, projectResult
} from "./result-schema.mjs";
import { cycleLines, summariseCycle } from "./cycle.mjs";

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
// #568 round 3 NIT. Every schema id this build actually knows how to project as a profile result --
// the current one and the superseded ones `resultKind` (lib/result-schema.mjs) still recognises --
// so a cycle whose runs agree on some other string is not silently read as "a profile result", the
// same defect class as asserting a value nobody observed.
const PROFILE_RESULT_SCHEMA_IDS = new Set([RESULT_SCHEMA_ID, ...SUPERSEDED_PROFILE_RESULT_SCHEMA_IDS]);

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
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>:root{--bg:#fff;--text:#171717;--muted:#5c5c5c;--border:#e2e2e2;--accent:#1a5fb4}@media(prefers-color-scheme:dark){:root{--bg:#111;--text:#ededed;--muted:#a3a3a3;--border:#333;--accent:#7aa7e0}}body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;line-height:1.45}a{color:var(--accent)}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}.muted{color:var(--muted);font-size:13px}.legacy-note{font-size:13px;font-weight:600}.card{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin:12px 0}.score{font-size:48px;font-weight:750;letter-spacing:-.03em;line-height:1}.withheld{font-size:26px;font-weight:650}</style></head><body>${body}</body></html>`;

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
  // The median below is the legacy scorer's aggregation and is applied to legacy results only. A
  // cycle of profile results has no single number to take a median of; until the cycle owner
  // (#563) aggregates profiles, that cycle is shown as what it is rather than averaged as scores.
  let schema;
  try {
    schema = assertUniformResultSchema(stored.runs ?? [], "cycle.json");
  } catch (error) {
    return `<section class="card"><h2>${htmlEscape(stored.cycle_id ?? "cycle")}</h2><div class="withheld">cycle aggregation withheld</div><p class="muted">${htmlEscape(error.message)}</p></section>`;
  }
  // #568 round 2. `assertUniformResultSchema` is a real tri-state -- `null` means no run recorded
  // a result schema at all, which says nothing about what kind of scorer produced these runs.
  // Folding that into the same branch as `schema !== "aos-mvp-result.v1"` used to send it down the
  // legacy path below, which then printed "a legacy scorer aggregate" unconditionally -- an absence
  // asserted as a value, this repository's recurring defect. An empty cycle, or one whose runs all
  // failed before a result existed, is neither observed to be legacy nor observed to be a profile
  // cycle, so it gets its own withheld card that names the absence instead of guessing a provenance.
  // `schema === null` is excluded here deliberately: nothing was recorded, which is not the same
  // fact as a string this build cannot place, and the message below would tell an operator their
  // runs recorded an unrecognised schema when they recorded none. It keeps the ordinary card and
  // says its provenance is unrecorded, further down.
  if (schema !== null && schema !== "aos-mvp-result.v1") {
    // #568 round 3 NIT. `assertUniformResultSchema` returns whatever single string every run in
    // the cycle agreed on, and it never checks that string against a schema this build can
    // actually project -- so a run recorded under a schema id nobody here recognises used to fall
    // into this branch and get printed as "profile result(s)", asserting a provenance that was
    // never observed. Only a schema this build recognises as a profile result is described as
    // one; anything else names itself as unrecognised and withholds the aggregate all the same.
    if (!PROFILE_RESULT_SCHEMA_IDS.has(schema)) {
      return `<section class="card"><h2>${htmlEscape(stored.cycle_id ?? "cycle")}</h2><div class="withheld">cycle aggregation withheld</div><p class="muted">${number((stored.runs ?? []).length)} result(s) recorded ${htmlEscape(schema)}, a result schema this build does not recognise as the legacy scorer or a profile result; no aggregate is claimed for it.</p></section>`;
    }
    return `<section class="card"><h2>${htmlEscape(stored.cycle_id ?? "cycle")}</h2><div class="withheld">cycle aggregation withheld</div><p class="muted">${number((stored.runs ?? []).length)} profile result(s); the legacy median does not apply to profile results.</p></section>`;
  }
  // Quoted, not recomputed. This surface rebuilt the aggregate and the model policy from the raw
  // cycle while the `cycle` command rebuilt them independently, so a stored decision and the page
  // rendered from it could differ -- and did, for a cycle with no provenance, which the command
  // refused and the page printed as a number under a PROFILE-BOUND line (#561). The decision is
  // made once, when the cycle is written. A cycle written before the field existed carries no
  // decision, and this falls back to the same `summariseCycle` the command falls back to: one
  // implementation invoked at read time, which is not the same thing as a second formula but is
  // also not "never recomputed", so it is said plainly here rather than claimed away.
  const summary = stored.decision ?? summariseCycle(stored);
  const scorer = legacyCycleScorerName(home, stored.runs ?? []);
  const headline = summary.issued
    ? `<div class="score">${number(summary.operator_score)}</div><div class="muted">Operator Score · median of ${number(summary.valid_runs)} valid run(s)</div>`
    : `<div class="withheld">Operator Score withheld</div><div class="muted">${summary.complete
      ? `${htmlEscape(summary.profile_bound_aggregation.reason)}: ${htmlEscape(summary.profile_bound_aggregation.detail ?? "")}`
      : `${number(summary.valid_runs)} of 3 valid run(s)`}</div>`;
  const excluded = summary.excluded
    .map((entry) => `<li>${htmlEscape(entry.seed)} — ${htmlEscape(entry.reason ?? "")}</li>`)
    .join("");
  // #568 round 6 NIT. The unknown-schema case used to return a card of its own before this point,
  // which dropped the seeds, the `N of 3 valid run(s)` progress and the cycle lines -- and since
  // `createCycle` writes `runs: []`, that stripped card was every freshly started cycle rather than
  // an anomalous one. What is unknown about such a cycle is its provenance, not its progress, so it
  // gets the same card and only the provenance line changes: still no claim that a legacy scorer
  // produced it, which is what round 2 fixed and what must not regress here.
  const provenance = schema === null
    ? `<p class="legacy-note">PROVENANCE UNRECORDED · ${number((stored.runs ?? []).length)} run(s) recorded no result schema; an absent schema is not evidence of a legacy scorer, so no aggregate provenance is claimed</p>`
    : `<p class="legacy-note">LEGACY / NOT COMPARABLE · ${htmlEscape(scorer)} · a legacy scorer aggregate, rendered as stored; not comparable with a v0.2.0 profile result</p>`;
  return `<section class="card"><h2>${htmlEscape(summary.cycle_id)}</h2>${headline}
${provenance}
<p class="muted">seeds ${htmlEscape(summary.seeds.join(", "))}</p>
${summary.issued ? `<p class="muted">spread ${number(summary.spread)} · deviation ${number(summary.mad)} · stability ${htmlEscape(summary.stability)} · local repeat evidence ${htmlEscape(summary.local_repeat_evidence)}</p>` : ""}
${excluded ? `<p class="muted">not counted:</p><ul class="muted">${excluded}</ul>` : ""}
<ul class="muted">${cycleLines(summary).map((line) => `<li>${htmlEscape(line)}</li>`).join("")}</ul>
${summary.issued ? `<p class="muted">PROFILE-BOUND: this number describes the declared environment and task pack.</p>` : ""}</section>`;
};

/**
 * The scorer identity behind a legacy cycle aggregate.
 *
 * #568. The aggregate is a legacy scorer's median and carries no scorer identity of its own:
 * `recordRun` (lib/cli.mjs) stores only `scorer_major`, an integer bucket the validity check
 * uses to decide whether a run belongs to this cycle, never the scorer's own id and version, so
 * neither a stored `decision` nor a freshly computed `summariseCycle` result has one to read.
 * That identity is not lost, though -- every run this cycle counted still has its own stored
 * result on disk, and the run row already reads exactly that file for exactly this string. This
 * reads the first one still readable, which is the same quote one level up, not a second
 * computation the run row and this note could disagree on.
 *
 * A cycle recorded before `recordRun` kept `run_id` at all -- every fixture in this file's own
 * tests predates it -- has nothing here to read by id; `validId` is checked first so that shape
 * withholds a name rather than crashing the page on `runPaths`' own requirement that an id be one.
 *
 * #568 round 2. The first pass reads only a run the median above actually counted (`valid: true`):
 * a run the cycle excluded -- a superseded seed, an infrastructure retry, a run that failed
 * validity for a reason unrelated to its scorer -- still has a readable result file on disk, and
 * reading whichever run's file happened to come first in the array let the aggregate be captioned
 * with a scorer that took no part in the median beside it.
 *
 * #568 round 3 BLOCKER. Two defects survived round 2. First, the counted pass still returned as
 * soon as it found one counted run's readable result, with nothing checking that every other
 * counted run named the same scorer -- so two counted runs recorded under two different scorer
 * identities had the first one in array order captioned as the whole aggregate's provenance, and
 * the disagreement never reached the page. It now reads every counted run's result and only
 * names a scorer when they all agree; when they do not, the caption says so instead of choosing
 * one of them arbitrarily. Second, the fallback pass read any run at all -- including one the
 * median excluded -- the moment no counted run's file was readable, and printed that run's
 * scorer as though it were the aggregate's own, with nothing in the caption saying the name came
 * from a run that took no part in producing the number beside it. That fallback is honest only
 * for the one shape round 2's own comment named: a cycle that predates `valid` entirely, which
 * `recordRun` (lib/cycle.mjs) never leaves half-written -- every run it appends carries a boolean
 * `valid`, so a cycle with even one boolean `valid` was written by code that also decided which
 * runs counted, and "the counted runs' files happen to be missing today" is not the same fact as
 * "this cycle never decided at all". The fallback now fires only when no run in the cycle carries
 * a boolean `valid`; everywhere else, an unreadable set of counted runs withholds a name rather
 * than borrowing one from a run the median did not count.
 */
export const legacyCycleScorerName = (home, runs) => {
  // #568 round 5 BLOCKER. `assertUniformResultSchema` reads `result_schema` off the cycle's own run
  // records, never off the files those records point at, so "this cycle is legacy" was decided from
  // cycle.json while the scorer name was taken from whatever JSON happened to be on disk. A result
  // file replaced with an object of any other shape carrying a `scorer` field was captioned as this
  // aggregate's provenance on its own say-so -- a stored artifact vouching for itself. A file that
  // is not a legacy result cannot testify about a legacy scorer, so it counts as no result here,
  // which is the same answer a missing file already gets.
  const readable = (run) => {
    if (!validId(run?.run_id)) return null;
    const result = readJsonIfExists(runPaths(home, run.run_id).result);
    if (result === null) return null;
    try {
      return isLegacyResult(result) ? result : null;
    } catch {
      // `resultKind` throws for a schema this build does not recognise rather than answering false,
      // and letting that escape would take the whole page down over one unreadable file. For this
      // caption an unrecognised record and a non-legacy one are the same answer: it cannot testify.
      return null;
    }
  };
  const counted = runs.filter((run) => run?.valid === true);
  const countedResults = counted.map(readable);
  const countedNames = countedResults.filter((result) => result !== null).map(legacyScorerName);
  const distinctCountedNames = [...new Set(countedNames)];
  // #568 round 4 BLOCKER. Dropping the unreadable runs before comparing made silence agree with
  // whatever was still on disk: a cycle with three counted runs and one readable result had that
  // one run's scorer captioned as the whole aggregate's provenance, and the two runs that recorded
  // nothing could not disagree with it. The agreement being tested has to be agreement among the
  // runs the median counted, not among the ones that happen to still be readable, so a counted run
  // whose result is gone withholds the name exactly as a disagreement does. The sibling case,
  // where NO counted run is readable, already withheld and is left alone: it has its own test and
  // its own wording, and widening this branch over it would have changed a behaviour round 3 had
  // already pinned -- which is how a fix quietly becomes a rewrite of someone else's test.
  if (countedNames.length > 0 && countedNames.length < counted.length) return "not every counted run's scorer is on disk";
  if (distinctCountedNames.length === 1) return distinctCountedNames[0];
  if (distinctCountedNames.length > 1) return "the counted runs disagree on scorer";
  const cyclePredatesValid = runs.every((run) => typeof run?.valid !== "boolean");
  if (cyclePredatesValid) {
    for (const run of runs) {
      const result = readable(run);
      if (result !== null) return legacyScorerName(result);
    }
  }
  return legacyScorerName(null);
};

const runLink = (runId, token) => `<a href="/run/${encodeURIComponent(runId)}?t=${encodeURIComponent(token)}">${htmlEscape(runId)}</a>`;

// What a run may claim, for the listing. Two runs identical in status, score and coverage can be a
// profile-bound measurement and a run diagnostic over a model nobody named, and a row that cannot
// tell them apart is the row an operator reads first (#561).
const claimCell = (result) => {
  const identity = result?.model_identity ?? null;
  if (identity === null) return "—";
  const aggregation = identity.profile_bound_aggregation ?? null;
  return `${identity.claim_stage}${aggregation && aggregation.status !== "issued" ? ` · ${aggregation.reason}` : ""}`;
};

/**
 * One table per instrument, each under its own headings.
 *
 * A profile result has no score, and putting its claim stage and three-profile summary into columns
 * headed `Status`, `Score` and `Observed` is the hero this release removed, re-drawn by the table
 * header. Legacy runs keep their own table because they are legacy records and reading them as
 * anything else is the migration this schema does not do.
 */
const runTables = (home, runIds, token) => {
  const profiles = [];
  const legacy = [];
  const unreadable = [];
  for (const runId of runIds) {
    const result = readJsonIfExists(runPaths(home, runId).result);
    if (result === null) {
      unreadable.push(`<tr><td>${runLink(runId, token)}</td><td>no result</td></tr>`);
      continue;
    }
    try {
      if (isLegacyResult(result)) {
        const score = result.score ? `${number(result.score.final)} (${result.score.band})` : "withheld";
        // #568. The band stays as stored -- rewriting it would be the silent migration the schema
        // does not do -- and the row says whose verdict it is, at the same hierarchy as the score.
        legacy.push(`<tr><td>${runLink(runId, token)}</td><td>${htmlEscape(result.status ?? "no result")}</td><td>${htmlEscape(score)}</td><td>${number(result.coverage?.observed)} / ${number(result.coverage?.total)}</td><td>${htmlEscape(claimCell(result))}</td><td>${htmlEscape(`LEGACY / NOT COMPARABLE · ${legacyScorerName(result)}`)}</td></tr>`);
        continue;
      }
      const view = projectResult(result);
      // #568 round 2. `view.summary`, `view.claim.stage` and `view.process.coverage` are identical
      // for a calibrated and an uncalibrated run of the same number, and for a run with facet
      // records bound and one without -- this table is a surface that prints the number, so without
      // the uncertainty status, its interval and the facet coverage counts it is the hero this
      // release removed, handed back one column at a time. Quoted from the same `view.claim.*`
      // fields the markdown, the HTML, the card and the terminal already print, never recomputed.
      const uncertainty = `${view.claim.uncertainty} (${view.claim.uncertainty_interval})`;
      const coverage = `${view.claim.facet_coverage} · ${view.claim.uncertainty_counts}`;
      profiles.push(`<tr><td>${runLink(runId, token)}</td><td>${htmlEscape(view.claim.stage)}</td><td>${htmlEscape(view.summary)}</td><td>${htmlEscape(view.process.coverage)}</td><td>${htmlEscape(uncertainty)}</td><td>${htmlEscape(coverage)}</td></tr>`);
    } catch (error) {
      // Named, not rendered. A result this build cannot read is not a result to draw a number from.
      unreadable.push(`<tr><td>${runLink(runId, token)}</td><td>${htmlEscape(error.message)}</td></tr>`);
    }
  }
  const table = (title, headings, rows) => (rows.length === 0 ? "" :
    `<h2>${htmlEscape(title)}</h2><table><thead><tr>${headings.map((heading) => `<th>${htmlEscape(heading)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`);
  return [
    table("Profile results", ["Run", "Claim", "Profiles", "Coverage", "Uncertainty", "Facet coverage"], profiles),
    table("Legacy results", ["Run", "Status", "Score", "Observed", "Claim", "Provenance"], legacy),
    table("Not readable", ["Run", "Why"], unreadable)
  ].join("");
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
      return send(
        200,
        page(
          "AOS runs",
          `<h1>Runs</h1>${cycleSection(home)}<p class="muted">${number(runs.length)} run(s) in this home. Read only; nothing here can be changed from a browser.</p>${runTables(home, runs, token)}`
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
      // A result of an instrument this build does not recognise is named, not drawn: rendering it
      // as the nearest schema is how a stored file gets read as a score it never carried.
      try {
        return send(200, renderHtml(result));
      } catch (error) {
        return send(422, page("Not readable", `<p>${htmlEscape(error.message)}</p>`));
      }
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
