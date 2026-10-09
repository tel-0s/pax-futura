import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyWorld, newId } from "@pax/domain";
import { openDb, type Db } from "./openDb.ts";
import { backupSave, createSaveDb, getGame } from "./saveDb.ts";

const stampAt = (minute: number) => `2026-01-01T00-${String(minute).padStart(2, "0")}-00-000Z`;

let dir: string;
const opened: Db[] = [];

const makeSaveFile = (gameId: string) => {
  const filePath = join(dir, `${gameId}.pax.sqlite`);
  const { db } = createSaveDb(filePath, {
    gameId,
    title: "Backup Test",
    scenarioId: "test",
    playerPolity: "FRA",
    difficulty: "standard",
    startDate: "1936-01-01",
    world: emptyWorld(),
  });
  opened.push(db);
  return { db, filePath };
};

const backupNames = () => readdirSync(join(dir, "backups")).sort();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-backup-"));
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("backupSave", () => {
  it("writes a readable snapshot per stamp", async () => {
    const gameId = newId();
    const { db, filePath } = makeSaveFile(gameId);

    await backupSave(db, filePath, 3, stampAt(1));
    await backupSave(db, filePath, 3, stampAt(2));

    expect(backupNames()).toEqual([
      `${gameId}-${stampAt(1)}.pax.sqlite`,
      `${gameId}-${stampAt(2)}.pax.sqlite`,
    ]);

    const restored = openDb(join(dir, "backups", `${gameId}-${stampAt(2)}.pax.sqlite`));
    opened.push(restored);
    expect(getGame(restored).gameId).toBe(gameId);
    expect(getGame(restored).title).toBe("Backup Test");
  });

  it("prunes to the newest `keep` without touching other games", async () => {
    const gameId = newId();
    const otherId = newId();
    const { db, filePath } = makeSaveFile(gameId);
    const other = makeSaveFile(otherId);

    await backupSave(other.db, other.filePath, 3, stampAt(0));
    for (const minute of [1, 2, 3, 4]) {
      await backupSave(db, filePath, 3, stampAt(minute));
    }

    expect(backupNames()).toEqual(
      [
        `${gameId}-${stampAt(2)}.pax.sqlite`,
        `${gameId}-${stampAt(3)}.pax.sqlite`,
        `${gameId}-${stampAt(4)}.pax.sqlite`,
        `${otherId}-${stampAt(0)}.pax.sqlite`,
      ].sort(),
    );
  });

  it("rejects rather than throwing synchronously when the backup dir is unusable", async () => {
    const { db, filePath } = makeSaveFile(newId());
    // A plain file where the backups/ directory needs to be.
    writeFileSync(join(dir, "backups"), "not a directory");
    await expect(backupSave(db, filePath, 3, stampAt(1))).rejects.toThrow();
  });
});
