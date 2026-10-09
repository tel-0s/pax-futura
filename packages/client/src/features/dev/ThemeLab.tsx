import { useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { Field, TextAreaField } from "../../components/Field.tsx";
import { Modal } from "../../components/Modal.tsx";
import { Tabs } from "../../components/Tabs.tsx";
import { PRESET_THEMES } from "../../theme/presets.ts";
import { useUiStore } from "../../stores/ui.ts";
import styles from "./ThemeLab.module.css";

/** Dev-only page proving live theme swap across every primitive. */
export function ThemeLab() {
  const { themeId, setThemeId } = useUiStore();
  const [tab, setTab] = useState("one");
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className={styles.lab}>
      <h1>Theme lab</h1>
      <div className={styles.row}>
        {PRESET_THEMES.map((theme) => (
          <Button
            key={theme.meta.id}
            variant={theme.meta.id === themeId ? "primary" : "default"}
            onClick={() => setThemeId(theme.meta.id)}
          >
            {theme.meta.name}
          </Button>
        ))}
      </div>

      <section className={styles.grid}>
        <div className={styles.cell}>
          <h3>Buttons</h3>
          <div className={styles.row}>
            <Button>Default</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
            <Button disabled>Disabled</Button>
          </div>
        </div>
        <div className={styles.cell}>
          <h3>Badges</h3>
          <div className={styles.row}>
            <Badge>💬 3</Badge>
            <Badge tone="accent">canonical</Badge>
            <Badge tone="warning">exploratory</Badge>
            <Badge tone="danger">failed</Badge>
          </div>
        </div>
        <div className={styles.cell}>
          <h3>Tabs</h3>
          <Tabs
            items={[
              { id: "one", label: "Advisor" },
              { id: "two", label: "Berlin" },
              { id: "three", label: "London" },
            ]}
            activeId={tab}
            onSelect={setTab}
          />
        </div>
        <div className={styles.cell}>
          <h3>Fields</h3>
          <Field label="Nation" defaultValue="France" />
          <TextAreaField label="Orders" defaultValue="Mobilize two divisions…" rows={2} />
        </div>
        <div className={styles.cell}>
          <h3>Surfaces</h3>
          <div className={styles.surfaces}>
            {[0, 1, 2, 3].map((level) => (
              <div key={level} className={styles[`surface${level}`]}>
                {level}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.cell}>
          <h3>Modal</h3>
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
          {modalOpen ? (
            <Modal
              title="Delete branch?"
              onClose={() => setModalOpen(false)}
              footer={
                <>
                  <Button onClick={() => setModalOpen(false)}>Cancel</Button>
                  <Button variant="danger" onClick={() => setModalOpen(false)}>
                    Delete
                  </Button>
                </>
              }
            >
              This removes 4 turns and their conversations.
            </Modal>
          ) : null}
        </div>
      </section>
    </div>
  );
}
