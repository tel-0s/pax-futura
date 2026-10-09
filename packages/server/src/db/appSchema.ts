import type { Migration } from "./migrate.ts";

/** Global app.sqlite: settings, themes, save registry, provider-rung memo. */
export const APP_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE game_registry (
  game_id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  scenario_id TEXT NOT NULL DEFAULT '',
  player_polity TEXT NOT NULL DEFAULT '',
  last_played_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Which structured-output rung worked for a given connection+model, so the
-- degradation ladder is climbed once, not on every call.
CREATE TABLE provider_rungs (
  connection_id TEXT NOT NULL,
  model TEXT NOT NULL,
  rung TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, model)
);
`,
  },
  {
    version: 2,
    sql: `
-- Reusable custom nations/organizations: identity only (name, colors, flag,
-- tags, backstory). Territory (baseCode) is scenario-specific and chosen per
-- game, so it is deliberately not part of the stored payload.
CREATE TABLE saved_polities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    version: 3,
    sql: `
-- Global LLM usage ledger. NOT the per-save llm_calls table (saveSchema.ts):
-- the provider is built once per server process and shared across every open
-- game (GameManager holds one live LlmClient, swapped live from Settings, not
-- one per game), so the wrapper that records usage (llmProvider.ts) has no
-- game/node context to target a specific save's llm_calls row with. This
-- table is the honest home for that global vantage point; a future
-- node-scoped logger wired inside the engine's turn/extraction call sites
-- (which DO have node context) can write llm_calls separately. Feeds the
-- token budgeter later — not surfaced in UI yet.
CREATE TABLE llm_usage_log (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  model TEXT NOT NULL,
  task_label TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_llm_usage_log_model ON llm_usage_log(connection_id, model);
CREATE INDEX idx_llm_usage_log_created ON llm_usage_log(created_at);
`,
  },
];
