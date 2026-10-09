import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDb } from "../db/appDb.ts";
import { mountSavedPolities } from "./savedPolities.ts";

let dir: string;
let app: Hono;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pax-savedpol-"));
  app = new Hono();
  mountSavedPolities(app, openAppDb(dir));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const post = (body: unknown) =>
  app.request("/api/saved-polities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("saved polities library", () => {
  it("saves, lists, updates in place, and deletes", async () => {
    const created = await post({
      name: "Order of the Silver Dawn",
      code: "SILVDAWN",
      color: "#ff812a",
      flag: "🜲",
      tags: ["secretive", "technocratic"],
      note: "A transnational order.",
    });
    expect(created.status).toBe(201);
    const saved = (await created.json()) as { id: string; name: string };

    let list = (await (await app.request("/api/saved-polities")).json()) as Array<{ id: string; name: string }>;
    expect(list).toHaveLength(1);

    // Same id = update, not duplicate.
    const updated = await post({ id: saved.id, name: "Silver Dawn Ascendant", color: "#ff812a" });
    expect(updated.status).toBe(201);
    list = (await (await app.request("/api/saved-polities")).json()) as Array<{ id: string; name: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Silver Dawn Ascendant");

    const gone = await app.request(`/api/saved-polities/${saved.id}`, { method: "DELETE" });
    expect(gone.status).toBe(204);
    expect(await (await app.request("/api/saved-polities")).json()).toEqual([]);
  });

  it("rejects invalid payloads, strips per-scenario territory, 404s unknown deletes", async () => {
    expect((await post({ name: "" })).status).toBe(400);
    // baseCode names a polity of one specific scenario — never persisted.
    const withTerritory = await post({ name: "X", baseCode: "FRA" });
    expect(withTerritory.status).toBe(201);
    expect(await withTerritory.json()).not.toHaveProperty("baseCode");
    expect((await app.request("/api/saved-polities/nope", { method: "DELETE" })).status).toBe(404);
  });
});
