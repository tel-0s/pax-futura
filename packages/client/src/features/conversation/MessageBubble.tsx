import { memo, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Check, ListPlus, PencilLine, RefreshCw } from "lucide-react";
import type { Message } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { useOrdersStore } from "../../stores/orders.ts";
import type { Correspondent } from "./correspondents.ts";
import { LetterHead, letterTint, SiblingNav, ToolButton } from "./LetterParts.tsx";
import styles from "./Letters.module.css";

export interface BubbleEditState {
  text: string;
}

interface MessageBubbleProps {
  message: Message;
  /** Who signs incoming letters. Referentially stable per channel (see the drawer). */
  who: Correspondent;
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

/**
 * One exchange in the thread. Incoming replies are letters — signed with the
 * correspondent's seal or flag, set as prose; the player's own messages are
 * compact notes on the right in the accent ink.
 */
function MessageBubbleImpl({
  message,
  who,
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
  const siblings =
    siblingCount > 1 ? (
      <SiblingNav index={siblingIndex} count={siblingCount} onFlip={(direction) => onFlip(message, direction)} />
    ) : null;

  if (message.role !== "user") {
    const tint = letterTint(who);
    const proposedOrders =
      typeof message.meta.proposedOrders === "string" && message.meta.proposedOrders.trim()
        ? message.meta.proposedOrders
        : null;
    return (
      <article className={`${styles.letter} ${tint.className} pfChamfer`} style={tint.style}>
        <LetterHead who={who}>
          {showRegenerate ? (
            <ToolButton label="Regenerate reply" onClick={() => onRegenerate(message)}>
              <RefreshCw size={13} />
            </ToolButton>
          ) : null}
          {siblings}
        </LetterHead>
        <div className={styles.body}>
          <Markdown>{message.content}</Markdown>
        </div>
        {proposedOrders ? <ProposalSlip text={proposedOrders} /> : null}
      </article>
    );
  }

  if (edit) {
    // Edit-and-fork: the note widens into an editor; sending forks a sibling.
    return (
      <div className={styles.editor}>
        <span className={`${styles.editorLabel} pfKicker`}>Revise &amp; fork</span>
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
          <span className={styles.editHint}>The original stays a branch you can flip back to.</span>
          <Button variant="ghost" size="sm" onClick={onEditCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!edit.text.trim()} onClick={() => onEditSave(message, edit.text)}>
            Send
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.noteWrap}>
      {showEdit ? (
        <span className={styles.noteTools}>
          <ToolButton label="Edit message (forks the conversation)" onClick={() => onStartEdit(message)}>
            <PencilLine size={13} />
          </ToolButton>
        </span>
      ) : null}
      <div className={`${styles.note} pfChamfer`}>{message.content}</div>
      {siblings ? <div className={styles.noteMeta}>{siblings}</div> : null}
    </div>
  );
}

/**
 * An advisor's adoptable orders, pinned under the letter. Adoption only
 * APPENDS to the command line's draft — the player still edits and submits;
 * the council's arbitration design stays intact, made mechanical.
 */
function ProposalSlip({ text }: { text: string }) {
  const [adopted, setAdopted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const adopt = () => {
    useOrdersStore.getState().appendToDraft(text);
    setAdopted(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdopted(false), 2500);
  };
  return (
    <div className={styles.proposal}>
      <span className={`${styles.proposalLabel} pfKicker`}>Proposed orders</span>
      <p className={styles.proposalText}>{text}</p>
      <div className={styles.proposalActions}>
        <span className={styles.proposalHint}>Lands in your draft — edit before you queue it.</span>
        <Button variant="ghost" size="sm" onClick={adopt} title="Append to the orders draft">
          {adopted ? (
            <>
              <Check size={13} /> In your draft
            </>
          ) : (
            <>
              <ListPlus size={13} /> Adopt into orders
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/** Markdown parsing dominates this component; memo is what keeps a long thread
 *  from re-parsing on every keystroke and every streamed token. */
export const MessageBubble = memo(MessageBubbleImpl);
