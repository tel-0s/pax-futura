/**
 * Game dates are ISO-ish strings ("1204-05-31", occasionally negative or
 * free-form). These helpers render them for people while never throwing on
 * a shape they don't recognise — unknown strings pass through untouched.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Parts {
  year: number;
  month: number;
  day: number;
}

export const parseGameDate = (value: string | undefined | null): Parts | null => {
  const match = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})/.exec(value?.trim() ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
};

const yearLabel = (year: number): string => (year <= 0 ? `${1 - year} BC` : String(year));

/** "31 May 1204" — or the raw string when it isn't a date we understand. */
export const formatGameDate = (value: string | undefined | null): string => {
  const parts = parseGameDate(value);
  if (!parts) return value ?? "";
  return `${parts.day} ${MONTHS[parts.month - 1]} ${yearLabel(parts.year)}`;
};

/** "May 1204" — compact form for dense rows. */
export const formatGameMonth = (value: string | undefined | null): string => {
  const parts = parseGameDate(value);
  if (!parts) return value ?? "";
  return `${MONTHS[parts.month - 1]!.slice(0, 3)} ${yearLabel(parts.year)}`;
};

/** "31 May" — day and month only, for rows grouped under a year. */
export const formatDayMonth = (value: string | undefined | null): string => {
  const parts = parseGameDate(value);
  if (!parts) return value ?? "";
  return `${parts.day} ${MONTHS[parts.month - 1]!.slice(0, 3)}`;
};

/** Human span between two game dates: "3 weeks", "1 year 2 months". */
export const describeSpan = (from: string | undefined, to: string | undefined): string => {
  const a = parseGameDate(from);
  const b = parseGameDate(to);
  if (!a || !b) return "";
  const days = Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
  if (days <= 0) return "";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return `${years} year${years === 1 ? "" : "s"}${rest ? ` ${rest} month${rest === 1 ? "" : "s"}` : ""}`;
};

/** "3 days ago" for wall-clock timestamps (library cards). */
export const relativeTime = (timestamp: number | null | undefined): string => {
  if (!timestamp) return "never played";
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago`;
  const months = days / 30.44;
  if (months < 12) return `${Math.round(months)} mo ago`;
  return `${Math.round(months / 12)} yr ago`;
};
