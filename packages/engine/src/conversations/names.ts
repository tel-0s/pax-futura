/**
 * THE COURT'S NAMES — one utility call per game that asks for given-names
 * fitting the player's polity at the start date, so the Inca court of 1492
 * stops seating Dietrich and Godric. The gazette's pattern throughout: a
 * structured call whose failure is never an error, because the static era
 * lists remain the deterministic floor (offline, fake provider, a refused
 * call). The caller persists a success; a null is simply "use the floor".
 */
import { CouncilNamePoolSchema, toLlmToolSchema } from "@pax/domain";
import type { CouncilNamePool } from "@pax/domain";
import type { LlmRequest } from "@pax/providers";
import type { ChatDeps } from "./chat.ts";

const NAMES_TOOL = toLlmToolSchema(
  "submit_court_names",
  "Eight to twelve court given-names fitting the polity and the era: names its own court would plausibly carry, personal names only (no titles, no epithets, no family names).",
  CouncilNamePoolSchema,
);

/** Distinct usable names, or null when the call can't improve on the floor. */
export const generateCouncilNames = async (
  deps: Pick<ChatDeps, "llm" | "binding">,
  params: { playerName: string; startDate: string; signal?: AbortSignal },
): Promise<string[] | null> => {
  const request: LlmRequest = {
    system: [
      {
        cacheable: true,
        text: "You name the members of a ruler's court for a historical grand-strategy game. Given the polity and the date, return court given-names its own people would plausibly carry — drawn from the polity's own culture and period, not from a generic European stock. Personal names only: no titles, no epithets, no family names, no diacritical guesswork beyond what the culture actually uses.",
      },
    ],
    messages: [
      {
        role: "user",
        text: `Polity: ${params.playerName}. Date: ${params.startDate}. Eight to twelve court given-names.`,
      },
    ],
    tool: NAMES_TOOL,
    taskLabel: "councilNames",
  };
  try {
    const stream = deps.llm.stream(
      { ...request, ...(params.signal ? { signal: params.signal } : {}) },
      deps.binding,
    );
    for await (const event of stream.events) void event;
    const result = await stream.final();
    const structured = result.structured as CouncilNamePool | undefined;
    if (!structured) return null;
    const cleaned = [
      ...new Set(
        structured.names
          .map((name) => name.trim())
          .filter((name) => name.length > 0 && name.length <= 40),
      ),
    ].slice(0, 16);
    // Three ministers need three distinct names; fewer and the floor is better.
    return cleaned.length >= 3 ? cleaned : null;
  } catch {
    return null;
  }
};
