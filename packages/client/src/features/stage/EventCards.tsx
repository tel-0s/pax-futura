import { ArrowLeft, ArrowRight, Check, List, LocateFixed, X } from "lucide-react";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { formatGameDate } from "../../lib/dates.ts";
import { focusEvent } from "../../lib/mapController.ts";
import { useEventCardsStore } from "../../stores/eventCards.ts";
import styles from "./EventCards.module.css";

/**
 * The post-turn event walk: one dispatch card per event over the live map
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
  const last = index + 1 >= events.length;

  return (
    <>
      <article
        key={event.id}
        className={`${styles.card} ${styles[event.importance]} pfPanel`}
        data-occludes="bottom"
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === "ArrowRight") next();
          if (keyEvent.key === "ArrowLeft" && index > 0) goTo(index - 1);
          if (keyEvent.key === "Escape") close();
        }}
      >
        <div className={styles.progress} aria-hidden>
          {events.map((entry, i) => (
            <span
              key={entry.id}
              className={`${styles.tick} ${i < index ? styles.tickDone : ""} ${i === index ? styles.tickNow : ""}`}
            />
          ))}
        </div>
        <header className={styles.header}>
          <span className="pfKicker">
            Dispatch {index + 1} of {events.length}
          </span>
          <span className={styles.date}>{formatGameDate(event.date)}</span>
          {event.importance !== "minor" ? (
            <Badge tone={event.importance === "pivotal" ? "danger" : "warning"}>{event.importance}</Badge>
          ) : null}
          {event.playerRelated ? <Badge tone="accent">your realm</Badge> : null}
          <span className={styles.spacer} />
          <Button variant="ghost" icon size="sm" onClick={() => focusEvent(event)} title="Fly to this event">
            <LocateFixed size={15} />
          </Button>
          <Button variant="ghost" icon size="sm" onClick={close} aria-label="Dismiss dispatches" title="Dismiss (Esc)">
            <X size={15} />
          </Button>
        </header>
        <h3 className={`${styles.headline} pfTitle`}>{event.title}</h3>
        {event.description ? <p className={styles.description}>{event.description}</p> : null}
        <footer className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={() => setListOpen(true)}>
            <List size={14} /> All dispatches
          </Button>
          <span className={styles.spacer} />
          {index > 0 ? (
            <Button variant="ghost" onClick={() => goTo(index - 1)}>
              <ArrowLeft size={14} /> Back
            </Button>
          ) : null}
          <Button variant="primary" onClick={next} autoFocus>
            {last ? (
              <>
                <Check size={14} /> Done
              </>
            ) : (
              <>
                Next <ArrowRight size={14} />
              </>
            )}
          </Button>
        </footer>
      </article>

      {listOpen ? (
        <Modal
          title="This turn's dispatches"
          kicker={`${events.length} events`}
          size="lg"
          onClose={() => setListOpen(false)}
        >
          <ol className={styles.list}>
            {events.map((entry, i) => (
              <li
                key={entry.id}
                className={`${styles.listItem} ${styles[entry.importance]} ${i === index ? styles.listActive : ""}`}
                onClick={() => goTo(i)}
              >
                <span className={styles.listDate}>{formatGameDate(entry.date)}</span>
                <span className={styles.listBody}>
                  <strong className={styles.listTitle}>{entry.title}</strong>
                  {entry.description ? <span className={styles.listDescription}>{entry.description}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </Modal>
      ) : null}
    </>
  );
}
