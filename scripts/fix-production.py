from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"]["test:core"] = "node --test test/*.test.ts"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

cli_path = ROOT / "lib/cli.mjs"
cli = cli_path.read_text(encoding="utf-8")
cli = cli.replace(
    'const branchRoot = join(workspace, "branches");\n      mkdirSync(branchRoot, { recursive: true });',
    'const branchRoot = `${workspace}-parallel`;\n      rmSync(branchRoot, { recursive: true, force: true });\n      mkdirSync(branchRoot, { recursive: true });'
)
cli = cli.replace(
    'const promptFile = join(workspace, ".aos-task.md");\n    const result = await runProcess(agent, { workspace, family: "ADHOC", stage: "adhoc", prompt: task, promptFile, session: makeId("adhoc"), timeoutMs: Number(getOption(args, "timeout-ms", 300000)) });',
    'const promptFile = join(workspace, ".aos-task.md");\n    writeFileSync(promptFile, `${task}\\n`, "utf8");\n    const result = await runProcess(agent, { workspace, family: "ADHOC", stage: "adhoc", prompt: task, promptFile, session: makeId("adhoc"), timeoutMs: Number(getOption(args, "timeout-ms", 300000)) });\n    rmSync(promptFile, { force: true });'
)
cli_path.write_text(cli, encoding="utf-8")

pack_path = ROOT / "scripts/pack-smoke.mjs"
pack = pack_path.read_text(encoding="utf-8")
pack = pack.replace(
    'import { mkdtempSync, readFileSync, rmSync } from "node:fs";',
    'import { mkdirSync, mkdtempSync, rmSync } from "node:fs";'
)
pack = pack.replace(
    '  const packDir = join(root, "pack");\n  const output =',
    '  const packDir = join(root, "pack");\n  mkdirSync(packDir, { recursive: true });\n  const output ='
)
pack = pack.replace(
    '  const install = join(root, "install");\n  execFileSync("npm", ["init", "-y"], { cwd: root, stdio: "ignore" });',
    '  const install = join(root, "install");\n  mkdirSync(install, { recursive: true });\n  execFileSync("npm", ["init", "-y"], { cwd: install, stdio: "ignore" });'
)
pack = pack.replace(
    'execFileSync("npm", ["install", join(packDir, filename), "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });',
    'execFileSync("npm", ["install", join(packDir, filename), "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: install, stdio: "inherit" });'
)
pack = pack.replace(
    'const cli = join(root, "node_modules", ".bin", "aos");',
    'const cli = join(install, "node_modules", ".bin", "aos");'
)
pack_path.write_text(pack, encoding="utf-8")

print("Production bootstrap fixes applied")
