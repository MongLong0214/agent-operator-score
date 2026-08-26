import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const roots = ["bin", "lib", "scripts", "test-product"];
const files = [];
function walk(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".mjs")) files.push(full);
  }
}
for (const root of roots) walk(root);
for (const file of files.sort()) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
console.log(`TYPECHECK_OK checked=${files.length}`);
