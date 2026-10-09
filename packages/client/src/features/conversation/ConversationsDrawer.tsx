import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, MessagesSquare } from "lucide-react";
import type { ConversationAtNode } from "@pax/domain";
import { Drawer } from "../../components/Drawer.tsx";
import { api } from "../../lib/api.ts";
import { formatGameDate } from "../../lib/dates.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { CastStrip, type CastEntry } from "./CastStrip.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { ConversationMessages } from "./ConversationMessages.tsx";
import { CouncilMenu, CouncilRoster } from "./CouncilMenu.tsx";
import { council, isCouncilTitle } from "./council.ts";
import { correspondentSignature, describeConversation, usePolityPalette } from "./correspondents.ts";
import { FailureNotice } from "./FailureNotice.tsx";
import { NationPicker } from "./NationPicker.tsx";
import { StreamLane } from "./StreamLane.tsx";
import styles from "./ConversationsDrawer.module.css";

/**
 * Per-turn branching conversations: the council (three ministers who each
 * argue their own corner) plus one channel per diplomatic contact, all scoped
 * to the checked-out node. Regenerating a reply adds a sibling; ‹ i/n ›
 * arrows flip between siblings by re-pointing the node's head; the head at
 * turn execution is what the next turn inherits as canon.
 *
 * Subscriptions are per slice on purpose: this component must not re-render on
 * draft keystrokes or streamed tokens (see ChatInput / StreamLane).
 */
export function ConversationsDrawer() {
  const gameId = useSessionStore((state) => state.gameId);
  const playerCode = useSessionStore((state) => state.meta?.playerPolity);
  const nodeId = useLoomStore((state) => state.currentNodeId);
  const depth = useLoomStore((state) => (nodeId ? state.nodes[nodeId]?.depth : undefined));
  const gameDate = useLoomStore((state) => (nodeId ? state.nodes[nodeId]?.gameDate : undefined));
  const toggleConversations = useUiStore((state) => state.toggleConversations);
  const list = useConversationsStore((state) => state.list);
  const activeConversationId = useConversationsStore((state) => state.activeConversationId);
  const setActive = useConversationsStore((state) => state.setActive);
  const load = useConversationsStore((state) => state.load);
  const { world, palette } = usePolityPalette();
  // The cast is seeded from the game and its START date, so it never changes
  // as the timeline advances — the root node is the only stable date here.
  // Root node id seeds the cast: it survives save import (which re-keys the
  // gameId) so a campaign keeps its ministers wherever it travels.
  const root = useLoomStore(
    (state) => Object.values(state.nodes).find((node) => node.parentId === null),
  );
  const startDate = root?.gameDate ?? "";
  const scroller = useRef<HTMLDivElement>(null);

  const members = useMemo(
    () => (root ? council(root.id, startDate) : []),
    [root, startDate],
  );

  const polities = world?.polities;
  const entries = useMemo<CastEntry[]>(
    () =>
      list.map((conversation) => ({
        conversation,
        who: describeConversation(conversation, members, polities, palette),
      })),
    [list, members, polities, palette],
  );

  const active = entries.find((entry) => entry.conversation.id === activeConversationId);
  // Every completed reply refetches the list (new objects), so the active
  // correspondent is re-keyed by content: the thread's memoized letters only
  // re-render when who signs them actually changes.
  const activeSignature = correspondentSignature(active?.who);
  const activeWho = useMemo(() => active?.who ?? null, [activeSignature]);

  const openTitles = useMemo(
    () =>
      new Set(list.filter((conversation) => conversation.kind === "advisor").map((conversation) => conversation.title)),
    [list],
  );
  const openCodes = useMemo(
    () =>
      new Set(
        list
          .filter((conversation) => conversation.kind === "diplomacy")
          .flatMap((conversation) => conversation.participants.slice(0, 1)),
      ),
    [list],
  );
  const showAdvisor = !list.some(
    (conversation) => conversation.kind === "advisor" && !isCouncilTitle(conversation.title),
  );

  // Which node's list has actually arrived — so a first open shows the empty
  // desk only once we know the desk IS empty, not while the list loads.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!gameId || !nodeId) return;
    void load(gameId, nodeId)
      .catch((error: unknown) => console.error("conversation load failed:", error))
      .finally(() => setLoadedFor(nodeId));
  }, [gameId, nodeId, load]);

  /**
   * Focus the channel `matches` picks out — opening it first if this node
   * has none. The POST returns the created conversation; the list is
   * reloaded first so the focused id is one the drawer can render.
   */
  const openChannel = useCallback(
    async (
      matches: (conversation: ConversationAtNode) => boolean,
      body: Parameters<typeof api.openConversation>[2],
    ) => {
      if (!gameId || !nodeId) return;
      const existing = useConversationsStore.getState().list.find(matches);
      if (existing) {
        setActive(existing.id);
        return;
      }
      try {
        const created = await api.openConversation(gameId, nodeId, body);
        await load(gameId, nodeId);
        const list = useConversationsStore.getState().list;
        const opened = list.find((conversation) => conversation.id === created.id) ?? list.find(matches);
        if (opened) setActive(opened.id);
      } catch (error) {
        alert(error instanceof Error ? error.message : String(error));
      }
    },
    [gameId, nodeId, load, setActive],
  );

  /** Open a council/advisor channel by title, or re-focus it if it exists. */
  const openAdvisorChannel = useCallback(
    (title: string) =>
      openChannel(
        (conversation) => conversation.kind === "advisor" && conversation.title === title,
        { kind: "advisor", title },
      ),
    [openChannel],
  );

  /** Open a diplomatic channel with a court, or re-focus the one already open. */
  const openDiplomacy = useCallback(
    (code: string) =>
      openChannel(
        (conversation) => conversation.kind === "diplomacy" && conversation.participants[0] === code,
        { kind: "diplomacy", participants: [code] },
      ),
    [openChannel],
  );

  if (!gameId || !nodeId) return null;

  const nationPicker = (variant: "seat" | "button") => (
    <NationPicker
      polities={polities}
      palette={palette}
      playerCode={playerCode}
      openCodes={openCodes}
      onPick={(code) => void openDiplomacy(code)}
      variant={variant}
      align={variant === "seat" ? "end" : "center"}
      side={variant === "seat" ? "bottom" : "top"}
    />
  );

  return (
    <Drawer
      side="right"
      wide
      icon={<MessagesSquare size={16} />}
      kicker={`Turn ${depth ?? "–"}${gameDate ? ` · ${formatGameDate(gameDate)}` : ""}`}
      title="Correspondence"
      onClose={toggleConversations}
    >
      <div className={styles.wrap}>
        {entries.length > 0 ? (
          <CastStrip
            key={gameId}
            gameId={gameId}
            entries={entries}
            activeId={activeConversationId}
            onSelect={setActive}
            seats={
              <>
                <CouncilMenu
                  members={members}
                  openTitles={openTitles}
                  showAdvisor={showAdvisor}
                  onPick={(title) => void openAdvisorChannel(title)}
                />
                {nationPicker("seat")}
              </>
            }
          />
        ) : null}

        {active && activeWho ? (
          <>
            <div className={styles.thread} ref={scroller}>
              {/* Keyed by conversation and node: an open editor and the
                  "show earlier" expansion belong to exactly one of each. */}
              <ConversationMessages
                key={`${active.conversation.id}:${nodeId}`}
                conversation={active.conversation}
                who={activeWho}
                scroller={scroller}
              />
              <StreamLane conversationId={active.conversation.id} who={activeWho} scroller={scroller} />
              <FailureNotice conversationId={active.conversation.id} scroller={scroller} />
            </div>
            <ChatInput
              conversationId={active.conversation.id}
              placeholder={
                activeWho.kind === "envoy"
                  ? `Write to ${activeWho.fullName}…`
                  : activeWho.kind === "council"
                    ? `Ask ${activeWho.fullName}…`
                    : "Ask your advisor…"
              }
            />
          </>
        ) : entries.length === 0 && loadedFor === nodeId ? (
          <div className={styles.empty}>
            <Inbox size={24} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>The desk is clear</p>
            <p className={styles.emptyText}>
              Summon a minister for counsel, or write to a foreign court.
            </p>
            <div className={styles.emptyRoster}>
              <span className={`${styles.emptyKicker} pfKicker`}>Your council</span>
              <CouncilRoster
                members={members}
                openTitles={openTitles}
                showAdvisor={showAdvisor}
                onPick={(title) => void openAdvisorChannel(title)}
              />
            </div>
            <div className={styles.emptyActions}>{nationPicker("button")}</div>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
