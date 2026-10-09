import { useLayoutEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { describeError, useChatFailures } from "./chatFailures.ts";
import styles from "./ConversationsDrawer.module.css";

/** Auto-grow ceiling (~6 lines), then the field scrolls. */
const MAX_HEIGHT = 140;

/**
 * The draft lives here, not in the drawer: a keystroke must not re-render the
 * message list (one markdown parse per assistant bubble).
 */
export function ChatInput({
  conversationId,
  placeholder,
}: {
  conversationId: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  // Grow with the draft, like the command line.
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const gameId = useSessionStore.getState().gameId;
    const nodeId = useLoomStore.getState().currentNodeId;
    if (!gameId || !nodeId) return;
    const { markSending, clearSending } = useConversationsStore.getState();
    const failures = useChatFailures.getState();
    failures.dismiss(conversationId);
    setBusy(true);
    setDraft("");
    markSending(conversationId, text);
    try {
      await api.sendChatMessage(gameId, nodeId, conversationId, { text });
    } catch (error) {
      clearSending(conversationId);
      setDraft(text); // give the message back on failure
      // Marked in the thread rather than a blocking alert.
      failures.report(conversationId, { action: "send", detail: describeError(error) });
    } finally {
      setBusy(false);
      // Disabling the field for the round-trip dropped its focus; hand it
      // back — unless the player has since gone to type somewhere else.
      requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (!focused || focused === document.body) input.current?.focus();
      });
    }
  };

  const ready = !busy && draft.trim() !== "";

  return (
    <div className={`${styles.composer} ${busy ? styles.composerBusy : ""}`}>
      <span className={styles.prompt} aria-hidden>
        ›
      </span>
      <textarea
        ref={input}
        className={styles.input}
        rows={1}
        placeholder={busy ? "Awaiting their reply…" : placeholder}
        aria-label={placeholder}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <Button
        variant={ready ? "primary" : "ghost"}
        size="sm"
        icon
        disabled={!ready}
        onClick={() => void send()}
        aria-label="Send"
        title="Send (Enter) · new line (Shift+Enter)"
      >
        <SendHorizontal size={14} />
      </Button>
    </div>
  );
}
