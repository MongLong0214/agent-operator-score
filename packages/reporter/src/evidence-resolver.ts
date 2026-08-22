import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { assertContainedEvidencePath } from "./path-policy.ts";

const REFUSAL = "report can cite missing or wrong-digest artifacts.";
const MAX_EXCERPT_LENGTH = 2048;
const SENSITIVE_ASSIGNMENT = /((?:api[_-]?key|secret|token|password)\s*[:=]\s*)([^\s,;]+)/gi;

type Json = Record<string, unknown>;

type Metric = {
  metricId: string;
  runId: string;
  opportunityId: string;
};

type Opportunity = {
  opportunityId: string;
  runId: string;
  eventId: string;
};

type Event = {
  eventId: string;
  runId: string;
  artifactId: string;
  artifactDigest: string;
  excerpt: string | null;
};

type Artifact = {
  artifactId: string;
  runId: string;
  path: string;
  digest: string;
};

const refuse = (): never => {
  throw new Error(REFUSAL);
};

const asRecord = (value: unknown): Json | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : null;

const filledString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

const metric = (value: unknown): Metric | null => {
  const record = asRecord(value);
  if (!record || !filledString(record.metric_id) || !filledString(record.run_id) || !filledString(record.opportunity_id)) return null;
  return { metricId: record.metric_id, runId: record.run_id, opportunityId: record.opportunity_id };
};

const opportunity = (value: unknown): Opportunity | null => {
  const record = asRecord(value);
  if (!record || !filledString(record.opportunity_id) || !filledString(record.run_id) || !filledString(record.event_id)) return null;
  return { opportunityId: record.opportunity_id, runId: record.run_id, eventId: record.event_id };
};

const event = (value: unknown): Event | null => {
  const record = asRecord(value);
  if (
    !record
    || !filledString(record.event_id)
    || !filledString(record.run_id)
    || !filledString(record.artifact_id)
    || !filledString(record.artifact_digest)
    || (record.excerpt !== null && (typeof record.excerpt !== "string" || record.excerpt.length > MAX_EXCERPT_LENGTH))
  ) return null;
  return {
    eventId: record.event_id,
    runId: record.run_id,
    artifactId: record.artifact_id,
    artifactDigest: record.artifact_digest,
    excerpt: record.excerpt
  };
};

const artifact = (value: unknown): Artifact | null => {
  const record = asRecord(value);
  if (!record || !filledString(record.artifact_id) || !filledString(record.run_id) || !filledString(record.path) || !filledString(record.digest)) return null;
  return { artifactId: record.artifact_id, runId: record.run_id, path: record.path, digest: record.digest };
};

const parseList = <T>(value: unknown, parse: (entry: unknown) => T | null): T[] | null => {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parse);
  return parsed.some((entry) => entry === null) ? null : parsed as T[];
};

const exactlyOne = <T>(entries: readonly T[], matches: (entry: T) => boolean): T | null => {
  const found = entries.filter(matches);
  return found.length === 1 ? found[0] : null;
};

const fileDigest = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

// An excerpt is an evidence pointer, never a raw artifact. Retain benign context while
// removing values assigned to common credential names before the resolved chain leaves here.
const redactExcerpt = (value: string | null): string | null =>
  value === null ? null : value.replace(SENSITIVE_ASSIGNMENT, "$1[REDACTED]");

export const resolveEvidenceChain = (input: unknown): Json => {
  const record = asRecord(input);
  if (!record || !filledString(record.run_id) || !filledString(record.evidence_root)) refuse();
  const sourceMetric = metric(record.metric);
  const opportunities = parseList(record.opportunities, opportunity);
  const events = parseList(record.events, event);
  const artifacts = parseList(record.artifacts, artifact);
  if (!sourceMetric || !opportunities || !events || !artifacts || sourceMetric.runId !== record.run_id) refuse();

  const sourceOpportunity = exactlyOne(opportunities, (entry) => entry.opportunityId === sourceMetric.opportunityId);
  if (!sourceOpportunity || sourceOpportunity.runId !== record.run_id) refuse();

  const sourceEvent = exactlyOne(events, (entry) => entry.eventId === sourceOpportunity.eventId);
  if (!sourceEvent || sourceEvent.runId !== record.run_id) refuse();

  const sourceArtifact = exactlyOne(artifacts, (entry) => entry.artifactId === sourceEvent.artifactId);
  if (
    !sourceArtifact
    || sourceArtifact.runId !== record.run_id
    || sourceEvent.artifactDigest !== sourceArtifact.digest
  ) refuse();

  const artifactPath = assertContainedEvidencePath(record.evidence_root, sourceArtifact.path);
  if (fileDigest(artifactPath) !== sourceArtifact.digest) refuse();

  return Object.freeze({
    run_id: record.run_id,
    metric_id: sourceMetric.metricId,
    opportunity_id: sourceOpportunity.opportunityId,
    event_id: sourceEvent.eventId,
    artifact_id: sourceArtifact.artifactId,
    artifact_digest: sourceArtifact.digest,
    artifact_path: artifactPath,
    excerpt: redactExcerpt(sourceEvent.excerpt)
  });
};
