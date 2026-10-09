import { useMemo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { WorldState } from "@pax/domain";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import styles from "./gm.module.css";

/** One tool on the bench: icon + kicker title, an optional aside, a hint line. */
export function GmSection({
  icon: Icon,
  title,
  hint,
  aside,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <Icon size={14} className={styles.sectionIcon} aria-hidden />
        <h3 className={`${styles.sectionTitle} pfKicker`}>{title}</h3>
        {aside ? <span className={styles.sectionAside}>{aside}</span> : null}
      </header>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {children}
    </section>
  );
}

/** Polity map colors under the active theme (for owner swatches and symbols). */
export const usePolityPalette = (world: WorldState): Record<string, string> => {
  const themeId = useUiStore((state) => state.themeId);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));
  return useMemo(() => buildPolityPalette(theme, world), [theme, world]);
};

/** Flag + name (or code) of a polity, compact, for rows and previews. */
export function OwnerTag({
  code,
  world,
  palette,
  short = false,
}: {
  code: string | null | undefined;
  world: WorldState;
  palette: Record<string, string>;
  short?: boolean;
}) {
  if (!code) return <span className={`${styles.owner} ${styles.ownerNone}`}>unclaimed</span>;
  const polity = world.polities[code];
  return (
    <span className={styles.owner} title={polity?.name || code}>
      <PolityFlag flag={polity?.flag} color={palette[code]} size={14} />
      {short ? code : polity?.name || code}
    </span>
  );
}
