import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./ThemeImportModal.module.css";

/** Paste a theme JSON (validated against the Theme schema), store it
 *  server-side, and switch to it immediately. */
export function ThemeImportModal({ onClose }: { onClose: () => void }) {
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const importTheme = useThemesStore((state) => state.importTheme);
  const setThemeId = useUiStore((state) => state.setThemeId);

  const submit = async () => {
    setError(null);
    try {
      const theme = await importTheme(json);
      setThemeId(theme.meta.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      title="Import theme"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!json.trim()} onClick={() => void submit()}>
            Import & apply
          </Button>
        </>
      }
    >
      <p className={styles.hint}>
        Paste a theme JSON. Start from a preset in{" "}
        <code>packages/client/src/theme/presets/</code> and change <code>meta.id</code>.
      </p>
      <textarea
        className={styles.editor}
        rows={14}
        spellCheck={false}
        placeholder='{ "meta": { "id": "my-theme", "name": "My Theme", "scheme": "dark" }, ... }'
        value={json}
        onChange={(event) => setJson(event.target.value)}
      />
      {error ? <p className={styles.error}>{error}</p> : null}
    </Modal>
  );
}
