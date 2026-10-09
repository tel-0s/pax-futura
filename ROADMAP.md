# Pax Futura — Roadmap

Sequenced by intent: preservation first (the Order of the Seraph's arc is closing
and its history deserves a binding), then the loom as an instrument, then the
simulation's soul, then joy. Architecture notes reference CLAUDE.md invariants.

## 1. Chronicle export — bind a campaign into a book ✅ (2026-07-27)

Export a whole campaign as a self-contained HTML volume: era summaries as
chapters, pivotal events as passages, open-threads ledgers as chapter codas,
ownership-map snapshots as plates, the loom path as an appendix (branches as
"apocrypha"). Styled by the active theme; printable.

- Everything needed is already stored: eras (`era_summaries`), events, facts,
  world snapshots per node. This is a read-only walk of one path plus a
  renderer — server endpoint streaming one HTML file, no new tables.
- Pair with **save import/export** (backlog): the book for reading, the
  `.pax.sqlite` for resurrection.

## 2. Branch → scenario — publish any node's world as a starting point ✅ (2026-07-27)

"Start from my 1215." Any complete node's world snapshot becomes a scenario
pack: seed world + metadata + (optionally) the era chronicle up to that point as
pregame history fed to the simulator.

- Generalizes the saved-nations extraction: `GET /nodes/:n/world` already
  yields a valid `WorldStateSchema`; wrap it in `ScenarioSchema`, write to
  `scenarios/` (hot-rescanned already), offer a download.
- Include `simulationRules` and a generated description; strip player-specific
  state. Chronicle-as-backstory is the differentiator — the new game *knows*
  its inherited history.

## 3. Sibling diff / A-B compare — the loom as an instrument ✅ (2026-07-27)

Pick two sibling branches: split map view with changed regions highlighted,
stat deltas, and an archivist-written "point of divergence" narrative.

- The facts system makes the diff nearly free: siblings share a rollup
  ancestor; the divergent fact sets ARE the diff. Map overlay = two
  `regionOwnership` match expressions + a computed changed-set layer.
- One utility-model call for the divergence narrative (same pattern as
  `summarizeEra`).

## 4. Leader psyches — nations that remember ✅ (2026-07-27)

A persistent per-polity profile (temperament, ambitions, grudges, opinion of
the player, promises kept/broken) maintained by the extractor each turn and fed
to the simulator + that nation's diplomacy persona.

- Extends the rollup fold: `psyches: Record<code, PsycheSheet>` evolving like
  nation sheets do today. Node-keyed → branch-safe for free.
- Feeds three prompts: simulator (NATIONS section), diplomat persona, advisor
  briefings. The relationship matrix gains a *why*.

## 5. The Gazette — a generated front page per turn ✅ (2026-07-27)

Era-styled news artifact from the turn's events: illuminated chronicle in 1200,
broadsheet in 1914, feed in 2045. One utility-model call + themed CSS.

- Client feature + one `taskLabel: "gazette"` call over events already in hand.
  Cache per node (same pattern as stat sheets). Enormous charm per unit effort.

## 6. Ghost turns — scout before you commit ✅ (2026-07-28)

"Preview this path": simulate a turn as a discardable preview; commit only on
accept. Builds on the existing cancel path (cancel deletes the node — a ghost
is a node whose default is deletion).

## 7. Intel & rumor — fog over the fact ledger ✅ v1 confidence tiers (2026-07-28)

Distant facts arrive as reports with confidence (and occasional falsehoods);
espionage actions buy accuracy. The extractor already grades and structures
information — this adds a visibility layer between the ledger and the player,
plus spy orders as first-class actions.

## 8. Idle diplomacy — nations open channels at you ✅ (2026-07-28)

Between turns, nations initiate contact based on the relationship matrix and
open threads (`createdChats` machinery exists; needs a trigger heuristic and
notification surface).

## 9. Internal politics — the advisor becomes a cast ✅ v1 council (2026-07-28)

Named ministers/factions with agendas who react to orders, argue with each
other, and occasionally force a choice. Builds on conversation infrastructure;
the extractor tracks faction standing like relationships.

## 10. Named anchors & map time-lapse (small joys) ✅ (2026-07-27)

- Anchors: bookmark nodes ("Eve of the Anatolian War") on the loom strip +
  chronicle. Trivial; big navigational payoff at 200 turns.
- Time-lapse: animate `regionOwnership` across the current path — every
  snapshot is already stored; purely a client feature.

## Standing backlog (infrastructure)

✅ Search drawer · ✅ save import/export · ✅ loom fingerprints (in lieu of
geographic thumbnails) · ✅ rung memo · ✅ usage logging (budgeter's data layer;
enforcement TBD) · ✅ live smoke script (`pnpm smoke`) · ✅ multi-country realm
composites for all historical scenarios.

Still open: token-budget ENFORCEMENT in assemble (data now collected) ·
per-save LLM role overrides (needs per-game client plumbing) · deeper intel
(espionage orders, false rumors) · faction standing mechanics for the council.
