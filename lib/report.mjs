import { htmlEscape } from "./core.mjs";
import { DIMENSIONS, METRICS } from "./metrics.mjs";

// What a result looks like to a person.
//
// The number is the smallest part of it. What a reader needs is which of the twenty metrics went
// wrong, which of that metric's four questions was answered no, what the ceiling was and why, and
// what the run could not observe at all -- because a score with none of that is a number they can
// only accept or reject.

const PROFILE_BOUND = "PROFILE-BOUND — measured in the declared environment and task pack. Two numbers from different agents, models or machines are two different measurements.";

const percent = (value) => (Number.isFinite(value) ? `${Math.round(value)}` : "n/o");

/**
 * A number, or nothing.
 *
 * The scorer produces numbers, so these were interpolated raw. A result.json is a file on disk in
 * a directory an assessed agent runs beside, and a string where a number belongs is markup in the
 * operator's browser as soon as they open the dashboard. Fields are checked for what they are
 * rather than trusted to be it.
 */
const number = (value) => (Number.isFinite(value) ? String(value) : "—");

/** Failures first: a table read top to bottom should start with what to fix. */
const STATE_ORDER = { FAIL: 0, PARTIAL_LOW: 1, PARTIAL: 2, PARTIAL_HIGH: 3, PASS: 4, NOT_OBSERVED: 5 };
const ordered = (metrics) =>
  [...metrics].sort(
    (a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || a.metric_id.localeCompare(b.metric_id)
  );

const failedSubchecks = (observation) =>
  observation.subchecks.filter((entry) => !entry.pass).map((entry) => entry.id);

/**
 * The one metric to fix first, and what to look at.
 *
 * The lowest observed value, breaking ties by weight so a failure in the quarter of the scale that
 * is verification outranks the same failure in a fifteenth. It names the failed subchecks rather
 * than offering advice: the product knows which question was answered no, and it does not know
 * what the operator should do about it.
 */
export function primaryConstraint(result) {
  const metrics = (Array.isArray(result.metrics) ? result.metrics : []).filter((entry) => entry.value !== null);
  if (metrics.length === 0) return null;
  const weightOf = (entry) => DIMENSIONS[entry.dimension]?.weight ?? 0;
  const worst = metrics.reduce((lowest, entry) =>
    entry.value < lowest.value || (entry.value === lowest.value && weightOf(entry) > weightOf(lowest)) ? entry : lowest
  );
  if (worst.value === 1) return null;
  const failed = failedSubchecks(worst);
  return {
    metric_id: worst.metric_id,
    title: METRICS[worst.metric_id]?.title ?? "",
    failed,
    lever: `${worst.metric_id} ${METRICS[worst.metric_id]?.title ?? ""}: ${failed.join(", ")} was answered no. ${worst.reason}.`
  };
}

export function renderMarkdown(result) {
  const metrics = Array.isArray(result.metrics) ? result.metrics : [];
  const lines = [
    "# Agent Operator Score",
    "",
    `- Run: \`${result.run_id}\``,
    `- Status: **${result.status}**`,
    result.score
      ? `- Score: **${result.score.final} / 100** (${result.score.band})${result.score.final < result.score.raw ? ` — capped from ${result.score.raw}` : ""}`
      : `- Score: **withheld** (provisional ${result.provisional_raw})`,
    `- Observed: **${result.coverage.observed} of ${result.coverage.total}**`,
    `- ${PROFILE_BOUND}`,
    ""
  ];

  const constraint = primaryConstraint(result);
  if (constraint) {
    lines.push("## Fix this first", "", `- **${constraint.metric_id} ${constraint.title}** — ${constraint.failed.join(", ")}`, "");
  }

  if (result.blockers?.length) {
    lines.push("## Why there is no score", "");
    for (const blocker of result.blockers) lines.push(`- **${blocker.code}** — ${blocker.detail ?? ""}`);
    lines.push("");
  }

  if (result.caps?.length) {
    lines.push("## Ceilings", "");
    for (const cap of result.caps) lines.push(`- **${cap.code}** caps this run at ${cap.max}: ${cap.reason}`);
    lines.push("");
  }

  lines.push("## Dimensions", "", "| Dimension | Score | Weight |", "|---|---:|---:|");
  for (const [id, meta] of Object.entries(DIMENSIONS)) {
    lines.push(`| ${id} ${meta.title} | ${percent(result.dimensions[id])} | ${Math.round(meta.weight * 100)}% |`);
  }

  lines.push("", "## Metrics", "", "| ID | Dim | Metric | Score | State | Failed checks | Reason |", "|---|---|---|---:|---|---|---|");
  for (const observation of ordered(metrics)) {
    const failures = failedSubchecks(observation);
    lines.push(
      `| ${observation.metric_id} | ${observation.dimension} | ${METRICS[observation.metric_id]?.title ?? ""} | ${observation.value === null ? "n/o" : Math.round(observation.value * 100)} | ${observation.state} | ${failures.join(", ") || "—"} | ${observation.reason} |`
    );
  }

  lines.push("", "## Limitations", "");
  for (const limitation of result.limitations ?? []) lines.push(`- ${limitation}`);
  lines.push("");
  return lines.join("\n");
}

export function renderHtml(result) {
  const metrics = Array.isArray(result.metrics) ? result.metrics : [];
  const dimensionRows = Object.entries(DIMENSIONS)
    .map(([id, meta]) => {
      const value = result.dimensions[id];
      const width = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
      return `<tr><th>${htmlEscape(id)} ${htmlEscape(meta.title)}</th><td class="bar"><span style="width:${width}%"></span></td><td>${htmlEscape(percent(value))}</td><td class="muted">${Math.round(meta.weight * 100)}%</td></tr>`;
    })
    .join("");

  const metricRows = ordered(metrics)
    .map((observation) => {
      const failures = failedSubchecks(observation);
      const detail = (observation.subchecks ?? [])
        .map((entry) => `<li class="${entry.pass ? "ok" : "no"}">${entry.pass ? "pass" : "FAIL"} — ${htmlEscape(entry.id)}</li>`)
        .join("");
      // The state is spelled out in a cell of its own as well as shaded, because colour alone is not
      // a way to tell a reader that something failed.
      return `<tr class="s-${htmlEscape(observation.state)}"><th scope="row">${htmlEscape(observation.metric_id)}</th><td>${htmlEscape(observation.dimension)}</td><td>${htmlEscape(METRICS[observation.metric_id]?.title ?? "")}</td><td class="num">${Number.isFinite(observation.value) ? Math.round(observation.value * 100) : "—"}</td><td>${htmlEscape(observation.state)}</td><td class="num">${number(observation.evidence_ids?.length)}</td><td><details><summary>${failures.length ? htmlEscape(`${failures.length} of four failed`) : "all four passed"}</summary><ul>${detail}</ul><p class="muted">${htmlEscape(observation.reason)} · ${htmlEscape(observation.verifier_id ?? "no verifier")}</p></details></td></tr>`;
    })
    .join("");

  const caps = (result.caps ?? [])
    .map((cap) => `<li><strong>${htmlEscape(cap.code)}</strong> caps at ${number(cap.max)} — ${htmlEscape(cap.reason)}</li>`)
    .join("");
  const blockers = (result.blockers ?? [])
    .map((blocker) => `<li><strong>${htmlEscape(blocker.code)}</strong> — ${htmlEscape(blocker.detail ?? "")}</li>`)
    .join("");
  const limitations = (result.limitations ?? []).map((item) => `<li>${htmlEscape(item)}</li>`).join("");
  const constraint = primaryConstraint(result);

  // Self-contained: no font, no script, no request. A report that fetched anything would report the
  // fact that it had been opened, and this is a local artifact about the operator's own work.
  const style = `:root{--bg:#fff;--surface:#fafafa;--border:#e2e2e2;--text:#171717;--muted:#5c5c5c;--accent:#1a5fb4;--good:#136a3a;--warn:#8a5a00;--bad:#a01b1b;--radius:8px}
@media(prefers-color-scheme:dark){:root{--bg:#111;--surface:#191919;--border:#333;--text:#ededed;--muted:#a3a3a3;--accent:#7aa7e0;--good:#5ec98a;--warn:#e0b25c;--bad:#e07a7a}}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;max-width:1000px;margin:32px auto;padding:0 16px;line-height:1.45}
header{border-bottom:1px solid var(--border);padding-bottom:16px}
.score{font-size:60px;font-weight:750;letter-spacing:-.04em;line-height:1}
.withheld{font-size:30px;font-weight:650;color:var(--warn)}
.muted{color:var(--muted);font-size:13px}
.bound{margin:8px 0 0;font-size:13px;color:var(--muted)}
h2{font-size:16px;margin:20px 0 6px}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}
thead th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.bar{width:38%}
td.bar span{display:block;height:9px;background:var(--accent);border-radius:2px;min-width:1px}
tr.s-FAIL th,tr.s-PARTIAL_LOW th{color:var(--bad);font-weight:700}
tr.s-NOT_OBSERVED{color:var(--muted)}
ul{margin:6px 0;padding-left:18px}
li.ok{color:var(--good)}
li.no{color:var(--bad);font-weight:600}
details summary{cursor:pointer}
details summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;margin:12px 0}
.card.lever{border-left:3px solid var(--accent)}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{details{display:block}details>ul{display:block}body{max-width:none}.card{break-inside:avoid}}
@media(max-width:640px){body{margin:16px auto}.score{font-size:44px}td.bar{width:30%}table{font-size:12px}}`;

  const headline = result.score
    ? `<div class="score">${number(result.score.final)}</div><div class="muted">${htmlEscape(result.score.band)}${result.score.final < result.score.raw ? ` · capped from ${number(result.score.raw)}` : ""}</div>`
    : `<div class="withheld">Score withheld</div><div class="muted">provisional ${number(result.provisional_raw)} · ${number(result.coverage?.observed)} of ${number(result.coverage?.total)} observed</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AOS ${htmlEscape(result.run_id)}</title><style>${style}</style></head><body>
<header><div class="muted">${htmlEscape(result.status)} · run ${htmlEscape(result.run_id)}</div>${headline}<p class="bound">${htmlEscape(PROFILE_BOUND)}</p></header>
${constraint ? `<section class="card lever"><h2>Fix this first</h2><p><strong>${htmlEscape(constraint.metric_id)} ${htmlEscape(constraint.title)}</strong></p><p>${htmlEscape(constraint.lever)}</p></section>` : ""}
${blockers ? `<section class="card"><h2>Why there is no score</h2><ul>${blockers}</ul></section>` : ""}
${caps ? `<section class="card"><h2>Ceilings</h2><ul>${caps}</ul></section>` : ""}
<h2>Dimensions</h2><table><thead><tr><th scope="col">Dimension</th><th scope="col">Score</th><th scope="col">Value</th><th scope="col">Weight</th></tr></thead><tbody>${dimensionRows}</tbody></table>
<h2>Metrics</h2><table><thead><tr><th scope="col">ID</th><th scope="col">Dim</th><th scope="col">Metric</th><th scope="col">Score</th><th scope="col">State</th><th scope="col">Evidence</th><th scope="col">Checks</th></tr></thead><tbody>${metricRows}</tbody></table>
<section class="card"><h2>Limitations</h2><ul>${limitations}</ul></section>
</body></html>`;
}
