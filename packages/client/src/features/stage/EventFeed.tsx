import { useEffect, useState } from "react";
import type { GameEvent } from "@pax/domain";
import { api } from "../../lib/api.ts";
import { useEventCardsStore } from "../../stores/eventCards.ts";
import styles from "./StageScreen.module.css";

/** Events of the checked-out node, reloaded when the node changes. */
export function EventFeed({ gameId, nodeId }: { gameId: string; nodeId: string }) {
  const [events, setEvents] = useState<GameEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api
      .listNodeEvents(gameId, nodeId)
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error("event feed load failed:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, nodeId]);

  if (events.length === 0) return null;

  return (
    <div className={styles.events}>
      {events.map((event, index) => (
        <div key={event.id} className={styles.eventRow}>
          <button
            type="button"
            className={styles.eventLocate}
            title="Locate & show this event"
            aria-label={`Locate & show: ${event.title}`}
            onClick={() => useEventCardsStore.getState().show(events, index)}
          >
            ⌖
          </button>
          <span className={styles.eventDate}>{event.date}</span>
          <span>
            {event.importance !== "minor" ? "⚑ " : ""}
            <strong>{event.title}</strong>
            {event.description ? ` — ${event.description}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
