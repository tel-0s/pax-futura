import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import styles from "./ConversationsDrawer.module.css";

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

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const gameId = useSessionStore.getState().gameId;
    const nodeId = useLoomStore.getState().currentNodeId;
    if (!gameId || !nodeId) return;
    const { markSending, clearSending } = useConversationsStore.getState();
    setBusy(true);
    setDraft("");
    markSending(conversationId, text);
    try {
      await api.sendChatMessage(gameId, nodeId, conversationId, { text });
    } catch (error) {
      clearSending(conversationId);
      setDraft(text); // give the message back on failure
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.inputRow}>
      <textarea
        className={styles.input}
        rows={2}
        placeholder={placeholder}
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
      <Button variant="primary" disabled={busy || !draft.trim()} onClick={() => void send()}>
        ➤
      </Button>
    </div>
  );
}
