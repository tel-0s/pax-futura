import {
  TurnResultSchema,
  applyImpacts,
  isGmInput,
  newId,
  type TurnInput,
  type TurnResult,
} from "@pax/domain";
import type { ChatTurn, LlmClient, LlmRequest, ModelBinding } from "@pax/providers";
import type { NodeRow, SavePort } from "../ports.ts";
import type { Emit } from "../loom/tree.ts";
import { ConflictError, NotFoundError } from "../loom/tree.ts";
import { buildTurnRequest } from "../prompts/assemble.ts";
import { reconcileTurnImpacts } from "./reconcile.ts";
import { validateTurnResult } from "./validate.ts";

export interface TurnDeps {
  store: SavePort;
  llm: LlmClient;
  binding: ModelBinding;
  emit: Emit;
  /** Extractor-role client for the reconciliation pass; defaults to the simulator. */
  reconcile?: { llm: LlmClient; binding: ModelBinding };
}

export class TurnFailedError extends Error {}

export class CancelledError extends Error {
  constructor() {
    super("Turn cancelled");
  }
}

/**
 * Execute a turn from `parentId`, creating a child node. Regeneration is the
 * same call with a sibling's frozen input.
 *
 * Generation discipline (ported from the reference's hard-won 2-attempt
 * shape): attempt 1 strict; on shape or semantic failure, attempt 2 replays
 * the conversation with a corrective message; attempt 2's result is accepted
 * after deterministic salvage (drop invalid sub-ops, clamp dates). Total
 * failure keeps a retryable failed node — never canned fallback events.
 * Cancellation leaves no node at all.
 */
export const executeTurn = async (
  deps: TurnDeps,
  params: { parentId: string; input: TurnInput; signal?: AbortSignal; commit?: boolean },
): Promise<NodeRow> => {
  const { store, emit } = deps;
  const parent = store.getNode(params.parentId);
  if (!parent) throw new NotFoundError(`Unknown node: ${params.parentId}`);
  if (parent.status !== "complete") throw new ConflictError("Can only execute from a complete node");
  if (!parent.worldBlobHash) throw new ConflictError("Parent node has no world snapshot");

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
  });
  emitNodeMeta(store, emit, "node.created", nodeId);

  try {
    emit({ type: "turn.progress", nodeId, phase: "assembling" });
    const world = store.getWorld(parent.worldBlobHash);
    const game = store.getGame();
    const request = buildTurnRequest({
      store,
      game,
      parent,
      world,
      input: params.input,
      ...(params.signal ? { signal: params.signal } : {}),
    });

    let turn = await generateWithRepair(deps, {
      nodeId,
      request,
      world,
      parent,
      ...(params.signal ? { signal: params.signal } : {}),
    });

    // Cartographer pass: a short-context extractor-model check that narrated
    // map changes actually carry impacts (long-context simulators drift).
    emit({ type: "turn.progress", nodeId, phase: "reconciling" });
    turn = await reconcileTurnImpacts(deps.reconcile ?? { llm: deps.llm, binding: deps.binding }, {
      turn,
      world,
      parentDate: parent.gameDate,
      ...(game.playerPolity ? { playerPolity: game.playerPolity } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    if (params.signal?.aborted) throw new CancelledError();

    emit({ type: "turn.progress", nodeId, phase: "applying" });
    for (const event of turn.events) {
      emit({ type: "turn.event", nodeId, title: event.title });
    }

    // Ghost turns (commit: false) persist the node fully but do NOT move the
    // checkout or the preferred path — the player accepts (activate) or
    // discards (delete subtree) afterwards. Pending actions are kept so a
    // discarded scout doesn't eat the order queue.
    const commit = params.commit !== false;
    const nextWorld = applyImpacts(world, turn.events, newId);
    store.transaction(() => {
      const worldHash = store.putWorld(nextWorld);
      store.insertEvents(nodeId, turn.events);
      store.completeNode({ id: nodeId, gameDate: turn.stopDate, summary: turn.summary, worldBlobHash: worldHash });
      if (commit) {
        store.clearPendingActions(parent.id);
        store.setPreferredChild(parent.id, nodeId);
        store.setActiveNode(nodeId);
      }
    });

    emitNodeMeta(store, emit, "node.updated", nodeId);
    if (commit) {
      emit({ type: "world.changed", nodeId });
      emit({ type: "game.meta", activeNodeId: nodeId });
    }
    const row = store.getNode(nodeId);
    if (!row) throw new TurnFailedError("Node vanished after completion");
    return row;
  } catch (error) {
    if (error instanceof CancelledError || params.signal?.aborted) {
      store.deleteSubtree(nodeId);
      emit({ type: "node.deleted", nodeIds: [nodeId] });
      throw new CancelledError();
    }
    store.failNode(nodeId, error);
    emit({
      type: "node.failed",
      nodeId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/** Attempt 1 strict; attempt 2 corrective replay; salvage on acceptance. */
const generateWithRepair = async (
  deps: TurnDeps,
  params: {
    nodeId: string;
    request: LlmRequest;
    world: Parameters<typeof validateTurnResult>[1];
    parent: NodeRow;
    signal?: AbortSignal;
  },
): Promise<TurnResult> => {
  const { llm, binding, emit } = deps;
  const { nodeId, request, world, parent } = params;

  const attempt = async (req: LlmRequest): Promise<{ turn?: TurnResult; problems: string[]; raw: string }> => {
    emit({ type: "turn.progress", nodeId, phase: "generating" });
    const stream = llm.stream(req, binding);
    for await (const event of stream.events) {
      if (event.type === "text_delta") {
        emit({ type: "llm.delta", nodeId, text: event.delta });
      }
    }
    const result = await stream.final<unknown>();

    if (result.stopReason === "aborted" || params.signal?.aborted) throw new CancelledError();
    if (result.stopReason === "refusal") {
      throw new TurnFailedError(
        result.structuredError ?? "The model declined this content — rephrase your orders or switch the simulator model.",
      );
    }
    // Truncation MUST be rejected before any parsing: the salvage layer can
    // recover a syntactically valid prefix of a clipped events array (often a
    // single bare headline), which would otherwise be accepted as the turn.
    if (result.stopReason === "max_tokens") {
      return {
        problems: [
          "Your output was truncated at the max-output-token limit before the turn result completed. Return the complete turn result again, more compactly: fewer events, tighter descriptions, minimal deliberation.",
        ],
        raw: result.text,
      };
    }
    if (result.structuredError !== undefined || result.structured === undefined) {
      return { problems: [result.structuredError ?? "No structured payload returned."], raw: result.text };
    }

    const parsed = TurnResultSchema.safeParse(result.structured);
    if (!parsed.success) {
      return {
        problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        raw: result.text,
      };
    }
    return { turn: parsed.data, problems: [], raw: result.text };
  };

  const first = await attempt(request);
  const accepted = first.turn;
  let semanticErrors: string[] = [];
  if (accepted) {
    const outcome = validateTurnResult(accepted, world, parent.gameDate);
    if (outcome.errors.length === 0) return outcome.salvaged;
    semanticErrors = outcome.errors;
  }

  // Attempt 2: replay the conversation with a corrective message.
  emit({ type: "turn.progress", nodeId, phase: "repairing" });
  const problems = accepted ? semanticErrors : first.problems;
  const correction: ChatTurn[] = [
    ...request.messages,
    { role: "assistant", text: first.raw || "(no output)" },
    {
      role: "user",
      text: `Your previous output failed validation:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nReturn a complete, corrected turn result via the schema. Fix only the listed problems; keep everything else consistent with your previous output.`,
    },
  ];
  const second = await attempt({ ...request, messages: correction });

  if (second.turn) {
    // Accept attempt 2 after deterministic salvage even with residual warnings.
    return validateTurnResult(second.turn, world, parent.gameDate).salvaged;
  }
  if (accepted) {
    // Attempt 1 was shape-valid but semantically flawed and the repair failed:
    // salvage attempt 1 rather than losing the turn.
    return validateTurnResult(accepted, world, parent.gameDate).salvaged;
  }
  if (second.problems.some((problem) => problem.includes("max-output-token"))) {
    throw new TurnFailedError(
      "The simulator's output kept hitting its max-output-token limit. Raise the simulator's Max output in Settings (or reduce its thinking budget), then retry the turn.",
    );
  }
  throw new TurnFailedError(
    `Simulator output failed validation twice: ${second.problems.join("; ")}`,
  );
};

/** Re-roll a turn: a sibling from the same parent and the same frozen input. */
export const regenerateNode = async (
  deps: TurnDeps,
  params: { nodeId: string; signal?: AbortSignal },
): Promise<NodeRow> => {
  const node = deps.store.getNode(params.nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${params.nodeId}`);
  if (node.parentId === null) throw new ConflictError("Cannot regenerate the root node");
  if (isGmInput(node.input)) {
    throw new ConflictError("GM edits are deterministic — there is nothing to regenerate");
  }
  // Ghost-ness is not persisted, but it is derivable: a node that is neither
  // the checkout nor its parent's preferred child was never committed —
  // regenerating it must not silently commit the re-roll either.
  const parent = deps.store.getNode(node.parentId);
  const game = deps.store.getGame();
  const wasCommitted = game.activeNodeId === node.id || parent?.preferredChildId === node.id;
  return executeTurn(deps, {
    parentId: node.parentId,
    input: node.input,
    ...(params.signal ? { signal: params.signal } : {}),
    ...(wasCommitted ? {} : { commit: false }),
  });
};

const emitNodeMeta = (
  store: SavePort,
  emit: Emit,
  type: "node.created" | "node.updated",
  nodeId: string,
): void => {
  const meta = store.getNodeMeta(nodeId);
  if (meta) emit({ type, node: meta });
};
