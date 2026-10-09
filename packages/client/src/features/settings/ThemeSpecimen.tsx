import type { Theme } from "@pax/domain";
import { polityFillColor, territoryColor } from "../../theme/palette.ts";
import styles from "./ThemeSpecimen.module.css";

/**
 * A theme previewed in ITS OWN colors and typeface, not the active theme's:
 * a sliver of sea and three sample realms beside a panel carrying the
 * display face, an accent control and body lines. Painted from the theme's
 * raw values (SVG attributes), so it works for a pasted, not-yet-applied
 * theme too.
 */
export function ThemeSpecimen({ theme }: { theme: Theme }) {
  const { map, color, font } = theme;
  const realms = ["FRA", "DEU", "ESP"].map((code) => territoryColor(theme, polityFillColor(theme, code)));
  const radius = Math.min(6, parseFloat(theme.radius.md) || 0);
  const caps = theme.style.heading.case === "uppercase";
  return (
    <svg className={styles.specimen} viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="240" height="110" fill={map.water} />
      {[22, 44, 66, 88].map((y) => (
        <line key={y} x1="0" x2="240" y1={y} y2={y} stroke={map.graticule} strokeWidth="0.5" />
      ))}
      {[120, 150, 180, 210].map((x) => (
        <line key={x} y1="0" y2="110" x1={x} x2={x} stroke={map.graticule} strokeWidth="0.5" />
      ))}
      <path
        d="M118 14c20-8 46-4 62 6s40 2 50 20-4 34-26 40-36 18-60 10-34-8-36-30 -6-38 10-46z"
        fill={map.land}
        stroke={map.coast.color || map.boundary.line}
        strokeWidth={map.coast.style === "none" ? 0.8 : 2.4}
        strokeOpacity={map.coast.style === "none" ? 1 : 0.45}
      />
      <path d="M122 22c16-8 36-6 46 4l-6 30-40 6c-10-12-10-30 0-40z" fill={realms[0]} stroke={map.boundary.line} strokeWidth="0.8" />
      <path d="M168 26c14-2 30 2 42 14s-2 26-12 30l-38-12z" fill={realms[1]} stroke={map.boundary.line} strokeWidth="0.8" />
      <path d="M122 62l40-6 0 18c-12 10-28 10-36 4s-8-8-4-16z" fill={realms[2]} stroke={map.boundary.line} strokeWidth="0.8" />

      <rect x="8" y="10" width="96" height="90" rx={radius} fill={color.surface[1]} stroke={color.border.strong} strokeWidth="0.8" />
      <text
        x="18"
        y="38"
        fill={color.text.primary}
        style={{
          fontFamily: font.display,
          fontSize: 22,
          fontSizeAdjust: font.displayAdjust ?? undefined,
          letterSpacing: theme.style.heading.tracking,
        }}
      >
        {caps ? "AA" : "Aa"}
      </text>
      <rect x="18" y="48" width="58" height="3" rx="1.5" fill={color.text.secondary} opacity="0.8" />
      <rect x="18" y="56" width="70" height="3" rx="1.5" fill={color.text.muted} opacity="0.7" />
      <rect x="18" y="64" width="44" height="3" rx="1.5" fill={color.text.muted} opacity="0.7" />
      <rect x="18" y="77" width="44" height="13" rx={Math.min(radius, 6)} fill={color.accent.base} />
      <rect x="66" y="77" width="28" height="13" rx={Math.min(radius, 6)} fill="none" stroke={color.border.strong} strokeWidth="0.8" />
      {[color.semantic.success, color.semantic.warning, color.semantic.danger].map((fill, index) => (
        <circle key={fill + index} cx={80 + index * 8} cy="20" r="2.6" fill={fill} />
      ))}
    </svg>
  );
}
