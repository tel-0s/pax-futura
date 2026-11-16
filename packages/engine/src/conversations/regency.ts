/**
 * THE REGENCY DRAFT — what the council does when Advance Time meets an empty
 * orders field and the game's regency mode asks for a draft.
 *
 * Two depths:
 * - joint:   one sitting. A single call returns each minister's stance and
 *            the council's agreed draft.
 * - chamber: each minister argues in their own persona, in sequence, with
 *            the session so far in view — so they can genuinely fight — and
 *            a final synthesis turns the session into one draft. One call
 *            per minister plus the synthesis.
 *
 * Either way, what each minister has actually discussed with the leader
 * (their conversation thread at this node) is in view: counsel given in
 * letters feeds the draft, which is the whole point — correspondence
 * produces drafts, drafts meet the field, the field is the world.
 *
 * The output rides the same ORDERS PROPOSAL: contract the advisor chat
 * uses, parsed by the same tested splitter. Prompt contract, not structured
 * output, for the same reason as chat: prose in, prose out, no grammar
 * budget to blow.
 */
import type { CouncilDraft, CouncilStance, Message, Rollup, WorldState } from "@pax/domain";
import type { LlmRequest, SystemBlock } from "@pax/providers";
import type { GameRow } from "../ports.ts";
import { ConflictError, NotFoundError } from "../loom/tree.ts";
import { psycheFragment } from "../facts/digest.ts";
import { splitProposedOrders, type ChatDeps } from "./chat.ts";
import { council, councilPersona, parseCouncilTitle, type CouncilMember } from "./council.ts";

/** How many recent exchanges of each minister's thread the session sees. */
const THREAD_WINDOW = 8;

export const draftCouncilOrders = async (
  deps: ChatDeps,
  params: { nodeId: string; depth: "joint" | "chamber"; signal?: AbortSignal },
): Promise<CouncilDraft> => {
  const { store } = deps;
  const node = store.getNode(params.nodeId);
  if (!node?.worldBlobHash) throw new NotFoundError(`Unknown node: ${params.nodeId}`);
  const world = store.getWorld(node.worldBlobHash);
  const game = store.getGame();

  // Ministers are seeded by the ROOT node id (council.ts's own rule: import
  // re-keys gameIds; a campaign keeps its cast). Walk up — the loom is
  // shallow in the dimension that matters, one hop per turn taken.
  let rootId = params.nodeId;
  for (
    let cursor: typeof node | null = node;
    cursor?.parentId;
    cursor = store.getNode(cursor.parentId)
  ) {
    rootId = cursor.parentId;
  }
  const rootDate = store.getNode(rootId)?.gameDate ?? node.gameDate;
  const members = council(rootId, rootDate);

  const playerName = world.polities[game.playerPolity]?.name ?? game.playerPolity;
  const context = buildContext({
    world,
    game,
    nodeDate: node.gameDate,
    psyches: store.getRollup(params.nodeId)?.psyches ?? {},
  });
  const discussed = discussedByRole(deps, params.nodeId, members);
  const session: SessionParams = {
    members,
    context,
    discussed,
    nodeDate: node.gameDate,
    playerName,
    signal: params.signal,
  };

  return params.depth === "chamber" ? chamberSession(deps, session) : jointSession(deps, session);
};

/** One sitting: stance lines plus the agreed draft, from a single call. */
const jointSession = async (
  deps: ChatDeps,
  params: SessionParams,
): Promise<CouncilDraft> => {
  const { members, context, discussed, nodeDate } = params;
  const persona: SystemBlock = {
    cacheable: true,
    text: [
      `You are the council in session: ${members.map((member) => `${member.title} (${member.personaHint})`).join("; ")}.`,
      "The three of you rarely agree, and the record should show it: real positions, not one balanced briefing three times.",
      "The leader has given no orders. The council must put forward the orders it would have given.",
      `Write each minister's position as a line beginning with their title (for example "${members[0]?.title}: …"), one or two sentences each, disagreements intact.`,
      "Then end with a line reading exactly ORDERS PROPOSAL: followed by the orders the council as a body puts forward — imperative, one to three sentences, no commentary. If a real dissent survives the session, note it inside a minister's line, never inside the orders.",
      "Stay in character; never mention being an AI or a game.",
    ].join(" "),
  };
  const request: LlmRequest = {
    system: [persona, context],
    messages: [
      {
        role: "user",
        text: [
          `Date: ${nodeDate}. The council sits; the leader's orders field is empty.`,
          discussedBlock(discussed),
          "The session, then the proposal.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    taskLabel: "councilDraft",
  };
  const text = await run(deps, request, params.signal);
  const { prose, proposedOrders } = splitProposedOrders(text);
  if (!proposedOrders) {
    throw new ConflictError("The council adjourned without a draft — advance again to reconvene.");
  }
  return { draft: proposedOrders, stances: parseStances(prose, members) };
};

/**
 * The chamber: ministers speak in a fixed order with the session so far in
 * view, so the marshal can tear into the chancellor's caution and be torn
 * into in turn; a clerk's synthesis closes the session into one draft.
 */
const chamberSession = async (
  deps: ChatDeps,
  params: SessionParams,
): Promise<CouncilDraft> => {
  const { members, context, discussed, nodeDate } = params;
  const stances: CouncilStance[] = [];
  for (const member of members) {
    const sessionSoFar = stances
      .map((stance) => `${stance.title}: ${stance.position}`)
      .join("\n");
    const request: LlmRequest = {
      system: [{ cacheable: true, text: councilPersona(member, params.playerName) }, context],
      messages: [
        {
          role: "user",
          text: [
            `Date: ${nodeDate}. The leader has given no orders; the council sits to draft them.`,
            discussed.get(member.role) ? `What you and the leader have discussed lately:\n${discussed.get(member.role)}` : "",
            sessionSoFar ? `The session so far:\n${sessionSoFar}` : "You speak first.",
            "State your position in two to four sentences: what the realm should do now, and why. Where a colleague's counsel fails on your ground, say so bluntly.",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      taskLabel: "councilStance",
    };
    const text = await run(deps, request, params.signal);
    stances.push({ role: member.role, title: member.title, position: text.trim() });
  }

  const synthesis: LlmRequest = {
    system: [
      {
        cacheable: true,
        text: "You are the council's clerk. You record what the council agreed and turn it into the orders the council as a body puts forward. You add nothing of your own: where the ministers agree, the orders say so; where one minister plainly prevailed, the orders follow the prevailing argument; a dissent that nothing resolved is left out of the orders, not split down the middle.",
      },
      context,
    ],
    messages: [
      {
        role: "user",
        text: [
          `Date: ${nodeDate}. The session's record:`,
          stances.map((stance) => `${stance.title}: ${stance.position}`).join("\n\n"),
          "Close the session: end with a line reading exactly ORDERS PROPOSAL: followed by the orders — imperative, one to three sentences, no commentary.",
        ].join("\n\n"),
      },
    ],
    taskLabel: "councilDraft",
  };
  const text = await run(deps, synthesis, params.signal);
  const { proposedOrders } = splitProposedOrders(text);
  if (!proposedOrders) {
    throw new ConflictError("The council adjourned without a draft — advance again to reconvene.");
  }
  return { draft: proposedOrders, stances };
};

interface SessionParams {
  members: CouncilMember[];
  context: SystemBlock;
  discussed: Map<string, string>;
  nodeDate: string;
  playerName: string;
  signal?: AbortSignal | undefined;
}

/** The same situational tier the advisor chat briefs from. */
const buildContext = (params: {
  world: WorldState;
  game: GameRow;
  nodeDate: string;
  psyches: Rollup["psyches"];
}): SystemBlock => {
  const { world, game, psyches } = params;
  const foreignCourts = Object.entries(psyches)
    .filter(([code]) => code !== game.playerPolity && Object.hasOwn(world.polities, code))
    .map(([code, sheet]) => {
      const fragment = psycheFragment(sheet);
      const name = world.polities[code]?.name || code;
      return fragment ? `${name} [${code}] — ${fragment}` : "";
    })
    .filter(Boolean);
  const playerName = world.polities[game.playerPolity]?.name ?? game.playerPolity;
  return {
    text: [
      `You serve the leader of ${playerName}.`,
      `Nations: ${Object.values(world.polities)
        .map((polity) => `${polity.name || polity.code} [${polity.code}]${polity.tags.length > 0 ? ` (${polity.tags.join(", ")})` : ""}${polity.reputation !== null ? ` rep ${polity.reputation}` : ""}`)
        .join("; ")}.`,
      foreignCourts.length > 0 ? `Foreign courts: ${foreignCourts.join(" | ")}.` : "",
      world.simulationRules ? `Scenario notes: ${world.simulationRules}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
};

/**
 * Each minister's recent exchanges with the leader, keyed by role — the
 * letters feeding the field. A minister never summoned simply has nothing
 * in view, which is itself in character.
 */
const discussedByRole = (
  deps: ChatDeps,
  nodeId: string,
  members: CouncilMember[],
): Map<string, string> => {
  const { store } = deps;
  const out = new Map<string, string>();
  for (const entry of store.conversationsAtNode(nodeId)) {
    if (!entry.headMessageId) continue;
    const conversation = store.getConversation(entry.id);
    if (!conversation || conversation.kind !== "advisor") continue;
    const minister = parseCouncilTitle(conversation.title);
    if (!minister || !members.some((member) => member.role === minister.role)) continue;
    const path = store.messagePath(entry.headMessageId).slice(-THREAD_WINDOW);
    const lines = path
      .filter((message: Message) => message.role !== "system")
      .map(
        (message: Message) =>
          `${message.role === "user" ? "The leader" : minister.title}: ${message.content}`,
      );
    if (lines.length > 0) out.set(minister.role, lines.join("\n"));
  }
  return out;
};

const discussedBlock = (discussed: Map<string, string>): string => {
  if (discussed.size === 0) return "";
  const parts = [...discussed.entries()].map(
    ([, thread]) => thread,
  );
  return `What the ministers have discussed with the leader lately:\n${parts.join("\n---\n")}`;
};

/** Non-streaming use of the streaming client: drain, then take the final text. */
const run = async (deps: ChatDeps, request: LlmRequest, signal?: AbortSignal): Promise<string> => {
  const stream = deps.llm.stream({ ...request, ...(signal ? { signal } : {}) }, deps.binding);
  for await (const event of stream.events) void event;
  const result = await stream.final();
  if (result.stopReason === "aborted") throw new ConflictError("Council session cancelled");
  return result.text;
};

/** Stance lines out of a joint session's prose: lines led by a known title. */
const parseStances = (prose: string, members: CouncilMember[]): CouncilStance[] => {
  const stances: CouncilStance[] = [];
  for (const line of prose.split("\n")) {
    const trimmed = line.trim().replace(/^[*_-]+\s*/, "").replace(/[*_]+/g, "");
    for (const member of members) {
      const prefixes = [`${member.title}:`, `${member.label}:`];
      const hit = prefixes.find((prefix) => trimmed.toLowerCase().startsWith(prefix.toLowerCase()));
      if (hit) {
        stances.push({
          role: member.role,
          title: member.title,
          position: trimmed.slice(hit.length).trim(),
        });
        break;
      }
    }
  }
  return stances;
};

