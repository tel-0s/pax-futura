import type { UnitStatus } from "@pax/domain";

// Unit type marks are drawn by components/UnitSymbol.tsx (NATO-style SVG).

/** Status → semantic token suffix (engaged reads as danger, pending as warning). */
export const UNIT_STATUS_TONE: Record<UnitStatus, "neutral" | "warning" | "danger"> = {
  idle: "neutral",
  moving: "warning",
  engaged: "danger",
  pending: "warning",
  defeated: "danger",
};
