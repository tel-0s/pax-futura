/**
 * Client twin of the council's *naming* half — keep in sync with
 * `packages/engine/src/conversations/council.ts`. The client cannot import the
 * engine (dependency direction), and there is no endpoint that hands out
 * minister names, so the ~20 lines of seeded hashing live on both sides.
 *
 * The duplication is safe by construction: the client only ever chooses a
 * conversation *title*, and the engine derives the persona by parsing the role
 * word out of that title. If these lists ever drift, players see a different
 * flavour name — never a wrong or missing minister.
 */

export const COUNCIL_ROLES = ["chancellor", "marshal", "spymaster"] as const;
export type CouncilRole = (typeof COUNCIL_ROLES)[number];

export interface CouncilMember {
  role: CouncilRole;
  label: string;
  name: string;
  /** "<Label> <Name>" — sent as the conversation title. */
  title: string;
  /** One sentence of temperament; the menu's epithet. */
  personaHint: string;
}

const COUNCIL_NAMES = {
  medieval: ["Aldric", "Berengar", "Corvin", "Dietrich", "Eudo", "Faramond", "Godric", "Ivo"],
  industrial: ["Ansel", "Bertrand", "Casimir", "Dorothea", "Emmerich", "Fenwick", "Gustave", "Helene"],
  modern: ["Adeyemi", "Brandt", "Costa", "Dunbar", "Espinoza", "Fischer", "Grenville", "Halloran"],
} as const;
export type CouncilEra = keyof typeof COUNCIL_NAMES;

const PERSONA_HINTS: Record<CouncilRole, string> = {
  chancellor: "a cautious steward of the treasury and the law",
  marshal: "a blunt soldier who counts divisions, not promises",
  spymaster: "a quiet collector of secrets who trusts no court",
};

/** FNV-1a over the seed; keep byte-identical to the engine twin. */
export const seededIndex = (seed: string, modulo: number): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % modulo;
};

export const councilEra = (startDate: string): CouncilEra => {
  const year = Number.parseInt(startDate.slice(0, 4), 10);
  if (!Number.isFinite(year)) return "modern";
  if (year < 1500) return "medieval";
  if (year < 1900) return "industrial";
  return "modern";
};

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export const council = (seed: string, startDate: string): CouncilMember[] => {
  const names = COUNCIL_NAMES[councilEra(startDate)];
  const taken = new Set<string>();
  return COUNCIL_ROLES.map((role) => {
    let index = seededIndex(`${seed}:${role}`, names.length);
    while (taken.has(names[index]!)) index = (index + 1) % names.length;
    const name = names[index]!;
    taken.add(name);
    return {
      role,
      label: capitalise(role),
      name,
      title: `${capitalise(role)} ${name}`,
      personaHint: PERSONA_HINTS[role],
    };
  });
};

/** True for any conversation title the engine would read as a minister. */
export const isCouncilTitle = (title: string): boolean => {
  const head = (title.trim().split(/\s+/)[0] ?? "").toLowerCase();
  return COUNCIL_ROLES.some((role) => role === head);
};
