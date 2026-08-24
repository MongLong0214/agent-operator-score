/**
 * Canonical JSON serialization: keys sorted, no incidental whitespace.
 *
 * The algorithm is transcribed from `scripts/verify-g0.mjs`, which produced every digest the G0
 * fixture manifest and the published vector pack are pinned to. It is reproduced rather than
 * reimplemented because a different-but-reasonable canonicalization would change those bytes, and
 * the bytes are what the gate compares. Any change here invalidates recorded digests.
 *
 * `undefined` is not representable: `JSON.stringify` returns `undefined` for it, which would splice
 * the literal text `undefined` into an object body and produce output that is not JSON at all. It
 * is rejected rather than silently dropped, because a dropped key changes a digest without changing
 * anything a reader can see.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const canonicalJson = (value: JsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as { readonly [key: string]: JsonValue };
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`AOS_INTERNAL_ERROR ${String(value)} has no JSON representation`);
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("AOS_INTERNAL_ERROR undefined has no JSON representation");
  }
  return encoded;
};

/**
 * Line endings are normalized before a text digest is taken, so a file checked out with CRLF
 * carries the same digest as the same file with LF. Without this the same repository fails its own
 * fixture gate on a differently-configured checkout.
 */
export const normalizeLineEndings = (text: string): string =>
  text.split("\r\n").join("\n").split("\r").join("\n");
