import type { Hono } from "hono";
import { SavePolityRequestSchema, newId } from "@pax/domain";
import type { Db } from "../db/openDb.ts";
import { deleteSavedPolity, listSavedPolities, saveSavedPolity } from "../db/appDb.ts";

/**
 * The reusable-nations library, app-level like themes. Saving with an existing
 * id updates that entry (load → tweak → save keeps one template, not a copy).
 */
export const mountSavedPolities = (app: Hono, appDb: Db): void => {
  app.get("/api/saved-polities", (c) => c.json(listSavedPolities(appDb)));

  app.post("/api/saved-polities", async (c) => {
    const parsed = SavePolityRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json({ error: `Invalid nation: ${issue?.path.join(".")} — ${issue?.message}` }, 400);
    }
    const { id, ...polity } = parsed.data;
    const saved = { ...polity, id: id ?? newId(), createdAt: Date.now() };
    saveSavedPolity(appDb, saved);
    return c.json(saved, 201);
  });

  app.delete("/api/saved-polities/:id", (c) =>
    deleteSavedPolity(appDb, c.req.param("id"))
      ? c.body(null, 204)
      : c.json({ error: "Unknown saved nation" }, 404),
  );
};
