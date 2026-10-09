import type { ReactNode } from "react";
import { ChevronRight, Crosshair, Crown, MapPin, Ruler, type LucideIcon } from "lucide-react";
import { UNIT_TYPES, regionDisplayName, type Polity, type WorldState } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { UnitSymbol } from "../../components/UnitSymbol.tsx";
import type { Ownership } from "../../lib/map/ownership.ts";
import { focusRegion } from "../../lib/mapController.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./InspectorDrawer.module.css";

/** Dossier section header: icon + kicker, an optional provenance stamp
 *  (estimated by the archivist vs measured from the world), and controls. */
export function SectionHead({
  icon: Icon,
  label,
  provenance,
  children,
}: {
  icon: LucideIcon;
  label: string;
  provenance?: "estimated" | "measured";
  children?: ReactNode;
}) {
  return (
    <header className={styles.head}>
      <Icon size={13} className={styles.headIcon} aria-hidden />
      <span className="pfKicker">{label}</span>
      {provenance === "estimated" ? (
        <span
          className={styles.provenance}
          title="Estimated by the archivist from this turn's facts, anchored to the previous turn's sheet."
        >
          estimated
        </span>
      ) : provenance === "measured" ? (
        <span
          className={`${styles.provenance} ${styles.measured}`}
          title="Counted exactly from the world and the chronicle's standing facts — never estimated."
        >
          measured
        </span>
      ) : null}
      {children ? <span className={styles.headAside}>{children}</span> : null}
    </header>
  );
}

/** The dossier's masthead: banner, name, code, and the polity's map color as a band. */
export function Banner({
  polity,
  color,
  isPlayer,
  onLocate,
}: {
  polity: Polity;
  color: string | undefined;
  isPlayer: boolean;
  onLocate: () => void;
}) {
  return (
    <header className={`${styles.banner} ${isPlayer ? styles.player : ""}`}>
      <span className={styles.plate}>
        <PolityFlag flag={polity.flag} color={color} size={40} />
      </span>
      <div className={styles.identity}>
        <span className={styles.standing}>
          {isPlayer ? (
            <>
              <Crown size={12} aria-hidden /> Your realm
            </>
          ) : (
            "Foreign power"
          )}
        </span>
        <h3 className={`${styles.name} pfTitle`}>{polity.name || polity.code}</h3>
        <span className={styles.idLine}>
          <code className={styles.code} title="Polity code — and its color on the map">
            <span className={styles.swatch} aria-hidden />
            {polity.code}
          </code>
          <Button
            size="sm"
            variant="ghost"
            className={styles.locate}
            title="Center the map on this realm"
            onClick={onLocate}
          >
            <Crosshair size={13} /> Locate
          </Button>
        </span>
      </div>
    </header>
  );
}

const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count.toLocaleString("en-US")} ${count === 1 ? word : many}`;

/** Exact, world-counted figures: what the polity holds right now. */
export function Standing({
  polity,
  world,
  ownership,
  color,
}: {
  polity: Polity;
  world: WorldState | null;
  ownership: Ownership;
  color: string | undefined;
}) {
  const lands = ownership.countriesOf[polity.code]?.length ?? 0;
  const provinces = ownership.regionsOf[polity.code]?.length ?? 0;
  const units = world?.units.filter((unit) => unit.ownerCode === polity.code) ?? [];
  const strength = units.reduce((sum, unit) => sum + unit.strength, 0);
  const works = world?.markers.filter((marker) => marker.ownerCode === polity.code).length ?? 0;
  const counts = UNIT_TYPES.map((type) => ({
    type,
    count: units.filter((unit) => unit.type === type).length,
  })).filter((entry) => entry.count > 0);

  const domains =
    lands + provinces === 0
      ? "landless"
      : [lands ? plural(lands, "land") : "", provinces ? plural(provinces, "province") : ""]
          .filter(Boolean)
          .join(" · ");

  return (
    <section className={styles.section}>
      <SectionHead icon={Ruler} label="Standing" provenance="measured" />
      <dl className={styles.ledger}>
        <LedgerRow label="Domains" value={domains} muted={lands + provinces === 0} />
        <LedgerRow
          label="Forces"
          value={units.length ? `${plural(units.length, "unit")} · ${strength.toLocaleString("en-US")} str` : "none fielded"}
          muted={units.length === 0}
        />
        <LedgerRow label="Works" value={works ? plural(works, "structure") : "none built"} muted={works === 0} />
        <LedgerRow
          label="Repute"
          value={polity.reputation === null ? "unrated" : `${polity.reputation} / 100`}
          muted={polity.reputation === null}
          meter={polity.reputation ?? undefined}
        />
      </dl>
      {counts.length > 0 ? (
        <button
          className={styles.forces}
          title="Open this power's order of battle (F)"
          onClick={() => {
            const ui = useUiStore.getState();
            ui.setSelection({ ...ui.selection, polityCode: polity.code });
            ui.openLeftDrawer("forces");
          }}
        >
          <span className={styles.composition}>
            {counts.map(({ type, count }) => (
              <span key={type} className={styles.unitCount} title={plural(count, type, type)}>
                <UnitSymbol type={type} color={color} size={20} />
                {count}
              </span>
            ))}
          </span>
          <span className={styles.forcesLink}>
            Order of battle <ChevronRight size={13} aria-hidden />
          </span>
        </button>
      ) : null}
    </section>
  );
}

function LedgerRow({
  label,
  value,
  muted = false,
  meter,
}: {
  label: string;
  value: string;
  muted?: boolean;
  meter?: number | undefined;
}) {
  return (
    <div className={styles.ledgerRow}>
      <dt className={styles.ledgerLabel}>{label}</dt>
      <span className={styles.leader} aria-hidden />
      <dd className={`${styles.ledgerValue} ${muted ? styles.ledgerMuted : ""}`}>
        {meter !== undefined ? (
          <span className={styles.miniMeter} aria-hidden>
            <span style={{ width: `${meter}%` }} />
          </span>
        ) : null}
        {value}
      </dd>
    </div>
  );
}

/** The map region under the last click, with any rival claims on it. */
export function ProvinceCard({
  regionId,
  world,
  palette,
}: {
  regionId: string;
  world: WorldState | null;
  palette: Record<string, string>;
}) {
  const countryCode = regionId.split(".")[0] ?? regionId;
  const country = regionDisplayName(countryCode);
  // GADM's missing-value marker leaked into a few catalog names ("NA").
  const raw = regionDisplayName(regionId);
  const name = raw === "NA" ? `${country} (unnamed province)` : raw;
  const claimants = world?.regionClaimants[regionId] ?? [];

  return (
    <div className={styles.province}>
      <MapPin size={16} className={styles.provinceIcon} aria-hidden />
      <div className={styles.provinceBody}>
        <span className="pfKicker">Selected province</span>
        <span className={styles.provinceName}>{name}</span>
        <span className={styles.provinceMeta}>
          {raw !== "NA" && country !== name && country !== countryCode ? `${country} · ` : ""}
          <code>{regionId}</code>
        </span>
        {claimants.length > 0 ? (
          <span className={styles.contested}>
            Contested by
            {claimants.map((code) => (
              <span key={code} className={styles.claimant}>
                <PolityFlag flag={world?.polities[code]?.flag} color={palette[code]} size={13} />
                {world?.polities[code]?.name || code}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon
        title="Center the map on this province"
        aria-label="Center the map on this province"
        onClick={() => focusRegion(regionId)}
      >
        <Crosshair size={14} />
      </Button>
    </div>
  );
}
