import type { EraSummary, GameEvent } from "@pax/domain";

/** A player bookmark rendered in the book's outer margin. */
export interface Waypoint {
  date: string;
  anchor: string;
}

export interface BookMeta {
  title: string;
  nation: string;
  difficulty: string;
  startDate: string;
  endDate: string;
  turns: number;
}

/** One unsummarized turn of the tail, as a dated passage. */
export interface Passage {
  date: string;
  summary: string;
  anchor: string;
  major: GameEvent[];
  minor: GameEvent[];
  lines: string[];
}

/** A sibling branch hanging off the exported path. */
export interface Apocryphon {
  date: string;
  summary: string;
  anchor: string;
}

export const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Escaped <p> blocks; blank lines split, single newlines break. */
const paragraphs = (text: string): string =>
  text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replaceAll("\n", "<br />")}</p>`)
    .join("\n");

const waypoints = (marks: readonly Waypoint[]): string =>
  marks
    .map(
      (mark) =>
        `<aside class="waypoint"><span class="waypointDate">${escapeHtml(mark.date)}</span>` +
        `<span class="waypointName">${escapeHtml(mark.anchor)}</span></aside>`,
    )
    .join("\n");

const ledger = (threads: readonly string[]): string =>
  threads.length === 0
    ? ""
    : `<div class="coda"><h3>Threads left unspooled</h3><ul>${threads
        .map((thread) => `<li>${escapeHtml(thread)}</li>`)
        .join("")}</ul></div>`;

const eventBlock = (event: GameEvent): string =>
  `<div class="event ${event.importance === "pivotal" ? "pivotal" : "major"}">
<h4>${escapeHtml(event.title)}<span class="stamp">${escapeHtml(event.importance)}</span></h4>
<p class="eventDate">${escapeHtml(event.date)}${event.playerRelated ? " · of our own doing" : ""}</p>
${event.description ? paragraphs(event.description) : ""}</div>`;

const minorList = (events: readonly GameEvent[], lines: readonly string[]): string => {
  const items = [
    ...events.map((event) => `${event.date} — ${event.title}`),
    ...lines,
  ].map((line) => `<li>${escapeHtml(line)}</li>`);
  return items.length === 0 ? "" : `<ul class="marginalia">${items.join("")}</ul>`;
};

export const renderTitlePage = (meta: BookMeta, contents: readonly string[]): string =>
  `<section class="titlepage">
<p class="imprint">A Chronicle of</p>
<h1>${escapeHtml(meta.title)}</h1>
<p class="ornament">❧</p>
<p class="byline">Being the history of ${escapeHtml(meta.nation)}, from ${escapeHtml(meta.startDate)} to ${escapeHtml(meta.endDate)}</p>
<p class="colophon">${meta.turns} turn${meta.turns === 1 ? "" : "s"} · ${escapeHtml(meta.difficulty)} chronicle</p>
${
  contents.length === 0
    ? ""
    : `<nav class="contents"><h2>Contents</h2><ol>${contents
        .map((entry) => `<li>${escapeHtml(entry)}</li>`)
        .join("")}</ol></nav>`
}
</section>`;

export const renderEraChapter = (
  era: EraSummary,
  marks: readonly Waypoint[],
  ordinal: number,
): string =>
  `<section class="chapter">
<p class="chapterNumber">Chapter ${ordinal}</p>
<h2>${escapeHtml(era.title)}</h2>
<p class="span">${escapeHtml(era.startDate)} — ${escapeHtml(era.endDate)} · turns ${era.startDepth}–${era.endDepth}</p>
${waypoints(marks)}
<div class="narrative">${paragraphs(era.summary)}</div>
${ledger(era.openThreads)}
</section>`;

export const renderPresentAge = (passages: readonly Passage[]): string =>
  `<section class="chapter present">
<p class="chapterNumber">Coda</p>
<h2>The Present Age</h2>
<p class="span">Days still wet with ink, set down as they fell</p>
${
  passages.length === 0
    ? `<p class="empty">The chronicle has caught up with itself; nothing yet lies beyond the last era.</p>`
    : passages
        .map(
          (passage) => `<article class="passage">
${passage.anchor ? waypoints([{ date: passage.date, anchor: passage.anchor }]) : ""}
<h3>${escapeHtml(passage.date)}</h3>
${paragraphs(passage.summary)}
${passage.major.map(eventBlock).join("\n")}
${minorList(passage.minor, passage.lines)}
</article>`,
        )
        .join("\n")
}
</section>`;

export const renderApocrypha = (entries: readonly Apocryphon[]): string =>
  `<section class="chapter apocrypha">
<p class="chapterNumber">Appendix</p>
<h2>Apocrypha</h2>
<p class="span">Branches struck from this timeline and left unwalked</p>
${
  entries.length === 0
    ? `<p class="empty">No other road was ever surveyed.</p>`
    : `<ul class="roads">${entries
        .map(
          (entry) =>
            `<li><span class="roadDate">${escapeHtml(entry.date)}</span>` +
            `<span class="roadText">${escapeHtml(entry.anchor || entry.summary || "An unwritten turn")}</span>` +
            `<span class="roadNote">the road not taken</span></li>`,
        )
        .join("")}</ul>`
}
</section>`;

export const renderDocument = (title: string, body: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${BOOK_CSS}</style>
</head>
<body><main class="volume">
${body}
</main></body>
</html>`;

/** Baked palette and book typography: this document leaves the app, so it
 *  cannot rely on --pf-* tokens or any external stylesheet or font. */
const BOOK_CSS = `
:root { color-scheme: light dark;
  --paper: #f7f3ea; --ink: #241f19; --muted: #6f6558;
  --rule: #d6cbb6; --accent: #8a6a2f; --shade: #efe8d9; }
@media (prefers-color-scheme: dark) {
  :root { --paper: #14120e; --ink: #e6ded0; --muted: #9c9183;
    --rule: #38312a; --accent: #c8a35e; --shade: #1c1913; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif;
  font-size: 17px; line-height: 1.62; text-rendering: optimizeLegibility; }
.volume { max-width: 34rem; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
h1, h2, h3, h4 { font-weight: 600; line-height: 1.2; margin: 0; }
p { margin: 0 0 1em; hyphens: auto; }
.titlepage { text-align: center; padding: 3rem 0 5rem; }
.titlepage h1 { font-size: 2.6rem; font-variant: small-caps; letter-spacing: 0.03em; margin: 0.4em 0; }
.imprint, .colophon { color: var(--muted); font-variant: small-caps; letter-spacing: 0.16em; font-size: 0.8rem; }
.byline { font-style: italic; color: var(--ink); }
.ornament { color: var(--accent); font-size: 1.6rem; margin: 0.6em 0; }
.contents { margin-top: 3.5rem; text-align: left; border-top: 1px solid var(--rule); padding-top: 1.4rem; }
.contents h2 { font-size: 0.8rem; font-variant: small-caps; letter-spacing: 0.16em; color: var(--muted); }
.contents ol { margin: 0.8em 0 0; padding-left: 1.4em; color: var(--muted); }
.contents li { margin-bottom: 0.3em; }
.chapter { break-before: page; page-break-before: always; margin-top: 5rem;
  border-top: 1px solid var(--rule); padding-top: 3rem; }
.chapterNumber { color: var(--accent); font-variant: small-caps; letter-spacing: 0.2em; font-size: 0.78rem; margin-bottom: 0.4em; }
.chapter h2 { font-size: 1.9rem; font-variant: small-caps; letter-spacing: 0.02em; }
.span { color: var(--muted); font-style: italic; font-size: 0.9rem; margin: 0.5em 0 2em; }
.narrative > p:first-of-type::first-letter { float: left; font-size: 3.1em; line-height: 0.86;
  padding: 0.02em 0.08em 0 0; color: var(--accent); }
.coda { margin-top: 2.4rem; padding: 1.2rem 1.4rem; background: var(--shade);
  border-left: 3px solid var(--accent); }
.coda h3 { font-size: 0.82rem; font-variant: small-caps; letter-spacing: 0.14em; color: var(--muted); }
.coda ul { margin: 0.8em 0 0; padding-left: 1.2em; }
.coda li { margin-bottom: 0.35em; font-style: italic; }
.passage { margin-bottom: 2.6rem; }
.passage h3 { font-size: 1rem; font-variant: small-caps; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 0.7em; }
.event { margin: 1.4rem 0; padding-left: 1rem; border-left: 2px solid var(--rule); }
.event.pivotal { border-left-color: var(--accent); }
.event h4 { font-size: 1.12rem; }
.event.pivotal h4 { font-style: italic; }
.stamp { margin-left: 0.6em; font-size: 0.62rem; font-variant: small-caps; letter-spacing: 0.16em;
  color: var(--accent); vertical-align: 0.28em; }
.eventDate { color: var(--muted); font-size: 0.8rem; margin: 0.2em 0 0.7em; }
.marginalia { margin: 1em 0 0; padding-left: 1.1em; color: var(--muted); font-size: 0.84rem; }
.marginalia li { margin-bottom: 0.2em; }
.waypoint { float: left; clear: left; width: 9rem; margin: 0.5rem 0 1rem -11.5rem;
  text-align: right; border-right: 2px solid var(--accent); padding-right: 0.7rem; }
.waypointDate, .waypointName { display: block; }
.waypointDate { color: var(--muted); font-size: 0.72rem; letter-spacing: 0.1em; }
.waypointName { font-style: italic; font-size: 0.88rem; }
.roads { list-style: none; margin: 0; padding: 0; }
.roads li { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline;
  padding: 0.5rem 0; border-bottom: 1px dotted var(--rule); }
.roadDate { color: var(--muted); font-size: 0.78rem; letter-spacing: 0.08em; min-width: 6rem; }
.roadText { flex: 1 1 12rem; }
.roadNote { color: var(--accent); font-style: italic; font-size: 0.78rem; }
.empty { color: var(--muted); font-style: italic; }
@media (max-width: 62rem) {
  .waypoint { float: none; width: auto; margin: 1rem 0; text-align: left;
    border-right: 0; border-left: 2px solid var(--accent); padding: 0 0 0 0.7rem; }
}
@media print {
  body { background: #fff; color: #111; font-size: 11pt; }
  .volume { max-width: none; padding: 0; }
  .coda { background: none; }
  .waypoint, .event, .passage, .coda { break-inside: avoid; page-break-inside: avoid; }
}
`;
