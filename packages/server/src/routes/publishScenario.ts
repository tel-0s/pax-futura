import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  PublishScenarioRequestSchema,
  ScenarioSchema,
  type EraSummary,
  type Scenario,
  type WorldState,
} from "@pax/domain";
import { collectChronicle } from "@pax/engine";
import type { GameManager } from "../gameManager.ts";

/**
 * The inherited-history block rides in simulationRules, which the simulator
 * re-reads on every single turn — so it is capped hard rather than complete.
 */
const HISTORY_CAP = 1500;
const HISTORY_HEADER = "Inherited history:";

const gist = (summary: string): string => {
  const sentence = summary.trim().split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  return sentence.length > 200 ? `${sentence.slice(0, 199)}…` : sentence;
};

/**
 * Era titles + one-sentence gists, closing with the final era's unresolved
 * threads. Oldest eras drop first: a new game inherits the shape of deep
 * history but needs the live commitments verbatim.
 */
const inheritedHistory = (eras: readonly EraSummary[]): string => {
  if (eras.length === 0) return "";
  const lines = eras.map((era) => `- ${era.startDate}–${era.endDate} ${era.title}: ${gist(era.summary)}`);
  const threads = (eras.at(-1)?.openThreads ?? []).map((thread) => thread.trim()).filter(Boolean);
  const threadLine = threads.length > 0 ? `Unresolved threads: ${threads.join("; ")}` : "";

  const compose = (kept: readonly string[]): string =>
    [
      HISTORY_HEADER,
      ...(kept.length < lines.length ? ["- (earlier eras elided)"] : []),
      ...kept,
      threadLine,
    ]
      .filter(Boolean)
      .join("\n");

  let kept = lines;
  while (kept.length > 1 && compose(kept).length > HISTORY_CAP) kept = kept.slice(1);
  const block = compose(kept);
  return block.length > HISTORY_CAP ? `${block.slice(0, HISTORY_CAP - 1)}…` : block;
};

/**
 * Everyone with a presence worth playing: territory owners, unit owners, and
 * the landless organizations in the registry (playable by design — they act
 * through diplomacy and events, never through the map).
 */
const playablePolities = (world: WorldState): Scenario["playablePolities"] => {
  const codes = new Set<string>([
    ...Object.keys(world.polities),
    ...Object.values(world.regionOwnership),
    ...world.units.map((unit) => unit.ownerCode),
  ]);
  return [...codes]
    .filter(Boolean)
    .map((code) => ({ code, name: world.polities[code]?.name || code }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
};

/** Remove an existing inherited-history block (header through its blank-line end). */
const stripInheritedBlock = (rules: string): string => {
  const start = rules.indexOf(HISTORY_HEADER);
  if (start === -1) return rules.trim();
  const end = rules.indexOf("\n\n", start);
  return (end === -1 ? rules.slice(0, start) : rules.slice(0, start) + rules.slice(end + 2)).trim();
};

const attach = (c: Context, id: string): void => {
  c.header("content-disposition", `attachment; filename="${id}.json"`);
};

/**
 * Branch -> scenario: publish a node's world as a reusable scenario pack in
 * scenarios/ (hot-rescanned, so it appears in New Game immediately). The pack
 * carries its own past: the era chronicle up to this node becomes inherited
 * history the new game's simulator reads as established backstory.
 */
export const mountPublishScenario = (app: Hono, manager: GameManager, scenariosDir: string): void => {
  const path = "/api/games/:g/nodes/:n/publish-scenario";

  app.post(path, zValidator("json", PublishScenarioRequestSchema), (c) => {
    const body = c.req.valid("json");
    const game = manager.get(c.req.param("g"));
    const node = game.port.getNode(c.req.param("n"));
    if (!node) return c.json({ error: "Unknown node" }, 404);
    if (node.status !== "complete") {
      return c.json({ error: `Cannot publish a ${node.status} turn` }, 409);
    }
    if (!node.worldBlobHash) return c.json({ error: "Node has no world snapshot" }, 409);

    const filePath = join(scenariosDir, `${body.id}.json`);
    if (existsSync(filePath)) return c.json({ error: `Scenario id "${body.id}" already exists` }, 409);

    const world = game.port.getWorld(node.worldBlobHash);
    const inherited = body.includeChronicle
      ? inheritedHistory(collectChronicle(game.port, node.id).eras)
      : "";
    // A game started FROM a published pack already carries an inherited-history
    // block (prepended, blank-line separated from the authored rules); strip it
    // by extent so republishing never stacks stale thread ledgers, while the
    // authored rules that FOLLOW the block survive.
    const authoredRules = stripInheritedBlock(world.simulationRules);

    const scenario: Scenario = ScenarioSchema.parse({
      id: body.id,
      name: body.name,
      description:
        body.description.trim() ||
        `The world of ${game.port.getGame().title} as of ${node.gameDate}`,
      startDate: node.gameDate,
      playablePolities: playablePolities(world),
      world: {
        ...world,
        simulationRules: [inherited, authoredRules].filter(Boolean).join("\n\n"),
      },
    });

    try {
      mkdirSync(scenariosDir, { recursive: true });
      // "wx" makes "never overwrite" structural, not just a check-then-write.
      writeFileSync(filePath, JSON.stringify(scenario, null, 2), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return c.json({ error: `Scenario id "${body.id}" already exists` }, 409);
      }
      throw error;
    }

    if (c.req.query("download")) attach(c, body.id);
    return c.json(scenario, 201);
  });

  // An <a download> can only GET, so the same path serves an already-published
  // pack back as a file — publishing itself stays POST-only.
  app.get(path, (c) => {
    const id = PublishScenarioRequestSchema.shape.id.safeParse(c.req.query("id"));
    if (!id.success) return c.json({ error: "Pass ?id= of a published scenario" }, 400);
    const filePath = join(scenariosDir, `${id.data}.json`);
    if (!existsSync(filePath)) return c.json({ error: `No published scenario "${id.data}"` }, 404);
    if (c.req.query("download")) attach(c, id.data);
    c.header("content-type", "application/json; charset=utf-8");
    return c.body(readFileSync(filePath, "utf8"));
  });
};
