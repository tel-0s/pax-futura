import {
  ChronicleResponseSchema,
  ConversationAtNodeSchema,
  ConversationSchema,
  ConversationTreeSchema,
  DivergenceReportSchema,
  GameEventSchema,
  GameMetaSchema,
  GazetteSchema,
  LlmConfigSchema,
  NodeDetailSchema,
  NodeFingerprintSchema,
  PsycheSheetSchema,
  ReassessProposalSchema,
  SavedPolitySchema,
  SearchResponseSchema,
  StatSheetSchema,
  TimelineNodeMetaSchema,
  TreeResponseSchema,
  WorldStateSchema,
  type Action,
  type ChronicleResponse,
  type Conversation,
  type ConversationAtNode,
  type ConversationTree,
  type CreateGameRequest,
  type ExecuteTurnRequest,
  type GmEditRequest,
  type DivergenceReport,
  type GameEvent,
  type GameMeta,
  type Gazette,
  type LlmConfig,
  type PublishScenarioRequest,
  type Message,
  type NodeDetail,
  type PsycheSheet,
  type ReassessProposal,
  type NodeFingerprint,
  type SavedPolity,
  type SearchResponse,
  type SavePolityRequest,
  type Scenario,
  type StatSheet,
  type TimelineNodeMeta,
  type TreeResponse,
  type WorldState,
} from "@pax/domain";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const request = async <T>(
  path: string,
  schema: z.ZodType<T> | null,
  init?: RequestInit,
): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: unknown };
      // Validator middlewares can emit structured error objects — never let
      // "[object Object]" reach an alert.
      if (typeof body.error === "string") message = body.error;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  if (!schema) return undefined as T;
  return schema.parse(await res.json());
};

const ScenarioSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  startDate: z.string(),
  playablePolities: z.array(z.object({ code: z.string(), name: z.string() })),
});
export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;

const RegistryEntrySchema = z.object({
  gameId: z.string(),
  title: z.string(),
  scenarioId: z.string(),
  playerPolity: z.string(),
  lastPlayedAt: z.number().nullable(),
  createdAt: z.number(),
  filePath: z.string(),
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export const api = {
  listScenarios: (): Promise<ScenarioSummary[]> =>
    request("/scenarios", z.array(ScenarioSummarySchema)),

  listGames: (): Promise<RegistryEntry[]> => request("/games", z.array(RegistryEntrySchema)),

  createGame: (body: CreateGameRequest): Promise<GameMeta> =>
    request("/games", GameMetaSchema, { method: "POST", body: JSON.stringify(body) }),

  getGame: (gameId: string): Promise<GameMeta> => request(`/games/${gameId}`, GameMetaSchema),

  setDifficulty: (gameId: string, body: { difficulty: string }): Promise<GameMeta> =>
    request(`/games/${gameId}/difficulty`, GameMetaSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteGame: (gameId: string): Promise<void> =>
    request(`/games/${gameId}`, null, { method: "DELETE" }),

  getTree: (gameId: string): Promise<TreeResponse> =>
    request(`/games/${gameId}/tree`, TreeResponseSchema),

  getNode: (gameId: string, nodeId: string): Promise<NodeDetail> =>
    request(`/games/${gameId}/nodes/${nodeId}`, NodeDetailSchema),

  /** Leader psyche as of a node (nearest profiled ancestor); null if never profiled. */
  getPsyche: (gameId: string, nodeId: string, polity: string): Promise<PsycheSheet | null> =>
    request(
      `/games/${gameId}/nodes/${nodeId}/psyche/${encodeURIComponent(polity)}`,
      PsycheSheetSchema.nullable(),
    ),

  getWorld: (gameId: string, nodeId: string): Promise<WorldState> =>
    request(`/games/${gameId}/nodes/${nodeId}/world`, WorldStateSchema),

  listNodeEvents: (gameId: string, nodeId: string): Promise<GameEvent[]> =>
    request(`/games/${gameId}/nodes/${nodeId}/events`, z.array(GameEventSchema)),

  setActiveNode: (gameId: string, nodeId: string): Promise<{ activeNodeId: string }> =>
    request(`/games/${gameId}/active-node`, z.object({ activeNodeId: z.string() }), {
      method: "PUT",
      body: JSON.stringify({ nodeId }),
    }),

  executeTurn: (
    gameId: string,
    parentId: string,
    body: { jumpDays: number; stopPolicy?: ExecuteTurnRequest["stopPolicy"]; commit?: boolean },
  ) =>
    request<TimelineNodeMeta>(`/games/${gameId}/nodes/${parentId}/children`, null, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  reassess: (gameId: string, nodeId: string): Promise<ReassessProposal> =>
    request(`/games/${gameId}/nodes/${nodeId}/reassess`, ReassessProposalSchema, { method: "POST" }),

  gmEdit: (gameId: string, nodeId: string, body: GmEditRequest) =>
    request<TimelineNodeMeta>(`/games/${gameId}/nodes/${nodeId}/gm`, null, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  regenerate: (gameId: string, nodeId: string) =>
    request<TimelineNodeMeta>(`/games/${gameId}/nodes/${nodeId}/regenerate`, null, {
      method: "POST",
    }),

  deleteSubtree: (gameId: string, nodeId: string): Promise<{ deleted: string[] }> =>
    request(`/games/${gameId}/nodes/${nodeId}`, z.object({ deleted: z.array(z.string()) }), {
      method: "DELETE",
    }),

  cancelTurn: (gameId: string): Promise<{ cancelled: boolean }> =>
    request(`/games/${gameId}/cancel-turn`, z.object({ cancelled: z.boolean() }), {
      method: "POST",
    }),

  addAction: (gameId: string, nodeId: string, action: Omit<Action, "id">) =>
    request<Action>(`/games/${gameId}/nodes/${nodeId}/actions`, null, {
      method: "POST",
      body: JSON.stringify(action),
    }),

  removeAction: (gameId: string, nodeId: string, actionId: string): Promise<void> =>
    request(`/games/${gameId}/nodes/${nodeId}/actions/${actionId}`, null, { method: "DELETE" }),

  getLlmConfig: (): Promise<{ config: LlmConfig; provider: string; real: boolean }> =>
    request(
      "/llm-config",
      z.object({ config: LlmConfigSchema, provider: z.string(), real: z.boolean() }),
    ),

  putLlmConfig: (config: LlmConfig): Promise<{ provider: string; real: boolean }> =>
    request("/llm-config", z.object({ provider: z.string(), real: z.boolean() }).loose(), {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  getStatSheet: (gameId: string, nodeId: string, polity: string, force = false): Promise<StatSheet> =>
    request(
      `/games/${gameId}/nodes/${nodeId}/stat-sheet/${polity}${force ? "?force=1" : ""}`,
      StatSheetSchema,
    ),

  getChronicle: (gameId: string, nodeId: string): Promise<ChronicleResponse> =>
    request(`/games/${gameId}/nodes/${nodeId}/chronicle`, ChronicleResponseSchema),

  /** The bound-book export is a full document — open it, don't fetch it. */
  chronicleBookUrl: (gameId: string, nodeId: string): string =>
    `/api/games/${gameId}/nodes/${nodeId}/chronicle-book`,

  acceptNode: (gameId: string, nodeId: string): Promise<GameMeta> =>
    request(`/games/${gameId}/nodes/${nodeId}/accept`, GameMetaSchema, { method: "POST" }),

  search: (gameId: string, query: string): Promise<SearchResponse> =>
    request(`/games/${gameId}/search?q=${encodeURIComponent(query)}`, SearchResponseSchema),

  getFingerprint: (gameId: string, nodeId: string): Promise<NodeFingerprint> =>
    request(`/games/${gameId}/nodes/${nodeId}/fingerprint`, NodeFingerprintSchema),

  exportGameUrl: (gameId: string): string => `/api/games/${gameId}/export`,

  importGame: async (file: File): Promise<GameMeta> => {
    const res = await fetch("/api/games/import", { method: "POST", body: file });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      throw new ApiError(res.status, typeof body.error === "string" ? body.error : res.statusText);
    }
    return GameMetaSchema.parse(await res.json());
  },

  getDiff: (gameId: string, aId: string, bId: string): Promise<DivergenceReport> =>
    request(`/games/${gameId}/diff/${aId}/${bId}`, DivergenceReportSchema),

  getGazette: (gameId: string, nodeId: string): Promise<Gazette> =>
    request(`/games/${gameId}/nodes/${nodeId}/gazette`, GazetteSchema),

  publishScenario: (gameId: string, nodeId: string, body: PublishScenarioRequest) =>
    request<Scenario>(`/games/${gameId}/nodes/${nodeId}/publish-scenario`, null, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  setAnchor: (gameId: string, nodeId: string, anchor: string): Promise<TimelineNodeMeta> =>
    request(`/games/${gameId}/nodes/${nodeId}/anchor`, TimelineNodeMetaSchema, {
      method: "PUT",
      body: JSON.stringify({ anchor }),
    }),

  listSavedPolities: (): Promise<SavedPolity[]> =>
    request("/saved-polities", z.array(SavedPolitySchema)),

  savePolity: (body: SavePolityRequest): Promise<SavedPolity> =>
    request("/saved-polities", SavedPolitySchema, { method: "POST", body: JSON.stringify(body) }),

  deleteSavedPolity: (id: string): Promise<void> =>
    request(`/saved-polities/${id}`, null, { method: "DELETE" }),

  listConversations: (gameId: string, nodeId: string): Promise<ConversationAtNode[]> =>
    request(`/games/${gameId}/nodes/${nodeId}/conversations`, z.array(ConversationAtNodeSchema)),

  openConversation: (
    gameId: string,
    nodeId: string,
    body: { kind: "advisor" | "diplomacy"; title?: string; participants?: string[] },
  ): Promise<Conversation> =>
    request(`/games/${gameId}/nodes/${nodeId}/conversations`, ConversationSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getConversationTree: (gameId: string, conversationId: string): Promise<ConversationTree> =>
    request(`/games/${gameId}/conversations/${conversationId}/tree`, ConversationTreeSchema),

  sendChatMessage: (
    gameId: string,
    nodeId: string,
    conversationId: string,
    body: { text: string; parentMessageId?: string | null },
  ) =>
    request<{ userMessage: Message; assistantMessage: Message }>(
      `/games/${gameId}/nodes/${nodeId}/conversations/${conversationId}/messages`,
      null,
      { method: "POST", body: JSON.stringify(body) },
    ),

  regenerateReply: (gameId: string, nodeId: string, conversationId: string, messageId: string) =>
    request<Message>(
      `/games/${gameId}/nodes/${nodeId}/conversations/${conversationId}/messages/${messageId}/regenerate`,
      null,
      { method: "POST" },
    ),

  setConversationHead: (gameId: string, nodeId: string, conversationId: string, messageId: string) =>
    request<{ headMessageId: string }>(
      `/games/${gameId}/nodes/${nodeId}/conversations/${conversationId}/head`,
      null,
      { method: "PUT", body: JSON.stringify({ messageId }) },
    ),
};

export type { Scenario };
