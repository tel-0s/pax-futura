import { describe, expect, it } from "vitest";
import { DEFAULT_LLM_CONFIG, LlmConfigSchema, resolveRole } from "./config.ts";
import { sanitizeJsonSchemaForAnthropic } from "./jsonSchemaSanitize.ts";

describe("role resolution", () => {
  it("resolves concrete bindings and inherit chains", () => {
    const simulator = resolveRole(DEFAULT_LLM_CONFIG, "simulator");
    expect(simulator.model).toBe("claude-sonnet-5");
    const advisor = resolveRole(DEFAULT_LLM_CONFIG, "advisor");
    expect(advisor.model).toBe(simulator.model);
    const utility = resolveRole(DEFAULT_LLM_CONFIG, "utility");
    expect(utility.model).toBe("claude-haiku-4-5");
  });

  it("throws on unknown roles and circular inheritance", () => {
    expect(() => resolveRole(DEFAULT_LLM_CONFIG, "nonexistent")).toThrow(/Unknown model role/);
    const circular = LlmConfigSchema.parse({
      connections: [{ id: "a", kind: "anthropic" }],
      roles: {
        simulator: { connectionId: "a", model: "m", contextWindow: 1000, maxOutput: 100 },
        x: { inherit: "y" },
        y: { inherit: "x" },
      },
    });
    expect(() => resolveRole(circular, "x")).toThrow(/Circular/);
  });
});

describe("sanitizeJsonSchemaForAnthropic", () => {
  it("strips unsupported constraints and closes objects", () => {
    const sanitized = sanitizeJsonSchemaForAnthropic({
      type: "object",
      properties: {
        strength: { type: "integer", minimum: 0, maximum: 1000 },
        name: { type: "string", minLength: 1, maxLength: 50 },
        tags: { type: "array", maxItems: 8, items: { type: "string", pattern: "^[a-z]+$" } },
      },
      required: ["strength"],
    }) as Record<string, unknown>;

    expect(sanitized.additionalProperties).toBe(false);
    expect(sanitized.required).toEqual(["strength", "name", "tags"]);
    const props = sanitized.properties as Record<string, Record<string, unknown>>;
    expect(props.strength).toEqual({ type: "integer" });
    expect(props.name).toEqual({ type: "string" });
    expect((props.tags?.items as Record<string, unknown>)).toEqual({ type: "string" });
  });

  it("recurses into anyOf unions (discriminated unions survive)", () => {
    const sanitized = sanitizeJsonSchemaForAnthropic({
      anyOf: [
        { type: "object", properties: { op: { const: "spawn" }, n: { type: "number", minimum: 1 } } },
        { type: "object", properties: { op: { const: "remove" } } },
      ],
    }) as { anyOf: Array<Record<string, unknown>> };
    expect(sanitized.anyOf).toHaveLength(2);
    expect(sanitized.anyOf[0]?.additionalProperties).toBe(false);
  });
});
