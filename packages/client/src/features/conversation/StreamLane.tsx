import { useEffect, type RefObject } from "react";
import Markdown from "react-markdown";
import { useConversationsStore } from "../../stores/conversations.ts";
import type { Correspondent } from "./correspondents.ts";
import { LetterHead, letterTint } from "./LetterParts.tsx";
import styles from "./Letters.module.css";

/** Within this many px of the bottom, the reader is "following along". */
const FOLLOW_SLACK = 120;

/**
 * The volatile tail of the thread — optimistic user note, the letter being
 * composed and the streaming reply. Subscribes only to the active
 * conversation's transient slices, so a token re-renders this and nothing
 * else.
 */
export function StreamLane({
  conversationId,
  who,
  scroller,
}: {
  conversationId: string;
  who: Correspondent;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const streamingText = useConversationsStore((state) => state.streaming[conversationId]);
  const pendingText = useConversationsStore((state) => state.pendingUser[conversationId]);
  const thinking = useConversationsStore(
    (state) =>
      Boolean(state.awaiting[conversationId]) && state.streaming[conversationId] === undefined,
  );

  // A new exchange always comes into view...
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [pendingText, thinking, scroller]);

  // ...but streamed tokens only pull the thread down while the reader is at
  // the bottom — scrolling up to re-read an earlier letter mid-reply sticks.
  useEffect(() => {
    const node = scroller.current;
    if (!node || streamingText === undefined) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_SLACK) {
      node.scrollTo({ top: node.scrollHeight });
    }
  }, [streamingText, scroller]);

  const tint = letterTint(who);

  return (
    <>
      {pendingText !== undefined ? (
        <div className={styles.noteWrap}>
          <div className={`${styles.note} ${styles.notePending} pfChamfer`}>{pendingText}</div>
        </div>
      ) : null}
      {thinking ? (
        <article
          className={`${styles.letter} ${styles.composing} ${tint.className} pfChamfer`}
          style={tint.style}
          aria-live="polite"
          aria-busy
        >
          <LetterHead who={who} status={who.kind === "envoy" ? "drafting a reply…" : "composing a reply…"} />
          <div className={styles.skeleton} aria-hidden>
            <span />
            <span />
            <span />
          </div>
        </article>
      ) : null}
      {streamingText !== undefined ? (
        <article
          className={`${styles.letter} ${styles.streaming} ${tint.className} pfChamfer`}
          style={tint.style}
          aria-busy
        >
          <LetterHead who={who} status="writing…" />
          <div className={styles.body}>
            <Markdown>{streamingText}</Markdown>
          </div>
        </article>
      ) : null}
    </>
  );
}
