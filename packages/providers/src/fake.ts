import type {
  LlmClient,
  LlmEvent,
  LlmRequest,
  LlmResult,
  LlmStream,
  ModelBinding,
} from "./types.ts";
import { emptyUsage } from "./types.ts";

export interface FakeResponse {
  /** Text deltas to stream before finishing. */
  deltas?: string[];
  /** Structured payload returned as `structured` (and serialized as text). */
  structured?: unknown;
  structuredError?: string;
  stopReason?: LlmResult["stopReason"];
}

export type FakeHandler = (req: LlmRequest, callIndex: number) => FakeResponse;

/**
 * Deterministic in-memory LlmClient: the whole loom + HTTP stack is testable
 * with zero LLM variability. Also honors AbortSignal so cancellation paths
 * are exercisable in tests.
 */
export class FakeLlmClient implements LlmClient {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly handler: FakeHandler) {}

  stream(req: LlmRequest, binding: ModelBinding): LlmStream {
    this.calls.push(req);
    const response = this.handler(req, this.calls.length - 1);
    const deltas = response.deltas ?? (response.structured ? [JSON.stringify(response.structured)] : []);

    let resolveFinal!: (result: LlmResult) => void;
    const finalPromise = new Promise<LlmResult>((resolve) => {
      resolveFinal = resolve;
    });

    const events = (async function* (): AsyncGenerator<LlmEvent> {
      let text = "";
      for (const delta of deltas) {
        if (req.signal?.aborted) {
          resolveFinal({ text, usage: emptyUsage(), model: binding.model, stopReason: "aborted" });
          return;
        }
        text += delta;
        yield { type: "text_delta", delta };
        // Yield to the event loop so abort signals interleave like a real stream.
        await Promise.resolve();
      }
      resolveFinal({
        text,
        ...(response.structured !== undefined ? { structured: response.structured } : {}),
        ...(response.structuredError !== undefined ? { structuredError: response.structuredError } : {}),
        usage: { ...emptyUsage(), inputTokens: 100, outputTokens: text.length },
        model: binding.model,
        stopReason: response.stopReason ?? "end",
      });
    })();

    return {
      events,
      final: async <T>(): Promise<LlmResult<T>> => {
        // Drain remaining events if the caller skipped iteration.
        for await (const _event of events) {
          void _event;
        }
        return (await finalPromise) as LlmResult<T>;
      },
    };
  }
}
