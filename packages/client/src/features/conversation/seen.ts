/**
 * Per-channel "unread": which reply in each channel the player has actually
 * looked at, kept per game in localStorage (a per-viewer convenience — losing
 * it only costs a stray dot).
 *
 * Message ids are ULIDs, so they sort by creation time and "newer than what I
 * saw" is a plain string comparison. That ordering is what makes the ledger
 * safe across the loom: checking out an older turn shows OLDER heads, which
 * never read as unread. A channel never looked at is measured against the
 * moment the ledger was started, so the first visit to an existing campaign
 * doesn't light up every channel it already has.
 */

export interface SeenLedger {
  /** ULID time prefix of when this ledger began (the floor for unseen channels). */
  since: string;
  /** Newest head id the player has seen, per conversation. */
  heads: Record<string, string>;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The 10-character ULID timestamp prefix for a millisecond time. */
export const ulidTimePrefix = (ms: number): string => {
  let value = Math.max(0, Math.floor(ms));
  let out = "";
  for (let index = 0; index < 10; index++) {
    out = CROCKFORD[value % 32]! + out;
    value = Math.floor(value / 32);
  }
  return out;
};

const storageKey = (gameId: string): string => `pax-conv-seen:${gameId}`;

const isLedger = (value: unknown): value is SeenLedger =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as SeenLedger).since === "string" &&
  typeof (value as SeenLedger).heads === "object" &&
  (value as SeenLedger).heads !== null;

export const writeLedger = (gameId: string, ledger: SeenLedger): void => {
  try {
    localStorage.setItem(storageKey(gameId), JSON.stringify(ledger));
  } catch {
    // Private mode / blocked storage: unread dots just won't survive a reload.
  }
};

export const readLedger = (gameId: string, now = Date.now()): SeenLedger => {
  try {
    const raw = localStorage.getItem(storageKey(gameId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isLedger(parsed)) return parsed;
  } catch {
    // fall through to a fresh ledger
  }
  const fresh: SeenLedger = { since: ulidTimePrefix(now), heads: {} };
  writeLedger(gameId, fresh);
  return fresh;
};

export const isUnread = (
  ledger: SeenLedger,
  conversationId: string,
  headMessageId: string | null,
): boolean => headMessageId !== null && headMessageId > (ledger.heads[conversationId] ?? ledger.since);

/** Record a head as seen; returns the same ledger when nothing moved forward. */
export const markSeen = (
  ledger: SeenLedger,
  conversationId: string,
  headMessageId: string | null,
): SeenLedger => {
  if (!headMessageId) return ledger;
  const previous = ledger.heads[conversationId];
  if (previous !== undefined && previous >= headMessageId) return ledger;
  return { ...ledger, heads: { ...ledger.heads, [conversationId]: headMessageId } };
};
