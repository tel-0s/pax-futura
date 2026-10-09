import { createReadStream, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".pmtiles": "application/octet-stream",
  ".json": "application/json",
  ".geojson": "application/geo+json",
};

/**
 * Range-aware static serving for map archives. PMTiles clients fetch small
 * byte ranges out of 100MB+ files — a handler without Range support would
 * stream whole archives per tile request.
 */
export const mountMapAssets = (app: Hono, assetsDir: string): void => {
  app.get("/assets/:file", (c) => {
    const file = basename(c.req.param("file"));
    const path = join(assetsDir, file);

    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return c.json({ error: "Unknown asset" }, 404);
    }

    const ext = file.slice(file.lastIndexOf("."));
    const headers: Record<string, string> = {
      "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=3600",
    };

    const range = c.req.header("range");
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : size - Number(match[2]);
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        return c.body(null, 416, { "content-range": `bytes */${size}` });
      }
      const stream = Readable.toWeb(
        createReadStream(path, { start, end }),
      ) as ReadableStream<Uint8Array>;
      return c.body(stream, 206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      });
    }

    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return c.body(stream, 200, { ...headers, "content-length": String(size) });
  });
};
