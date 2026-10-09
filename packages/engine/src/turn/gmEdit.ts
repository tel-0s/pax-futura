import { applyImpacts, newId, type EventDraft, type GmEditInput } from "@pax/domain";
import type { NodeRow, SavePort } from "../ports.ts";
import type { Emit } from "../loom/tree.ts";
import { ConflictError, NotFoundError } from "../loom/tree.ts";

export interface GmEditDeps {
  store: SavePort;
  emit: Emit;
}

/**
 * A game-master intervention as a loom node: the impacts apply verbatim to the
 * parent's world (no LLM, no time advance) and land as a same-date child that
 * inherits the parent's conversation heads. That keeps every debug edit
 * branchable, auditable through its event, and undoable by deleting the node —
 * the same lifecycle as any turn.
 */
export const applyGmEdit = (
  deps: GmEditDeps,
  params: { parentId: string; input: GmEditInput },
): NodeRow => {
  const { store, emit } = deps;
  const parent = store.getNode(params.parentId);
  if (!parent) throw new NotFoundError(`Unknown node: ${params.parentId}`);
  if (parent.status !== "complete") throw new ConflictError("Can only edit from a complete node");
  if (!parent.worldBlobHash) throw new ConflictError("Parent node has no world snapshot");

  const title = params.input.note.trim() || "GM edit";
  const event: EventDraft = {
    date: parent.gameDate,
    title,
    description: describeImpacts(params.input),
    kind: "gm",
    importance: "minor",
    playerRelated: false,
    impacts: params.input.impacts,
  };

  const world = store.getWorld(parent.worldBlobHash);
  const nextWorld = applyImpacts(world, [event], newId);

  const nodeId = newId();
  store.transaction(() => {
    store.insertNode({
      id: nodeId,
      parentId: parent.id,
      depth: parent.depth + 1,
      status: "generating",
      gameDate: parent.gameDate,
      input: params.input,
    });
    store.copyConversationHeads(parent.id, nodeId);
    const worldHash = store.putWorld(nextWorld);
    store.insertEvents(nodeId, [event]);
    store.completeNode({
      id: nodeId,
      gameDate: parent.gameDate,
      summary: `GM: ${title}`,
      worldBlobHash: worldHash,
    });
    store.setPreferredChild(parent.id, nodeId);
    store.setActiveNode(nodeId);
  });

  const meta = store.getNodeMeta(nodeId);
  if (meta) emit({ type: "node.created", node: meta });
  emit({ type: "world.changed", nodeId });
  emit({ type: "game.meta", activeNodeId: nodeId });

  const row = store.getNode(nodeId);
  if (!row) throw new ConflictError("GM node vanished after creation");
  return row;
};

const describeImpacts = (input: GmEditInput): string => {
  const { impacts } = input;
  const parts: string[] = [];
  for (const transfer of impacts.regionTransfers) {
    parts.push(
      transfer.toCode === null
        ? `${transfer.regionId} becomes unowned`
        : `${transfer.regionId} -> ${transfer.toCode}`,
    );
  }
  for (const change of impacts.polityChanges) parts.push(`polity ${change.code} updated`);
  for (const op of impacts.unitOps) {
    parts.push(op.op === "spawn" ? `unit spawned: ${op.unit.name}` : `unit ${op.op}: ${op.unitId}`);
  }
  for (const op of impacts.markerOps) {
    parts.push(op.op === "build" ? `marker built: ${op.marker.name}` : "marker removed");
  }
  return parts.join("; ") || "No mechanical changes.";
};
