import type { Unit, UnitStatus } from "@pax/domain";

/** One glyph per unit type — shared by the map chips and the Forces drawer. */
export const UNIT_GLYPHS: Record<Unit["type"], string> = {
  infantry: "🪖",
  armor: "🛡",
  air: "✈",
  naval: "⚓",
  artillery: "💣",
  garrison: "🏰",
};

export const unitGlyph = (type: Unit["type"]): string => UNIT_GLYPHS[type] ?? "⚔";

/** Status → semantic token suffix (engaged reads as danger, pending as warning). */
export const UNIT_STATUS_TONE: Record<UnitStatus, "neutral" | "warning" | "danger"> = {
  idle: "neutral",
  moving: "warning",
  engaged: "danger",
  pending: "warning",
  defeated: "danger",
};
