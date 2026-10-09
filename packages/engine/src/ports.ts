import type {
  Action,
  Conversation,
  ConversationKind,
  EraSummary,
  EventDraft,
  Fact,
  GameEvent,
  Message,
  NodeStatus,
  Rollup,
  Gazette,
  StatSheet,
  TimelineNodeMeta,
  NodeInput,
  WorldState,
} from "@pax/domain";

export interface GameRow {
  gameId: string;
  title: string;
  scenarioId: string;
  playerPolity: string;
  difficulty: string;
  activeNodeId: string;
  createdAt: number;
}

export interface NodeRow {
  id: string;
  parentId: string | null;
  depth: number;
  status: NodeStatus;
  gameDate: string;
  input: NodeInput;
  summary: string;
  worldBlobHash: string | null;
  preferredChildId: string | null;
  extractionStatus: "none" | "pending" | "done" | "failed";
  errorJson: string | null;
  createdAt: number;
}

/**
 * Everything the engine needs from persistence, implemented by the server
 * over SQLite and by tests over the same stores on :memory: databases.
 * The engine stays free of better-sqlite3 (and of Node, in principle).
 */
export interface SavePort {
  transaction<T>(fn: () => T): T;

  getGame(): GameRow;
  setActiveNode(nodeId: string): void;

  getNode(id: string): NodeRow | null;
  getNodeMeta(id: string): TimelineNodeMeta | null;
  listNodeMetas(): TimelineNodeMeta[];
  insertNode(params: {
    id: string;
    parentId: string | null;
    depth: number;
    status: NodeStatus;
    gameDate: string;
    input: NodeInput;
    summary?: string;
    worldBlobHash?: string | null;
  }): void;
  completeNode(params: { id: string; gameDate: string; summary: string; worldBlobHash: string }): void;
  failNode(id: string, error: unknown): void;
  setPreferredChild(parentId: string, childId: string | null): void;
  pathToRoot(nodeId: string): NodeRow[];
  subtreeIds(nodeId: string): string[];
  deleteSubtree(nodeId: string): void;

  putWorld(world: WorldState): string;
  getWorld(hash: string): WorldState;
  collectGarbageBlobs(): number;

  insertEvents(nodeId: string, drafts: readonly EventDraft[]): GameEvent[];
  listEventsForNode(nodeId: string): GameEvent[];
  listEventsForNodes(nodeIds: readonly string[]): GameEvent[];

  listPendingActions(nodeId: string): Action[];
  clearPendingActions(nodeId: string): void;

  copyConversationHeads(fromNodeId: string, toNodeId: string): void;

  createConversation(params: {
    kind: ConversationKind;
    title: string;
    participants: string[];
    nodeId: string;
  }): Conversation;
  getConversation(id: string): Conversation | null;
  conversationsAtNode(nodeId: string): Array<Conversation & { headMessageId: string | null }>;
  /** Insert an immutable message row; `id` may be pre-assigned for streaming. */
  insertMessage(message: Omit<Message, "id"> & { id?: string }): Message;
  listMessages(conversationId: string): Message[];
  /** Root -> head path; a head id fully determines the selected branch. */
  messagePath(headMessageId: string): Message[];
  setConversationHead(nodeId: string, conversationId: string, headMessageId: string | null): void;

  insertFacts(nodeId: string, facts: readonly Fact[], source: "derived" | "extracted", startSeq?: number): void;
  listFactsForNode(nodeId: string): Fact[];
  setRollup(nodeId: string, rollup: Rollup): void;
  getRollup(nodeId: string): Rollup | null;
  setExtractionStatus(nodeId: string, status: "none" | "pending" | "done" | "failed"): void;

  getStatSheet(nodeId: string, polity: string): StatSheet | null;
  setStatSheet(sheet: StatSheet): void;

  getGazette(nodeId: string): Gazette | null;
  setGazette(nodeId: string, gazette: Gazette): void;

  getEraSummary(startNodeId: string, endNodeId: string): EraSummary | null;
  putEraSummary(summary: EraSummary): void;
}
