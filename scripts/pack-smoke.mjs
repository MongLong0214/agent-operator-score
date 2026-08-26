import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "aos-pack-"));
try {
  const packDir = join(root, "pack");
  mkdirSync(packDir, { recursive: true });
  const output = execFileSync("npm", ["pack", "--json", "--silent", "--ignore-scripts", "--pack-destination", packDir], { encoding: "utf8" });
  const [{ filename, files }] = JSON.parse(output);
  const names = new Set(files.map((entry) => entry.path));
  for (const required of ["bin/aos.mjs", "lib/cli.mjs", "lib/scorer.mjs", "README.md", "LICENSE"]) {
    if (!names.has(required)) throw new Error(`tarball missing ${required}`);
  }
  for (const forbidden of [".aos", ".github/workflows/release-bootstrap.yml", "scripts/finalize-production.py"]) {
    if ([...names].some((name) => name.includes(forbidden))) throw new Error(`tarball contains ${forbidden}`);
  }
  const install = join(root, "install");
  mkdirSync(install, { recursive: true });
  execFileSync("npm", ["init", "-y"], { cwd: install, stdio: "ignore" });
  execFileSync("npm", ["install", join(packDir, filename), "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: install, stdio: "inherit" });
  const cli = join(install, "node_modules", ".bin", "aos");
  const version = execFileSync(cli, ["--version"], { cwd: install, encoding: "utf8" }).trim();
  if (version !== "0.1.0") throw new Error(`unexpected version ${version}`);
  const verified = JSON.parse(execFileSync(cli, ["verify", "--json"], { cwd: install, encoding: "utf8" }));
  if (!verified.ok) throw new Error("installed CLI self verification failed");
  console.log(`PACK_SMOKE_OK ${filename}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
