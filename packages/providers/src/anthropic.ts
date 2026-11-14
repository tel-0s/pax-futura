import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmClient,
  LlmEvent,
  LlmRequest,
  LlmResult,
  LlmStream,
  ModelBinding,
  StopReason,
} from "./types.ts";
import { emptyUsage } from "./types.ts";
import { sanitizeJsonSchemaForAnthropic } from "./jsonSchemaSanitize.ts";
import { extractJson } from "./extractJson.ts";

/** The endpoint refuses some valid schemas outright (unsupported keywords,
 * "The compiled grammar is too large" — deeply nested unions compile to
 * grammars far bigger than their JSON). Those 400s are about the format
 * request, not the conversation: retry once without structured output and
 * let the prompt's own contract plus the caller's Zod repair loop hold. */
const isFormatReject = (error: unknown): boolean => {
  const e = error as { status?: number; message?: string } | null;
  return e?.status === 400 && /compiled grammar|output_config\.format|json_schema|Schema type/i.test(String(e?.message ?? ""));
};

export interface AnthropicAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Thin adapter over the official SDK. Everything streams (physical cancel,
 * no HTTP timeouts on long simulations); structured tasks use the native
 * json_schema output format, with the caller's Zod schema re-validating
 * afterwards. One cache breakpoint goes on the last cacheable system block.
 */
export class AnthropicAdapter implements LlmClient {
  private readonly client: Anthropic;
  /** `${model}|${tool.name}` pairs whose format the endpoint has rejected:
   * the turn schema is refused every time, so without this each attempt
   * would first spend a full round trip on a request that cannot succeed
   * (the same memory OpenAICompatAdapter keeps per rung). */
  private readonly rejectedFormats = new Set<string>();

  constructor(options: AnthropicAdapterOptions = {}) {
    this.client = new Anthropic({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
  }

  stream(req: LlmRequest, binding: ModelBinding): LlmStream {
    const lastCacheableIndex = req.system.reduce(
      (last, block, index) => (block.cacheable ? index : last),
      -1,
    );

    const openStream = (structured: boolean) => {
      const outputConfig: Record<string, unknown> = {};
      if (structured && req.tool) {
        outputConfig.format = {
          type: "json_schema",
          schema: sanitizeJsonSchemaForAnthropic(req.tool.schema),
        };
      }
      if (binding.params?.effort) {
        outputConfig.effort = binding.params.effort;
      }
      // The no-format fallback carries the schema as text: the prompt's own
      // contract was written for stronger models, and prose can hold the
      // bounds the grammar compiler strips (strength caps, coordinate
      // ranges), so a small simulator keeps its rails.
      const fallbackContract =
        !structured && req.tool
          ? [{
              type: "text" as const,
              text: `OUTPUT CONTRACT: respond with ONLY one JSON object (no prose, no code fences) matching this JSON Schema exactly — required fields are required, nothing extra:\n${JSON.stringify(req.tool.schema)}`,
            }]
          : [];
      return this.client.messages.stream(
        {
          model: binding.model,
          max_tokens: binding.maxOutput,
          system: [...req.system.map((block, index) => ({
            type: "text" as const,
            text: block.text,
            ...(index === lastCacheableIndex
              ? { cache_control: { type: "ephemeral" as const } }
              : {}),
          })), ...fallbackContract],
          messages: req.messages.map((turn) => ({ role: turn.role, content: turn.text })),
          ...(binding.params?.thinking ? { thinking: { type: "adaptive" as const } } : {}),
          ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
          ...(binding.params?.extra ?? {}),
        } as Parameters<typeof this.client.messages.stream>[0],
        { ...(req.signal ? { signal: req.signal } : {}) },
      );
    };

    const formatKey = req.tool ? `${binding.model}|${req.tool.name}` : null;
    let fellBack = formatKey !== null && this.rejectedFormats.has(formatKey);
    let stream = openStream(!fellBack);
    const rejectedFormats = this.rejectedFormats;

    const events = (async function* (): AsyncGenerator<LlmEvent> {
      for (;;) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                yield { type: "text_delta", delta: event.delta.text };
              } else if (event.delta.type === "thinking_delta") {
                yield { type: "thinking", delta: event.delta.thinking };
              }
            }
          }
          return;
        } catch (error) {
          if (isAbort(error)) return;
          if (!fellBack && req.tool && isFormatReject(error)) {
            fellBack = true;
            if (formatKey) rejectedFormats.add(formatKey);
            stream = openStream(false);
            continue;
          }
          throw error;
        }
      }
    })();

    const final = async <T>(): Promise<LlmResult<T>> => {
      // Drain remaining events if the caller stopped iterating early.
      for await (const _event of events) {
        void _event;
      }
      let message: Anthropic.Message;
      try {
        message = await stream.finalMessage();
      } catch (error) {
        if (isAbort(error)) {
          return {
            text: "",
            usage: emptyUsage(),
            model: binding.model,
            stopReason: "aborted",
          };
        }
        throw error;
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      const stopReason = mapStopReason(message.stop_reason);
      const result: LlmResult<T> = {
        text,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
        model: message.model,
        stopReason,
      };

      if (req.tool && stopReason === "end") {
        try {
          result.structured = JSON.parse(text) as T;
        } catch (error) {
          // On the no-format fallback the model may wrap the JSON in prose.
          const extracted = fellBack ? extractJson(text) : undefined;
          if (extracted !== undefined) result.structured = extracted as T;
          else result.structuredError = `Structured output was not valid JSON: ${String(error)}`;
        }
      } else if (req.tool && stopReason === "refusal") {
        result.structuredError = "The model declined this request (safety refusal).";
      }

      return result;
    };

    return { events, final };
  }
}

const mapStopReason = (reason: string | null): StopReason => {
  switch (reason) {
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end";
  }
};

const isAbort = (error: unknown): boolean =>
  error instanceof Anthropic.APIUserAbortError ||
  (error instanceof Error && error.name === "AbortError");
