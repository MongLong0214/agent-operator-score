const REFUSED = "concurrent calls and retries can overspend or replay a different fault.";

type Fail = { ok: false; reason: string };
type Decision = "grant" | "deny";
type Approval = { effectId: string; decision: Decision; sequence: number };
type ApprovalOk = { ok: true; approval: Approval };
type Gate = {
  ok: true;
  append: (input: unknown) => ApprovalOk | Fail;
  authorize: (input: unknown) => ApprovalOk | Fail;
  events: () => readonly Approval[];
};

const refuse = (): Fail => ({ ok: false, reason: REFUSED });

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFilledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const parseApproval = (value: unknown): { effectId: string; decision: Decision } | null => {
  if (!isPlainRecord(value) || !isFilledString(value.effectId)) return null;
  if (value.decision !== "grant" && value.decision !== "deny") return null;
  return { effectId: value.effectId, decision: value.decision };
};

const parseEffectId = (value: unknown): string | null =>
  isPlainRecord(value) && isFilledString(value.effectId) ? value.effectId : null;

const copyApproval = (approval: Approval): Approval => ({ ...approval });

export const ApprovalGate = (_input: unknown = undefined): Gate | Fail => {
  const approvals: Approval[] = [];

  const append = (input: unknown): ApprovalOk | Fail => {
    const request = parseApproval(input);
    if (request === null) return refuse();
    // Later decisions are new evidence, never an in-place correction of an earlier approval.
    const approval: Approval = { ...request, sequence: approvals.length };
    approvals.push(approval);
    return { ok: true, approval: copyApproval(approval) };
  };

  const authorize = (input: unknown): ApprovalOk | Fail => {
    const effectId = parseEffectId(input);
    if (effectId === null) return refuse();
    for (let index = approvals.length - 1; index >= 0; index -= 1) {
      const approval = approvals[index];
      if (approval.effectId !== effectId) continue;
      return approval.decision === "grant" ? { ok: true, approval: copyApproval(approval) } : refuse();
    }
    return refuse();
  };

  const events = (): readonly Approval[] => approvals.map(copyApproval);

  return { ok: true, append, authorize, events };
};
