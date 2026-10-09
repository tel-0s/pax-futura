import {
  ERA_SPAN,
  EraSummaryDraftSchema,
  emptyRollup,
  toLlmToolSchema,
  type EraSummary,
  type EraSummaryDraft,
} from "@pax/domain";
import type { LlmRequest } from "@pax/providers";
import type { ExtractionDeps } from "./extract.ts";
import type { NodeRow } from "../ports.ts";
import { factDigestLine, renderRollup } from "./digest.ts";

export const ERA_SUMMARY_TOOL = toLlmToolSchema(
  "submit_era_summary",
  "A faithful narrative summary of one era plus an explicit ledger of every arc, commitment, project, or initiative still unresolved at the era's end.",
  EraSummaryDraftSchema,
);

/**
 * Summarize every complete era on the loom path to `nodeId` that lacks a stored
 * summary, oldest first. An era is ERA_SPAN turns wide and ends at each depth
 * that is a positive multiple of ERA_SPAN. Summaries are keyed by their span's
 * start/end node ids, so branches sharing a prefix share summaries for free.
 * Backfill is automatic: a save predating this feature gets all eras on first
 * run. Degraded rows (deterministic fallbacks written while the model was
 * unavailable) are retried until a real summary replaces them. Never throws —
 * era failures must not poison extraction. Returns how many summaries were
 * (re)written so the caller can signal listeners.
 */
export const maybeSummarizeEras = async (deps: ExtractionDeps, nodeId: string): Promise<number> => {
  const { store } = deps;
  const node = store.getNode(nodeId);
  if (!node) return 0;
  const path = store.pathToRoot(nodeId);
  let written = 0;

  for (let end = ERA_SPAN; end <= node.depth; end += ERA_SPAN) {
    const start = end - ERA_SPAN + 1;
    const startNode = path[start];
    const endNode = path[end];
    if (!startNode || !endNode) continue;
    const existing = store.getEraSummary(startNode.id, endNode.id);
    if (existing && !existing.degraded) continue;

    // Previous era (chain context) is already stored — we go oldest-first.
    const prev =
      end > ERA_SPAN ? store.getEraSummary(path[start - ERA_SPAN]!.id, path[start - 1]!.id) : null;
    const summary = await summarizeEra(deps, {
      span: path.slice(start, end + 1),
      startNode,
      endNode,
      previousTitle: prev?.title ?? null,
      previousThreads: prev?.openThreads ?? [],
    });
    // A degraded row only gets overwritten by a real summary — rewriting one
    // fallback with another would just churn created_at.
    if (existing && summary.degraded) continue;
    store.putEraSummary(summary);
    written += 1;
  }
  return written;
};

const summarizeEra = async (
  deps: ExtractionDeps,
  params: {
    span: NodeRow[];
    startNode: NodeRow;
    endNode: NodeRow;
    previousTitle: string | null;
    previousThreads: string[];
  },
): Promise<EraSummary> => {
  const { store, llm, binding } = deps;
  const { span, startNode, endNode } = params;

  const digestLines = span
    .map((node) => {
      const facts = store.listFactsForNode(node.id);
      if (facts.length === 0) return "";
      return `- T${node.depth} (${node.gameDate}): ${facts.map(factDigestLine).join("; ")}`;
    })
    .filter(Boolean);

  const rollup = store.getRollup(endNode.id) ?? emptyRollup();

  const meta = {
    startNodeId: startNode.id,
    endNodeId: endNode.id,
    startDepth: startNode.depth,
    endDepth: endNode.depth,
    startDate: startNode.gameDate,
    endDate: endNode.gameDate,
  };

  try {
    const request = buildEraRequest(deps, { ...params, digestLines, rollup });
    const result = await llm.stream(request, binding).final();
    const draft = EraSummaryDraftSchema.safeParse(result.structured);
    if (!draft.success) throw new Error(result.structuredError ?? "invalid era summary");
    return { ...draft.data, degraded: false, ...meta };
  } catch (error) {
    console.warn(`Era summary generation failed (${startNode.gameDate}–${endNode.gameDate}):`, error);
    return { ...fallbackDraft(digestLines, rollup, meta), degraded: true, ...meta };
  }
};

const buildEraRequest = (
  deps: ExtractionDeps,
  params: {
    startNode: NodeRow;
    endNode: NodeRow;
    previousTitle: string | null;
    previousThreads: string[];
    digestLines: string[];
    rollup: ReturnType<typeof emptyRollup>;
  },
): LlmRequest => {
  const { startNode, endNode, previousTitle, previousThreads, digestLines, rollup } = params;

  const catalog = catalogLine(deps, endNode);
  const sections = [
    previousTitle
      ? `Previous era "${previousTitle}". Unresolved threads carried in:\n${
          previousThreads.length > 0 ? previousThreads.map((t) => `- ${t}`).join("\n") : "- (none recorded)"
        }`
      : "(first era — no prior chronicle)",
    // GM-edit nodes advance depth without advancing time, so a span can
    // collapse to a single date — label it honestly rather than as a range.
    startNode.gameDate === endNode.gameDate
      ? `Era span: ${endNode.gameDate} (turns ${startNode.depth}–${endNode.depth}, no elapsed time — interventions only).`
      : `Era span: ${startNode.gameDate} → ${endNode.gameDate} (turns ${startNode.depth}–${endNode.depth}).`,
    `Turn-by-turn facts:\n${digestLines.length > 0 ? digestLines.join("\n") : "- (no recorded facts this era)"}`,
    `Standing facts at era's end (resolve or carry each open arc/commitment as a thread):\n${renderRollup(rollup).join("\n")}`,
    catalog,
  ].filter(Boolean);

  return {
    system: [
      {
        cacheable: true,
        text: `You are the campaign's archivist. Write a faithful, self-contained summary of the era just past for a grand-strategy chronicle: what changed, who rose or fell, which conflicts and alignments defined it. Then compile an explicit open-threads ledger: every arc, commitment, project, or initiative that was active during the span and remains unresolved at its end MUST appear as one entry in openThreads. Long games forget ongoing projects; this ledger is what keeps them alive across the decades — omit nothing still in motion. Use canonical polity codes. Ground every claim in the provided facts.`,
      },
    ],
    messages: [{ role: "user", text: sections.join("\n\n") }],
    tool: ERA_SUMMARY_TOOL,
    taskLabel: "summarizeEra",
  };
};

/** Polity code=name catalog, skipped when the end world is unavailable. */
const catalogLine = (deps: ExtractionDeps, endNode: NodeRow): string => {
  if (!endNode.worldBlobHash) return "";
  try {
    const world = deps.store.getWorld(endNode.worldBlobHash);
    const entries = Object.values(world.polities);
    if (entries.length === 0) return "";
    return `Polity catalog: ${entries.map((p) => `${p.code}=${p.name || p.code}`).join(", ")}`;
  } catch {
    return "";
  }
};

/** Deterministic summary when the model is unavailable or returns garbage. */
const fallbackDraft = (
  digestLines: string[],
  rollup: ReturnType<typeof emptyRollup>,
  meta: { startDepth: number; endDepth: number },
): EraSummaryDraft => ({
  title: `Turns ${meta.startDepth}–${meta.endDepth}`,
  summary:
    digestLines.length > 0
      ? digestLines.slice(0, 8).map((line) => line.replace(/^- /, "")).join("; ")
      : "No recorded developments this era.",
  openThreads: [
    ...rollup.openArcs.map((arc) => arc.title),
    ...rollup.openCommitments.map((c) => `${c.from}->${c.to}: ${c.what}`),
  ].slice(0, 12),
});
