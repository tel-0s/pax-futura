import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ConversationAtNode } from "@pax/domain";
import { useConversationsStore } from "../../stores/conversations.ts";
import type { Correspondent } from "./correspondents.ts";
import { CorrespondentMark } from "./Seal.tsx";
import { isUnread, markSeen, readLedger, writeLedger, type SeenLedger } from "./seen.ts";
import styles from "./Cast.module.css";

export interface CastEntry {
  conversation: ConversationAtNode;
  who: Correspondent;
}

/**
 * Space-separated ids of channels with a reply in flight. A string, not the
 * record: zustand compares selector results by identity, so the cast only
 * re-renders when a channel starts or stops working — never per token.
 */
const selectBusyIds = (state: {
  awaiting: Record<string, boolean>;
  streaming: Record<string, string>;
}): string => {
  const ids = new Set(Object.keys(state.streaming));
  for (const [id, waiting] of Object.entries(state.awaiting)) if (waiting) ids.add(id);
  return [...ids].sort().join(" ");
};

/** How much of a crowded cast is scrolled out of view on each side. */
interface Overflow {
  left: number;
  right: number;
  leftUnread: boolean;
  rightUnread: boolean;
}

const NO_OVERFLOW: Overflow = { left: 0, right: 0, leftUnread: false, rightUnread: false };

const measureOverflow = (node: HTMLElement): Overflow => {
  const start = node.scrollLeft;
  const end = start + node.clientWidth;
  const next = { ...NO_OVERFLOW };
  for (const item of node.querySelectorAll<HTMLElement>("[role=tab]")) {
    const middle = item.offsetLeft + item.offsetWidth / 2;
    const unread = item.dataset.unread === "true";
    if (middle < start) {
      next.left += 1;
      next.leftUnread ||= unread;
    } else if (middle > end) {
      next.right += 1;
      next.rightUnread ||= unread;
    }
  }
  return next;
};

const sameOverflow = (a: Overflow, b: Overflow): boolean =>
  a.left === b.left && a.right === b.right && a.leftUnread === b.leftUnread && a.rightUnread === b.rightUnread;

/**
 * The channel switcher as a cast of people: each correspondent is their seal
 * or flag; the one you are writing to unfolds to show name and office. Dots
 * mark replies you haven't looked at, a turning ring marks a reply being
 * written. New channels are opened from the empty seats at the end. When
 * the cast outgrows the drawer, "+N" chips at either edge count who is
 * scrolled out of view (and light up if one of them has news).
 */
export const CastStrip = memo(function CastStrip({
  gameId,
  entries,
  activeId,
  onSelect,
  seats,
}: {
  gameId: string;
  entries: CastEntry[];
  activeId: string | null;
  onSelect: (conversationId: string) => void;
  seats: ReactNode;
}) {
  const busyIds = useConversationsStore(selectBusyIds);
  // Read once per mount; the drawer keys the cast by game.
  const [ledger, setLedger] = useState<SeenLedger>(() => readLedger(gameId));
  const scroller = useRef<HTMLDivElement>(null);

  // Looking at a channel is what reads it — including replies that land
  // while it is open.
  const activeHead = entries.find((entry) => entry.conversation.id === activeId)?.conversation.headMessageId ?? null;
  useEffect(() => {
    if (!activeId) return;
    setLedger((current) => {
      const next = markSeen(current, activeId, activeHead);
      if (next !== current) writeLedger(gameId, next);
      return next;
    });
  }, [gameId, activeId, activeHead]);

  const [overflow, setOverflow] = useState<Overflow>(NO_OVERFLOW);
  const measure = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const next = measureOverflow(node);
    setOverflow((current) => (sameOverflow(current, next) ? current : next));
  }, []);

  /** Bring the unfolded correspondent fully into view (scrolling only the cast). */
  const revealActive = useCallback(() => {
    const node = scroller.current;
    const item = node?.querySelector<HTMLElement>("[aria-selected='true']");
    if (!node || !item) return;
    const pad = 24;
    if (item.offsetLeft - pad < node.scrollLeft) {
      node.scrollTo({ left: item.offsetLeft - pad, behavior: "smooth" });
    } else if (item.offsetLeft + item.offsetWidth + pad > node.scrollLeft + node.clientWidth) {
      node.scrollTo({ left: item.offsetLeft + item.offsetWidth + pad - node.clientWidth, behavior: "smooth" });
    }
  }, []);

  useLayoutEffect(measure, [measure, entries, activeId, ledger]);
  useEffect(revealActive, [revealActive, activeId]);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  // The active label unfolds with a transition: re-measure (and re-reveal)
  // once it has its final width.
  const onTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName !== "max-width") return;
      measure();
      revealActive();
    },
    [measure, revealActive],
  );

  const page = (direction: 1 | -1) => {
    const node = scroller.current;
    node?.scrollBy({ left: direction * node.clientWidth * 0.7, behavior: "smooth" });
  };

  // Tablist keys: arrows walk the cast, Home/End jump to either end.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = entries.findIndex((entry) => entry.conversation.id === activeId);
    const last = entries.length - 1;
    const target =
      event.key === "ArrowRight"
        ? Math.min(index + 1, last)
        : event.key === "ArrowLeft"
          ? Math.max(index - 1, 0)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    const next = entries[target];
    if (!next) return;
    event.preventDefault();
    onSelect(next.conversation.id);
    requestAnimationFrame(() =>
      scroller.current?.querySelector<HTMLElement>("[aria-selected='true']")?.focus(),
    );
  };

  // Vertical wheel scrolls a crowded cast sideways.
  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.currentTarget.scrollLeft += event.deltaY;
    }
  }, []);

  const busy = new Set(busyIds ? busyIds.split(" ") : []);

  return (
    <div className={styles.castRow}>
      <div className={styles.castViewport}>
        {overflow.left > 0 ? (
          <button
            type="button"
            className={`${styles.castMore} ${styles.castMoreLeft} ${overflow.leftUnread ? styles.castMoreUnread : ""}`}
            aria-label={`${overflow.left} more correspondent${overflow.left === 1 ? "" : "s"} to the left`}
            onClick={() => page(-1)}
          >
            <ChevronLeft size={12} />
            {overflow.left}
          </button>
        ) : null}
        <div
          className={[
            styles.cast,
            overflow.left > 0 ? styles.fadeStart : "",
            overflow.right > 0 ? styles.fadeEnd : "",
          ]
            .filter(Boolean)
            .join(" ")}
          ref={scroller}
          role="tablist"
          aria-label="Correspondents"
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          onScroll={measure}
          onTransitionEnd={onTransitionEnd}
        >
          {entries.map(({ conversation, who }) => {
            const active = conversation.id === activeId;
            const unread = !active && isUnread(ledger, conversation.id, conversation.headMessageId);
            const working = busy.has(conversation.id);
            return (
              <button
                key={conversation.id}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-unread={unread}
                className={`${styles.castItem} ${active ? styles.castActive : ""} pfChamfer`}
                title={[who.fullName, who.hint, unread ? "unread reply" : ""].filter(Boolean).join(" — ")}
                onClick={() => onSelect(conversation.id)}
              >
                <span className={styles.castMark}>
                  <CorrespondentMark who={who} size={30} />
                  {working ? <span className={styles.busyRing} /> : null}
                  {unread ? <span className={styles.unreadDot} /> : null}
                </span>
                <span className={styles.castLabel}>
                  <span className={styles.castName}>
                    {who.name}
                    {unread ? <span className={styles.srOnly}>, unread reply</span> : null}
                  </span>
                  <span className={styles.castOffice}>{working && active ? "writing…" : who.office}</span>
                </span>
              </button>
            );
          })}
        </div>
        {overflow.right > 0 ? (
          <button
            type="button"
            className={`${styles.castMore} ${styles.castMoreRight} ${overflow.rightUnread ? styles.castMoreUnread : ""}`}
            aria-label={`${overflow.right} more correspondent${overflow.right === 1 ? "" : "s"} to the right`}
            onClick={() => page(1)}
          >
            {overflow.right}
            <ChevronRight size={12} />
          </button>
        ) : null}
      </div>
      <div className={styles.seats}>{seats}</div>
    </div>
  );
});
