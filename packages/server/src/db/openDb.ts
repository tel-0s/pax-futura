import Database from "better-sqlite3";

export type Db = Database.Database;

export const openDb = (path: string): Db => {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
};
