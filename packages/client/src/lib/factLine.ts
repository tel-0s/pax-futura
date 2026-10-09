/**
 * The engine's fact-digest wire format, read for display: an optional intel
 * mark ("(reported) " / "(rumor) ") then an optional category head
 * ("territory ", "notable: "…) then the body. Shared by the chronicle and
 * search — keep the words, only style them.
 */

const CONFIDENCE_MARK = /^\((reported|rumor)\) /;
const CATEGORY_HEAD = /^([a-z_]+):? /;

export const FACT_CATEGORIES = [
  "war_started",
  "war_ended",
  "treaty",
  "treaty_broken",
  "leader",
  "government",
  "economy",
  "relations",
  "arc",
  "commitment",
  "notable",
  "territory",
  "polity",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

const KNOWN = new Set<string>(FACT_CATEGORIES);

export type Confidence = "reported" | "rumor" | null;

/** Split a digest line into its intel mark, category and body. */
export const parseDigestLine = (
  line: string,
): { confidence: Confidence; category: FactCategory | null; body: string } => {
  const mark = CONFIDENCE_MARK.exec(line);
  const confidence = (mark?.[1] as Confidence | undefined) ?? null;
  const rest = mark ? line.slice(mark[0].length) : line;
  const head = CATEGORY_HEAD.exec(rest);
  if (head?.[1] && KNOWN.has(head[1])) {
    return { confidence, category: head[1] as FactCategory, body: rest.slice(head[0].length) };
  }
  return { confidence, category: null, body: rest };
};
