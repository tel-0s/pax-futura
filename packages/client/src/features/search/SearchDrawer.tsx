import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "@pax/domain";
import { Drawer } from "../../components/Drawer.tsx";
import { api } from "../../lib/api.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./search.module.css";

const DEBOUNCE_MS = 250;
/** Mirrors the route's own floor (GET /games/:g/search) — matched here only
 *  to skip firing a request that the server would answer empty anyway. */
const MIN_QUERY_LENGTH = 2;

type Status = "idle" | "loading" | "ready" | "error";

const GROUPS: ReadonlyArray<{ kind: SearchHit["kind"]; label: string }> = [
  { kind: "event", label: "Events" },
  { kind: "fact", label: "Facts" },
  { kind: "message", label: "Messages" },
];

/**
 * Save-wide search across events, facts, and conversation messages.
 * Clicking a hit is read-only navigation, nothing else: it checks out the
 * node the hit belongs to — exactly what the loom's own checkout does
 * (api.setActiveNode + useLoomStore.setCurrent) — with no confirmation and no
 * side effect on the world. A message hit additionally surfaces the
 * conversations drawer with that hit's conversation selected, since a lone
 * message means nothing without its thread.
 */
export function SearchDrawer() {
  const gameId = useSessionStore((state) => state.gameId);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced fetch: a fresh keystroke cancels the still-pending timer for
  // the previous one, so only the settled query ever reaches the server.
  useEffect(() => {
    if (!gameId) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setHits([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setError(null);
    // `live` outlasts the timer: once fired, an in-flight response from a
    // SUPERSEDED query must not overwrite the newer one's results.
    let live = true;
    const timer = window.setTimeout(() => {
      api
        .search(gameId, trimmed)
        .then((response) => {
          if (!live) return;
          setHits(response.hits);
          setStatus("ready");
        })
        .catch((cause: unknown) => {
          if (!live) return;
          setError(cause instanceof Error ? cause.message : "Search failed");
          setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [gameId, query]);

  const selectHit = async (hit: SearchHit) => {
    if (!gameId) return;
    // Same gate LoomOverlay.checkout uses: only a settled node can be
    // checked out (a generating/failed node has no world to preview).
    const node = useLoomStore.getState().nodes[hit.nodeId];
    if (!node || node.status !== "complete") return;
    try {
      await api.setActiveNode(gameId, hit.nodeId);
      useLoomStore.getState().setCurrent(hit.nodeId);

      if (hit.kind === "message" && hit.conversationId) {
        if (!useUiStore.getState().conversationsOpen) useUiStore.getState().toggleConversations();
        // Load explicitly (rather than rely solely on the drawer's own
        // node-change effect) so the target conversation is guaranteed active
        // once this resolves, whichever load — theirs or ours — settles last.
        await useConversationsStore.getState().load(gameId, hit.nodeId);
        useConversationsStore.getState().setActive(hit.conversationId);
      }
    } catch (cause) {
      // The hit's node can vanish between search and click (pruned branch).
      setError(cause instanceof Error ? cause.message : "Could not open that result");
      setStatus("error");
      return;
    }
  };

  if (!gameId) return null;

  const trimmed = query.trim();
  const isEmpty = status === "ready" && hits.length === 0;

  return (
    <Drawer side="left" title="Search" onClose={() => setLeftDrawer(null)}>
      <input
        ref={inputRef}
        type="text"
        className={styles.input}
        placeholder="Search events, facts, messages…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && hits[0]) void selectHit(hits[0]);
        }}
      />

      {trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH ? (
        <p className={styles.hint}>Keep typing — at least {MIN_QUERY_LENGTH} characters.</p>
      ) : null}
      {status === "loading" ? <p className={styles.hint}>Searching…</p> : null}
      {status === "error" && error ? <p className={styles.error}>{error}</p> : null}
      {isEmpty ? <p className={styles.hint}>No matches for "{trimmed}".</p> : null}
      {status === "idle" && trimmed.length === 0 ? (
        <p className={styles.hint}>
          Search across every turn's events, facts, and conversations. Selecting a result checks out
          the turn it happened at.
        </p>
      ) : null}

      <div className={styles.groups}>
        {GROUPS.map(({ kind, label }) => {
          const group = hits.filter((hit) => hit.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind} className={styles.section}>
              <h3 className={styles.sectionTitle}>{label}</h3>
              <ul className={styles.hits}>
                {group.map((hit, index) => (
                  <li key={`${hit.kind}:${hit.nodeId}:${index}`}>
                    <button type="button" className={styles.hit} onClick={() => void selectHit(hit)}>
                      <span className={styles.hitTop}>
                        <span className={styles.hitTitle}>{hit.title}</span>
                        {hit.gameDate ? <span className={styles.hitDate}>{hit.gameDate}</span> : null}
                      </span>
                      {hit.snippet ? <span className={styles.hitSnippet}>{hit.snippet}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
