import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { ScenarioSchema, type TimelineNodeMeta } from "@pax/domain";
import { FakeLlmClient } from "@pax/providers";
import { openAppDb } from "./db/appDb.ts";
import { GameManager } from "./gameManager.ts";
import { createApp } from "./app.ts";

const scenario = ScenarioSchema.parse({
  id: "test",
  name: "Test",
  startDate: "1936-01-01",
  world: {
    regionOwnership: { r1: "FRA", r2: "GER" },
    polities: {
      FRA: { code: "FRA", name: "France" },
      GER: { code: "GER", name: "Germany" },
    },
  },
});

let dataDir: string;
let app: Hono;
let fake: FakeLlmClient;
let manager: GameManager;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pax-test-"));
  let turnCalls = 0;
  fake = new FakeLlmClient((req) => {
    // Background fact extraction also hits the fake; keep it out of the
    // turn-roll numbering the assertions rely on.
    if (req.taskLabel === "extractFacts") return { structured: { facts: [] } };
    const roll = ++turnCalls;
    return {
      structured: {
        stopDate: `1936-0${Math.min(roll + 1, 9)}-01`,
        summary: `Turn roll ${roll}`,
        events: [
          {
            date: "1936-02-15",
            title: `Event from roll ${roll}`,
            // Kept short: under the reconcile pass's 60-char narration
            // threshold, so the cartographer never joins the roll numbering.
            description: "It happened.",
            impacts: { regionTransfers: [{ regionId: "r2", toCode: "FRA" }] },
          },
        ],
      },
    };
  });
  manager = new GameManager(
    openAppDb(dataDir),
    dataDir,
    new Map([["test", scenario]]),
    fake,
    { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 },
  );
  app = createApp(manager);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

const createGame = async () => {
  const res = await app.request("/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scenarioId: "test", title: "It", playerPolity: "FRA" }),
  });
  expect(res.status).toBe(201);
  return json<{ gameId: string; activeNodeId: string }>(res);
};

const executeTurn = async (gameId: string, parentId: string) => {
  const res = await app.request(`/api/games/${gameId}/nodes/${parentId}/children`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jumpDays: 30 }),
  });
  expect(res.status).toBe(201);
  return json<TimelineNodeMeta>(res);
};

describe("game lifecycle over HTTP", () => {
  it("creates a game with a complete root node", async () => {
    const game = await createGame();
    const tree = await json<{ nodes: TimelineNodeMeta[] }>(
      await app.request(`/api/games/${game.gameId}/tree`),
    );
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]).toMatchObject({ depth: 0, status: "complete", id: game.activeNodeId });
  });

  it("executes turns, applies impacts, and advances the checkout", async () => {
    const game = await createGame();
    const child = await executeTurn(game.gameId, game.activeNodeId);
    expect(child).toMatchObject({ depth: 1, status: "complete", summary: "Turn roll 1" });

    const meta = await json<{ activeNodeId: string }>(await app.request(`/api/games/${game.gameId}`));
    expect(meta.activeNodeId).toBe(child.id);

    const world = await json<{ regionOwnership: Record<string, string> }>(
      await app.request(`/api/games/${game.gameId}/nodes/${child.id}/world`),
    );
    expect(world.regionOwnership.r2).toBe("FRA");

    // The parent's world is untouched — branch isolation at the snapshot level.
    const rootWorld = await json<{ regionOwnership: Record<string, string> }>(
      await app.request(`/api/games/${game.gameId}/nodes/${game.activeNodeId}/world`),
    );
    expect(rootWorld.regionOwnership.r2).toBe("GER");
  });

  it("consumes pending actions into the frozen turn input", async () => {
    const game = await createGame();
    await app.request(`/api/games/${game.gameId}/nodes/${game.activeNodeId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "action", title: "Mobilize", text: "Call up reserves" }),
    });
    const child = await executeTurn(game.gameId, game.activeNodeId);

    // The prompt saw the action…
    expect(fake.calls[0]?.messages[0]?.text).toContain("Mobilize");
    // …the parent's queue was consumed…
    const remaining = await json<unknown[]>(
      await app.request(`/api/games/${game.gameId}/nodes/${game.activeNodeId}/actions`),
    );
    expect(remaining).toHaveLength(0);
    // …and the frozen input survives on the node for regeneration.
    const detail = await json<{ input: { actions: unknown[] } }>(
      await app.request(`/api/games/${game.gameId}/nodes/${child.id}`),
    );
    expect(detail.input.actions).toHaveLength(1);
  });

  it("regenerates a node as a sibling sharing the parent", async () => {
    const game = await createGame();
    const first = await executeTurn(game.gameId, game.activeNodeId);
    const res = await app.request(`/api/games/${game.gameId}/nodes/${first.id}/regenerate`, {
      method: "POST",
    });
    expect(res.status).toBe(201);
    const sibling = await json<TimelineNodeMeta>(res);

    expect(sibling.id).not.toBe(first.id);
    expect(sibling.parentId).toBe(first.parentId);
    expect(sibling.summary).toBe("Turn roll 2");

    const tree = await json<{ nodes: TimelineNodeMeta[] }>(
      await app.request(`/api/games/${game.gameId}/tree`),
    );
    const siblings = tree.nodes.filter((node) => node.parentId === first.parentId);
    expect(siblings).toHaveLength(2);
  });

  it("navigates between branches and refuses deleting the active subtree", async () => {
    const game = await createGame();
    const first = await executeTurn(game.gameId, game.activeNodeId);
    await app.request(`/api/games/${game.gameId}/nodes/${first.id}/regenerate`, { method: "POST" });

    // Active node is now the regenerated sibling; deleting its subtree must 409.
    const meta = await json<{ activeNodeId: string }>(await app.request(`/api/games/${game.gameId}`));
    const denied = await app.request(`/api/games/${game.gameId}/nodes/${meta.activeNodeId}`, {
      method: "DELETE",
    });
    expect(denied.status).toBe(409);

    // Navigate back to the first sibling, then delete the other branch.
    const nav = await app.request(`/api/games/${game.gameId}/active-node`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: first.id }),
    });
    expect(nav.status).toBe(200);
    const del = await app.request(`/api/games/${game.gameId}/nodes/${meta.activeNodeId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    const tree = await json<{ nodes: TimelineNodeMeta[] }>(
      await app.request(`/api/games/${game.gameId}/tree`),
    );
    expect(tree.nodes.map((node) => node.id)).toContain(first.id);
    expect(tree.nodes.map((node) => node.id)).not.toContain(meta.activeNodeId);
  });

  it("continues play from an ancestor, forming a real branch", async () => {
    const game = await createGame();
    const t1 = await executeTurn(game.gameId, game.activeNodeId);
    await executeTurn(game.gameId, t1.id);

    // Jump back to t1 and play a different future.
    await app.request(`/api/games/${game.gameId}/active-node`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: t1.id }),
    });
    const altT2 = await executeTurn(game.gameId, t1.id);

    const tree = await json<{ nodes: TimelineNodeMeta[] }>(
      await app.request(`/api/games/${game.gameId}/tree`),
    );
    expect(tree.nodes).toHaveLength(4); // root, t1, t2, alt-t2
    expect(tree.nodes.filter((node) => node.parentId === t1.id)).toHaveLength(2);
    // t1 now prefers the newest child.
    expect(tree.nodes.find((node) => node.id === t1.id)?.preferredChildId).toBe(altT2.id);
  });

  it("serves the chronicle: unsummarized turns now, eras only past the span", async () => {
    const game = await createGame();
    const t1 = await executeTurn(game.gameId, game.activeNodeId);
    const t2 = await executeTurn(game.gameId, t1.id);
    await manager.drainExtractions(game.gameId);

    const res = await app.request(`/api/games/${game.gameId}/nodes/${t2.id}/chronicle`);
    expect(res.status).toBe(200);
    const chronicle = await json<{
      eras: unknown[];
      recent: Array<{ depth: number; gameDate: string; summary: string; lines: string[] }>;
    }>(res);

    // Two turns is far short of one ERA_SPAN, so everything is still "recent"
    // and the root (depth 0) never appears.
    expect(chronicle.eras).toEqual([]);
    expect(chronicle.recent.map((turn) => turn.depth)).toEqual([1, 2]);
    expect(chronicle.recent[1]?.summary).toBe("Turn roll 2");
    // Region transfers derive a territory fact, so digest lines are populated.
    expect(chronicle.recent[0]?.lines.join(" ")).toContain("territory");
  });

  it("serves a polity's leader psyche from the node's rollup", async () => {
    const game = await createGame();
    const t1 = await executeTurn(game.gameId, game.activeNodeId);
    await manager.drainExtractions(game.gameId);
    const port = manager.get(game.gameId).port;
    const rollup = port.getRollup(t1.id);
    expect(rollup).not.toBeNull();
    port.setRollup(t1.id, {
      ...rollup!,
      psyches: {
        GER: {
          temperament: "prickly about honor",
          ambitions: ["the Rhineland"],
          grudges: [],
          opinionOfPlayer: -2,
          opinionReason: "lost r2",
        },
      },
    });

    const sheet = await json<{ temperament: string; opinionOfPlayer: number } | null>(
      await app.request(`/api/games/${game.gameId}/nodes/${t1.id}/psyche/GER`),
    );
    expect(sheet).toMatchObject({ temperament: "prickly about honor", opinionOfPlayer: -2 });

    // Never profiled → null, not an error.
    const none = await app.request(`/api/games/${game.gameId}/nodes/${t1.id}/psyche/ITA`);
    expect(none.status).toBe(200);
    expect(await none.json()).toBeNull();

    const unknown = await app.request(`/api/games/${game.gameId}/nodes/nope/psyche/GER`);
    expect(unknown.status).toBe(404);
  });

  it("404s the chronicle for an unknown node", async () => {
    const game = await createGame();
    const res = await app.request(`/api/games/${game.gameId}/nodes/does-not-exist/chronicle`);
    expect(res.status).toBe(404);
  });

  it("keeps a failed generation as a retryable failed node", async () => {
    const failing = new FakeLlmClient(() => ({ structuredError: "model exploded" }));
    const manager = new GameManager(
      openAppDb(dataDir),
      dataDir,
      new Map([["test", scenario]]),
      failing,
      { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 },
    );
    const failApp = createApp(manager);
    const res = await failApp.request("/api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenarioId: "test", title: "F", playerPolity: "FRA" }),
    });
    const game = await json<{ gameId: string; activeNodeId: string }>(res);

    const turnRes = await failApp.request(`/api/games/${game.gameId}/nodes/${game.activeNodeId}/children`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jumpDays: 30 }),
    });
    expect(turnRes.status).toBe(502);

    const tree = await json<{ nodes: TimelineNodeMeta[] }>(
      await failApp.request(`/api/games/${game.gameId}/tree`),
    );
    const failed = tree.nodes.find((node) => node.status === "failed");
    expect(failed).toBeDefined();
    // Checkout did not move.
    const meta = await json<{ activeNodeId: string }>(await failApp.request(`/api/games/${game.gameId}`));
    expect(meta.activeNodeId).toBe(game.activeNodeId);
  });
});
