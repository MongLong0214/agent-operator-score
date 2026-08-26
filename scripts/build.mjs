import { chmodSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
if (packageJson.private !== false || packageJson.version !== "0.1.0" || packageJson.bin?.aos !== "bin/aos.mjs") {
  throw new Error("package metadata is not release-ready");
}
const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".mjs")) files.push(path);
  }
};
for (const directory of ["bin", "lib", "scripts", "test-product"]) walk(directory);
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
chmodSync("bin/aos.mjs", 0o755);
console.log(`BUILD_OK checked=${files.length}`);
