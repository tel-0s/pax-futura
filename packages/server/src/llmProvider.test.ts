import { afterEach, describe, expect, it } from "vitest";
import type { LlmConfig } from "@pax/providers";
import { migrate } from "./db/migrate.ts";
import { openDb } from "./db/openDb.ts";
import { APP_MIGRATIONS } from "./db/appSchema.ts";
import { listLlmUsageSince } from "./db/appDb.ts";
import { buildProvider } from "./llmProvider.ts";

const makeAppDb = () => {
  const db = openDb(":memory:");
  migrate(db, APP_MIGRATIONS);
  return db;
};

const fakeConfig: LlmConfig = {
  connections: [{ id: "anthropic", kind: "anthropic", apiKeyEnv: "PAX_TEST_NO_SUCH_KEY" }],
  roles: {
    simulator: { connectionId: "anthropic", model: "claude-sonnet-5", contextWindow: 200000, maxOutput: 16000 },
    extractor: { connectionId: "anthropic", model: "claude-haiku-4-5", contextWindow: 200000, maxOutput: 4096 },
    advisor: { inherit: "simulator" },
    diplomat: { inherit: "simulator" },
    utility: { inherit: "extractor" },
  },
};

describe("buildProvider usage logging", () => {
  afterEach(() => {
    delete process.env.PAX_FAKE_LLM;
  });

  it("records a completed call against the injected app db", async () => {
    const appDb = makeAppDb();
    const before = Date.now();
    // No credentials on the only connection -> resolves to the fake provider,
    // which is still wrapped with usage logging the same as a real one.
    const provider = buildProvider(fakeConfig, appDb);
    expect(provider.real).toBe(false);

    await provider.llm
      .stream(
        { system: [{ text: "sys" }], messages: [{ role: "user", text: "hi" }], taskLabel: "simulateTurn" },
        provider.binding,
      )
      .final();

    const rows = listLlmUsageSince(appDb, before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: provider.binding.model, taskLabel: "simulateTurn" });
    expect(rows[0]!.outputTokens).toBeGreaterThan(0);
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs the simulator and extractor roles as separate calls", async () => {
    const appDb = makeAppDb();
    const before = Date.now();
    const provider = buildProvider(fakeConfig, appDb);

    await provider.llm.stream({ system: [], messages: [], taskLabel: "simulateTurn" }, provider.binding).final();
    await provider.extractorLlm
      .stream({ system: [], messages: [], taskLabel: "extractFacts" }, provider.extractorBinding)
      .final();

    const rows = listLlmUsageSince(appDb, before);
    expect(rows.map((row) => row.taskLabel).sort()).toEqual(["extractFacts", "simulateTurn"]);
  });

  it("honors PAX_FAKE_LLM=1 and still logs through the wrapper", async () => {
    process.env.PAX_FAKE_LLM = "1";
    const appDb = makeAppDb();
    const before = Date.now();
    const provider = buildProvider(fakeConfig, appDb);
    expect(provider.real).toBe(false);
    expect(provider.label).toContain("PAX_FAKE_LLM=1");

    await provider.llm.stream({ system: [], messages: [], taskLabel: "simulateTurn" }, provider.binding).final();
    expect(listLlmUsageSince(appDb, before)).toHaveLength(1);
  });
});
