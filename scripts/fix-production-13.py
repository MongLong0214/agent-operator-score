from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "lib" / "operator-plan.mjs"
text = path.read_text(encoding="utf-8")
old = '''  if (typeof plan.goal !== "string" || plan.goal.trim().length < 20) problems.push("goal must be an executable statement");
  if (!Array.isArray(plan.constraints) || !Array.isArray(plan.non_goals)) problems.push("constraints and non_goals must be arrays");
  if (!Array.isArray(plan.acceptance) || plan.acceptance.length < 3) problems.push("at least three acceptance/evidence pairs are required");
  const configured = new Set(configuredAgents);
'''
new = '''  if (typeof plan.goal !== "string" || plan.goal.trim().length < 20) problems.push("goal must be an executable statement");
  if (!Array.isArray(plan.constraints) || plan.constraints.length < 2 || plan.constraints.some((value) => typeof value !== "string" || value.trim().length === 0)) problems.push("at least two non-empty constraints are required");
  if (!Array.isArray(plan.non_goals) || plan.non_goals.length < 1 || plan.non_goals.some((value) => typeof value !== "string" || value.trim().length === 0)) problems.push("at least one non-empty non-goal is required");
  if (typeof plan.clarification_policy?.facts !== "string" || plan.clarification_policy.facts.trim().length === 0 || typeof plan.clarification_policy?.human_decisions !== "string" || plan.clarification_policy.human_decisions.trim().length === 0) problems.push("fact and human-decision clarification policies are required");
  if (!Array.isArray(plan.acceptance) || plan.acceptance.length < 3 || plan.acceptance.some((entry) => typeof entry?.criterion !== "string" || entry.criterion.trim().length === 0 || typeof entry?.evidence !== "string" || entry.evidence.trim().length === 0)) problems.push("at least three non-empty acceptance/evidence pairs are required");
  const configured = new Set(configuredAgents);
'''
if old not in text:
    raise SystemExit("operator plan validation patch target not found")
path.write_text(text.replace(old, new), encoding="utf-8")
print("Non-vacuous operator plan validation applied")
