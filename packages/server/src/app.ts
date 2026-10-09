import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import {
  AddActionRequestSchema,
  CreateGameRequestSchema,
  ExecuteTurnRequestSchema,
  GmEditRequestSchema,
  OpenConversationRequestSchema,
  SendChatMessageRequestSchema,
  SetActiveNodeRequestSchema,
  SetAnchorRequestSchema,
  SetDifficultyRequestSchema,
  SetHeadRequestSchema,
} from "@pax/domain";
import {
  CancelledError,
  ConflictError,
  NotFoundError,
  TurnFailedError,
  buildChronicleBook,
  buildGazette,
  collectChronicle,
  compareSiblings,
  deleteNodeSubtree,
  navigateToNode,
  getOrBuildStatSheet,
  openConversation,
  regenerateReply,
  sendChatMessage,
} from "@pax/engine";
import { GameManager, GameNotFoundError, TurnInProgressError } from "./gameManager.ts";
import { addPendingAction, listPendingActions, removePendingAction } from "./db/stores/actions.ts";
import { listEventsForNode } from "./db/stores/events.ts";
import { setNodeAnchor } from "./db/stores/nodes.ts";
import { searchSave } from "./db/stores/search.ts";

export const createApp = (manager: GameManager): Hono => {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof GameNotFoundError || error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof ConflictError || error instanceof TurnInProgressError) {
      return c.json({ error: error.message }, 409);
    }
    if (error instanceof CancelledError) {
      return c.json({ error: error.message }, 409);
    }
    if (error instanceof TurnFailedError) {
      return c.json({ error: error.message }, 502);
    }
    console.error(error);
    return c.json({ error: "Internal error" }, 500);
  });

  app.get("/api/scenarios", (c) =>
    c.json(
      manager.listScenarios().map(({ id, name, description, startDate, playablePolities }) => ({
        id,
        name,
        description,
        startDate,
        playablePolities,
      })),
    ),
  );

  app.get("/api/games", (c) => c.json(manager.listGames()));

  app.post("/api/games", zValidator("json", CreateGameRequestSchema), (c) => {
    const meta = manager.createGame(c.req.valid("json"));
    return c.json(meta, 201);
  });

  app.get("/api/games/:g", (c) => c.json(manager.gameMeta(c.req.param("g"))));

  app.put("/api/games/:g/difficulty", zValidator("json", SetDifficultyRequestSchema), (c) => {
    const meta = manager.setDifficulty(c.req.param("g"), c.req.valid("json").difficulty);
    return c.json(meta);
  });

  app.delete("/api/games/:g", (c) => {
    manager.deleteGame(c.req.param("g"));
    return c.body(null, 204);
  });

  app.get("/api/games/:g/tree", (c) => {
    const game = manager.get(c.req.param("g"));
    return c.json({ nodes: game.port.listNodeMetas() });
  });

  app.get("/api/games/:g/nodes/:n", (c) => {
    const game = manager.get(c.req.param("g"));
    const nodeId = c.req.param("n");
    const meta = game.port.getNodeMeta(nodeId);
    const node = game.port.getNode(nodeId);
    if (!meta || !node) return c.json({ error: "Unknown node" }, 404);
    return c.json({
      meta,
      input: node.parentId === null ? null : node.input,
      pendingActions: listPendingActions(game.db, nodeId),
    });
  });

  app.get("/api/games/:g/nodes/:n/world", (c) => {
    const game = manager.get(c.req.param("g"));
    const node = game.port.getNode(c.req.param("n"));
    if (!node) return c.json({ error: "Unknown node" }, 404);
    if (!node.worldBlobHash) return c.json({ error: "Node has no world snapshot" }, 409);
    return c.json(game.port.getWorld(node.worldBlobHash));
  });

  app.get("/api/games/:g/nodes/:n/events", (c) => {
    const game = manager.get(c.req.param("g"));
    return c.json(listEventsForNode(game.db, c.req.param("n")));
  });

  app.put("/api/games/:g/active-node", zValidator("json", SetActiveNodeRequestSchema), (c) => {
    const game = manager.get(c.req.param("g"));
    navigateToNode(game.port, game.hub.emit.bind(game.hub), c.req.valid("json").nodeId);
    return c.json({ activeNodeId: c.req.valid("json").nodeId });
  });

  app.post(
    "/api/games/:g/nodes/:n/children",
    zValidator("json", ExecuteTurnRequestSchema),
    async (c) => {
      const gameId = c.req.param("g");
      const parentId = c.req.param("n");
      const body = c.req.valid("json");
      const game = manager.get(gameId);
      const input = {
        actions: listPendingActions(game.db, parentId),
        jumpDays: body.jumpDays,
        stopPolicy: body.stopPolicy,
      };
      const node = await manager.runTurn(gameId, {
        kind: "execute",
        parentId,
        input,
        ...(body.commit === false ? { commit: false } : {}),
      });
      const meta = game.port.getNodeMeta(node.id);
      return c.json(meta, 201);
    },
  );

  app.get("/api/games/:g/export", async (c) => {
    const meta = manager.gameMeta(c.req.param("g"));
    const bytes = await manager.exportGame(c.req.param("g"));
    c.header("content-type", "application/vnd.sqlite3");
    c.header(
      "content-disposition",
      `attachment; filename="${meta.title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "save"}.pax.sqlite"`,
    );
    return c.body(new Uint8Array(bytes));
  });

  app.post("/api/games/import", async (c) => {
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length < 512) return c.json({ error: "Not a save file" }, 400);
    return c.json(manager.importGame(bytes), 201);
  });

  app.post("/api/games/:g/nodes/:n/accept", (c) =>
    c.json(manager.acceptNode(c.req.param("g"), c.req.param("n"))),
  );

  app.get("/api/games/:g/search", (c) => {
    const query = (c.req.query("q") ?? "").trim();
    if (query.length < 2) return c.json({ hits: [] });
    const game = manager.get(c.req.param("g"));
    return c.json({ hits: searchSave(game.db, query) });
  });

  app.get("/api/games/:g/nodes/:n/fingerprint", (c) => {
    const game = manager.get(c.req.param("g"));
    const node = game.port.getNode(c.req.param("n"));
    if (!node?.worldBlobHash) return c.json({ error: "Node has no world snapshot" }, 409);
    const world = game.port.getWorld(node.worldBlobHash);
    const weights: Record<string, number> = {};
    for (const [regionId, owner] of Object.entries(world.regionOwnership)) {
      // Country-level entries paint whole countries — weigh them heavier than
      // single sub-regions so the bar roughly tracks visual map share.
      weights[owner] = (weights[owner] ?? 0) + (/^[A-Z]{3}$/.test(regionId) ? 4 : 1);
    }
    for (const code of Object.keys(world.polities)) {
      if (!(code in weights)) weights[code] = 1;
    }
    return c.json({ weights });
  });

  app.post("/api/games/:g/nodes/:n/gm", zValidator("json", GmEditRequestSchema), (c) => {
    const gameId = c.req.param("g");
    const body = c.req.valid("json");
    const game = manager.get(gameId);
    const node = manager.gmEdit(gameId, {
      parentId: c.req.param("n"),
      input: { gm: true, note: body.note, impacts: body.impacts },
    });
    return c.json(game.port.getNodeMeta(node.id), 201);
  });

  app.post("/api/games/:g/nodes/:n/reassess", async (c) => {
    const proposal = await manager.reassess(c.req.param("g"), c.req.param("n"));
    return c.json(proposal);
  });

  app.post("/api/games/:g/nodes/:n/regenerate", async (c) => {
    const gameId = c.req.param("g");
    const game = manager.get(gameId);
    const node = await manager.runTurn(gameId, { kind: "regenerate", nodeId: c.req.param("n") });
    return c.json(game.port.getNodeMeta(node.id), 201);
  });

  app.delete("/api/games/:g/nodes/:n", (c) => {
    const game = manager.get(c.req.param("g"));
    const deleted = deleteNodeSubtree(game.port, game.hub.emit.bind(game.hub), c.req.param("n"));
    return c.json({ deleted });
  });

  app.post("/api/games/:g/cancel-turn", (c) => {
    const cancelled = manager.cancelTurn(c.req.param("g"));
    return c.json({ cancelled });
  });

  app.get("/api/games/:g/nodes/:n/actions", (c) => {
    const game = manager.get(c.req.param("g"));
    return c.json(listPendingActions(game.db, c.req.param("n")));
  });

  app.post("/api/games/:g/nodes/:n/actions", zValidator("json", AddActionRequestSchema), (c) => {
    const game = manager.get(c.req.param("g"));
    const nodeId = c.req.param("n");
    if (!game.port.getNode(nodeId)) return c.json({ error: "Unknown node" }, 404);
    return c.json(addPendingAction(game.db, nodeId, c.req.valid("json")), 201);
  });

  app.delete("/api/games/:g/nodes/:n/actions/:a", (c) => {
    const game = manager.get(c.req.param("g"));
    const removed = removePendingAction(game.db, c.req.param("n"), c.req.param("a"));
    return removed ? c.body(null, 204) : c.json({ error: "Unknown action" }, 404);
  });

  app.get("/api/games/:g/nodes/:n/stat-sheet/:p", async (c) => {
    const game = manager.get(c.req.param("g"));
    const sheet = await getOrBuildStatSheet(manager.chatDeps(game), {
      nodeId: c.req.param("n"),
      polity: c.req.param("p"),
      force: c.req.query("force") === "1",
    });
    return c.json(sheet);
  });

  /**
   * A polity's leader psyche as of a node: read from the NEAREST ancestor
   * that has a rollup (extraction runs behind turns and can fail without
   * wiping history), null when the extractor has never profiled them.
   */
  app.get("/api/games/:g/nodes/:n/psyche/:p", (c) => {
    const game = manager.get(c.req.param("g"));
    const polity = c.req.param("p");
    let nodeId: string | null = c.req.param("n");
    if (!game.port.getNodeMeta(nodeId)) return c.json({ error: "Unknown node" }, 404);
    while (nodeId) {
      const rollup = game.port.getRollup(nodeId);
      if (rollup) return c.json(rollup.psyches[polity] ?? null);
      nodeId = game.port.getNodeMeta(nodeId)?.parentId ?? null;
    }
    return c.json(null);
  });

  app.get("/api/games/:g/nodes/:n/chronicle", (c) => {
    const game = manager.get(c.req.param("g"));
    return c.json(collectChronicle(game.port, c.req.param("n")));
  });

  app.get("/api/games/:g/nodes/:n/chronicle-book", (c) => {
    const game = manager.get(c.req.param("g"));
    return c.html(buildChronicleBook(game.port, c.req.param("n")));
  });

  app.get("/api/games/:g/diff/:a/:b", async (c) => {
    const game = manager.get(c.req.param("g"));
    const aId = c.req.param("a");
    const bId = c.req.param("b");
    // Both worlds and event lists are frozen once complete, so a pair's
    // report never changes — and the narrative is a billed call.
    const key = `${aId}|${bId}`;
    const cached = game.diffCache.get(key);
    if (cached) return c.json(cached);
    const report = await compareSiblings(manager.utilityDeps(game), {
      aId,
      bId,
      signal: c.req.raw.signal,
    });
    game.diffCache.set(key, report);
    return c.json(report);
  });

  app.get("/api/games/:g/nodes/:n/gazette", async (c) => {
    const game = manager.get(c.req.param("g"));
    const gazette = await buildGazette(manager.utilityDeps(game), c.req.param("n"));
    return c.json(gazette);
  });

  app.put("/api/games/:g/nodes/:n/anchor", zValidator("json", SetAnchorRequestSchema), (c) => {
    const game = manager.get(c.req.param("g"));
    const nodeId = c.req.param("n");
    if (!setNodeAnchor(game.db, nodeId, c.req.valid("json").anchor)) {
      return c.json({ error: "Unknown node" }, 404);
    }
    const meta = game.port.getNodeMeta(nodeId);
    if (meta) game.hub.emit({ type: "node.updated", node: meta });
    return c.json(meta);
  });

  app.get("/api/games/:g/nodes/:n/conversations", (c) => {
    const game = manager.get(c.req.param("g"));
    return c.json(game.port.conversationsAtNode(c.req.param("n")));
  });

  app.post(
    "/api/games/:g/nodes/:n/conversations",
    zValidator("json", OpenConversationRequestSchema),
    (c) => {
      const game = manager.get(c.req.param("g"));
      const body = c.req.valid("json");
      const conversation = openConversation(game.port, {
        nodeId: c.req.param("n"),
        kind: body.kind,
        ...(body.title !== undefined ? { title: body.title } : {}),
        participants: body.participants,
      });
      return c.json(conversation, 201);
    },
  );

  app.get("/api/games/:g/conversations/:c/tree", (c) => {
    const game = manager.get(c.req.param("g"));
    const conversation = game.port.getConversation(c.req.param("c"));
    if (!conversation) return c.json({ error: "Unknown conversation" }, 404);
    return c.json({ conversation, messages: game.port.listMessages(conversation.id) });
  });

  app.post(
    "/api/games/:g/nodes/:n/conversations/:c/messages",
    zValidator("json", SendChatMessageRequestSchema),
    async (c) => {
      const game = manager.get(c.req.param("g"));
      const body = c.req.valid("json");
      const result = await sendChatMessage(manager.chatDeps(game), {
        nodeId: c.req.param("n"),
        conversationId: c.req.param("c"),
        text: body.text,
        ...(body.parentMessageId !== undefined ? { parentMessageId: body.parentMessageId } : {}),
      });
      return c.json(result, 201);
    },
  );

  app.post("/api/games/:g/nodes/:n/conversations/:c/messages/:m/regenerate", async (c) => {
    const game = manager.get(c.req.param("g"));
    const message = await regenerateReply(manager.chatDeps(game), {
      nodeId: c.req.param("n"),
      conversationId: c.req.param("c"),
      messageId: c.req.param("m"),
    });
    return c.json(message, 201);
  });

  app.put(
    "/api/games/:g/nodes/:n/conversations/:c/head",
    zValidator("json", SetHeadRequestSchema),
    (c) => {
      const game = manager.get(c.req.param("g"));
      const conversationId = c.req.param("c");
      const messageId = c.req.valid("json").messageId;
      const belongs = game.port
        .listMessages(conversationId)
        .some((message) => message.id === messageId);
      if (!belongs) return c.json({ error: "Message not in conversation" }, 404);
      game.port.setConversationHead(c.req.param("n"), conversationId, messageId);
      return c.json({ headMessageId: messageId });
    },
  );

  app.get("/api/games/:g/stream", (c) => {
    const game = manager.get(c.req.param("g"));
    const lastEventIdHeader = c.req.header("Last-Event-ID");
    const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) : undefined;

    return streamSSE(c, async (stream) => {
      // Flush headers immediately so EventSource fires `open` before the
      // first real event; also keeps proxies from buffering the stream.
      await stream.writeSSE({ event: "hello", data: "{}" });
      let unsubscribe = () => {};
      const done = new Promise<void>((resolve) => {
        unsubscribe = game.hub.subscribe((entry) => {
          void stream.writeSSE({
            id: String(entry.id),
            event: entry.event.type,
            data: JSON.stringify(entry.event),
          });
        }, Number.isFinite(lastEventId) ? lastEventId : undefined);
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
      await done;
    });
  });

  return app;
};
