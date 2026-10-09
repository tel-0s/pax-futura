import { FactSchema, type SearchHit } from "@pax/domain";
import { factDigestLine } from "@pax/engine";
import type { Db } from "../openDb.ts";

const LIKE_ESCAPE = "\\";
const SNIPPET_RADIUS = 60;

/**
 * Escape SQLite LIKE's two wildcards (and the escape char itself) so a
 * literal "%" or "_" in the needle is matched literally, not as a wildcard.
 * Order matters: the escape char must be doubled BEFORE the wildcards are
 * escaped, or a wildcard's freshly-inserted backslash would itself get
 * re-escaped.
 */
const escapeLike = (needle: string): string =>
  needle
    .replaceAll(LIKE_ESCAPE, LIKE_ESCAPE + LIKE_ESCAPE)
    .replaceAll("%", LIKE_ESCAPE + "%")
    .replaceAll("_", LIKE_ESCAPE + "_");

/** The ±radius window of `text` around the first case-insensitive hit of `needle`. */
const snippetAround = (text: string, needle: string, radius = SNIPPET_RADIUS): string => {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) {
    return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
};

const firstLine = (text: string, max = 60): string => {
  const line = (text.split("\n")[0] ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

interface EventRow {
  node_id: string;
  event_date: string;
  title: string;
  description: string;
}

interface FactRow {
  node_id: string;
  game_date: string;
  payload_json: string;
}

interface MessageRow {
  conversation_id: string;
  authored_node_id: string;
  game_date: string;
  content: string;
}

/**
 * Full-text search across events, facts, and conversation messages: three
 * capped, newest-first LIKE queries (FTS5 is overkill at save scale). Facts
 * and messages join their node for a display gameDate — facts have no date
 * column of their own, and a message's "date" is the node it was authored at.
 */
export const searchSave = (db: Db, query: string, limit = 20): SearchHit[] => {
  const like = `%${escapeLike(query)}%`;

  const eventRows = db
    .prepare(
      `SELECT node_id, event_date, title, description FROM events
       WHERE title LIKE ? ESCAPE '${LIKE_ESCAPE}' OR description LIKE ? ESCAPE '${LIKE_ESCAPE}'
       ORDER BY event_date DESC, seq DESC LIMIT ?`,
    )
    .all(like, like, limit) as EventRow[];

  const events: SearchHit[] = eventRows.map((row) => {
    const matchedField = row.title.toLowerCase().includes(query.toLowerCase())
      ? row.title
      : row.description;
    return {
      kind: "event",
      nodeId: row.node_id,
      gameDate: row.event_date,
      title: row.title,
      snippet: snippetAround(matchedField, query),
      conversationId: "",
    };
  });

  const factRows = db
    .prepare(
      `SELECT f.node_id AS node_id, n.game_date AS game_date, f.payload_json AS payload_json
       FROM facts f JOIN timeline_nodes n ON n.id = f.node_id
       WHERE f.payload_json LIKE ? ESCAPE '${LIKE_ESCAPE}'
       ORDER BY n.game_date DESC, f.seq DESC LIMIT ?`,
    )
    .all(like, limit) as FactRow[];

  const facts: SearchHit[] = factRows.map((row) => {
    // The payload always parses: it was validated (FactSchema) on insert.
    const fact = FactSchema.parse(JSON.parse(row.payload_json));
    return {
      kind: "fact",
      nodeId: row.node_id,
      gameDate: row.game_date,
      title: factDigestLine(fact),
      snippet: snippetAround(row.payload_json, query),
      conversationId: "",
    };
  });

  const messageRows = db
    .prepare(
      `SELECT m.conversation_id AS conversation_id, m.authored_node_id AS authored_node_id,
              n.game_date AS game_date, m.content AS content
       FROM messages m JOIN timeline_nodes n ON n.id = m.authored_node_id
       WHERE m.content LIKE ? ESCAPE '${LIKE_ESCAPE}'
       ORDER BY m.id DESC LIMIT ?`,
    )
    .all(like, limit) as MessageRow[];

  const messages: SearchHit[] = messageRows.map((row) => ({
    kind: "message",
    nodeId: row.authored_node_id,
    gameDate: row.game_date,
    title: firstLine(row.content),
    snippet: snippetAround(row.content, query),
    conversationId: row.conversation_id,
  }));

  return [...events, ...facts, ...messages];
};
