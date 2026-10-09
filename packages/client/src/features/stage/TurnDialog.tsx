import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { api } from "../../lib/api.ts";
import { useOrdersStore } from "../../stores/orders.ts";
import styles from "./TurnDialog.module.css";

const INTERVALS = [
  { label: "1 day", days: 1 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
];

const CUSTOM_UNITS = [
  { label: "days", days: 1 },
  { label: "weeks", days: 7 },
  { label: "months", days: 30 },
  { label: "years", days: 365 },
];

/** Scouting is a habit, not a per-turn whim — remember the last choice. */
const SCOUT_KEY = "pax-scout-first";

/** Fast-forward: pick how much time the next simulation covers. */
export function TurnDialog({
  gameId,
  parentId,
  onClose,
  onScout,
}: {
  gameId: string;
  parentId: string;
  onClose: () => void;
  /** Called with the in-flight request when the turn was launched as a scout. */
  onScout: (request: Promise<unknown>) => void;
}) {
  const orders = useOrdersStore((state) => state.orders);
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState(2);
  const [customUnit, setCustomUnit] = useState(7);
  const [scoutFirst, setScoutFirst] = useState(() => localStorage.getItem(SCOUT_KEY) === "1");

  const chooseScout = (next: boolean) => {
    localStorage.setItem(SCOUT_KEY, next ? "1" : "0");
    setScoutFirst(next);
  };

  const run = (jumpDays: number) => {
    onClose();
    const request = api.executeTurn(gameId, parentId, {
      jumpDays,
      stopPolicy: "toDate",
      // commit:false persists the node without moving the checkout or the
      // preferred path — the player accepts or discards it afterwards.
      ...(scoutFirst ? { commit: false } : {}),
    });
    // Fire and forget: progress streams into the composer via SSE; failures
    // surface as failed loom nodes with a retry path. A scout's result needs a
    // decision, so the stage follows that request instead.
    if (scoutFirst) onScout(request);
    else void request.catch(() => {});
  };

  const customDays = Math.max(1, Math.round(customAmount * customUnit));

  return (
    <Modal title="Fast-forward time" onClose={onClose}>
      <p className={styles.orders}>
        {orders.length > 0
          ? `${orders.length} queued order${orders.length === 1 ? "" : "s"} will be carried out.`
          : "No orders queued — the world will move on its own."}
      </p>
      <label className={styles.orders}>
        <input
          type="checkbox"
          checked={scoutFirst}
          onChange={(event) => chooseScout(event.target.checked)}
        />{" "}
        Scout first — run the turn, look it over, then accept or discard it
      </label>
      <div className={styles.grid}>
        {INTERVALS.map((interval) => (
          <Button key={interval.days} onClick={() => run(interval.days)}>
            {interval.label}
          </Button>
        ))}
        <Button variant={customOpen ? "primary" : "default"} onClick={() => setCustomOpen(!customOpen)}>
          Custom…
        </Button>
      </div>
      {customOpen ? (
        <div className={styles.custom}>
          <input
            className={styles.amount}
            type="number"
            min={1}
            value={customAmount}
            onChange={(event) => setCustomAmount(Number(event.target.value))}
          />
          <select value={customUnit} onChange={(event) => setCustomUnit(Number(event.target.value))}>
            {CUSTOM_UNITS.map((unit) => (
              <option key={unit.label} value={unit.days}>
                {unit.label}
              </option>
            ))}
          </select>
          <Button variant="primary" onClick={() => run(customDays)}>
            Fast-forward {customDays} day{customDays === 1 ? "" : "s"} ⏩
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
