import { htmlEscape } from "./core.mjs";

const factorName = {
  F1: "Intent & Contract",
  F2: "Context & Information",
  F3: "Graph & Orchestration",
  F4: "Loop & State",
  F5: "Verification & Recovery",
  F6: "Efficiency & Value"
};
function ratio(value) { return value ? Math.round((value.n / value.d) * 100) : null; }

export function renderMarkdown(result) {
  const lines = [
    "# Agent Operator Score",
    "",
    `- Run: \`${result.run_id}\``,
    `- Status: **${result.status}**`,
    `- Score: **${result.score ? `${result.score.display} / 100` : "withheld"}**`,
    `- Evidence coverage: **${Math.round(result.evidence_coverage.decimal * 100)}%**`,
    `- Safety: **${result.safety.state}**`,
    "",
    "## Factors",
    "",
    "| Factor | Score |",
    "|---|---:|"
  ];
  for (const [factor, value] of Object.entries(result.factors)) lines.push(`| ${factor} ${factorName[factor]} | ${ratio(value) ?? "N/O"} |`);
  lines.push("", "## Primary constraint", "", result.primary_constraint ? `- ${result.primary_constraint}` : "- None", "", "## One lever", "", result.one_lever ? `- ${result.one_lever}` : "- Not available", "", "## Agent portfolio", "", `- Configured: ${result.agent_portfolio.configured}`, `- Used: ${result.agent_portfolio.used.join(", ") || "none"}`, `- Invocations: ${result.agent_portfolio.invocations}`, "", "## Limitations", "");
  for (const limitation of result.limitations) lines.push(`- ${limitation}`);
  lines.push("");
  return lines.join("\n");
}

export function renderHtml(result) {
  const factorRows = Object.entries(result.factors).map(([factor, value]) => `<tr><th>${htmlEscape(factor)} ${htmlEscape(factorName[factor])}</th><td>${ratio(value) ?? "N/O"}</td></tr>`).join("");
  const limitations = result.limitations.map((item) => `<li>${htmlEscape(item)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AOS ${htmlEscape(result.run_id)}</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;color:#171717}header{border-bottom:1px solid #ddd;padding-bottom:24px}.score{font-size:72px;font-weight:750;letter-spacing:-.05em}.muted{color:#666}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd}td{text-align:right;font-variant-numeric:tabular-nums}.card{border:1px solid #ddd;padding:20px;margin:20px 0}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}.muted{color:#aaa}.card,th,td,header{border-color:#333}}</style></head><body><header><div class="muted">AOS-Coding P0 · ${htmlEscape(result.status)}</div><div class="score">${result.score ? result.score.display : "—"}</div><div>Evidence ${Math.round(result.evidence_coverage.decimal * 100)}% · Safety ${htmlEscape(result.safety.state)}</div></header><table>${factorRows}</table><section class="card"><strong>Primary constraint</strong><p>${htmlEscape(result.primary_constraint ?? "None")}</p><strong>One lever</strong><p>${htmlEscape(result.one_lever ?? "Not available")}</p></section><section><h2>Agent portfolio</h2><p>${result.agent_portfolio.configured} configured · ${result.agent_portfolio.used.length} used · ${result.agent_portfolio.invocations} invocations</p></section><section><h2>Limitations</h2><ul>${limitations}</ul></section></body></html>`;
}
