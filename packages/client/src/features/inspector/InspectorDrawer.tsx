import { Badge } from "../../components/Badge.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { StatSheetSection } from "./StatSheetSection.tsx";
import { focusPolity } from "../../lib/mapController.ts";
import styles from "./InspectorDrawer.module.css";

export function InspectorDrawer() {
  const selection = useUiStore((state) => state.selection);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const world = useWorldStore((state) => state.world);
  const gameId = useSessionStore((state) => state.gameId);
  const meta = useSessionStore((state) => state.meta);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);

  // No map selection yet? The player's own nation is the natural default —
  // and the only way in for landless organizations you can't click on.
  const polityCode = selection.polityCode ?? meta?.playerPolity;
  const polity = polityCode ? world?.polities[polityCode] : undefined;
  const regionCount = polityCode
    ? Object.values(world?.regionOwnership ?? {}).filter((code) => code === polityCode).length
    : 0;
  const units = world?.units.filter((unit) => unit.ownerCode === polityCode) ?? [];

  return (
    <Drawer
      side="left"
      title={
        <span className={styles.titleRow}>
          {polity?.flag ? (
            polity.flag.startsWith("data:") ? (
              <img src={polity.flag} alt="" className={styles.flag} />
            ) : (
              <span>{polity.flag}</span>
            )
          ) : null}
          {polity?.name || polityCode || "Inspector"}
        </span>
      }
      onClose={() => setLeftDrawer(null)}
    >
      {polity ? (
        <div className={styles.body}>
          <div className={styles.tags}>
            {polity.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
            <button
              className={styles.locate}
              title="Center the map here"
              onClick={() => {
                if (!focusPolity(polity.code, world)) {
                  alert("This actor has no map presence yet — no territory, units, or structures.");
                }
              }}
            >
              ⌖ Locate
            </button>
          </div>
          {polity.reputation !== null ? (
            <Row label="Reputation" value={`${polity.reputation}/100`} />
          ) : null}
          {regionCount > 0 ? <Row label="Region overrides" value={String(regionCount)} /> : null}
          {selection.regionId ? <Row label="Selected region" value={selection.regionId} /> : null}
          {polity.note ? <p className={styles.note}>{polity.note}</p> : null}
          {gameId && currentNodeId ? (
            <>
              <h4 className={styles.heading}>Assessment</h4>
              <StatSheetSection gameId={gameId} nodeId={currentNodeId} polity={polity.code} />
            </>
          ) : null}
          {units.length > 0 ? (
            <>
              <h4 className={styles.heading}>Forces</h4>
              {units.map((unit) => (
                <Row
                  key={unit.id}
                  label={unit.name}
                  value={`${unit.type} · ${unit.strength} · ${unit.status}`}
                />
              ))}
            </>
          ) : null}
        </div>
      ) : (
        <p className={styles.note}>
          {polityCode ? `No data for ${polityCode} in this world.` : "Click a nation on the map."}
        </p>
      )}
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
