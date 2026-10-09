import type { LlmToolSchema } from "@pax/domain";

export interface SystemBlock {
  text: string;
  /** Stable across calls within a save — placed first, cache-marked on Anthropic. */
  cacheable?: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface LlmRequest {
  system: SystemBlock[];
  messages: ChatTurn[];
  /** Present => structured task: the provider is forced onto this schema. */
  tool?: LlmToolSchema;
  maxTokens?: number;
  signal?: AbortSignal;
  /** For llm_calls logging and debugging. */
  taskLabel: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export type LlmEvent =
  | { type: "text_delta"; delta: string }
  | { type: "thinking"; delta: string };

export type StopReason = "end" | "max_tokens" | "refusal" | "aborted";

export interface LlmResult<T = unknown> {
  /** Full text (or raw JSON string for structured tasks). */
  text: string;
  /** Parsed payload when a tool schema was given and parsing succeeded. */
  structured?: T;
  /** Set instead of `structured` when parse/validation failed. */
  structuredError?: string;
  usage: Usage;
  model: string;
  stopReason: StopReason;
}

export interface LlmStream {
  events: AsyncIterable<LlmEvent>;
  /** Resolves after the stream completes and any structured parse ran. */
  final<T = unknown>(): Promise<LlmResult<T>>;
}

export interface ModelBinding {
  connectionId: string;
  model: string;
  contextWindow: number;
  maxOutput: number;
  params?: {
    effort?: "low" | "medium" | "high" | undefined;
    thinking?: boolean | undefined;
    temperature?: number | undefined;
    extra?: Record<string, unknown> | undefined;
  };
}

/** The one interface the engine sees; adapters and the fake implement it. */
export interface LlmClient {
  stream(req: LlmRequest, binding: ModelBinding): LlmStream;
}
