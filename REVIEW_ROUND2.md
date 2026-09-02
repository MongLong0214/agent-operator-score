{"items":[{"html_url":"https://github.com/MongLong0214/agent-operator-score/pull/592","number":592,"title":"docs(governance): read-only audit of stale remote branches (#572 Phase A)"},{"html_url":"https://github.com/MongLong0214/agent-operator-score/issues/572","number":572,"title":"[P2][repo] stale remote branch를 read-only audit하고 #578 뒤 안전하게 정리한다"}],"total_count":2}
{"items":[{"html_url":"https://github.com/MongLong0214/agent-operator-score/issues/572","number":572,"title":"[P2][repo] stale remote branch를 read-only audit하고 #578 뒤 안전하게 정리한다"},{"html_url":"https://github.com/MongLong0214/agent-operator-score/pull/592","number":592,"title":"docs(governance): read-only audit of stale remote branches (#572 Phase A)"}],"total_count":2}

exec
/bin/zsh -lc "gh api -H 'Accept: application/vnd.github+json' repos/MongLong0214/agent-operator-score/issues/592/timeline --paginate --jq '.[] | select(.event == \"head_ref_force_pushed\" or .event == \"head_ref_deleted\" or .event == \"head_ref_restored\" or .event == \"closed\" or .event == \"merged\") | {event,created_at,commit_id}'
gh api repos/MongLong0214/agent-operator-score/pulls/592/commits --paginate --jq '.[] | {sha,parent_count:(.parents|length),date:.commit.committer.date,message:(.commit.message|split(\"\\n\")[0])}'" in /private/tmp/rv-592b
 succeeded in 1003ms:
{"date":"2026-09-02T00:22:52Z","message":"docs(governance): read-only audit of stale remote branches (#572 Phase A)","parent_count":1,"sha":"1afd3524f3fb4a4b5e884bd0d30b0ee3216a2d71"}
{"date":"2026-09-02T00:39:48Z","message":"fix(governance): correct stale-branch audit for a branch that stopped being orphaned","parent_count":1,"sha":"bff60a45e2f5e52abadff6ec4575c3ad1e476be8"}
{"date":"2026-09-02T01:14:52Z","message":"fix(governance): correct false claims and overclaiming test names in the #572 stale-branch audit","parent_count":1,"sha":"f9ebcd62470702300ef6e40dc12f4a7a857a1291"}

codex
Not ready to merge.

The three underlying corrections are correct. [PR #591](https://github.com/MongLong0214/agent-operator-score/pull/591) was created at `00:13:30Z`, before the `00:18:26Z` snapshot. Git reflogs show `task/issue-572-work` created at `00:10:07Z` and pushed at `00:23:02Z`; [PR #592](https://github.com/MongLong0214/agent-operator-score/pull/592) opened at `00:23:32Z`. Seven snapshot heads minus `main` and `dev` is five.

Two factual defects remain:

The old timing claim survives in the [revision history](/private/tmp/rv-592b/docs/STALE_BRANCH_AUDIT.md:36), [JSON history](/private/tmp/rv-592b/fixtures/stale-branches/audit.json:11), and especially the statement that the first version predated PR #591 in the [known limitation](/private/tmp/rv-592b/docs/STALE_BRANCH_AUDIT.md:135). PR #591 already existed.

More materially, both deletion-candidate rows incorrectly claim no PR-body reference. PR #592’s initial body already named both candidates at `00:23:32Z`, before the corrected snapshot at `00:29:41Z`; 357 PRs existed by then. Thus “0 of 355,” the empty `referenced_by_pr` arrays, and “only issue #572” are not corrected-snapshot facts ([doc](/private/tmp/rv-592b/docs/STALE_BRANCH_AUDIT.md:162), [JSON](/private/tmp/rv-592b/fixtures/stale-branches/audit.json:84)). Also, the documented `gh api search/issues -f ...` command needs `-X GET`; otherwise `gh` switches to POST.

The renamed tests now match their assertions. The combined invariant is not vacuous: three fixture entries exercise it, its closing assertion can fail, and the exact preservation mutation fails its named test. The reason mutation likewise fails its named test. Focused tests pass 17/17.

Nothing destructive appears in the diff or history: three linear fast-forward commits, no deleted files, force-push event, ref deletion, rename, or deletion command.
tokens used
184,884
Not ready to merge.

The three underlying corrections are correct. [PR #591](https://github.com/MongLong0214/agent-operator-score/pull/591) was created at `00:13:30Z`, before the `00:18:26Z` snapshot. Git reflogs show `task/issue-572-work` created at `00:10:07Z` and pushed at `00:23:02Z`; [PR #592](https://github.com/MongLong0214/agent-operator-score/pull/592) opened at `00:23:32Z`. Seven snapshot heads minus `main` and `dev` is five.

Two factual defects remain:

The old timing claim survives in the [revision history](/private/tmp/rv-592b/docs/STALE_BRANCH_AUDIT.md:36), [JSON history](/private/tmp/rv-592b/fixtures/stale-branches/audit.json:11), and especially the statement that the first version predated PR #591 in the [known limitation](/private/tmp/rv-592b/docs/STALE_BRANCH_AUDIT.md:135). PR #591 already existed.

More materially, both deletion-candidate rows incorrectly claim no PR-body reference. PR #592’s initial body already named both candidates at `00:23:32Z`, before the corrected snapshot at `00:29:41Z`; 357 PRs existed by then. Thus “0 of 355,” the empty `referenced_by_pr` arrays, and “only issue #572” are not corrected-snapshot facts ([doc](/private/tmp/rv-592b/docs/STALE_BRANCH_AUDIT.md:162), [JSON](/private/tmp/rv-592b/fixtures/stale-branches/audit.json:84)). Also, the documented `gh api search/issues -f ...` command needs `-X GET`; otherwise `gh` switches to POST.

The renamed tests now match their assertions. The combined invariant is not vacuous: three fixture entries exercise it, its closing assertion can fail, and the exact preservation mutation fails its named test. The reason mutation likewise fails its named test. Focused tests pass 17/17.

Nothing destructive appears in the diff or history: three linear fast-forward commits, no deleted files, force-push event, ref deletion, rename, or deletion command.

[exited with code 0]
