import { useEffect, useRef, type RefObject } from "react";
import { regionDisplayName, type WorldState } from "@pax/domain";
import { useSessionStore } from "../../stores/session.ts";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import styles from "./MapStage.module.css";

export interface HoverInfo {
  owner: string | null;
  gid0: string | null;
  gid1: string | null;
}

/**
 * The cursor's dossier: who holds the ground under the pointer. Follows the
 * pointer by writing its own transform (no React render per mouse move);
 * React only re-renders when the hovered territory changes.
 */
export function HoverCard({
  info,
  pointRef,
  world,
  palette,
}: {
  info: HoverInfo | null;
  pointRef: RefObject<{ x: number; y: number }>;
  world: WorldState | null;
  palette: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const playerCode = useSessionStore((state) => state.meta?.playerPolity);

  useEffect(() => {
    const node = ref.current;
    const host = node?.parentElement;
    if (!node || !host) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const { x, y } = pointRef.current;
      const flip = x > host.clientWidth - 260;
      node.style.transform = `translate(${flip ? x - 16 - node.offsetWidth : x + 16}px, ${y + 18}px)`;
    };
    const onMove = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    host.addEventListener("mousemove", onMove);
    place();
    return () => {
      host.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [pointRef, info]);

  if (!info) return <div ref={ref} className={styles.hoverCard} hidden />;

  const polity = info.owner ? world?.polities[info.owner] : undefined;
  const place = info.gid1 ? regionDisplayName(info.gid1) : info.gid0 ? regionDisplayName(info.gid0) : "";
  const country = info.gid1 && info.gid0 ? regionDisplayName(info.gid0) : "";
  const name = polity?.name || info.owner;

  return (
    <div ref={ref} className={styles.hoverCard}>
      {info.owner ? (
        <>
          <div className={styles.hoverHead}>
            <PolityFlag flag={polity?.flag} color={palette[info.owner]} size={18} />
            <span className={styles.hoverName}>{name}</span>
            {info.owner === playerCode ? <span className={styles.hoverYou}>you</span> : null}
          </div>
          {place && place !== name ? (
            <div className={styles.hoverPlace}>
              {place}
              {country && country !== place ? ` · ${country}` : ""}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className={styles.hoverHead}>
            <span className={styles.hoverName}>Terra incognita</span>
          </div>
          <div className={styles.hoverPlace}>{place}</div>
        </>
      )}
    </div>
  );
}
