import { createHash } from "node:crypto";

import { canonicalJson, normalizeLineEndings, type JsonValue } from "./canonical-json.ts";

/**
 * SHA-256 over UTF-8. Split into a text digest and a value digest so a caller cannot accidentally
 * hash a JavaScript object's default string form: `sha256Text(String(value))` on an object yields
 * the digest of "[object Object]", which is stable, wrong, and impossible to notice downstream.
 */

export const sha256Text = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Digest of a file's text with line endings normalized first, so CRLF checkouts agree with LF. */
export const sha256FileText = (text: string): string => sha256Text(normalizeLineEndings(text));

/** Digest of a value through canonical JSON, so key order never changes the answer. */
export const sha256Value = (value: JsonValue): string => sha256Text(canonicalJson(value));

const HEX_64 = /^[0-9a-f]{64}$/;

/** A digest-shaped string. Used at trust boundaries where a caller supplies a claimed digest. */
export const isDigest = (value: unknown): value is string =>
  typeof value === "string" && HEX_64.test(value);
