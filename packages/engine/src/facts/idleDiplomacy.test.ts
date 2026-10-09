import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSaveDb } from "../../../server/src/db/saveDb.ts";
import { makeSavePort } from "../../../server/src/savePort.ts";
import { ScenarioSchema, emptyImpacts, emptyRollup, pairKey } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { contactGateOpen, detectTriggers, maybeInitiateContact } from "./idleDiplomacy.ts";
import { applyGmEdit } from "../turn/gmEdit.ts";
import type { SavePort } from "../ports.ts";

let dir: string;
let store: SavePort;
let rootId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-idle-"));
  const created = createSaveDb(join(dir, "t.sqlite"), {
    gameId: "g1",
    title: "T",
    scenarioId: "t",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-01-01",
    world: ScenarioSchema.parse({
      id: "t",
      name: "T",
      startDate: "1936-01-01",
      world: {
        polities: { FRA: { code: "FRA", name: "France" }, DEU: { code: "DEU", name: "Germany" } },
      },
    }).world,
  });
  store = makeSavePort(created.db);
  rootId = created.rootNodeId;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 400 };

/** GM children until the deterministic gate opens for one (expected ~2 tries). */
const nodeWithOpenGate = (): string => {
  let parentId = rootId;
  for (let i = 0; i < 64; i += 1) {
    const node = applyGmEdit(
      { store, emit: () => {} },
      { parentId, input: { gm: true, note: `hop ${i}`, impacts: emptyImpacts() } },
    );
    if (contactGateOpen(node.id)) return node.id;
    parentId = node.id;
  }
  throw new Error("gate never opened in 64 ULIDs — hash is broken");
};

describe("idle diplomacy", () => {
  it("detects triggers only when the player is involved, one per nation, best first", () => {
    const rollup = emptyRollup();
    rollup.relations[pairKey("FRA", "DEU")] = { score: -3, lastReason: "border" };
    const triggers = detectTriggers({
      player: "FRA",
      gameDate: "1936-05-01",
      rollup,
      facts: [
        { type: "war_started", attacker: "DEU", defender: "FRA", cause: "the border" },
        { type: "relationship_shift", pair: ["FRA", "DEU"], delta: -1, reason: "raids" },
        { type: "war_started", attacker: "GBR", defender: "ITA", cause: "colonies" }, // not our war
      ],
    });
    expect(triggers).toHaveLength(1); // best trigger per nation, foreigners' wars ignored
    expect(triggers[0]?.code).toBe("DEU");
    expect(triggers[0]?.priority).toBe(0); // the war outranks the relation shift
  });

  it("stays silent on sub-threshold relationship drift and foreign business", () => {
    const rollup = emptyRollup();
    rollup.relations[pairKey("FRA", "DEU")] = { score: 1, lastReason: "thaw" };
    const triggers = detectTriggers({
      player: "FRA",
      gameDate: "1936-05-01",
      rollup,
      facts: [{ type: "relationship_shift", pair: ["FRA", "DEU"], delta: 1, reason: "trade" }],
    });
    expect(triggers).toHaveLength(0);
  });

  it("calls when an open commitment to the player comes due", () => {
    const rollup = emptyRollup();
    rollup.openCommitments.push({ from: "DEU", to: "FRA", what: "grain shipments", deadline: "1936-04-01" });
    const due = detectTriggers({ player: "FRA", gameDate: "1936-05-01", rollup, facts: [] });
    expect(due[0]?.code).toBe("DEU");
    const notYet = detectTriggers({ player: "FRA", gameDate: "1936-03-01", rollup, facts: [] });
    expect(notYet).toHaveLength(0);
  });

  it("gates deterministically per node id", () => {
    expect(contactGateOpen("01ABCDEF")).toBe(contactGateOpen("01ABCDEF"));
    const opened = Array.from({ length: 200 }, (_, i) => contactGateOpen(`node-${i}`)).filter(Boolean);
    expect(opened.length).toBeGreaterThan(40); // ~50% chance, sanity band
    expect(opened.length).toBeLessThan(160);
  });

  it("opens exactly one channel with the counterpart's line as head, idempotently", async () => {
    const nodeId = nodeWithOpenGate();
    store.insertFacts(nodeId, [{ type: "war_started", attacker: "DEU", defender: "FRA", cause: "the border" }], "derived");

    const llm = new FakeLlmClient(() => ({ deltas: ["Your armies crossed our border. Withdraw them, or this war finds your capital."] }));
    const deps = { store, llm, binding, emit: () => {} };

    const opened = await maybeInitiateContact(deps, nodeId);
    expect(opened).not.toBeNull();
    expect(opened?.kind).toBe("diplomacy");
    expect(opened?.participants).toEqual(["DEU"]);

    const state = store.conversationsAtNode(nodeId).find((c) => c.id === opened?.id);
    const head = store.listMessages(opened!.id).find((m) => m.id === state?.headMessageId);
    expect(head?.role).toBe("assistant");
    expect(head?.speaker).toBe("DEU");
    expect(head?.meta.initiated).toBe(true);

    // Extraction can re-run on a node: the second pass must not knock twice.
    const again = await maybeInitiateContact(deps, nodeId);
    expect(again).toBeNull();
    expect(store.conversationsAtNode(nodeId).filter((c) => c.kind === "diplomacy")).toHaveLength(1);
  });

  it("returns null (never throws) when the model fails, leaving no orphan channel", async () => {
    const nodeId = nodeWithOpenGate();
    store.insertFacts(nodeId, [{ type: "war_started", attacker: "DEU", defender: "FRA", cause: "x" }], "derived");
    const llm = new FakeLlmClient(() => {
      throw new Error("provider down");
    });
    const result = await maybeInitiateContact({ store, llm, binding, emit: () => {} }, nodeId);
    expect(result).toBeNull();
    expect(store.conversationsAtNode(nodeId).filter((c) => c.kind === "diplomacy")).toHaveLength(0);
  });
});
