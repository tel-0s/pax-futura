import { describe, expect, it, vi } from "vitest";
import type { ConversationAtNode, Message } from "@pax/domain";
import {
  selectDeepestDescendant,
  selectMessagePath,
  selectMessageSiblings,
  selectSiblingPositions,
  useConversationsStore,
} from "./conversations.ts";

const apiMock = vi.hoisted(() => ({ listConversations: vi.fn() }));
vi.mock("../lib/api.ts", () => ({ api: apiMock }));

const message = (
  id: string,
  parentMessageId: string | null,
  role: Message["role"],
): Message => ({
  id,
  conversationId: "c1",
  parentMessageId,
  role,
  speaker: "",
  content: id,
  authoredNodeId: "n1",
  meta: {},
});

/** u1 -> a1 | a2 (regenerated) -> u2 under a1. */
const tree: Message[] = [
  message("01u1", null, "user"),
  message("02a1", "01u1", "assistant"),
  message("03a2", "01u1", "assistant"),
  message("04u2", "02a1", "user"),
];

describe("conversation selectors", () => {
  it("walks the root -> head path", () => {
    expect(selectMessagePath(tree, "04u2").map((m) => m.id)).toEqual(["01u1", "02a1", "04u2"]);
    expect(selectMessagePath(tree, null)).toEqual([]);
  });

  it("groups siblings by parent and role in ulid order", () => {
    expect(selectMessageSiblings(tree, "03a2").map((m) => m.id)).toEqual(["02a1", "03a2"]);
    expect(selectMessageSiblings(tree, "01u1").map((m) => m.id)).toEqual(["01u1"]);
  });

  it("indexes every message the same way selectMessageSiblings does", () => {
    const positions = selectSiblingPositions(tree);
    for (const entry of tree) {
      const siblings = selectMessageSiblings(tree, entry.id);
      expect(positions.get(entry.id)).toEqual({
        index: siblings.findIndex((sibling) => sibling.id === entry.id),
        count: siblings.length,
      });
    }
  });

  it("follows the newest-child chain to a leaf", () => {
    // Newest child wins at each step, so the regenerated reply (03a2) is the leaf.
    expect(selectDeepestDescendant(tree, "01u1")).toBe("03a2");
    expect(selectDeepestDescendant(tree, "02a1")).toBe("04u2");
  });
});

describe("the desk survives a list refresh", () => {
  const conv = (id: string) => ({ id }) as unknown as ConversationAtNode;

  it("a deliberately null active id stays null (refreshList runs on every message.completed)", async () => {
    useConversationsStore.setState({ activeConversationId: null, list: [] });
    apiMock.listConversations.mockResolvedValue([conv("c1"), conv("c2")]);
    await useConversationsStore.getState().refreshList("g1", "n1");
    expect(useConversationsStore.getState().activeConversationId).toBeNull();
  });

  it("a stale active id falls back to the first conversation", async () => {
    useConversationsStore.setState({ activeConversationId: "gone", list: [] });
    apiMock.listConversations.mockResolvedValue([conv("c1"), conv("c2")]);
    await useConversationsStore.getState().refreshList("g1", "n1");
    expect(useConversationsStore.getState().activeConversationId).toBe("c1");
  });

  it("a live active id is kept", async () => {
    useConversationsStore.setState({ activeConversationId: "c2", list: [] });
    apiMock.listConversations.mockResolvedValue([conv("c1"), conv("c2")]);
    await useConversationsStore.getState().refreshList("g1", "n1");
    expect(useConversationsStore.getState().activeConversationId).toBe("c2");
  });
});
