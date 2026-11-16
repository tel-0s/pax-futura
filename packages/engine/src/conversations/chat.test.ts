import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient, type LlmRequest } from "@pax/providers";
import { ScenarioSchema, type SseEvent } from "@pax/domain";
import { openConversation, regenerateReply, sendChatMessage, splitProposedOrders } from "./chat.ts";
import { executeTurn } from "../turn/orchestrator.ts";
import type { SavePort } from "../ports.ts";

const scenario = ScenarioSchema.parse({
  id: "t",
  name: "T",
  startDate: "1936-01-01",
  world: {
    polities: {
      FRA: { code: "FRA", name: "France" },
      DEU: { code: "DEU", name: "Germany" },
    },
  },
});

let dir: string;
let store: SavePort;
let rootId: string;
let events: SseEvent[];
let replyIndex = 0;

let proposalReply: string | null = null;
let lastRequest: LlmRequest | null = null;

const llm = new FakeLlmClient((req) => {
  lastRequest = req;
  if (!req.tool) {
    if (proposalReply !== null) {
      const reply = proposalReply;
      proposalReply = null;
      return { deltas: [reply] };
    }
    return { deltas: [`Reply ${++replyIndex} to: `, req.messages.at(-1)?.text ?? ""] };
  }
  return {
    structured: {
      stopDate: "1936-02-01",
      summary: "turn",
      events: [{ date: "1936-01-15", title: "e", impacts: {} }],
    },
  };
});
const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding, emit: (e: SseEvent) => events.push(e) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-chat-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "T",
    scenarioId: "t",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-01-01",
    world: scenario.world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
  events = [];
  replyIndex = 0;
  proposalReply = null;
  lastRequest = null;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("branching chat", () => {
  it("send -> reply moves the head; regenerate adds a sibling", async () => {
    const conversation = openConversation(store, { nodeId: rootId, kind: "advisor" });
    const { userMessage, assistantMessage } = await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "Should we rearm?",
    });
    expect(assistantMessage.parentMessageId).toBe(userMessage.id);
    expect(assistantMessage.content).toContain("Should we rearm?");

    const state = store.conversationsAtNode(rootId);
    expect(state[0]?.headMessageId).toBe(assistantMessage.id);

    const sibling = await regenerateReply(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      messageId: assistantMessage.id,
    });
    expect(sibling.parentMessageId).toBe(userMessage.id);
    expect(sibling.id).not.toBe(assistantMessage.id);
    expect(store.conversationsAtNode(rootId)[0]?.headMessageId).toBe(sibling.id);
    expect(store.listMessages(conversation.id)).toHaveLength(3);

    // Streaming deltas were emitted with the final message id.
    const deltas = events.filter((e) => e.type === "message.delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "message.completed")).toHaveLength(2);
  });

  it("the head at execution time becomes the child's canon", async () => {
    const conversation = openConversation(store, { nodeId: rootId, kind: "advisor" });
    const { assistantMessage: first } = await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "Plan A?",
    });
    const child = await executeTurn(deps(), {
      parentId: rootId,
      input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    });

    // Child inherited the head as canon.
    expect(store.conversationsAtNode(child.id)[0]?.headMessageId).toBe(first.id);

    // Exploring a different branch on the parent afterwards doesn't touch it.
    await regenerateReply(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      messageId: first.id,
    });
    expect(store.conversationsAtNode(child.id)[0]?.headMessageId).toBe(first.id);
    expect(store.conversationsAtNode(rootId)[0]?.headMessageId).not.toBe(first.id);
  });

  it("edit-and-fork creates a sibling user message", async () => {
    const conversation = openConversation(store, { nodeId: rootId, kind: "advisor" });
    const { userMessage } = await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "Original question",
    });
    await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "Edited question",
      parentMessageId: userMessage.parentMessageId,
    });
    const messages = store.listMessages(conversation.id);
    const userSiblings = messages.filter(
      (message) => message.role === "user" && message.parentMessageId === userMessage.parentMessageId,
    );
    expect(userSiblings).toHaveLength(2);
  });
});

describe("splitProposedOrders", () => {
  it("splits a trailing block and trims both halves", () => {
    const { prose, proposedOrders } = splitProposedOrders(
      "The treasury can bear it, barely.\n\nORDERS PROPOSAL:\nRaise the levy by a tenth and open the northern road.\n",
    );
    expect(prose).toBe("The treasury can bear it, barely.");
    expect(proposedOrders).toBe("Raise the levy by a tenth and open the northern road.");
  });

  it("returns no proposal when there is no marker", () => {
    const { prose, proposedOrders } = splitProposedOrders("Just counsel, no action.");
    expect(prose).toBe("Just counsel, no action.");
    expect(proposedOrders).toBeUndefined();
  });

  it("ignores an inline mention; the marker must hold its own line", () => {
    const text = "As to your ORDERS PROPOSAL: it is unwise.";
    const { prose, proposedOrders } = splitProposedOrders(text);
    expect(prose).toBe(text);
    expect(proposedOrders).toBeUndefined();
  });

  it("takes the last marker when the model repeats it", () => {
    const { prose, proposedOrders } = splitProposedOrders(
      "First thought.\nORDERS PROPOSAL:\ndraft one\nOrders Proposal:\nSecond draft, the real one.",
    );
    expect(prose).toBe("First thought.\nORDERS PROPOSAL:\ndraft one");
    expect(proposedOrders).toBe("Second draft, the real one.");
  });

  it("strips a dangling marker with nothing after it", () => {
    const { prose, proposedOrders } = splitProposedOrders("All quiet.\n\nORDERS PROPOSAL:\n   ");
    expect(prose).toBe("All quiet.");
    expect(proposedOrders).toBeUndefined();
  });

  it("is case-insensitive and tolerates a missing colon", () => {
    const { proposedOrders } = splitProposedOrders("Counsel.\norders proposal\nMarch at dawn.");
    expect(proposedOrders).toBe("March at dawn.");
  });
});

describe("advisor orders proposals", () => {
  it("an advisor reply ending in a block lands in meta.proposedOrders with prose-only content", async () => {
    const conversation = openConversation(store, { nodeId: rootId, kind: "advisor" });
    proposalReply =
      "We should move while the pass is clear.\n\nORDERS PROPOSAL:\nSend the second army through the pass before the thaw.";
    const { assistantMessage } = await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "Can we take the pass?",
    });
    expect(assistantMessage.content).toBe("We should move while the pass is clear.");
    expect(assistantMessage.meta.proposedOrders).toBe(
      "Send the second army through the pass before the thaw.",
    );
  });

  it("a plain advisor reply carries no proposedOrders key", async () => {
    const conversation = openConversation(store, { nodeId: rootId, kind: "advisor" });
    const { assistantMessage } = await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "How fares the harvest?",
    });
    expect("proposedOrders" in assistantMessage.meta).toBe(false);
  });

  it("diplomacy replies are never parsed; a block stays verbatim in the letter", async () => {
    const conversation = openConversation(store, {
      nodeId: rootId,
      kind: "diplomacy",
      participants: ["DEU"],
    });
    proposalReply = "We propose terms.\n\nORDERS PROPOSAL:\nA trick of phrasing, not yours to adopt.";
    const { assistantMessage } = await sendChatMessage(deps(), {
      nodeId: rootId,
      conversationId: conversation.id,
      text: "Terms?",
    });
    expect(assistantMessage.content).toContain("ORDERS PROPOSAL:");
    expect("proposedOrders" in assistantMessage.meta).toBe(false);
  });

  it("advisor personas carry the proposal contract; diplomacy personas do not", async () => {
    const advisor = openConversation(store, { nodeId: rootId, kind: "advisor" });
    await sendChatMessage(deps(), { nodeId: rootId, conversationId: advisor.id, text: "hm?" });
    const advisorSystem = (lastRequest?.system ?? []).map((block) => block.text).join("\n");
    expect(advisorSystem).toContain("ORDERS PROPOSAL:");

    const diplomacy = openConversation(store, {
      nodeId: rootId,
      kind: "diplomacy",
      participants: ["DEU"],
    });
    await sendChatMessage(deps(), { nodeId: rootId, conversationId: diplomacy.id, text: "hm?" });
    const diplomacySystem = (lastRequest?.system ?? []).map((block) => block.text).join("\n");
    expect(diplomacySystem).not.toContain("ORDERS PROPOSAL:");
  });
});
