import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const REFUSAL = "report can cite missing or wrong-digest artifacts.";

const refuse = (): never => {
  throw new Error(REFUSAL);
};

const relativePath = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\\") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== ".");
};

const containedBy = (root: string, target: string): boolean => {
  const fromRoot = relative(root, target);
  return fromRoot !== ".." && !fromRoot.startsWith("../") && !isAbsolute(fromRoot);
};

// This policy resolves both the evidence root and every candidate component. A lexical prefix
// check would accept an in-root symlink whose target is outside the evidence root.
export const assertContainedEvidencePath = (evidenceRoot: unknown, candidate: unknown): string => {
  if (typeof evidenceRoot !== "string" || evidenceRoot.length === 0 || !relativePath(candidate)) refuse();
  try {
    const root = realpathSync(evidenceRoot);
    const physicalTarget = realpathSync(resolve(root, candidate));
    if (!containedBy(root, physicalTarget)) refuse();
    return physicalTarget;
  } catch (error) {
    if (error instanceof Error && error.message === REFUSAL) throw error;
    return refuse();
  }
};
