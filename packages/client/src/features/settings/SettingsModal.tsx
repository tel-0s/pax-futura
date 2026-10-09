import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  Map as MapIcon,
  Palette,
  Plug,
  Plus,
  Server,
  Sparkles,
  Trash,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { LlmConfigSchema, type Connection, type LlmConfig, type RoleBinding } from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Field } from "../../components/Field.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api } from "../../lib/api.ts";
import { useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { PRESET_THEMES } from "../../theme/presets.ts";
import { ThemeImportModal } from "./ThemeImportModal.tsx";
import { ThemeSpecimen } from "./ThemeSpecimen.tsx";
import styles from "./SettingsModal.module.css";

type SectionId = "appearance" | "connections" | "roles";

const SECTIONS: Array<{ id: SectionId; label: string; hint: string; icon: LucideIcon }> = [
  { id: "appearance", label: "Appearance", hint: "Theme & map", icon: Palette },
  { id: "connections", label: "Connections", hint: "Providers & keys", icon: Plug },
  { id: "roles", label: "Model roles", hint: "Who writes what", icon: Cpu },
];

const KIND_LABEL: Record<Connection["kind"], string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
  ollama: "Ollama",
};

const KIND_ICON: Record<Connection["kind"], LucideIcon> = {
  anthropic: Bot,
  "openai-compatible": Globe,
  ollama: Server,
};

const ROLE_COPY: Record<string, { title: string; help: string }> = {
  simulator: {
    title: "Simulator",
    help: "Writes every turn — the events, the map changes and the world's reply to your orders.",
  },
  extractor: {
    title: "Extractor",
    help: "The background archivist — facts, map reconciliation, era summaries and the Gazette.",
  },
};

/** LLM settings: loaded once when the modal opens, saved together. */
interface LlmState {
  config: LlmConfig;
  /** Last config the server accepted — the baseline for "unsaved changes". */
  saved: string;
  provider: string;
  real: boolean;
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SectionId>("appearance");
  const [llm, setLlm] = useState<LlmState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getLlmConfig()
      .then((result) => {
        setLlm({
          config: result.config,
          saved: JSON.stringify(result.config),
          provider: result.provider,
          real: result.real,
        });
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  const setConfig = (config: LlmConfig) => {
    setStatus(null);
    setLlm((current) => (current ? { ...current, config } : current));
  };

  const dirty = llm ? JSON.stringify(llm.config) !== llm.saved : false;
  // Same rules the server enforces — surfaced before the round-trip.
  const problem = useMemo(() => {
    if (!llm) return null;
    const parsed = LlmConfigSchema.safeParse(llm.config);
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid configuration");
  }, [llm]);

  const save = async () => {
    if (!llm) return;
    setStatus(null);
    setSaving(true);
    try {
      const result = await api.putLlmConfig(llm.config);
      setLlm({ ...llm, saved: JSON.stringify(llm.config), provider: result.provider, real: result.real });
      setStatus({ tone: "success", text: "Saved — provider swapped live." });
    } catch (error) {
      setStatus({ tone: "danger", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const providerSection = section !== "appearance";

  return (
    <Modal
      kicker="Pax Futura"
      title="Settings"
      size="xl"
      onClose={onClose}
      footer={
        providerSection ? (
          <>
            <span className={styles.saveState}>
              {!llm ? (
                <span className={styles.quiet}>Provider settings are not loaded.</span>
              ) : status ? (
                <span className={status.tone === "success" ? styles.ok : styles.bad}>{status.text}</span>
              ) : problem ? (
                <span className={styles.bad}>{problem}</span>
              ) : dirty ? (
                <span className={styles.pending}>
                  <span className={styles.pendingDot} /> Unsaved changes
                </span>
              ) : (
                <span className={styles.quiet}>Connections and roles are saved together and applied live.</span>
              )}
            </span>
            <Button variant="primary" disabled={saving || !llm} onClick={() => void save()}>
              {saving ? "Saving…" : "Save & apply"}
            </Button>
          </>
        ) : (
          <>
            <span className={styles.saveState}>
              <span className={styles.quiet}>Appearance applies instantly and is remembered on this device.</span>
            </span>
            <Button onClick={onClose}>Done</Button>
          </>
        )
      }
    >
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Settings sections">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`${styles.navItem} ${section === item.id ? styles.navActive : ""}`}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => setSection(item.id)}
              >
                <Icon size={16} className={styles.navIcon} />
                <span className={styles.navText}>
                  <span className={styles.navLabel}>{item.label}</span>
                  <span className={styles.navHint}>{item.hint}</span>
                </span>
              </button>
            );
          })}
          <div className={styles.navStatus}>
            <span className="pfKicker">Simulator</span>
            {llm ? (
              <span className={styles.health}>
                <span className={`${styles.healthDot} ${llm.real ? styles.healthLive : styles.healthFake}`} />
                {llm.real ? "Live model" : "Placeholder"}
              </span>
            ) : (
              <span className={styles.quiet}>{loadError ? "Unavailable" : "Checking…"}</span>
            )}
          </div>
        </nav>

        <div className={styles.content} key={section}>
          {section === "appearance" ? (
            <AppearanceSection />
          ) : !llm ? (
            <div className={styles.loading}>
              {loadError ? `Could not load provider settings: ${loadError}` : "Loading provider settings…"}
            </div>
          ) : section === "connections" ? (
            <ConnectionsSection llm={llm} setConfig={setConfig} />
          ) : (
            <RolesSection config={llm.config} setConfig={setConfig} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className={styles.sectionHead}>
      <h3 className={`${styles.sectionTitle} pfTitle`}>{title}</h3>
      {children ? <p className={styles.sectionHelp}>{children}</p> : null}
    </header>
  );
}

/* ── Appearance ───────────────────────────────────────────────────────── */

function AppearanceSection() {
  const themes = useThemesStore((state) => state.themes);
  const removeCustom = useThemesStore((state) => state.removeCustom);
  const { themeId, setThemeId } = useUiStore();
  const projection = useUiStore((state) => state.mapProjection);
  const setMapProjection = useUiStore((state) => state.setMapProjection);
  const [importing, setImporting] = useState(false);
  return (
    <div className={styles.section}>
      <SectionHead title="Theme">
        Each theme dresses the whole game — material, type, ornament and the map&rsquo;s inks.
      </SectionHead>
      <div className={styles.themeGrid}>
        {themes.map((theme) => {
          const active = theme.meta.id === themeId;
          const custom = !PRESET_THEMES.some((preset) => preset.meta.id === theme.meta.id);
          return (
            <div key={theme.meta.id} className={styles.themeSlot}>
              <button
                className={`${styles.themeCard} ${active ? styles.themeActive : ""}`}
                aria-pressed={active}
                onClick={() => setThemeId(theme.meta.id)}
              >
                <ThemeSpecimen theme={theme} />
                <span className={styles.themeName}>
                  <span style={{ fontFamily: theme.font.display, fontSizeAdjust: theme.font.displayAdjust ?? undefined }}>
                    {theme.meta.name}
                  </span>
                  {active ? <Check size={14} className={styles.themeCheck} /> : null}
                  {custom ? (
                    <span className={styles.themeBadge}>
                      <Badge tone="info">custom</Badge>
                    </span>
                  ) : null}
                </span>
                {theme.meta.tagline ? <span className={styles.themeTagline}>{theme.meta.tagline}</span> : null}
              </button>
              {custom ? (
                <button
                  className={styles.themeRemove}
                  title="Remove this custom theme"
                  aria-label={`Remove ${theme.meta.name}`}
                  onClick={() => {
                    if (confirm(`Remove the theme "${theme.meta.name}"?`)) void removeCustom(theme.meta.id);
                  }}
                >
                  <Trash size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button className={styles.importCard} onClick={() => setImporting(true)}>
          <Upload size={20} />
          <span className={styles.importTitle}>Import theme…</span>
          <span className={styles.themeTagline}>Paste JSON or start from a preset</span>
        </button>
      </div>

      <SectionHead title="Map projection">
        Themes pick a projection that suits them; override it here for every theme.
      </SectionHead>
      <div className={styles.segmented} role="radiogroup" aria-label="Map projection">
        <Segment active={projection === "theme"} onClick={() => setMapProjection("theme")}>
          <Sparkles size={14} /> Theme default
        </Segment>
        <Segment active={projection === "globe"} onClick={() => setMapProjection("globe")}>
          <Globe size={14} /> Globe
        </Segment>
        <Segment active={projection === "mercator"} onClick={() => setMapProjection("mercator")}>
          <MapIcon size={14} /> Flat
        </Segment>
      </div>
      {importing ? <ThemeImportModal onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      role="radio"
      aria-checked={active}
      className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ── Connections ──────────────────────────────────────────────────────── */

/** Connections + role bindings, persisted server-side and applied live. */
function ConnectionsSection({
  llm,
  setConfig,
}: {
  llm: LlmState;
  setConfig: (config: LlmConfig) => void;
}) {
  const { config } = llm;

  const patchConnection = (index: number, patch: Partial<Connection>) => {
    const previous = config.connections[index]!;
    const connections = config.connections.map((connection, i) =>
      i === index ? { ...connection, ...patch } : connection,
    );
    // Renaming a connection follows through into every role bound to it —
    // otherwise the bindings dangle and the provider silently goes fake.
    let roles = config.roles;
    if (patch.id !== undefined && patch.id !== previous.id) {
      roles = Object.fromEntries(
        Object.entries(config.roles).map(([role, entry]) =>
          "inherit" in entry || entry.connectionId !== previous.id
            ? [role, entry]
            : [role, { ...entry, connectionId: patch.id! }],
        ),
      );
    }
    setConfig({ ...config, connections, roles });
  };

  const usedBy = (id: string) =>
    Object.entries(config.roles)
      .filter(([, entry]) => !("inherit" in entry) && entry.connectionId === id)
      .map(([role]) => role);

  return (
    <div className={styles.section}>
      <div className={`${styles.statusCard} ${llm.real ? styles.statusLive : styles.statusFake}`}>
        <span className={styles.statusIcon}>{llm.real ? <Check size={18} /> : <Sparkles size={18} />}</span>
        <span className={styles.statusText}>
          <span className="pfKicker">Active simulator</span>
          <span className={styles.statusProvider}>{llm.provider}</span>
          <span className={styles.statusHelp}>
            {llm.real
              ? "Turns are written by a live model."
              : "No working connection — turns are written by the placeholder simulator."}
          </span>
        </span>
        <Badge tone={llm.real ? "success" : "warning"}>{llm.real ? "Live" : "Placeholder"}</Badge>
      </div>

      <SectionHead title="Connections">
        Where models are reached. Keys are stored locally in app.sqlite and never leave this machine
        except to their provider.
      </SectionHead>

      {config.connections.map((connection, index) => {
        const Icon = KIND_ICON[connection.kind];
        const roles = usedBy(connection.id);
        return (
          <section key={index} className={styles.connection}>
            <header className={styles.connHead}>
              <span className={styles.connIcon}>
                <Icon size={16} />
              </span>
              <span className={styles.connTitle}>
                <span className={styles.connName}>{connection.id || "unnamed"}</span>
                <span className={styles.connKind}>{KIND_LABEL[connection.kind]}</span>
              </span>
              <span className={styles.connBadges}>
                <KeyBadge connection={connection} />
                {roles.length > 0 ? (
                  <Badge tone="accent" title="Roles bound to this connection">
                    {roles.join(" · ")}
                  </Badge>
                ) : (
                  <Badge title="No role uses this connection yet">unused</Badge>
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon
                title={
                  config.connections.length > 1
                    ? "Remove connection"
                    : "At least one connection is required"
                }
                aria-label="Remove connection"
                disabled={config.connections.length <= 1}
                onClick={() =>
                  setConfig({
                    ...config,
                    connections: config.connections.filter((_, i) => i !== index),
                  })
                }
              >
                <Trash size={14} />
              </Button>
            </header>
            <div className={styles.formGrid}>
              <Field
                label="Id"
                value={connection.id}
                spellCheck={false}
                onChange={(event) => patchConnection(index, { id: event.target.value })}
              />
              <label className={styles.selectField}>
                <span className={styles.fieldLabel}>Kind</span>
                <select
                  value={connection.kind}
                  onChange={(event) =>
                    patchConnection(index, { kind: event.target.value as Connection["kind"] })
                  }
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>
              <div className={styles.wide}>
                <Field
                  label="Base URL (blank = provider default)"
                  value={connection.baseUrl ?? ""}
                  spellCheck={false}
                  placeholder={
                    connection.kind === "openai-compatible"
                      ? "https://openrouter.ai/api/v1"
                      : connection.kind === "ollama"
                        ? "http://localhost:11434"
                        : ""
                  }
                  onChange={(event) =>
                    patchConnection(index, { baseUrl: event.target.value || undefined })
                  }
                />
              </div>
              {connection.kind !== "ollama" ? (
                <div className={styles.wide}>
                  <SecretField
                    label="API key (stored locally in app.sqlite)"
                    value={connection.apiKey ?? ""}
                    placeholder={connection.apiKeyEnv ? `(falls back to $${connection.apiKeyEnv})` : ""}
                    onChange={(value) => patchConnection(index, { apiKey: value || undefined })}
                  />
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
      <button
        className={styles.addCard}
        onClick={() =>
          setConfig({
            ...config,
            connections: [
              ...config.connections,
              { id: `connection-${config.connections.length + 1}`, kind: "openai-compatible" },
            ],
          })
        }
      >
        <Plus size={15} /> Add connection
      </button>
    </div>
  );
}

function KeyBadge({ connection }: { connection: Connection }) {
  if (connection.kind === "ollama") return <Badge tone="info">local · no key</Badge>;
  if (connection.apiKey) return <Badge tone="success">key stored</Badge>;
  if (connection.apiKeyEnv) return <Badge tone="info">${connection.apiKeyEnv}</Badge>;
  return <Badge tone="warning">no key</Badge>;
}

/** A masked secret with a reveal toggle. */
function SecretField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className={styles.secret}>
      <Field
        label={label}
        type={revealed ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className={styles.reveal}
        title={revealed ? "Hide key" : "Show key"}
        aria-label={revealed ? "Hide key" : "Show key"}
        aria-pressed={revealed}
        onClick={() => setRevealed(!revealed)}
      >
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

/* ── Roles ────────────────────────────────────────────────────────────── */

function RolesSection({
  config,
  setConfig,
}: {
  config: LlmConfig;
  setConfig: (config: LlmConfig) => void;
}) {
  const patchRole = (role: string, patch: Partial<RoleBinding>) => {
    const entry = config.roles[role];
    if (!entry || "inherit" in entry) return;
    setConfig({ ...config, roles: { ...config.roles, [role]: { ...entry, ...patch } } });
  };

  const inherited = Object.entries(config.roles).filter(
    (pair): pair is [string, { inherit: string }] => "inherit" in pair[1],
  );

  return (
    <div className={styles.section}>
      <SectionHead title="Model roles">
        Each job in the game is bound to a connection and a model. Bigger context windows let the
        simulator remember more of the chronicle.
      </SectionHead>
      {(["simulator", "extractor"] as const).map((role) => {
        const entry = config.roles[role];
        if (!entry || "inherit" in entry) return null;
        const copy = ROLE_COPY[role]!;
        return (
          <section key={role} className={styles.role}>
            <header className={styles.roleHead}>
              <span className={`${styles.roleName} pfTitle`}>{copy.title}</span>
              <span className={styles.roleHelp}>{copy.help}</span>
            </header>
            <div className={styles.roleGrid}>
              <label className={styles.selectField}>
                <span className={styles.fieldLabel}>Connection</span>
                <select
                  value={entry.connectionId}
                  onChange={(event) => patchRole(role, { connectionId: event.target.value })}
                >
                  {config.connections.map((connection) => (
                    <option key={connection.id} value={connection.id}>
                      {connection.id}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Model"
                value={entry.model}
                placeholder="model id"
                spellCheck={false}
                onChange={(event) => patchRole(role, { model: event.target.value })}
              />
              <Field
                label="Context window (tokens)"
                type="number"
                value={entry.contextWindow}
                onChange={(event) => patchRole(role, { contextWindow: Number(event.target.value) })}
              />
              <Field
                label="Max output (tokens)"
                type="number"
                value={entry.maxOutput}
                onChange={(event) => patchRole(role, { maxOutput: Number(event.target.value) })}
              />
            </div>
          </section>
        );
      })}

      {inherited.length > 0 ? (
        <div className={styles.inherits}>
          <span className="pfKicker">Inherited</span>
          <div className={styles.inheritList}>
            {inherited.map(([role, entry]) => (
              <span key={role} className={styles.inherit}>
                <span className={styles.inheritRole}>{role}</span>
                <span className={styles.inheritArrow}>uses</span>
                <span className={styles.inheritFrom}>{entry.inherit}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
