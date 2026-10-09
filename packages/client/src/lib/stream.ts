import { SseEventSchema, type SseEvent } from "@pax/domain";

export interface StreamHandle {
  close: () => void;
}

/**
 * One EventSource per game session: every server push is zod-validated and
 * handed to the dispatcher, which is the ONLY write path into the stores
 * besides initial REST loads. Reconnection is native EventSource behavior;
 * the server replays from Last-Event-ID.
 */
export const openGameStream = (
  gameId: string,
  onEvent: (event: SseEvent) => void,
  onStatus?: (status: "live" | "reconnecting") => void,
): StreamHandle => {
  const source = new EventSource(`/api/games/${gameId}/stream`);

  const handler = (raw: MessageEvent<string>) => {
    const parsed = SseEventSchema.safeParse(JSON.parse(raw.data));
    if (parsed.success) {
      onEvent(parsed.data);
    } else {
      console.warn("Dropped malformed SSE event", parsed.error, raw.data);
    }
  };

  // Named events (event: <type>) require per-type listeners on EventSource.
  for (const type of SseEventSchema.options.map((option) => option.shape.type.value)) {
    source.addEventListener(type, handler as EventListener);
  }

  source.onopen = () => onStatus?.("live");
  source.onerror = () => onStatus?.("reconnecting");

  return { close: () => source.close() };
};
