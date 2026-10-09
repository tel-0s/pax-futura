import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PolitySchema,
  newId,
  type CustomPolity,
  type DivergenceReport,
  type GameMeta,
  type GmEditInput,
  type Scenario,
  type TurnInput,
  type WorldState,
} from "@pax/domain";
import type { LlmClient, ModelBinding } from "@pax/providers";
import {
  ConflictError,
  NotFoundError,
  applyGmEdit,
  executeTurn,
  proposeMapReassessment,
  regenerateNode,
  runExtraction,
  type NodeRow,
  type SavePort,
} from "@pax/engine";
import type { Db } from "./db/openDb.ts";
import { backupSave, createSaveDb, deleteSaveBackups, openSaveDb, updateDifficulty } from "./db/saveDb.ts";
import { getRegistryEntry, listGames, registerGame, touchGame, unregisterGame } from "./db/appDb.ts";
import { makeSavePort } from "./savePort.ts";
import { SseHub } from "./sse/hub.ts";

export interface OpenGame {
  gameId: string;
  db: Db;
  port: SavePort;
  hub: SseHub;
  /** Non-null while a turn is running; guards the per-save mutex. */
  activeTurn: { nodeParentId: string; controller: AbortController } | null;
  /** Sequential background extraction queue (facts never race turns). */
  extractionQueue: Promise<void>;
  /**
   * Sibling-diff reports keyed "aId|bId" (exact order — the labels are
   * orientation-dependent). Inputs are frozen snapshots, so entries never
   * stale; process-lifetime only.
   */
  diffCache: Map<string, DivergenceReport>;
}

export class GameManager {
  private open = new Map<string, OpenGame>();
  /** Called per lookup so scenario files added while running appear without a restart. */
  private readonly loadScenarios: () => Map<string, Scenario>;

  private extractorLlm: LlmClient;
  private extractorBinding: ModelBinding;

  constructor(
    private readonly appDb: Db,
    private readonly dataDir: string,
    scenarios: Map<string, Scenario> | (() => Map<string, Scenario>),
    private llm: LlmClient,
    private binding: ModelBinding,
    extractorLlm?: LlmClient,
    extractorBinding?: ModelBinding,
  ) {
    this.loadScenarios = typeof scenarios === "function" ? scenarios : () => scenarios;
    this.extractorLlm = extractorLlm ?? llm;
    this.extractorBinding = extractorBinding ?? binding;
  }

  /** Live provider swap (settings UI); applies to all subsequent LLM calls. */
  setLlm(
    llm: LlmClient,
    binding: ModelBinding,
    extractorLlm?: LlmClient,
    extractorBinding?: ModelBinding,
  ): void {
    this.llm = llm;
    this.binding = binding;
    this.extractorLlm = extractorLlm ?? llm;
    this.extractorBinding = extractorBinding ?? binding;
  }

  /** Public extractor-role deps for utility features (gazette, exports). */
  utilityDeps(game: OpenGame) {
    return this.extractorDeps(game);
  }

  /** Deps for extractor-role work: facts, era summaries, reconciliation. */
  private extractorDeps(game: OpenGame) {
    return {
      store: game.port,
      llm: this.extractorLlm,
      binding: this.extractorBinding,
      emit: game.hub.emit.bind(game.hub),
    };
  }

  listScenarios(): Scenario[] {
    return [...this.loadScenarios().values()];
  }

  listGames() {
    return listGames(this.appDb);
  }

  createGame(params: {
    scenarioId: string;
    title: string;
    playerPolity: string;
    difficulty: string;
    customPolity?: CustomPolity | undefined;
  }): GameMeta {
    const scenario = this.loadScenarios().get(params.scenarioId);
    if (!scenario) throw new NotFoundError(`Unknown scenario: ${params.scenarioId}`);

    let world = scenario.world;
    let playerPolity = params.playerPolity;
    if (params.customPolity) {
      const applied = applyCustomPolity(scenario.world, params.customPolity);
      world = applied.world;
      playerPolity = applied.playerPolity;
    }

    const gameId = newId();
    const filePath = join(this.dataDir, `${gameId}.pax.sqlite`);
    const { db } = createSaveDb(filePath, {
      gameId,
      title: params.title,
      scenarioId: scenario.id,
      playerPolity,
      difficulty: params.difficulty,
      startDate: scenario.startDate,
      world,
    });
    registerGame(this.appDb, {
      gameId,
      filePath,
      title: params.title,
      scenarioId: scenario.id,
      playerPolity,
    });
    const port = makeSavePort(db);
    this.open.set(gameId, { gameId, db, port, hub: new SseHub(), activeTurn: null, extractionQueue: Promise.resolve(), diffCache: new Map() });
    return this.gameMeta(gameId);
  }

  get(gameId: string): OpenGame {
    const cached = this.open.get(gameId);
    if (cached) return cached;

    const entry = getRegistryEntry(this.appDb, gameId);
    if (!entry) throw new GameNotFoundError(gameId);
    if (!existsSync(entry.filePath)) throw new GameNotFoundError(gameId);
    const db = openSaveDb(entry.filePath);
    const game: OpenGame = { gameId, db, port: makeSavePort(db), hub: new SseHub(), activeTurn: null, extractionQueue: Promise.resolve(), diffCache: new Map() };
    this.open.set(gameId, game);
    touchGame(this.appDb, gameId);
    // Roll a backup of what was on disk before this process can write to it.
    // Fire-and-forget: opening a game must never block on, or fail because of,
    // a backup. Once per process per game — the open above is cached, and
    // createGame deliberately skips this (a fresh save has nothing to protect).
    void backupSave(db, entry.filePath).catch((error) =>
      console.warn(`Backup failed for game ${gameId}:`, error),
    );
    return game;
  }

  gameMeta(gameId: string): GameMeta {
    const game = this.get(gameId);
    const row = game.port.getGame();
    return {
      gameId: row.gameId,
      title: row.title,
      scenarioId: row.scenarioId,
      playerPolity: row.playerPolity,
      difficulty: row.difficulty,
      activeNodeId: row.activeNodeId,
      createdAt: row.createdAt,
    };
  }

  /** Live-swap the simulation-strictness rung; returns the refreshed meta. */
  setDifficulty(gameId: string, difficulty: string): GameMeta {
    const game = this.get(gameId);
    updateDifficulty(game.db, difficulty);
    return this.gameMeta(gameId);
  }

  deleteGame(gameId: string): void {
    const entry = getRegistryEntry(this.appDb, gameId);
    if (!entry) throw new GameNotFoundError(gameId);
    const open = this.open.get(gameId);
    if (open?.activeTurn) throw new TurnInProgressError();
    open?.db.close();
    this.open.delete(gameId);
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${entry.filePath}${suffix}`, { force: true });
    }
    // Deleting the game means deleting its data — orphaned snapshots would
    // otherwise persist forever (nothing ever prunes an unregistered game).
    deleteSaveBackups(entry.filePath);
    unregisterGame(this.appDb, gameId);
  }

  /** Execute (or regenerate) under the per-save turn mutex. */
  async runTurn(
    gameId: string,
    request:
      | { kind: "execute"; parentId: string; input: TurnInput; commit?: boolean }
      | { kind: "regenerate"; nodeId: string },
  ): Promise<NodeRow> {
    const game = this.get(gameId);
    if (game.activeTurn) throw new TurnInProgressError();

    const controller = new AbortController();
    game.activeTurn = {
      nodeParentId: request.kind === "execute" ? request.parentId : request.nodeId,
      controller,
    };
    try {
      const deps = {
        store: game.port,
        llm: this.llm,
        binding: this.binding,
        emit: game.hub.emit.bind(game.hub),
        reconcile: { llm: this.extractorLlm, binding: this.extractorBinding },
      };
      const node =
        request.kind === "execute"
          ? await executeTurn(deps, {
              parentId: request.parentId,
              input: request.input,
              signal: controller.signal,
              ...(request.commit === false ? { commit: false } : {}),
            })
          : await regenerateNode(deps, { nodeId: request.nodeId, signal: controller.signal });
      // Facts extraction runs in the background, strictly ordered per game;
      // the player reads the narrative while the extractor works.
      this.enqueueExtraction(game, node.id);
      return node;
    } finally {
      game.activeTurn = null;
    }
  }

  /**
   * Chain an extraction job onto the game's queue. The .catch terminates the
   * chain link: without it one rejection (e.g. the DB closing under an
   * in-flight job during deleteGame) becomes an unhandled rejection AND leaves
   * the queue permanently rejected, silently stopping all future extraction.
   */
  private enqueueExtraction(game: OpenGame, nodeId: string): void {
    const deps = this.extractorDeps(game);
    game.extractionQueue = game.extractionQueue
      .then(() => runExtraction(deps, nodeId))
      .catch((error) => console.warn(`Extraction job failed for node ${nodeId}:`, error));
  }

  /** Accept a ghost turn: make it the preferred child and check it out. */
  acceptNode(gameId: string, nodeId: string): GameMeta {
    const game = this.get(gameId);
    const node = game.port.getNode(nodeId);
    if (!node || node.status !== "complete") throw new NotFoundError(`Unknown node: ${nodeId}`);
    game.port.transaction(() => {
      if (node.parentId) {
        game.port.setPreferredChild(node.parentId, nodeId);
        game.port.clearPendingActions(node.parentId);
      }
      game.port.setActiveNode(nodeId);
    });
    const emit = game.hub.emit.bind(game.hub);
    // The parent's preferredChildId changed — without fresh metas the loom's
    // copy of both nodes goes stale until the next full tree fetch.
    for (const id of [node.parentId, nodeId]) {
      if (!id) continue;
      const meta = game.port.getNodeMeta(id);
      if (meta) emit({ type: "node.updated", node: meta });
    }
    emit({ type: "world.changed", nodeId });
    emit({ type: "game.meta", activeNodeId: nodeId });
    return this.gameMeta(gameId);
  }

  /**
   * Apply a GM intervention. No LLM and synchronous, but it still respects
   * the turn mutex (a mid-generation world edit would race the snapshot) and
   * feeds the extraction queue so derived facts stay continuous.
   */
  gmEdit(gameId: string, params: { parentId: string; input: GmEditInput }): NodeRow {
    const game = this.get(gameId);
    if (game.activeTurn) throw new TurnInProgressError();
    const emit = game.hub.emit.bind(game.hub);
    const node = applyGmEdit({ store: game.port, emit }, params);
    this.enqueueExtraction(game, node.id);
    return node;
  }

  /**
   * Dry-run map audit on the extractor role. Read-only; refuses to race an
   * in-flight turn so the proposal always reflects a settled snapshot.
   */
  async reassess(gameId: string, nodeId: string) {
    const game = this.get(gameId);
    if (game.activeTurn) throw new TurnInProgressError();
    return proposeMapReassessment(
      { store: game.port, llm: this.extractorLlm, binding: this.extractorBinding },
      { nodeId },
    );
  }

  /** Consistent snapshot of a save as bytes (WAL-safe via the backup API). */
  async exportGame(gameId: string): Promise<Buffer> {
    const game = this.get(gameId);
    // Stage in a private directory so a rejected/partial backup still leaves
    // nothing behind: one recursive rm covers the file and any sidecars.
    const stageDir = mkdtempSync(join(tmpdir(), "pax-export-"));
    try {
      const stagePath = join(stageDir, `${gameId}${SAVE_FILE_SUFFIX}`);
      await game.db.backup(stagePath);
      return readFileSync(stagePath);
    } finally {
      rmSync(stageDir, { recursive: true, force: true });
    }
  }

  /**
   * Import a save file. Nothing lands in the data dir until a staged copy has
   * opened, migrated and proved it carries a game row, so every rejection path
   * (not-SQLite, corrupt, schema-from-the-future, foreign database) leaves the
   * library exactly as it was. The staging directory is removed on every path —
   * opening a save spawns -wal/-shm sidecars and, for an old save, a
   * pre-migration snapshot beside the file, so the whole directory goes.
   *
   * Collisions re-key: importing a save whose gameId is already taken (or
   * whose file name is already occupied by an orphan) mints a fresh id, so the
   * same save can be imported repeatedly and every copy stays playable.
   */
  importGame(bytes: Buffer): GameMeta {
    if (!isSqliteFile(bytes)) {
      throw new ConflictError("Not a Pax Futura save (not a SQLite database)");
    }
    const stageDir = mkdtempSync(join(tmpdir(), "pax-import-"));
    const stagePath = join(stageDir, `candidate${SAVE_FILE_SUFFIX}`);
    try {
      writeFileSync(stagePath, bytes);
      const staged = this.stageImport(stagePath);
      const filePath = join(this.dataDir, `${staged.gameId}${SAVE_FILE_SUFFIX}`);
      copyFileSync(stagePath, filePath);
      registerGame(this.appDb, {
        gameId: staged.gameId,
        filePath,
        title: staged.title,
        scenarioId: staged.scenarioId,
        playerPolity: staged.playerPolity,
      });
      try {
        // Deliberately NOT pre-seeded into `open`: routing the first read
        // through get() is what opens the copy, touches the registry and rolls
        // its first backup, exactly as if the save had always been here.
        return this.gameMeta(staged.gameId);
      } catch (error) {
        this.open.get(staged.gameId)?.db.close();
        this.open.delete(staged.gameId);
        unregisterGame(this.appDb, staged.gameId);
        for (const suffix of ["", "-wal", "-shm"]) rmSync(`${filePath}${suffix}`, { force: true });
        throw error;
      }
    } finally {
      rmSync(stageDir, { recursive: true, force: true });
    }
  }

  /**
   * Open + migrate the staged candidate, re-keying it in place if its id is
   * taken. Returns the identity the copy will be registered under; throws
   * ConflictError (a 409 carrying the reason) rather than letting a raw
   * SQLite/migration error surface as an opaque 500.
   */
  private stageImport(stagePath: string): {
    gameId: string;
    title: string;
    scenarioId: string;
    playerPolity: string;
  } {
    let staged: Db;
    try {
      staged = openSaveDb(stagePath);
    } catch (error) {
      throw new ConflictError(`Cannot open this save: ${(error as Error).message}`);
    }
    try {
      let row: { gameId: string; title: string; scenarioId: string; playerPolity: string };
      try {
        row = makeSavePort(staged).getGame();
      } catch (error) {
        throw new ConflictError(`Not a Pax Futura save (${(error as Error).message})`);
      }
      // The embedded game_id is ATTACKER-CONTROLLED (it becomes the on-disk
      // filename). Anything that is not a plain ULID gets re-keyed — this is
      // the path-traversal guard, not just collision handling.
      const safeId = /^[0-9A-HJKMNP-TV-Z]{26}$/.test(row.gameId);
      const taken =
        !safeId ||
        this.open.has(row.gameId) ||
        getRegistryEntry(this.appDb, row.gameId) !== null ||
        existsSync(join(this.dataDir, `${row.gameId}${SAVE_FILE_SUFFIX}`));
      if (!taken) return row;
      const gameId = newId();
      staged.prepare("UPDATE game SET game_id = ? WHERE id = 'game'").run(gameId);
      return { ...row, gameId };
    } finally {
      staged.close(); // checkpoints and drops the WAL before we copy the file
    }
  }

  /** Test/ops hook: resolve when queued extractions have drained. */
  async drainExtractions(gameId: string): Promise<void> {
    await this.get(gameId).extractionQueue;
  }

  cancelTurn(gameId: string): boolean {
    const game = this.get(gameId);
    if (!game.activeTurn) return false;
    game.activeTurn.controller.abort();
    return true;
  }

  /** Chat deps for a game; chats reuse the simulator binding for now. */
  chatDeps(game: OpenGame) {
    return {
      store: game.port,
      llm: this.llm,
      binding: this.binding,
      emit: game.hub.emit.bind(game.hub),
    };
  }
}

/**
 * Fold a player-authored nation/organization into the scenario world.
 * Basing on an existing polity keeps its code (so the map keeps painting)
 * and replaces its identity; the original name survives as an alias so the
 * simulation understands the succession. Landless actors get a fresh code
 * and exist purely through events and diplomacy.
 */
const applyCustomPolity = (
  scenarioWorld: WorldState,
  custom: CustomPolity,
): { world: WorldState; playerPolity: string } => {
  const world = structuredClone(scenarioWorld) as WorldState;
  const color = custom.color ? (custom.color.startsWith("#") ? custom.color : `#${custom.color}`) : "";

  if (custom.baseCode) {
    const base = world.polities[custom.baseCode];
    if (!base) throw new NotFoundError(`Unknown base polity: ${custom.baseCode}`);
    world.polities[custom.baseCode] = {
      ...base,
      name: custom.name,
      color: color || base.color,
      flag: custom.flag || base.flag,
      tags: custom.tags.length > 0 ? custom.tags : base.tags,
      note: [custom.note, base.note].filter(Boolean).join(" — "),
      aliases: [base.name, ...base.aliases].filter(Boolean).slice(0, 6),
    };
    return { world, playerPolity: custom.baseCode };
  }

  if (!custom.code) throw new ConflictError("A landless actor needs a code (2-8 uppercase letters)");
  if (world.polities[custom.code]) {
    throw new ConflictError(`Code ${custom.code} already exists in this scenario`);
  }
  world.polities[custom.code] = PolitySchema.parse({
    code: custom.code,
    name: custom.name,
    color,
    flag: custom.flag,
    tags: custom.tags,
    note: custom.note,
  });
  return { world, playerPolity: custom.code };
};

const SAVE_FILE_SUFFIX = ".pax.sqlite";

/** SQLite's fixed 16-byte file header — the cheapest possible "is this a DB?". */
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "utf8");

const isSqliteFile = (bytes: Buffer): boolean =>
  bytes.length > SQLITE_MAGIC.length && bytes.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);

export class GameNotFoundError extends Error {
  constructor(gameId: string) {
    super(`Unknown game: ${gameId}`);
  }
}

export class TurnInProgressError extends Error {
  constructor() {
    super("A turn is already in progress for this game");
  }
}
