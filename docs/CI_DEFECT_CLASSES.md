# CI defect classes: the review rounds, kept

Ten pull requests in the v0.2.0 release went through an adversarial review gate. It worked — it
found a forgeable audit pass, a scanner that missed four spellings of `uses:`, a workspace diff a
file named `__proto__` could walk through — and it was far too slow, because several PRs took five
to seven rounds. Tallying what those rounds actually found:

| Share | What the finding was | Where it belongs |
| --- | --- | --- |
| ~40% | an **input class** nobody enumerated: YAML spellings, impossible dates, encodings that collide under decoding, prototype keys, unbounded arrays, duplicate entries | **CI** — this scanner and the attack corpus |
| ~35% | a **claim mismatch**: a test name stronger than its assertions, a doc sentence the code does not support | partly CI (assertless tests, counted claims), partly review |
| ~15% | a **trust-shape flaw**: a property brand a Proxy forges, a caller-supplied comparison policy, an unauthenticated boolean | **review** — this is what review is for |
| ~10% | termination and process: hangs on dense inputs, mutation guards pointed at the wrong line | CI (bounded-input cases, the mutation job, `ACCOUNTED_GUARDS`) |

The first and last rows are mechanical once known. Paying a review round each time one recurs is
the abnormality; `scripts/check-defect-classes.mjs` runs them in seconds as a required check.

## The rules

| Rule | The round it keeps |
| --- | --- |
| `text-digest` | `fileDigest` hashed a decoded, CRLF-folded read: `a\nb` and `a\r\nb` shared a digest, and `0xFF`, `0xFE` and an honest U+FFFD were one value. The rule flags the exact line dev shipped it on. |
| `plain-object-map` | a file named `__proto__` assigned through to `Object.prototype`, vanished from `Object.keys`, and a modified workspace diffed as untouched |
| `regex-no-unicode` | one emoji is two UTF-16 code units: it matched `^..$` and satisfied `minLength: 2` |
| `date-parse-validator` | `Date.parse` accepts `"0"`, rolls `2026-02-30` into March, and maps years 0–99 into the 1900s |
| `unbounded-schema-array` | a canonical-sized plan carried 100,001 references, and the checks below it became unbounded work |
| `assertless-test` | a test with a name and no assertion passes forever |
| `stale-allowlist` | an exception whose code is gone keeps a hole open at that address |

## The allowlist is the mechanism, not the escape

Every rule is a heuristic over source text, so each carries an allowlist
(`governance/defect-class-allowlist.json`) seeded to the code that existed when the rule landed —
with per-entry notes, including two that name the live defects the in-flight branches fix, whose
entries the stale rule will force out the moment those branches merge.

New code matching a known-bad shape therefore forces a choice **in the diff**: fix the shape, or
add an entry with a match string and a reason where the reviewer sees it. An entry that stops
matching anything fails the build as stale.

## The attack corpus

`fixtures/attacks/corpus.v1.json` holds the input classes themselves — prototype keys, impossible
instants, astral strings, byte-identity pairs, YAML spellings, unbounded-collection generators,
forged-record shapes — each with the sentence saying why it exists. A new parser or validator
should take its adversarial cases from here rather than from what its author happened to imagine;
adding a case strengthens every surface that draws on the class.

## Known limits, stated

Text matching is not an AST: an aliased import (`readFileSync as r`) walks past `text-digest`, and
`plain-object-map` sees `const x = {}` plus a computed assignment, not data flow. The scanner buys
the common spelling cheaply. Trust-shape flaws — what a forged object can be *substituted for*,
which authority a comparison uses — are not detectable by any of this and remain the review's job,
which is why the review still exists and why it can now afford to be one round.
