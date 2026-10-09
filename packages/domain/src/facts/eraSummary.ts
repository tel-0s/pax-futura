import { z } from "zod";

/** How many turns (depth steps) one era spans. */
export const ERA_SPAN = 10;

/** The model's output shape: a faithful narrative plus an open-threads ledger. */
export const EraSummaryDraftSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1),
  /**
   * Every arc, commitment, project, or initiative active during the span that
   * remains unresolved — the ledger that keeps long-running threads alive.
   */
  openThreads: z.array(z.string()).max(12).default([]),
});
export type EraSummaryDraft = z.infer<typeof EraSummaryDraftSchema>;

/** A stored era summary, keyed by its span's start/end loom nodes. */
export const EraSummarySchema = EraSummaryDraftSchema.extend({
  /** True when this is a deterministic fallback (model failed) — retried on the next extraction. */
  degraded: z.boolean().default(false),
  startNodeId: z.string().min(1),
  endNodeId: z.string().min(1),
  startDepth: z.number().int().min(1),
  endDepth: z.number().int().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});
export type EraSummary = z.infer<typeof EraSummarySchema>;
