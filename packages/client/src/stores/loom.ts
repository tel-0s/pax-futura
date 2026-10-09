import { create } from "zustand";
import type { SseEvent, TimelineNodeMeta } from "@pax/domain";

export interface TurnProgress {
  nodeId: string;
  phase: "assembling" | "generating" | "repairing" | "reconciling" | "applying";
  /** Rolling count of streamed characters, for the progress display. */
  streamedChars: number;
  lastEventTitle: string;
}

interface LoomState {
  nodes: Record<string, TimelineNodeMeta>;
  currentNodeId: string | null;
  /** In-flight generations keyed by node id (ghost cards). */
  pending: Record<string, TurnProgress>;
  /** Bumped on facts.updated — background extraction/era work landed; readers refetch. */
  factsVersion: number;

  setTree: (nodes: TimelineNodeMeta[]) => void;
  setCurrent: (nodeId: string | null) => void;
  applySse: (event: SseEvent) => void;
}

export const useLoomStore = create<LoomState>((set) => ({
  nodes: {},
  currentNodeId: null,
  pending: {},
  factsVersion: 0,

  setTree: (nodes) =>
    set({ nodes: Object.fromEntries(nodes.map((node) => [node.id, node])) }),

  setCurrent: (nodeId) => set({ currentNodeId: nodeId }),

  applySse: (event) =>
    set((state) => {
      switch (event.type) {
        case "facts.updated":
          return { factsVersion: state.factsVersion + 1 };
        case "node.created":
        case "node.updated": {
          const pending = { ...state.pending };
          if (event.node.status !== "generating") delete pending[event.node.id];
          return { nodes: { ...state.nodes, [event.node.id]: event.node }, pending };
        }
        case "node.deleted": {
          const nodes = { ...state.nodes };
          const pending = { ...state.pending };
          for (const id of event.nodeIds) {
            delete nodes[id];
            delete pending[id];
          }
          return { nodes, pending };
        }
        case "node.failed": {
          const pending = { ...state.pending };
          delete pending[event.nodeId];
          const node = state.nodes[event.nodeId];
          return {
            pending,
            nodes: node
              ? { ...state.nodes, [event.nodeId]: { ...node, status: "failed" } }
              : state.nodes,
          };
        }
        case "turn.progress":
          return {
            pending: {
              ...state.pending,
              [event.nodeId]: {
                nodeId: event.nodeId,
                phase: event.phase,
                streamedChars: state.pending[event.nodeId]?.streamedChars ?? 0,
                lastEventTitle: state.pending[event.nodeId]?.lastEventTitle ?? "",
              },
            },
          };
        case "llm.delta": {
          const progress = state.pending[event.nodeId];
          if (!progress) return state;
          return {
            pending: {
              ...state.pending,
              [event.nodeId]: {
                ...progress,
                streamedChars: progress.streamedChars + event.text.length,
              },
            },
          };
        }
        case "turn.event": {
          const progress = state.pending[event.nodeId];
          if (!progress) return state;
          return {
            pending: { ...state.pending, [event.nodeId]: { ...progress, lastEventTitle: event.title } },
          };
        }
        case "game.meta":
          return { currentNodeId: event.activeNodeId };
        default:
          return state;
      }
    }),
}));

/** The remembered root->leaf line: current path plus preferred children beyond. */
export const selectCurrentPath = (state: {
  nodes: Record<string, TimelineNodeMeta>;
  currentNodeId: string | null;
}): TimelineNodeMeta[] => {
  const { nodes, currentNodeId } = state;
  if (!currentNodeId || !nodes[currentNodeId]) return [];

  const backward: TimelineNodeMeta[] = [];
  let cursor: TimelineNodeMeta | undefined = nodes[currentNodeId];
  while (cursor) {
    backward.push(cursor);
    cursor = cursor.parentId !== null ? nodes[cursor.parentId] : undefined;
  }
  backward.reverse();

  let tail = backward.at(-1);
  while (tail?.preferredChildId && nodes[tail.preferredChildId]) {
    tail = nodes[tail.preferredChildId]!;
    backward.push(tail);
  }
  return backward;
};

/** Sibling group (same parent) for a node, in creation order. */
export const selectSiblings = (
  nodes: Record<string, TimelineNodeMeta>,
  nodeId: string,
): TimelineNodeMeta[] => {
  const node = nodes[nodeId];
  if (!node) return [];
  return Object.values(nodes)
    .filter((candidate) => candidate.parentId === node.parentId)
    .sort((a, b) => a.id.localeCompare(b.id));
};
