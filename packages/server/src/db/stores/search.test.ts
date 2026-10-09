import { describe, expect, it } from "vitest";
import { emptyWorld, newId } from "@pax/domain";
import { createSaveDb } from "../saveDb.ts";
import { insertEvents } from "./events.ts";
import { insertFacts } from "./facts.ts";
import { createConversation, insertMessage } from "./conversations.ts";
import { searchSave } from "./search.ts";

const EMPTY_IMPACTS = {
  actionIds: [],
  regionTransfers: [],
  polityChanges: [],
  unitOps: [],
  markerOps: [],
  createdChats: [],
};

// ULIDs are only lexically ordered across distinct milliseconds (no monotonic
// factory here) — a busy-wait guarantees two inserts land in different
// milliseconds so an id-desc ordering test isn't a coin flip.
const waitNextMillis = (): void => {
  const start = Date.now();
  while (Date.now() === start) {
    /* spin */
  }
};

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

describe("searchSave", () => {
  it("finds events by title or description and returns a title/snippet", () => {
    const { db, rootNodeId } = makeSave();
    insertEvents(db, rootNodeId, [
      {
        date: "1936-02-01",
        title: "Skirmish at the border",
        description: "A minor clash with no lasting consequence.",
        kind: "world",
        importance: "minor",
        playerRelated: false,
        impacts: EMPTY_IMPACTS,
      },
      {
        date: "1936-03-01",
        title: "The Verdun Offensive begins",
        description: "Artillery opens up along the whole front near Verdun at dawn.",
        kind: "war",
        importance: "major",
        playerRelated: true,
        impacts: EMPTY_IMPACTS,
      },
    ]);

    const hits = searchSave(db, "Verdun");
    const events = hits.filter((hit) => hit.kind === "event");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      nodeId: rootNodeId,
      gameDate: "1936-03-01",
      title: "The Verdun Offensive begins",
    });
    expect(events[0]?.snippet).toContain("Verdun");
  });

  it("orders events newest-first", () => {
    const { db, rootNodeId } = makeSave();
    insertEvents(db, rootNodeId, [
      {
        date: "1936-02-01",
        title: "Needlepoint incident one",
        description: "",
        kind: "world",
        importance: "minor",
        playerRelated: false,
        impacts: EMPTY_IMPACTS,
      },
      {
        date: "1938-06-01",
        title: "Needlepoint incident two",
        description: "",
        kind: "world",
        importance: "minor",
        playerRelated: false,
        impacts: EMPTY_IMPACTS,
      },
    ]);

    const hits = searchSave(db, "Needlepoint").filter((hit) => hit.kind === "event");
    expect(hits.map((hit) => hit.gameDate)).toEqual(["1938-06-01", "1936-02-01"]);
  });

  it("finds facts, joins the node for gameDate, and titles them with a digest line", () => {
    const { db, rootNodeId } = makeSave();
    insertFacts(
      db,
      rootNodeId,
      [{ type: "notable_event", headline: "A stunning victory near Verdun", polities: ["FRA"] }],
      "derived",
    );

    const hits = searchSave(db, "Verdun");
    const facts = hits.filter((hit) => hit.kind === "fact");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ nodeId: rootNodeId, gameDate: "1936-01-01" });
    expect(facts[0]?.title).toBe("notable: A stunning victory near Verdun");
    expect(facts[0]?.snippet).toContain("Verdun");
  });

  it("finds messages, tags them with their conversation, and titles with the first line", () => {
    const { db, rootNodeId } = makeSave();
    const conversation = createConversation(db, {
      kind: "advisor",
      title: "Advisor",
      participants: [],
      originNodeId: rootNodeId,
      nodeId: rootNodeId,
    });
    insertMessage(db, {
      conversationId: conversation.id,
      parentMessageId: null,
      role: "user",
      speaker: "",
      content: "Should we reinforce the garrison near Verdun before the thaw?",
      authoredNodeId: rootNodeId,
      meta: {},
    });

    const hits = searchSave(db, "Verdun");
    const messages = hits.filter((hit) => hit.kind === "message");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      nodeId: rootNodeId,
      gameDate: "1936-01-01",
      conversationId: conversation.id,
    });
    expect(messages[0]?.title).toBe("Should we reinforce the garrison near Verdun before the tha…");
    expect(messages[0]?.snippet).toContain("Verdun");
  });

  it("orders messages newest-first (by id)", () => {
    const { db, rootNodeId } = makeSave();
    const conversation = createConversation(db, {
      kind: "advisor",
      title: "Advisor",
      participants: [],
      originNodeId: rootNodeId,
      nodeId: rootNodeId,
    });
    const first = insertMessage(db, {
      conversationId: conversation.id,
      parentMessageId: null,
      role: "user",
      speaker: "",
      content: "The chatterbox report just arrived, sir.",
      authoredNodeId: rootNodeId,
      meta: {},
    });
    waitNextMillis();
    insertMessage(db, {
      conversationId: conversation.id,
      parentMessageId: first.id,
      role: "assistant",
      speaker: "Advisor",
      content: "Noted — another chatterbox update, thank you.",
      authoredNodeId: rootNodeId,
      meta: {},
    });

    const hits = searchSave(db, "chatterbox").filter((hit) => hit.kind === "message");
    expect(hits).toHaveLength(2);
    expect(hits[0]?.title).toContain("Noted");
    expect(hits[1]?.title).toContain("chatterbox report");
  });

  it("escapes LIKE wildcards so a literal % or _ in the needle is not a wildcard", () => {
    const { db, rootNodeId } = makeSave();
    insertEvents(db, rootNodeId, [
      {
        date: "1936-02-01",
        title: "Approval rating hits 100% in the capital",
        description: "",
        kind: "world",
        importance: "minor",
        playerRelated: false,
        impacts: EMPTY_IMPACTS,
      },
      {
        date: "1936-02-02",
        title: "An unrelated headline about the harvest",
        description: "Grain output rose sharply this quarter.",
        kind: "world",
        importance: "minor",
        playerRelated: false,
        impacts: EMPTY_IMPACTS,
      },
    ]);

    const hits = searchSave(db, "100%").filter((hit) => hit.kind === "event");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toContain("100%");
  });

  it("caps each kind at the requested limit", () => {
    const { db, rootNodeId } = makeSave();
    const drafts = Array.from({ length: 5 }, (_, index) => ({
      date: "1936-02-01",
      title: `Repeated skirmish report ${index}`,
      description: "",
      kind: "world" as const,
      importance: "minor" as const,
      playerRelated: false,
      impacts: EMPTY_IMPACTS,
    }));
    insertEvents(db, rootNodeId, drafts);

    const hits = searchSave(db, "skirmish report", 2).filter((hit) => hit.kind === "event");
    expect(hits).toHaveLength(2);
  });

  it("does not enforce a minimum query length — the route enforces that", () => {
    const { db, rootNodeId } = makeSave();
    insertEvents(db, rootNodeId, [
      {
        date: "1936-02-01",
        title: "A single Z appears here",
        description: "",
        kind: "world",
        importance: "minor",
        playerRelated: false,
        impacts: EMPTY_IMPACTS,
      },
    ]);

    const hits = searchSave(db, "Z");
    expect(hits.some((hit) => hit.title.includes("Z"))).toBe(true);
  });

  it("returns nothing for a query with no matches", () => {
    const { db } = makeSave();
    expect(searchSave(db, "nonexistentneedle")).toEqual([]);
  });
});
