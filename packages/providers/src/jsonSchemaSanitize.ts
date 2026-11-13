/**
 * Anthropic structured outputs accept a JSON Schema subset: numeric bounds
 * (minimum/maximum/multipleOf), string bounds (minLength/maxLength/pattern),
 * and array bounds (minItems/maxItems) are unsupported, and every object needs
 * `additionalProperties: false`. The full Zod schema still re-validates the
 * payload client-side, so stripping constraints here loses nothing.
 */
const UNSUPPORTED_KEYS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "propertyNames",
]);

export const sanitizeJsonSchemaForAnthropic = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map(sanitizeJsonSchemaForAnthropic);
  }
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;
    // The endpoint rejects `oneOf` outright; `anyOf` is the supported
    // near-equivalent (these unions' branches are mutually exclusive, and
    // the full Zod schema re-validates the payload client-side anyway).
    const outKey = key === "oneOf" ? "anyOf" : key;
    // A huge enum (the region catalog is thousands of ids) blows the
    // endpoint's compiled grammar ("The compiled grammar is too large").
    // Drop it and let the client-side Zod validation hold the line — the
    // engine already rejects invented ids after the parse.
    if (key === "enum" && Array.isArray(value) && value.length > 24) continue;
    const next = sanitizeJsonSchemaForAnthropic(value);
    output[outKey] =
      Array.isArray(output[outKey]) && Array.isArray(next)
        ? [...(output[outKey] as unknown[]), ...(next as unknown[])]
        : next;
  }

  if (output.type === "object") {
    output.additionalProperties = false;
    // Strict object schemas require every property listed in `required`.
    if (output.properties && typeof output.properties === "object") {
      output.required = Object.keys(output.properties as Record<string, unknown>);
    }
  }

  return output;
};
