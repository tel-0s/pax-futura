import { useState } from "react";
import type { Impacts, ReassessProposal } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import type { GmSubmit } from "./GmDrawer.tsx";
import styles from "./gm.module.css";

/** Human-readable line per proposed op, for the review list. */
const describeOps = (impacts: Impacts): string[] => [
  ...impacts.regionTransfers.map((t) =>
    t.toCode === null
      ? `${t.regionName || t.regionId} becomes unowned`
      : `${t.regionName || t.regionId} → ${t.toCode}`,
  ),
  ...impacts.polityChanges.map((c) => `register/update polity ${c.name ? `${c.name} [${c.code}]` : c.code}`),
  ...impacts.unitOps.map((op) =>
    op.op === "spawn"
      ? `field ${op.unit.name} (${op.unit.type}, ${op.unit.ownerCode})`
      : `${op.op} unit ${"unitId" in op ? op.unitId : ""}`,
  ),
  ...impacts.markerOps.map((op) =>
    op.op === "build" ? `build ${op.marker.name} (${op.marker.kind})` : `remove structure ${op.markerId || op.name}`,
  ),
];

/**
 * On-command map audit: the extractor model reads recent narrated history
 * against the current world and proposes corrective impacts. Dry-run first —
 * the player reviews every line, then applies through the normal GM-node path.
 */
export function GmReassess({
  gameId,
  nodeId,
  submit,
  busy,
}: {
  gameId: string;
  nodeId: string;
  submit: GmSubmit;
  busy: boolean;
}) {
  const [proposal, setProposal] = useState<ReassessProposal | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [error, setError] = useState("");

  const audit = async () => {
    setAuditing(true);
    setError("");
    setProposal(null);
    try {
      setProposal(await api.reassess(gameId, nodeId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAuditing(false);
    }
  };

  const lines = proposal ? describeOps(proposal.impacts) : [];

  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Reassess map</h3>
      <p className={styles.hint}>
        Audits the last ~20 turns of narration against the map and proposes fixes for territory,
        landmarks, and forces the story established but the map lost.
      </p>
      <Button variant="ghost" disabled={busy || auditing} onClick={() => void audit()}>
        {auditing ? "Auditing…" : "Audit map vs story"}
      </Button>
      {error ? <p className={styles.error}>{error}</p> : null}

      {proposal ? (
        lines.length === 0 ? (
          <p className={styles.hint}>The map already matches the narrated history — nothing to fix.</p>
        ) : (
          <>
            {proposal.notes.length > 0 ? (
              <ul className={styles.list}>
                {proposal.notes.map((note, index) => (
                  <li key={index} className={styles.listItem}>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className={styles.list}>
              {lines.map((line, index) => (
                <li key={index} className={styles.listItem}>
                  <span className={styles.code}>{line}</span>
                </li>
              ))}
            </ul>
            {proposal.dropped.length > 0 ? (
              <p className={styles.hint}>Refused by sanity checks: {proposal.dropped.join("; ")}</p>
            ) : null}
            <div className={styles.row}>
              <Button variant="ghost" disabled={busy} onClick={() => setProposal(null)}>
                Discard
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  void submit(proposal.impacts, "Map reassessment").then(() => setProposal(null));
                }}
              >
                Apply {lines.length} fix{lines.length === 1 ? "" : "es"}
              </Button>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}
