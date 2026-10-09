import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Download,
  Play,
  Plus,
  Settings,
  Trash,
  Upload,
  X,
} from "lucide-react";
import { api, type RegistryEntry, type ScenarioSummary } from "../../lib/api.ts";
import { formatGameDate, relativeTime } from "../../lib/dates.ts";
import { Button } from "../../components/Button.tsx";
import { BrandMark } from "../../components/BrandMark.tsx";
import { useUiStore } from "../../stores/ui.ts";
import { selectTheme, useThemesStore } from "../../stores/themes.ts";
import { NewGameModal } from "./NewGameModal.tsx";
import { SettingsModal } from "../settings/SettingsModal.tsx";
import { LibraryBackdrop } from "./LibraryBackdrop.tsx";
import { eraOf } from "./eras.ts";
import styles from "./LibraryScreen.module.css";

/** What the file picker offers; the server is the real arbiter of the bytes. */
const SAVE_ACCEPT = ".pax.sqlite,.sqlite,application/vnd.sqlite3";

/**
 * The front door: the world turning in the active theme's cartography, the
 * campaign you were last playing one click away, and the rest of your
 * campaigns as era-marked cards.
 */
export function LibraryScreen() {
  const navigate = useNavigate();
  const themeId = useUiStore((state) => state.themeId);
  const theme = useThemesStore((state) => selectTheme(state.themes, themeId));
  const [games, setGames] = useState<RegistryEntry[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
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
    setLoaded(true);
  };

  useEffect(() => {
    void refresh().catch(() => setLoaded(true));
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

  const scenarioById = useMemo(() => new Map(scenarios.map((entry) => [entry.id, entry])), [scenarios]);
  const ordered = useMemo(
    () =>
      [...games].sort(
        (a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt),
      ),
    [games],
  );
  const [latest, ...rest] = ordered;

  const openChronicle = (gameId: string) => {
    // Open synchronously in the click gesture (popup blockers kill post-await
    // opens), then navigate once the meta lands.
    const tab = window.open("", "_blank");
    void api
      .getGame(gameId)
      .then((meta) => {
        const url = api.chronicleBookUrl(gameId, meta.activeNodeId);
        if (tab) tab.location.href = url;
        else window.open(url, "_blank");
      })
      .catch(() => tab?.close());
  };

  const deleteGame = (game: RegistryEntry) => {
    if (confirm(`Delete "${game.title}"? This removes the save file.`)) {
      void api.deleteGame(game.gameId).then(refresh);
    }
  };

  return (
    <div className={styles.screen}>
      <LibraryBackdrop theme={theme} />

      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <BrandMark size={40} />
            <div className={styles.brandText}>
              <h1 className={`${styles.title} pfTitle pfGlowText`}>Pax Futura</h1>
              <span className={styles.tagline}>History is a loom. Pull a thread.</span>
            </div>
          </div>
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
              <Upload size={15} /> {importing ? "Importing…" : "Import save"}
            </Button>
            <Button variant="ghost" onClick={() => setSettingsOpen(true)} title="Settings">
              <Settings size={15} /> Settings
            </Button>
          </div>
        </header>

        {importError ? (
          <div className={styles.alert} role="alert">
            <span>Import failed: {importError}</span>
            <Button variant="ghost" icon size="sm" onClick={() => setImportError("")} title="Dismiss">
              <X size={14} />
            </Button>
          </div>
        ) : null}

        {latest ? (
          <section className={`${styles.hero} pfPanel`} key={latest.gameId}>
            <HeroBody
              game={latest}
              scenario={scenarioById.get(latest.scenarioId)}
              highlighted={latest.gameId === highlightId}
              onResume={() => navigate(`/game/${latest.gameId}`)}
              onChronicle={() => openChronicle(latest.gameId)}
            />
          </section>
        ) : loaded ? (
          <section className={`${styles.hero} ${styles.heroEmpty} pfPanel`}>
            <span className="pfKicker">No campaigns yet</span>
            <h2 className={`${styles.heroTitle} pfTitle`}>Every history begins with a single choice.</h2>
            <p className={styles.heroText}>
              Pick an era, choose a nation — or found your own — and the simulation will answer every order
              you give.
            </p>
            <div className={styles.heroActions}>
              <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
                <Plus size={16} /> Begin a campaign
              </Button>
            </div>
          </section>
        ) : null}

        <section className={styles.shelf}>
          <div className={styles.shelfHeader}>
            <span className="pfKicker">Campaigns</span>
            <span className={styles.count}>{games.length}</span>
            <span className={styles.spacer} />
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={15} /> New campaign
            </Button>
          </div>
          <div className={styles.grid}>
            {rest.map((game, index) => {
              const scenario = scenarioById.get(game.scenarioId);
              const era = eraOf(scenario?.startDate);
              const Icon = era.icon;
              return (
                <article
                  key={game.gameId}
                  className={[styles.card, game.gameId === highlightId ? styles.imported : "", "pfChamfer"]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
                  onClick={() => navigate(`/game/${game.gameId}`)}
                >
                  <div className={styles.cardEra}>
                    <Icon size={15} />
                    <span>{era.name}</span>
                    <span className={styles.cardYear}>{yearOf(scenario?.startDate)}</span>
                  </div>
                  <h3 className={`${styles.cardTitle} pfTitle`}>{game.title}</h3>
                  <div className={styles.cardMeta}>
                    <span className={styles.code}>{game.playerPolity}</span>
                    <span>{scenario?.name ?? game.scenarioId}</span>
                  </div>
                  <div className={styles.cardFoot}>
                    <span className={styles.played}>{relativeTime(game.lastPlayedAt)}</span>
                    <div className={styles.cardActions} onClick={(event) => event.stopPropagation()}>
                      <Button variant="ghost" icon size="sm" title="Open the bound chronicle" onClick={() => openChronicle(game.gameId)}>
                        <BookOpen size={14} />
                      </Button>
                      {/* A plain download link, not a fetch: the browser streams the
                          save straight to disk inside the click gesture. */}
                      <a
                        className={styles.iconLink}
                        href={api.exportGameUrl(game.gameId)}
                        download
                        title="Download this save as a .pax.sqlite file"
                      >
                        <Download size={14} />
                      </a>
                      <Button variant="ghost" icon size="sm" title="Delete this campaign" onClick={() => deleteGame(game)}>
                        <Trash size={14} />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
            <button className={`${styles.card} ${styles.newCard} pfChamfer`} onClick={() => setCreating(true)}>
              <span className={styles.newIcon}>
                <Plus size={22} />
              </span>
              <span className={`${styles.newLabel} pfTitle`}>New campaign</span>
              <span className={styles.newHint}>{scenarios.length} scenarios, any nation, or your own</span>
            </button>
          </div>
        </section>
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

function HeroBody({
  game,
  scenario,
  highlighted,
  onResume,
  onChronicle,
}: {
  game: RegistryEntry;
  scenario: ScenarioSummary | undefined;
  highlighted: boolean;
  onResume: () => void;
  onChronicle: () => void;
}) {
  const era = eraOf(scenario?.startDate);
  const Icon = era.icon;
  return (
    <div className={`${styles.heroBody} ${highlighted ? styles.imported : ""}`}>
      <div className={styles.heroMain}>
        <span className="pfKicker">Continue your campaign</span>
        <h2 className={`${styles.heroTitle} pfTitle`}>{game.title}</h2>
        <div className={styles.heroMeta}>
          <span className={styles.heroEra}>
            <Icon size={15} /> {era.name}
          </span>
          <span>{scenario?.name ?? game.scenarioId}</span>
          {scenario ? <span>began {formatGameDate(scenario.startDate)}</span> : null}
          <span className={styles.code}>{game.playerPolity}</span>
        </div>
        {scenario?.description ? <p className={styles.heroText}>{scenario.description}</p> : null}
        <div className={styles.heroActions}>
          <Button variant="primary" size="lg" onClick={onResume}>
            <Play size={16} /> Resume
          </Button>
          <Button variant="ghost" onClick={onChronicle} title="Open the bound chronicle of this campaign">
            <BookOpen size={15} /> Chronicle
          </Button>
          <span className={styles.played}>Last played {relativeTime(game.lastPlayedAt)}</span>
        </div>
      </div>
      <div className={styles.heroSeal} aria-hidden>
        <span className={styles.heroYear}>{yearOf(scenario?.startDate)}</span>
        <Icon size={28} />
      </div>
    </div>
  );
}

const yearOf = (date: string | undefined): string => {
  const year = date ? parseInt(date, 10) : NaN;
  if (!Number.isFinite(year)) return "";
  return year <= 0 ? `${1 - year} BC` : String(year);
};
