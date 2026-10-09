import { useEffect, useState } from "react";
import type { NodeFingerprint } from "@pax/domain";
import { api } from "../../lib/api.ts";

/**
 * Per-node ownership fingerprints for loom mini-bars/dots: fetched lazily on
 * first use and cached for the tab's lifetime. Trees are <200 nodes, so a
 * plain module-scoped Map beats plumbing this through a Zustand store —
 * every mount of the overlay (or the strip) reuses whatever's already been
 * fetched instead of re-requesting it. `null` marks a fetch that failed or
 * was never attempted; callers just render nothing for it (no retry loop).
 */
const cache = new Map<string, NodeFingerprint | null>();
const inFlight = new Map<string, Promise<NodeFingerprint | null>>();

const fetchFingerprint = (gameId: string, nodeId: string): Promise<NodeFingerprint | null> => {
  const existing = inFlight.get(nodeId);
  if (existing) return existing;
  const promise = api
    .getFingerprint(gameId, nodeId)
    .catch(() => null)
    .then((result) => {
      cache.set(nodeId, result);
      inFlight.delete(nodeId);
      return result;
    });
  inFlight.set(nodeId, promise);
  return promise;
};

/**
 * The fingerprint for one node, fetched once (`enabled` gates the fetch —
 * pass `false` for generating/failed nodes, which have none) and reused
 * across every card/dot that asks for the same nodeId.
 */
export function useNodeFingerprint(
  gameId: string | null | undefined,
  nodeId: string,
  enabled: boolean,
): NodeFingerprint | null {
  const [fingerprint, setFingerprint] = useState<NodeFingerprint | null>(() => cache.get(nodeId) ?? null);

  useEffect(() => {
    if (!enabled || !gameId) return;
    const known = cache.get(nodeId);
    if (known !== undefined) {
      setFingerprint(known);
      return;
    }
    let cancelled = false;
    void fetchFingerprint(gameId, nodeId).then((result) => {
      if (!cancelled) setFingerprint(result);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, nodeId, enabled]);

  return fingerprint;
}

/** The palette color of whichever polity holds the most weight, if any. */
export const dominantOwnerColor = (
  fingerprint: NodeFingerprint | null,
  palette: Record<string, string>,
): string | null => {
  if (!fingerprint) return null;
  let bestCode: string | null = null;
  let bestWeight = -Infinity;
  for (const [code, weight] of Object.entries(fingerprint.weights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestCode = code;
    }
  }
  return bestCode ? (palette[bestCode] ?? null) : null;
};
