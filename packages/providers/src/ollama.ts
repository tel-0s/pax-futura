import { Ollama } from "ollama";
import type {
  LlmClient,
  LlmEvent,
  LlmRequest,
  LlmResult,
  LlmStream,
  ModelBinding,
} from "./types.ts";
import { emptyUsage } from "./types.ts";
import { extractJson } from "./extractJson.ts";

export interface OllamaAdapterOptions {
  baseUrl?: string;
}

/**
 * Native Ollama adapter. Preferred over its OpenAI shim because the native
 * `format` parameter does constrained decoding (reliable structured output
 * even on small local models) and streaming abort physically stops token
 * generation on the local server.
 */
export class OllamaAdapter implements LlmClient {
  private readonly client: Ollama;

  constructor(options: OllamaAdapterOptions = {}) {
    this.client = new Ollama({ host: options.baseUrl ?? "http://localhost:11434" });
  }

  stream(req: LlmRequest, binding: ModelBinding): LlmStream {
    let resolveFinal!: (result: LlmResult) => void;
    let rejectFinal!: (error: unknown) => void;
    const finalPromise = new Promise<LlmResult>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });

    const client = this.client;
    const events = (async function* (): AsyncGenerator<LlmEvent> {
      try {
        const stream = await client.chat({
          model: binding.model,
          stream: true,
          ...(req.tool ? { format: req.tool.schema } : {}),
          options: {
            num_predict: binding.maxOutput,
            num_ctx: binding.contextWindow,
            ...(binding.params?.temperature !== undefined
              ? { temperature: binding.params.temperature }
              : {}),
          },
          messages: [
            { role: "system", content: req.system.map((block) => block.text).join("\n\n") },
            ...req.messages.map((turn) => ({ role: turn.role, content: turn.text })),
          ],
        });

        const onAbort = () => stream.abort();
        req.signal?.addEventListener("abort", onAbort, { once: true });

        let text = "";
        let truncated = false;
        const usage = emptyUsage();
        try {
          for await (const chunk of stream) {
            if (chunk.message?.content) {
              text += chunk.message.content;
              yield { type: "text_delta", delta: chunk.message.content };
            }
            if (chunk.done) {
              usage.inputTokens = chunk.prompt_eval_count ?? 0;
              usage.outputTokens = chunk.eval_count ?? 0;
              // done_reason "length" = clipped at num_predict; callers must
              // never accept a salvaged prefix of a truncated response.
              truncated = (chunk as { done_reason?: string }).done_reason === "length";
            }
          }
        } catch (error) {
          if (req.signal?.aborted || isAbort(error)) {
            resolveFinal({ text, usage, model: binding.model, stopReason: "aborted" });
            return;
          }
          throw error;
        } finally {
          req.signal?.removeEventListener("abort", onAbort);
        }
        resolveFinal({ text, usage, model: binding.model, stopReason: truncated ? "max_tokens" : "end" });
      } catch (error) {
        rejectFinal(error);
        throw error;
      }
    })();

    return {
      events,
      final: async <T>(): Promise<LlmResult<T>> => {
        for await (const _event of events) void _event;
        const result = await finalPromise;
        if (!req.tool || result.stopReason !== "end") return result as LlmResult<T>;
        const parsed = extractJson(result.text);
        if (parsed === undefined) {
          return { ...result, structuredError: "Output was not parseable JSON." } as LlmResult<T>;
        }
        return { ...result, structured: parsed as T } as LlmResult<T>;
      },
    };
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
