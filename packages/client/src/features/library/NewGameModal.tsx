import { useEffect, useRef, useState } from "react";
import { Palette, Play, Sparkles, Trash, Upload } from "lucide-react";
import { DIFFICULTIES, type CustomPolity, type SavedPolity } from "@pax/domain";
import { api, type ScenarioSummary } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import { Modal } from "../../components/Modal.tsx";
import { PolityFlag } from "../../components/PolityFlag.tsx";
import { formatGameDate } from "../../lib/dates.ts";
import { useUiStore } from "../../stores/ui.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { polityFillColor } from "../../theme/palette.ts";
import { ERA_THEME, eraOf } from "./eras.ts";
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
  const themeId = useUiStore((state) => state.themeId);
  const setThemeId = useUiStore((state) => state.setThemeId);
  const themes = useThemesStore((state) => state.themes);
  const theme = selectTheme(themes, themeId);

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

  const era = eraOf(scenario?.startDate);
  const EraIcon = era.icon;
  const chosenName = isCustom
    ? customName.trim() || "a nation of your own"
    : polities.find((entry) => entry.code === chosen)?.name ?? chosen;
  const level = DIFFICULTIES.find((entry) => entry.id === difficulty);
  const suggested = themes.find((entry) => entry.meta.id === ERA_THEME[era.id]);

  return (
    <Modal
      title="Begin a campaign"
      kicker="New game"
      size="xl"
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <span className={styles.summary}>
            {scenario ? (
              <>
                Playing <strong>{chosenName}</strong> in <strong>{scenario.name}</strong> ·{" "}
                {level?.label ?? difficulty}
              </>
            ) : null}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="lg" onClick={() => void submit()} disabled={!scenarioId || !chosen}>
            <Play size={15} /> Begin
          </Button>
        </div>
      }
    >
      <div className={styles.layout}>
        <nav className={styles.scenarios} aria-label="Scenarios">
          <span className="pfKicker">Choose an era</span>
          {[...scenarios]
            .sort((a, b) => parseInt(a.startDate, 10) - parseInt(b.startDate, 10) || a.name.localeCompare(b.name))
            .map((entry) => {
            const entryEra = eraOf(entry.startDate);
            const Icon = entryEra.icon;
            return (
              <button
                key={entry.id}
                className={`${styles.scenario} ${entry.id === scenarioId ? styles.scenarioActive : ""}`}
                onClick={() => {
                  setScenarioId(entry.id);
                  // A nation code from the old scenario means nothing in the
                  // new one; a custom nation in progress survives the switch.
                  setPlayAs((previous) => (previous === CUSTOM ? CUSTOM : ""));
                  setBaseCode("");
                }}
              >
                <span className={styles.scenarioIcon}>
                  <Icon size={16} />
                </span>
                <span className={styles.scenarioText}>
                  <span className={styles.scenarioName}>{entry.name}</span>
                  <span className={styles.scenarioEra}>{entryEra.name}</span>
                </span>
                <span className={styles.scenarioYear}>{yearOf(entry.startDate)}</span>
              </button>
            );
          })}
        </nav>

        <div className={styles.detail}>
          {scenario ? (
            <header className={styles.scenarioHead} key={scenario.id}>
              <span className={styles.eraLine}>
                <EraIcon size={14} /> {era.name} · {formatGameDate(scenario.startDate)}
              </span>
              <h3 className={`${styles.scenarioTitle} pfTitle`}>{scenario.name}</h3>
              <p className={styles.scenarioDescription}>{scenario.description}</p>
              {suggested && suggested.meta.id !== themeId ? (
                <button
                  className={styles.themeHint}
                  onClick={() => setThemeId(suggested.meta.id)}
                  title={suggested.meta.tagline}
                >
                  <Palette size={13} /> This era looks its best in{" "}
                  <strong style={{ fontFamily: suggested.font.display }}>{suggested.meta.name}</strong> — apply
                </button>
              ) : null}
            </header>
          ) : null}

          <section className={styles.section}>
            <span className="pfKicker">Play as</span>
            <div className={styles.nations}>
              {polities.map((entry) => (
                <button
                  key={entry.code}
                  className={`${styles.nation} ${chosen === entry.code ? styles.nationActive : ""}`}
                  onClick={() => setPlayAs(entry.code)}
                >
                  <PolityFlag color={polityFillColor(theme, entry.code)} size={22} />
                  <span className={styles.nationName}>{entry.name}</span>
                  <span className={styles.nationCode}>{entry.code}</span>
                </button>
              ))}
              <button
                className={`${styles.nation} ${styles.nationCustom} ${isCustom ? styles.nationActive : ""}`}
                onClick={() => setPlayAs(CUSTOM)}
              >
                <span className={styles.customGlyph}>
                  <Sparkles size={15} />
                </span>
                <span className={styles.nationName}>Found your own</span>
                <span className={styles.nationCode}>nation or order</span>
              </button>
            </div>
          </section>

          {isCustom ? (
            <section className={`${styles.creator} ${styles.section}`}>
              <div className={styles.creatorHead}>
                <FlagPreview flag={flag} color={color} />
                <div className={styles.creatorTitle}>
                  <span className="pfKicker">Custom nation</span>
                  <span className={`${styles.creatorName} pfTitle`}>{customName.trim() || "Unnamed"}</span>
                </div>
                {saved.length > 0 ? (
                  <div className={styles.savedRow}>
                    <select
                      value={savedId}
                      onChange={(event) => loadTemplate(event.target.value)}
                      title="Start from a saved nation"
                    >
                      <option value="">Start from… (new)</option>
                      {saved.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.flag && !entry.flag.startsWith("data:") ? `${entry.flag} ` : ""}
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    {savedId ? (
                      <Button
                        variant="ghost"
                        icon
                        size="sm"
                        title="Delete this saved nation"
                        onClick={() => {
                          void api.deleteSavedPolity(savedId).then(() => {
                            setSaved((entries) => entries.filter((entry) => entry.id !== savedId));
                            setSavedId("");
                          });
                        }}
                      >
                        <Trash size={14} />
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className={styles.grid2}>
                <Field
                  label="Name"
                  value={customName}
                  placeholder="e.g. Order of the Silver Dawn"
                  onChange={(event) => setCustomName(event.target.value)}
                />
                <label className={styles.select}>
                  <span className={styles.label}>Territory</span>
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
                    label="Code (2-8 letters, auto if blank)"
                    value={customCode}
                    placeholder="SILVDAWN"
                    onChange={(event) => setCustomCode(event.target.value.toUpperCase())}
                  />
                ) : null}
                <div className={styles.flagRow}>
                  <label className={styles.colorField}>
                    <span className={styles.label}>Color</span>
                    <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
                  </label>
                  <Field
                    label="Flag (emoji or upload)"
                    value={flag.startsWith("data:") ? "(image)" : flag}
                    placeholder="🜲"
                    onChange={(event) => setFlag(event.target.value)}
                  />
                  <Button variant="ghost" onClick={() => fileInput.current?.click()} title="Upload a flag image">
                    <Upload size={14} />
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
                </div>
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
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                <span>
                  Save this nation for reuse
                  {savedId ? " (updates the loaded template)" : ""}
                </span>
              </label>
            </section>
          ) : null}

          <section className={styles.section}>
            <span className="pfKicker">Simulation strictness</span>
            <div className={styles.ladder} role="radiogroup">
              {DIFFICULTIES.map((entry, index) => (
                <button
                  key={entry.id}
                  role="radio"
                  aria-checked={entry.id === difficulty}
                  className={`${styles.rung} ${entry.id === difficulty ? styles.rungActive : ""}`}
                  onClick={() => setDifficulty(entry.id)}
                >
                  <span className={styles.rungPips}>
                    {DIFFICULTIES.map((_, pip) => (
                      <span key={pip} className={`${styles.pip} ${pip <= index ? styles.pipOn : ""}`} />
                    ))}
                  </span>
                  {entry.label}
                </button>
              ))}
            </div>
            <p className={styles.hint}>{level?.description}</p>
          </section>

          <section className={styles.section}>
            <Field
              label="Campaign title"
              value={title}
              placeholder={scenario ? `${scenario.name} — ${isCustom ? customName || "Custom" : chosen}` : ""}
              onChange={(event) => setTitle(event.target.value)}
            />
          </section>
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
      </div>
    </Modal>
  );
}

function FlagPreview({ flag, color }: { flag: string; color: string }) {
  return (
    <span className={styles.flagPreview} style={{ borderColor: color, boxShadow: `inset 0 -6px 0 ${color}` }}>
      {flag.startsWith("data:") ? (
        <img src={flag} alt="flag" className={styles.flagImage} />
      ) : (
        <span className={styles.flagEmoji}>{flag || "✦"}</span>
      )}
    </span>
  );
}

const yearOf = (date: string | undefined): string => {
  const year = date ? parseInt(date, 10) : NaN;
  if (!Number.isFinite(year)) return "";
  return year <= 0 ? `${1 - year} BC` : String(year);
};
