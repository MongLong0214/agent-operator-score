import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const required = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "docs/north-star/agentops-score-ssot-v1.0.md",
  "docs/tickets/TICKETS.md",
  "docs/decisions/CEO-GATE-ADR-2026-08-05.md",
  "docs/decisions/CEO-GATE-ADR-UI-2026-08-05.md",
  "docs/decisions/CEO-GATE-PRD-2026-08-05.md",
  "docs/decisions/CEO-GATE-PRD-UI-2026-08-05.md",
  "docs/decisions/CEO-GATE-TICKETS-2026-08-05.md",
  "docs/decisions/CEO-GATE-TICKETS-UI-2026-08-05.md"
];

const errors = [];
for (const path of required) {
  if (!existsSync(resolve(root, path))) errors.push(`missing ${path}`);
}

const adrFiles = readdirSync(resolve(root, "docs/adr")).filter((f) => /^ADR-\d{4}-.+\.md$/.test(f));
const prdFiles = readdirSync(resolve(root, "docs/prd")).filter((f) => /^PRD-F\d-.+\.md$/.test(f));
const ticketFiles = readdirSync(resolve(root, "docs/tickets")).filter((f) => /^F\d-.+\.md$/.test(f));
const ticketText = ticketFiles.map((f) => readFileSync(resolve(root, "docs/tickets", f), "utf8")).join("\n");
const ticketIds = [...ticketText.matchAll(/^## (T-\d{3}) /gm)].map((m) => m[1]);

if (adrFiles.length !== 12) errors.push(`ADR count ${adrFiles.length}, expected 12`);
if (prdFiles.length !== 10) errors.push(`PRD count ${prdFiles.length}, expected 10`);
if (ticketIds.length !== 41) errors.push(`ticket count ${ticketIds.length}, expected 41`);
if (new Set(ticketIds).size !== ticketIds.length) errors.push("duplicate ticket id");

const fields = [
  "Ownership:", "Preconditions/dependencies:", "Forbidden:", "RED:",
  "Minimum GREEN:", "AC ↔ tests:", "Verification:", "Invalidation/stop/evidence:"
];
for (const field of fields) {
  const count = ticketText.split(`**${field}**`).length - 1;
  if (count !== ticketIds.length) errors.push(`${field} count ${count}, expected ${ticketIds.length}`);
}

const readme = readFileSync(resolve(root, "README.md"), "utf8");
if (!readme.includes("Current status: planning baseline")) errors.push("README lacks planning status");
if (!readme.includes("Planned CLI — not available yet")) errors.push("README blurs planned CLI status");

if (errors.length) {
  console.error(`PLANNING_CONTRACT_FAIL ${errors.length}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const mode = process.argv.includes("--build") ? "BUILD_SCAFFOLD" : "PLANNING_CONTRACT";
console.log(`${mode}_PASS adr=${adrFiles.length} prd=${prdFiles.length} tickets=${ticketIds.length} product_code=0`);
