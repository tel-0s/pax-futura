import {
  newId,
  type Conversation,
  type Message,
  type PsycheSheet,
  type Rollup,
  type WorldState,
} from "@pax/domain";
import type { ChatTurn, LlmClient, LlmRequest, ModelBinding, SystemBlock } from "@pax/providers";
import type { GameRow, SavePort } from "../ports.ts";
import type { Emit } from "../loom/tree.ts";
import { ConflictError, NotFoundError } from "../loom/tree.ts";
import { psycheFragment } from "../facts/digest.ts";
import { councilPersona, parseCouncilTitle } from "./council.ts";

export interface ChatDeps {
  store: SavePort;
  llm: LlmClient;
  binding: ModelBinding;
  emit: Emit;
}

export const openConversation = (
  store: SavePort,
  params: { nodeId: string; kind: "advisor" | "diplomacy"; title?: string; participants?: string[] },
): Conversation => {
  const node = store.getNode(params.nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${params.nodeId}`);
  const participants = params.participants ?? [];
  const title =
    params.title ?? (params.kind === "advisor" ? "Advisor" : participants.join(", ") || "Diplomacy");
  return store.createConversation({ kind: params.kind, title, participants, nodeId: params.nodeId });
};

/**
 * Send a user message and stream the reply. The user message's parent is the
 * node's current head (or an explicit parent for edit-and-fork); the reply
 * becomes the node's new head. Message rows are immutable — regeneration and
 * forking only ever add siblings.
 */
export const sendChatMessage = async (
  deps: ChatDeps,
  params: {
    nodeId: string;
    conversationId: string;
    text: string;
    /** Fork point override (edit-and-fork); defaults to the node's head. */
    parentMessageId?: string | null;
    signal?: AbortSignal;
  },
): Promise<{ userMessage: Message; assistantMessage: Message }> => {
  const { store } = deps;
  const conversation = store.getConversation(params.conversationId);
  if (!conversation) throw new NotFoundError(`Unknown conversation: ${params.conversationId}`);

  const state = store
    .conversationsAtNode(params.nodeId)
    .find((entry) => entry.id === params.conversationId);
  if (!state) throw new ConflictError("Conversation is not visible at this node");

  const parentId = params.parentMessageId !== undefined ? params.parentMessageId : state.headMessageId;

  const userMessage = store.insertMessage({
    conversationId: conversation.id,
    parentMessageId: parentId,
    role: "user",
    speaker: "",
    content: params.text,
    authoredNodeId: params.nodeId,
    meta: {},
  });

  const assistantMessage = await generateReply(deps, {
    conversation,
    nodeId: params.nodeId,
    parentUserMessageId: userMessage.id,
    ...(params.signal ? { signal: params.signal } : {}),
  });
  return { userMessage, assistantMessage };
};

/** Regenerate an assistant reply as a sibling under the same user message. */
export const regenerateReply = async (
  deps: ChatDeps,
  params: { nodeId: string; conversationId: string; messageId: string; signal?: AbortSignal },
): Promise<Message> => {
  const { store } = deps;
  const conversation = store.getConversation(params.conversationId);
  if (!conversation) throw new NotFoundError(`Unknown conversation: ${params.conversationId}`);
  const messages = store.listMessages(conversation.id);
  const target = messages.find((message) => message.id === params.messageId);
  if (!target) throw new NotFoundError(`Unknown message: ${params.messageId}`);
  if (target.role !== "assistant" || !target.parentMessageId) {
    throw new ConflictError("Only assistant replies can be regenerated");
  }
  return generateReply(deps, {
    conversation,
    nodeId: params.nodeId,
    parentUserMessageId: target.parentMessageId,
    ...(params.signal ? { signal: params.signal } : {}),
  });
};

const generateReply = async (
  deps: ChatDeps,
  params: {
    conversation: Conversation;
    nodeId: string;
    parentUserMessageId: string;
    signal?: AbortSignal;
  },
): Promise<Message> => {
  const { store, llm, binding, emit } = deps;
  const { conversation, nodeId, parentUserMessageId } = params;

  const node = store.getNode(nodeId);
  if (!node?.worldBlobHash) throw new ConflictError("Node has no world snapshot");
  const world = store.getWorld(node.worldBlobHash);
  const game = store.getGame();
  const path = store.messagePath(parentUserMessageId);

  const request = buildChatRequest({
    conversation,
    world,
    game,
    path,
    nodeDate: node.gameDate,
    psyches: store.getRollup(nodeId)?.psyches ?? {},
  });
  const assistantId = newId();

  const stream = llm.stream(
    { ...request, ...(params.signal ? { signal: params.signal } : {}) },
    binding,
  );
  for await (const event of stream.events) {
    if (event.type === "text_delta") {
      emit({
        type: "message.delta",
        conversationId: conversation.id,
        messageId: assistantId,
        delta: event.delta,
      });
    }
  }
  const result = await stream.final();
  if (result.stopReason === "aborted") throw new ConflictError("Reply cancelled");

  // Council ministers sign their own replies; the plain advisor stays "Advisor".
  const speaker =
    conversation.kind === "advisor"
      ? (parseCouncilTitle(conversation.title)?.title ?? "Advisor")
      : conversation.participants[0] ?? "Counterpart";
  const assistantMessage = store.insertMessage({
    id: assistantId,
    conversationId: conversation.id,
    parentMessageId: parentUserMessageId,
    role: "assistant",
    speaker,
    content: result.text || "…",
    authoredNodeId: nodeId,
    meta: { model: result.model },
  });
  store.setConversationHead(nodeId, conversation.id, assistantMessage.id);
  emit({ type: "message.completed", conversationId: conversation.id, messageId: assistantMessage.id });
  return assistantMessage;
};

const buildChatRequest = (params: {
  conversation: Conversation;
  world: WorldState;
  game: GameRow;
  path: Message[];
  nodeDate: string;
  psyches: Rollup["psyches"];
}): LlmRequest => {
  const { conversation, world, game, path, nodeDate, psyches } = params;
  const playerName = world.polities[game.playerPolity]?.name ?? game.playerPolity;

  // The counterpart's own memory: what they want, what they hold against the
  // player, and how warmly they currently regard them.
  const counterpartCode = conversation.participants[0] ?? "";
  const counterpartSheet = counterpartCode ? psyches[counterpartCode] : undefined;
  const disposition =
    conversation.kind === "diplomacy" && counterpartSheet
      ? describeDisposition(counterpartSheet, playerName)
      : "";

  // An advisor conversation titled "<Role> <Name>" is a council minister; the
  // role word alone selects the voice, so the client's flavour names can never
  // break the persona. Anything else (notably the legacy "Advisor" title every
  // existing save has) keeps the original chief-advisor persona verbatim.
  const minister = conversation.kind === "advisor" ? parseCouncilTitle(conversation.title) : null;

  const persona: SystemBlock =
    conversation.kind === "advisor"
      ? {
          cacheable: true,
          text: minister
            ? councilPersona(minister, playerName)
            : `You are the chief strategic advisor to the leader of ${playerName}. Speak plainly and concretely about the situation, risks, and options. You advise; you never decide for the leader. Ground every judgement in the situation provided. Stay in character; never mention being an AI or a game.`,
        }
      : {
          // Disposition moves turn to turn, so a cache breakpoint here would
          // only ever pay for writes it never reads back.
          cacheable: disposition === "",
          text: `You are roleplaying the leader of ${describeCounterpart(world, conversation)} in direct communication with the leader of ${playerName}. Pursue your nation's interests: negotiate, bluff, threaten, or warm relations as your position and ideology dictate. Keep replies conversational in length. Stay in character; never mention being an AI or a game.${disposition}`,
        };

  const foreignCourts =
    conversation.kind === "advisor"
      ? Object.entries(psyches)
          // Psyche entries outlive their polities (absorbed/removed nations
          // are never pruned from the memory map) — brief only living courts.
          .filter(([code]) => code !== game.playerPolity && Object.hasOwn(world.polities, code))
          .map(([code, sheet]) => {
            const fragment = psycheFragment(sheet);
            const name = world.polities[code]?.name || code;
            return fragment ? `${name} [${code}] — ${fragment}` : "";
          })
          .filter(Boolean)
      : [];

  const context: SystemBlock = {
    text: [
      `Date: ${nodeDate}.`,
      `Nations: ${Object.values(world.polities)
        .map((polity) => `${polity.name || polity.code} [${polity.code}]${polity.tags.length > 0 ? ` (${polity.tags.join(", ")})` : ""}${polity.reputation !== null ? ` rep ${polity.reputation}` : ""}`)
        .join("; ")}.`,
      foreignCourts.length > 0 ? `Foreign courts: ${foreignCourts.join(" | ")}.` : "",
      world.simulationRules ? `Scenario notes: ${world.simulationRules}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };

  const messages: ChatTurn[] = path
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: message.content,
    }));

  return {
    system: [persona, context],
    messages,
    taskLabel: conversation.kind === "advisor" ? "advisorChat" : "diplomacyChat",
  };
};

/** The counterpart's psyche as second-person character direction. */
const describeDisposition = (sheet: PsycheSheet, playerName: string): string => {
  const clauses = [
    sheet.temperament ? `You are ${sheet.temperament}.` : "",
    sheet.ambitions.length > 0 ? `You want: ${sheet.ambitions.join("; ")}.` : "",
    sheet.grudges.length > 0 ? `You hold these grudges: ${sheet.grudges.join("; ")}.` : "",
    `Your current disposition toward ${playerName} is ${sheet.opinionOfPlayer > 0 ? "+" : ""}${sheet.opinionOfPlayer} on a -3 to +3 scale${sheet.opinionReason ? `, because ${sheet.opinionReason}` : ""}. Let it colour your tone without stating it outright.`,
  ].filter(Boolean);
  return `\n\n${clauses.join(" ")}`;
};

const describeCounterpart = (world: WorldState, conversation: Conversation): string => {
  const code = conversation.participants[0];
  if (!code) return conversation.title;
  return world.polities[code]?.name ?? code;
};
