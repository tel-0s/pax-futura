import { Castle, Crown, Globe, Map as MapIcon, Orbit, Plane, Radar, Ship, Swords, type LucideIcon } from "lucide-react";

export interface Era {
  id: string;
  name: string;
  icon: LucideIcon;
}

/** The preset that best dresses each era (a suggestion — never applied unasked). */
export const ERA_THEME: Record<string, string> = {
  medieval: "parchment",
  discovery: "parchment",
  revolution: "parchment",
  empire: "daylight",
  "world-war": "seraphim",
  "cold-war": "phosphor",
  modern: "command-deck",
  future: "command-deck",
};

/** Coarse historical eras by start year — used to mark campaign and scenario cards. */
const ERAS: Array<{ until: number; era: Era }> = [
  { until: 1450, era: { id: "medieval", name: "Middle Ages", icon: Castle } },
  { until: 1700, era: { id: "discovery", name: "Age of Discovery", icon: Ship } },
  { until: 1850, era: { id: "revolution", name: "Age of Revolutions", icon: Crown } },
  { until: 1919, era: { id: "empire", name: "Age of Empire", icon: Swords } },
  { until: 1946, era: { id: "world-war", name: "World at War", icon: Plane } },
  { until: 1991, era: { id: "cold-war", name: "Cold War", icon: Radar } },
  { until: 2035, era: { id: "modern", name: "Modern Era", icon: Globe } },
  { until: Infinity, era: { id: "future", name: "Near Future", icon: Orbit } },
];

const UNKNOWN: Era = { id: "unknown", name: "Unknown Era", icon: MapIcon };

export const eraOf = (startDate: string | undefined): Era => {
  const year = startDate ? parseInt(startDate, 10) : NaN;
  if (!Number.isFinite(year)) return UNKNOWN;
  return ERAS.find((entry) => year < entry.until)?.era ?? UNKNOWN;
};
