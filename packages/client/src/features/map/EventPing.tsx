import { Marker } from "react-map-gl/maplibre";
import { useEventCardsStore } from "../../stores/eventCards.ts";
import styles from "./MapStage.module.css";

/** A sonar ping where the event on the open card happened (when it has coordinates). */
export function EventPing() {
  const open = useEventCardsStore((state) => state.open);
  const event = useEventCardsStore((state) => state.events[state.index]);
  if (!open || !event || event.lng === undefined || event.lat === undefined) return null;
  if (!Number.isFinite(event.lng) || !Number.isFinite(event.lat)) return null;
  const tone = event.importance === "pivotal" ? styles.pingPivotal : event.importance === "major" ? styles.pingMajor : "";
  return (
    <Marker key={event.id} longitude={event.lng} latitude={event.lat} anchor="center" style={{ pointerEvents: "none" }}>
      <span className={`${styles.ping} ${tone}`}>
        <span className={styles.pingRing} />
        <span className={styles.pingRing} />
        <span className={styles.pingCore} />
      </span>
    </Marker>
  );
}
