import { htmlEscape } from "./core.mjs";
import { modelIdentityLines } from "./model-identity.mjs";
import { renderCard } from "./report-card.mjs";
import { DIMENSIONS, METRICS } from "./metrics.mjs";
import {
  BAND_NAMES, BLOCKER_REASONS, CAP_REASONS, DIMENSION_TITLES, LIMITATIONS, METRIC_TITLES,
  STATE_NAMES, T,
  languageOf, localeFromEnvironment, pick
} from "./report-i18n.mjs";

// What a result looks like to a person.
//
// The number is the smallest part of it. What a reader needs is which of the twenty metrics went
// wrong, which of that metric's four questions was answered no, what the ceiling was and why, and
// what the run could not observe at all -- because a score with none of that is a number they can
// only accept or reject.

const PROFILE_BOUND = "PROFILE-BOUND — measured in the declared environment and task pack. Two numbers from different agents, models or machines are two different measurements.";
const RUN_DIAGNOSTIC = "RUN-DIAGNOSTIC — this run's own result. The model or the executable it ran under is not established, so it may not join a profile-bound aggregate.";

// The claim stage the record reached, and nothing stronger. This was printed unconditionally, so a
// report over a model nobody could name carried the profile-bound sentence in its header and
// "Profile-bound aggregation: withheld" four lines below it (#561).
const claimLine = (result) => (result?.model_identity?.claim_stage === "PROFILE_BOUND" ? PROFILE_BOUND : RUN_DIAGNOSTIC);

// The lines the record itself stored, quoted. Recomputing them here meant Markdown and HTML could
// disagree with the JSON they were rendered from -- the projection is part of the record, not a
// function three surfaces each call with their own argument. A result older than the record has
// none, and gets the historical projection by name.
const identityLines = (result) =>
  Array.isArray(result?.model_identity?.lines) ? result.model_identity.lines : modelIdentityLines(null);

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

// `!entry.pass` counted an unobserved subcheck as a failed one, so a metric whose four questions
// were never asked rendered as "4 of four failed" -- next to a state cell reading NOT_OBSERVED.
// Same category error as #477, one layer up: absence of an answer is not a "no".
const failedSubchecks = (observation) =>
  (observation.subchecks ?? []).filter((entry) => entry.pass === false).map((entry) => entry.id);

/**
 * The one metric to fix first, and what to look at.
 *
 * The lowest observed value, breaking ties by weight so a failure in the quarter of the scale that
 * is verification outranks the same failure in a fifteenth. It names the failed subchecks rather
 * than offering advice: the product knows which question was answered no, and it does not know
 * what the operator should do about it.
 */
// Which metric each ceiling is decided from. A cap is the only thing that can make everything else
// irrelevant, so it outranks a low score when choosing what to fix first.
const CAP_METRIC = {
  CRITICAL_SAFETY: "M19",
  FALSE_COMPLETION: "M17",
  IGNORED_CRITICAL_ERROR: "M11",
  EXACT_REVISION_MISSING: "M16"
};

export function primaryConstraint(result) {
  const metrics = (Array.isArray(result.metrics) ? result.metrics : []).filter((entry) => entry.value !== null);
  if (metrics.length === 0) return null;
  const weightOf = (entry) => DIMENSIONS[entry.dimension]?.weight ?? 0;

  // The lowest ceiling that applied, before the lowest score. This picked the lowest observed value,
  // so a report could lead with a metric at 50 while a metric at 75 was capping the whole run at 39 --
  // and an operator who fixed what it named would not have touched the thing holding the number down.
  const lowestCap = (result.caps ?? [])
    .filter((cap) => CAP_METRIC[cap.code])
    .sort((a, b) => (a.max ?? 100) - (b.max ?? 100))[0];
  const capped = lowestCap && metrics.find((entry) => entry.metric_id === CAP_METRIC[lowestCap.code] && entry.value < 1);

  const worst = capped ?? metrics.reduce((lowest, entry) =>
    entry.value < lowest.value || (entry.value === lowest.value && weightOf(entry) > weightOf(lowest)) ? entry : lowest
  );
  if (worst.value === 1) return null;
  const failed = failedSubchecks(worst);
  return {
    metric_id: worst.metric_id,
    title: METRICS[worst.metric_id]?.title ?? "",
    failed,
    reason: worst.reason ?? "",
    caps_the_run: Boolean(capped && capped.metric_id === worst.metric_id),
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
    `- ${claimLine(result)}`,
    // The same strings the JSON and the CLI carry (#561): which model, which executable, which
    // profile, and whether this number may join a profile-bound aggregate. Quoted rather than
    // re-derived so that the three surfaces cannot say three things.
    ...identityLines(result).map((line) => `- ${line}`),
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

/**
 * The result as a page, in the operator's language.
 *
 * Both languages are written into the file and CSS hides one. That costs a few kilobytes and buys
 * two things: the artifact stays self-contained -- no font, no script fetch, no request of any kind
 * -- and a report sent to a colleague reads in *their* language rather than in the language of the
 * machine that produced it. The initial choice comes from the operator's own locale, so the file is
 * already correct with scripting disabled; the toggle and the `navigator.language` preference are
 * progressive enhancement over that, not the mechanism.
 */
export function renderHtml(result, { locale = localeFromEnvironment(process.env) } = {}) {
  const language = languageOf(locale);
  const metrics = Array.isArray(result.metrics) ? result.metrics : [];

  // Both languages, one hidden. Escaped on the way in, like every other string here.
  const t = (key) => {
    const entry = T[key] ?? {};
    return `<span class="en">${htmlEscape(entry.en ?? "")}</span><span class="ko">${htmlEscape(entry.ko ?? entry.en ?? "")}</span>`;
  };
  const both = (entry) =>
    `<span class="en">${htmlEscape(pick(entry, "en"))}</span><span class="ko">${htmlEscape(pick(entry, "ko"))}</span>`;
  const plain = (key) => htmlEscape(pick(T[key], language));

  const dimensionRows = Object.entries(DIMENSIONS)
    .map(([id, meta]) => {
      const value = result.dimensions?.[id];
      const width = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
      const measured = Number.isFinite(value);
      return `<tr><th scope="row"><span class="did">${htmlEscape(id)}</span> ${both(DIMENSION_TITLES[id])}</th>`
        + `<td class="bar"><span class="${measured ? "" : "unmeasured"}" style="width:${measured ? width : 100}%"></span></td>`
        + `<td class="num">${measured ? Math.round(value) : "—"}</td>`
        + `<td class="num muted">${Math.round(meta.weight * 100)}%</td></tr>`;
    })
    .join("");

  const metricRows = ordered(metrics)
    .map((observation) => {
      const failures = failedSubchecks(observation);
      const detail = (observation.subchecks ?? [])
        .map((entry) => `<li class="${entry.pass ? "ok" : entry.pass === false ? "no" : "unknown"}">${entry.pass ? "pass" : entry.pass === false ? "FAIL" : "n/o"} — ${htmlEscape(entry.id)}</li>`)
        .join("");
      const stateText = STATE_NAMES[observation.state] ?? { en: observation.state, ko: observation.state };
      const summary = observation.state === "NOT_OBSERVED"
        ? t("notObservedSummary")
        : failures.length
          ? `<span class="en">${failures.length} of four failed</span><span class="ko">${failures.length} / 4 실패</span>`
          : t("allFourPassed");
      // The state is spelled out in a cell of its own as well as shaded, because colour alone is not
      // a way to tell a reader that something failed.
      return `<tr class="s-${htmlEscape(observation.state)}">`
        + `<th scope="row">${htmlEscape(observation.metric_id)}</th>`
        + `<td class="muted">${htmlEscape(observation.dimension)}</td>`
        + `<td>${both(METRIC_TITLES[observation.metric_id] ?? { en: METRICS[observation.metric_id]?.title ?? "" })}</td>`
        + `<td class="num">${Number.isFinite(observation.value) ? Math.round(observation.value * 100) : "—"}</td>`
        + `<td><span class="chip c-${htmlEscape(observation.state)}">${both(stateText)}</span></td>`
        + `<td class="num">${number(observation.evidence_ids?.length)}</td>`
        + `<td><details><summary>${summary}</summary><ul>${detail}</ul>`
        + `<p class="muted">${htmlEscape(observation.reason ?? "")} · ${htmlEscape(observation.verifier_id ?? pick(T.noVerifier, language))}</p></details></td></tr>`;
    })
    .join("");

  const caps = (result.caps ?? [])
    .map((cap) => {
      const reason = CAP_REASONS[cap.code] ?? { en: cap.reason ?? "", ko: cap.reason ?? "" };
      return `<li><strong>${htmlEscape(cap.code)}</strong> ${t("capsAt")} <span class="capnum">${number(cap.max)}</span> — ${both(reason)}</li>`;
    })
    .join("");
  const blockers = (result.blockers ?? [])
    .map((blocker) => {
      const why = BLOCKER_REASONS[blocker.code];
      // The code and the run's own detail stay as recorded; only the explanation is translated.
      return `<li><strong>${htmlEscape(blocker.code)}</strong>${why ? ` — ${both(why)}` : ""}`
        + `${blocker.detail ? `<div class="muted">${htmlEscape(blocker.detail)}</div>` : ""}</li>`;
    })
    .join("");
  const limitations = (result.limitations ?? [])
    .map((item) => {
      const known = LIMITATIONS.find((entry) => entry.match.test(item));
      return `<li>${both({ en: item, ko: known?.ko ?? item })}</li>`;
    })
    .join("");
  const constraint = primaryConstraint(result);

  // What the number is bound to, promoted out of a footnote. An audit report that does not carry its
  // own conditions is a number the next reader will compare with one measured somewhere else.
  const isolation = result.isolation ?? {};
  const runtimeAuth = isolation.runtime_auth_env_names ?? [];
  const agents = (result.agent_portfolio?.used ?? []).join(", ");
  const conditions = [
    [t("conditionAgents"), htmlEscape(agents || pick(T.none, language))],
    [t("conditionIsolation"), htmlEscape(isolation.level ?? "—")],
    [t("conditionRuntimeAuth"), runtimeAuth.length ? htmlEscape(runtimeAuth.join(", ")) : t("none")],
    [t("conditionSeed"), htmlEscape(String(result.seed ?? "—"))],
    [t("conditionCoverage"), `${number(result.coverage?.observed)} / ${number(result.coverage?.total)}`],
    [t("conditionProfile"), `<code>${htmlEscape(String(result.profile_digest ?? "—").slice(0, 20))}</code>`],
    [t("conditionSuite"), `<code>${htmlEscape(String(result.suite_digest ?? "—").slice(0, 20))}</code>`]
  ].map(([label, value]) => `<div class="cond"><dt>${label}</dt><dd>${value}</dd></div>`).join("");

  const band = result.score?.band;
  const gauge = result.score
    ? `<div class="gauge b-${htmlEscape(band ?? "")}">
<svg viewBox="0 0 120 120" role="img" aria-label="${htmlEscape(`${result.score.final} ${pick(T.outOf, language)}`)}">
<circle class="track" cx="60" cy="60" r="52"></circle>
<circle class="fill" cx="60" cy="60" r="52" stroke-dasharray="${(Math.max(0, Math.min(100, result.score.final)) * 3.2673).toFixed(1)} 326.73"></circle>
</svg>
<div class="gnum"><span>${number(result.score.final)}</span><small>/100</small></div></div>`
    : `<div class="gauge withheld"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="52"></circle></svg><div class="gnum"><span>—</span></div></div>`;

  const headline = result.score
    ? `<div class="band b-${htmlEscape(band ?? "")}">${both(BAND_NAMES[band] ?? { en: band ?? "" })}</div>`
      + (result.score.final < result.score.raw
        ? `<div class="muted">${t("cappedFrom")} ${number(result.score.raw)}</div>` : "")
    : `<div class="withheld-title">${t("scoreWithheld")}</div>`
      + `<div class="muted">${t("provisional")} ${number(result.provisional_raw)}${t("provisionalSuffix")}`
      + ` · ${number(result.coverage?.observed)} ${t("observedOf")} ${number(result.coverage?.total)} ${t("measuredCount")}</div>`;

  // Self-contained: no font, no stylesheet, no image, no request. A report that fetched anything
  // would report the fact that it had been opened, and this is a local artifact about the
  // operator's own work. The one script is eight lines, touches only this document, and the page is
  // already correct in the operator's language without it.
  const style = `:root{color-scheme:light dark;--bg:#fff;--surface:#fafafa;--raised:#f4f4f5;--border:#e4e4e7;--text:#18181b;--muted:#71717a;--accent:#1a5fb4;--good:#136a3a;--warn:#8a5a00;--bad:#a01b1b;--radius:10px}
@media(prefers-color-scheme:dark){:root{--bg:#0c0c0e;--surface:#141417;--raised:#1c1c20;--border:#2a2a30;--text:#ededf0;--muted:#9a9aa5;--accent:#7aa7e0;--good:#5ec98a;--warn:#e0b25c;--bad:#e88}}
*{box-sizing:border-box}
.ko{display:none}
#lang:checked ~ * .ko,#lang:checked ~ .ko{display:inline}
#lang:checked ~ * .en,#lang:checked ~ .en{display:none}
#lang{position:absolute;width:1px;height:1px;opacity:0}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;max-width:1060px;margin:0 auto;padding:32px 20px 64px;line-height:1.5;-webkit-text-size-adjust:100%}
a{color:var(--accent)}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}
.status{font-size:12px;letter-spacing:.06em;color:var(--muted)}
.status .st{text-transform:uppercase;font-weight:600}
label[for=lang]{font-size:12px;padding:5px 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text);cursor:pointer;white-space:nowrap}
label[for=lang]:hover{background:var(--raised)}
#lang:focus-visible+.topbar label[for=lang]{outline:2px solid var(--accent);outline-offset:2px}
header{display:flex;gap:28px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--border);padding-bottom:24px}
.gauge{position:relative;width:132px;height:132px;flex:none}
.gauge svg{width:100%;height:100%;transform:rotate(-90deg)}
.gauge circle{fill:none;stroke-width:9}
.gauge .track{stroke:var(--border)}
.gauge .fill{stroke:var(--accent);stroke-linecap:round}
.b-HIGH_RELIABILITY .fill{stroke:#0d9488}.b-ADVANCED .fill{stroke:var(--good)}.b-OPERATIONAL .fill{stroke:#ca8a04}.b-DEVELOPING .fill{stroke:#ea580c}.b-FRAGILE .fill{stroke:var(--bad)}
.gnum{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.gnum span{font-size:42px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1}
.gnum small{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.leadline{margin:0 0 6px;font-size:15px}
.card code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:var(--raised);padding:1px 5px;border-radius:4px}
.headline{min-width:240px;flex:1}
.band{font-size:20px;font-weight:650;letter-spacing:-.01em}
.b-HIGH_RELIABILITY.band{color:#0d9488}.b-ADVANCED.band{color:var(--good)}.b-OPERATIONAL.band{color:#ca8a04}.b-DEVELOPING.band{color:#ea580c}.b-FRAGILE.band{color:var(--bad)}
.withheld-title{font-size:26px;font-weight:650;color:var(--warn)}
.muted{color:var(--muted);font-size:13px}
.bound{margin:14px 0 0;font-size:12.5px;color:var(--muted);border-left:2px solid var(--border);padding-left:12px}
h2{font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:32px 0 10px;font-weight:600}
section.card h2{margin-top:0}
.conds{display:flex;flex-wrap:wrap;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin:0}
.cond{background:var(--surface);padding:10px 14px;flex:1 1 172px;min-width:0}
.cond dt{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.cond dd{margin:3px 0 0;font-size:13px;word-break:break-all}
.cond code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
table{width:100%;border-collapse:collapse;margin:0 0 8px;font-size:13.5px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:top}
thead th{position:sticky;top:0;background:var(--bg);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;z-index:1}
tbody tr:hover{background:var(--surface)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.did{font-variant-numeric:tabular-nums;color:var(--muted);font-weight:500;margin-right:4px}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
td.bar{width:34%;min-width:110px}
td.bar span{display:block;height:8px;background:var(--accent);border-radius:999px;min-width:2px}
td.bar span.unmeasured{background:repeating-linear-gradient(90deg,var(--border) 0 5px,transparent 5px 10px)}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap;border:1px solid transparent}
.c-PASS{background:color-mix(in srgb,var(--good) 14%,transparent);color:var(--good);border-color:color-mix(in srgb,var(--good) 32%,transparent)}
.c-PARTIAL_HIGH,.c-PARTIAL{background:color-mix(in srgb,var(--warn) 14%,transparent);color:var(--warn);border-color:color-mix(in srgb,var(--warn) 32%,transparent)}
.c-PARTIAL_LOW,.c-FAIL{background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad);border-color:color-mix(in srgb,var(--bad) 32%,transparent)}
.c-NOT_OBSERVED{background:var(--raised);color:var(--muted);border-color:var(--border)}
tr.s-FAIL th,tr.s-PARTIAL_LOW th{color:var(--bad);font-weight:700}
tr.s-NOT_OBSERVED th,tr.s-NOT_OBSERVED td{color:var(--muted)}
ul{margin:6px 0;padding-left:18px}
li.ok{color:var(--good)}
li.no{color:var(--bad);font-weight:600}
li.unknown{color:var(--muted)}
details summary{cursor:pointer;font-size:12.5px;color:var(--muted)}
details[open] summary{margin-bottom:4px}
details summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin:14px 0}
.card.lever{border-left:3px solid var(--accent)}
.card.blockers{border-left:3px solid var(--warn)}
.card.caps{border-left:3px solid var(--bad)}
.capnum{font-variant-numeric:tabular-nums;font-weight:700}
.note{font-size:12.5px;color:var(--muted);margin:6px 0 0}
footer{margin-top:40px;border-top:1px solid var(--border);padding-top:14px}
.scorecard{margin:0 0 34px;line-height:0}
.scorecard svg{width:100%;height:auto;border-radius:12px;display:block}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media print{details{display:block}details>ul{display:block}body{max-width:none}.card,tr{break-inside:avoid}thead th{position:static}label[for=lang]{display:none}}
@media(max-width:640px){body{padding:20px 14px 48px}header{gap:18px}.gauge{width:104px;height:104px}.gnum span{font-size:34px}table{font-size:12.5px}th,td{padding:7px 6px}td.bar{width:28%}}`;

  return `<!doctype html><html lang="${language}" data-lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${plain("documentTitle")} · ${htmlEscape(result.run_id ?? "")}</title><style>${style}</style></head><body>
<input type="checkbox" id="lang"${language === "ko" ? " checked" : ""} aria-label="${plain("languageLabel")}">
<div class="topbar"><div class="status"><span class="st">${htmlEscape(result.status ?? "")}</span> · ${t("run")} ${htmlEscape(result.run_id ?? "")}</div><label for="lang">${t("language")}</label></div>
<figure class="scorecard">${renderCard(result, { locale, constraint })}</figure>
<div class="headline">${headline}<p class="bound">${result?.model_identity?.claim_stage === "PROFILE_BOUND" ? t("profileBound") : t("runDiagnostic")}</p></div>
<h2>${t("conditions")}</h2><dl class="conds">${conditions}</dl>
<ul class="identity">${identityLines(result).map((line) => `<li>${htmlEscape(line)}</li>`).join("")}</ul>
${constraint ? `<section class="card lever"><h2>${t("lever")}</h2><p class="leadline"><strong>${htmlEscape(constraint.metric_id)} </strong>${both(METRIC_TITLES[constraint.metric_id] ?? { en: constraint.title ?? "" })}</p><p><code>${htmlEscape(constraint.failed.join(", "))}</code> ${t("answeredNo")}</p><p class="muted">${htmlEscape(constraint.reason ?? "")}</p></section>` : ""}
${blockers ? `<section class="card blockers"><h2>${t("noScore")}</h2><ul>${blockers}</ul></section>` : ""}
${caps ? `<section class="card caps"><h2>${t("ceilings")}</h2><ul>${caps}</ul><p class="note">${t("ceilingNote")}</p></section>` : ""}
<h2>${t("dimensions")}</h2><table><thead><tr><th scope="col">${t("colDimension")}</th><th scope="col"><span class="vh">${t("colScore")}</span></th><th scope="col" class="num">${t("colValue")}</th><th scope="col" class="num">${t("colWeight")}</th></tr></thead><tbody>${dimensionRows}</tbody></table>
<h2>${t("metrics")}</h2><table><thead><tr><th scope="col">${t("colId")}</th><th scope="col">${t("colDim")}</th><th scope="col">${t("colMetric")}</th><th scope="col" class="num">${t("colScore")}</th><th scope="col">${t("colState")}</th><th scope="col" class="num">${t("colEvidence")}</th><th scope="col">${t("colChecks")}</th></tr></thead><tbody>${metricRows}</tbody></table>
<p class="note">${t("notObservedNote")}</p>
<footer><h2>${t("limitations")}</h2><ul>${limitations}</ul></footer>
</body></html>`;
}
