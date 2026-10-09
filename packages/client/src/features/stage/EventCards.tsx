import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { useEventCardsStore } from "../../stores/eventCards.ts";
import styles from "./EventCards.module.css";

/**
 * The post-turn event walk: one floating card per event over the live map
 * (which flies to where the event happened when its impacts anchor it),
 * with next-event pacing and a jump list of the whole turn.
 */
export function EventCards() {
  // Per-slice subscriptions: this overlay must not re-render on unrelated
  // store writes (actions are stable references, reading them is free).
  const events = useEventCardsStore((state) => state.events);
  const index = useEventCardsStore((state) => state.index);
  const open = useEventCardsStore((state) => state.open);
  const listOpen = useEventCardsStore((state) => state.listOpen);
  const next = useEventCardsStore((state) => state.next);
  const goTo = useEventCardsStore((state) => state.goTo);
  const close = useEventCardsStore((state) => state.close);
  const setListOpen = useEventCardsStore((state) => state.setListOpen);
  const event = events[index];

  if (!open || !event) return null;

  return (
    <>
      <div className={styles.card}>
        <div className={styles.header}>
          <span className={styles.date}>{event.date}</span>
          {event.importance !== "minor" ? (
            <Badge tone={event.importance === "pivotal" ? "danger" : "warning"}>
              {event.importance}
            </Badge>
          ) : null}
          {event.playerRelated ? <Badge tone="accent">you</Badge> : null}
          <span className={styles.counter}>
            {index + 1}/{events.length}
          </span>
          <button className={styles.close} onClick={close} aria-label="Dismiss events">
            ✕
          </button>
        </div>
        <h3 className={styles.headline}>{event.title}</h3>
        {event.description ? <p className={styles.description}>{event.description}</p> : null}
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => setListOpen(true)}>
            Show all events ({events.length})
          </Button>
          <span className={styles.spacer} />
          {index > 0 ? (
            <Button variant="ghost" onClick={() => goTo(index - 1)}>
              ← Back
            </Button>
          ) : null}
          <Button variant="primary" onClick={next}>
            {index + 1 >= events.length ? "Done" : "Next event →"}
          </Button>
        </div>
      </div>

      {listOpen ? (
        <Modal title={`Events this turn (${events.length})`} onClose={() => setListOpen(false)}>
          <ul className={styles.list}>
            {events.map((entry, i) => (
              <li
                key={entry.id}
                className={`${styles.listItem} ${i === index ? styles.listActive : ""}`}
                onClick={() => goTo(i)}
              >
                <span className={styles.listDate}>{entry.date}</span>
                <span>
                  {entry.importance !== "minor" ? "⚑ " : ""}
                  <strong>{entry.title}</strong>
                  {entry.description ? (
                    <span className={styles.listDescription}> — {entry.description}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </>
  );
}
