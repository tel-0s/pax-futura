import {
  Anchor,
  Castle,
  Factory,
  Flag,
  Landmark,
  MapPin,
  Pickaxe,
  Radar,
  Rocket,
  Shield,
  Church,
  Tent,
  TowerControl,
  type LucideIcon,
} from "lucide-react";

/** Structure kinds are free-form; the common ones get a proper mark. */
const ICONS: Record<string, LucideIcon> = {
  base: Shield,
  fort: Castle,
  fortress: Castle,
  castle: Castle,
  port: Anchor,
  harbor: Anchor,
  harbour: Anchor,
  naval: Anchor,
  embassy: Landmark,
  consulate: Landmark,
  capital: Landmark,
  palace: Landmark,
  silo: Rocket,
  launch: Rocket,
  radar: Radar,
  airfield: TowerControl,
  airbase: TowerControl,
  factory: Factory,
  mine: Pickaxe,
  camp: Tent,
  outpost: Flag,
  temple: Church,
  church: Church,
  abbey: Church,
  monastery: Church,
  cathedral: Church,
};

export const structureIcon = (kind: string): LucideIcon => {
  const key = kind.toLowerCase();
  if (ICONS[key]) return ICONS[key]!;
  for (const [word, icon] of Object.entries(ICONS)) if (key.includes(word)) return icon;
  return MapPin;
};
