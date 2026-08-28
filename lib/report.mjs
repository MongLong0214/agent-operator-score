import { htmlEscape } from "./core.mjs";
import { DIMENSIONS, METRICS } from "./metrics.mjs";

// What a result looks like to a person.
//
// The number is the smallest part of it. What a reader needs is which of the twenty metrics went
// wrong, which of that metric's four questions was answered no, what the ceiling was and why, and
// what the run could not observe at all -- because a score with none of that is a number they can
// only accept or reject.

const PROFILE_BOUND = "PROFILE-BOUND — measured in the declared environment and task pack. Two numbers from different agents, models or machines are two different measurements.";

const percent = (value) => (value === null || value === undefined ? "n/o" : `${Math.round(value)}`);

/** Failures first: a table read top to bottom should start with what to fix. */
const STATE_ORDER = { FAIL: 0, PARTIAL_LOW: 1, PARTIAL: 2, PARTIAL_HIGH: 3, PASS: 4, NOT_OBSERVED: 5 };
const ordered = (metrics) =>
  [...metrics].sort(
    (a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || a.metric_id.localeCompare(b.metric_id)
  );

const failedSubchecks = (observation) =>
  observation.subchecks.filter((entry) => !entry.pass).map((entry) => entry.id);

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

  lines.push("", "## Metrics", "", "| ID | Metric | State | Failed checks | Reason |", "|---|---|---|---|---|");
  for (const observation of ordered(metrics)) {
    const failures = failedSubchecks(observation);
    lines.push(
      `| ${observation.metric_id} | ${METRICS[observation.metric_id]?.title ?? ""} | ${observation.state} | ${failures.join(", ") || "—"} | ${observation.reason} |`
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
      const width = value === null ? 0 : Math.max(0, Math.min(100, value));
      return `<tr><th>${htmlEscape(id)} ${htmlEscape(meta.title)}</th><td class="bar"><span style="width:${width}%"></span></td><td>${htmlEscape(percent(value))}</td><td class="muted">${Math.round(meta.weight * 100)}%</td></tr>`;
    })
    .join("");

  const metricRows = ordered(metrics)
    .map((observation) => {
      const failures = failedSubchecks(observation);
      const detail = observation.subchecks
        .map((entry) => `<li class="${entry.pass ? "ok" : "no"}">${htmlEscape(entry.id)}</li>`)
        .join("");
      return `<tr class="s-${htmlEscape(observation.state)}"><td>${htmlEscape(observation.metric_id)}</td><td>${htmlEscape(METRICS[observation.metric_id]?.title ?? "")}</td><td>${htmlEscape(observation.state)}</td><td>${observation.value === null ? "—" : Math.round(observation.value * 100)}</td><td><details><summary>${failures.length ? htmlEscape(`${failures.length} failed`) : "all four"}</summary><ul>${detail}</ul><p class="muted">${htmlEscape(observation.reason)} · ${htmlEscape(observation.verifier_id ?? "no verifier")}</p></details></td></tr>`;
    })
    .join("");

  const caps = (result.caps ?? [])
    .map((cap) => `<li><strong>${htmlEscape(cap.code)}</strong> caps at ${cap.max} — ${htmlEscape(cap.reason)}</li>`)
    .join("");
  const blockers = (result.blockers ?? [])
    .map((blocker) => `<li><strong>${htmlEscape(blocker.code)}</strong> — ${htmlEscape(blocker.detail ?? "")}</li>`)
    .join("");
  const limitations = (result.limitations ?? []).map((item) => `<li>${htmlEscape(item)}</li>`).join("");

  // Self-contained: no font, no script, no request. A report that fetched anything would leak the
  // fact that it was opened, and this is a local artifact about the operator's own work.
  const style = `body{font-family:system-ui,-apple-system,sans-serif;max-width:960px;margin:40px auto;padding:0 20px;color:#171717;line-height:1.5}
header{border-bottom:1px solid #ddd;padding-bottom:20px}
.score{font-size:64px;font-weight:750;letter-spacing:-.04em;line-height:1}
.withheld{font-size:32px;font-weight:650;color:#8a6d00}
.muted{color:#666;font-size:14px}
.bound{margin:8px 0 0;font-size:13px;color:#666}
table{width:100%;border-collapse:collapse;margin:20px 0;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e5e5;vertical-align:top}
td.bar{width:40%}
td.bar span{display:block;height:10px;background:#171717;border-radius:2px}
tr.s-FAIL td:first-child,tr.s-PARTIAL_LOW td:first-child{font-weight:700}
tr.s-NOT_OBSERVED{color:#8a8a8a}
ul{margin:6px 0;padding-left:18px}
li.ok::marker{content:"✓ "}
li.no::marker{content:"✗ "}
li.no{font-weight:600}
details summary{cursor:pointer}
.card{border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}.muted,.bound,tr.s-NOT_OBSERVED{color:#9a9a9a}.card,th,td,header{border-color:#333}td.bar span{background:#eee}}
@media print{details{display:block}details>ul{display:block}}`;

  const headline = result.score
    ? `<div class="score">${result.score.final}</div><div class="muted">${htmlEscape(result.score.band)}${result.score.final < result.score.raw ? ` · capped from ${result.score.raw}` : ""}</div>`
    : `<div class="withheld">Score withheld</div><div class="muted">provisional ${result.provisional_raw} · ${result.coverage.observed} of ${result.coverage.total} observed</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AOS ${htmlEscape(result.run_id)}</title><style>${style}</style></head><body>
<header><div class="muted">${htmlEscape(result.status)} · run ${htmlEscape(result.run_id)}</div>${headline}<p class="bound">${htmlEscape(PROFILE_BOUND)}</p></header>
${blockers ? `<section class="card"><h2>Why there is no score</h2><ul>${blockers}</ul></section>` : ""}
${caps ? `<section class="card"><h2>Ceilings</h2><ul>${caps}</ul></section>` : ""}
<h2>Dimensions</h2><table>${dimensionRows}</table>
<h2>Metrics</h2><table><thead><tr><th>ID</th><th>Metric</th><th>State</th><th>Score</th><th>Checks</th></tr></thead><tbody>${metricRows}</tbody></table>
<section class="card"><h2>Limitations</h2><ul>${limitations}</ul></section>
</body></html>`;
}
