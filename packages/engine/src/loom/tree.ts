import type { SseEvent } from "@pax/domain";
import type { SavePort } from "../ports.ts";

export type Emit = (event: SseEvent) => void;

/**
 * Check out a node. Read-only apart from two pointer updates: the game's
 * active node, and the preferred-child chain along the path so "forward"
 * stays deterministic and the loom strip renders the remembered line.
 */
export const navigateToNode = (store: SavePort, emit: Emit, nodeId: string): void => {
  const node = store.getNode(nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${nodeId}`);
  if (node.status === "generating") throw new ConflictError("Node is still generating");

  store.transaction(() => {
    store.setActiveNode(nodeId);
    const path = store.pathToRoot(nodeId);
    for (let i = 0; i < path.length - 1; i++) {
      const parent = path[i]!;
      const child = path[i + 1]!;
      if (parent.preferredChildId !== child.id) {
        store.setPreferredChild(parent.id, child.id);
      }
    }
  });
  emit({ type: "game.meta", activeNodeId: nodeId });
};

/** Delete a subtree; refuses when the checkout is inside it. */
export const deleteNodeSubtree = (store: SavePort, emit: Emit, nodeId: string): string[] => {
  const node = store.getNode(nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${nodeId}`);
  if (node.parentId === null) throw new ConflictError("Cannot delete the root node");

  const doomed = store.subtreeIds(nodeId);
  const activeNodeId = store.getGame().activeNodeId;
  if (doomed.includes(activeNodeId)) {
    throw new ConflictError("Cannot delete the subtree containing the active node");
  }

  store.transaction(() => {
    store.deleteSubtree(nodeId);
    store.collectGarbageBlobs();
  });
  emit({ type: "node.deleted", nodeIds: doomed });
  return doomed;
};

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
