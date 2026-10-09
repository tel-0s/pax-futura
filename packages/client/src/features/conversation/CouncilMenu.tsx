import { useCallback, useState } from "react";
import { Landmark } from "lucide-react";
import { Popover } from "../../components/Popover.tsx";
import type { CouncilMember } from "./council.ts";
import { Seal } from "./Seal.tsx";
import styles from "./Cast.module.css";

/**
 * The council roster: pick a minister to open (or re-enter) their channel.
 * Each row carries the minister's epithet, because the whole point of three
 * standing advisors is that the player knows whose bias they are asking for.
 * Rendered inside the seat's popover, and inline on an empty desk.
 */
export function CouncilRoster({
  members,
  openTitles,
  showAdvisor,
  onPick,
}: {
  members: CouncilMember[];
  /** Titles that already have a conversation at this node — those re-focus. */
  openTitles: Set<string>;
  /** Offer the legacy single advisor too, while none exists. */
  showAdvisor: boolean;
  onPick: (title: string) => void;
}) {
  return (
    <div className={styles.pickList} role="menu" aria-label="Council">
      {members.map((member) => (
        <button
          key={member.role}
          type="button"
          role="menuitem"
          className={styles.pickRow}
          onClick={() => onPick(member.title)}
        >
          <Seal role={member.role} size={32} />
          <span className={styles.pickText}>
            <span className={styles.pickName}>
              {member.title}
              {openTitles.has(member.title) ? <span className={styles.pickOpen}>open</span> : null}
            </span>
            <span className={styles.pickHint}>{member.personaHint}</span>
          </span>
        </button>
      ))}
      {showAdvisor ? (
        <button type="button" role="menuitem" className={styles.pickRow} onClick={() => onPick("Advisor")}>
          <Seal role="advisor" size={32} />
          <span className={styles.pickText}>
            <span className={styles.pickName}>Advisor</span>
            <span className={styles.pickHint}>your unaligned chief of staff</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The council seat at the end of the cast: an empty chair that opens the
 * roster. The trigger is handed to the shared Popover, which counts it as
 * "inside" for dismissal — so a click on an open trigger toggles instead of
 * closing on mousedown and reopening on click.
 */
export function CouncilMenu({
  members,
  openTitles,
  showAdvisor,
  onPick,
}: {
  members: CouncilMember[];
  openTitles: Set<string>;
  showAdvisor: boolean;
  onPick: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const pick = (title: string) => {
    setOpen(false);
    onPick(title);
  };

  const trigger = (
    <button
      type="button"
      className={`${styles.seat} ${open ? styles.seatOpen : ""}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Summon a minister"
      title="Summon a minister of the council"
      onClick={() => setOpen((wasOpen) => !wasOpen)}
    >
      <Landmark size={15} />
    </button>
  );

  return (
    <Popover open={open} onClose={close} trigger={trigger} align="end" width={300}>
      <div className={styles.picker}>
        <div className={styles.pickerHead}>
          <span className="pfKicker">The council</span>
          <span className={styles.pickerNote}>each argues their own corner</span>
        </div>
        <CouncilRoster members={members} openTitles={openTitles} showAdvisor={showAdvisor} onPick={pick} />
      </div>
    </Popover>
  );
}
