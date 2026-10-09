import { memo } from "react";
import Markdown from "react-markdown";
import type { Message } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import styles from "./ConversationsDrawer.module.css";

export interface BubbleEditState {
  text: string;
}

interface MessageBubbleProps {
  message: Message;
  siblingIndex: number;
  siblingCount: number;
  /** ✎ edit-and-fork affordance (user messages, when nothing is in flight). */
  showEdit: boolean;
  /** ↻ regenerate affordance (last assistant message only). */
  showRegenerate: boolean;
  /**
   * Non-null only for the message being edited. Everything else receives a
   * literal `null`, so keystrokes in the editor cannot invalidate any other
   * bubble's memo and re-parse its markdown.
   */
  edit: BubbleEditState | null;
  onStartEdit: (message: Message) => void;
  onEditChange: (text: string) => void;
  onEditCancel: () => void;
  onEditSave: (message: Message, text: string) => void;
  onFlip: (message: Message, direction: 1 | -1) => void;
  onRegenerate: (message: Message) => void;
}

function MessageBubbleImpl({
  message,
  siblingIndex,
  siblingCount,
  showEdit,
  showRegenerate,
  edit,
  onStartEdit,
  onEditChange,
  onEditCancel,
  onEditSave,
  onFlip,
  onRegenerate,
}: MessageBubbleProps) {
  const roleClass = message.role === "user" ? styles.user : styles.assistant;
  return (
    <div
      className={`${styles.message} ${roleClass} ${edit ? styles.editing : ""}`}
    >
      {message.speaker ? <div className={styles.speaker}>{message.speaker}</div> : null}
      {edit ? (
        <>
          <textarea
            className={styles.editInput}
            rows={3}
            autoFocus
            value={edit.text}
            onChange={(event) => onEditChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onEditSave(message, edit.text);
              } else if (event.key === "Escape") {
                onEditCancel();
              }
            }}
          />
          <div className={styles.editActions}>
            <Button variant="ghost" onClick={onEditCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!edit.text.trim()}
              onClick={() => onEditSave(message, edit.text)}
            >
              Send
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.content}>
          {message.role === "assistant" ? (
            <Markdown>{message.content}</Markdown>
          ) : (
            message.content
          )}
        </div>
      )}
      <div className={styles.messageMeta}>
        {siblingCount > 1 ? (
          <span
            className={styles.siblingNav}
            title={`${siblingCount} versions of this message — flip to see the other branches`}
          >
            <button
              aria-label="Previous version"
              onClick={() => onFlip(message, -1)}
              disabled={siblingIndex === 0}
            >
              ‹
            </button>
            {siblingIndex + 1}/{siblingCount}
            <button
              aria-label="Next version"
              onClick={() => onFlip(message, 1)}
              disabled={siblingIndex === siblingCount - 1}
            >
              ›
            </button>
          </span>
        ) : null}
        {showEdit && !edit ? (
          <button
            className={styles.regen}
            title="Edit message (forks the conversation)"
            onClick={() => onStartEdit(message)}
          >
            ✎
          </button>
        ) : null}
        {showRegenerate ? (
          <button
            className={styles.regen}
            title="Regenerate reply"
            onClick={() => onRegenerate(message)}
          >
            ↻
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Markdown parsing dominates this component; memo is what keeps a long thread
 *  from re-parsing on every keystroke and every streamed token. */
export const MessageBubble = memo(MessageBubbleImpl);
