import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { FakeLlmClient } from "@pax/providers";
import { ScenarioSchema, emptyImpacts } from "@pax/domain";
import { buildGazette } from "./gazette.ts";
import type { SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let rootId: string;
/** Flipped per-test to exercise the model path vs. its failure paths. */
let mode: "ok" | "garbage" = "ok";

const llm = new FakeLlmClient((req) => {
  if (req.taskLabel === "gazette") {
    if (mode === "garbage") return { structured: { nonsense: true } };
    return {
      structured: {
        masthead: "The Frontier Chronicle",
        dateline: "Anno 1936, the tenth month",
        motto: "Truth outruns the courier",
        articles: [
          { headline: "Frontier Secured", body: "Lead article body.", kind: "military" },
          { headline: "Markets Steady", body: "Second article body.", kind: "economy" },
        ],
      },
    };
  }
  return { structured: {} };
});

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };
const deps = () => ({ store, llm, binding });

const gazetteCalls = (): number => llm.calls.filter((call) => call.taskLabel === "gazette").length;

beforeEach(() => {
  mode = "ok";
  llm.calls.length = 0;
  dir = mkdtempSync(join(tmpdir(), "pax-gazette-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "Pax Futura",
    scenarioId: "t",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-10-15",
    world: ScenarioSchema.parse({
      id: "t",
      name: "T",
      startDate: "1936-10-15",
      world: {
        regionOwnership: { FRA: "FRA", DEU: "DEU" },
        polities: {
          FRA: { code: "FRA", name: "France" },
          DEU: { code: "DEU", name: "Germany" },
        },
      },
    }).world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("buildGazette", () => {
  it("skips the model and returns the quiet-day fallback when the node has no events", async () => {
    const gazette = await buildGazette(deps(), rootId);
    expect(gazetteCalls()).toBe(0);
    expect(gazette.articles).toEqual([
      { headline: "A quiet day", body: "Nothing of note reached the printing house.", kind: "dispatch" },
    ]);
  });

  it("uses the styled model output when events are present and the model succeeds", async () => {
    store.insertEvents(rootId, [
      {
        date: "1936-10-15",
        title: "Frontier Secured",
        description: "Troops dig in along the border.",
        kind: "military",
        importance: "pivotal",
        playerRelated: true,
        impacts: emptyImpacts(),
      },
      {
        date: "1936-10-15",
        title: "Markets Steady",
        description: "Traders shrug off the news.",
        kind: "economy",
        importance: "minor",
        playerRelated: false,
        impacts: emptyImpacts(),
      },
    ]);

    const gazette = await buildGazette(deps(), rootId);
    expect(gazetteCalls()).toBe(1);
    expect(gazette.masthead).toBe("The Frontier Chronicle");
    expect(gazette.motto).toBe("Truth outruns the courier");
    expect(gazette.articles).toHaveLength(2);
    expect(gazette.articles[0]).toMatchObject({ headline: "Frontier Secured" });
  });

  it("falls back to the deterministic front page when the model returns garbage", async () => {
    mode = "garbage";
    store.insertEvents(rootId, [
      {
        date: "1936-10-15",
        title: "Frontier Secured",
        description: "Troops dig in along the border.",
        kind: "military",
        importance: "pivotal",
        playerRelated: true,
        impacts: emptyImpacts(),
      },
      {
        date: "1936-10-15",
        title: "Markets Steady",
        description: "Traders shrug off the news.",
        kind: "economy",
        importance: "minor",
        playerRelated: false,
        impacts: emptyImpacts(),
      },
    ]);

    const gazette = await buildGazette(deps(), rootId);
    expect(gazetteCalls()).toBe(1);
    expect(gazette.masthead).toBe("The Pax Futura Gazette");
    expect(gazette.articles).toHaveLength(2);
    expect(gazette.articles.map((a) => a.headline)).toEqual(["Frontier Secured", "Markets Steady"]);
  });
});
