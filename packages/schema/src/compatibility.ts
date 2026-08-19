/**
 * Schema compatibility classifier for SSOT 6 / E1-003.
 *
 * `classifySchemaChange` compares two JSON Schema documents and returns a semver
 * verdict for the change between them. The gate this feeds refuses a silent
 * breaking change: any difference that can reject a document the previous schema
 * accepted is `major`, any difference that can only widen acceptance is `minor`,
 * and only annotation drift is `patch`.
 *
 * A keyword this classifier does not recognize is reported as `UNCLASSIFIED_CHANGE`
 * at `major`. Failing closed is the point: an unrecognized change reported as
 * compatible is exactly the silent breaking change the ticket forbids. Pattern and
 * `$ref` changes are `major` for the same reason - regular-language containment is
 * not decidable here, so the conservative verdict is the honest one.
 */

export type SchemaChangeVerdict = "major" | "minor" | "patch";

export type SchemaChangeReason = {
  code: string;
  pointer: string;
  detail: string;
};

export type SchemaChangeClassification = {
  ok: boolean;
  verdict: SchemaChangeVerdict | null;
  breaking: boolean;
  reasons: SchemaChangeReason[];
  errors: string[];
};

const SEVERITY: Record<SchemaChangeVerdict, number> = { patch: 0, minor: 1, major: 2 };

// Bound keywords whose numeric value moving up narrows acceptance, and whose absence
// is the widest possible setting.
const UPWARD_TIGHTENS = [
  "minLength", "minItems", "minProperties", "minimum", "exclusiveMinimum", "multipleOf"
];
// Bound keywords whose numeric value moving down narrows acceptance.
const DOWNWARD_TIGHTENS = [
  "maxLength", "maxItems", "maxProperties", "maximum", "exclusiveMaximum"
];

const ANNOTATION_KEYWORDS = [
  "description", "$comment", "examples", "default", "deprecated", "readOnly", "writeOnly"
];
const IDENTITY_KEYWORDS = ["title", "$id", "$schema"];
const SCHEMA_MAP_KEYWORDS = ["properties", "$defs", "definitions", "patternProperties"];
const SCHEMA_LIST_KEYWORDS = ["oneOf", "anyOf", "allOf"];
const SUBSCHEMA_KEYWORDS = ["items", "contains", "not", "propertyNames", "additionalItems"];

const KNOWN_KEYWORDS = new Set([
  ...ANNOTATION_KEYWORDS,
  ...IDENTITY_KEYWORDS,
  ...SCHEMA_MAP_KEYWORDS,
  ...SCHEMA_LIST_KEYWORDS,
  ...SUBSCHEMA_KEYWORDS,
  ...UPWARD_TIGHTENS,
  ...DOWNWARD_TIGHTENS,
  "type",
  "const",
  "enum",
  "required",
  "additionalProperties",
  "unevaluatedProperties",
  "pattern",
  "format",
  "uniqueItems",
  "$ref"
]);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const same = (left: unknown, right: unknown): boolean => stableJson(left) === stableJson(right);

const escapeSegment = (segment: string): string => segment.split("~").join("~0").split("/").join("~1");

const childPointer = (pointer: string, segment: string): string =>
  `${pointer}/${escapeSegment(segment)}`;

const asStringSet = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return [];
};

const asValueSet = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => stableJson(entry)) : [];

const isJsonType = (value: unknown): boolean =>
  value === null ||
  typeof value === "boolean" ||
  typeof value === "number" ||
  typeof value === "string" ||
  Array.isArray(value) ||
  isPlainRecord(value);

type Collector = (code: string, pointer: string, detail: string) => void;

type Walker = (before: unknown, after: unknown, pointer: string, push: Collector) => void;

const compareBoundFamily = (
  keywords: string[],
  tightensUpward: boolean,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  pointer: string,
  push: Collector
): void => {
  for (const keyword of keywords) {
    const had = Object.hasOwn(before, keyword);
    const has = Object.hasOwn(after, keyword);
    if (!had && !has) continue;
    if (had && has && same(before[keyword], after[keyword])) continue;
    if (!had && has) {
      push(
        "CONSTRAINT_TIGHTENED",
        childPointer(pointer, keyword),
        `${keyword} introduced as ${String(after[keyword])}`
      );
      continue;
    }
    if (had && !has) {
      push("CONSTRAINT_RELAXED", childPointer(pointer, keyword), `${keyword} removed`);
      continue;
    }
    const moved = Number(after[keyword]) - Number(before[keyword]);
    const tightened = tightensUpward ? moved > 0 : moved < 0;
    push(
      tightened ? "CONSTRAINT_TIGHTENED" : "CONSTRAINT_RELAXED",
      childPointer(pointer, keyword),
      `${keyword} ${String(before[keyword])} became ${String(after[keyword])}`
    );
  }
};

const compareSchemaMap = (
  keyword: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  pointer: string,
  push: Collector,
  walk: Walker
): void => {
  const beforeMap = isPlainRecord(before[keyword]) ? (before[keyword] as Record<string, unknown>) : {};
  const afterMap = isPlainRecord(after[keyword]) ? (after[keyword] as Record<string, unknown>) : {};
  const mapPointer = childPointer(pointer, keyword);
  const definitionMap = keyword === "$defs" || keyword === "definitions";
  for (const key of Object.keys(beforeMap).sort()) {
    if (Object.hasOwn(afterMap, key)) {
      walk(beforeMap[key], afterMap[key], childPointer(mapPointer, key), push);
      continue;
    }
    push(
      definitionMap ? "DEFINITION_REMOVED" : "PROPERTY_REMOVED",
      childPointer(mapPointer, key),
      `${key} is no longer declared`
    );
  }
  for (const key of Object.keys(afterMap).sort()) {
    if (Object.hasOwn(beforeMap, key)) continue;
    push(
      definitionMap ? "DEFINITION_ADDED" : "PROPERTY_ADDED",
      childPointer(mapPointer, key),
      `${key} is newly declared`
    );
  }
};

const compareSchemaList = (
  keyword: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  pointer: string,
  push: Collector,
  walk: Walker
): void => {
  const beforeList = Array.isArray(before[keyword]) ? (before[keyword] as unknown[]) : [];
  const afterList = Array.isArray(after[keyword]) ? (after[keyword] as unknown[]) : [];
  const listPointer = childPointer(pointer, keyword);
  const shared = Math.min(beforeList.length, afterList.length);
  for (let index = 0; index < shared; index += 1) {
    walk(beforeList[index], afterList[index], childPointer(listPointer, String(index)), push);
  }
  for (let index = shared; index < beforeList.length; index += 1) {
    push("SUBSCHEMA_REMOVED", childPointer(listPointer, String(index)), `${keyword} branch ${index} removed`);
  }
  for (let index = shared; index < afterList.length; index += 1) {
    // An extra allOf branch is another conjunct every document must satisfy, so it narrows.
    push(
      keyword === "allOf" ? "SUBSCHEMA_ADDED_REQUIRED" : "SUBSCHEMA_ADDED",
      childPointer(listPointer, String(index)),
      `${keyword} branch ${index} added`
    );
  }
};

const walkSchema: Walker = (before, after, pointer, push) => {
  if (same(before, after)) return;
  if (!isPlainRecord(before) || !isPlainRecord(after)) {
    push("UNCLASSIFIED_CHANGE", pointer, "a subschema changed shape and cannot be classified");
    return;
  }

  for (const keyword of IDENTITY_KEYWORDS) {
    if (same(before[keyword], after[keyword])) continue;
    push(
      "IDENTITY_CHANGED",
      childPointer(pointer, keyword),
      `${keyword} ${String(before[keyword])} became ${String(after[keyword])}`
    );
  }
  for (const keyword of ANNOTATION_KEYWORDS) {
    if (same(before[keyword], after[keyword])) continue;
    push(
      keyword === "description" ? "DESCRIPTION_CHANGED" : "ANNOTATION_CHANGED",
      childPointer(pointer, keyword),
      `${keyword} changed`
    );
  }

  if (!same(before.$ref, after.$ref)) {
    push(
      "REF_CHANGED",
      childPointer(pointer, "$ref"),
      `$ref ${String(before.$ref)} became ${String(after.$ref)}`
    );
  }

  if ((Object.hasOwn(before, "const") || Object.hasOwn(after, "const")) && !same(before.const, after.const)) {
    push(
      "CONST_CHANGED",
      childPointer(pointer, "const"),
      `const ${stableJson(before.const)} became ${stableJson(after.const)}`
    );
  }

  if (!same(before.enum, after.enum)) {
    const beforeValues = asValueSet(before.enum);
    const afterValues = asValueSet(after.enum);
    const removed = beforeValues.filter((value) => !afterValues.includes(value));
    const added = afterValues.filter((value) => !beforeValues.includes(value));
    if (removed.length) push("ENUM_NARROWED", childPointer(pointer, "enum"), `enum dropped ${removed.join(", ")}`);
    if (added.length) push("ENUM_WIDENED", childPointer(pointer, "enum"), `enum gained ${added.join(", ")}`);
  }

  if (!same(before.type, after.type)) {
    const beforeTypes = asStringSet(before.type);
    const afterTypes = asStringSet(after.type);
    const removed = beforeTypes.filter((value) => !afterTypes.includes(value));
    const added = afterTypes.filter((value) => !beforeTypes.includes(value));
    if (removed.length) push("TYPE_NARROWED", childPointer(pointer, "type"), `type dropped ${removed.join(", ")}`);
    if (added.length) push("TYPE_WIDENED", childPointer(pointer, "type"), `type gained ${added.join(", ")}`);
  }

  if (!same(before.required, after.required)) {
    const beforeRequired = asStringSet(before.required);
    const afterRequired = asStringSet(after.required);
    const added = afterRequired.filter((name) => !beforeRequired.includes(name));
    const removed = beforeRequired.filter((name) => !afterRequired.includes(name));
    if (added.length) {
      push("REQUIRED_ADDED", childPointer(pointer, "required"), `required gained ${added.join(", ")}`);
    }
    if (removed.length) {
      push("REQUIRED_REMOVED", childPointer(pointer, "required"), `required dropped ${removed.join(", ")}`);
    }
  }

  for (const keyword of ["additionalProperties", "unevaluatedProperties"]) {
    if (same(before[keyword], after[keyword])) continue;
    const wasOpen = before[keyword] !== false;
    const isOpen = after[keyword] !== false;
    if (wasOpen === isOpen) {
      walkSchema(before[keyword], after[keyword], childPointer(pointer, keyword), push);
      continue;
    }
    push(
      isOpen ? "ADDITIONAL_PROPERTIES_OPENED" : "ADDITIONAL_PROPERTIES_CLOSED",
      childPointer(pointer, keyword),
      `${keyword} ${isOpen ? "no longer rejects" : "now rejects"} undeclared members`
    );
  }

  if (!same(before.pattern, after.pattern)) {
    push(
      "PATTERN_CHANGED",
      childPointer(pointer, "pattern"),
      `pattern ${String(before.pattern)} became ${String(after.pattern)}`
    );
  }
  if (!same(before.format, after.format)) {
    push(
      "FORMAT_CHANGED",
      childPointer(pointer, "format"),
      `format ${String(before.format)} became ${String(after.format)}`
    );
  }
  if (!same(before.uniqueItems, after.uniqueItems)) {
    push(
      after.uniqueItems === true ? "CONSTRAINT_TIGHTENED" : "CONSTRAINT_RELAXED",
      childPointer(pointer, "uniqueItems"),
      `uniqueItems ${String(before.uniqueItems)} became ${String(after.uniqueItems)}`
    );
  }

  compareBoundFamily(UPWARD_TIGHTENS, true, before, after, pointer, push);
  compareBoundFamily(DOWNWARD_TIGHTENS, false, before, after, pointer, push);

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    if (same(before[keyword], after[keyword])) continue;
    compareSchemaMap(keyword, before, after, pointer, push, walkSchema);
  }
  for (const keyword of SCHEMA_LIST_KEYWORDS) {
    if (same(before[keyword], after[keyword])) continue;
    compareSchemaList(keyword, before, after, pointer, push, walkSchema);
  }
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    if (same(before[keyword], after[keyword])) continue;
    walkSchema(before[keyword], after[keyword], childPointer(pointer, keyword), push);
  }

  for (const keyword of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (KNOWN_KEYWORDS.has(keyword)) continue;
    if (same(before[keyword], after[keyword])) continue;
    push("UNCLASSIFIED_CHANGE", childPointer(pointer, keyword), `${keyword} changed and is not classifiable`);
  }
};

const SEVERITY_BY_CODE: Record<string, SchemaChangeVerdict> = {
  ADDITIONAL_PROPERTIES_CLOSED: "major",
  ADDITIONAL_PROPERTIES_OPENED: "minor",
  ANNOTATION_CHANGED: "patch",
  CONSTRAINT_RELAXED: "minor",
  CONSTRAINT_TIGHTENED: "major",
  CONST_CHANGED: "major",
  DEFINITION_ADDED: "minor",
  DEFINITION_REMOVED: "major",
  DESCRIPTION_CHANGED: "patch",
  ENUM_NARROWED: "major",
  ENUM_WIDENED: "minor",
  FORMAT_CHANGED: "major",
  IDENTITY_CHANGED: "major",
  PATTERN_CHANGED: "major",
  PROPERTY_ADDED: "minor",
  PROPERTY_REMOVED: "major",
  REF_CHANGED: "major",
  REQUIRED_ADDED: "major",
  REQUIRED_REMOVED: "minor",
  SUBSCHEMA_ADDED: "minor",
  SUBSCHEMA_ADDED_REQUIRED: "major",
  SUBSCHEMA_REMOVED: "major",
  TYPE_NARROWED: "major",
  TYPE_WIDENED: "minor",
  UNCLASSIFIED_CHANGE: "major"
};

export const classifySchemaChange = (before: unknown, after: unknown): SchemaChangeClassification => {
  const errors: string[] = [];
  if (!isPlainRecord(before)) errors.push("SCHEMA_INVALID the previous schema must be a JSON object");
  if (!isPlainRecord(after)) errors.push("SCHEMA_INVALID the candidate schema must be a JSON object");
  if (!isJsonType(before) || !isJsonType(after)) {
    errors.push("SCHEMA_INVALID a schema must be representable as JSON");
  }
  if (errors.length > 0) {
    return { ok: false, verdict: null, breaking: false, reasons: [], errors };
  }

  const reasons: SchemaChangeReason[] = [];
  const seen = new Set<string>();
  walkSchema(before, after, "#", (code, pointer, detail) => {
    const key = `${code} ${pointer}`;
    if (seen.has(key)) return;
    seen.add(key);
    reasons.push({ code, pointer, detail });
  });

  for (const reason of reasons) {
    if (SEVERITY_BY_CODE[reason.code] !== undefined) continue;
    // A reason with no registered severity would otherwise score as patch, which is the
    // silent breaking change this classifier exists to prevent.
    errors.push(`SEVERITY_UNREGISTERED ${reason.code} has no compatibility severity`);
  }
  if (errors.length > 0) {
    return { ok: false, verdict: null, breaking: false, reasons, errors };
  }

  let severity = SEVERITY.patch;
  for (const reason of reasons) {
    severity = Math.max(severity, SEVERITY[SEVERITY_BY_CODE[reason.code]]);
  }
  const verdict: SchemaChangeVerdict =
    severity === SEVERITY.major ? "major" : severity === SEVERITY.minor ? "minor" : "patch";

  return { ok: true, verdict, breaking: verdict === "major", reasons, errors: [] };
};
