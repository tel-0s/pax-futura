import { z } from "zod";
import { TurnInputSchema, StopPolicySchema, ActionSchema } from "../turn/action.ts";
import { ImpactsSchema } from "../turn/impacts.ts";
import { ConversationKindSchema, ConversationSchema, MessageSchema } from "../conversation/conversation.ts";
import { EraSummarySchema } from "../facts/eraSummary.ts";

export const NodeStatusSchema = z.enum(["generating", "complete", "failed"]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

/** The lightweight per-node record the whole loom UI runs on. */
export const TimelineNodeMetaSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  depth: z.number().int().min(0),
  status: NodeStatusSchema,
  gameDate: z.string(),
  summary: z.string(),
  /** Player-named bookmark ("Eve of the Anatolian War"); empty = unanchored. */
  anchor: z.string().default(""),
  preferredChildId: z.string().nullable(),
  eventCount: z.number().int().min(0),
  conversationCount: z.number().int().min(0),
  createdAt: z.number().int(),
});
export type TimelineNodeMeta = z.infer<typeof TimelineNodeMetaSchema>;

export const SetAnchorRequestSchema = z.object({ anchor: z.string().max(80) });

/** Publish a node's world as a reusable scenario pack. */
export const PublishScenarioRequestSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "lowercase letters, digits, hyphens"),
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  /** Feed the era chronicle up to this node to the new game as inherited history. */
  includeChronicle: z.boolean().default(true),
});
export type PublishScenarioRequest = z.infer<typeof PublishScenarioRequestSchema>;

/** One full-text search hit across events, facts, and conversations. */
export const SearchHitSchema = z.object({
  kind: z.enum(["event", "fact", "message"]),
  nodeId: z.string(),
  gameDate: z.string().default(""),
  title: z.string(),
  snippet: z.string().default(""),
  /** For message hits: the conversation to open. */
  conversationId: z.string().default(""),
});
export const SearchResponseSchema = z.object({ hits: z.array(SearchHitSchema).max(80) });
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** Compact per-node ownership fingerprint for loom-card mini bars. */
export const NodeFingerprintSchema = z.object({
  /** polity code -> owned region count (country-level entries count 4). */
  weights: z.record(z.string(), z.number().int().min(1)),
});
export type NodeFingerprint = z.infer<typeof NodeFingerprintSchema>;

/** The archivist's point-of-divergence account for a sibling comparison. */
export const DivergenceNarrativeSchema = z.object({
  title: z.string().min(1).max(80),
  narrative: z.string().min(1),
  keyDifferences: z.array(z.string().max(200)).max(8).default([]),
});
export type DivergenceNarrative = z.infer<typeof DivergenceNarrativeSchema>;

/** Deterministic world diff between two sibling turns + optional narrative. */
export const DivergenceReportSchema = z.object({
  aNodeId: z.string().min(1),
  bNodeId: z.string().min(1),
  regionChanges: z.array(
    z.object({
      regionId: z.string(),
      regionName: z.string().default(""),
      a: z.string().nullable(),
      b: z.string().nullable(),
    }),
  ),
  polityDiffs: z.array(z.string()),
  unitDiffs: z.array(z.string()),
  markerDiffs: z.array(z.string()),
  narrative: DivergenceNarrativeSchema.nullable(),
});
export type DivergenceReport = z.infer<typeof DivergenceReportSchema>;

/** One turn's front page, era-styled by the client. */
export const GazetteArticleSchema = z.object({
  headline: z.string().min(1),
  body: z.string().default(""),
  kind: z.string().default("dispatch"),
});
export const GazetteSchema = z.object({
  masthead: z.string().min(1),
  dateline: z.string().default(""),
  motto: z.string().default(""),
  articles: z.array(GazetteArticleSchema).min(1).max(8),
});
export type Gazette = z.infer<typeof GazetteSchema>;

/**
 * The five-rung difficulty ladder. It is really a GM-permissiveness scale:
 * every level lets the player TRY anything; the levels differ only in how
 * strictly the simulator constrains outcomes and how hard rivals push back.
 */
export const DIFFICULTIES = [
  {
    id: "sandbox",
    label: "Sandbox",
    description: "Almost anything you narrate happens; costs and blowback stay light. Rule-of-cool storytelling.",
  },
  {
    id: "permissive",
    label: "Permissive",
    description: "Bold plans usually succeed; failures stay soft and recoverable; rivals are slow to exploit you.",
  },
  {
    id: "standard",
    label: "Standard",
    description: "Plans succeed or fail on their merits against competent, self-interested rivals.",
  },
  {
    id: "challenging",
    label: "Challenging",
    description: "Plans need sound means, timing, and logistics; rivals actively probe and punish overreach.",
  },
  {
    id: "simulationist",
    label: "Simulationist",
    description: "Rigorous realism: capabilities, logistics, institutions, and politics govern every outcome.",
  },
] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];
export type DifficultyId = Difficulty["id"];

export const DifficultyIdSchema = z.enum([
  "sandbox",
  "permissive",
  "standard",
  "challenging",
  "simulationist",
]);

export const SetDifficultyRequestSchema = z.object({
  difficulty: DifficultyIdSchema,
});
export type SetDifficultyRequest = z.infer<typeof SetDifficultyRequestSchema>;

export const GameMetaSchema = z.object({
  gameId: z.string().min(1),
  title: z.string(),
  scenarioId: z.string(),
  playerPolity: z.string(),
  difficulty: z.string(),
  activeNodeId: z.string(),
  createdAt: z.number().int(),
});
export type GameMeta = z.infer<typeof GameMetaSchema>;

/**
 * A player-authored nation or organization. With `baseCode` set, it takes
 * over that scenario polity's map presence (code and territory stay, the
 * identity is replaced); without it, the actor is landless — a movement,
 * order, or organization living purely in diplomacy and events.
 */
export const CustomPolitySchema = z.object({
  name: z.string().min(1).max(80),
  /** Canonical code; required for landless actors, ignored when basing. */
  code: z
    .string()
    .regex(/^[A-Z0-9]{2,8}$/, "2-8 uppercase letters/digits")
    .optional(),
  /** Scenario polity whose map presence this actor takes over. */
  baseCode: z.string().optional(),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).or(z.literal("")).default(""),
  flag: z.string().max(100_000).default(""),
  tags: z.array(z.string().max(32)).max(8).default([]),
  /** Backstory/context injected into the simulation prompt. */
  note: z.string().max(2000).default(""),
});
export type CustomPolity = z.infer<typeof CustomPolitySchema>;

/**
 * A custom nation saved for reuse across games. Identity only — `baseCode`
 * names a polity of one specific scenario, so territory is re-chosen per game.
 */
export const SavedPolitySchema = CustomPolitySchema.omit({ baseCode: true }).extend({
  id: z.string().min(1),
  createdAt: z.number().int(),
});
export type SavedPolity = z.infer<typeof SavedPolitySchema>;

export const SavePolityRequestSchema = CustomPolitySchema.omit({ baseCode: true }).extend({
  /** Existing template id to update in place; omitted = create new. */
  id: z.string().min(1).optional(),
});
export type SavePolityRequest = z.infer<typeof SavePolityRequestSchema>;

export const CreateGameRequestSchema = z.object({
  scenarioId: z.string().min(1),
  title: z.string().min(1),
  playerPolity: z.string().min(1),
  difficulty: z.string().default("standard"),
  customPolity: CustomPolitySchema.optional(),
});
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;

export const ExecuteTurnRequestSchema = z.object({
  jumpDays: z.number().int().min(1).max(36500),
  stopPolicy: StopPolicySchema.default("toDate"),
  /** false = ghost turn: generated but not checked out — accept or discard. */
  commit: z.boolean().default(true),
});
export type ExecuteTurnRequest = z.infer<typeof ExecuteTurnRequestSchema>;

/** Dry-run map audit: proposed corrective impacts for player review. */
export const ReassessProposalSchema = z.object({
  impacts: ImpactsSchema,
  notes: z.array(z.string()),
  dropped: z.array(z.string()),
});
export type ReassessProposal = z.infer<typeof ReassessProposalSchema>;

/** A game-master intervention applied from the target node (creates a child). */
export const GmEditRequestSchema = z.object({
  note: z.string().max(200).default(""),
  impacts: ImpactsSchema,
});
export type GmEditRequest = z.infer<typeof GmEditRequestSchema>;

export const TreeResponseSchema = z.object({
  nodes: z.array(TimelineNodeMetaSchema),
});
export type TreeResponse = z.infer<typeof TreeResponseSchema>;

export const SetActiveNodeRequestSchema = z.object({
  nodeId: z.string().min(1),
});

export const AddActionRequestSchema = ActionSchema.omit({ id: true });

export const NodeDetailSchema = z.object({
  meta: TimelineNodeMetaSchema,
  input: TurnInputSchema.nullable(),
  pendingActions: z.array(ActionSchema),
});
export type NodeDetail = z.infer<typeof NodeDetailSchema>;

export const OpenConversationRequestSchema = z.object({
  kind: ConversationKindSchema,
  title: z.string().optional(),
  participants: z.array(z.string()).default([]),
});

export const SendChatMessageRequestSchema = z.object({
  text: z.string().min(1),
  /** Fork point for edit-and-fork; omitted = the node's current head. */
  parentMessageId: z.string().nullable().optional(),
});

export const SetHeadRequestSchema = z.object({ messageId: z.string().min(1) });

export const ConversationAtNodeSchema = ConversationSchema.extend({
  headMessageId: z.string().nullable(),
});
export type ConversationAtNode = z.infer<typeof ConversationAtNodeSchema>;

/**
 * The chronicle reader's payload: settled eras plus the turns after the last
 * summarized era, which have no era narrative yet and read as raw history.
 */
export const ChronicleResponseSchema = z.object({
  eras: z.array(EraSummarySchema),
  recent: z.array(
    z.object({
      depth: z.number().int(),
      gameDate: z.string(),
      summary: z.string(),
      lines: z.array(z.string()),
    }),
  ),
});
export type ChronicleResponse = z.infer<typeof ChronicleResponseSchema>;

export const ConversationTreeSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(MessageSchema),
});
export type ConversationTree = z.infer<typeof ConversationTreeSchema>;
