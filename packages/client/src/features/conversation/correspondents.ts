import { useMemo } from "react";
import type { Conversation, Polity, Theme, WorldState } from "@pax/domain";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";
import { buildPolityPalette } from "../../theme/palette.ts";
import { COUNCIL_ROLES, type CouncilMember, type CouncilRole } from "./council.ts";

/** Which seal a non-foreign correspondent carries. */
export type SealRole = CouncilRole | "advisor";

/**
 * Who sits on the other side of a channel — the one description the cast,
 * the letter heads, the stream lane and the composer all draw from, so a
 * minister is named and sealed identically everywhere.
 */
export interface Correspondent {
  kind: "council" | "advisor" | "envoy";
  /** Short name for tight spots: "Aldric", "Advisor", "Kingdom of England". */
  name: string;
  /** How a letter is signed: "Chancellor Aldric", "Advisor", "Kingdom of England". */
  fullName: string;
  /** Office under the cast name: "Chancellor", "Chief of staff", "Envoy · ENG". */
  office: string;
  /** Line under the letter signature: the minister's portfolio, else the office. */
  role: string;
  /** One line of temperament or identity, for tooltips and the letterhead. */
  hint: string;
  /** Council/advisor seal; null for foreign envoys (they carry a flag). */
  seal: SealRole | null;
  /** Ring legend on large seals ("CHANCELLOR · ALDRIC"). */
  legend: string;
  /** Envoy's polity code, flag and palette color. */
  code: string | null;
  flag: string;
  color: string | undefined;
}

const PORTFOLIO: Record<CouncilRole, string> = {
  chancellor: "Treasury & law",
  marshal: "War & arms",
  spymaster: "Secrets & intelligence",
};

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const isRole = (word: string): word is CouncilRole =>
  (COUNCIL_ROLES as readonly string[]).includes(word);

export const describeConversation = (
  conversation: Pick<Conversation, "kind" | "title" | "participants">,
  members: readonly CouncilMember[],
  polities: Readonly<Record<string, Polity>> | undefined,
  palette: Readonly<Record<string, string>>,
): Correspondent => {
  const base = { code: null, flag: "", color: undefined };
  if (conversation.kind === "advisor") {
    // Same parse as the engine: the first word alone selects the minister.
    const words = conversation.title.trim().split(/\s+/);
    const roleWord = (words[0] ?? "").toLowerCase();
    if (isRole(roleWord)) {
      const label = capitalise(roleWord);
      const name = words.slice(1).join(" ") || label;
      const member = members.find((entry) => entry.role === roleWord);
      return {
        ...base,
        kind: "council",
        name,
        fullName: conversation.title.trim(),
        office: label,
        role: PORTFOLIO[roleWord],
        hint: member?.personaHint ?? "",
        seal: roleWord,
        legend: `${label} · ${name}`.toUpperCase(),
      };
    }
    return {
      ...base,
      kind: "advisor",
      name: conversation.title,
      fullName: conversation.title,
      office: "Chief of staff",
      role: "Chief of staff",
      hint: "your unaligned chief of staff",
      seal: "advisor",
      legend: `${conversation.title} · Chief of staff`.toUpperCase(),
    };
  }
  const code = conversation.participants[0] ?? null;
  const polity = code ? polities?.[code] : undefined;
  const name = polity?.name || conversation.title;
  return {
    kind: "envoy",
    name,
    fullName: name,
    office: code ? `Envoy · ${code}` : "Envoy",
    role: code ? `Envoy · ${code}` : "Envoy",
    hint: polity?.tags.join(" · ") ?? "",
    seal: null,
    legend: "",
    code,
    flag: polity?.flag ?? "",
    color: code ? palette[code] : undefined,
  };
};

/**
 * Everything that can change how a correspondent renders, as one string —
 * the memo key that keeps a correspondent object referentially stable across
 * list refreshes (every completed reply refetches the list, and a new object
 * would re-render, and re-parse, every memoized letter in the thread).
 */
export const correspondentSignature = (who: Correspondent | null | undefined): string =>
  who
    ? [who.kind, who.fullName, who.office, who.role, who.hint, who.seal, who.legend, who.code, who.color, who.flag].join("|")
    : "";

/** Palettes are pure in (theme, world); share one per pair across the drawer. */
const paletteCache = new WeakMap<WorldState, WeakMap<Theme, Record<string, string>>>();

const paletteFor = (theme: Theme, world: WorldState): Record<string, string> => {
  let byTheme = paletteCache.get(world);
  if (!byTheme) {
    byTheme = new WeakMap();
    paletteCache.set(world, byTheme);
  }
  let palette = byTheme.get(theme);
  if (!palette) {
    palette = buildPolityPalette(theme, world);
    byTheme.set(theme, palette);
  }
  return palette;
};

const NO_PALETTE: Record<string, string> = {};

/** The checked-out world plus its theme palette (the map's own colors). */
export const usePolityPalette = (): { world: WorldState | null; palette: Record<string, string> } => {
  const world = useWorldStore((state) => state.world);
  const themeId = useUiStore((state) => state.themeId);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));
  const palette = useMemo(() => (world ? paletteFor(theme, world) : NO_PALETTE), [theme, world]);
  return { world, palette };
};
