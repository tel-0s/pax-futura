/**
 * Live LLM smoke test — the one thing unit tests (fake provider only) can't
 * cover: does a REAL configured connection actually produce schema-valid
 * structured output end to end?
 *
 * Run with: `pnpm smoke` (== `node --experimental-strip-types scripts/smoke.ts`)
 *
 * Loads the LLM config with the exact same precedence as the server
 * (settings in app.sqlite > PAX_LLM_CONFIG file > config/llm.json >
 * built-in defaults — see main.ts's `loadInitialLlmConfig`). If nothing
 * resolves to a real provider (no credentials anywhere), this SKIPS with
 * exit 0 and a clear message — it must never fail CI or a fresh checkout for
 * the unremarkable reason that nobody's added a key yet.
 *
 * Otherwise it spends a small amount of real money: one tiny `simulateTurn`
 * against a 2-polity in-memory scenario (via the real engine orchestrator,
 * so this exercises the actual repair/reconcile pipeline, not a raw request)
 * and one `extractFacts` pass over the resulting events. Do not run this
 * from an automated loop — a human decided to spend credits by typing
 * `pnpm smoke`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PolitySchema,
  newId,
  emptyWorld,
  type TurnInput,
  type WorldState,
} from "../packages/domain/src/index.ts";
import { executeTurn, runExtraction } from "../packages/engine/src/index.ts";
import {
  DEFAULT_LLM_CONFIG,
  LlmConfigSchema,
  type LlmConfig,
} from "../packages/providers/src/index.ts";
import { loadConfig } from "../packages/server/src/config.ts";
import { getSetting, listLlmUsageSince, openAppDb } from "../packages/server/src/db/appDb.ts";
import { createSaveDb } from "../packages/server/src/db/saveDb.ts";
import { makeSavePort } from "../packages/server/src/savePort.ts";
import { buildProvider } from "../packages/server/src/llmProvider.ts";

/** Mirrors main.ts's `loadInitialLlmConfig` — duplicated because main.ts isn't a module we import from. */
const loadLlmConfig = (appDb: ReturnType<typeof openAppDb>): LlmConfig => {
  const stored = getSetting<unknown>(appDb, "llm-config");
  if (stored) {
    const parsed = LlmConfigSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    console.warn("Stored LLM config is invalid; falling back to file/defaults");
  }
  const filePath = process.env.PAX_LLM_CONFIG ?? resolve(import.meta.dirname, "../config/llm.json");
  try {
    const parsed = LlmConfigSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
    console.log(`loaded LLM config from ${filePath}`);
    return parsed;
  } catch (error) {
    if (process.env.PAX_LLM_CONFIG) {
      console.error(`Failed to load PAX_LLM_CONFIG (${filePath}):`, error);
      process.exit(1);
    }
    return DEFAULT_LLM_CONFIG;
  }
};

const twoPolityWorld = (): WorldState => ({
  ...emptyWorld(),
  polities: {
    FRA: PolitySchema.parse({ code: "FRA", name: "France" }),
    DEU: PolitySchema.parse({ code: "DEU", name: "Germany" }),
  },
});

const main = async (): Promise<void> => {
  const config = loadConfig();
  const appDb = openAppDb(config.dataDir);
  const llmConfig = loadLlmConfig(appDb);
  const provider = buildProvider(llmConfig, appDb);

  if (!provider.real) {
    console.log(`SKIP: no live LLM credentials configured (${provider.label}).`);
    console.log(
      "Add a connection + API key via Settings, config/llm.json, or PAX_LLM_CONFIG to run this for real.",
    );
    process.exit(0);
  }

  console.log(`simulator: ${provider.label}`);
  console.log(`extractor: ${provider.extractorLabel}`);

  const { db, rootNodeId } = createSaveDb(":memory:", {
    gameId: newId(),
    title: "Smoke Test",
    scenarioId: "smoke",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-01-01",
    world: twoPolityWorld(),
  });
  const store = makeSavePort(db);
  const startedAt = Date.now();

  console.log("\n--- simulateTurn ---");
  const turnInput: TurnInput = { actions: [], jumpDays: 7, stopPolicy: "toDate" };
  const node = await executeTurn(
    {
      store,
      llm: provider.llm,
      binding: provider.binding,
      emit: () => {},
      reconcile: { llm: provider.extractorLlm, binding: provider.extractorBinding },
    },
    { parentId: rootNodeId, input: turnInput },
  );
  if (node.status !== "complete") {
    throw new Error(`Turn did not complete: status=${node.status} error=${node.errorJson ?? ""}`);
  }
  console.log(`turn complete: ${node.gameDate} — "${node.summary}"`);
  const events = store.listEventsForNode(node.id);
  console.log(`  events: ${events.length}`);
  if (events.length === 0) throw new Error("Expected at least one event from a schema-valid turn result.");

  console.log("\n--- extractFacts ---");
  await runExtraction(
    { store, llm: provider.extractorLlm, binding: provider.extractorBinding, emit: () => {} },
    node.id,
  );
  const afterExtraction = store.getNode(node.id);
  if (afterExtraction?.extractionStatus !== "done") {
    throw new Error(`Extraction did not complete: status=${afterExtraction?.extractionStatus ?? "(missing node)"}`);
  }
  const facts = store.listFactsForNode(node.id);
  console.log(`  facts: ${facts.length}`);

  console.log("\n--- usage (from llm_usage_log, this run only) ---");
  for (const row of listLlmUsageSince(appDb, startedAt)) {
    console.log(
      `  [${row.taskLabel}] ${row.connectionId}/${row.model} — in:${row.inputTokens} out:${row.outputTokens} tokens, ${row.durationMs}ms, stop:${row.stopReason}`,
    );
  }

  console.log(`\nOK — ${Date.now() - startedAt}ms total.`);
  process.exit(0);
};

main().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
