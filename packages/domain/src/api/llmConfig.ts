import { z } from "zod";

/** Wire/config contracts for LLM providers — shared by server and settings UI. */
export const ConnectionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["anthropic", "openai-compatible", "ollama"]),
  baseUrl: z.string().optional(),
  /** Key stored directly (settings UI). Local single-user app storage. */
  apiKey: z.string().optional(),
  /** Or the name of an env var holding the key; `apiKey` wins when both set. */
  apiKeyEnv: z.string().optional(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const RoleBindingSchema = z.object({
  connectionId: z.string().min(1),
  model: z.string().min(1),
  contextWindow: z.number().int().positive(),
  maxOutput: z.number().int().positive(),
  params: z
    .object({
      effort: z.enum(["low", "medium", "high"]).optional(),
      thinking: z.boolean().optional(),
      temperature: z.number().optional(),
      extra: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export type RoleBinding = z.infer<typeof RoleBindingSchema>;

export const RoleEntrySchema = z.union([
  RoleBindingSchema,
  z.object({ inherit: z.string().min(1) }),
]);
export type RoleEntry = z.infer<typeof RoleEntrySchema>;

export const MODEL_ROLES = ["simulator", "extractor", "advisor", "diplomat", "utility"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const LlmConfigSchema = z
  .object({
    connections: z.array(ConnectionSchema).min(1),
    roles: z.record(z.string(), RoleEntrySchema),
  })
  .superRefine((config, ctx) => {
    // Reject dangling references loudly — a silently broken binding is how
    // the provider falls back to fake with no visible explanation.
    const connectionIds = new Set(config.connections.map((connection) => connection.id));
    if (connectionIds.size !== config.connections.length) {
      ctx.addIssue({ code: "custom", path: ["connections"], message: "Connection ids must be unique" });
    }
    if (!config.roles.simulator) {
      ctx.addIssue({ code: "custom", path: ["roles"], message: 'A "simulator" role is required' });
    }
    for (const [role, entry] of Object.entries(config.roles)) {
      if ("inherit" in entry) {
        if (!config.roles[entry.inherit]) {
          ctx.addIssue({
            code: "custom",
            path: ["roles", role],
            message: `Role "${role}" inherits unknown role "${entry.inherit}"`,
          });
        }
      } else if (!connectionIds.has(entry.connectionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["roles", role],
          message: `Role "${role}" points at unknown connection "${entry.connectionId}" — update its connection after renaming`,
        });
      }
    }
  });
export type LlmConfig = z.infer<typeof LlmConfigSchema>;
