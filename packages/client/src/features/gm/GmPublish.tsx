import { useState } from "react";
import { BookOpen, CircleCheck, Download, LoaderCircle, Upload } from "lucide-react";
import type { Scenario } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { useSessionStore } from "../../stores/session.ts";
import { GmSection } from "./GmSection.tsx";
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
    <GmSection
      icon={BookOpen}
      title="Publish as scenario"
      hint="Saves this turn’s world as a reusable starting point — territory, polities, forces, and the eras that led here."
    >
      <div className={styles.formCard}>
        <Field
          label="Scenario id"
          value={id}
          spellCheck={false}
          onChange={(event) => edit(setId)(event.target.value)}
        />
        {id.trim() && !validId ? (
          <p className={styles.error}>Ids use lowercase letters, digits and hyphens (2–49 chars).</p>
        ) : (
          <p className={styles.fieldNote}>Lowercase letters, digits and hyphens. Never overwrites an existing pack.</p>
        )}
        <Field
          label="Name"
          value={name}
          onChange={(event) => edit(setName)(event.target.value)}
        />
        <TextAreaField
          label="Description"
          rows={3}
          placeholder="Leave empty to have one generated."
          value={description}
          onChange={(event) => edit(setDescription)(event.target.value)}
        />
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={includeChronicle}
            onChange={(event) => edit(setIncludeChronicle)(event.target.checked)}
          />
          <span className={styles.checkText}>
            <span>Carry this timeline’s history as inherited backstory</span>
            <span className={styles.checkSub}>The era chronicle becomes the new game’s past.</span>
          </span>
        </label>
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={busy || !validId || !name.trim()}
            onClick={() => void publish()}
          >
            {busy ? <LoaderCircle size={14} className={styles.spin} /> : <Upload size={14} />}
            {busy ? "Publishing…" : "Publish scenario"}
          </Button>
        </div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {published ? (
        <div className={styles.published}>
          <CircleCheck size={18} className={styles.publishedIcon} aria-hidden />
          <span className={styles.publishedBody}>
            <span>
              Published “{published.name}” — it appears in New Game now.
            </span>
            <a
              className={styles.link}
              href={`/api/games/${gameId}/nodes/${nodeId}/publish-scenario?id=${encodeURIComponent(published.id)}&download=1`}
              download={`${published.id}.json`}
            >
              <Download size={13} aria-hidden /> Download {published.id}.json
            </a>
          </span>
        </div>
      ) : null}
    </GmSection>
  );
}
