import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventDraftSchema, ScenarioSchema, type TurnInput } from "@pax/domain";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { setNodeAnchor } from "../../../server/src/db/stores/nodes.ts";
import type { Db } from "../../../server/src/db/openDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { NotFoundError } from "../loom/tree.ts";
import type { SavePort } from "../ports.ts";
import { buildChronicleBook } from "./chronicleBook.ts";

let dir: string;
let db: Db;
let store: SavePort;
let ids: string[];

const TURNS = 12;
const turnInput: TurnInput = { actions: [], jumpDays: 30, stopPolicy: "toDate" };
/** One turn per year keeps the dates readable and overflow-free. */
const dateAt = (depth: number): string => `${1936 + depth}-01-01`;

const addNode = (id: string, parentId: string, depth: number, summary: string): string => {
  const hash = store.getNode(parentId)?.worldBlobHash ?? null;
  store.insertNode({
    id,
    parentId,
    depth,
    status: "complete",
    gameDate: dateAt(depth),
    input: turnInput,
    summary,
    worldBlobHash: hash,
  });
  return id;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-book-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "The Concordat Years",
    scenarioId: "t",
    playerPolity: "FRA",
    difficulty: "challenging",
    startDate: "1936-01-01",
    world: ScenarioSchema.parse({
      id: "t",
      name: "T",
      startDate: "1936-01-01",
      world: {
        regionOwnership: { FRA: "FRA", DEU: "DEU" },
        polities: { FRA: { code: "FRA", name: "France" }, DEU: { code: "DEU", name: "Germany" } },
      },
    }).world,
  });
  db = created.db;
  store = makeSavePort(db);

  ids = [];
  let parent = created.rootNodeId;
  for (let depth = 1; depth <= TURNS; depth += 1) {
    parent = addNode(`n${depth}`, parent, depth, `The year ${dateAt(depth)} turned on the Rhine.`);
    ids.push(parent);
  }

  store.putEraSummary({
    title: "The Rhineland Decade",
    summary: "Ten years of brinkmanship along the frontier.\n\nThe guns stayed cold, barely.",
    openThreads: ["Rhineland standoff unresolved"],
    degraded: false,
    startNodeId: ids[0]!,
    endNodeId: ids[9]!,
    startDepth: 1,
    endDepth: 10,
    startDate: dateAt(1),
    endDate: dateAt(10),
  });

  store.insertEvents(ids[10]!, [
    EventDraftSchema.parse({
      date: dateAt(11),
      title: '<script>alert("boom")</script>',
      description: "A pamphlet of doubtful provenance circulated in the capital.",
      importance: "pivotal",
      playerRelated: true,
    }),
    EventDraftSchema.parse({ date: dateAt(11), title: "A poor harvest in Picardy" }),
  ]);

  setNodeAnchor(db, ids[10]!, "Eve of the Anatolian War");
  addNode("alt", ids[10]!, 12, "The fleet turned back instead.");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("chronicle book", () => {
  it("binds title page, era chapters, the present age and apocrypha", () => {
    const html = buildChronicleBook(store, ids[11]!);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>The Concordat Years</title>");
    expect(html).toContain("The Concordat Years");
    expect(html).toContain("France (FRA)");
    expect(html).toContain("challenging");
    expect(html).toContain("1936-01-01");
    expect(html).toContain(dateAt(TURNS));
    expect(html).toContain("12 turns");

    // Era chapter: heading, span, narrative, open-threads coda.
    expect(html).toContain("The Rhineland Decade");
    expect(html).toContain("turns 1–10");
    expect(html).toContain("Ten years of brinkmanship along the frontier.");
    expect(html).toContain("Rhineland standoff unresolved");

    // The unsummarized tail, with importance emphasis and a margin waypoint.
    expect(html).toContain("The Present Age");
    expect(html).toContain(`<h3>${dateAt(11)}</h3>`);
    expect(html).toContain("A pamphlet of doubtful provenance");
    expect(html).toContain("pivotal");
    expect(html).toContain("A poor harvest in Picardy");
    expect(html).toContain("Eve of the Anatolian War");

    // Apocrypha: the sibling branch off the exported path.
    expect(html).toContain("Apocrypha");
    expect(html).toContain("The fleet turned back instead.");
    expect(html).toContain("the road not taken");
    // The walked path itself is never apocryphal.
    expect(html).not.toContain("The year 1948-01-01 turned on the Rhine.</span>");
  });

  it("escapes interpolated text so a scripted title cannot break out", () => {
    const html = buildChronicleBook(store, ids[11]!);

    expect(html).toContain("&lt;script&gt;alert(&quot;boom&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
  });

  it("rejects an unknown node", () => {
    expect(() => buildChronicleBook(store, "nope")).toThrow(NotFoundError);
  });
});
