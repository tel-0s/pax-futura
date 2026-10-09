import { describe, expect, it } from "vitest";
import { isUnread, markSeen, ulidTimePrefix, type SeenLedger } from "./seen.ts";

describe("ulidTimePrefix", () => {
  it("matches the timestamp half of a real ULID", () => {
    // The ULID spec's example id, 01ARZ3NDEKTSV4RRFFQ69G5FAV, decodes to this time.
    expect(ulidTimePrefix(1469922850259)).toBe("01ARZ3NDEK");
  });

  it("sorts like time", () => {
    expect(ulidTimePrefix(1_000) < ulidTimePrefix(2_000)).toBe(true);
  });
});

describe("unread ledger", () => {
  const ledger: SeenLedger = { since: "01M4C70000", heads: { seen: "01M4C72000AAAAAAAAAAAAAAAA" } };

  it("ignores channels whose head predates the ledger", () => {
    expect(isUnread(ledger, "old", "01KY8X67TZZK2AQ5XG29ZFYNR8")).toBe(false);
  });

  it("flags a never-seen channel with a newer head", () => {
    expect(isUnread(ledger, "overture", "01M4C71000AAAAAAAAAAAAAAAA")).toBe(true);
  });

  it("flags only heads newer than the last one seen", () => {
    expect(isUnread(ledger, "seen", "01M4C72000AAAAAAAAAAAAAAAA")).toBe(false);
    // An older head (e.g. checking out an earlier turn) is not news.
    expect(isUnread(ledger, "seen", "01M4C71500AAAAAAAAAAAAAAAA")).toBe(false);
    expect(isUnread(ledger, "seen", "01M4C73000AAAAAAAAAAAAAAAA")).toBe(true);
  });

  it("never flags an empty channel", () => {
    expect(isUnread(ledger, "empty", null)).toBe(false);
  });

  it("only moves forward, and returns the same ledger when nothing changed", () => {
    expect(markSeen(ledger, "seen", "01M4C71500AAAAAAAAAAAAAAAA")).toBe(ledger);
    expect(markSeen(ledger, "seen", null)).toBe(ledger);
    const next = markSeen(ledger, "seen", "01M4C73000AAAAAAAAAAAAAAAA");
    expect(next.heads.seen).toBe("01M4C73000AAAAAAAAAAAAAAAA");
    expect(ledger.heads.seen).toBe("01M4C72000AAAAAAAAAAAAAAAA");
  });
});
