import { useEffect, type RefObject } from "react";
import Markdown from "react-markdown";
import { useConversationsStore } from "../../stores/conversations.ts";
import styles from "./ConversationsDrawer.module.css";

/**
 * The volatile tail of the thread — optimistic user bubble, thinking dots and
 * the streaming reply. Subscribes only to the active conversation's transient
 * slices, so a token re-renders this and nothing else.
 */
export function StreamLane({
  conversationId,
  scroller,
}: {
  conversationId: string;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const streamingText = useConversationsStore((state) => state.streaming[conversationId]);
  const pendingText = useConversationsStore((state) => state.pendingUser[conversationId]);
  const thinking = useConversationsStore(
    (state) =>
      Boolean(state.awaiting[conversationId]) && state.streaming[conversationId] === undefined,
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [streamingText, pendingText, thinking, scroller]);

  return (
    <>
      {pendingText !== undefined ? (
        <div className={`${styles.message} ${styles.user}`}>
          <div className={styles.content}>{pendingText}</div>
        </div>
      ) : null}
      {thinking ? (
        <div className={`${styles.message} ${styles.assistant}`}>
          <div className={styles.thinking}>
            Thinking
            <span className={styles.dot}>.</span>
            <span className={styles.dot}>.</span>
            <span className={styles.dot}>.</span>
          </div>
        </div>
      ) : null}
      {streamingText !== undefined ? (
        <div className={`${styles.message} ${styles.assistant}`}>
          <div className={styles.content}>
            <Markdown>{streamingText}</Markdown>
            <span className={styles.cursor}>▌</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
