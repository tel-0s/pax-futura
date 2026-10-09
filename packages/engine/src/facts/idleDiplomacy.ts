import { emptyRollup, pairKey, type Conversation, type Fact, type PsycheSheet, type Rollup, type WorldState } from "@pax/domain";
import type { LlmRequest } from "@pax/providers";
import { openConversation } from "../conversations/chat.ts";
import type { GameRow, NodeRow } from "../ports.ts";
import type { ExtractionDeps } from "./extract.ts";

/** Roughly every other qualifying turn actually produces a knock at the door. */
const CONTACT_CHANCE_PCT = 50;
/** How strong a standing relationship must be before it justifies a call. */
const RELATION_THRESHOLD = 2;

export interface ContactTrigger {
  /** The nation that would reach out. */
  code: string;
  /** One clause, handed to the prompt verbatim: why they are calling now. */
  reason: string;
  /** Lower sorts first — the most urgent reason wins the single slot. */
  priority: number;
}

/**
 * The probability gate, as a pure function of the node id. The engine must stay
 * deterministic under test (and a regenerated sibling must not re-roll its
 * ancestors' contacts), so this is a hash of the node's ULID rather than
 * Math.random: the same node always decides the same way, forever.
 */
export const contactGateOpen = (nodeId: string): boolean =>
  hash32(`idle-diplomacy:${nodeId}`) % 100 < CONTACT_CHANCE_PCT;

/** FNV-1a, 32-bit — small, dependency-free, well spread over ULIDs. */
const hash32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
};

/**
 * Every reason a foreign nation might have to open a channel with the player
 * this turn, best reason first. Pure: turn facts plus the node's folded rollup.
 * Silence is the default — a turn where nothing touched the player produces
 * nothing, which is what keeps unprompted contact meaningful.
 */
export const detectTriggers = (params: {
  player: string;
  facts: readonly Fact[];
  rollup: Rollup;
  gameDate: string;
}): ContactTrigger[] => {
  const { player, facts, rollup, gameDate } = params;
  const found: ContactTrigger[] = [];
  const add = (code: string, reason: string, priority: number): void => {
    if (code && code !== player) found.push({ code, reason, priority });
  };

  for (const fact of facts) {
    switch (fact.type) {
      case "war_started":
        if (fact.attacker === player) add(fact.defender, `they are now at war with you over ${fact.cause}`, 0);
        else if (fact.defender === player) add(fact.attacker, `they went to war with you over ${fact.cause}`, 0);
        break;
      case "war_ended":
        if (fact.parties.includes(player)) {
          for (const party of fact.parties) add(party, `the war between you just ended in ${fact.outcome}`, 1);
        }
        break;
      case "treaty_broken":
        if (fact.parties.includes(player)) {
          for (const party of fact.parties) add(party, `the treaty "${fact.name}" was broken by ${fact.byWhom}`, 1);
        }
        break;
      case "treaty_signed":
        if (fact.parties.includes(player)) {
          for (const party of fact.parties) add(party, `you and they signed "${fact.name}" (${fact.kind}): ${fact.terms}`, 3);
        }
        break;
      case "commitment":
        if (fact.from === player) add(fact.to, `you ${statusClause(fact.status)} your promise to them — ${fact.what}`, 2);
        else if (fact.to === player) add(fact.from, `they ${statusClause(fact.status)} their promise to you — ${fact.what}`, 2);
        break;
      case "relationship_shift": {
        if (!fact.pair.includes(player)) break;
        const other = fact.pair[0] === player ? fact.pair[1] : fact.pair[0];
        // The shift is what makes it news; the standing score is what makes it
        // worth a call. A drift back through neutral is nobody's business.
        const score = rollup.relations[pairKey(player, other)]?.score ?? fact.delta;
        if (Math.abs(score) < RELATION_THRESHOLD) break;
        add(other, `relations with you moved ${signed(fact.delta)} to a standing ${signed(score)} (${fact.reason})`, 1);
        break;
      }
      default:
        break;
    }
  }

  // An open promise whose deadline has arrived is a reason to call on any turn,
  // whether or not this turn's events mentioned it at all.
  for (const commitment of rollup.openCommitments) {
    if (!isDue(commitment.deadline, gameDate)) continue;
    if (commitment.from === player) {
      add(commitment.to, `your promise to them — ${commitment.what} — came due on ${commitment.deadline}`, 1);
    } else if (commitment.to === player) {
      add(commitment.from, `their promise to you — ${commitment.what} — came due on ${commitment.deadline}`, 1);
    }
  }

  return bestPerNation(found);
};

const statusClause = (status: "made" | "fulfilled" | "broken" | "withdrawn"): string =>
  status === "made" ? "gave" : status === "fulfilled" ? "kept" : status === "broken" ? "broke" : "withdrew";

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

/** ISO deadlines only — "next spring" is not something we can compare. */
const isDue = (deadline: string, gameDate: string): boolean =>
  /^\d{4}-\d{2}-\d{2}/.test(deadline) && deadline.slice(0, 10) <= gameDate.slice(0, 10);

/** One trigger per nation (its most urgent), in a stable order. */
const bestPerNation = (triggers: readonly ContactTrigger[]): ContactTrigger[] => {
  const best = new Map<string, ContactTrigger>();
  for (const trigger of triggers) {
    const current = best.get(trigger.code);
    if (!current || trigger.priority < current.priority) best.set(trigger.code, trigger);
  }
  return [...best.values()].sort(
    (a, b) => a.priority - b.priority || a.code.localeCompare(b.code),
  );
};

/**
 * Idle diplomacy: after extraction, at most ONE nation may open a channel at
 * the player unprompted. It fires only when this turn gave someone a reason
 * (detectTriggers) and only when the node's own gate is open, so most turns
 * stay quiet. Never throws — an unanswered knock must never fail extraction.
 * Returns the conversation it opened, or null if nobody called.
 */
export const maybeInitiateContact = async (
  deps: ExtractionDeps,
  nodeId: string,
): Promise<Conversation | null> => {
  const { store, emit } = deps;
  try {
    const node = store.getNode(nodeId);
    if (!node || node.status !== "complete" || !node.worldBlobHash) return null;
    if (!contactGateOpen(nodeId)) return null;

    const game = store.getGame();
    const rollup = store.getRollup(nodeId) ?? emptyRollup();
    const triggers = detectTriggers({
      player: game.playerPolity,
      facts: store.listFactsForNode(nodeId),
      rollup,
      gameDate: node.gameDate,
    });
    if (triggers.length === 0) return null;

    const world = store.getWorld(node.worldBlobHash);
    const channels = store
      .conversationsAtNode(nodeId)
      .filter((conversation) => conversation.kind === "diplomacy");
    // One knock per turn, for good: extraction can be re-run on a node, and a
    // second pass must not stack a second overture onto the same date.
    const alreadyCalled = channels.some(
      (conversation) =>
        conversation.originNodeId === nodeId &&
        store
          .listMessages(conversation.id)
          .some((message) => message.authoredNodeId === nodeId && message.meta.initiated === true),
    );
    if (alreadyCalled) return null;
    // A channel already visible here (opened by the player, by an earlier
    // contact, or inherited from an ancestor) is where they would speak.
    const engaged = new Set(channels.flatMap((conversation) => conversation.participants));
    const trigger = triggers.find(
      (candidate) => Object.hasOwn(world.polities, candidate.code) && !engaged.has(candidate.code),
    );
    if (!trigger) return null;

    const request = buildOpeningRequest({ world, game, node, trigger, rollup });
    const result = await deps.llm.stream(request, deps.binding).final();
    const content = result.text.trim();
    // An empty opening is no opening: leave no orphan channel behind.
    if (!content) return null;

    const conversation = store.transaction(() => {
      const opened = openConversation(store, {
        nodeId,
        kind: "diplomacy",
        title: polityName(world, trigger.code),
        participants: [trigger.code],
      });
      const message = store.insertMessage({
        conversationId: opened.id,
        parentMessageId: null,
        role: "assistant",
        // Same speaker convention as chat.ts: the counterpart's polity code.
        speaker: trigger.code,
        content,
        authoredNodeId: nodeId,
        meta: { model: result.model, initiated: true, trigger: trigger.reason },
      });
      store.setConversationHead(nodeId, opened.id, message.id);
      return { opened, messageId: message.id };
    });

    // message.completed is the signal the client already refetches on: it
    // reloads that conversation's tree AND the node's conversation list, which
    // is how the brand-new channel appears. No facts changed, so no facts
    // signal — the badge lives on this one.
    emit({
      type: "message.completed",
      conversationId: conversation.opened.id,
      messageId: conversation.messageId,
    });
    return conversation.opened;
  } catch (error) {
    console.warn(`Idle diplomacy failed for node ${nodeId}:`, error);
    return null;
  }
};

const buildOpeningRequest = (params: {
  world: WorldState;
  game: GameRow;
  node: NodeRow;
  trigger: ContactTrigger;
  rollup: Rollup;
}): LlmRequest => {
  const { world, game, node, trigger, rollup } = params;
  const counterpart = polityName(world, trigger.code);
  const playerName = polityName(world, game.playerPolity);
  const sheet = rollup.psyches[trigger.code];

  return {
    system: [
      {
        // Disposition and the trigger both move every turn — a cache
        // breakpoint here would only ever pay for writes nothing reads back.
        text: `You are roleplaying the leader of ${counterpart} [${trigger.code}] in a grand-strategy simulation. You are OPENING a channel to the leader of ${playerName}: they did not summon you, you called them. Make the reason for the call unmistakable from the first line, and pursue your nation's interests — press, warn, offer, or court, as your position dictates. Two to five sentences. No salutation boilerplate, no stage directions, no meta-commentary. Stay in character; never mention being an AI or a game.${sheet ? disposition(sheet, playerName) : ""}`,
      },
      {
        text: [
          `Date: ${node.gameDate}.`,
          `Why you are calling ${playerName} now: ${trigger.reason}.`,
          `Nations: ${Object.values(world.polities)
            .map((polity) => `${polity.name || polity.code} [${polity.code}]`)
            .join("; ")}.`,
          world.simulationRules ? `Scenario notes: ${world.simulationRules}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    messages: [
      {
        role: "user",
        text: `Open the channel now. This is your first message and ${playerName} has not spoken yet.`,
      },
    ],
    taskLabel: "idleDiplomacy",
  };
};

/** The counterpart's psyche as second-person character direction. */
const disposition = (sheet: PsycheSheet, playerName: string): string => {
  const clauses = [
    sheet.temperament ? `You are ${sheet.temperament}.` : "",
    sheet.ambitions.length > 0 ? `You want: ${sheet.ambitions.join("; ")}.` : "",
    sheet.grudges.length > 0 ? `You hold these grudges: ${sheet.grudges.join("; ")}.` : "",
    `Your disposition toward ${playerName} is ${signed(sheet.opinionOfPlayer)} on a -3 to +3 scale${sheet.opinionReason ? `, because ${sheet.opinionReason}` : ""}. Let it colour your tone without stating it outright.`,
  ].filter(Boolean);
  return `\n\n${clauses.join(" ")}`;
};

const polityName = (world: WorldState, code: string): string => world.polities[code]?.name || code;
