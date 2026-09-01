# AOS Measurement Foundations

> Status: v0.2.0 research-grounded design authority  
> Updated: 2026-09-01  
> Epic: [#573](https://github.com/MongLong0214/agent-operator-score/issues/573)  
> Foundational issue: [#582](https://github.com/MongLong0214/agent-operator-score/issues/582)

## 1. What AOS may claim

AOS distinguishes three inference levels.

| Level | Meaning | Allowed use |
|---|---|---|
| `RUN_DIAGNOSTIC` | Behavior and outcome observed in one run | Debugging and feedback |
| `PROFILE_BOUND` | Performance observed across every locked form under one exact profile and measurement contract | Local self-diagnosis and local improvement tracking |
| `GENERALIZABILITY_SUPPORTED` | A calibrated inference backed by a defined universe, facet analysis, form equivalence, invariance, uncertainty, and prospective validity evidence | Only the explicitly registered use |

v0.2.0 defaults to **at most `PROFILE_BOUND`**. It does not issue a universal human-ability claim, percentile, rank, certification, or hiring judgment.

## 2. Intended interpretation

A profile-bound AOS result means:

> The observed pattern of operator decisions and verified system outcomes for the sampled coding-agent tasks, under the declared model, runtime, harness, isolation, language, interface, and measurement contract.

It does **not** mean:

- stable ability across every coding task;
- performance independent of model or environment;
- population rank;
- professional certification;
- suitability for hiring or promotion;
- knowledge or skill transfer to unaided work.

## 3. Construct model

The core operator process is represented as six constructs.

| Construct | Definition |
|---|---|
| `C1 Framing & Contracting` | Defines the goal, constraints, non-goals, acceptance evidence, and stop condition before delegation. |
| `C2 Context, Decomposition & Delegation` | Selects evidence, decomposes work, chooses routes, allocates authority, and controls dependencies. |
| `C3 Monitoring & Reliance Calibration` | Decides when to rely on AI, when to rely on self, inspects evidence, and calibrates confidence to correctness. |
| `C4 Steering, Intervention & Recovery` | Diagnoses problems, changes instructions or routes, stops unsafe continuation, and resumes from the correct state. |
| `C5 Verification & Epistemic Governance` | Requires independent checks, binds conclusions to exact evidence/revision, and rejects unsupported completion. |
| `C6 Safety, Boundary & Resource Governance` | Applies least privilege, respects execution boundaries, controls external actions, and manages cost/resource risk. |

`C7 Learning & Transfer` is a separate longitudinal lane. It is not automatically included in the immediate Process Profile, Outcome Profile, or Composite.

## 4. Evidence-centered design

Every scored observable cell must connect:

```text
construct claim
→ observable behavior/effect
→ task features that create an opportunity
→ evidence authority
→ rival explanations
→ scoring rule
→ missing-evidence policy
```

Required contract artifacts:

```text
aos-construct-map.v1
aos-evidence-model.v1
aos-task-model.v1
aos-interpretation-use-argument.v1
```

A metric name is not itself a construct. Current `M01–M20` metrics are treated as versioned observable indicators that must map to one construct cell and one evidence axis.

## 5. Result model

### Operator Process Profile

Human-authored or human-selected decisions with verifiable provenance.

### Reliance Calibration Profile

Reported separately:

```text
CAIR — correct AI reliance
CSR — correct self-reliance
overreliance
underreliance
switch gain
switch harm
proactive delegation regret
deliberative adoption quality
choice independence
confidence calibration
```

A raw AI-acceptance rate is descriptive only.

### System Outcome Profile

Verified whole-system results:

```text
functional outcome
independent verification
exact revision
actual safety effects
scope/completion integrity
cost and resource outcome
```

### AOS Composite

A secondary descriptive index labelled:

```text
PROFILE-BOUND OPERATOR–AGENT SYSTEM PERFORMANCE
```

It is not a pure operator ability score.

## 6. Appropriate reliance requires an initial judgment

A reliance opportunity is valid only when the sequence is observed.

```text
independent initial judgment
→ initial confidence/evidence
→ proactive delegation decision
→ AI advice/action with known oracle correctness
→ inspection
→ adopt/reject/modify
→ final judgment/confidence
→ verified outcome
```

This permits separate measurement of correct AI reliance, correct self-reliance, overreliance, and underreliance. Advice-acceptance frequency alone cannot identify appropriate reliance.

## 7. Facets and uncertainty

Observed performance may vary because of:

```text
operator
task/form/family/difficulty/domain
model/runtime/harness
occasion/sequence/practice/fatigue
verifier/rater
language/interface
domain familiarity
operator × task/model/occasion interactions
```

Every observation carries facet identity. Until population calibration exists:

```text
generalizability_status = UNESTABLISHED
claim_stage <= PROFILE_BOUND
```

A local three-run median or low MAD is local repeat evidence, not a population reliability or generalizability coefficient.

Every public result must show:

- opportunity count;
- form/task/occasion count;
- coverage and missing cells;
- within-cycle spread;
- uncertainty status and method;
- facet coverage;
- generalizability status.

## 8. Forms, practice, transfer, and invariance

Different seeds do not automatically create equivalent forms.

Forms are classified as:

```text
WARMUP / PRACTICE
OPERATIONAL
TRANSFER
```

Operational forms are scored once and tracked in an exposure ledger. Form linking requires anchor opportunities, coverage/difficulty evidence, and drift monitoring.

Repeated improvement may reflect practice or memorization. Sequence and interval are therefore recorded.

Learning and transfer are tested separately using a collaboration phase followed by a held-out task without the agent or transcript. Transfer evidence does not automatically raise the core Composite.

Cross-language, cross-interface, cross-model, or cross-platform comparisons remain withheld until DIF or measurement-invariance evidence supports them.

## 9. No unsupported score bands

New v0.2.0 results do not emit:

```text
HIGH RELIABILITY
ROBUST
STRONG
OPERATIONAL
DEVELOPING
FRAGILE
```

or any other ability category.

A future category requires a versioned standard-setting record with an intended decision, method, independent data or panel, cut scores, classification consistency/accuracy, fairness evidence, and consequence review.

## 10. Validation evidence registry

Each public claim is governed by:

```text
content
response process
internal structure
relations to other variables
generalizability
fairness/invariance
consequences
```

Each category is `PASS`, `FAIL`, or `UNESTABLISHED`. Green CI is implementation evidence, not validity evidence.

Claim stages:

```text
EXPERIMENTAL
INSTRUMENT_READY
PROFILE_BOUND
GENERALIZABILITY_SUPPORTED
```

## 11. Explicit anti-shortcuts

AOS does not reward these as operator competence by themselves:

```text
longer prompts
more or fewer turns
verbosity
typing speed
wall-clock speed
raw tool count
agent autonomy level
confidence without correctness
explanation existence or length
```

Time and cost belong to System Outcome and require task/opportunity normalization before any comparison.

## 12. Research basis and evidence strength

### Authoritative measurement foundations

- AERA, APA, and NCME. *Standards for Educational and Psychological Testing* (2014).
- Mislevy, Almond, and Lukas. “A Brief Introduction to Evidence-Centered Design” (2003). DOI: 10.1002/j.2333-8504.2003.tb01908.x.
- Mislevy, Steinberg, and Almond. “On the Structure of Educational Assessments” (2003). DOI: 10.1207/S15366359MEA0101_02.
- Kane. “Validating the Interpretations and Uses of Test Scores” (2013). DOI: 10.1111/jedm.12000.
- Shavelson, Webb, and Rowley. “Generalizability Theory” (1989). DOI: 10.1037/0003-066X.44.6.922.
- Cronbach et al. “Generalizability Analysis for Performance Assessments of Student Achievement or School Effectiveness” (1997). DOI: 10.1177/0013164497057003001.

### Peer-reviewed human–AI evidence

- Buçinca, Malaya, and Gajos. “To Trust or to Think: Cognitive Forcing Functions Can Reduce Overreliance on AI in AI-assisted Decision-making” (CSCW 2021). DOI: 10.1145/3449287.
- Schemmer et al. “Appropriate Reliance on AI Advice: Conceptualization and the Effect of Explanations” (IUI 2023). DOI: 10.1145/3581641.3584066.
- Tankelevitch et al. “The Metacognitive Demands and Opportunities of Generative AI” (CHI 2024). DOI: 10.1145/3613904.3642902.
- Erlei, Sharma, and Gadiraju. “Understanding Choice Independence and Error Types in Human-AI Collaboration” (CHI 2024). DOI: 10.1145/3613904.3641946.
- Gor et al. “AI, Take the Wheel: What Drives Delegation and Trust in Human–Computer Cooperative Question Answering?” (Findings of ACL 2026). DOI: 10.18653/v1/2026.findings-acl.422.

### Repeated assessment, form effects, and transfer

- Basner et al. “Cognition Test Battery: Adjusting for Practice and Stimulus Set Effects…” (2020). PMC7375457.
- Benedict and Zgaljardic. Alternate forms and practice effects (1998). DOI: 10.1076/jcen.20.3.339.822.
- Köhler et al. Multi-group DIF methods (2024). DOI: 10.1111/jedm.12384.
- Shi et al. “When Models Know More Than They Can Explain: Quantifying Knowledge Transfer in Human-AI Collaboration” (NeurIPS 2025). arXiv:2506.05579.

### Recent supporting work — not sole authority

- Fernandes et al. “Performance and Metacognition Disconnect when Reasoning in Human-AI Interaction.” arXiv:2409.16708.
- “CollabSkill: Evaluating Human-Agent Collaboration on Real-World Tasks.” arXiv:2606.09833.
- Apartsin and Aperstein. “Framing, Judging, Steering…” arXiv:2606.05983.

Recent preprints inform task design and hypotheses, but they do not by themselves validate AOS.
