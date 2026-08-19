type Json = Record<string, unknown>;

type OpportunityAudit = {
  ok: boolean;
  errors: string[];
  eligible_metric_ids: string[];
};

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

const asArray = (value: unknown): unknown[] | null => Array.isArray(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const auditOpportunities = (spec: unknown, assumptions: unknown): OpportunityAudit => {
  void spec;
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const primaryMetrics = new Set<string>();
  const secondaryWithoutPrimary: string[] = [];

  const input = asObject(assumptions);
  if (!input) {
    return { ok: false, errors: ["MALFORMED_ASSUMPTIONS"], eligible_metric_ids: [] };
  }

  const scenarios = asArray(input.scenarios);
  if (!scenarios) {
    return { ok: false, errors: ["SCENARIOS missing"], eligible_metric_ids: [] };
  }

  for (const scenarioValue of scenarios) {
    const scenario = asObject(scenarioValue);
    if (!scenario) {
      errors.push("MALFORMED_SCENARIO");
      continue;
    }
    const opportunities = asArray(scenario.primary_opportunities);
    if (!opportunities) {
      errors.push("PRIMARY_OPPORTUNITIES");
      continue;
    }
    for (const opportunityValue of opportunities) {
      const opportunity = asObject(opportunityValue);
      const opportunityId = asString(opportunity?.opportunity_id);
      if (!opportunityId) {
        errors.push("OPPORTUNITY_ID");
        continue;
      }
      if (seenIds.has(opportunityId)) {
        errors.push(`DOUBLE_COUNT ${opportunityId}`);
      }
      seenIds.add(opportunityId);

      const metricId = asString(opportunity?.metric_id);
      const role = asString(opportunity?.role) ?? "primary";
      if (!metricId) continue;
      if (role === "secondary") {
        if (!primaryMetrics.has(metricId)) secondaryWithoutPrimary.push(metricId);
      } else {
        primaryMetrics.add(metricId);
      }
    }
  }

  for (const metricId of secondaryWithoutPrimary) {
    if (!primaryMetrics.has(metricId)) {
      errors.push(`SECONDARY_UNOBSERVED ${metricId}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    eligible_metric_ids: [...primaryMetrics].sort()
  };
};
