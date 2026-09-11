#!/usr/bin/env bash
# Rewrite a PR body's verification block so it describes the head it is attached to.
#
# A verification block is a claim about one SHA. When the head moves it must move with it or be
# removed, and twice on #649 it did neither -- once describing a head 41 commits behind with every
# number wrong. That was found by review both times, which is the expensive way to find it.
#
#   refresh-pr-verification-block.sh <pr> [--check] [head]
#
# --check exits non-zero when the body does not name the head, so a gate can ask.
#
# The head defaults to HEAD, which is right while the branch is checked out and wrong everywhere
# else. `post-merge-verify.sh` runs with HEAD at the *merge* commit, and a PR body never names
# that -- it does not exist until the merge happens. So this step could not pass in the one
# context that calls it, which is the same defect as the ledger step it sits beside: the caller
# passes the reviewed head (`<merge>^2`) instead.
set -euo pipefail
pr="${1:?pr number}"
mode="${2:-}"
head=$(git rev-parse "${3:-HEAD}")
body=$(gh pr view "$pr" --json body -q .body)

# What this measures, exactly: **the body mentions this commit somewhere.** It does not check that
# the verification block is the thing mentioning it. Measured: #652's body names its reviewed head,
# its merge commit and the previous merge, and this passes for all three. Scoping the search to the
# block -- the `head <sha>` line the non-check mode emits -- is the stronger check and a different
# question from the one §33 asks, so it is not smuggled in here. The failure it therefore cannot
# catch is a stale block sitting beside a fresh mention elsewhere in the body.
#
# Any hex run the body carries that git resolves to this head counts, abbreviated or full. The
# first cut required the full forty characters and reported an abbreviation of the *right* commit
# as "describes another commit" -- a sentence that sends a reader to look for a discrepancy that
# does not exist. Resolving is not looser than matching: a hex run that resolves elsewhere, or to
# nothing, still fails, and that is the defect this exists to catch.
if [ "$mode" = "--check" ]; then
  for token in $(printf '%s' "$body" | grep -oE '\b[0-9a-f]{7,40}\b' | sort -u); do
    if [ "$(git rev-parse --verify --quiet "${token}^{commit}" 2>/dev/null)" = "$head" ]; then
      echo "pr-body: names the current head $head (as $token)"
      exit 0
    fi
  done
  echo "pr-body: does NOT name the current head $head -- no commit-ish in the body resolves to it" >&2
  exit 1
fi

# The numbers are measured here, never carried: a block assembled from memory is the defect.
en=$(LANG=en_US.UTF-8 npm test 2>&1 | awk '/^# pass/{p=$3} /^# fail/{f=$3} END{print p"/"p+f}')
ko=$(LANG=ko_KR.UTF-8 npm test 2>&1 | awk '/^# pass/{p=$3} /^# fail/{f=$3} END{print p"/"p+f}')
mut=$(npm run --silent test:mutation 2>&1 | grep -oE '[0-9]+/[0-9]+ guards are load-bearing' | tr '\n' ' ')
ecd=$(grep -oE 'ECD_CONTRACT_VERSION = "[^"]+"' lib/ecd-contract.mjs | grep -oE '[0-9.]+')
run=$(gh pr checks "$pr" 2>&1 | grep -oE 'runs/[0-9]+' | head -1 | cut -d/ -f2)

printf 'head %s\nEN %s\nKO %s\nmutation %s\nECD %s\nCI run %s\n' "$head" "$en" "$ko" "$mut" "$ecd" "$run"
