import { useState, type ReactNode } from "react";
import { Check, Globe, Map as MapIcon, Sparkles, Trash, Upload } from "lucide-react";
import type { Theme } from "@pax/domain";
import { Popover } from "../../components/Popover.tsx";
import { useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { PRESET_THEMES } from "../../theme/presets.ts";
import { polityFillColor, territoryColor } from "../../theme/palette.ts";
import { ThemeImportModal } from "../settings/ThemeImportModal.tsx";
import styles from "./ThemePicker.module.css";

/**
 * Theme gallery: every theme previewed in ITS OWN colors and typeface — a
 * sliver of sea, three sample realms, a panel edge — so choosing a theme is
 * choosing a look you can already see.
 */
export function ThemePicker({
  open,
  onClose,
  trigger,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
}) {
  const themes = useThemesStore((state) => state.themes);
  const removeCustom = useThemesStore((state) => state.removeCustom);
  const themeId = useUiStore((state) => state.themeId);
  const setThemeId = useUiStore((state) => state.setThemeId);
  const projection = useUiStore((state) => state.mapProjection);
  const setMapProjection = useUiStore((state) => state.setMapProjection);
  const [importing, setImporting] = useState(false);

  return (
    <>
      <Popover open={open} onClose={onClose} trigger={trigger} width={420}>
        <div className={styles.header}>
          <span className="pfKicker">Appearance</span>
        </div>
        <div className={styles.grid}>
          {themes.map((theme) => {
            const custom = !PRESET_THEMES.some((preset) => preset.meta.id === theme.meta.id);
            return (
              <button
                key={theme.meta.id}
                className={`${styles.card} ${theme.meta.id === themeId ? styles.active : ""}`}
                onClick={() => setThemeId(theme.meta.id)}
              >
                <ThemeSwatch theme={theme} />
                <span className={styles.name} style={{ fontFamily: theme.font.display }}>
                  {theme.meta.name}
                  {theme.meta.id === themeId ? <Check size={13} className={styles.check} /> : null}
                </span>
                {theme.meta.tagline ? <span className={styles.tagline}>{theme.meta.tagline}</span> : null}
                {custom ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className={styles.remove}
                    title="Remove this custom theme"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (confirm(`Remove the theme "${theme.meta.name}"?`)) void removeCustom(theme.meta.id);
                    }}
                  >
                    <Trash size={12} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className={styles.section}>
          <span className="pfKicker">Map projection</span>
          <div className={styles.segmented} role="radiogroup">
            <Segment active={projection === "theme"} onClick={() => setMapProjection("theme")}>
              <Sparkles size={13} /> Theme
            </Segment>
            <Segment active={projection === "globe"} onClick={() => setMapProjection("globe")}>
              <Globe size={13} /> Globe
            </Segment>
            <Segment active={projection === "mercator"} onClick={() => setMapProjection("mercator")}>
              <MapIcon size={13} /> Flat
            </Segment>
          </div>
        </div>

        <button
          className={styles.importButton}
          onClick={() => {
            onClose();
            setImporting(true);
          }}
        >
          <Upload size={14} /> Import a theme…
        </button>
      </Popover>
      {importing ? <ThemeImportModal onClose={() => setImporting(false)} /> : null}
    </>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button role="radio" aria-checked={active} className={`${styles.segment} ${active ? styles.segmentActive : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** A thumbnail painted from the theme itself: sea, coast, three realms, chrome. */
export function ThemeSwatch({ theme }: { theme: Theme }) {
  const realms = ["FRA", "DEU", "ESP"].map((code) => territoryColor(theme, polityFillColor(theme, code)));
  const { map, color } = theme;
  return (
    <svg className={styles.swatch} viewBox="0 0 180 72" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="180" height="72" fill={map.water} />
      {[16, 32, 48, 64].map((y) => (
        <line key={y} x1="0" x2="180" y1={y} y2={y} stroke={map.graticule} strokeWidth="0.6" />
      ))}
      {[30, 60, 90, 120, 150].map((x) => (
        <line key={x} y1="0" y2="72" x1={x} x2={x} stroke={map.graticule} strokeWidth="0.6" />
      ))}
      <path
        d="M58 8c18-6 40-2 52 8s30 4 40 16-4 26-22 30-30 14-50 8-36-4-40-22 2-34 20-40z"
        fill={map.land}
        stroke={map.coast.color || map.boundary.line}
        strokeWidth={map.coast.style === "none" ? 0.8 : 2.4}
        strokeOpacity={map.coast.style === "none" ? 1 : 0.45}
      />
      <path d="M62 14c14-6 30-4 38 4l-6 24-34 6c-8-10-8-26 2-34z" fill={realms[0]} stroke={map.boundary.line} strokeWidth="0.8" />
      <path d="M100 18c12-2 26 0 36 10s0 22-10 26l-32-10z" fill={realms[1]} stroke={map.boundary.line} strokeWidth="0.8" />
      <path d="M60 48l34-6 0 14c-10 8-24 8-30 4s-8-6-4-12z" fill={realms[2]} stroke={map.boundary.line} strokeWidth="0.8" />
      <rect x="0" y="0" width="34" height="72" fill={color.surface[1]} opacity="0.94" />
      <rect x="33.5" y="0" width="1" height="72" fill={color.border.strong} />
      <rect x="8" y="12" width="18" height="3" rx="1" fill={color.accent.base} />
      <rect x="8" y="22" width="14" height="2" rx="1" fill={color.text.muted} />
      <rect x="8" y="29" width="18" height="2" rx="1" fill={color.text.muted} />
      <rect x="8" y="36" width="11" height="2" rx="1" fill={color.text.muted} />
    </svg>
  );
}
