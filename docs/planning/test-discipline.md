# Test discipline — what a green suite does not prove

Standing guidance, not a dated record. It exists because on 2026-08-21 four packets shipped with the
whole suite green and their own mutation sweeps run, and an independent review found a real defect in
every one — the same defect each time.

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

- Comparing normalization? Feed the **native** input and derive the expectation from the real
  normalizer, not from a hand-written event.
- Comparing digests? Compare against the **pinned** value. Never recompute the pin from the files it
  gates. `scripts/verify-g0.mjs` already says it: *"Pinned. Regenerating these from the files they
  gate would make the gate vacuous."*
- Comparing recorded identity? Compare the freshly observed value against what was **recorded** —
  not a caller-supplied pin against either one. A caller pin that can be omitted is not a check; it
  is an optional extra assertion on top of one.
- Testing a subprocess, pipe, or IPC path? **Spawn it.** A mock that returns the payload you built
  passes against the very bug you are fixing.

## No stubs in a named acceptance case

A case named by a ticket must exercise the real path. `runG0: () => ({ ok: true, errors: [] })` is
not a G0 check; it is a fast path around the evidence G0 exists to require. If the real path cannot
run in this tree, the case must **fail closed** and say so. An honest blocked result is a correct
answer; a green built on a stub is not.

## One property per case

Each named case should differ from the passing baseline in exactly one compared property. If six
fields are compared and no case isolates any of them, dropping any single comparison kills nothing.
Four packets reported exactly that as "mutation survivors".

## A mutation survivor is an unfinished packet

Break each property a case claims to protect, one at a time, reverting byte-identically. If a
mutation kills nothing, either add the case that kills it or state precisely why the property cannot
be isolated and what that leaves unproven. A survivor list is not completed work.

## Check the authority, not the neighbouring code

The most serious defect found that day was not a test-quality problem. `verify-release.mjs` closed
G2 and G3 on E12's single feasibility verdict, while SSOT lines 782-783 say the n=20 alpha *cannot*
satisfy them and that facet/attribution and transfer claims must not be made. The tests **required**
that wrong close. Publication would have been permitted on claims the SSOT forbids.

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
