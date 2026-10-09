import { useMemo, useRef, useState } from "react";
import { CircleAlert, CircleCheck, FileUp, Palette } from "lucide-react";
import { ThemeSchema, type Theme } from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { PRESET_THEMES } from "../../theme/presets.ts";
import { ThemeSpecimen } from "./ThemeSpecimen.tsx";
import styles from "./ThemeImportModal.module.css";

type Analysis =
  | { state: "empty" }
  | { state: "syntax"; message: string }
  | { state: "invalid"; issues: string[]; more: number }
  | { state: "preset"; theme: Theme }
  | { state: "valid"; theme: Theme };

/** Live validation — the same schema the store (and server) will apply. */
const analyse = (json: string): Analysis => {
  if (!json.trim()) return { state: "empty" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { state: "syntax", message: error instanceof Error ? error.message : String(error) };
  }
  const parsed = ThemeSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"} — ${issue.message}`,
    );
    return { state: "invalid", issues: issues.slice(0, 6), more: Math.max(0, issues.length - 6) };
  }
  if (PRESET_THEMES.some((preset) => preset.meta.id === parsed.data.meta.id)) {
    return { state: "preset", theme: parsed.data };
  }
  return { state: "valid", theme: parsed.data };
};

/** A preset as an editable starting point, re-identified so it can be imported. */
const fromPreset = (preset: Theme): string =>
  JSON.stringify(
    {
      ...preset,
      meta: { ...preset.meta, id: `${preset.meta.id}-custom`, name: `${preset.meta.name} (custom)` },
    },
    null,
    2,
  );

/** Paste a theme JSON (validated against the Theme schema), store it
 *  server-side, and switch to it immediately. */
export function ThemeImportModal({ onClose }: { onClose: () => void }) {
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const importTheme = useThemesStore((state) => state.importTheme);
  const setThemeId = useUiStore((state) => state.setThemeId);
  const gutter = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => analyse(json), [json]);
  const lineCount = Math.max(18, json.split("\n").length);

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

  const load = (text: string) => {
    setError(null);
    setJson(text);
  };

  return (
    <Modal
      kicker="Appearance"
      title="Import theme"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <span className={styles.footHint}>
            <kbd>⌘</kbd>
            <kbd>Enter</kbd> to import
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={analysis.state !== "valid"}
            onClick={() => void submit()}
          >
            Import &amp; apply
          </Button>
        </>
      }
    >
      <div className={styles.starts}>
        <span className="pfKicker">Start from</span>
        {PRESET_THEMES.map((preset) => (
          <button
            key={preset.meta.id}
            className={styles.preset}
            title={`Load ${preset.meta.name} as a starting point`}
            onClick={() => load(fromPreset(preset))}
          >
            <span className={styles.presetDots} aria-hidden>
              {[preset.color.surface[1], preset.color.accent.base, preset.map.land].map((color, index) => (
                <span key={index} className={styles.presetDot} style={{ background: color }} />
              ))}
            </span>
            <span style={{ fontFamily: preset.font.display, fontSizeAdjust: preset.font.displayAdjust ?? undefined }}>
              {preset.meta.name}
            </span>
          </button>
        ))}
        <button className={styles.preset} onClick={() => file.current?.click()}>
          <FileUp size={13} /> Open file…
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) void picked.text().then(load);
            event.target.value = "";
          }}
        />
      </div>

      <div className={styles.workbench}>
        <div className={`${styles.editor} ${analysis.state === "syntax" || analysis.state === "invalid" ? styles.editorBad : ""}`}>
          <div ref={gutter} className={styles.gutter} aria-hidden>
            {Array.from({ length: lineCount }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
          <textarea
            className={styles.code}
            spellCheck={false}
            wrap="off"
            aria-label="Theme JSON"
            placeholder={'{\n  "meta": { "id": "my-theme", "name": "My Theme", "scheme": "dark" },\n  …\n}'}
            value={json}
            onChange={(event) => load(event.target.value)}
            onScroll={(event) => {
              if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && analysis.state === "valid") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <aside className={styles.preview} aria-live="polite">
          <span className="pfKicker">Preview</span>
          {analysis.state === "valid" || analysis.state === "preset" ? (
            <>
              <div className={styles.specimen}>
                <ThemeSpecimen theme={analysis.theme} />
              </div>
              <span
                className={styles.themeName}
                style={{
                  fontFamily: analysis.theme.font.display,
                  fontSizeAdjust: analysis.theme.font.displayAdjust ?? undefined,
                }}
              >
                {analysis.theme.meta.name}
              </span>
              {analysis.theme.meta.tagline ? (
                <span className={styles.tagline}>{analysis.theme.meta.tagline}</span>
              ) : null}
              <div className={styles.chips}>
                {[
                  ...analysis.theme.color.surface,
                  analysis.theme.color.accent.base,
                  analysis.theme.color.semantic.success,
                  analysis.theme.color.semantic.warning,
                  analysis.theme.color.semantic.danger,
                ].map((color, index) => (
                  <span key={index} className={styles.chip} style={{ background: color }} title={color} />
                ))}
              </div>
              <div className={styles.facts}>
                <Badge>{analysis.theme.meta.scheme}</Badge>
                <Badge>{analysis.theme.style.corners}</Badge>
                {analysis.theme.style.ornament !== "none" ? <Badge>{analysis.theme.style.ornament}</Badge> : null}
                {analysis.theme.style.texture !== "none" ? <Badge>{analysis.theme.style.texture}</Badge> : null}
              </div>
              {analysis.state === "preset" ? (
                <p className={styles.problem}>
                  <CircleAlert size={14} /> &ldquo;{analysis.theme.meta.id}&rdquo; is a built-in preset id —
                  change <code>meta.id</code> to import it.
                </p>
              ) : (
                <p className={styles.valid}>
                  <CircleCheck size={14} /> Valid theme · <code>{analysis.theme.meta.id}</code>
                </p>
              )}
            </>
          ) : analysis.state === "empty" ? (
            <div className={styles.empty}>
              <Palette size={24} />
              <p>
                Paste a theme, or start from a preset above. Every theme follows the schema in{" "}
                <code>packages/domain/src/theme/theme.ts</code>; the shipped presets live in{" "}
                <code>packages/client/src/theme/presets/</code>.
              </p>
            </div>
          ) : analysis.state === "syntax" ? (
            <div className={styles.issues}>
              <p className={styles.problem}>
                <CircleAlert size={14} /> Not valid JSON
              </p>
              <p className={styles.issue}>{analysis.message}</p>
            </div>
          ) : (
            <div className={styles.issues}>
              <p className={styles.problem}>
                <CircleAlert size={14} /> Doesn&rsquo;t match the theme schema
              </p>
              <ul className={styles.issueList}>
                {analysis.issues.map((issue) => (
                  <li key={issue} className={styles.issue}>
                    {issue}
                  </li>
                ))}
                {analysis.more > 0 ? <li className={styles.more}>+ {analysis.more} more</li> : null}
              </ul>
            </div>
          )}
          {error ? (
            <p className={styles.problem} role="alert">
              <CircleAlert size={14} /> {error}
            </p>
          ) : null}
        </aside>
      </div>
    </Modal>
  );
}
