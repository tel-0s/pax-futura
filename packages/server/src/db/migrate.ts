import type { Db } from "./openDb.ts";

export interface Migration {
  version: number;
  sql: string;
}

/**
 * Forward-only migration runner keyed on PRAGMA user_version; serves app.sqlite
 * and every save file identically. Each migration runs in its own transaction.
 * Opening a database newer than the code refuses with a clear error, because
 * save files travel between machines and versions.
 */
export const migrate = (db: Db, migrations: readonly Migration[]): void => {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const latest = sorted.at(-1)?.version ?? 0;
  const current = db.pragma("user_version", { simple: true }) as number;

  if (current > latest) {
    throw new Error(
      `Database schema version ${current} is newer than this build supports (${latest}). ` +
        `Update Pax Futura to open this save.`,
    );
  }

  for (const migration of sorted) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
};
