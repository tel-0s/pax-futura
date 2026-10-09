import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.ts";
import { openDb } from "./openDb.ts";
import { APP_MIGRATIONS } from "./appSchema.ts";
import { getProviderRung, listLlmUsageSince, recordLlmUsage, setProviderRung } from "./appDb.ts";

const makeAppDb = () => {
  const db = openDb(":memory:");
  migrate(db, APP_MIGRATIONS);
  return db;
};

describe("provider rung persistence", () => {
  it("round-trips per connection+model, defaulting to null when unlearned", () => {
    const db = makeAppDb();
    expect(getProviderRung(db, "openrouter", "some-model")).toBeNull();

    setProviderRung(db, "openrouter", "some-model", "json_object");
    expect(getProviderRung(db, "openrouter", "some-model")).toBe("json_object");

    // Distinct model on the same connection stays independent.
    expect(getProviderRung(db, "openrouter", "other-model")).toBeNull();

    // Re-learning overwrites rather than duplicating the row.
    setProviderRung(db, "openrouter", "some-model", "json_schema");
    expect(getProviderRung(db, "openrouter", "some-model")).toBe("json_schema");
  });

  it("keys are scoped per connection — same model, different connection, independent rung", () => {
    const db = makeAppDb();
    setProviderRung(db, "conn-a", "shared-model", "json_object");
    expect(getProviderRung(db, "conn-b", "shared-model")).toBeNull();
    expect(getProviderRung(db, "conn-a", "shared-model")).toBe("json_object");
  });
});

describe("llm usage log", () => {
  it("records a call and lists it back since a timestamp", () => {
    const db = makeAppDb();
    const before = Date.now();
    recordLlmUsage(db, {
      connectionId: "anthropic",
      model: "claude-sonnet-5",
      taskLabel: "simulateTurn",
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      durationMs: 987,
      stopReason: "end",
    });

    const rows = listLlmUsageSince(db, before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      connectionId: "anthropic",
      model: "claude-sonnet-5",
      taskLabel: "simulateTurn",
      inputTokens: 120,
      outputTokens: 45,
      durationMs: 987,
      stopReason: "end",
    });
  });

  it("never throws even against a broken table", () => {
    const db = makeAppDb();
    db.exec("DROP TABLE llm_usage_log");
    expect(() =>
      recordLlmUsage(db, {
        connectionId: "anthropic",
        model: "x",
        taskLabel: "y",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        durationMs: 0,
        stopReason: "end",
      }),
    ).not.toThrow();
  });
});
