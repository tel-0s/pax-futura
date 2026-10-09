import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import type { CouncilMember } from "./council.ts";
import styles from "./ConversationsDrawer.module.css";

/**
 * The council roster: pick a minister to open (or re-enter) their channel.
 * Each row carries the minister's epithet, because the whole point of three
 * standing advisors is that the player knows whose bias they are asking for.
 *
 * The trigger lives in here with the popover so that the dismiss-on-outside-
 * click handler counts the trigger as "inside" — otherwise mousedown would
 * close the menu just before the click reopened it.
 */
export function CouncilMenu({
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
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Capture: sibling listeners elsewhere in the stage stop propagation.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pick = (title: string) => {
    setOpen(false);
    onPick(title);
  };

  return (
    <div className={styles.menuWrap} ref={wrap}>
      <Button
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        + Council
      </Button>
      {open ? (
        <div className={styles.menu} role="menu" aria-label="Council">
          {members.map((member) => (
            <button
              key={member.role}
              role="menuitem"
              className={styles.menuItem}
              onClick={() => pick(member.title)}
            >
              <span className={styles.menuName}>
                {member.title}
                {openTitles.has(member.title) ? <span className={styles.menuOpen}>open</span> : null}
              </span>
              <span className={styles.menuHint}>{member.personaHint}</span>
            </button>
          ))}
          {showAdvisor ? (
            <button role="menuitem" className={styles.menuItem} onClick={() => pick("Advisor")}>
              <span className={styles.menuName}>Advisor</span>
              <span className={styles.menuHint}>your unaligned chief of staff</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
