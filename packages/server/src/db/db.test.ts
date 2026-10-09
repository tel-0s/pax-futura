import { describe, expect, it } from "vitest";
import { emptyWorld, newId } from "@pax/domain";
import { openDb } from "./openDb.ts";
import { migrate } from "./migrate.ts";
import { SAVE_MIGRATIONS } from "./saveSchema.ts";
import { createSaveDb, getGame, setActiveNode } from "./saveDb.ts";
import { getJsonBlob, putJsonBlob, collectGarbageBlobs } from "./blobStore.ts";
import {
  completeNode,
  deleteSubtree,
  getNode,
  insertNode,
  listNodeMetas,
  pathToRoot,
  subtreeIds,
} from "./stores/nodes.ts";
import { insertEvents, listEventsForNode } from "./stores/events.ts";
import {
  conversationsAtNode,
  copyHeads,
  createConversation,
  insertMessage,
  messagePath,
  setHead,
} from "./stores/conversations.ts";

const makeSave = () =>
  createSaveDb(":memory:", {
    gameId: newId(),
    title: "Test Game",
    scenarioId: "test",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-01-01",
    world: emptyWorld(),
  });

const addChild = (db: ReturnType<typeof makeSave>["db"], parentId: string, depth: number) => {
  const id = newId();
  insertNode(db, {
    id,
    parentId,
    depth,
    status: "complete",
    gameDate: "1936-02-01",
    input: { actions: [], jumpDays: 30, stopPolicy: "toDate" },
    worldBlobHash: putJsonBlob(db, emptyWorld()),
  });
  return id;
};

describe("migrate", () => {
  it("is idempotent and stamps user_version", () => {
    const db = openDb(":memory:");
    migrate(db, SAVE_MIGRATIONS);
    migrate(db, SAVE_MIGRATIONS);
    const latest = SAVE_MIGRATIONS.at(-1)!.version;
    expect(db.pragma("user_version", { simple: true })).toBe(latest);
  });

  it("upgrades a save stamped at an older version without losing its events", () => {
    const db = openDb(":memory:");
    const older = SAVE_MIGRATIONS.filter((m) => m.version < 4);
    migrate(db, older);
    db.prepare(
      "INSERT INTO timeline_nodes (id, parent_id, depth, status, game_date, input_json, created_at) VALUES ('n1', NULL, 0, 'complete', '1936-01-01', '{}', 0)",
    ).run();
    db.prepare(
      "INSERT INTO events (id, node_id, seq, event_date, title, impacts_json) VALUES ('e1', 'n1', 0, '1936-01-01', 'Legacy', '{}')",
    ).run();

    migrate(db, SAVE_MIGRATIONS);
    expect(db.pragma("user_version", { simple: true })).toBe(SAVE_MIGRATIONS.at(-1)!.version);
    const [legacy] = listEventsForNode(db, "n1");
    expect(legacy?.title).toBe("Legacy");
    expect(legacy).not.toHaveProperty("lng");
  });

  it("refuses a database newer than the code", () => {
    const db = openDb(":memory:");
    db.pragma("user_version = 99");
    expect(() => migrate(db, SAVE_MIGRATIONS)).toThrow(/newer/);
  });
});

describe("events store", () => {
  it("round-trips optional coordinates, omitting the keys when unlocated", () => {
    const { db, rootNodeId } = makeSave();
    const base = {
      date: "1936-02-01",
      description: "",
      kind: "war",
      importance: "major" as const,
      playerRelated: true,
      impacts: { actionIds: [], regionTransfers: [], polityChanges: [], unitOps: [], markerOps: [], createdChats: [] },
    };
    insertEvents(db, rootNodeId, [
      { ...base, title: "Battle of Nowhere", lng: -3.75, lat: 40.5 },
      { ...base, title: "A rumor spreads", kind: "world", importance: "minor", playerRelated: false },
    ]);

    const [located, unlocated] = listEventsForNode(db, rootNodeId);
    expect(located).toMatchObject({ title: "Battle of Nowhere", lng: -3.75, lat: 40.5, kind: "war" });
    expect(unlocated).not.toHaveProperty("lng");
    expect(unlocated).not.toHaveProperty("lat");
  });
});

describe("blob store", () => {
  it("round-trips and dedups by content", () => {
    const { db } = makeSave();
    const value = { hello: "world", n: [1, 2, 3] };
    const h1 = putJsonBlob(db, value);
    const h2 = putJsonBlob(db, { hello: "world", n: [1, 2, 3] });
    expect(h1).toBe(h2);
    expect(getJsonBlob(db, h1)).toEqual(value);
  });
});

describe("save creation", () => {
  it("creates a complete root node and points the game at it", () => {
    const { db, rootNodeId } = makeSave();
    const game = getGame(db);
    expect(game.activeNodeId).toBe(rootNodeId);
    const root = getNode(db, rootNodeId);
    expect(root).toMatchObject({ depth: 0, status: "complete", parentId: null });
    expect(root?.worldBlobHash).toBeTruthy();
  });
});

describe("loom tree primitives", () => {
  it("pathToRoot returns root..node in order", () => {
    const { db, rootNodeId } = makeSave();
    const a = addChild(db, rootNodeId, 1);
    const b = addChild(db, a, 2);
    expect(pathToRoot(db, b).map((n) => n.id)).toEqual([rootNodeId, a, b]);
  });

  it("deleteSubtree cascades and blob GC drops orphaned snapshots", () => {
    const { db, rootNodeId } = makeSave();
    const a = addChild(db, rootNodeId, 1);
    const b = addChild(db, a, 2);
    const sibling = addChild(db, rootNodeId, 1);
    insertEvents(db, b, [
      { date: "1936-02-01", title: "Doomed event", description: "", kind: "world", importance: "minor", playerRelated: false, impacts: { actionIds: [], regionTransfers: [], polityChanges: [], unitOps: [], markerOps: [], createdChats: [] } },
    ]);
    expect(subtreeIds(db, a).sort()).toEqual([a, b].sort());

    deleteSubtree(db, a);
    expect(getNode(db, a)).toBeNull();
    expect(getNode(db, b)).toBeNull();
    expect(getNode(db, sibling)).not.toBeNull();
    expect(listEventsForNode(db, b)).toEqual([]);
    // root + sibling share the empty-world blob; a/b's identical blob survives GC
    // only because it IS the same content-addressed row. Distinct content would go.
    const distinct = addChild(db, sibling, 2);
    completeNode(db, { id: distinct, gameDate: "1936-03-01", summary: "s", worldBlobHash: putJsonBlob(db, { unique: true }) });
    deleteSubtree(db, distinct);
    expect(collectGarbageBlobs(db)).toBeGreaterThan(0);
  });

  it("listNodeMetas carries event and conversation counts", () => {
    const { db, rootNodeId } = makeSave();
    createConversation(db, { kind: "advisor", title: "Advisor", participants: [], originNodeId: rootNodeId, nodeId: rootNodeId });
    const metas = listNodeMetas(db);
    expect(metas).toHaveLength(1);
    expect(metas[0]?.conversationCount).toBe(1);
  });

  it("setActiveNode moves the checkout", () => {
    const { db, rootNodeId } = makeSave();
    const a = addChild(db, rootNodeId, 1);
    setActiveNode(db, a);
    expect(getGame(db).activeNodeId).toBe(a);
  });
});

describe("branching conversations", () => {
  it("head copy freezes canon for the child while the parent stays live", () => {
    const { db, rootNodeId } = makeSave();
    const conv = createConversation(db, {
      kind: "advisor",
      title: "Advisor",
      participants: [],
      originNodeId: rootNodeId,
      nodeId: rootNodeId,
    });
    const m1 = insertMessage(db, { conversationId: conv.id, parentMessageId: null, role: "user", speaker: "", content: "Should we mobilize?", authoredNodeId: rootNodeId, meta: {} });
    const m2 = insertMessage(db, { conversationId: conv.id, parentMessageId: m1.id, role: "assistant", speaker: "Advisor", content: "Cautiously, yes.", authoredNodeId: rootNodeId, meta: {} });
    setHead(db, rootNodeId, conv.id, m2.id);

    // Execute a turn: child inherits the head as canon.
    const child = addChild(db, rootNodeId, 1);
    copyHeads(db, rootNodeId, child);

    // Parent explores a regenerated sibling reply afterwards.
    const m2b = insertMessage(db, { conversationId: conv.id, parentMessageId: m1.id, role: "assistant", speaker: "Advisor", content: "Absolutely not.", authoredNodeId: rootNodeId, meta: {} });
    setHead(db, rootNodeId, conv.id, m2b.id);

    const childState = conversationsAtNode(db, child);
    expect(childState[0]?.headMessageId).toBe(m2.id);
    const parentState = conversationsAtNode(db, rootNodeId);
    expect(parentState[0]?.headMessageId).toBe(m2b.id);

    expect(messagePath(db, m2b.id).map((m) => m.content)).toEqual([
      "Should we mobilize?",
      "Absolutely not.",
    ]);
  });

  it("conversations never leak across branches", () => {
    const { db, rootNodeId } = makeSave();
    const branchA = addChild(db, rootNodeId, 1);
    const branchB = addChild(db, rootNodeId, 1);
    createConversation(db, {
      kind: "diplomacy",
      title: "Berlin",
      participants: ["GER"],
      originNodeId: branchA,
      nodeId: branchA,
    });
    expect(conversationsAtNode(db, branchA)).toHaveLength(1);
    expect(conversationsAtNode(db, branchB)).toHaveLength(0);
    expect(conversationsAtNode(db, rootNodeId)).toHaveLength(0);
  });
});
