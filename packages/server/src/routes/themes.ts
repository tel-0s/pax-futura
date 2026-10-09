import type { Hono } from "hono";
import { ThemeSchema } from "@pax/domain";
import type { Db } from "../db/openDb.ts";
import { deleteTheme, listThemes, saveTheme } from "../db/appDb.ts";

/** Custom themes live in app.sqlite; presets ship with the client. */
export const mountThemes = (app: Hono, appDb: Db): void => {
  app.get("/api/themes", (c) => c.json(listThemes(appDb).map((theme) => theme.payload)));

  app.post("/api/themes", async (c) => {
    const parsed = ThemeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: `Invalid theme: ${parsed.error.issues[0]?.path.join(".")} — ${parsed.error.issues[0]?.message}` },
        400,
      );
    }
    saveTheme(appDb, parsed.data.meta.id, parsed.data.meta.name, parsed.data);
    return c.json(parsed.data, 201);
  });

  app.delete("/api/themes/:id", (c) =>
    deleteTheme(appDb, c.req.param("id"))
      ? c.body(null, 204)
      : c.json({ error: "Unknown theme" }, 404),
  );
};
