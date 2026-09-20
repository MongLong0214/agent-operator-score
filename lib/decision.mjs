// A decision is deliberately a scalar: true means established, false contradicted, and null means
// the available evidence did not establish either answer. Domain modules retain their own words
// (NOT_OBSERVED, UNESTABLISHED, not-checked, and so on) beside this value; those words explain the
// decision and are not interchangeable decisions themselves.

export const isEstablished = (decision) => decision === true;

/** Every required claim must be established. Empty, absent, and unrecognised inputs establish none. */
export function allRequired(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) return null;
  let result = true;
  for (const decision of decisions) {
    if (decision === false) return false;
    if (decision !== true) result = null;
  }
  return result;
}

/**
 * The only projection from a decision to a success boolean and process exit status.
 *
 * Callers may choose distinct non-success codes for contradiction and withholding, but neither may
 * become exit 0. The `ok` bit is always `isEstablished(decision)`, never a local interpretation of
 * a domain status or of JavaScript truthiness.
 */
export function decisionOutcome(decision, { established = 0, contradicted = 5, withheld = 4 } = {}) {
  const ok = isEstablished(decision);
  return Object.freeze({
    decision: decision === true || decision === false ? decision : null,
    ok,
    exit_code: ok ? established : decision === false ? contradicted : withheld
  });
}
