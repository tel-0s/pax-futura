import type { Connection, LlmConfig } from "@pax/domain";
import type { LlmClient, ModelBinding } from "./types.ts";
import { AnthropicAdapter } from "./anthropic.ts";
import { OpenAiCompatAdapter } from "./openaiCompat.ts";
import { OllamaAdapter } from "./ollama.ts";

// Schemas live in @pax/domain (shared with the settings UI); re-export for
// server-side consumers that import from @pax/providers.
export { LlmConfigSchema, MODEL_ROLES } from "@pax/domain";
export type { Connection, LlmConfig, ModelRole, RoleBinding, RoleEntry } from "@pax/domain";

const connectionKey = (connection: Connection): string | undefined =>
  connection.apiKey || (connection.apiKeyEnv ? process.env[connection.apiKeyEnv] : undefined);

/** Minimal config = two bindings; advisor/diplomat/utility inherit. */
export const DEFAULT_LLM_CONFIG: LlmConfig = {
  connections: [{ id: "anthropic", kind: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" }],
  roles: {
    simulator: {
      connectionId: "anthropic",
      model: "claude-sonnet-5",
      contextWindow: 200000,
      maxOutput: 16000,
      params: { thinking: true },
    },
    extractor: {
      connectionId: "anthropic",
      model: "claude-haiku-4-5",
      contextWindow: 200000,
      maxOutput: 4096,
    },
    advisor: { inherit: "simulator" },
    diplomat: { inherit: "simulator" },
    utility: { inherit: "extractor" },
  },
};

/** Resolve a role to its concrete binding, following inherit chains. */
export const resolveRole = (config: LlmConfig, role: string): ModelBinding => {
  const seen = new Set<string>();
  let current = role;
  for (;;) {
    if (seen.has(current)) throw new Error(`Circular role inheritance at "${current}"`);
    seen.add(current);
    const entry = config.roles[current];
    if (!entry) throw new Error(`Unknown model role: "${current}"`);
    if ("inherit" in entry) {
      current = entry.inherit;
      continue;
    }
    const { params, ...rest } = entry;
    return { ...rest, ...(params ? { params } : {}) };
  }
};

/** Build the LlmClient for a connection. */
export const buildClient = (config: LlmConfig, connectionId: string): LlmClient => {
  const connection = config.connections.find((entry) => entry.id === connectionId);
  if (!connection) throw new Error(`Unknown connection: "${connectionId}"`);
  const apiKey = connectionKey(connection);
  switch (connection.kind) {
    case "anthropic":
      return new AnthropicAdapter({
        ...(apiKey ? { apiKey } : {}),
        ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
      });
    case "openai-compatible":
      return new OpenAiCompatAdapter({
        ...(apiKey ? { apiKey } : {}),
        ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
      });
    case "ollama":
      return new OllamaAdapter({
        ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
      });
  }
};

/** True when the connection behind a role has a usable credential. */
export const roleHasCredentials = (config: LlmConfig, role: string): boolean =>
  describeRoleProblem(config, role) === null;

/** Why a role can't run against a real provider, or null when it can. */
export const describeRoleProblem = (config: LlmConfig, role: string): string | null => {
  let binding: ModelBinding;
  try {
    binding = resolveRole(config, role);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const connection = config.connections.find((entry) => entry.id === binding.connectionId);
  if (!connection) {
    return `role "${role}" points at unknown connection "${binding.connectionId}"`;
  }
  if (connection.kind !== "ollama" && !connectionKey(connection)) {
    return `connection "${connection.id}" has no API key (add one in Settings${connection.apiKeyEnv ? ` or set $${connection.apiKeyEnv}` : ""})`;
  }
  return null;
};
