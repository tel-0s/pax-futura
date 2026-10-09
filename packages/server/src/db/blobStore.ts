import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Db } from "./openDb.ts";

/**
 * Content-addressed JSON blob storage. World snapshots are highly repetitive
 * JSON, so gzip lands at roughly 10-20x compression; dedup by sha256 makes
 * no-op turns and identical regenerations free.
 */
export const putJsonBlob = (db: Db, value: unknown): string => {
  const json = JSON.stringify(value);
  const hash = createHash("sha256").update(json).digest("hex");
  const exists = db.prepare("SELECT 1 FROM blobs WHERE hash = ?").get(hash);
  if (!exists) {
    db.prepare(
      "INSERT INTO blobs (hash, codec, uncompressed_len, data, created_at) VALUES (?, 'gzip', ?, ?, ?)",
    ).run(hash, Buffer.byteLength(json), gzipSync(Buffer.from(json)), Date.now());
  }
  return hash;
};

export const getJsonBlob = <T = unknown>(db: Db, hash: string): T => {
  const row = db.prepare("SELECT codec, data FROM blobs WHERE hash = ?").get(hash) as
    | { codec: string; data: Buffer }
    | undefined;
  if (!row) {
    throw new Error(`Blob not found: ${hash}`);
  }
  const json = row.codec === "gzip" ? gunzipSync(row.data).toString("utf8") : row.data.toString("utf8");
  return JSON.parse(json) as T;
};

/** Drop blobs no longer referenced by any node or static asset. */
export const collectGarbageBlobs = (db: Db): number => {
  const result = db
    .prepare(
      `DELETE FROM blobs WHERE hash NOT IN (
         SELECT world_blob_hash FROM timeline_nodes WHERE world_blob_hash IS NOT NULL
         UNION
         SELECT blob_hash FROM static_assets
       )`,
    )
    .run();
  return result.changes;
};
