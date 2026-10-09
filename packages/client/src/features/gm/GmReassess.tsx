import { useState } from "react";
import { CircleCheck, Info, LoaderCircle, ScanSearch } from "lucide-react";
import type { Impacts, ReassessProposal } from "@pax/domain";
import { Button } from "../../components/Button.tsx";
import { api } from "../../lib/api.ts";
import type { GmSubmit } from "./GmDrawer.tsx";
import { GmSection } from "./GmSection.tsx";
import styles from "./gm.module.css";

type OpKind = "region" | "polity" | "unit" | "structure";

/** Human-readable line per proposed op, for the review list. */
const describeOps = (impacts: Impacts): Array<{ kind: OpKind; text: string }> => [
  ...impacts.regionTransfers.map((t) => ({
    kind: "region" as const,
    text:
      t.toCode === null
        ? `${t.regionName || t.regionId} becomes unowned`
        : `${t.regionName || t.regionId} → ${t.toCode}`,
  })),
  ...impacts.polityChanges.map((c) => ({
    kind: "polity" as const,
    text: `register/update polity ${c.name ? `${c.name} [${c.code}]` : c.code}`,
  })),
  ...impacts.unitOps.map((op) => ({
    kind: "unit" as const,
    text:
      op.op === "spawn"
        ? `field ${op.unit.name} (${op.unit.type}, ${op.unit.ownerCode})`
        : `${op.op} unit ${"unitId" in op ? op.unitId : ""}`,
  })),
  ...impacts.markerOps.map((op) => ({
    kind: "structure" as const,
    text: op.op === "build" ? `build ${op.marker.name} (${op.marker.kind})` : `remove structure ${op.markerId || op.name}`,
  })),
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
    <GmSection
      icon={ScanSearch}
      title="Reassess map"
      hint="Audits the last ~20 turns of narration against the map and proposes fixes for territory, landmarks, and forces the story established but the map lost."
    >
      {!proposal ? (
        <div className={styles.actions}>
          <Button disabled={busy || auditing} onClick={() => void audit()}>
            {auditing ? <LoaderCircle size={14} className={styles.spin} /> : <ScanSearch size={14} />}
            {auditing ? "Auditing…" : "Audit map vs story"}
          </Button>
        </div>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {proposal ? (
        lines.length === 0 ? (
          <div className={styles.verdict}>
            <CircleCheck size={16} aria-hidden />
            <span>The map already matches the narrated history — nothing to fix.</span>
            <Button variant="ghost" size="sm" onClick={() => setProposal(null)}>
              Done
            </Button>
          </div>
        ) : (
          <div className={styles.review}>
            <header className={styles.reviewHead}>
              <span className="pfKicker">Proposal</span>
              <span className={styles.reviewCount}>
                {lines.length} fix{lines.length === 1 ? "" : "es"}
                {proposal.dropped.length > 0 ? ` · ${proposal.dropped.length} refused` : ""}
              </span>
            </header>
            {proposal.notes.length > 0 ? (
              <ul className={styles.notes}>
                {proposal.notes.map((note, index) => (
                  <li key={index}>
                    <Info size={13} className={styles.noteIcon} aria-hidden />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className={styles.diff} aria-label="Proposed changes">
              {lines.map((line, index) => (
                <li key={index} className={styles.diffAdd}>
                  <span className={styles.diffSign} aria-hidden>
                    +
                  </span>
                  <span className={styles.diffKind}>{line.kind}</span>
                  <span className={styles.diffText}>{line.text}</span>
                </li>
              ))}
              {proposal.dropped.map((reason, index) => (
                <li key={`dropped-${index}`} className={styles.diffDrop} title="Refused by sanity checks">
                  <span className={styles.diffSign} aria-hidden>
                    −
                  </span>
                  <span className={styles.diffKind}>refused</span>
                  <span className={styles.diffText}>{reason}</span>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <Button variant="ghost" disabled={busy} onClick={() => setProposal(null)}>
                Discard
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  // Keep the proposal on failure so it can be retried.
                  void submit(proposal.impacts, "Map reassessment").then((landed) => {
                    if (landed) setProposal(null);
                  });
                }}
              >
                Apply {lines.length} fix{lines.length === 1 ? "" : "es"}
              </Button>
            </div>
          </div>
        )
      ) : null}
    </GmSection>
  );
}
