import { htmlEscape } from "./core.mjs";
import { projectResult } from "./result-schema.mjs";
import { modelIdentityLines } from "./model-identity.mjs";

// The lines the record stored, quoted. Deriving them again in each renderer is how the three
// surfaces came to disagree with the result they were rendered from (#561); a result written
// before the record existed has none, and gets the historical projection by name.
const identityLines = (result) =>
  (Array.isArray(result?.model_identity?.lines) ? result.model_identity.lines : modelIdentityLines(result?.model_identity ?? null));

// The profile result, rendered three ways from one projection.
//
// Everything printed here is a string `projectResult` already formatted. There is no arithmetic in
// this file and there must never be: the moment a renderer averages the rows it was given, it is a
// second scorer, and the test that forges a stored composite against its rows exists to catch that.
//
// The order is fixed and the same in every rendering -- process, reliance, outcome, composite,
// claim -- because the order is the argument. The operator's process comes first as the thing this
// product measures; the composite comes fourth, labelled secondary, after both numbers it is made
// of have been shown with their gaps. There is no hero slot. A withheld index is printed as the
// word "withheld" with the row it was withheld for, never as a blank and never as a zero.

const W = 1200;
const FONT = "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue','Noto Sans KR',Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

const dash = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));
const cell = (value) => htmlEscape(dash(value));

// C2.RF.01 is withheld through the normal cell path, so its row names the cell but not the runtime
// evidence that withheld its two capability subchecks. Keep the M09 reason in the terminal,
// Markdown and HTML reports; it is already a published observation, not a renderer's second diagnosis.
const routingCapabilityNotice = (result) => {
  const m09 = (result?.observations ?? []).find((entry) => entry?.metric_id === "M09");
  if (typeof m09?.reason !== "string" || !m09.reason.includes("aos-known adapter-table")) return null;
  return m09.reason;
};

const constructTable = (rows, head) => [
  `| ${head} | Value | Status | Withheld for |`,
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.id} ${row.title} | ${row.value} | ${row.status} | ${dash(row.reason)} |`)
];

/**
 * The result as the operator's terminal shows it, as lines.
 *
 * Here rather than inline in `lib/cli.mjs` because the terminal is a renderer of this result and
 * was the only one that was not: three of the four sites were converted to print the ceiling off
 * the stored caps and this one stayed keyed to `cap_applied`, so on the lane where the O3 grouping
 * withholds the index -- which is the lane the safety ceiling fires on -- the operator's own screen
 * said `withheld` and named no violation while the markdown, the HTML and the card all did.
 *
 * A summary, not a page: what it is held to is `view.headline`, the subset every surface must
 * carry, rather than `view.phrases`, which is the whole of what a page prints. Both oracles live in
 * `projectResult` and `tests/product/projection-consistency.test.mjs` runs this function against
 * the headline one, so the terminal cannot drift from the other three again without a test saying
 * so. Nothing here computes a number: every value is a string the projection already formatted.
 */
export function renderProfileTerminal(result) {
  const view = projectResult(result);
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const observed = observations.filter((row) => row.value !== null);
  const missed = observed.filter((row) => row.value !== 1).map((row) => row.metric_id);
  const withheld = (summary) => (summary ? ` (${summary})` : "");
  const capabilityNotice = routingCapabilityNotice(result);
  return [
    `${observed.length} of ${observations.length} metrics observed`,
    missed.length ? `below full marks: ${missed.join(", ")}` : "no metric below full marks",
    // The label travels with the number on every surface, because it is the caveat: each of these
    // three is a claim about an enforced profile and none of them is an ability score.
    `Operator process: ${view.process.index}${withheld(view.process.withheld_summary)} — ${view.process.coverage} · ${view.process.label}`,
    `Reliance calibration: ${view.reliance.status} — ${view.reliance.explains}`,
    `System outcome: ${view.outcome.index}${withheld(view.outcome.withheld_summary)}${view.outcome.cap ? ` — ${view.outcome.cap}` : ""} · ${view.outcome.label}`,
    ...(capabilityNotice ? [`Routing capability evidence: ${capabilityNotice}`] : []),
    // #566. Off the stored triggers, so a ceiling earned on a lane whose index is withheld is still
    // on the screen. The same string the markdown, the HTML and the card print, so the six surfaces
    // the issue enumerates stay comparable rather than each paraphrasing the ceiling.
    ...view.outcome.cap_triggers.map((trigger) => `Ceiling trigger: ${trigger}`),
    `${view.composite.label} : ${view.composite.value}${withheld(view.composite.withheld_summary)}${view.composite.cap ? ` — ${view.composite.cap}` : ""} — ${view.composite.secondary_note}`,
    `claim stage ${view.claim.stage} · uncertainty ${view.claim.uncertainty} · generalizability ${view.claim.generalizability}`
  ];
}

export function renderProfileMarkdown(result) {
  const view = projectResult(result);
  const [processSection, relianceSection, outcomeSection, compositeSection, claimSection] = view.sections;
  const capabilityNotice = routingCapabilityNotice(result);
  const lines = [
    "# AOS profile result",
    "",
    `Run \`${dash(view.run_id)}\` · claim stage ${view.claim.stage} · ${view.claim.permitted_interpretation}`,
    "",
    // Which model, which executable, which profile, and whether this result may join a
    // profile-bound aggregate (#561). Quoted from the record rather than re-derived, so this page
    // and the JSON it was rendered from cannot say two things.
    ...identityLines(result).map((line) => `- ${line}`),
    "",
    `## ${processSection.title}`,
    "",
    `${view.process.label}: **${view.process.index}** — index on 0–100, equal-weight mean of the construct estimates the contract issued`,
    ...(view.process.withheld_summary ? [`Withheld: ${view.process.withheld_summary}`] : []),
    `Coverage: ${view.process.coverage}`,
    "",
    ...constructTable(view.process.rows, "Construct"),
    "",
    `## ${relianceSection.title}`,
    "",
    `Status: ${view.reliance.status} · ${view.reliance.explains} · opportunities ${view.reliance.opportunities}`,
    `Coverage: ${view.reliance.coverage}`,
    "",
    ...view.reliance.rows.map((row) => `- ${row.id}: ${row.value} · ${row.status}${row.opportunities ? ` · over ${row.opportunities} opportunities` : ""}`),
    "",
    `## ${outcomeSection.title}`,
    "",
    `${view.outcome.label}: **${view.outcome.index}** — index on 0–100, equal-weight mean of the four outcome domains`,
    ...(capabilityNotice ? [`Routing capability evidence: ${capabilityNotice}`] : []),
    ...(view.outcome.withheld_summary ? [`Withheld: ${view.outcome.withheld_summary}`] : []),
    ...(view.outcome.cap ? [`Ceiling: ${view.outcome.cap} · uncapped ${view.outcome.raw_index}`] : []),
    // #566. Printed off the stored triggers rather than off `cap_applied`, so a ceiling earned on a
    // lane whose index is withheld is still on the page. A reader who cannot see it has no way to
    // know a violation was observed at all.
    ...view.outcome.cap_triggers.map((trigger) => `Ceiling trigger: ${trigger}`),
    `Coverage: ${view.outcome.coverage}`,
    "",
    ...constructTable(view.outcome.rows, "Domain"),
    "",
    `## ${compositeSection.title}`,
    "",
    `${view.composite.label}: **${view.composite.value}** — ${view.composite.secondary_note}`,
    `Formula ${view.composite.formula}: arithmetic mean of the two indices above, 50:50; withheld when either is withheld.`,
    ...(view.composite.withheld_summary ? [`Withheld: ${view.composite.withheld_summary}`] : []),
    ...(view.composite.cap ? [`Ceiling: ${view.composite.cap} · uncapped ${view.composite.raw_value}`] : []),
    "",
    "Delegated artifact (shown here, never in the value):",
    "",
    ...constructTable(view.composite.artifact_rows, "Construct"),
    "",
    `## ${claimSection.title}`,
    "",
    "The boundary this run was measured under -- #556. `not measured` is not `not enforced`:",
    "",
    `- Isolation level: ${view.isolation.level} · backend ${view.isolation.backend} · canary ${view.isolation.canary}`,
    `- Axes: ${view.isolation.axes}`,
    `- Lane: ${view.isolation.lane}`,
    `- Network: ${view.isolation.network}`,
    `- Policy digest: ${view.isolation.policy_digest}`,
    ...(view.isolation.withheld_for ? [`- Boundary: ${view.isolation.withheld_for}`] : []),
    "",
    `- Claim stage: ${view.claim.stage}`,
    `- Uncertainty: ${view.claim.uncertainty} · method ${view.claim.uncertainty_method}`,
    `- Generalizability: ${view.claim.generalizability}`,
    `- Facets: ${view.claim.facets.join(", ") || "none declared"}`,
    `- Forbidden uses: ${view.claim.forbidden_uses.join("; ")}`,
    `- Contract: ${view.claim.contract}`,
    `- Schema: ${view.claim.schema}`,
    `- Summary: ${view.summary}`,
    ""
  ];
  return lines.join("\n");
}

const htmlTable = (rows, head) => `<table><thead><tr><th>${htmlEscape(head)}</th><th>Value</th><th>Status</th><th>Withheld for</th></tr></thead><tbody>${
  rows.map((row) => `<tr><td>${htmlEscape(`${row.id} ${row.title}`)}</td><td class="num">${cell(row.value)}</td><td>${cell(row.status)}</td><td>${cell(row.reason)}</td></tr>`).join("")
}</tbody></table>`;

export function renderProfileHtml(result) {
  const view = projectResult(result);
  const [processSection, relianceSection, outcomeSection, compositeSection, claimSection] = view.sections;
  const capabilityNotice = routingCapabilityNotice(result);
  const line = (text) => (text ? `<p class="muted">${htmlEscape(text)}</p>` : "");
  // No decimal literal anywhere before the first section heading: the guard that a number is not
  // printed before the process profile reads the whole document, stylesheet included.
  const style = "body{font-family:" + FONT + ";max-width:960px;margin:32px auto;padding:0 16px;line-height:1}" +
    "h1{font-size:20px}h2{font-size:16px;margin-top:32px;border-top:1px solid #ddd;padding-top:16px}" +
    "table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}" +
    ".num{font-family:" + MONO + "}.index{font-family:" + MONO + ";font-size:24px}.muted{color:#666}ul{padding-left:20px}";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AOS profile result · ${htmlEscape(dash(view.run_id))}</title>
<style>${style}</style>
</head>
<body>
<h1>AOS profile result</h1>
<p class="muted">Run <code>${htmlEscape(dash(view.run_id))}</code> · claim stage ${htmlEscape(view.claim.stage)} · ${htmlEscape(view.claim.permitted_interpretation)}</p>
<ul class="identity">${identityLines(result).map((entry) => `<li>${htmlEscape(entry)}</li>`).join("")}</ul>
<section>
<h2>${htmlEscape(processSection.title)}</h2>
<p>${htmlEscape(view.process.label)}: <span class="index">${htmlEscape(view.process.index)}</span></p>
<p class="muted">index on 0–100, equal-weight mean of the construct estimates the contract issued</p>
${line(view.process.withheld_summary ? `Withheld: ${view.process.withheld_summary}` : null)}
${line(`Coverage: ${view.process.coverage}`)}
${htmlTable(view.process.rows, "Construct")}
</section>
<section>
<h2>${htmlEscape(relianceSection.title)}</h2>
${line(`Status: ${view.reliance.status} · ${view.reliance.explains} · opportunities ${view.reliance.opportunities}`)}
${line(`Coverage: ${view.reliance.coverage}`)}
<ul>${view.reliance.rows.map((row) => `<li>${htmlEscape(`${row.id}: ${row.value} · ${row.status}${row.opportunities ? ` · over ${row.opportunities} opportunities` : ""}`)}</li>`).join("")}</ul>
</section>
<section>
<h2>${htmlEscape(outcomeSection.title)}</h2>
<p>${htmlEscape(view.outcome.label)}: <span class="index">${htmlEscape(view.outcome.index)}</span></p>
<p class="muted">index on 0–100, equal-weight mean of the four outcome domains</p>
${line(capabilityNotice ? `Routing capability evidence: ${capabilityNotice}` : null)}
${line(view.outcome.withheld_summary ? `Withheld: ${view.outcome.withheld_summary}` : null)}
${line(view.outcome.cap ? `Ceiling: ${view.outcome.cap} · uncapped ${view.outcome.raw_index}` : null)}
${view.outcome.cap_triggers.map((trigger) => line(`Ceiling trigger: ${trigger}`)).join("")}
${line(`Coverage: ${view.outcome.coverage}`)}
${htmlTable(view.outcome.rows, "Domain")}
</section>
<section>
<h2>${htmlEscape(compositeSection.title)}</h2>
<p>${htmlEscape(view.composite.label)}: <span class="index">${htmlEscape(view.composite.value)}</span> — ${htmlEscape(view.composite.secondary_note)}</p>
${line(`Formula ${view.composite.formula}: arithmetic mean of the two indices above, 50:50; withheld when either is withheld.`)}
${line(view.composite.withheld_summary ? `Withheld: ${view.composite.withheld_summary}` : null)}
${line(view.composite.cap ? `Ceiling: ${view.composite.cap} · uncapped ${view.composite.raw_value}` : null)}
${line("Delegated artifact (shown here, never in the value):")}
${htmlTable(view.composite.artifact_rows, "Construct")}
</section>
<section>
<h2>${htmlEscape(claimSection.title)}</h2>
<ul>
<li>Isolation level: ${htmlEscape(view.isolation.level)} · backend ${htmlEscape(view.isolation.backend)} · canary ${htmlEscape(view.isolation.canary)}</li>
<li>Axes: ${htmlEscape(view.isolation.axes)}</li>
<li>Lane: ${htmlEscape(view.isolation.lane)}</li>
<li>Network: ${htmlEscape(view.isolation.network)}</li>
<li>Policy digest: ${htmlEscape(view.isolation.policy_digest)}</li>
${view.isolation.withheld_for ? `<li>Boundary: ${htmlEscape(view.isolation.withheld_for)}</li>` : ""}
<li>Claim stage: ${htmlEscape(view.claim.stage)}</li>
<li>Uncertainty: ${htmlEscape(view.claim.uncertainty)} · method ${htmlEscape(view.claim.uncertainty_method)}</li>
<li>Generalizability: ${htmlEscape(view.claim.generalizability)}</li>
<li>Facets: ${htmlEscape(view.claim.facets.join(", ") || "none declared")}</li>
<li>Forbidden uses: ${htmlEscape(view.claim.forbidden_uses.join("; "))}</li>
<li>Contract: ${htmlEscape(view.claim.contract)}</li>
<li>Schema: ${htmlEscape(view.claim.schema)}</li>
<li>Summary: ${htmlEscape(view.summary)}</li>
</ul>
</section>
</body>
</html>
`;
}

/** Text that is safe inside an SVG text node and never longer than the space it was given. */
const clip = (value, max) => {
  const text = dash(value);
  return htmlEscape(text.length > max ? `${text.slice(0, max - 1)}…` : text);
};

const text = (x, y, size, body, extra = "") => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${body}</text>`;

/**
 * The card: the same five sections, in the same order, on one 1200x630 face.
 *
 * Nothing on it is drawn larger than 40px and the composite is drawn smaller than the two indices
 * it is made of, so a shared card cannot read as one number with some small print. The rows that
 * were withheld carry their reason on the face for the same reason the legacy card carried its
 * ceiling: a picture detaches from its page the moment it is shared.
 */
export function renderProfileCard(result) {
  const view = projectResult(result);
  const [processSection, relianceSection, outcomeSection, compositeSection, claimSection] = view.sections;
  // Wide enough that no phrase the projection carries has to be cut. The card is one of the three
  // renderings of one result, and a rendering that abbreviates a phrase the others print is a
  // different rendering: the reliance metrics and the forbidden uses were missing from this one
  // entirely, which is the same defect in its loudest form. Long identity lines -- a digest, the
  // contract line -- are still clipped, because those are references rather than statements.
  const wide = 60;
  const rowLines = (rows, x, y, width, step = 17) => {
    const lines = [];
    let cursor = y;
    for (const row of rows) {
      lines.push(text(x, cursor, 11, clip(`${row.id} ${row.title}`, wide), `font-family="${FONT}" fill="#1f2933"`));
      lines.push(text(x + width, cursor, 11, clip(row.value, 10), `font-family="${MONO}" fill="#1f2933" text-anchor="end"`));
      cursor += step;
      if (row.reason) {
        lines.push(text(x + 12, cursor, 10, clip(`↳ ${row.reason}`, wide), `font-family="${MONO}" fill="#8a6d1f"`));
        cursor += 15;
      }
    }
    return lines.join("");
  };
  const column = 330;
  const left = 40;
  const middle = 410;
  const right = 780;
  const footer = 478;
  const header = [
    text(left, 36, 14, "AOS · PROFILE RESULT", `font-family="${MONO}" fill="#52606d" letter-spacing="2"`),
    text(W - 40, 36, 12, clip(`run ${dash(view.run_id)} · ${view.claim.stage}`, wide), `font-family="${MONO}" fill="#52606d" text-anchor="end"`)
  ];
  const processBlock = [
    text(left, 72, 13, clip(processSection.title, wide), `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    text(left, 90, 10, clip(view.process.label, wide), `font-family="${MONO}" fill="#52606d" letter-spacing="1"`),
    text(left, 130, 40, clip(view.process.index, 12), `font-family="${MONO}" fill="#1f2933" font-weight="700"`),
    text(left, 150, 10, clip(view.process.coverage, wide), `font-family="${MONO}" fill="#52606d"`),
    ...(view.process.withheld_summary ? [text(left, 166, 10, clip(view.process.withheld_summary, wide), `font-family="${MONO}" fill="#8a6d1f"`)] : []),
    rowLines(view.process.rows, left, 190, column)
  ];
  // Reliance sits where the mandated order puts it -- second, before the outcome -- and carries its
  // ten metrics rather than a status standing in for them. "WITHHELD" is not one of ten answers.
  const relianceBlock = [
    text(middle, 72, 13, clip(relianceSection.title, wide), `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    text(middle, 90, 10, clip(view.reliance.status, wide), `font-family="${MONO}" fill="#1f2933"`),
    text(middle, 105, 10, clip(view.reliance.explains, wide), `font-family="${MONO}" fill="#52606d"`),
    text(middle, 120, 10, clip(`opportunities ${view.reliance.opportunities} · ${view.reliance.coverage}`, wide), `font-family="${MONO}" fill="#52606d"`),
    ...view.reliance.rows.map((row, index) => text(
      middle + (index < 5 ? 0 : 180),
      140 + (index % 5) * 15,
      10,
      clip(`${row.id}: ${row.value}`, 40),
      `font-family="${MONO}" fill="${row.status === "ISSUED" ? "#1f2933" : "#52606d"}"`
    ))
  ];
  const outcomeBlock = [
    text(middle, 240, 13, clip(outcomeSection.title, wide), `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    text(middle, 258, 10, clip(view.outcome.label, wide), `font-family="${MONO}" fill="#52606d" letter-spacing="1"`),
    text(middle, 296, 36, clip(view.outcome.index, 12), `font-family="${MONO}" fill="#1f2933" font-weight="700"`),
    text(middle, 314, 10, clip(view.outcome.coverage, wide), `font-family="${MONO}" fill="#52606d"`),
    ...(view.outcome.withheld_summary ? [text(middle, 329, 10, clip(view.outcome.withheld_summary, wide), `font-family="${MONO}" fill="#8a6d1f"`)] : []),
    ...(view.outcome.cap ? [text(middle, 344, 10, clip(view.outcome.cap, wide), `font-family="${MONO}" fill="#8a6d1f"`)] : []),
    rowLines(view.outcome.rows, middle, 366, column, 15)
  ];
  const compositeBlock = [
    text(right, 72, 13, clip(compositeSection.title, wide), `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    text(right, 90, 10, clip(view.composite.label, wide), `font-family="${MONO}" fill="#52606d" letter-spacing="1"`),
    text(right, 126, 32, clip(view.composite.value, 12), `font-family="${MONO}" fill="#1f2933" font-weight="700"`),
    text(right, 144, 10, clip(view.composite.secondary_note, wide), `font-family="${MONO}" fill="#8a6d1f"`),
    text(right, 159, 10, clip(view.composite.formula, wide), `font-family="${MONO}" fill="#52606d"`),
    ...(view.composite.withheld_summary ? [text(right, 174, 10, clip(view.composite.withheld_summary, wide), `font-family="${MONO}" fill="#8a6d1f"`)] : []),
    ...(view.composite.cap ? [text(right, 189, 10, clip(view.composite.cap, wide), `font-family="${MONO}" fill="#8a6d1f"`)] : [])
  ];
  const claimBlock = [
    text(right, 220, 13, clip(claimSection.title, wide), `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    text(right, 238, 11, clip(view.claim.stage, wide), `font-family="${MONO}" fill="#1f2933"`),
    text(right, 256, 11, clip(view.claim.uncertainty, wide), `font-family="${MONO}" fill="#1f2933"`),
    text(right, 274, 11, clip(view.claim.generalizability, wide), `font-family="${MONO}" fill="#1f2933"`),
    text(right, 294, 10, clip(view.summary, wide), `font-family="${MONO}" fill="#52606d"`),
    text(right, 424, 9, clip(view.claim.contract, 52), `font-family="${MONO}" fill="#9aa5b1"`),
    text(right, 436, 9, clip(view.claim.schema, 52), `font-family="${MONO}" fill="#9aa5b1"`)
  ];
  // Every declared facet, at full width. Eight fitted the column and the ninth was dropped -- and a
  // facet is a condition the whole result is bound to, which makes "the one that did not fit"
  // exactly the one a reader needs. A facet can be a digest, so the column was never the place for
  // them: this strip is as wide as the card.
  const facetBand = (top) => {
    const lines = [text(left, top, 12, "Conditions this result is bound to", `font-family="${FONT}" fill="#52606d" font-weight="600"`)];
    view.claim.facets.forEach((facet, index) => {
      lines.push(text(left + (index % 2) * 560, top + 20 + Math.floor(index / 2) * 14, 10, clip(facet, 92), `font-family="${MONO}" fill="#52606d"`));
    });
    return lines;
  };

  // The delegated-artifact rows, on the card as well. They were on the markdown and the html and
  // not here, so an artifact estimate moving from 100.0 to 60.0 changed two renderings and left the
  // third byte-identical -- a card that is not a rendering of the result it names. Full width,
  // because a row's reason is a sentence and a column would cut it: what a card cannot show whole
  // it should not be the only renderer to show at all.
  const artifactBand = [
    text(left, footer, 12, "Delegated artifact · shown here, never in the value", `font-family="${FONT}" fill="#52606d" font-weight="600"`)
  ];
  let cursor = footer + 20;
  for (const row of view.composite.artifact_rows) {
    artifactBand.push(text(left, cursor, 11, clip(`${row.id} ${row.title}`, 120), `font-family="${FONT}" fill="#1f2933"`));
    artifactBand.push(text(W - 40, cursor, 11, clip(row.value, 10), `font-family="${MONO}" fill="#1f2933" text-anchor="end"`));
    cursor += 16;
    if (row.reason) {
      artifactBand.push(text(left + 12, cursor, 10, clip(`↳ ${row.reason}`, 170), `font-family="${MONO}" fill="#8a6d1f"`));
      cursor += 14;
    }
  }
  // The model and the executable this result was produced by, on the card as well. It had neither,
  // so the surface that leaves the page was the one that could not say what made the number
  // (#561 round 9). Quoted from the record, like the other two renderings.
  const identityTop = cursor + 22;
  const identityBand = [
    text(left, identityTop, 12, "Model and executable", `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    ...identityLines(result).slice(0, 8).map((line, index) => text(
      left,
      identityTop + 20 + index * 15,
      10,
      clip(line, 150),
      `font-family="${MONO}" fill="#52606d"`
    ))
  ];
  cursor = identityTop + 20 + Math.min(identityLines(result).length, 8) * 15;
  const facetTop = cursor + 22;
  const facetLines = facetBand(facetTop);
  cursor = facetTop + 20 + Math.ceil(view.claim.facets.length / 2) * 14;
  // #556. The boundary, full width, because every line here is a sentence rather than a number and
  // the column would cut the one that matters: `task-initiated NOT_OBSERVED` is the limitation this
  // issue requires be shown, and a limitation clipped to `task-init…` is not shown.
  const boundaryTop = cursor + 22;
  const boundaryLines = [
    `Boundary: ${view.isolation.level} · backend ${view.isolation.backend} · canary ${view.isolation.canary}`,
    view.isolation.axes,
    view.isolation.lane,
    view.isolation.network,
    view.isolation.policy_digest,
    ...(view.isolation.withheld_for ? [view.isolation.withheld_for] : [])
  ];
  const boundaryBand = [
    text(left, boundaryTop, 12, "The boundary this run was measured under", `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    ...boundaryLines.map((line, index) => text(left, boundaryTop + 18 + index * 14, 10, clip(line, 150), `font-family="${MONO}" fill="#52606d"`))
  ];
  cursor = boundaryTop + 18 + boundaryLines.length * 14;
  // #566. The ceilings this run earned, full width and one line each. On the card because a card is
  // the rendering somebody forwards on its own: a run that was capped at 39 for a secret exposure
  // and shows only a withheld index has told the reader nothing about why.
  const ceilingTop = cursor + 22;
  const ceilingBand = view.outcome.cap_triggers.length === 0 ? [] : [
    text(left, ceilingTop, 12, "Ceilings this run earned", `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    ...view.outcome.cap_triggers.map((trigger, index) => text(left, ceilingTop + 18 + index * 14, 10, clip(trigger, 150), `font-family="${MONO}" fill="#8a6d1f"`))
  ];
  cursor = ceilingBand.length === 0 ? cursor : ceilingTop + 18 + view.outcome.cap_triggers.length * 14;
  // The footer closes the claim section: what the result may not be used for, on the artifact
  // somebody shares rather than in the file they never open.
  const forbidden = cursor + 22;
  const forbiddenBand = [
    text(left, forbidden, 12, "Forbidden uses", `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    ...view.claim.forbidden_uses.map((use, index) => text(
      left + (index % 3) * 380,
      forbidden + 18 + Math.floor(index / 3) * 15,
      10,
      clip(use, wide),
      `font-family="${MONO}" fill="#8a6d1f"`
    ))
  ];
  // The card grows with what it has to show rather than dropping what does not fit a fixed height.
  const height = forbidden + 30 + Math.ceil(view.claim.forbidden_uses.length / 3) * 15;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="${clip(view.summary, 120)}">
<rect width="${W}" height="${height}" fill="#f5f7fa"/>
<rect x="24" y="24" width="${W - 48}" height="${height - 48}" rx="12" fill="#ffffff" stroke="#d9e2ec"/>
<line x1="${middle - 20}" y1="56" x2="${middle - 20}" y2="${footer - 24}" stroke="#e4e7eb"/>
<line x1="${right - 20}" y1="56" x2="${right - 20}" y2="${footer - 24}" stroke="#e4e7eb"/>
<line x1="40" y1="${footer - 24}" x2="${W - 40}" y2="${footer - 24}" stroke="#e4e7eb"/>
<line x1="40" y1="${forbidden - 22}" x2="${W - 40}" y2="${forbidden - 22}" stroke="#e4e7eb"/>
${[...header, ...processBlock, ...relianceBlock, ...outcomeBlock, ...compositeBlock, ...claimBlock, ...artifactBand, ...identityBand, ...facetLines, ...boundaryBand, ...ceilingBand, ...forbiddenBand].join("\n")}
</svg>
`;
}
