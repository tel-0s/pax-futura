import type { Hono } from "hono";
import { LlmConfigSchema, type LlmConfig } from "@pax/providers";

export interface LlmConfigHandle {
  get: () => { config: LlmConfig; provider: string; real: boolean };
  /** Persist + rebuild the live provider; returns the new provider label. */
  update: (config: LlmConfig) => { provider: string; real: boolean };
}

export const mountLlmConfig = (app: Hono, handle: LlmConfigHandle): void => {
  app.get("/api/llm-config", (c) => c.json(handle.get()));

  app.put("/api/llm-config", async (c) => {
    const parsed = LlmConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json({ error: `Invalid config: ${issue?.path.join(".")} — ${issue?.message}` }, 400);
    }
    try {
      const result = handle.update(parsed.data);
      return c.json({ config: parsed.data, ...result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
};
