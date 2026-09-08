#!/usr/bin/env bash
# The ten checks the governance directive requires immediately after a merge, as one command.
#
# A list a person walks after a merge is a list that gets walked once. These are the same checks
# the branch already runs, pointed at dev after the merge lands, plus the two that only exist
# there: that dev actually points at the merge SHA, and that the post-merge run is green.
#
#   post-merge-verify.sh <merge-sha>
set -uo pipefail
merge="${1:?merge SHA}"
fail=0
step() { printf '%-44s ' "$1"; shift; if "$@" >/tmp/pmv.log 2>&1; then echo PASS; else echo FAIL; fail=1; tail -3 /tmp/pmv.log | sed 's/^/    /'; fi; }

git fetch origin --quiet
step "dev points at the merge SHA" bash -c "[ \"\$(git rev-parse origin/dev)\" = \"$(git rev-parse "$merge" 2>/dev/null || echo x)\" ]"
step "required checks all green" bash -c 'gh api repos/MongLong0214/agent-operator-score/commits/'"$merge"'/check-runs -q "[.check_runs[]|select(.conclusion!=\"success\" and .conclusion!=\"skipped\")]|length" | grep -qx 0'
step "EN suite" bash -c 'LANG=en_US.UTF-8 npm test 2>&1 | grep -qE "^# fail 0$"'
step "KO suite" bash -c 'LANG=ko_KR.UTF-8 npm test 2>&1 | grep -qE "^# fail 0$"'
step "mutation" bash -c 'npm run --silent test:mutation 2>&1 | grep -q "guards are load-bearing"'
step "package smoke" npm run --silent smoke:package
step "operational form gates" bash -c 'for s in verify:form-classification verify:exposure-ledger verify:scored-once verify:practice-contamination verify:transfer-scaffold verify:comparison-withholding verify:form-linking-status; do npm run --silent $s >/dev/null 2>&1 || exit 1; done'
step "execution-plan offline" npm run --silent verify:execution-plan
step "defect classes" npm run --silent check:defect-classes
step "PR body names the merged head" bash scripts/refresh-pr-verification-block.sh 649 --check

echo
[ "$fail" -eq 0 ] && echo "post-merge: all ten checks passed at $merge" || echo "post-merge: FAILURES above -- the merge is not verified" >&2
exit $fail
