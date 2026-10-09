import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  CircleAlert,
  GitBranch,
  LoaderCircle,
  MessagesSquare,
  Newspaper,
  Search,
  SearchX,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import type { SearchHit } from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { api } from "../../lib/api.ts";
import { parseDigestLine } from "../../lib/factLine.ts";
import { formatGameDate } from "../../lib/dates.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./search.module.css";

const DEBOUNCE_MS = 250;
/** Mirrors the route's own floor (GET /games/:g/search) — matched here only
 *  to skip firing a request that the server would answer empty anyway. */
const MIN_QUERY_LENGTH = 2;
/** The route's per-kind cap (searchSave's limit): a full group may hide older matches. */
const KIND_CAP = 20;

type Status = "idle" | "loading" | "ready" | "error";
type Scope = "all" | SearchHit["kind"];

const GROUPS: ReadonlyArray<{ kind: SearchHit["kind"]; label: string; icon: LucideIcon }> = [
  { kind: "event", label: "Events", icon: Newspaper },
  { kind: "fact", label: "Facts", icon: Sparkles },
  { kind: "message", label: "Messages", icon: MessagesSquare },
];

/** Fact snippets are windows into the stored JSON payload — read them as prose. */
const cleanFactSnippet = (snippet: string): string =>
  snippet
    .replace(/"([A-Za-z_]+)":/g, "$1: ")
    .replace(/[{}[\]"]/g, "")
    .replace(/,(?=\s*[A-Za-z_]+:)/g, " · ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The matched phrase picked out with <mark> — the server matches the whole phrase. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className={styles.mark}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

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
  const nodes = useLoomStore((state) => state.nodes);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  // The phrase the CURRENT hits answer — highlights must not follow keystrokes
  // that haven't been searched yet.
  const [hitsQuery, setHitsQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

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
      setHitsQuery("");
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
          setHitsQuery(trimmed);
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

  // The checked-out path, so hits from other branches can say so.
  const onPath = useMemo(() => {
    const path = new Set<string>();
    let cursor = currentNodeId ? nodes[currentNodeId] : undefined;
    while (cursor && !path.has(cursor.id)) {
      path.add(cursor.id);
      cursor = cursor.parentId ? nodes[cursor.parentId] : undefined;
    }
    return path;
  }, [nodes, currentNodeId]);

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
  const counts = Object.fromEntries(
    GROUPS.map(({ kind }) => [kind, hits.filter((hit) => hit.kind === kind).length]),
  ) as Record<SearchHit["kind"], number>;
  const visible = scope === "all" ? hits : hits.filter((hit) => hit.kind === scope);
  const hasResults = hits.length > 0;
  const isEmpty = status === "ready" && visible.length === 0;
  const scopeLabel = GROUPS.find((group) => group.kind === scope)?.label.toLowerCase();

  // Arrow keys walk the result list from the field and between results.
  const onListKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...(resultsRef.current?.querySelectorAll<HTMLButtonElement>("button[data-hit]") ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") (buttons[at + 1] ?? buttons[0])?.focus();
    else if (at <= 0) inputRef.current?.focus();
    else buttons[at - 1]?.focus();
  };

  return (
    <Drawer
      side="left"
      title="Search"
      kicker="Every branch of the timeline"
      icon={<Search size={16} />}
      onClose={() => setLeftDrawer(null)}
    >
      <div className={styles.field} role="search">
        {status === "loading" ? (
          <LoaderCircle size={16} className={`${styles.fieldIcon} ${styles.spin}`} aria-hidden />
        ) : (
          <Search size={16} className={styles.fieldIcon} aria-hidden />
        )}
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          aria-label="Search events, facts and messages"
          placeholder="Search events, facts, messages…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && visible[0]) void selectHit(visible[0]);
            // The stage's Escape-closes-drawer shortcut ignores text fields:
            // first Escape clears the phrase, the second closes the panel.
            if (event.key === "Escape") {
              if (query) setQuery("");
              else setLeftDrawer(null);
            }
            onListKeys(event);
          }}
        />
        {query ? (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            title="Clear (Esc)"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div className={styles.scopes} role="group" aria-label="Result types">
        <ScopeChip active={scope === "all"} onClick={() => setScope("all")} count={hasResults ? hits.length : null}>
          All
        </ScopeChip>
        {GROUPS.map(({ kind, label, icon: Icon }) => (
          <ScopeChip
            key={kind}
            active={scope === kind}
            onClick={() => setScope(kind)}
            count={hasResults ? counts[kind] : null}
          >
            <Icon size={13} aria-hidden /> {label}
          </ScopeChip>
        ))}
      </div>

      {trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH ? (
        <p className={styles.hint}>Keep typing — at least {MIN_QUERY_LENGTH} characters.</p>
      ) : null}
      {status === "error" && error ? (
        <p className={styles.error} role="alert">
          <CircleAlert size={15} aria-hidden /> {error}
        </p>
      ) : null}

      {isEmpty ? (
        <div className={styles.empty}>
          <SearchX size={24} aria-hidden />
          <p>
            {scope !== "all" && hasResults
              ? `No ${scopeLabel} match “${hitsQuery}” — see the other tabs.`
              : `No matches for “${hitsQuery}”.`}
          </p>
          <p className={styles.emptySub}>Search matches the exact phrase — try a single name or word.</p>
        </div>
      ) : null}

      {status === "idle" && trimmed.length === 0 ? (
        <div className={styles.empty}>
          <Search size={24} aria-hidden />
          <p>
            Search across every turn's events, facts, and conversations. Selecting a result checks out
            the turn it happened at.
          </p>
          <ul className={styles.keys}>
            <li>
              <kbd>Enter</kbd> open the first result
            </li>
            <li>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move through results
            </li>
            <li>
              <kbd>Esc</kbd> clear, then close
            </li>
          </ul>
        </div>
      ) : null}

      <div
        ref={resultsRef}
        className={`${styles.groups} ${status === "loading" ? styles.stale : ""}`}
        aria-busy={status === "loading"}
        onKeyDown={onListKeys}
      >
        {GROUPS.map(({ kind, label, icon: Icon }) => {
          if (scope !== "all" && scope !== kind) return null;
          const group = hits.filter((hit) => hit.kind === kind);
          if (group.length === 0) return null;
          return (
            <section key={kind} className={styles.section}>
              <header className={styles.sectionHead}>
                <Icon size={13} aria-hidden className={styles.sectionIcon} />
                <span className="pfKicker">{label}</span>
                <span className={styles.count}>{group.length}</span>
              </header>
              <ul className={styles.hits}>
                {group.map((hit, index) => (
                  <li key={`${hit.kind}:${hit.nodeId}:${index}`}>
                    <HitRow
                      hit={hit}
                      query={hitsQuery}
                      depth={nodes[hit.nodeId]?.depth}
                      settled={nodes[hit.nodeId]?.status === "complete"}
                      here={hit.nodeId === currentNodeId}
                      offPath={!onPath.has(hit.nodeId)}
                      onSelect={() => void selectHit(hit)}
                    />
                  </li>
                ))}
              </ul>
              {group.length >= KIND_CAP ? (
                <p className={styles.capNote}>Newest {KIND_CAP} shown — refine the phrase to reach older ones.</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}

function ScopeChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number | null;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${styles.scope} ${active ? styles.scopeActive : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      {count !== null ? (
        <span className={`${styles.scopeCount} ${count === 0 ? styles.scopeCountZero : ""}`}>{count}</span>
      ) : null}
    </button>
  );
}

function HitRow({
  hit,
  query,
  depth,
  settled,
  here,
  offPath,
  onSelect,
}: {
  hit: SearchHit;
  query: string;
  depth: number | undefined;
  settled: boolean;
  here: boolean;
  offPath: boolean;
  onSelect: () => void;
}) {
  const needle = query.toLowerCase();
  // When the title matched, the server's snippet is a window of the title
  // itself — only show it when the match lives elsewhere.
  const showSnippet = Boolean(hit.snippet) && !hit.title.toLowerCase().includes(needle);
  const snippet = hit.kind === "fact" ? cleanFactSnippet(hit.snippet) : hit.snippet;

  return (
    <button
      type="button"
      data-hit
      className={`${styles.hit} ${styles[hit.kind] ?? ""}`}
      disabled={!settled}
      title={settled ? "Check out this turn" : "This turn is not settled yet"}
      onClick={onSelect}
    >
      <span className={styles.hitMeta}>
        {hit.gameDate ? <span className={styles.hitDate}>{formatGameDate(hit.gameDate)}</span> : null}
        {depth !== undefined ? <span className={styles.hitTurn}>Turn {depth}</span> : null}
        {here ? <Badge tone="accent">here</Badge> : null}
        {!here && offPath ? (
          <span className={styles.hitBranch} title="On another branch of the timeline">
            <GitBranch size={11} aria-hidden /> other branch
          </span>
        ) : null}
      </span>
      {hit.kind === "fact" ? (
        <FactTitle line={hit.title} query={query} />
      ) : (
        <span className={styles.hitTitle}>
          <Highlight text={hit.title} query={query} />
        </span>
      )}
      {showSnippet ? (
        <span className={styles.hitSnippet}>
          <Highlight text={snippet} query={query} />
        </span>
      ) : null}
    </button>
  );
}

/** A fact hit's title is its digest line: lift the intel mark and category. */
function FactTitle({ line, query }: { line: string; query: string }) {
  const { confidence, category, body } = parseDigestLine(line);
  return (
    <span className={styles.hitTitle}>
      {category ? <span className={styles.factCategory}>{category.replace("_", " ")}</span> : null}
      {confidence ? (
        <>
          <Badge tone={confidence === "rumor" ? "warning" : "info"}>{confidence}</Badge>{" "}
        </>
      ) : null}
      <Highlight text={body} query={query} />
    </span>
  );
}
