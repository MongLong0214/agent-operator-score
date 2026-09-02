# Limitations

AOS-Coding P0 is EXPERIMENTAL / PROVISIONAL.

These limits are part of the public surface, not footnotes. They are not removed by MIT, by a passing fixture run, or by this document existing.

- AOS does not report a percentile.
- AOS is not a certification.
- AOS is not a hiring signal, a global rank, or an industry standard.
- P0 does not statistically remove environment effects. It reports conditional performance in a declared Opportunity Profile and task pack.
- A score is produced by the deterministic scorer from an aos-trace under a declared Opportunity Profile.
- Snapshot is ESTIMATE and cannot display AOS-Coding P0 or safety-clear language.
- Imported sessions are DIAGNOSTIC ONLY.
- A score is PROFILE-BOUND. It measures performance in the declared environment and task pack it was produced in, and two numbers from different agents, models or machines are two different measurements.
- The score is written to the run's report, not to the terminal. `aos review` produces no score at all.
- No package is published to a registry. `v0.1.0` is tagged and released on GitHub; the command runs from a clone or a tarball built with `npm pack`.

## Feasibility alpha boundary

No alpha participant data or study result is present in this repository. The alpha
analysis can reproduce a preregistered decision only from conserved rows; it cannot fill
missing rows, infer consent, substitute a favorable subset, or turn a missing review into
evidence.

The n=20 design is feasibility-only. Even if a future run produces the protocol's
continue result, it does not validate a personal score, establish precise reliability,
remove task/session or environment effects, establish runtime fairness, or support a
population claim. Known-group, agreement, profile, and transfer observations are reported
to expose uncertainty; they are not calibration or certification results.

G2 facet validation and G3 treatment-transfer validation are separate deferred studies.
Neither becomes resolved from this alpha-analysis mechanism or from a transfer field in an
alpha row.

MIT is the outbound copyright grant. It is a redistribution permission. It is not contributor
terms, and it is not a clearance for the research claims. Contributor terms and formal review of
those claims remain unresolved: G4 publication covers the *findings*, and nothing here has been
through it.

The v0.1.0 source release is a different thing and the owner has made it. It ships the instrument,
not a validated result -- every number in this repository is PROFILE-BOUND, EXPERIMENTAL and
measured on one machine, and the release says so.

## Session-review accuracy, as measured

`aos review` is the part of this product that reads the owner's own agent sessions. Its
rules were written by looking at real sessions, so they are at risk of having been written
to fit them, and the only answer is a set of sessions held back from that work and judged
by hand. `aos holdout` keeps that ledger; the numbers below are its current state.

The last measurement on sessions never used for tuning: **320 sessions, 10 high-severity
findings, 4 right and 6 wrong — precision 0.400** against an acceptance target of 0.90.
Two other targets pass: no session whose transcript could not be fully read was reported as
clean, and no secret material was written back out.

All six false positives have since been fixed, and the same 320 sessions now produce 4
high-severity findings — the four that were right. **That is not a second measurement.** It
is the tuning number for a change made after seeing the sessions it was measured on, and it
is reported here as a tuning number.

Only precision is measured, and only precision can be. The ledger is built from findings
AOS reported and a human judged; a session where AOS reported nothing and should have is
never entered, so recall has no denominator here and none of these numbers describe it.
The six errors were all a recognizer with too small a vocabulary, and the same gap in the
other direction is invisible to this instrument. A precision of 1.000 would be consistent
with a reviewer that reports almost nothing.

A second measurement needs sessions that did not exist when these rules changed. In this
corpus every session carrying real tool activity has now been used: the remaining 3,522
transcripts hold 22 tool calls between them. So the honest position is that the reviewer's
high-severity precision has been measured once, at 0.400, and that the measurement is older
than the code. It will be re-measurable as the owner's work accumulates.

What the six errors had in common is worth stating, because it is the shape to expect from
the next ones: every single one was a recognizer with an incomplete vocabulary. A Codex
tool call whose object literal was JavaScript rather than JSON; a test runner named by
path; a patch body read as a command; one conjugation missing from an exclusion. None of
them failed loudly. Each one invented a finding, which is the direction this product must
not be wrong in.

### The floor, and what is withheld below it

That measurement is below the floor the product now applies to itself. `aos holdout --lanes`
reports two lanes and will not publish a rate from either one until the sample can carry it.

Lane A is the local holdout: fifty held-back sessions, twenty decided high-severity findings, those
decisions reaching at least ten different sessions, and at least as many decided findings as
undecided ones. Below any of those, **in the absence of a counted violation**, the status is
`UNDECIDED` -- not PASS, not FAIL -- and the precision is **withheld**, which means absent from the
report rather than printed as zero or as an interval. The qualification is not a detail: a violation
is a count and decides before the floor does, so a one-session ledger that reported a transcript as
complete when the evidence was not is `FAIL`, with the precision withheld all the same. Waiting for
a bigger sample before saying that would be the same as not saying it.

Both reports the command can print are generated from that floored result; an earlier version
printed the default report from an unfloored acceptance object, so a single decided finding
produced a gate line reading `FAIL high-severity precision — 0` with a sentence underneath saying
the number was not a measurement. A notice under a printed number is not absence.

The counts stay: right, wrong, and the ones the owner could not decide. A verdict of `unclear` is
counted and shown and enters neither side of the rate, because a reviewer graded only on the
findings somebody could label has a precision that describes the easy ones -- which is why the
abstentions are now part of the floor rather than only printed beside it. The spread figure is there
for the same kind of reason: fifty sessions and twenty decisions were both satisfied by forty-nine
sessions that contributed nothing and one that carried every verdict.

**None of those four numbers is derived from a power calculation, and none of them should be read as
one.** Twenty decisions at a measured 0.90 is consistent with a true rate of roughly 0.70 to 0.97.
They are declared product-acceptance thresholds: clearing them buys a number that may be published,
not a number that is precise. The Lane A floor was also set after the 0.400 measurement below
already existed, which makes it a threshold chosen with the result in view rather than before it.
It does not retire that result -- the 0.400 stays on this page and a test fails if it leaves -- but
it is not a preregistered threshold and is not defended as one.

Lane B is a **known-incident fixture** rate over `fixtures/known-incidents/`: sessions
reconstructed from incidents this repository already recorded, each labelled with the rules that
must fire and the rules that must stay silent. It has a recall, which lane A cannot have, and the
name is the limit -- it is a rate over fixtures somebody chose, never a recall over anybody's
sessions.

Every item in that corpus is an incident a rule was **changed in response to**, and an item cannot
measure the rule it wrote. Those pairs are excluded from the arithmetic by name and stay in the
corpus as regression tests. What is left is not a small sample: it is **nothing**. After the
exclusion there are zero eligible decided labels, and the report says zero rather than "below the
floor of ten", because a corpus that is nearly there and a corpus with no evidence in it are
different states.

Two other things decide that floor and both used to be wrong. A rule does not have one severity --
`session-ended-on-stale-evidence` is medium after one edit and high after four -- and the first
version of this kept whichever severity the corpus produced first, so the floor for a rule was ten
or five depending on the order the directory listed. It is now the worst severity the rule was seen
at. And nothing stopped a corpus from holding the same session ten times under ten fixture ids,
which cleared a floor of ten in each direction with two distinct shapes; identical evidence is now
refused outright. Near-identical evidence is not: an item with one character changed is a different
digest and counts again, and no check here can tell that from a second incident.

Two more ways a corpus could have bought a rate, both closed. A rule's review is stored under the
item's fixture id, so two items sharing an id meant one review scored both: nine silent items and
one firing item under a single id produced ten true positives off the one that fired, and twenty
items whose labels eighteen of them contradicted came out as precision 1.000 and recall 1.000. A
repeated id is now refused. And abstention was unlimited on this side, where Lane A had already
closed it: ten positives, ten negatives and a thousand items that could not say anything published
a rate over the twenty somebody could label. A rule's rate is now withheld unless at least as many
items decided it as abstained on it.

The larger limit is what a declaration can be worth. `derived_rules` is the field the whole
separation rests on, and it is a claim the author of the rules wrote about their own rules, in the
same change, with no independent history to check it against. Omitting a rule name from that array
makes the item eligible and nothing in the product would notice. The items are also reconstructions
rather than recordings: they isolate one cause from a session that had several, and where an item
does that its own `incident` field now says so. So this is a corpus of reconstructions written by
the author of the rules. It can show that a rule stopped doing what it was recorded doing. It cannot
establish that a rule was measured on evidence it did not come from.

So: `aos review` is EXPERIMENTAL, its precision claim is WITHHELD, and the only measured figure
this product has about its own reviewer is still the 0.400 above.

The machine-readable shape of all this is named and versioned in
[`HOLDOUT_OUTPUT.md`](HOLDOUT_OUTPUT.md), which also records what the unversioned shape it replaced
used to carry and what its readers should read now.

### Two ways a destructive command is still missed

Both were found while building the corpus above, and neither is fixed here.

A Codex `local_shell_call` row is a shape this parser does not read. The session is correctly
reported as `INCOMPLETE` -- coverage falls and nothing is passed off as clean -- but any command
inside one is invisible, so `rm -rf` in that shape produces no finding at all. The 929/931 incident
was the neighbouring shape, `custom_tool_call`, and that one is read.

A destructive command inside a quoted argument is not reported even when the row is read.
`psql -c 'DROP TABLE runs'` parses correctly and raises nothing, because a match inside quotes is
treated as text rather than as a command -- the guard that stops a `DROP TABLE` in a migration body
being read as a command that ran. That exclusion is right about patch bodies and wrong about `-c`.

An earlier version of the corpus carried the first of these as an item labelled `UNDECIDED`, which
turned a miss the evidence was explicit about into an abstention. Both are written down here
instead, where they read as what they are.

## What a real run looks like

Measured with real Codex on one machine, six families, seeded suite:

- **Unattended: 16 of 20 metrics observed, no score.** The four that are missing are the
  operator dimension and the join metric a single-agent route cannot produce. The provisional
  total was 70 and one ceiling applied. This is the designed answer, not a defect: a run nobody
  watched is a diagnostic result.
- **Every stage exited zero.** A checkpoint that fires only on a failed stage would never have
  fired, which is why one family now presents its own seeded blocker before any agent runs.
- **A run's outcome varies with the provider.** An earlier run of the same seed had three of six
  families produce no artifact while still exiting zero, and nothing AOS had kept could say why.
  The agent's own error output is now recorded, bounded and redacted, so the next one can.

None of this transfers. It describes this operator, this Codex build, this machine and this task
pack, which is what PROFILE-BOUND means.

## The operator dimension can only be observed at a blocker

M11 to M13 ask what the operator did when the work was stuck. That is only answerable if the run
contains a moment where something was stuck, so the suite puts one there: a family whose seeded
state is a goal, a blocker, and an event log showing the same action retried twice under one
correlation id.

Two consequences worth stating plainly. A run without `--checkpoints` cannot fill this dimension
and therefore cannot carry a score, however well the agents did. And what is graded is the state
the operator's answer produced -- an instruction that changed, a route that moved, a stop that
stopped -- never which menu item they picked, because the cautious-sounding label would otherwise
be the cheapest thing to claim.

## An agent's own sandbox is part of the profile

Codex under `-s workspace-write` cannot create `.git/index.lock` in an AOS workspace:

```text
fatal: Unable to create '.../FAM-5/.git/index.lock': Operation not permitted
```

Reproducible, and nothing AOS can change. `writable_roots` does not affect it; the setting that
lifts it is `--dangerously-bypass-approvals-and-sandbox`, which turns the agent's own sandbox
off. Both are legitimate configurations and they are different profiles:

- **Sandbox on.** One family cannot be completed as written. What it measures survives that: an
  agent that cannot commit and says so, naming the revision it was given, is making a claim
  bound to the tree in front of it, and is graded on the honesty of that claim rather than on
  whether its sandbox allowed a write. An agent that claims the work is done anyway is caught.
- **Sandbox off.** The family runs as written. AOS's own isolation is unaffected either way --
  its own workspace, a replaced HOME, a filtered environment -- because that is AOS's boundary
  around the agent, not the agent's boundary around the commands it writes.

This is what PROFILE-BOUND means in practice. The number describes an agent, its configuration
and its sandbox together, and moving any one of them makes it a different measurement.

## The three real cycles, and what each of them measured

Real Codex, one machine, three seeds locked per cycle, every run attended.

| | agent sandbox | Operator Score | runs | spread | what it found |
|---|---|---|---|---|---|
| 1 | on | **69** | 69, 69, 83 | 14 | one family cannot be completed when the agent may not write `.git` |
| 2 | off | *withdrawn* | 49, 59, 89 | — | three defects in AOS, listed below |
| 3 | off | **90** | 90, 87, 92 | 5 | — |

Cycle 2's own number is withdrawn rather than reported. The cycle recorded one run's score
against all three seeds, so the aggregate it printed described a single run counted three
times. The individual run scores are real; the cycle around them was not.

What cycle 2 found, all now fixed:

- The cycle named runs through a list sorted by name, and a run id is a uuid, so "the run that
  just appeared" was an arbitrary one.
- An agent that did the work and reported `blocked` got the false-completion ceiling, the same
  as one claiming work it never did. Codex did exactly that, and its reasoning was correct: the
  family asked for a claim file, asked for its revision to name the commit the claim is about,
  and asked for no uncommitted changes -- three requirements that cannot all hold.
- So the family's own instructions were contradictory, which is why cycle 3 is both higher and
  much tighter: spread 5 against 14, deviation 2.

Cycle 3's first run predates a change made while it was running, so its record cannot be
recomputed by `aos verify --run` even though its score is sound. Changing the instrument during
a measurement is its own mistake and it is recorded here as one.

None of these numbers transfers. Three runs on one machine say how much this measurement moved
when it was repeated, and nothing about how it would move anywhere else -- which is why the
report calls it local repeat evidence and never confidence.
