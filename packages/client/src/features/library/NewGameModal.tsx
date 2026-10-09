import { useEffect, useRef, useState } from "react";
import { DIFFICULTIES, type CustomPolity, type SavedPolity } from "@pax/domain";
import { api, type ScenarioSummary } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import { Modal } from "../../components/Modal.tsx";
import styles from "./NewGameModal.module.css";

const CUSTOM = "__custom__";
const MAX_FLAG_BYTES = 80_000;

export function NewGameModal({
  scenarios,
  onClose,
  onCreated,
}: {
  scenarios: ScenarioSummary[];
  onClose: () => void;
  onCreated: (gameId: string) => void;
}) {
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [playAs, setPlayAs] = useState("");
  const [difficulty, setDifficulty] = useState("standard");
  const [error, setError] = useState<string | null>(null);

  // Custom nation/organization fields
  const [customName, setCustomName] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [baseCode, setBaseCode] = useState("");
  const [color, setColor] = useState("#ff812a");
  const [flag, setFlag] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // Reusable-nations library: pick one to prefill; saving keeps its id so
  // load → tweak → create updates the template instead of duplicating it.
  const [saved, setSaved] = useState<SavedPolity[]>([]);
  const [savedId, setSavedId] = useState("");
  const [remember, setRemember] = useState(true);

  const scenario = scenarios.find((entry) => entry.id === scenarioId);
  const polities = scenario?.playablePolities ?? [];
  const chosen = playAs || polities[0]?.code || "";
  const isCustom = chosen === CUSTOM;

  useEffect(() => {
    if (isCustom) void api.listSavedPolities().then(setSaved).catch(() => setSaved([]));
  }, [isCustom]);

  const loadTemplate = (id: string) => {
    setSavedId(id);
    const template = saved.find((entry) => entry.id === id);
    if (!template) return;
    setCustomName(template.name);
    setCustomCode(template.code ?? "");
    setColor(template.color || "#ff812a");
    setFlag(template.flag);
    setTags(template.tags.join(", "));
    setNote(template.note);
    // baseCode is deliberately untouched — territory is per-scenario.
  };

  const uploadFlag = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (dataUrl.length > MAX_FLAG_BYTES) {
        setError("Flag image too large — use a small PNG/SVG (≤ ~60KB).");
        return;
      }
      setError(null);
      setFlag(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    setError(null);
    try {
      const customPolity: CustomPolity | undefined = isCustom
        ? {
            name: customName.trim(),
            ...(baseCode
              ? { baseCode }
              : {
                  code:
                    customCode.trim().toUpperCase() ||
                    customName.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6),
                }),
            color,
            flag,
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
              .slice(0, 8),
            note: note.trim(),
          }
        : undefined;

      if (isCustom && !customPolity?.name) {
        setError("Give your nation or organization a name.");
        return;
      }

      if (isCustom && customPolity && remember) {
        // Library save is best-effort — never block game creation on it.
        const { baseCode: _territory, ...identity } = customPolity;
        try {
          const stored = await api.savePolity({ ...identity, ...(savedId ? { id: savedId } : {}) });
          setSavedId(stored.id);
        } catch {
          // ignore: the game itself still starts
        }
      }

      const meta = await api.createGame({
        scenarioId,
        title:
          title ||
          `${scenario?.name ?? "Game"} — ${isCustom ? customName || "Custom" : chosen}`,
        playerPolity: isCustom ? "custom" : chosen,
        difficulty,
        ...(customPolity ? { customPolity } : {}),
      });
      onCreated(meta.gameId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      title="New game"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!scenarioId || !chosen}>
            Start
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <label className={styles.select}>
          Scenario
          <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
            {scenarios.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.select}>
          Play as
          <select value={chosen} onChange={(event) => setPlayAs(event.target.value)}>
            {polities.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.name}
              </option>
            ))}
            <option value={CUSTOM}>✦ Custom nation / organization…</option>
          </select>
        </label>

        {isCustom ? (
          <div className={styles.creator}>
            {saved.length > 0 ? (
              <div className={styles.savedRow}>
                <label className={styles.select}>
                  Start from
                  <select value={savedId} onChange={(event) => loadTemplate(event.target.value)}>
                    <option value="">New nation…</option>
                    {saved.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.flag && !entry.flag.startsWith("data:") ? `${entry.flag} ` : ""}
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                {savedId ? (
                  <Button
                    variant="ghost"
                    title="Delete this saved nation"
                    onClick={() => {
                      void api.deleteSavedPolity(savedId).then(() => {
                        setSaved((entries) => entries.filter((entry) => entry.id !== savedId));
                        setSavedId("");
                      });
                    }}
                  >
                    ✕
                  </Button>
                ) : null}
              </div>
            ) : null}
            <Field
              label="Name"
              value={customName}
              placeholder="e.g. Order of the Silver Dawn"
              onChange={(event) => setCustomName(event.target.value)}
            />
            <label className={styles.select}>
              Territory
              <select value={baseCode} onChange={(event) => setBaseCode(event.target.value)}>
                <option value="">None — landless organization</option>
                {polities.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    Take over {entry.name}
                  </option>
                ))}
              </select>
            </label>
            {!baseCode ? (
              <Field
                label="Code (2-8 uppercase, auto from name if blank)"
                value={customCode}
                placeholder="SILVDAWN"
                onChange={(event) => setCustomCode(event.target.value.toUpperCase())}
              />
            ) : null}
            <div className={styles.flagRow}>
              <label className={styles.colorField}>
                <span>Color</span>
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
              <Field
                label="Flag (emoji, or upload)"
                value={flag.startsWith("data:") ? "(image)" : flag}
                placeholder="🜲"
                onChange={(event) => setFlag(event.target.value)}
              />
              <Button variant="ghost" onClick={() => fileInput.current?.click()}>
                Upload…
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/svg+xml,image/webp,image/jpeg"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadFlag(file);
                }}
              />
              <FlagPreview flag={flag} color={color} />
            </div>
            <Field
              label="Tags (comma-separated)"
              value={tags}
              placeholder="secretive, technocratic, transnational"
              onChange={(event) => setTags(event.target.value)}
            />
            <TextAreaField
              label="Backstory & goals (fed to the simulation)"
              rows={4}
              value={note}
              placeholder="Who are they, what do they want, how do they operate? The simulator and every advisor/diplomat sees this."
              onChange={(event) => setNote(event.target.value)}
            />
            <label className={styles.remember}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>
                Save this nation for reuse
                {savedId ? " (updates the loaded template)" : ""}
              </span>
            </label>
          </div>
        ) : null}

        <label className={styles.select}>
          Simulation strictness
          <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
            {DIFFICULTIES.map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            {DIFFICULTIES.find((level) => level.id === difficulty)?.description}
          </p>
        </label>

        <Field
          label="Title"
          value={title}
          placeholder={scenario ? `${scenario.name} — ${isCustom ? customName || "Custom" : chosen}` : ""}
          onChange={(event) => setTitle(event.target.value)}
        />
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    </Modal>
  );
}

function FlagPreview({ flag, color }: { flag: string; color: string }) {
  return (
    <span className={styles.flagPreview} style={{ borderColor: color }}>
      {flag.startsWith("data:") ? (
        <img src={flag} alt="flag" className={styles.flagImage} />
      ) : (
        <span className={styles.flagEmoji}>{flag || "✦"}</span>
      )}
    </span>
  );
}
