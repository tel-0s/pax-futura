import type { SseEvent } from "@pax/domain";

export interface HubEvent {
  id: number;
  event: SseEvent;
}

type Subscriber = (event: HubEvent) => void;

const REPLAY_BUFFER = 256;

/**
 * One hub per open game: fan-out of engine events to every connected SSE
 * client, with a small replay ring so reconnects (Last-Event-ID) don't drop
 * events mid-turn.
 */
export class SseHub {
  private subscribers = new Set<Subscriber>();
  private buffer: HubEvent[] = [];
  private nextId = 1;

  emit(event: SseEvent): void {
    const entry: HubEvent = { id: this.nextId++, event };
    this.buffer.push(entry);
    if (this.buffer.length > REPLAY_BUFFER) this.buffer.shift();
    for (const subscriber of this.subscribers) subscriber(entry);
  }

  subscribe(subscriber: Subscriber, lastEventId?: number): () => void {
    if (lastEventId !== undefined) {
      for (const entry of this.buffer) {
        if (entry.id > lastEventId) subscriber(entry);
      }
    }
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}
