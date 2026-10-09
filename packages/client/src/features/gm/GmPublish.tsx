import { useState } from "react";
import type { Scenario } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { useSessionStore } from "../../stores/session.ts";
import styles from "./gm.module.css";

/** Mirrors the server's id rule: lowercase, digits, hyphens, 2-49 chars. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;

const slugify = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 49);
  return ID_PATTERN.test(slug) ? slug : "published-branch";
};

/**
 * Branch -> scenario: turn this node's world into a scenario pack other games
 * can start from. The pack inherits this timeline's era chronicle as backstory,
 * so a new game begins with a past instead of a blank map.
 */
export function GmPublish({ gameId, nodeId }: { gameId: string; nodeId: string }) {
  const title = useSessionStore((state) => state.meta?.title ?? "");
  const [id, setId] = useState(() => slugify(title));
  const [name, setName] = useState(title);
  const [description, setDescription] = useState("");
  const [includeChronicle, setIncludeChronicle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState<Scenario | null>(null);

  const validId = ID_PATTERN.test(id.trim());
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPublished(null);
    setError("");
  };

  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      setPublished(
        await api.publishScenario(gameId, nodeId, {
          id: id.trim(),
          name: name.trim(),
          description: description.trim(),
          includeChronicle,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Publish as scenario</h3>
      <p className={styles.hint}>
        Saves this turn’s world as a reusable starting point — territory, polities, forces, and the
        eras that led here.
      </p>
      <Field
        label="Scenario id (lowercase, hyphens)"
        value={id}
        onChange={(event) => edit(setId)(event.target.value)}
      />
      {id.trim() && !validId ? (
        <p className={styles.error}>Ids use lowercase letters, digits and hyphens (2–49 chars).</p>
      ) : null}
      <Field
        label="Name"
        value={name}
        onChange={(event) => edit(setName)(event.target.value)}
      />
      <TextAreaField
        label="Description (empty = generated)"
        rows={2}
        value={description}
        onChange={(event) => edit(setDescription)(event.target.value)}
      />
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={includeChronicle}
          onChange={(event) => edit(setIncludeChronicle)(event.target.checked)}
        />
        <span>Carry this timeline’s history as inherited backstory</span>
      </label>
      <Button
        variant="primary"
        disabled={busy || !validId || !name.trim()}
        onClick={() => void publish()}
      >
        {busy ? "Publishing…" : "Publish scenario"}
      </Button>
      {error ? <p className={styles.error}>{error}</p> : null}
      {published ? (
        <>
          <p className={styles.success}>
            Published “{published.name}” — it appears in New Game now.
          </p>
          <a
            className={styles.link}
            href={`/api/games/${gameId}/nodes/${nodeId}/publish-scenario?id=${encodeURIComponent(published.id)}&download=1`}
            download={`${published.id}.json`}
          >
            Download {published.id}.json
          </a>
        </>
      ) : null}
    </section>
  );
}
