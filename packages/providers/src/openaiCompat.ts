import OpenAI from "openai";
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
import { extractJson } from "./extractJson.ts";

/**
 * Persist the structured-output rung across process restarts. Both functions
 * are scoped to a single model — the adapter instance already corresponds to
 * one connection, so the caller closes over the connection id when wiring
 * these (see `llmProvider.buildProvider`).
 */
export interface RungHooks {
  getRung(model: string): Rung | undefined;
  setRung(model: string, rung: Rung): void;
}

export interface OpenAiCompatOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Optional persistence for the structured-output ladder; see `RungHooks`. */
  rungHooks?: RungHooks;
}

export type Rung = "json_schema" | "json_object";

/**
 * One adapter for every OpenAI-compatible endpoint (OpenRouter, Groq, Together,
 * LM Studio, llama.cpp, Ollama's /v1 shim). Structured-output ladder:
 * native json_schema response_format first; backends that reject it drop to
 * json_object + schema-in-prompt + salvage parse. The working rung is
 * remembered per model for the adapter's lifetime, and — when `rungHooks` is
 * wired — persisted so the ladder is climbed once per install, not once per
 * process.
 */
export class OpenAiCompatAdapter implements LlmClient {
  private readonly client: OpenAI;
  private readonly rungs = new Map<string, Rung>();
  private rungHooks?: RungHooks | undefined;

  constructor(options: OpenAiCompatOptions = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey ?? "not-needed",
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    });
    this.rungHooks = options.rungHooks;
  }

  /**
   * Attach persistence hooks after construction — used when the store the
   * hooks read/write (e.g. app.sqlite) isn't ready at construction time.
   */
  setRungHooks(hooks: RungHooks): void {
    this.rungHooks = hooks;
  }

  stream(req: LlmRequest, binding: ModelBinding): LlmStream {
    let resolveFinal!: (result: LlmResult) => void;
    let rejectFinal!: (error: unknown) => void;
    const finalPromise = new Promise<LlmResult>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });

    const events = this.streamWithLadder(req, binding, resolveFinal, rejectFinal);

    return {
      events,
      final: async <T>(): Promise<LlmResult<T>> => {
        for await (const _event of events) void _event;
        const result = await finalPromise;
        return this.parseStructured<T>(req, result);
      },
    };
  }

  private async *streamWithLadder(
    req: LlmRequest,
    binding: ModelBinding,
    resolveFinal: (result: LlmResult) => void,
    rejectFinal: (error: unknown) => void,
  ): AsyncGenerator<LlmEvent> {
    try {
      let attemptRung: Rung = req.tool
        ? (this.rungs.get(binding.model) ?? this.rungHooks?.getRung(binding.model) ?? "json_schema")
        : "json_schema";
      for (;;) {
        try {
          yield* this.run(req, binding, attemptRung, resolveFinal);
          return;
        } catch (error) {
          if (isAbort(error)) {
            resolveFinal({ text: "", usage: emptyUsage(), model: binding.model, stopReason: "aborted" });
            return;
          }
          // Backend rejected the structured-output feature: drop one rung for
          // this attempt (in-process). PERSIST only when the error message
          // actually implicates the feature — an unrelated 400 (context
          // length, bad param) must not poison the model's rung forever.
          if (req.tool && attemptRung === "json_schema" && isBadRequest(error)) {
            attemptRung = "json_object";
            this.rungs.set(binding.model, attemptRung);
            if (mentionsStructuredOutput(error)) {
              this.rungHooks?.setRung(binding.model, attemptRung);
            }
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      rejectFinal(error);
      throw error;
    }
  }

  private async *run(
    req: LlmRequest,
    binding: ModelBinding,
    rung: Rung,
    resolveFinal: (result: LlmResult) => void,
  ): AsyncGenerator<LlmEvent> {
    const systemText = req.system.map((block) => block.text).join("\n\n");
    const schemaNote =
      req.tool && rung === "json_object"
        ? `\n\nRespond ONLY with a JSON object matching this schema (no prose, no fences):\n${JSON.stringify(req.tool.schema)}`
        : "";

    const responseFormat = req.tool
      ? rung === "json_schema"
        ? ({
            type: "json_schema" as const,
            json_schema: { name: req.tool.name, schema: req.tool.schema, strict: true },
          } as const)
        : ({ type: "json_object" as const } as const)
      : undefined;

    const stream = await this.client.chat.completions.create(
      {
        model: binding.model,
        max_tokens: binding.maxOutput,
        stream: true,
        stream_options: { include_usage: true },
        ...(binding.params?.temperature !== undefined
          ? { temperature: binding.params.temperature }
          : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        messages: [
          { role: "system" as const, content: systemText + schemaNote },
          ...req.messages.map((turn) => ({ role: turn.role, content: turn.text })),
        ],
        ...(binding.params?.extra ?? {}),
      },
      { ...(req.signal ? { signal: req.signal } : {}) },
    );

    let text = "";
    let stopReason: StopReason = "end";
    const usage = emptyUsage();
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        yield { type: "text_delta", delta };
      }
      const finish = chunk.choices[0]?.finish_reason;
      if (finish === "length") stopReason = "max_tokens";
      if (finish === "content_filter") stopReason = "refusal";
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }
    resolveFinal({ text, usage, model: binding.model, stopReason });
  }

  private parseStructured<T>(req: LlmRequest, result: LlmResult): LlmResult<T> {
    if (!req.tool || result.stopReason === "aborted") return result as LlmResult<T>;
    if (result.stopReason === "refusal") {
      return { ...result, structuredError: "The model declined this request." } as LlmResult<T>;
    }
    const parsed = extractJson(result.text);
    if (parsed === undefined) {
      return {
        ...result,
        structuredError: "Structured output was not parseable JSON.",
      } as LlmResult<T>;
    }
    return { ...result, structured: parsed as T } as LlmResult<T>;
  }
}

const isAbort = (error: unknown): boolean =>
  (error instanceof Error && error.name === "AbortError") ||
  error instanceof OpenAI.APIUserAbortError;

const isBadRequest = (error: unknown): boolean =>
  error instanceof OpenAI.APIError && (error.status === 400 || error.status === 422);

/** Evidence the 4xx is about structured output, not some unrelated param. */
const mentionsStructuredOutput = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return ["response_format", "json_schema", "structured", "tool", "function"].some((needle) =>
    message.includes(needle),
  );
};
