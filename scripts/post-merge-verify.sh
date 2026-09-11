#!/usr/bin/env bash
# The checks the governance directive requires immediately after a merge, as one command.
#
# A list a person walks after a merge is a list that gets walked once. These are the same checks
# the branch already runs, pointed at dev after the merge lands, plus the two that only exist
# there: that dev actually points at the merge SHA, and that the post-merge run is green.
#
#   post-merge-verify.sh <merge-sha> [pr-number]
#
# The PR number is read out of the merge commit's subject when it is not given.
set -uo pipefail
merge="${1:?merge SHA}"
pr="${2:-$(git log -1 --format=%s "$merge" 2>/dev/null | sed -n 's/^Merge pull request #\([0-9][0-9]*\).*/\1/p')}"
repo="MongLong0214/agent-operator-score"
fail=0
steps=0
log="$(mktemp -t pmv)"
trap 'rm -f "$log"' EXIT
step() {
  steps=$((steps + 1))
  printf '%-44s ' "$1"; shift
  if "$@" >"$log" 2>&1; then echo PASS; else echo FAIL; fail=1; tail -3 "$log" | sed 's/^/    /'; fi
}

git fetch origin --quiet
step "dev points at the merge SHA" bash -c "[ \"\$(git rev-parse origin/dev)\" = \"$(git rev-parse "$merge" 2>/dev/null || echo x)\" ]"

# Three different facts live in this endpoint and the first cut of this step collapsed two of
# them. A check-run with a null conclusion has not finished, which is not the fact that it
# failed -- counted together, the step failed on every merge whose CI had not caught up, which is
# every merge verified promptly. And a commit with *no* check-runs at all answers zero-failed,
# which read as green: measured, a branch commit with `total_count: 0` passed the repaired
# version of this step. Silence is not success here any more than it is anywhere else, so the
# count has to be asserted before the conclusions are.
check_runs_green() {
  local waited=0 pending failed total
  while [ "$waited" -lt 900 ]; do
    pending=$(gh api "repos/$repo/commits/$merge/check-runs" -q '[.check_runs[]|select(.status!="completed")]|length') || return 1
    [ "$pending" -eq 0 ] && break
    sleep 20; waited=$((waited + 20))
  done
  if [ "${pending:-1}" -ne 0 ]; then
    echo "$pending check-run(s) still running after ${waited}s -- not a failure, not yet an answer"; return 1
  fi
  total=$(gh api "repos/$repo/commits/$merge/check-runs" -q '.total_count') || return 1
  if [ "$total" -eq 0 ]; then
    echo "no check-run reported on $merge at all -- nothing ran, which is not the same as nothing failed"; return 1
  fi
  failed=$(gh api "repos/$repo/commits/$merge/check-runs" -q '[.check_runs[]|select(.conclusion!="success" and .conclusion!="skipped")]|length') || return 1
  [ "$failed" -eq 0 ] || { gh api "repos/$repo/commits/$merge/check-runs" -q '.check_runs[]|select(.conclusion!="success" and .conclusion!="skipped")|"\(.name): \(.conclusion)"'; return 1; }
  echo "$total check-run(s), none failed"
}
step "required checks all green" check_runs_green

step "EN suite" bash -c 'LANG=en_US.UTF-8 npm test 2>&1 | grep -qE "^# fail 0$"'
step "KO suite" bash -c 'LANG=ko_KR.UTF-8 npm test 2>&1 | grep -qE "^# fail 0$"'
step "tree is clean before measuring" bash -c '[ -z "$(git status --porcelain)" ]'
step "mutation" bash -c 'npm run --silent test:mutation 2>&1 | grep -q "guards are load-bearing"'

# Fingerprints, not bytes. The runner stamps `measured_on.at` on every entry on every run, so
# `git diff --quiet` on this file is false after any sweep and was therefore a step that could
# never pass -- a check that always fails teaches its reader to skip the whole report, which is
# the same damage as one that always passes. What the directive asks is whether the sweep found
# the ledger's claims still true, and that is the fingerprint.
ledger_fingerprints_unmoved() {
  git show "HEAD:tests/mutation/measured.json" > "$log.head" || return 1
  python3 - "$log.head" tests/mutation/measured.json <<'PY'
import json, sys
old = json.load(open(sys.argv[1]))["measured"]
new = json.load(open(sys.argv[2]))["measured"]
moved = [k for k in new if k in old and new[k]["fingerprint"] != old[k]["fingerprint"]]
gone = [k for k in old if k not in new]
added = [k for k in new if k not in old]
for label, rows in (("fingerprint moved", moved), ("dropped by the sweep", gone), ("added by the sweep", added)):
    for row in rows[:10]:
        print(f"{label}: {row}")
sys.exit(1 if (moved or gone or added) else 0)
PY
}
step "the sweep found every ledger claim still true" ledger_fingerprints_unmoved

step "package smoke" npm run --silent smoke:package
step "operational form gates" bash -c 'for s in verify:form-classification verify:exposure-ledger verify:scored-once verify:practice-contamination verify:transfer-scaffold verify:comparison-withholding verify:form-linking-status; do npm run --silent $s >/dev/null 2>&1 || exit 1; done'
step "execution-plan offline" npm run --silent verify:execution-plan
step "defect classes" npm run --silent check:defect-classes
step "PR body names the merged head" bash -c "[ -n '$pr' ] && bash scripts/refresh-pr-verification-block.sh '$pr' --check"

# The sweep rewrote its own timestamps and nothing else -- the step above is what establishes
# that. Put the file back so the checkout this ran in is left as it was found.
git checkout -- tests/mutation/measured.json 2>/dev/null || true

echo
if [ "$fail" -eq 0 ]; then
  echo "post-merge: all $steps checks passed at $merge (PR #${pr:-unknown})"
else
  echo "post-merge: FAILURES above -- the merge is not verified" >&2
fi
exit $fail
