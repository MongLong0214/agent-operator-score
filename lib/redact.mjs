// One place where secret material is removed, and everything that leaves AOS goes through it.
//
// The dedicated secret rule already withheld the value it matched. It was not enough: the other
// rules quote raw session text as evidence -- the offending command line, the agent's completion
// sentence, a file path -- and a credential sitting inside any of those was reprinted verbatim by a
// tool whose whole purpose is to warn about credentials. A rule that hides its own match while its
// neighbour prints the same bytes has not redacted anything.
//
// So redaction is not a property of the secret rule. It is a property of the output.

// Ordered most specific first, so a key inside an assignment is labelled as the key rather than as
// the assignment. Each pattern matches the material, never a description of it: a sentence that
// says "do not commit your private key" carries nothing and must survive intact, because a refusal
// the operator wrote is exactly the evidence worth reading.
const PATTERNS = [
  ["private key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g],
  ["private key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}/g],
  ["AWS access key id", /\bAKIA[0-9A-Z]{16}\b/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  // The narrower prefix first, or it never matches. `sk-[A-Za-z0-9_-]{20,}` also matches every
  // `sk-ant-…`, so the Anthropic label was unreachable and its keys were reported as OpenAI ones.
  // The material was redacted either way; a finding that names the wrong vendor sends the operator
  // to rotate a key at the wrong provider.
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["JSON web token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ["connection string password", /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:@/]+):[^\s@/]+@/g],
  // An assignment is the shape a secret takes when nothing else identifies it. The name is kept and
  // the value is not, because knowing that AWS_SECRET_ACCESS_KEY was in a command is the actionable
  // half.
  ["assigned secret", /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?))\s*[=:]\s*("[^"\n]{6,}"|'[^'\n]{6,}'|[^\s"';,)]{6,})/gi],
  ["authorization header", /\b(authorization\s*:\s*)(?:bearer\s+)?[A-Za-z0-9._~+/=-]{12,}/gi]
];

const mask = (kind) => `[redacted: ${kind}]`;

/**
 * Removes secret material from a string, keeping everything else.
 *
 * Returns the text and the kinds that were removed, so a caller can say what happened without
 * repeating what it found.
 */
export function redactText(value) {
  if (typeof value !== "string" || value.length === 0) return { text: value, kinds: [] };
  let text = value;
  const kinds = new Set();
  for (const [kind, pattern] of PATTERNS) {
    text = text.replace(pattern, (match, keep) => {
      kinds.add(kind);
      // Patterns with a capture group keep the identifying half: the variable name, the header
      // name, or the scheme and user of a connection string. Tested with `typeof`, not against
      // undefined: replace passes the match offset in this position when the pattern has no group,
      // and a number is not undefined, so every group-less pattern printed its own offset.
      if (typeof keep !== "string") return mask(kind);
      if (kind === "connection string password") return `${keep}:${mask(kind)}@`;
      return `${keep}=${mask(kind)}`;
    });
  }
  return { text, kinds: [...kinds].sort() };
}

/** True when the text carries material this module would remove. */
export function containsSecretMaterial(value) {
  return redactText(value).kinds.length > 0;
}

/**
 * Deep-redacts any JSON-shaped value.
 *
 * Object keys are redacted too. A path like `/home/me/.aws/AKIA.../config` is a key in a map of
 * per-file counts in one of the rules, and a redactor that only walked values would print it.
 */
export function redactValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value).text;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen));
  if (value && typeof value === "object") {
    // A cycle would otherwise recurse until the stack ends, and a report that crashes is a report
    // that does not warn anybody.
    if (seen.has(value)) return "[cycle]";
    seen.add(value);
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[redactText(key).text] = redactValue(entry, seen);
    return out;
  }
  return value;
}

/** The single exit every finding passes through before it can be printed, written or served. */
export function redactFinding(finding) {
  return redactValue(finding);
}

