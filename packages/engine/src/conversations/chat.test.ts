import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema, type SseEvent } from "@pax/domain";
import { openConversation, regenerateReply, sendChatMessage } from "./chat.ts";
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

const llm = new FakeLlmClient((req) => {
  if (!req.tool) return { deltas: [`Reply ${++replyIndex} to: `, req.messages.at(-1)?.text ?? ""] };
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
