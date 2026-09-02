import { htmlEscape } from "./core.mjs";
import { projectResult } from "./result-schema.mjs";

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
const H = 630;
const FONT = "ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue','Noto Sans KR',Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

const dash = (value) => (value === null || value === undefined || value === "" ? "—" : String(value));
const cell = (value) => htmlEscape(dash(value));

const constructTable = (rows, head) => [
  `| ${head} | Value | Status | Withheld for |`,
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.id} ${row.title} | ${row.value} | ${row.status} | ${dash(row.reason)} |`)
];

export function renderProfileMarkdown(result) {
  const view = projectResult(result);
  const [processSection, relianceSection, outcomeSection, compositeSection, claimSection] = view.sections;
  const lines = [
    "# AOS profile result",
    "",
    `Run \`${dash(view.run_id)}\` · claim stage ${view.claim.stage} · ${view.claim.permitted_interpretation}`,
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
    "",
    ...view.reliance.rows.map((row) => `- ${row.id}: ${row.value} · ${row.status}${row.opportunities ? ` · over ${row.opportunities} opportunities` : ""}`),
    "",
    `## ${outcomeSection.title}`,
    "",
    `${view.outcome.label}: **${view.outcome.index}** — index on 0–100, equal-weight mean of the four outcome domains`,
    ...(view.outcome.withheld_summary ? [`Withheld: ${view.outcome.withheld_summary}`] : []),
    ...(view.outcome.cap ? [`Ceiling: ${view.outcome.cap} · uncapped ${view.outcome.raw_index}`] : []),
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
<ul>${view.reliance.rows.map((row) => `<li>${htmlEscape(`${row.id}: ${row.value} · ${row.status}${row.opportunities ? ` · over ${row.opportunities} opportunities` : ""}`)}</li>`).join("")}</ul>
</section>
<section>
<h2>${htmlEscape(outcomeSection.title)}</h2>
<p>${htmlEscape(view.outcome.label)}: <span class="index">${htmlEscape(view.outcome.index)}</span></p>
<p class="muted">index on 0–100, equal-weight mean of the four outcome domains</p>
${line(view.outcome.withheld_summary ? `Withheld: ${view.outcome.withheld_summary}` : null)}
${line(view.outcome.cap ? `Ceiling: ${view.outcome.cap} · uncapped ${view.outcome.raw_index}` : null)}
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
    ...view.claim.facets.slice(0, 8).map((facet, index) => text(right, 314 + index * 14, 9, clip(facet, 52), `font-family="${MONO}" fill="#52606d"`)),
    text(right, 430, 9, clip(view.claim.contract, 52), `font-family="${MONO}" fill="#9aa5b1"`),
    text(right, 444, 9, clip(view.claim.schema, 52), `font-family="${MONO}" fill="#9aa5b1"`)
  ];
  // The footer closes the claim section: what the result may not be used for, on the artifact
  // somebody shares rather than in the file they never open.
  const forbiddenBand = [
    text(left, footer, 12, "Forbidden uses", `font-family="${FONT}" fill="#52606d" font-weight="600"`),
    ...view.claim.forbidden_uses.slice(0, 12).map((use, index) => text(
      left + (index % 3) * 380,
      footer + 18 + Math.floor(index / 3) * 15,
      10,
      clip(use, wide),
      `font-family="${MONO}" fill="#8a6d1f"`
    ))
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${clip(view.summary, 120)}">
<rect width="${W}" height="${H}" fill="#f5f7fa"/>
<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="12" fill="#ffffff" stroke="#d9e2ec"/>
<line x1="${middle - 20}" y1="56" x2="${middle - 20}" y2="${footer - 24}" stroke="#e4e7eb"/>
<line x1="${right - 20}" y1="56" x2="${right - 20}" y2="${footer - 24}" stroke="#e4e7eb"/>
<line x1="40" y1="${footer - 24}" x2="${W - 40}" y2="${footer - 24}" stroke="#e4e7eb"/>
${[...header, ...processBlock, ...relianceBlock, ...outcomeBlock, ...compositeBlock, ...claimBlock, ...forbiddenBand].join("\n")}
</svg>
`;
}
