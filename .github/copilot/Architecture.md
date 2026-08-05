# Architecture

The planned data flow is Scenario Registry → capability-aware Adapter → Isolated Runner → Normalized Trace → deterministic Oracle/Policy Graders → 20-Metric Scorer → deterministic Diagnosis → Markdown/JSON Reporter.

Trust boundaries are defined in ADR-0004 through ADR-0008. Missing observability never becomes an operator penalty; unsafe actions and insufficient evidence withhold the score.

