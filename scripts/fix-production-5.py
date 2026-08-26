from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["repository"] = {"type": "git", "url": "git+https://github.com/MongLong0214/agent-operator-score.git"}
package["bugs"] = {"url": "https://github.com/MongLong0214/agent-operator-score/issues"}
package["homepage"] = "https://github.com/MongLong0214/agent-operator-score#readme"
package["publishConfig"] = {"access": "public", "provenance": True}
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

readme_path = ROOT / "README.md"
readme = readme_path.read_text(encoding="utf-8")
readme = readme.replace(
    "npm install --global agent-operator-score\n# or\nnpx agent-operator-score verify",
    "# Immediately usable from GitHub after the production branch is merged\nnpm install --global github:MongLong0214/agent-operator-score#dev\n\n# After an npm release is published\nnpm install --global agent-operator-score"
)
readme_path.write_text(readme, encoding="utf-8")

ci_path = ROOT / ".github" / "workflows" / "ci.yml"
ci = ci_path.read_text(encoding="utf-8")
ci = ci.replace(
    '''  quality:
    name: quality / ubuntu / node-${{ matrix.node }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [22.18.0, 24]
''',
    '''  planning-contract:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]
'''
)
ci_path.write_text(ci, encoding="utf-8")

print("Release metadata and protected-branch check compatibility applied")
