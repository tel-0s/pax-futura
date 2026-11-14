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

  // A node carrying BOTH `oneOf` and `anyOf` means "this AND exactly one of
  // that"; folding them into one `anyOf` would weaken it to "this OR that".
  // Wrap each as its own `allOf` conjunct instead (no current engine schema
  // hits this; the guard keeps the meaning if one ever does).
  if (Array.isArray(input.oneOf) && Array.isArray(input.anyOf)) {
    const { oneOf, anyOf, allOf, ...rest } = input;
    return sanitizeJsonSchemaForAnthropic({
      ...rest,
      allOf: [...(Array.isArray(allOf) ? allOf : []), { anyOf: oneOf }, { anyOf: anyOf }],
    });
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (UNSUPPORTED_KEYS.has(key)) continue;
    // The endpoint rejects `oneOf` outright; `anyOf` is the supported
    // near-equivalent (these unions' branches are mutually exclusive, and
    // the full Zod schema re-validates the payload client-side anyway).
    const outKey = key === "oneOf" ? "anyOf" : key;
    // An oversized enum would blow the endpoint's compiled-grammar budget.
    // No schema the engine sends today carries one (region ids are plain
    // strings, validated after the parse), so this is a guard against a
    // future catalog riding the wire, not a live constraint.
    if (key === "enum" && Array.isArray(value) && value.length > 24) continue;
    output[outKey] = sanitizeJsonSchemaForAnthropic(value);
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
