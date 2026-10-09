import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronUp } from "lucide-react";
import type { ConversationAtNode, Message } from "@pax/domain";
import { api } from "../../lib/api.ts";
import {
  selectDeepestDescendant,
  selectMessagePath,
  selectMessageSiblings,
  selectSiblingPositions,
  useConversationsStore,
} from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { describeError, useChatFailures } from "./chatFailures.ts";
import type { Correspondent } from "./correspondents.ts";
import { Letterhead } from "./LetterParts.tsx";
import { MessageBubble } from "./MessageBubble.tsx";
import styles from "./Letters.module.css";

/** Only the tail of a long thread is mounted; the rest is one click away. */
const WINDOW = 80;

/** Current game/node, read at click time so callbacks stay referentially stable. */
function chatTarget(): { gameId: string; nodeId: string } | null {
  const gameId = useSessionStore.getState().gameId;
  const nodeId = useLoomStore.getState().currentNodeId;
  return gameId && nodeId ? { gameId, nodeId } : null;
}

async function flipSibling(conversationId: string, message: Message, direction: 1 | -1) {
  const where = chatTarget();
  if (!where) return;
  const { trees, load } = useConversationsStore.getState();
  const tree = trees[conversationId] ?? [];
  const siblings = selectMessageSiblings(tree, message.id);
  const index = siblings.findIndex((sibling) => sibling.id === message.id);
  const next = siblings[index + direction];
  if (!next) return;
  const leaf = selectDeepestDescendant(tree, next.id);
  await api.setConversationHead(where.gameId, where.nodeId, conversationId, leaf);
  await load(where.gameId, where.nodeId);
}

function regenerate(conversationId: string, message: Message) {
  const where = chatTarget();
  if (!where) return;
  const { markSending, clearSending } = useConversationsStore.getState();
  const failures = useChatFailures.getState();
  failures.dismiss(conversationId);
  markSending(conversationId);
  void api
    .regenerateReply(where.gameId, where.nodeId, conversationId, message.id)
    .catch((error: unknown) => {
      clearSending(conversationId);
      // Said in the thread, with a retry: a failed redraft used to vanish
      // silently, leaving the player unsure whether anything happened.
      failures.report(conversationId, {
        action: "regenerate",
        detail: describeError(error),
        retry: () => regenerate(conversationId, message),
      });
    });
}

/**
 * The root -> head message path. Mounted keyed by conversation + node, so the
 * open editor and the "show earlier" expansion reset on either switch.
 */
export function ConversationMessages({
  conversation,
  who,
  scroller,
}: {
  conversation: ConversationAtNode;
  /** Referentially stable per channel — every bubble's memo depends on it. */
  who: Correspondent;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const conversationId = conversation.id;
  const tree = useConversationsStore((state) => state.trees[conversationId]);
  // One boolean rather than the streamed text: the affordances flip twice per
  // exchange instead of once per token.
  const busy = useConversationsStore(
    (state) =>
      state.streaming[conversationId] !== undefined || Boolean(state.awaiting[conversationId]),
  );
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const savingRef = useRef(false);

  const path = useMemo(
    () => selectMessagePath(tree ?? [], conversation.headMessageId),
    [tree, conversation.headMessageId],
  );
  const positions = useMemo(() => selectSiblingPositions(tree ?? []), [tree]);
  const lastAssistantId = useMemo(
    () => [...path].reverse().find((message) => message.role === "assistant")?.id,
    [path],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [path.length, scroller]);

  const onStartEdit = useCallback(
    (message: Message) => setEditing({ id: message.id, text: message.content }),
    [],
  );
  const onEditChange = useCallback(
    (text: string) => setEditing((current) => (current ? { ...current, text } : current)),
    [],
  );
  const onEditCancel = useCallback(() => setEditing(null), []);

  /**
   * Edit-and-fork: send the revised text as a sibling of the original user
   * message (same parent), generating a fresh reply. The old branch stays
   * reachable through the sibling arrows — same mechanics as regeneration.
   */
  const onEditSave = useCallback(
    (message: Message, raw: string) => {
      const text = raw.trim();
      if (!text || savingRef.current) return;
      if (text === message.content) {
        setEditing(null);
        return;
      }
      const where = chatTarget();
      if (!where) return;
      const { markSending, clearSending } = useConversationsStore.getState();
      const failures = useChatFailures.getState();
      failures.dismiss(conversationId);
      savingRef.current = true;
      setEditing(null);
      // Pass the revised text: the optimistic bubble must show the edit, not
      // snap back to the original for the whole LLM round-trip.
      markSending(conversationId, text);
      void (async () => {
        try {
          await api.sendChatMessage(where.gameId, where.nodeId, conversationId, {
            text,
            parentMessageId: message.parentMessageId,
          });
        } catch (error) {
          clearSending(conversationId);
          setEditing({ id: message.id, text }); // give the edit back on failure
          failures.report(conversationId, { action: "edit", detail: describeError(error) });
        } finally {
          savingRef.current = false;
        }
      })();
    },
    [conversationId],
  );

  const onFlip = useCallback(
    (message: Message, direction: 1 | -1) => void flipSibling(conversationId, message, direction),
    [conversationId],
  );
  const onRegenerate = useCallback(
    (message: Message) => regenerate(conversationId, message),
    [conversationId],
  );

  const visible = expanded || path.length <= WINDOW ? path : path.slice(-WINDOW);
  const hidden = path.length - visible.length;

  return (
    <>
      {conversation.headMessageId === null ? <Letterhead who={who} /> : null}
      {hidden > 0 ? (
        <button type="button" className={styles.showEarlier} onClick={() => setExpanded(true)}>
          <ChevronUp size={13} />
          {hidden} earlier message{hidden === 1 ? "" : "s"}
        </button>
      ) : null}
      {visible.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          who={who}
          siblingIndex={positions.get(message.id)?.index ?? 0}
          siblingCount={positions.get(message.id)?.count ?? 1}
          showEdit={message.role === "user" && !busy}
          showRegenerate={message.id === lastAssistantId && !busy}
          edit={editing?.id === message.id ? { text: editing.text } : null}
          onStartEdit={onStartEdit}
          onEditChange={onEditChange}
          onEditCancel={onEditCancel}
          onEditSave={onEditSave}
          onFlip={onFlip}
          onRegenerate={onRegenerate}
        />
      ))}
    </>
  );
}
