import type { Migration } from "./migrate.ts";

/** Per-game save DB (<gameId>.pax.sqlite): the loom tree and everything on it. */
export const SAVE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE game (
  id TEXT PRIMARY KEY CHECK (id = 'game'),
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  scenario_id TEXT NOT NULL DEFAULT '',
  player_polity TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'standard',
  language TEXT NOT NULL DEFAULT 'English',
  active_node_id TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Content-addressed compressed JSON blobs (world snapshots, static assets).
-- Dedup is free: regenerated siblings with identical outcomes share a row.
CREATE TABLE blobs (
  hash TEXT PRIMARY KEY,
  codec TEXT NOT NULL DEFAULT 'gzip',
  uncompressed_len INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE timeline_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generating','complete','failed')),
  game_date TEXT NOT NULL,
  input_json TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  world_blob_hash TEXT REFERENCES blobs(hash),
  preferred_child_id TEXT REFERENCES timeline_nodes(id) ON DELETE SET NULL,
  prompt_pack_version TEXT NOT NULL DEFAULT '',
  extraction_status TEXT NOT NULL DEFAULT 'none'
    CHECK (extraction_status IN ('none','pending','done','failed')),
  error_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_nodes_parent ON timeline_nodes(parent_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_date TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'world',
  importance TEXT NOT NULL DEFAULT 'minor',
  player_related INTEGER NOT NULL DEFAULT 0,
  impacts_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_events_node ON events(node_id, seq);

CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  subjects_json TEXT NOT NULL DEFAULT '[]',
  arc_id TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('derived','extracted')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_facts_node ON facts(node_id, seq);

CREATE TABLE node_rollups (
  node_id TEXT PRIMARY KEY REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  rollup_json TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('advisor','diplomacy')),
  title TEXT NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  origin_node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- Immutable message tree; only head pointers are per-node.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_message_id TEXT REFERENCES messages(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  speaker TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  authored_node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_conv_parent ON messages(conversation_id, parent_message_id);

-- The loom scoping pivot: which conversations exist at a node, and which
-- message path is selected there. Copied parent -> child at turn execution;
-- that copy IS the canonical conversation the child inherits.
CREATE TABLE node_conversation_state (
  node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  head_message_id TEXT REFERENCES messages(id),
  PRIMARY KEY (node_id, conversation_id)
);

-- Draft orders scoped to the node they are planned at.
CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_pending_node ON pending_actions(node_id);

-- Scenario geometry/flags, written once at game creation.
CREATE TABLE static_assets (
  key TEXT PRIMARY KEY,
  blob_hash TEXT NOT NULL REFERENCES blobs(hash)
);

-- Per-save prompt-module overrides (scenario flavor, user tweaks). The prompt
-- pack itself lives in code and is never frozen into a save.
CREATE TABLE prompt_overrides (
  module_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('replace','append')),
  text TEXT NOT NULL
);

CREATE TABLE llm_calls (
  id TEXT PRIMARY KEY,
  node_id TEXT,
  task TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  connection_id TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_llm_calls_node ON llm_calls(node_id);
`,
  },
  {
    version: 2,
    sql: `
-- Grounded per-nation stat sheets, cached per (node, polity).
CREATE TABLE stat_sheets (
  node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  polity TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, polity)
);
`,
  },
  {
    version: 3,
    sql: `
-- Era chronicles, keyed by the span's start/end nodes so branches sharing a
-- prefix share the summary. The JSON is re-parsed on read; a stale shape is
-- treated as absent and regenerates.
-- IF NOT EXISTS: saves created from the original v1 DDL already carry this
-- table (unused until now) while sitting at user_version 1/2 — a bare CREATE
-- here would fail to open every pre-existing save.
CREATE TABLE IF NOT EXISTS era_summaries (
  start_node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  end_node_id TEXT NOT NULL REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (start_node_id, end_node_id)
);
`,
  },
  {
    version: 4,
    sql: `
-- Explicit event location, set by the cartographer pass so the map can focus
-- an event that carries no map-locatable impact. Nullable and added by ALTER
-- (not a table rebuild) so existing saves keep every row: NULL means "no known
-- place", which reads back as an event with no lng/lat at all.
ALTER TABLE events ADD COLUMN lng REAL;
ALTER TABLE events ADD COLUMN lat REAL;
`,
  },
  {
    version: 5,
    sql: `
-- Named anchors: player bookmarks on loom nodes ("Eve of the Anatolian War").
-- NULL reads back as "" (unanchored).
ALTER TABLE timeline_nodes ADD COLUMN anchor TEXT;
`,
  },
  {
    version: 6,
    sql: `
-- Front pages are persisted like stat sheets: a billed model call whose output
-- should be a stable historical artifact, not a re-roll on every open.
CREATE TABLE IF NOT EXISTS gazettes (
  node_id TEXT PRIMARY KEY REFERENCES timeline_nodes(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
];
