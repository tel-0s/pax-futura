import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type RegistryEntry, type ScenarioSummary } from "../../lib/api.ts";
import { Button } from "../../components/Button.tsx";
import { NewGameModal } from "./NewGameModal.tsx";
import { SettingsModal } from "../settings/SettingsModal.tsx";
import styles from "./LibraryScreen.module.css";

/** What the file picker offers; the server is the real arbiter of the bytes. */
const SAVE_ACCEPT = ".pax.sqlite,.sqlite,application/vnd.sqlite3";

export function LibraryScreen() {
  const navigate = useNavigate();
  const [games, setGames] = useState<RegistryEntry[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [highlightId, setHighlightId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const [gameList, scenarioList] = await Promise.all([api.listGames(), api.listScenarios()]);
    setGames(gameList);
    setScenarios(scenarioList);
  };

  useEffect(() => {
    void refresh();
  }, []);

  // The imported card glows just long enough to be found, then settles.
  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(""), 6000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const importSave = async (file: File) => {
    setImporting(true);
    setImportError("");
    try {
      const meta = await api.importGame(file);
      await refresh();
      // Stay in the library: an imported save is a copy the player should be
      // able to recognise before committing to it.
      setHighlightId(meta.gameId);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>Pax Futura</h1>
        <div className={styles.headerActions}>
          <input
            ref={fileInput}
            type="file"
            accept={SAVE_ACCEPT}
            className={styles.fileInput}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset first: re-picking the same file must fire onChange again.
              event.target.value = "";
              if (file) void importSave(file);
            }}
          />
          <Button
            variant="ghost"
            disabled={importing}
            onClick={() => fileInput.current?.click()}
            title="Load a .pax.sqlite save file into this library"
          >
            {importing ? "Importing…" : "⬆ Import save…"}
          </Button>
          <Button variant="ghost" onClick={() => setSettingsOpen(true)} title="Settings">
            ⚙ Settings
          </Button>
        </div>
      </header>
      {importError ? (
        <div className={styles.alert} role="alert">
          <span>Import failed: {importError}</span>
          <Button variant="ghost" onClick={() => setImportError("")} title="Dismiss">
            ✕
          </Button>
        </div>
      ) : null}
      <div className={styles.grid}>
        {games.map((game) => (
          <div
            key={game.gameId}
            className={[styles.card, game.gameId === highlightId ? styles.imported : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => navigate(`/game/${game.gameId}`)}
          >
            <span className={styles.cardTitle}>{game.title}</span>
            <span className={styles.cardMeta}>
              {game.scenarioId} · {game.playerPolity}
            </span>
            <div className={styles.cardActions}>
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  // Open synchronously in the click gesture (popup blockers
                  // kill post-await opens), then navigate once the meta lands.
                  const tab = window.open("", "_blank");
                  void api
                    .getGame(game.gameId)
                    .then((meta) => {
                      const url = api.chronicleBookUrl(game.gameId, meta.activeNodeId);
                      if (tab) tab.location.href = url;
                      else window.open(url, "_blank");
                    })
                    .catch(() => tab?.close());
                }}
                title="Open the bound chronicle of this campaign"
              >
                📖 Chronicle
              </Button>
              {/* A plain download link, not a fetch: the browser streams the
                  save straight to disk inside the click gesture. */}
              <a
                className={styles.linkButton}
                href={api.exportGameUrl(game.gameId)}
                download
                onClick={(event) => event.stopPropagation()}
                title="Download this save as a .pax.sqlite file"
              >
                ⬇ Export
              </a>
              <Button
                variant="danger"
                onClick={(event) => {
                  event.stopPropagation();
                  if (confirm(`Delete "${game.title}"? This removes the save file.`)) {
                    void api.deleteGame(game.gameId).then(refresh);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
        <div className={`${styles.card} ${styles.newCard}`} onClick={() => setCreating(true)}>
          + New game
        </div>
      </div>
      {creating ? (
        <NewGameModal
          scenarios={scenarios}
          onClose={() => setCreating(false)}
          onCreated={(gameId) => navigate(`/game/${gameId}`)}
        />
      ) : null}
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
