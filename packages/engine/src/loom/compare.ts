import {
  DivergenceNarrativeSchema,
  regionDisplayName,
  toLlmToolSchema,
  type DivergenceNarrative,
  type DivergenceReport,
  type GameEvent,
  type Marker,
  type Unit,
  type WorldState,
} from "@pax/domain";
import type { LlmClient, LlmRequest, ModelBinding } from "@pax/providers";
import type { NodeRow, SavePort } from "../ports.ts";
import { ConflictError, NotFoundError } from "./tree.ts";

export interface CompareDeps {
  store: SavePort;
  /** Utility/extractor role — one small call for the divergence narrative. */
  llm: LlmClient;
  binding: ModelBinding;
}

const DIVERGENCE_TOOL = toLlmToolSchema(
  "submit_divergence",
  "A historian's point-of-divergence account comparing two tellings of the same span of time, naming what one telling has that the other lacks.",
  DivergenceNarrativeSchema,
);

/**
 * The sibling diff: what one re-roll of the same frozen input changed.
 * Deterministic world deltas plus an archivist-written point-of-divergence
 * narrative. Both nodes must be complete siblings.
 *
 * The deterministic report ALWAYS succeeds — the narrative is one optional
 * model call whose every failure mode collapses to `narrative: null`.
 */
export const compareSiblings = async (
  deps: CompareDeps,
  params: { aId: string; bId: string; signal?: AbortSignal },
): Promise<DivergenceReport> => {
  const { store } = deps;
  const a = store.getNode(params.aId);
  const b = store.getNode(params.bId);
  if (!a || !b) throw new NotFoundError("Unknown node");
  if (a.parentId === null || a.parentId !== b.parentId) {
    throw new ConflictError("Only sibling turns (same parent) can be compared");
  }
  if (!a.worldBlobHash || !b.worldBlobHash) {
    throw new ConflictError("Both siblings must be complete");
  }

  const worldA = store.getWorld(a.worldBlobHash);
  const worldB = store.getWorld(b.worldBlobHash);
  // The shared ancestor turns "present in A only" into "razed in B" where it
  // can; unavailable (pruned blob, odd save) just costs us the nuance.
  const parentWorld = safeWorld(store, a.parentId);

  const regionIds = new Set([
    ...Object.keys(worldA.regionOwnership),
    ...Object.keys(worldB.regionOwnership),
  ]);
  const regionChanges: DivergenceReport["regionChanges"] = [];
  for (const regionId of regionIds) {
    const ownerA = worldA.regionOwnership[regionId] ?? null;
    const ownerB = worldB.regionOwnership[regionId] ?? null;
    if (ownerA !== ownerB) {
      regionChanges.push({ regionId, regionName: regionDisplayName(regionId), a: ownerA, b: ownerB });
    }
  }
  regionChanges.sort((x, y) => x.regionId.localeCompare(y.regionId));

  const polityDiffs = diffPolities(worldA, worldB);
  const unitDiffs = diffUnits(worldA, worldB, parentWorld);
  const markerDiffs = diffMarkers(worldA, worldB, parentWorld);

  const narrative = await writeNarrative(deps, {
    a,
    b,
    deltas: { regionChanges, polityDiffs, unitDiffs, markerDiffs },
    ...(params.signal ? { signal: params.signal } : {}),
  });

  return {
    aNodeId: a.id,
    bNodeId: b.id,
    regionChanges,
    polityDiffs,
    unitDiffs,
    markerDiffs,
    narrative,
  };
};

const safeWorld = (store: SavePort, nodeId: string): WorldState | null => {
  const node = store.getNode(nodeId);
  if (!node?.worldBlobHash) return null;
  try {
    return store.getWorld(node.worldBlobHash);
  } catch {
    return null;
  }
};

const label = (code: string, name: string): string => (name && name !== code ? `${code} (${name})` : code);

/** Registrations, renames, retags and reputation shifts, sorted by code. */
const diffPolities = (worldA: WorldState, worldB: WorldState): string[] => {
  const codes = [...new Set([...Object.keys(worldA.polities), ...Object.keys(worldB.polities)])].sort();
  const lines: string[] = [];
  for (const code of codes) {
    const inA = worldA.polities[code];
    const inB = worldB.polities[code];
    if (inA && !inB) {
      lines.push(`${label(code, inA.name)} registered in A only`);
      continue;
    }
    if (inB && !inA) {
      lines.push(`${label(code, inB.name)} registered in B only`);
      continue;
    }
    if (!inA || !inB) continue;
    if (inA.name !== inB.name) {
      lines.push(`${code} named "${inA.name || "—"}" in A, "${inB.name || "—"}" in B`);
    }
    if (inA.reputation !== inB.reputation) {
      lines.push(`${code} reputation ${inA.reputation ?? "unset"} -> ${inB.reputation ?? "unset"}`);
    }
    const tagsA = [...inA.tags].sort().join(", ");
    const tagsB = [...inB.tags].sort().join(", ");
    if (tagsA !== tagsB) {
      lines.push(`${code} tags [${tagsA || "none"}] -> [${tagsB || "none"}]`);
    }
  }
  return lines;
};

const unitLabel = (unit: Unit): string => `${unit.name} (${unit.ownerCode})`;

const coords = (unit: Unit): string => `${unit.lng.toFixed(2)}, ${unit.lat.toFixed(2)}`;

/**
 * Units match by id: a unit spawned independently in both branches gets a
 * fresh id in each, so it correctly reads as two one-sided appearances.
 */
const diffUnits = (worldA: WorldState, worldB: WorldState, parent: WorldState | null): string[] => {
  const byId = (world: WorldState): Map<string, Unit> =>
    new Map(world.units.map((unit) => [unit.id, unit]));
  const unitsA = byId(worldA);
  const unitsB = byId(worldB);
  const inherited = new Set((parent?.units ?? []).map((unit) => unit.id));
  const ids = [...new Set([...unitsA.keys(), ...unitsB.keys()])].sort();

  const lines: string[] = [];
  for (const id of ids) {
    const inA = unitsA.get(id);
    const inB = unitsB.get(id);
    if (inA && !inB) {
      lines.push(
        inherited.has(id)
          ? `${unitLabel(inA)} survives in A at strength ${inA.strength}, gone in B`
          : `${unitLabel(inA)} raised in A only, strength ${inA.strength}`,
      );
      continue;
    }
    if (inB && !inA) {
      lines.push(
        inherited.has(id)
          ? `${unitLabel(inB)} survives in B at strength ${inB.strength}, gone in A`
          : `${unitLabel(inB)} raised in B only, strength ${inB.strength}`,
      );
      continue;
    }
    if (!inA || !inB) continue;
    if (inA.strength !== inB.strength) {
      lines.push(`${unitLabel(inA)} strength ${inA.strength} -> ${inB.strength}`);
    }
    if (inA.lng !== inB.lng || inA.lat !== inB.lat) {
      lines.push(`${unitLabel(inA)} positioned at ${coords(inA)} in A, ${coords(inB)} in B`);
    }
    if (inA.status !== inB.status) {
      lines.push(`${unitLabel(inA)} ${inA.status} in A, ${inB.status} in B`);
    }
  }
  return lines;
};

/**
 * Structures match by NAME, not id: two branches that both build "Atlantic
 * Wall" mint different ids for the same intent, and the diff a player wants
 * to read is "this got built in one telling", not an id census.
 */
const diffMarkers = (worldA: WorldState, worldB: WorldState, parent: WorldState | null): string[] => {
  const byName = (markers: readonly Marker[]): Map<string, Marker> =>
    new Map(markers.map((marker) => [marker.name.toLowerCase(), marker]));
  const markersA = byName(worldA.markers);
  const markersB = byName(worldB.markers);
  const inherited = byName(parent?.markers ?? []);
  const names = [...new Set([...markersA.keys(), ...markersB.keys()])].sort();

  const lines: string[] = [];
  for (const name of names) {
    const inA = markersA.get(name);
    const inB = markersB.get(name);
    if (inA && inB) continue;
    const marker = inA ?? inB;
    if (!marker) continue;
    const side = inA ? "A" : "B";
    const other = inA ? "B" : "A";
    const owner = marker.ownerCode ? ` (${marker.ownerCode})` : "";
    lines.push(
      inherited.has(name)
        ? `${marker.kind} "${marker.name}"${owner} stands in ${side}, razed in ${other}`
        : `${marker.kind} "${marker.name}"${owner} built in ${side} only`,
    );
  }
  return lines;
};

/**
 * One utility-model call for the point-of-divergence account. Skipped outright
 * when neither sibling recorded an event (there is nothing to compare), and
 * every failure — transport, refusal, invalid payload — returns null so the
 * deterministic report is never held hostage to the model.
 */
const writeNarrative = async (
  deps: CompareDeps,
  params: {
    a: NodeRow;
    b: NodeRow;
    deltas: Pick<DivergenceReport, "regionChanges" | "polityDiffs" | "unitDiffs" | "markerDiffs">;
    signal?: AbortSignal;
  },
): Promise<DivergenceNarrative | null> => {
  const { store } = deps;
  const eventsA = store.listEventsForNode(params.a.id);
  const eventsB = store.listEventsForNode(params.b.id);
  if (eventsA.length === 0 && eventsB.length === 0) return null;

  try {
    const result = await deps.llm
      .stream(buildDivergenceRequest({ ...params, eventsA, eventsB }), deps.binding)
      .final();
    const parsed = DivergenceNarrativeSchema.safeParse(result.structured);
    if (!parsed.success) throw new Error(result.structuredError ?? "invalid divergence narrative");
    return parsed.data;
  } catch (error) {
    console.warn(`Divergence narrative failed (${params.a.id} vs ${params.b.id}):`, error);
    return null;
  }
};

const eventBlock = (events: readonly GameEvent[]): string =>
  events.length > 0
    ? events
        .slice(0, 14)
        .map((event) => `- ${event.title} — ${event.description || "(no further detail)"}`)
        .join("\n")
    : "- (no events recorded)";

const buildDivergenceRequest = (params: {
  a: NodeRow;
  b: NodeRow;
  eventsA: readonly GameEvent[];
  eventsB: readonly GameEvent[];
  deltas: Pick<DivergenceReport, "regionChanges" | "polityDiffs" | "unitDiffs" | "markerDiffs">;
  signal?: AbortSignal;
}): LlmRequest => {
  const { a, b, deltas } = params;
  const deltaLines = [
    ...deltas.regionChanges.map(
      (change) =>
        `- ${change.regionName || change.regionId}: ${change.a ?? "unowned"} in A, ${change.b ?? "unowned"} in B`,
    ),
    ...deltas.polityDiffs.map((line) => `- ${line}`),
    ...deltas.unitDiffs.map((line) => `- ${line}`),
    ...deltas.markerDiffs.map((line) => `- ${line}`),
  ];

  const text = [
    `Both versions run from the same starting point to ${a.gameDate === b.gameDate ? a.gameDate : `${a.gameDate} (A) / ${b.gameDate} (B)`}.`,
    `VERSION A — "${a.summary || "(no summary)"}"\n${eventBlock(params.eventsA)}`,
    `VERSION B — "${b.summary || "(no summary)"}"\n${eventBlock(params.eventsB)}`,
    `Measured differences in the resulting world:\n${
      deltaLines.length > 0 ? deltaLines.join("\n") : "- (the two worlds ended up identical)"
    }`,
  ].join("\n\n");

  return {
    system: [
      {
        cacheable: true,
        text: "You are a historian examining two accounts of the same span of time — the same starting world, the same orders, two ways it could have gone. Identify the point of divergence: where the two tellings stop agreeing, and what follows from it. Say plainly what one version contains that the other lacks, and what each world's inhabitants would notice as a result. Ground every claim in the supplied events and measured differences; invent nothing. Refer to the two accounts as A and B.",
      },
    ],
    messages: [{ role: "user", text }],
    tool: DIVERGENCE_TOOL,
    taskLabel: "compareBranches",
    ...(params.signal ? { signal: params.signal } : {}),
  };
};
