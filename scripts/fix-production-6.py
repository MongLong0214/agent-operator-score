from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ci_path = ROOT / ".github" / "workflows" / "ci.yml"
ci = ci_path.read_text(encoding="utf-8")
ci = ci.replace(
    '''permissions:
  contents: read
''',
    '''permissions:
  contents: read
'''
)
ci += r'''

  promote:
    name: promote verified production PR
    if: >-
      github.event_name == 'pull_request' &&
      github.head_ref == 'production-cli-phase-b' &&
      github.event.pull_request.head.repo.full_name == github.repository
    needs: [planning-contract, macos, package]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Mark ready and squash-merge
        env:
          GH_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        run: |
          gh pr ready "$PR_NUMBER" --repo "${{ github.repository }}" || true
          gh pr merge "$PR_NUMBER" --repo "${{ github.repository }}" --squash --match-head-commit "$HEAD_SHA"
'''
ci_path.write_text(ci, encoding="utf-8")
print("Verified same-repository promotion job added")
