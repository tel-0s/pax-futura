import { Modal } from "../../components/Modal.tsx";
import styles from "./ShortcutsModal.module.css";

const GROUPS: Array<{ title: string; keys: Array<[string, string]> }> = [
  {
    title: "Time",
    keys: [
      ["T", "Advance time"],
      ["L", "Open / close the loom"],
      ["Enter", "In the loom: check out the selected turn"],
      ["← →  ↑ ↓", "In the loom: walk the tree"],
    ],
  },
  {
    title: "Panels",
    keys: [
      ["O", "Order queue"],
      ["I", "Dossier"],
      ["F", "Forces"],
      ["C", "Chronicle"],
      ["/", "Search"],
      ["G", "Game master"],
      ["M", "Conversations"],
      ["Esc", "Close the open panel"],
    ],
  },
  {
    title: "Orders & dispatches",
    keys: [
      ["Enter", "Queue the order you're writing"],
      ["Shift + Enter", "New line in an order"],
      ["→ / ←", "Next / previous dispatch card"],
      ["?", "This sheet"],
    ],
  },
];

/** The keyboard map of the stage. */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard" kicker="Shortcuts" size="lg" onClose={onClose}>
      <div className={styles.grid}>
        {GROUPS.map((group) => (
          <section key={group.title} className={styles.group}>
            <span className="pfKicker">{group.title}</span>
            <dl className={styles.list}>
              {group.keys.map(([key, label]) => (
                <div key={key + label} className={styles.row}>
                  <dt>
                    {key.split(" + ").map((part, index) => (
                      <span key={part}>
                        {index > 0 ? <span className={styles.plus}>+</span> : null}
                        <kbd>{part}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
