import { useEffect, useState } from "react";
import type { Connection, LlmConfig, RoleBinding } from "@pax/domain";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Field } from "../../components/Field.tsx";
import { Modal } from "../../components/Modal.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { api } from "../../lib/api.ts";
import { useThemesStore } from "../../stores/themes.ts";
import { useUiStore } from "../../stores/ui.ts";
import { ThemeImportModal } from "./ThemeImportModal.tsx";
import styles from "./SettingsModal.module.css";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState("appearance");
  return (
    <Modal title="Settings" onClose={onClose}>
      <Tabs
        items={[
          { id: "appearance", label: "Appearance" },
          { id: "providers", label: "Providers" },
        ]}
        activeId={tab}
        onSelect={setTab}
      />
      <div className={styles.body}>
        {tab === "appearance" ? <AppearanceSection /> : <ProvidersSection />}
      </div>
    </Modal>
  );
}

function AppearanceSection() {
  const themes = useThemesStore((state) => state.themes);
  const { themeId, setThemeId } = useUiStore();
  const [importing, setImporting] = useState(false);
  return (
    <div className={styles.section}>
      <label className={styles.row}>
        <span>Theme</span>
        <select value={themeId} onChange={(event) => setThemeId(event.target.value)}>
          {themes.map((theme) => (
            <option key={theme.meta.id} value={theme.meta.id}>
              {theme.meta.name}
            </option>
          ))}
        </select>
      </label>
      <Button onClick={() => setImporting(true)}>Import theme JSON…</Button>
      {importing ? <ThemeImportModal onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

/** Connections + role bindings, persisted server-side and applied live. */
function ProvidersSection() {
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [provider, setProvider] = useState("");
  const [real, setReal] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void api.getLlmConfig().then((result) => {
      setConfig(result.config);
      setProvider(result.provider);
      setReal(result.real);
    });
  }, []);

  if (!config) return <p className={styles.muted}>Loading…</p>;

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

  const patchRole = (role: string, patch: Partial<RoleBinding>) => {
    const entry = config.roles[role];
    if (!entry || "inherit" in entry) return;
    setConfig({ ...config, roles: { ...config.roles, [role]: { ...entry, ...patch } } });
  };

  const save = async () => {
    setStatus(null);
    try {
      const result = await api.putLlmConfig(config);
      setProvider(result.provider);
      setReal(result.real);
      setStatus("Saved — provider swapped live.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.status}>
        Active simulator: <Badge tone={real ? "accent" : "warning"}>{provider}</Badge>
      </div>

      <h4 className={styles.heading}>Connections</h4>
      {config.connections.map((connection, index) => (
        <div key={index} className={styles.connection}>
          <div className={styles.connRow}>
            <Field
              label="Id"
              value={connection.id}
              onChange={(event) => patchConnection(index, { id: event.target.value })}
            />
            <label className={styles.kind}>
              <span>Kind</span>
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
            <Button
              variant="ghost"
              title="Remove connection"
              onClick={() =>
                setConfig({
                  ...config,
                  connections: config.connections.filter((_, i) => i !== index),
                })
              }
            >
              ✕
            </Button>
          </div>
          <Field
            label="Base URL (blank = provider default)"
            value={connection.baseUrl ?? ""}
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
          {connection.kind !== "ollama" ? (
            <Field
              label="API key (stored locally in app.sqlite)"
              type="password"
              value={connection.apiKey ?? ""}
              placeholder={connection.apiKeyEnv ? `(falls back to $${connection.apiKeyEnv})` : ""}
              onChange={(event) =>
                patchConnection(index, { apiKey: event.target.value || undefined })
              }
            />
          ) : null}
        </div>
      ))}
      <Button
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
        + Add connection
      </Button>

      <h4 className={styles.heading}>Model roles</h4>
      {(["simulator", "extractor"] as const).map((role) => {
        const entry = config.roles[role];
        if (!entry || "inherit" in entry) return null;
        return (
          <div key={role} className={styles.roleRow}>
            <span className={styles.roleName}>{role}</span>
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
            <input
              className={styles.model}
              value={entry.model}
              placeholder="model id"
              onChange={(event) => patchRole(role, { model: event.target.value })}
            />
            <input
              className={styles.num}
              type="number"
              title="Context window (tokens)"
              value={entry.contextWindow}
              onChange={(event) => patchRole(role, { contextWindow: Number(event.target.value) })}
            />
            <input
              className={styles.num}
              type="number"
              title="Max output (tokens)"
              value={entry.maxOutput}
              onChange={(event) => patchRole(role, { maxOutput: Number(event.target.value) })}
            />
          </div>
        );
      })}
      <p className={styles.muted}>
        Advisor and diplomat inherit the simulator; utility inherits the extractor.
      </p>

      <div className={styles.footerRow}>
        {status ? <span className={styles.muted}>{status}</span> : <span />}
        <Button variant="primary" onClick={() => void save()}>
          Save & apply
        </Button>
      </div>
    </div>
  );
}
