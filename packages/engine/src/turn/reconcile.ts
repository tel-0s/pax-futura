import {
  ReconciliationSchema,
  countryCodeVocabulary,
  toLlmToolSchema,
  type Reconciliation,
  type TurnResult,
  type WorldState,
} from "@pax/domain";
import type { LlmClient, LlmRequest, ModelBinding } from "@pax/providers";
import { validateTurnResult } from "./validate.ts";

export const RECONCILE_TOOL = toLlmToolSchema(
  "submit_reconciliation",
  "Per-event amendments: missing region transfers, structures or unit changes the narration clearly implies, plus each event's classification (kind, importance, playerRelated) and approximate location.",
  ReconciliationSchema,
);

export interface ReconcileDeps {
  /** The extractor role: short context, fresh eyes, cheap. */
  llm: LlmClient;
  binding: ModelBinding;
}

/**
 * The cartographer pass — the structural answer to long-game drift: the
 * simulator's discipline degrades as its context grows, so narrated outposts,
 * conquests, and levies stop reaching the map and every event collapses onto
 * the schema defaults (kind "world", importance "minor", playerRelated false,
 * no coordinates). This pass runs on the extractor model with ONLY the fresh
 * turn in view (immune to that drift): it may ADD impacts the events' own text
 * unambiguously states, and it classifies and locates every event.
 * Best-effort: any failure returns the turn unchanged.
 */
export const reconcileTurnImpacts = async (
  deps: ReconcileDeps,
  params: {
    turn: TurnResult;
    world: WorldState;
    parentDate: string;
    playerPolity?: string;
    signal?: AbortSignal;
  },
): Promise<TurnResult> => {
  const { turn, world } = params;
  if (turn.events.length === 0) return turn;
  const narrated = turn.events.reduce((n, e) => n + e.title.length + e.description.length, 0);
  if (narrated < 60) return turn; // nothing substantive to reconcile against

  try {
    const request = buildReconcileRequest(turn, world, {
      parentDate: params.parentDate,
      ...(params.playerPolity ? { playerPolity: params.playerPolity } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    const result = await deps.llm.stream(request, deps.binding).final();
    const parsed = ReconciliationSchema.safeParse(result.structured);
    if (!parsed.success || parsed.data.amendments.length === 0) return turn;

    const merged = mergeAmendments(turn, world, parsed.data.amendments);
    // Salvage drops invented region ids and unknown unit refs from the
    // amendments; residual ERRORS can also stem from the original turn (the
    // repair path accepts salvaged results with warnings), so they must not
    // veto the merge — salvaged is safe by construction.
    return validateTurnResult(merged, world, params.parentDate).salvaged;
  } catch (error) {
    console.warn("Impact reconciliation failed (turn kept as generated):", error);
    return turn;
  }
};

/** Merge amendments into their events, conservatively deduplicated. */
const mergeAmendments = (
  turn: TurnResult,
  world: WorldState,
  amendments: Reconciliation["amendments"],
): TurnResult => {
  const events = turn.events.map((event) => ({ ...event, impacts: { ...event.impacts } }));

  // Codes that exist or get registered anywhere in the merged result.
  const knownCodes = new Set(Object.keys(world.polities));
  for (const event of events) for (const c of event.impacts.polityChanges) knownCodes.add(c.code);
  for (const a of amendments) for (const c of a.impacts.polityChanges) knownCodes.add(c.code);

  const transferSeen = new Set(
    events.flatMap((e) => e.impacts.regionTransfers.map((t) => `${t.regionId}>${t.toCode ?? ""}`)),
  );
  const unitNames = new Set(world.units.map((u) => `${u.ownerCode}:${u.name.toLowerCase()}`));
  for (const e of events)
    for (const op of e.impacts.unitOps)
      if (op.op === "spawn") unitNames.add(`${op.unit.ownerCode}:${op.unit.name.toLowerCase()}`);
  const markerNames = new Set(world.markers.map((m) => m.name.toLowerCase()));
  for (const e of events)
    for (const op of e.impacts.markerOps)
      if (op.op === "build") markerNames.add(op.marker.name.toLowerCase());

  for (const amendment of amendments) {
    const event = events[amendment.eventIndex];
    if (!event) continue;
    const impacts = amendment.impacts;

    // Classification: the fresh-context extractor's judgment overrides whatever
    // the (possibly drifted) simulator emitted — a drifted simulator emits the
    // schema defaults, which are indistinguishable from a deliberate choice.
    if (amendment.kind !== undefined && amendment.kind.trim()) {
      event.kind = amendment.kind.trim().toLowerCase();
    }
    if (amendment.importance !== undefined) event.importance = amendment.importance;
    if (amendment.playerRelated !== undefined) event.playerRelated = amendment.playerRelated;
    // Location is additive only: a COMPLETE simulator pair is a first-hand
    // statement of place and outranks the cartographer's estimate. A half
    // pair (lng without lat) is unlocatable — let the amendment complete it.
    if (
      !(event.lng !== undefined && event.lat !== undefined) &&
      amendment.lng !== undefined &&
      amendment.lat !== undefined
    ) {
      event.lng = amendment.lng;
      event.lat = amendment.lat;
    }

    for (const transfer of impacts.regionTransfers) {
      const key = `${transfer.regionId}>${transfer.toCode ?? ""}`;
      if (transferSeen.has(key)) continue;
      if (transfer.toCode !== null && !knownCodes.has(transfer.toCode)) continue;
      transferSeen.add(key);
      event.impacts.regionTransfers = [...event.impacts.regionTransfers, transfer];
    }
    for (const change of impacts.polityChanges) {
      event.impacts.polityChanges = [...event.impacts.polityChanges, change];
    }
    for (const op of impacts.unitOps) {
      if (op.op === "spawn") {
        const key = `${op.unit.ownerCode}:${op.unit.name.toLowerCase()}`;
        if (unitNames.has(key)) continue; // never duplicate a narrated force
        unitNames.add(key);
      }
      event.impacts.unitOps = [...event.impacts.unitOps, op];
    }
    for (const op of impacts.markerOps) {
      if (op.op === "build") {
        const key = op.marker.name.toLowerCase();
        if (markerNames.has(key)) continue;
        markerNames.add(key);
      }
      event.impacts.markerOps = [...event.impacts.markerOps, op];
    }
    // actionIds/createdChats are deliberately not reconciled — the
    // cartographer's mandate is the map, not diplomacy.
  }
  return { ...turn, events };
};

const buildReconcileRequest = (
  turn: TurnResult,
  world: WorldState,
  options: { parentDate: string; playerPolity?: string; signal?: AbortSignal },
): LlmRequest => {
  const { parentDate, playerPolity, signal } = options;
  const eventBlocks = turn.events.map((event, index) => {
    const emitted = [
      ...event.impacts.regionTransfers.map((t) => `transfer ${t.regionId} -> ${t.toCode ?? "(unowned)"}`),
      ...event.impacts.unitOps.map((op) => (op.op === "spawn" ? `spawn ${op.unit.name}` : `${op.op} ${"unitId" in op ? op.unitId : ""}`)),
      ...event.impacts.markerOps.map((op) => (op.op === "build" ? `build ${op.marker.name}` : "remove marker")),
      ...event.impacts.polityChanges.map((c) => `polity ${c.code}`),
    ];
    const located =
      event.lng !== undefined && event.lat !== undefined
        ? `${event.lng.toFixed(2)},${event.lat.toFixed(2)}`
        : "(none)";
    return [
      `[${index}] ${event.date}: ${event.title}`,
      event.description ? `    ${event.description}` : "",
      `    current tags: kind=${event.kind}, importance=${event.importance}, playerRelated=${event.playerRelated}, location=${located}`,
      `    emitted impacts: ${emitted.length > 0 ? emitted.join("; ") : "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return {
    system: [
      {
        cacheable: true,
        text: `You are the cartographer and archivist of a grand-strategy game, reconciling one turn's narration with its mechanical record. You have two jobs.

JOB 1 — missing impacts. The simulator sometimes narrates territorial expansion, founded settlements/outposts/mines, or raised/destroyed forces WITHOUT emitting the matching impacts. Supply exactly those, keyed to the event that narrates them.
- Only add what an event's own text UNAMBIGUOUSLY states. Vague ambitions, plans, or negotiations get nothing. When in doubt, add nothing.
- Never remove, contradict, or restate impacts already emitted.
- Region ids are GADM codes: whole countries GID_0 ("USA"), sub-regions GID_1 ("USA.5_1"). Claiming unmapped land uses modern country codes at country granularity. Never invent ids.
- New settlements, outposts, mines, fortresses, ports: markerOps build with a fitting kind.
- Newly raised or destroyed forces: unitOps spawn/remove; movements only when a destination is stated.
- A new polity (colony, order, breakaway) taking territory must also be registered via polityChanges.

JOB 2 — classify and locate EVERY event. Emit one amendment per event (impacts empty when nothing is missing) carrying:
- importance: "pivotal" reshapes the strategic situation (war, regime change, alliance, decisive battle); "major" is a notable development with lasting consequences; "minor" is color, routine administration, or atmosphere.
- kind: one short lowercase category — war, diplomacy, economy, discovery, internal, culture, technology, disaster, world.
- playerRelated: true when the event directly involves the player nation${playerPolity ? ` (${playerPolity})` : ""} — its territory, forces, government, or an act aimed at or by it. Distant events elsewhere are false.
- lng/lat: approximate decimal-degree coordinates of where the event happened, when it happens at an identifiable place (a city, a front, a colony, a capital). Omit both when the event is abstract or global — never guess a centroid to fill the field.
The "current tags" shown for each event are the simulator's own labels and are frequently stale defaults (kind "world", importance "minor", playerRelated false). Confirm them when right; correct them when wrong. Judge from the event text, not from the existing tags.
Valid country codes (GID_0): ${countryCodeVocabulary()}`,
      },
    ],
    messages: [
      {
        role: "user",
        text: [
          `Date: ${parentDate}.`,
          playerPolity
            ? `Player nation: ${playerPolity} (${world.polities[playerPolity]?.name || playerPolity}).`
            : "Player nation: (unknown).",
          `Polities: ${Object.values(world.polities)
            .map((p) => `${p.code}=${p.name || p.code}`)
            .join(", ")}`,
          `Existing units: ${world.units.length > 0 ? world.units.map((u) => `${u.name} (${u.ownerCode})`).join("; ") : "(none)"}`,
          `Existing structures: ${world.markers.length > 0 ? world.markers.map((m) => `${m.name} (${m.kind})`).join("; ") : "(none)"}`,
          `Events of this turn:\n${eventBlocks.join("\n")}`,
        ].join("\n\n"),
      },
    ],
    tool: RECONCILE_TOOL,
    taskLabel: "reconcileImpacts",
    ...(signal ? { signal } : {}),
  };
};
