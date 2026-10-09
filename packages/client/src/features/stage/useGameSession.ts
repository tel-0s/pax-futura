import { useEffect } from "react";
import { api } from "../../lib/api.ts";
import { openGameStream } from "../../lib/stream.ts";
import { useConversationsStore } from "../../stores/conversations.ts";
import { useEventCardsStore } from "../../stores/eventCards.ts";
import { useLoomStore } from "../../stores/loom.ts";
import { useSessionStore } from "../../stores/session.ts";
import { useUiStore } from "../../stores/ui.ts";
import { useWorldStore } from "../../stores/world.ts";

/**
 * Bind the stores to one game: initial REST load (meta + tree), then a single
 * SSE subscription as the only ongoing write path. World snapshots reload
 * only when the server says the world changed or the checkout moved.
 */
export const useGameSession = (gameId: string | undefined): void => {
  useEffect(() => {
    if (!gameId) return;
    let closed = false;

    const loom = useLoomStore.getState();
    const session = useSessionStore.getState();
    const world = useWorldStore.getState();

    void (async () => {
      const [meta, tree] = await Promise.all([api.getGame(gameId), api.getTree(gameId)]);
      if (closed) return;
      session.setGame(gameId, meta);
      loom.setTree(tree.nodes);
      loom.setCurrent(meta.activeNodeId);
      void world.load(gameId, meta.activeNodeId);
    })();

    const stream = openGameStream(
      gameId,
      (event) => {
        useLoomStore.getState().applySse(event);
        useConversationsStore
          .getState()
          .applySse(event, gameId, useLoomStore.getState().currentNodeId);
        // A head that moved behind a closed drawer is the only thing the badge
        // means — including a nation opening a channel at us unprompted, which
        // arrives as a completed message in a conversation we've never seen.
        if (event.type === "message.completed" && !useUiStore.getState().conversationsOpen) {
          useConversationsStore.getState().setUnread(true);
        }
        if (event.type === "world.changed" || event.type === "game.meta") {
          const nodeId =
            event.type === "world.changed" ? event.nodeId : event.activeNodeId;
          useWorldStore.getState().invalidate();
          void useWorldStore.getState().load(gameId, nodeId);
        }
        // world.changed fires exactly once per completed turn: walk its events.
        if (event.type === "world.changed") {
          void useEventCardsStore.getState().openForNode(gameId, event.nodeId);
        }
      },
      (status) => useSessionStore.getState().setConnection(status),
    );

    return () => {
      closed = true;
      stream.close();
      useSessionStore.getState().setGame(null, null);
      useLoomStore.getState().setTree([]);
      useLoomStore.getState().setCurrent(null);
      useWorldStore.getState().invalidate();
    };
  }, [gameId]);
};
