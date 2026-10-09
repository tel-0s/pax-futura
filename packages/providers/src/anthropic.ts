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

    const outputConfig: Record<string, unknown> = {};
    if (req.tool) {
      outputConfig.format = {
        type: "json_schema",
        schema: sanitizeJsonSchemaForAnthropic(req.tool.schema),
      };
    }
    if (binding.params?.effort) {
      outputConfig.effort = binding.params.effort;
    }

    const stream = this.client.messages.stream(
      {
        model: binding.model,
        max_tokens: binding.maxOutput,
        system: req.system.map((block, index) => ({
          type: "text" as const,
          text: block.text,
          ...(index === lastCacheableIndex
            ? { cache_control: { type: "ephemeral" as const } }
            : {}),
        })),
        messages: req.messages.map((turn) => ({ role: turn.role, content: turn.text })),
        ...(binding.params?.thinking ? { thinking: { type: "adaptive" as const } } : {}),
        ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
        ...(binding.params?.extra ?? {}),
      } as Parameters<typeof this.client.messages.stream>[0],
      { ...(req.signal ? { signal: req.signal } : {}) },
    );

    const events = (async function* (): AsyncGenerator<LlmEvent> {
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
      } catch (error) {
        if (!isAbort(error)) throw error;
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
          result.structuredError = `Structured output was not valid JSON: ${String(error)}`;
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
