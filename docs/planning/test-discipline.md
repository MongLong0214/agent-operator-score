# Test discipline — what a green suite does not prove

Standing guidance, not a dated record. It exists because on 2026-08-21 four packets arrived for
review with the whole suite green and their own mutation sweeps run, and an independent review found
a real defect in every one — the same defect each time.

Three of the four never merged; the review caught them first, and that is the point. In this
repository a packet has shipped only when it is merged with post-merge CI and a
`Ticket-Completion:` receipt, so "green" and "shipped" are far apart, and the distance is exactly
where these defects live.

| packet | what the check should have been aimed at | what it was actually aimed at |
|---|---|---|
| E9-003 | native inputs run through the real normalizer | two event arrays the fixture's own helper built |
| E3-001 | the recorded base digest | the live tree — which it then returned as `baseDigest` |
| E14-003 | the pinned manifest bytes | digests recomputed from the files the gate protects |
| collector | the real worker writing through a pipe | a mock returning the payload the test built |

**A passing test proves the check ran. It does not prove what it ran against.** When the fixture
supplies both the input and the expected value, the only way to fail is for the fixture to disagree
with itself. Mutation sweeps do not catch this either: mutate the implementation and cases still
die, because the fixture moves with it.

## The oracle rule

For every assertion, the expected value must not be produced by the code path under test. Name where
each expected value came from. If the answer is "the same helper that built the input", the case is
worthless.

- Comparing two things that should normalize alike? Feed the **native** inputs and derive each side
  from the real normalizer — it is a dependency of the comparison, not the thing being compared.
  When the normalizer itself is what is under test, that same move is the violation: its expected
  output has to come from the spec or from recorded input/output pairs, never from calling it.
- Comparing digests? Compare against the **pinned** value. Never recompute the pin from the files it
  gates. `scripts/verify-g0.mjs` already says it: *"Pinned. Regenerating these from the files they
  gate would make the gate vacuous."*
- Comparing recorded identity? Compare the freshly observed value against what was **recorded** —
  not a caller-supplied pin against either one. A caller pin that can be omitted is not a check; it
  is an optional extra assertion on top of one.
- Testing a subprocess, pipe, or IPC path? **Spawn it.** A mock that returns the payload you built
  passes against the very bug you are fixing.

## A passing case must not mint a result the slow path would refuse

The question is not "is a stub present". It is **what does this case let through**.

`runG0: () => ({ ok: true, errors: [] })` on a *passing* case is a fast path around the evidence G0
exists to require — supported Node, a clean lockfile, the pinned digest match, every family, killed
mutants, formula vectors. The same stub on a *fail-closed probe*, used to show the gate still names
`G0` and refuses, is correct and necessary.

That distinction is why #294 was withdrawn: a lint that asked "is a stub present" flagged three
legitimate probes and would have refused the correction it existed to encourage. Ask what the case
mints, not what it contains.

If the real path cannot run in this tree, the case must **fail closed** and say so. An honest
blocked result is a correct answer.

## Removing a fixture oracle is not the same as removing the check

The rule above says an expected value must not come from the code path under test. Applying it by
**deleting** the case that was doing that leaves the suite vacuous, which is the same failure wearing
the opposite mask.

This happened on 2026-08-21. A freeze positive control was asserting against digests the fixture had
copied in, so it was removed and only refusals were kept, with a note that an honest positive was
not constructible. A reviewer then mutated the whole evaluator to `() => null`: **all eleven freeze
cases still passed.** Every refusal was satisfied by a function that refuses everything.

It was constructible. The reviewer built one by parsing the real manifest from `HEAD` and hashing its
artifact blobs at `HEAD` — nothing minted to match, and a constant-null evaluator now dies against
it.

So when a case fails the oracle rule, the work is to **re-ground it**, not to drop it:

- find the value's authentic source — the tree at a commit, a pinned constant, a real subprocess —
  and read it from there;
- if one input genuinely cannot be obtained (a fact the collector does not gather, a machine that
  does not exist), supply *that one* and say so in the case, rather than abandoning the control;
- before trusting a suite of refusals, mutate the thing under test to refuse everything. If nothing
  dies, the refusals prove nothing.

"I could not build an honest positive control" is a claim to check, not a conclusion to record. It
was wrong here.

## One property per case

Each named case should differ from the passing baseline in exactly one compared property. If six
fields are compared and no case isolates any of them, dropping any single comparison kills nothing.
Four packets reported exactly that as "mutation survivors".

## A mutation survivor is an unfinished packet

Break each property a case claims to protect, one at a time, reverting byte-identically. If a
mutation kills nothing, either add the case that kills it or state precisely why the property cannot
be isolated and what that leaves unproven. A survivor list is not completed work.

## Check the authority, not the neighbouring code

The most serious defect found that day was not a test-quality problem. A candidate for E14-003
closed G2 and G3 on E12's single feasibility verdict, while SSOT lines 782-783 say the n=20 alpha
*cannot* satisfy them and that facet/attribution and transfer claims must not be made. The tests
**required** that wrong close. Had it merged, publication would have been permitted on claims the
SSOT forbids. It was corrected before merge.

So for a check that implements a rule, cite the authority line that defines it and show the check
against that citation. A check with no citable authority line is invented.

## Why this is a document and not a lint

A guard was written to refuse conformance cases that stub their own gate, and then withdrawn (#294).
It could not tell a stub that bypasses a gate from a stub that proves the bypass is refused — it
flagged three legitimate fail-closed probes. Narrowed to the production seam, it caught one spelling
out of eight that implement the same skip.

Both halves failed the way this document describes: a check aimed at a spelling, presented as a
check on a property. The reviewable question — *what is this check aimed at, concretely, and what
value does it compare?* — found four real defects the same day. That question does not fit in a
regex.
