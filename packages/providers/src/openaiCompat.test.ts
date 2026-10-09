import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatAdapter, type Rung, type RungHooks } from "./openaiCompat.ts";
import type { LlmRequest, ModelBinding } from "./types.ts";

const encoder = new TextEncoder();

const sseBody = (deltas: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const delta of deltas) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ delta: { content: delta }, finish_reason: null }] })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`,
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

const okResponse = (structured: unknown): Response =>
  new Response(sseBody([JSON.stringify(structured)]), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

const badRequestResponse = (): Response =>
  new Response(JSON.stringify({ error: { message: "response_format not supported" } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

const binding: ModelBinding = {
  connectionId: "conn-1",
  model: "test-model",
  contextWindow: 32000,
  maxOutput: 2000,
};

const request: LlmRequest = {
  system: [{ text: "You are a test." }],
  messages: [{ role: "user", text: "hi" }],
  tool: { name: "submit_thing", description: "d", schema: { type: "object" } },
  taskLabel: "unitTest",
};

/** Fake persistence: an in-memory table standing in for provider_rungs. */
const makeFakeRungStore = (): { hooks: RungHooks; table: Map<string, Rung> } => {
  const table = new Map<string, Rung>();
  return {
    table,
    hooks: {
      getRung: (model) => table.get(model),
      setRung: (model, rung) => table.set(model, rung),
    },
  };
};

describe("OpenAiCompatAdapter rung persistence", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a dropped rung through hooks and a fresh adapter reads it back", async () => {
    const { hooks, table } = makeFakeRungStore();

    // First adapter (simulating one process): json_schema rejected, drops to
    // json_object, and — because hooks are wired — the drop is persisted.
    fetchMock
      .mockResolvedValueOnce(badRequestResponse())
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const first = new OpenAiCompatAdapter({ rungHooks: hooks });
    const result1 = await first.stream(request, binding).final();
    expect(result1.structured).toEqual({ ok: true });
    expect(table.get("test-model")).toBe("json_object");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second adapter (simulating a fresh process restart): same fake store,
    // never touched directly — attached via setRungHooks post-construction,
    // the way llmProvider wires a real adapter once its app db is ready.
    fetchMock.mockClear();
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true }));

    const second = new OpenAiCompatAdapter();
    second.setRungHooks(hooks);
    const result2 = await second.stream(request, binding).final();
    expect(result2.structured).toEqual({ ok: true });
    // Only one call: the ladder started on json_object, no rediscovery needed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("never persists when no hooks are wired", async () => {
    fetchMock
      .mockResolvedValueOnce(badRequestResponse())
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const adapter = new OpenAiCompatAdapter();
    const result = await adapter.stream(request, binding).final();
    expect(result.structured).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
