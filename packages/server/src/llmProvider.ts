import {
  FakeLlmClient,
  OpenAiCompatAdapter,
  buildClient,
  describeRoleProblem,
  resolveRole,
  type LlmClient,
  type LlmConfig,
  type LlmRequest,
  type LlmResult,
  type LlmStream,
  type ModelBinding,
} from "@pax/providers";
import { newId } from "@pax/domain";
import { loadConfig } from "./config.ts";
import type { Db } from "./db/openDb.ts";
import { getProviderRung, openAppDb, recordLlmUsage, setProviderRung } from "./db/appDb.ts";

/**
 * The app db handle used to back rung persistence and usage logging when the
 * caller (main.ts, unchanged) doesn't hand one in explicitly. Lazily opened
 * once — main.ts already opens its own handle to the same app.sqlite file for
 * settings/games; a second WAL connection to the same file is the same
 * pattern this codebase already uses for per-game save DBs, just pointed at
 * the app-level file instead.
 */
let lazyAppDb: Db | null = null;
const defaultAppDb = (): Db => {
  if (!lazyAppDb) lazyAppDb = openAppDb(loadConfig().dataDir);
  return lazyAppDb;
};

/** Attach persisted rung memory to an OpenAI-compatible client, if that's what it is. */
const attachRungHooks = (llm: LlmClient, connectionId: string, db: Db): void => {
  if (!(llm instanceof OpenAiCompatAdapter)) return;
  llm.setRungHooks({
    getRung: (model) => {
      const rung = getProviderRung(db, connectionId, model);
      return rung === "json_object" || rung === "json_schema" ? rung : undefined;
    },
    setRung: (model, rung) => setProviderRung(db, connectionId, model, rung),
  });
};

/**
 * Wrap a client so every completed call is logged (fire-and-forget; failures
 * never propagate — see `recordLlmUsage`). Note for later: this is the data
 * source the token budgeter will read from; nothing surfaces it in the UI yet.
 */
class UsageLoggingClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly db: Db,
  ) {}

  stream(req: LlmRequest, binding: ModelBinding): LlmStream {
    const startedAt = Date.now();
    const innerStream = this.inner.stream(req, binding);
    return {
      events: innerStream.events,
      final: async <T>(): Promise<LlmResult<T>> => {
        const result = await innerStream.final<T>();
        recordLlmUsage(this.db, {
          connectionId: binding.connectionId,
          model: binding.model,
          taskLabel: req.taskLabel,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
          durationMs: Date.now() - startedAt,
          stopReason: result.stopReason,
        });
        return result;
      },
    };
  }
}

const withUsageLogging = (llm: LlmClient, db: Db): LlmClient => new UsageLoggingClient(llm, db);

export interface ActiveProvider {
  llm: LlmClient;
  binding: ModelBinding;
  /** The extractor role's client/binding: facts, era summaries, reconciliation. */
  extractorLlm: LlmClient;
  extractorBinding: ModelBinding;
  label: string;
  extractorLabel: string;
  real: boolean;
}

/**
 * Resolve the active simulator (and extractor) from an LlmConfig: real
 * providers when the role's connection has credentials (Ollama always
 * counts), the deterministic fake otherwise so development never blocks on
 * keys. A broken extractor role falls back to the simulator binding rather
 * than the fake — structured extraction should degrade to "bigger model",
 * never to placeholders, while the simulator itself is real.
 */
export const buildProvider = (config: LlmConfig, appDb: Db = defaultAppDb()): ActiveProvider => {
  const problem = process.env.PAX_FAKE_LLM === "1" ? "PAX_FAKE_LLM=1" : describeRoleProblem(config, "simulator");
  if (!problem) {
    const binding = resolveRole(config, "simulator");
    const llm = buildClient(config, binding.connectionId);
    attachRungHooks(llm, binding.connectionId, appDb);
    const extractorProblem = describeRoleProblem(config, "extractor");
    const extractorBinding = extractorProblem ? binding : resolveRole(config, "extractor");
    const extractorLlm = extractorProblem
      ? llm
      : extractorBinding.connectionId === binding.connectionId
        ? llm
        : buildClient(config, extractorBinding.connectionId);
    if (extractorLlm !== llm) attachRungHooks(extractorLlm, extractorBinding.connectionId, appDb);
    return {
      llm: withUsageLogging(llm, appDb),
      binding,
      extractorLlm: withUsageLogging(extractorLlm, appDb),
      extractorBinding,
      label: `${binding.connectionId}/${binding.model}`,
      extractorLabel: extractorProblem
        ? `${binding.connectionId}/${binding.model} (extractor fallback: ${extractorProblem})`
        : `${extractorBinding.connectionId}/${extractorBinding.model}`,
      real: true,
    };
  }
  const fake = makeFakeLlm();
  const fakeBinding = { connectionId: "fake", model: "fake-sim-1", contextWindow: 100000, maxOutput: 8000 };
  const loggedFake = withUsageLogging(fake, appDb);
  return {
    llm: loggedFake,
    binding: fakeBinding,
    extractorLlm: loggedFake,
    extractorBinding: fakeBinding,
    label: `fake — ${problem}`,
    extractorLabel: `fake — ${problem}`,
    real: false,
  };
};

const makeFakeLlm = (): LlmClient =>
  new FakeLlmClient((req, index) => {
    // An unprompted overture: tool-free like chat, but it must read as someone
    // calling US, not as advice — otherwise the fake channel looks broken.
    if (req.taskLabel === "idleDiplomacy") {
      return {
        deltas: [
          "We will speak plainly, since events have outrun courtesy. ",
          "Our position has changed this season, and so has yours. ",
          "Tell us where you stand before others decide it for you. ",
          "(placeholder overture; add provider credentials in Settings for real diplomacy)",
        ],
      };
    }
    if (!req.tool) {
      return {
        deltas: [
          "Consider our position carefully. ",
          "The balance of power favors patience — ",
          "strengthen the frontier, court allies, and wait for the moment. ",
          `(placeholder ${req.taskLabel}; add provider credentials in Settings for real conversation)`,
        ],
      };
    }
    if (req.taskLabel === "statSheet") {
      return {
        structured: {
          stability: 60 + (index % 20),
          economy: 55 + (index % 25),
          military: 50 + (index % 30),
          diplomacy: 62,
          security: 58 + (index % 15),
          economics: {
            gdp: 2400 + index * 10,
            gdpUnit: "USD billions",
            growthPct: 1.8,
            inflationPct: 2.4,
          },
          assessment:
            "A stable position with room to maneuver. (Placeholder estimate — add provider credentials in Settings for grounded sheets.)",
          highlights: ["Placeholder highlight from the fake provider"],
        },
      };
    }
    if (req.taskLabel === "summarizeEra") {
      return {
        structured: {
          title: "The Opening Years",
          summary: "Placeholder era summary (fake provider).",
          openThreads: ["Placeholder ongoing project"],
        },
      };
    }
    if (req.taskLabel === "gazette") {
      return {
        structured: {
          masthead: "The Frontier Herald",
          dateline: "Placeholder edition (fake provider)",
          motto: "Ex nihilo, veritas.",
          articles: [
            {
              headline: "Placeholder Front Page",
              body: "Add provider credentials in Settings for a fully styled edition.",
              kind: "dispatch",
            },
          ],
        },
      };
    }
    if (req.taskLabel === "compareBranches") {
      return {
        structured: {
          title: "The Fork in the Road",
          narrative: "Placeholder divergence account (fake provider): the two branches parted ways over matters recorded below.",
          keyDifferences: ["Placeholder key difference"],
        },
      };
    }
    if (req.taskLabel === "updatePsyches") {
      return { structured: { updates: [] } };
    }
    if (req.taskLabel === "reconcileImpacts") {
      return { structured: { amendments: [] } };
    }
    if (req.taskLabel === "reassessMap") {
      return {
        structured: {
          notes: ["Placeholder reassessment: founded outpost restored to the map (fake provider)."],
          changes: {
            markerOps: [
              {
                op: "build",
                marker: { name: "Reassessed Outpost", kind: "outpost", ownerCode: "FRA", lng: 2.5, lat: 47.5 },
              },
            ],
          },
        },
      };
    }
    if (req.taskLabel === "extractFacts") {
      return {
        structured: {
          facts: [
            { type: "relationship_shift", pair: ["DEU", "FRA"], delta: -1, reason: "placeholder tension" },
            { type: "notable_event", headline: "Placeholder headline", polities: ["FRA"] },
          ],
        },
      };
    }
    return {
      deltas: ['{ "stopDate": ...', " }"],
      structured: {
        stopDate: `1936-${String((index % 12) + 1).padStart(2, "0")}-15`,
        summary: `Placeholder turn ${index + 1} (fake provider)`,
        events: [
          {
            date: `1936-${String((index % 12) + 1).padStart(2, "0")}-10`,
            title: `Placeholder event ${newId().slice(-4)}`,
            description: `Simulated without an LLM. Task: ${req.taskLabel}.`,
            impacts: {},
          },
        ],
      },
    };
  });
