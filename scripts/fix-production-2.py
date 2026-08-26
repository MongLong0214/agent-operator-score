from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

config_path = ROOT / "tsconfig.product.json"
config = json.loads(config_path.read_text(encoding="utf-8"))
config["compilerOptions"]["resolveJsonModule"] = True
config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

core_path = ROOT / "lib/core.mjs"
core = core_path.read_text(encoding="utf-8")
old = '''    let value = equals === -1 ? undefined : token.slice(equals + 1);
    if (value === undefined && argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }
'''
new = '''    let value = equals === -1 ? undefined : token.slice(equals + 1);
    const next = argv[index + 1];
    const consumesFlagValue = key === "arg";
    if (value === undefined && next !== undefined && (consumesFlagValue || !next.startsWith("--"))) {
      value = next;
      index += 1;
    }
'''
if old not in core:
    raise SystemExit("parseArgs patch target not found")
core_path.write_text(core.replace(old, new), encoding="utf-8")

readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8")
readme = readme.replace("  --arg --json \\\n", "  --arg=--json \\\n")
readme = readme.replace(
    "AOS-Coding P0 is conditional performance in the declared agent pool, permissions, tools, and budget.",
    "The generic command adapter is designed for trusted local agent CLIs; it is not a hostile-code security sandbox. AOS-Coding P0 is conditional performance in the declared agent pool, permissions, tools, and budget."
)
readme_path.write_text(readme, encoding="utf-8")

print("Second production fix set applied")
