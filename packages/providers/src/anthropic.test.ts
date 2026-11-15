import { describe, expect, it } from "vitest";
import { AnthropicAdapter } from "./anthropic.ts";
import type { LlmRequest, ModelBinding } from "./types.ts";

/** A 400 shaped like the live endpoint's format rejection. */
const grammarReject = () =>
  Object.assign(
    new Error(
      "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.",
    ),
    { status: 400 },
  );

const textStream = (text: string) => ({
  async *[Symbol.asyncIterator]() {
    yield { type: "content_block_delta", delta: { type: "text_delta", text } };
  },
  async finalMessage() {
    return {
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      model: "stub-model",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  },
});

const throwingStream = (error: Error) => ({
  // eslint-disable-next-line require-yield
  async *[Symbol.asyncIterator]() {
    throw error;
  },
  async finalMessage() {
    throw error;
  },
});

const makeRequest = (): LlmRequest => ({
  taskLabel: "test-turn",
  system: [{ text: "You simulate the world.", cacheable: true }],
  messages: [{ role: "user", text: "advance one month" }],
  tool: {
    name: "turn",
    description: "the turn result",
    schema: { type: "object", properties: { ok: { type: "boolean" } } },
  },
});

const binding: ModelBinding = { model: "stub-model", maxOutput: 256 } as ModelBinding;

/** An adapter whose SDK client is a stub recording every request. */
const stubbedAdapter = (behave: (call: number) => unknown) => {
  const adapter = new AnthropicAdapter({ apiKey: "test-key" });
  const calls: Record<string, unknown>[] = [];
  (adapter as unknown as { client: unknown }).client = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        calls.push(params);
        return behave(calls.length);
      },
    },
  };
  return { adapter, calls };
};

const drain = async (adapter: AnthropicAdapter, req: LlmRequest) => {
  const stream = adapter.stream(req, binding);
  for await (const event of stream.events) void event;
  return stream.final<{ ok: boolean }>();
};

describe("the fallback ladder", () => {
  it("retries a format rejection without the format and carries the schema as text", async () => {
    const { adapter, calls } = stubbedAdapter((call) =>
      call === 1 ? throwingStream(grammarReject()) : textStream('{"ok":true}'),
    );

    const result = await drain(adapter, makeRequest());

    expect(calls).toHaveLength(2);
    const first = calls[0] as { output_config?: { format?: unknown } };
    const second = calls[1] as {
      output_config?: { format?: unknown };
      system: { text: string }[];
    };
    expect(first.output_config?.format).toBeDefined();
    expect(second.output_config?.format).toBeUndefined();
    const contract = second.system.at(-1);
    expect(contract?.text).toContain("JSON Schema");
    expect(contract?.text).toContain('"ok"');
    expect(result.structured).toEqual({ ok: true });
  });

  it("remembers the rejection per model and tool, skipping the doomed attempt next time", async () => {
    const { adapter, calls } = stubbedAdapter((call) =>
      call === 1 ? throwingStream(grammarReject()) : textStream('{"ok":true}'),
    );

    await drain(adapter, makeRequest());
    const result = await drain(adapter, makeRequest());

    // One rejected attempt + its fallback, then the second request goes
    // straight to the fallback: three calls, not four.
    expect(calls).toHaveLength(3);
    const third = calls[2] as {
      output_config?: { format?: unknown };
      system: { text: string }[];
    };
    expect(third.output_config?.format).toBeUndefined();
    expect(third.system.at(-1)?.text).toContain("JSON Schema");
    expect(result.structured).toEqual({ ok: true });
  });

  it("does not eat an unrelated 400", async () => {
    const unrelated = Object.assign(new Error("max_tokens is too large"), { status: 400 });
    const { adapter, calls } = stubbedAdapter(() => throwingStream(unrelated));

    const stream = adapter.stream(makeRequest(), binding);
    await expect(async () => {
      for await (const event of stream.events) void event;
    }).rejects.toThrow("max_tokens is too large");
    expect(calls).toHaveLength(1);
  });
});
