import { useEffect, useMemo, useRef } from "react";
import { Button } from "../../components/Button.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { api } from "../../lib/api.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { ChatInput } from "./ChatInput.tsx";
import { ConversationMessages } from "./ConversationMessages.tsx";
import { CouncilMenu } from "./CouncilMenu.tsx";
import { council, isCouncilTitle } from "./council.ts";
import { StreamLane } from "./StreamLane.tsx";
import styles from "./ConversationsDrawer.module.css";

/**
 * Per-turn branching conversations: the council (three ministers who each
 * argue their own corner) plus one tab per diplomacy channel, all scoped to
 * the checked-out node. Regenerating a reply adds a sibling; ‹ i/n › arrows
 * flip between siblings by re-pointing the node's head; the head at turn
 * execution is what the next turn inherits as canon.
 *
 * Subscriptions are per slice on purpose: this component must not re-render on
 * draft keystrokes or streamed tokens (see ChatInput / StreamLane).
 */
export function ConversationsDrawer() {
  const gameId = useSessionStore((state) => state.gameId);
  const nodeId = useLoomStore((state) => state.currentNodeId);
  const toggleConversations = useUiStore((state) => state.toggleConversations);
  const list = useConversationsStore((state) => state.list);
  const activeConversationId = useConversationsStore((state) => state.activeConversationId);
  const setActive = useConversationsStore((state) => state.setActive);
  const load = useConversationsStore((state) => state.load);
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

  useEffect(() => {
    if (gameId && nodeId) void load(gameId, nodeId);
  }, [gameId, nodeId, load]);

  if (!gameId || !nodeId) return null;

  const active = list.find((conversation) => conversation.id === activeConversationId);

  /** Open a council/advisor channel by title, or re-focus it if it exists. */
  const openAdvisorChannel = async (title: string) => {
    const existing = list.find(
      (conversation) => conversation.kind === "advisor" && conversation.title === title,
    );
    if (existing) {
      setActive(existing.id);
      return;
    }
    const created = await api.openConversation(gameId, nodeId, { kind: "advisor", title });
    await load(gameId, nodeId);
    setActive(created.id);
  };

  const openDiplomacy = async () => {
    const code = prompt("Open a channel with which nation? (polity code, e.g. DEU)");
    if (!code) return;
    await api.openConversation(gameId, nodeId, {
      kind: "diplomacy",
      participants: [code.trim().toUpperCase()],
    });
    await load(gameId, nodeId);
  };

  return (
    <Drawer side="right" title={`Conversations · Turn ${useLoomStore.getState().nodes[nodeId]?.depth ?? ""}`} onClose={toggleConversations}>
      <div className={styles.wrap}>
        <div className={styles.tabsRow}>
          <Tabs
            items={list.map((conversation) => ({ id: conversation.id, label: conversation.title }))}
            activeId={activeConversationId ?? ""}
            onSelect={setActive}
          />
          <div className={styles.newButtons}>
            <CouncilMenu
              members={members}
              openTitles={
                new Set(
                  list
                    .filter((conversation) => conversation.kind === "advisor")
                    .map((conversation) => conversation.title),
                )
              }
              showAdvisor={
                !list.some(
                  (conversation) =>
                    conversation.kind === "advisor" && !isCouncilTitle(conversation.title),
                )
              }
              onPick={(title) => void openAdvisorChannel(title)}
            />
            <Button variant="ghost" onClick={() => void openDiplomacy()}>
              + Nation
            </Button>
          </div>
        </div>

        {active ? (
          <>
            <div className={styles.messages} ref={scroller}>
              {/* Keyed by conversation and node: an open editor and the
                  "show earlier" expansion belong to exactly one of each. */}
              <ConversationMessages
                key={`${active.id}:${nodeId}`}
                conversation={active}
                scroller={scroller}
              />
              <StreamLane conversationId={active.id} scroller={scroller} />
            </div>
            <ChatInput
              conversationId={active.id}
              placeholder={
                active.kind !== "advisor"
                  ? `Message ${active.title}…`
                  : isCouncilTitle(active.title)
                    ? `Ask ${active.title}…`
                    : "Ask your advisor…"
              }
            />
          </>
        ) : (
          <p className={styles.empty}>
            Summon a minister from the council, or open a diplomatic channel, to begin.
          </p>
        )}
      </div>
    </Drawer>
  );
}
