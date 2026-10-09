import {
  KNOWN_REGION_IDS,
  ReassessmentSchema,
  countryCodeVocabulary,
  emptyImpacts,
  toLlmToolSchema,
  type Impacts,
  type WorldState,
} from "@pax/domain";
import type { LlmClient, LlmRequest, ModelBinding } from "@pax/providers";
import type { SavePort } from "../ports.ts";
import { NotFoundError, ConflictError } from "../loom/tree.ts";

export const REASSESS_TOOL = toLlmToolSchema(
  "submit_reassessment",
  "Corrective impacts bringing the mechanical map back in line with recent narrated history: territorial control, structures/landmarks, and forces the story establishes but the map lacks (or that were lost and linger).",
  ReassessmentSchema,
);

/** How many recent turns of narration the auditor reads. */
export const REASSESS_SPAN = 20;

export interface ReassessDeps {
  store: SavePort;
  llm: LlmClient;
  binding: ModelBinding;
}

export interface ReassessmentProposal {
  impacts: Impacts;
  notes: string[];
  /** Proposed ops the sanitizer refused, with reasons — shown to the player. */
  dropped: string[];
}

/**
 * The GM "reassess map" audit: read the last REASSESS_SPAN turns of narrated
 * events against the node's current world and propose corrective impacts.
 * Dry-run only — the caller reviews the proposal and applies it through the
 * normal GM-edit path (a same-date child node, branchable and undoable).
 */
export const proposeMapReassessment = async (
  deps: ReassessDeps,
  params: { nodeId: string; signal?: AbortSignal },
): Promise<ReassessmentProposal> => {
  const { store } = deps;
  const node = store.getNode(params.nodeId);
  if (!node) throw new NotFoundError(`Unknown node: ${params.nodeId}`);
  if (!node.worldBlobHash) throw new ConflictError("Node has no world snapshot");
  const world = store.getWorld(node.worldBlobHash);

  const path = store.pathToRoot(params.nodeId);
  const span = path.slice(-REASSESS_SPAN).filter((entry) => entry.depth > 0);
  const events = store.listEventsForNodes(span.map((entry) => entry.id));
  if (events.length === 0) {
    return { impacts: emptyImpacts(), notes: [], dropped: ["No narrated history to audit yet."] };
  }

  const request = buildReassessRequest(world, events, node.gameDate, params.signal);
  const result = await deps.llm.stream(request, deps.binding).final();
  const parsed = ReassessmentSchema.safeParse(result.structured);
  if (!parsed.success) {
    throw new ConflictError(result.structuredError ?? "The auditor returned an unusable proposal — try again.");
  }
  const { impacts, dropped } = sanitize(parsed.data.changes, world);
  return { impacts, notes: parsed.data.notes, dropped };
};

/** Keep only ops the current world can actually accept; explain refusals. */
const sanitize = (proposed: Impacts, world: WorldState): { impacts: Impacts; dropped: string[] } => {
  const dropped: string[] = [];
  const impacts = emptyImpacts();

  const knownCodes = new Set(Object.keys(world.polities));
  for (const change of proposed.polityChanges) knownCodes.add(change.code);
  impacts.polityChanges = [...proposed.polityChanges];

  for (const transfer of proposed.regionTransfers) {
    if (!KNOWN_REGION_IDS.has(transfer.regionId) && !(transfer.regionId in world.regionOwnership)) {
      dropped.push(`transfer of unknown region id "${transfer.regionId}"`);
      continue;
    }
    if (transfer.toCode !== null && !knownCodes.has(transfer.toCode)) {
      dropped.push(`transfer of ${transfer.regionId} to unregistered polity "${transfer.toCode}"`);
      continue;
    }
    impacts.regionTransfers.push(transfer);
  }

  const unitIds = new Set(world.units.map((unit) => unit.id));
  const unitNames = new Set(world.units.map((unit) => `${unit.ownerCode}:${unit.name.toLowerCase()}`));
  for (const op of proposed.unitOps) {
    if (op.op === "spawn") {
      const key = `${op.unit.ownerCode}:${op.unit.name.toLowerCase()}`;
      if (unitNames.has(key)) {
        dropped.push(`duplicate unit "${op.unit.name}" (${op.unit.ownerCode})`);
        continue;
      }
      if (!knownCodes.has(op.unit.ownerCode)) {
        dropped.push(`unit "${op.unit.name}" for unregistered polity "${op.unit.ownerCode}"`);
        continue;
      }
      unitNames.add(key);
      impacts.unitOps.push(op);
    } else if (unitIds.has(op.unitId)) {
      impacts.unitOps.push(op);
    } else {
      dropped.push(`${op.op} on unknown unit id "${op.unitId}"`);
    }
  }

  const markerNames = new Set(world.markers.map((marker) => marker.name.toLowerCase()));
  for (const op of proposed.markerOps) {
    if (op.op === "build") {
      if (markerNames.has(op.marker.name.toLowerCase())) {
        dropped.push(`structure "${op.marker.name}" already exists`);
        continue;
      }
      markerNames.add(op.marker.name.toLowerCase());
      impacts.markerOps.push(op);
    } else {
      impacts.markerOps.push(op);
    }
  }

  // Diplomacy is out of the auditor's mandate.
  impacts.createdChats = [];
  impacts.actionIds = [];
  return { impacts, dropped };
};

const buildReassessRequest = (
  world: WorldState,
  events: ReadonlyArray<{ date: string; title: string; description: string }>,
  currentDate: string,
  signal?: AbortSignal,
): LlmRequest => ({
  system: [
    {
      cacheable: true,
      text: `You audit a grand-strategy game's mechanical map against its narrated history. Long games drift: the story establishes outposts, conquests, colonies, mines, and armies that never reached the map (and losses that were never removed). Compare the CURRENT MECHANICAL STATE with the RECENT NARRATED HISTORY and propose corrective impacts for exactly the gaps.

Rules:
- Only correct what the narration clearly establishes; do not invent developments or extrapolate.
- Region ids are GADM codes: whole countries GID_0 ("USA"), sub-regions GID_1 ("USA.5_1") from the current ownership list. Claiming previously unmapped land uses modern country codes at country granularity. Never invent ids.
- Settlements, outposts, mines, fortresses, ports the story founded but the map lacks: markerOps build with a fitting kind. Destroyed ones that linger: markerOps remove.
- Forces the story raised/lost: unitOps spawn (with a plausible position from the narration) / remove.
- A narrated polity (colony, order, breakaway state) absent from the catalog must be registered via polityChanges before territory transfers to it.
- Every correction gets one short human-readable line in notes (the player reviews these before applying).
Valid country codes (GID_0): ${countryCodeVocabulary()}`,
    },
  ],
  messages: [
    {
      role: "user",
      text: [
        `Current date: ${currentDate}.`,
        `CURRENT MECHANICAL STATE`,
        `Polities: ${Object.values(world.polities)
          .map((p) => `${p.code}=${p.name || p.code}`)
          .join(", ")}`,
        `Region ownership: ${
          Object.entries(world.regionOwnership).length > 0
            ? Object.entries(world.regionOwnership)
                .map(([regionId, owner]) => `${regionId}->${owner}`)
                .join("; ")
            : "(none recorded)"
        }`,
        `Units: ${world.units.length > 0 ? world.units.map((u) => `[${u.id}] ${u.name} (${u.type}, ${u.ownerCode}) str ${u.strength}`).join("; ") : "(none)"}`,
        `Structures: ${world.markers.length > 0 ? world.markers.map((m) => `${m.name} (${m.kind}${m.ownerCode ? `, ${m.ownerCode}` : ""})`).join("; ") : "(none)"}`,
        `RECENT NARRATED HISTORY`,
        events
          .map((event) => `- ${event.date}: ${event.title}${event.description ? ` — ${event.description}` : ""}`)
          .join("\n"),
      ].join("\n\n"),
    },
  ],
  tool: REASSESS_TOOL,
  taskLabel: "reassessMap",
  ...(signal ? { signal } : {}),
});
