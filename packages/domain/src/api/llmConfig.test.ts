import { describe, expect, it } from "vitest";
import { LlmConfigSchema } from "./llmConfig.ts";

const base = {
  connections: [
    { id: "openrouter", kind: "openai-compatible" as const, baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-x" },
  ],
};

describe("LlmConfigSchema reference validation", () => {
  it("accepts a consistent config", () => {
    const parsed = LlmConfigSchema.safeParse({
      ...base,
      roles: {
        simulator: { connectionId: "openrouter", model: "m", contextWindow: 1000, maxOutput: 100 },
        advisor: { inherit: "simulator" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects roles bound to unknown connections (the rename trap)", () => {
    const parsed = LlmConfigSchema.safeParse({
      ...base,
      roles: {
        simulator: { connectionId: "anthropic", model: "m", contextWindow: 1000, maxOutput: 100 },
      },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain('unknown connection "anthropic"');
  });

  it("rejects unknown inherit targets, duplicate ids, and missing simulator", () => {
    expect(
      LlmConfigSchema.safeParse({
        ...base,
        roles: {
          simulator: { connectionId: "openrouter", model: "m", contextWindow: 1000, maxOutput: 100 },
          advisor: { inherit: "nonexistent" },
        },
      }).success,
    ).toBe(false);

    expect(
      LlmConfigSchema.safeParse({
        connections: [...base.connections, ...base.connections],
        roles: { simulator: { connectionId: "openrouter", model: "m", contextWindow: 1000, maxOutput: 100 } },
      }).success,
    ).toBe(false);

    expect(LlmConfigSchema.safeParse({ ...base, roles: {} }).success).toBe(false);
  });
});
