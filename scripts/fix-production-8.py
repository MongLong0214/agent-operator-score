from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

required = [
    "package.json",
    "package-lock.json",
    "bin/aos.mjs",
    "lib/cli.mjs",
    "lib/store.mjs",
    "lib/scorer.mjs",
    "lib/suite.mjs",
    "lib/report.mjs",
    "scripts/build.mjs",
    "scripts/pack-smoke.mjs",
    "test-product/aos.test.mjs",
    "test-product/hardening.test.mjs",
    "test-product/lifecycle.test.mjs",
    "test-product/recovery.test.mjs",
    ".github/workflows/ci.yml",
    "README.md",
    "docs/PRODUCTION.md"
]
missing = [path for path in required if not (ROOT / path).exists()]
if missing:
    raise SystemExit(f"production surface missing: {', '.join(missing)}")

package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
assert package["name"] == "agent-operator-score"
assert package["version"] == "0.1.0"
assert package["private"] is False
assert package["bin"]["aos"] == "bin/aos.mjs"
assert package["os"] == ["darwin", "linux"]
assert package["engines"]["node"] == ">=22.18 <25"
assert not package.get("dependencies")

readme = (ROOT / "README.md").read_text(encoding="utf-8")
for truth in [
    "vendor-neutral",
    "EXPERIMENTAL / PROVISIONAL",
    "not a model leaderboard",
    "trusted local agent CLIs",
    "aos session recover"
]:
    if truth not in readme:
        raise SystemExit(f"README missing release truth: {truth}")

print("Definitive production surface assertions passed")
