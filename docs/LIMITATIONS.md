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
- No package is published. The command runs from a clone.

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

MIT is the outbound copyright grant. It is a redistribution permission. It is not contributor terms, and it is not a publication clearance. Contributor terms and formal publication review remain unresolved. G4 publication is not cleared. No public package has been approved.

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
