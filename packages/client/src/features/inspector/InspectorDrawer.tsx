import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Compass, Crosshair, IdCard, WandSparkles } from "lucide-react";
import { regionDisplayName, type WorldState } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { Drawer } from "../../components/Drawer.tsx";
import { formatGameDate } from "../../lib/dates.ts";
import { buildOwnership } from "../../lib/map/ownership.ts";
import { focusCountry, focusPolity } from "../../lib/mapController.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import { Banner, ProvinceCard, Standing } from "./DossierParts.tsx";
import { PsycheSection } from "./PsycheSection.tsx";
import { StatSheetSection } from "./StatSheetSection.tsx";
import styles from "./InspectorDrawer.module.css";

/**
 * The nation dossier: who a power is (banner, tags, standing note), what it
 * measurably holds (domains, forces, works, repute), how its leader regards
 * you (the extractor's psyche — foreign powers only), and how the archivist
 * assesses it this turn (the grounded stat sheet). Opens on a map click, from
 * the rail, or from the top bar's realm button.
 */
export function InspectorDrawer() {
  const selection = useUiStore((state) => state.selection);
  const setLeftDrawer = useUiStore((state) => state.setLeftDrawer);
  const themeId = useUiStore((state) => state.themeId);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));
  const liveWorld = useWorldStore((state) => state.world);
  const gameId = useSessionStore((state) => state.gameId);
  const meta = useSessionStore((state) => state.meta);
  const currentNodeId = useLoomStore((state) => state.currentNodeId);
  const node = useLoomStore((state) => (state.currentNodeId ? state.nodes[state.currentNodeId] : undefined));

  // The world store drops to null while a checkout or GM apply round-trips;
  // holding the last snapshot keeps the dossier from flashing "no data".
  const lastWorld = useRef(liveWorld);
  if (liveWorld) lastWorld.current = liveWorld;
  const world = liveWorld ?? lastWorld.current;

  const palette = useMemo(() => (world ? buildPolityPalette(theme, world) : {}), [theme, world]);
  const ownership = useMemo(() => buildOwnership(world), [world]);

  // No map selection yet? The player's own nation is the natural default —
  // and the only way in for landless organizations you can't click on.
  const polityCode = selection.polityCode ?? meta?.playerPolity;
  const polity = polityCode ? world?.polities[polityCode] : undefined;
  const color = polityCode ? palette[polityCode] : undefined;

  // "Locate" on an actor with nothing on the map says so inline, briefly.
  const [missed, setMissed] = useState(false);
  useEffect(() => {
    setMissed(false);
  }, [polityCode]);
  useEffect(() => {
    if (!missed) return;
    const timer = window.setTimeout(() => setMissed(false), 3600);
    return () => window.clearTimeout(timer);
  }, [missed]);

  return (
    <Drawer
      side="left"
      icon={<IdCard size={16} />}
      kicker={node ? `As of ${formatGameDate(node.gameDate)}` : "Nation file"}
      title="Dossier"
      onClose={() => setLeftDrawer(null)}
    >
      {polity && polityCode ? (
        <div
          key={polityCode}
          className={styles.dossier}
          style={color ? ({ "--pf-polity": color } as CSSProperties) : undefined}
        >
          <Banner
            polity={polity}
            color={color}
            isPlayer={polityCode === meta?.playerPolity}
            onLocate={() => setMissed(!focusPolity(polity.code, world))}
          />
          {missed ? (
            <p className={styles.miss} role="status">
              No territory, forces, or structures to center on yet.
            </p>
          ) : null}
          {polity.tags.length > 0 ? (
            <ul className={styles.tags} aria-label="Tags">
              {polity.tags.map((tag) => (
                <li key={tag} className={styles.tag}>
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
          {polity.note ? <p className={styles.note}>{polity.note}</p> : null}
          {selection.regionId ? (
            <ProvinceCard regionId={selection.regionId} world={world} palette={palette} />
          ) : null}
          <Standing polity={polity} world={world} ownership={ownership} color={color} />
          {gameId && currentNodeId && meta && polityCode !== meta.playerPolity ? (
            <PsycheSection
              gameId={gameId}
              nodeId={currentNodeId}
              polity={polity.code}
              playerName={world?.polities[meta.playerPolity]?.name || meta.playerPolity}
            />
          ) : null}
          {gameId && currentNodeId ? (
            <StatSheetSection
              gameId={gameId}
              nodeId={currentNodeId}
              parentId={node?.parentId ?? null}
              polity={polity.code}
              world={world}
              palette={palette}
            />
          ) : null}
        </div>
      ) : polityCode ? (
        <Unclaimed key={polityCode} code={polityCode} regionId={selection.regionId} world={world} palette={palette} />
      ) : (
        <div className={styles.empty}>
          <Crosshair size={24} aria-hidden />
          <p>Select a nation on the map to open its dossier.</p>
        </div>
      )}
    </Drawer>
  );
}

/**
 * A map click on land no polity holds (terra incognita), or a selection that
 * names a power absent from this branch of history.
 */
function Unclaimed({
  code,
  regionId,
  world,
  palette,
}: {
  code: string;
  regionId: string | undefined;
  world: WorldState | null;
  palette: Record<string, string>;
}) {
  const name = regionDisplayName(code);
  const isLand = name !== code;
  const [missed, setMissed] = useState(false);

  return (
    <div className={styles.dossier}>
      <header className={`${styles.banner} ${styles.unknown}`}>
        <span className={`${styles.plate} ${styles.unknownPlate}`}>
          <Compass size={28} strokeWidth={1.4} aria-hidden />
        </span>
        <div className={styles.identity}>
          <span className={styles.standing}>{isLand ? "Terra incognita" : "No record"}</span>
          <h3 className={`${styles.name} pfTitle`}>{name}</h3>
          <span className={styles.idLine}>
            <code className={styles.code}>{code}</code>
            {isLand ? (
              <Button
                size="sm"
                variant="ghost"
                className={styles.locate}
                title="Center the map here"
                onClick={() => setMissed(!focusCountry(code))}
              >
                <Crosshair size={13} /> Locate
              </Button>
            ) : null}
          </span>
        </div>
      </header>
      {missed ? (
        <p className={styles.miss} role="status">
          That land isn't loaded on the map right now — pan toward it and try again.
        </p>
      ) : null}
      <p className={styles.note}>
        {isLand
          ? `No power in this world claims ${name}. Its peoples stand outside the chronicle — any realm may yet lay claim to it.`
          : `${code} has no record in this branch of history. It may belong to another timeline, or be yet to rise.`}
      </p>
      {regionId ? <ProvinceCard regionId={regionId} world={world} palette={palette} /> : null}
      {isLand ? (
        <div className={styles.callout}>
          <WandSparkles size={16} className={styles.calloutIcon} aria-hidden />
          <p>To grant this land to a power by hand, use the Game master's region tools.</p>
          <Button size="sm" onClick={() => useUiStore.getState().openLeftDrawer("gm")}>
            Open Game master
          </Button>
        </div>
      ) : null}
    </div>
  );
}
