/**
 * THE COUNCIL — three standing ministers derived deterministically from the
 * game id. Nothing is stored and no schema moves: a minister conversation is
 * an ordinary `advisor` conversation whose title is "<Role> <Name>"
 * ("Chancellor Aldric"). `parseCouncilTitle` reads the role back off the title,
 * which is what selects the persona in chat.ts. A conversation still titled
 * plain "Advisor" parses to null and keeps the original single-advisor
 * persona, so every existing save's advisor thread is untouched.
 *
 * The client has a twin of the *naming* half in
 * `client/src/features/conversation/council.ts` (the client cannot import the
 * engine) — keep the two in sync. Only flavour names can ever drift: personas
 * are resolved here from the title the client actually sent.
 */

export const COUNCIL_ROLES = ["chancellor", "marshal", "spymaster"] as const;
export type CouncilRole = (typeof COUNCIL_ROLES)[number];

export interface CouncilMember {
  role: CouncilRole;
  /** Capitalised role word — the title prefix, and what parsing keys on. */
  label: string;
  name: string;
  /** "<Label> <Name>" — the conversation title. */
  title: string;
  /** One sentence of temperament; shown in the UI, folded into the persona. */
  personaHint: string;
}

/** Short, era-flavoured given names. One list per era, shared by all roles. */
export const COUNCIL_NAMES = {
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

/**
 * What each minister privileges — and where they dig in. Ministers disagree by
 * design: the leader is meant to arbitrate between three partial views, not to
 * receive one balanced briefing three times.
 */
const WORLDVIEWS: Record<CouncilRole, string> = {
  chancellor:
    "You weigh every proposal in coin, law, and legitimacy: what it costs, who pays, whether the treasury and the institutions survive it, and how it will read to courts, creditors, and your own population. You distrust schemes that assume revenue not yet collected. When an order would empty the treasury, break a standing obligation, or spend legitimacy the state cannot replace, you say so plainly and name the price before you comply.",
  marshal:
    "You think in formations, supply, terrain, and time: what force actually exists, where it can be by when, and what it eats on the way. You have no patience for intentions, communiqués, or plans that require the enemy to cooperate. When an order asks soldiers to do what soldiers cannot do — or leaves a frontier bare to buy a diplomatic gesture — you object bluntly and in numbers.",
  spymaster:
    "You deal in what is hidden: who is lying, who is bought, what a rival is preparing behind the public position, and which of your own factions is drifting. You prefer leverage to force and patience to either. You state your confidence honestly and distinguish what you know from what you suspect. When an order rests on trusting a foreign promise, or would burn a source or an asset you spent years placing, you push back — quietly, but you push back.",
};

/** FNV-1a over the seed; keep byte-identical to the client twin. */
export const seededIndex = (seed: string, modulo: number): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % modulo;
};

/** Start-year century picks the name flavour. Unparseable dates read modern. */
export const councilEra = (startDate: string): CouncilEra => {
  const year = Number.parseInt(startDate.slice(0, 4), 10);
  if (!Number.isFinite(year)) return "modern";
  if (year < 1500) return "medieval";
  if (year < 1900) return "industrial";
  return "modern";
};

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The three ministers of a game. Pure: same seed and start date, same cast, forever.
 * Seed with the ROOT NODE id, never the gameId — import re-keys gameIds, and
 * an imported campaign must keep its ministers.
 */
export const council = (seed: string, startDate: string): CouncilMember[] => {
  const names = COUNCIL_NAMES[councilEra(startDate)];
  const taken = new Set<string>();
  return COUNCIL_ROLES.map((role) => {
    // Advance on collision so two ministers never share a name; roles are
    // walked in a fixed order, so the resolution is deterministic too.
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

/**
 * Recover a minister from a conversation title. Authoritative for personas:
 * only the leading role word matters, so a client whose name lists have
 * drifted still gets the right voice.
 */
export const parseCouncilTitle = (title: string): CouncilMember | null => {
  const words = title.trim().split(/\s+/);
  const head = (words[0] ?? "").toLowerCase();
  const role = COUNCIL_ROLES.find((candidate) => candidate === head);
  if (!role) return null;
  const name = words.slice(1).join(" ");
  return {
    role,
    label: capitalise(role),
    name,
    title: title.trim(),
    personaHint: PERSONA_HINTS[role],
  };
};

/** The minister's system persona: who they are, what they privilege, how they argue. */
export const councilPersona = (member: CouncilMember, playerName: string): string =>
  [
    `You are ${member.title}, ${member.personaHint}, serving on the council of the leader of ${playerName}.`,
    WORLDVIEWS[member.role],
    "You are one voice of three — Chancellor, Marshal, and Spymaster — and the three of you rarely agree. Do not pretend to hold the balanced view; hold yours, and say where a colleague's counsel would fail on your ground.",
    "Speak plainly and concretely about the situation, risks, and options. You advise; you never decide for the leader. Ground every judgement in the situation provided. Stay in character; never mention being an AI or a game.",
  ].join(" ");
