import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { DEFAULT_LLM_CONFIG, LlmConfigSchema, type LlmConfig } from "@pax/providers";
import { loadConfig } from "./config.ts";
import { getSetting, openAppDb, setSetting } from "./db/appDb.ts";
import { loadScenarios } from "./scenarios.ts";
import { GameManager } from "./gameManager.ts";
import { createApp } from "./app.ts";
import { mountMapAssets } from "./routes/mapAssets.ts";
import { mountThemes } from "./routes/themes.ts";
import { mountSavedPolities } from "./routes/savedPolities.ts";
import { mountPublishScenario } from "./routes/publishScenario.ts";
import { mountLlmConfig } from "./routes/llmConfig.ts";
import { buildProvider } from "./llmProvider.ts";

const config = loadConfig();
const appDb = openAppDb(config.dataDir);
const scenariosDir = process.env.PAX_SCENARIOS_DIR ?? resolve(import.meta.dirname, "../../../scenarios");
const scenarios = loadScenarios(scenariosDir);

/**
 * LLM config precedence: settings saved from the UI > PAX_LLM_CONFIG file >
 * config/llm.json at the repo root > built-in Anthropic defaults.
 */
const loadInitialLlmConfig = (): LlmConfig => {
  const stored = getSetting<unknown>(appDb, "llm-config");
  if (stored) {
    const parsed = LlmConfigSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    console.warn("Stored LLM config is invalid; falling back to file/defaults");
  }
  const filePath =
    process.env.PAX_LLM_CONFIG ?? resolve(import.meta.dirname, "../../../config/llm.json");
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

let llmConfig = loadInitialLlmConfig();
let provider = buildProvider(llmConfig);
const manager = new GameManager(
  appDb,
  config.dataDir,
  () => loadScenarios(scenariosDir),
  provider.llm,
  provider.binding,
  provider.extractorLlm,
  provider.extractorBinding,
);

const app = createApp(manager);
mountMapAssets(app, config.mapAssetsDir);
mountThemes(app, appDb);
mountSavedPolities(app, appDb);
mountPublishScenario(app, manager, scenariosDir);
mountLlmConfig(app, {
  get: () => ({ config: llmConfig, provider: provider.label, real: provider.real }),
  update: (next) => {
    llmConfig = next;
    setSetting(appDb, "llm-config", next);
    provider = buildProvider(next);
    manager.setLlm(provider.llm, provider.binding, provider.extractorLlm, provider.extractorBinding);
    console.log(`simulator switched to ${provider.label}`);
    return { provider: provider.label, real: provider.real };
  },
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`pax-futura server listening on http://localhost:${info.port}`);
  console.log(`  data:      ${config.dataDir}`);
  console.log(`  scenarios: ${scenarios.size} loaded from ${scenariosDir}`);
  console.log(`  simulator: ${provider.label}`);
  console.log(`  extractor: ${provider.extractorLabel}`);
});
