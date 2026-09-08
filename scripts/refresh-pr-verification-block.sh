#!/usr/bin/env bash
# Rewrite a PR body's verification block so it describes the head it is attached to.
#
# A verification block is a claim about one SHA. When the head moves it must move with it or be
# removed, and twice on #649 it did neither -- once describing a head 41 commits behind with every
# number wrong. That was found by review both times, which is the expensive way to find it.
#
#   refresh-pr-verification-block.sh <pr> [--check]
#
# --check exits non-zero when the body does not name the current head, so a gate can ask.
set -euo pipefail
pr="${1:?pr number}"
mode="${2:-}"
head=$(git rev-parse HEAD)
body=$(gh pr view "$pr" --json body -q .body)

if [ "$mode" = "--check" ]; then
  if printf '%s' "$body" | grep -q "$head"; then
    echo "pr-body: names the current head $head"
    exit 0
  fi
  echo "pr-body: does NOT name the current head $head -- the verification block describes another commit" >&2
  exit 1
fi

# The numbers are measured here, never carried: a block assembled from memory is the defect.
en=$(LANG=en_US.UTF-8 npm test 2>&1 | awk '/^# pass/{p=$3} /^# fail/{f=$3} END{print p"/"p+f}')
ko=$(LANG=ko_KR.UTF-8 npm test 2>&1 | awk '/^# pass/{p=$3} /^# fail/{f=$3} END{print p"/"p+f}')
mut=$(npm run --silent test:mutation 2>&1 | grep -oE '[0-9]+/[0-9]+ guards are load-bearing' | tr '\n' ' ')
ecd=$(grep -oE 'ECD_CONTRACT_VERSION = "[^"]+"' lib/ecd-contract.mjs | grep -oE '[0-9.]+')
run=$(gh pr checks "$pr" 2>&1 | grep -oE 'runs/[0-9]+' | head -1 | cut -d/ -f2)

printf 'head %s\nEN %s\nKO %s\nmutation %s\nECD %s\nCI run %s\n' "$head" "$en" "$ko" "$mut" "$ecd" "$run"
