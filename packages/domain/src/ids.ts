import { ulid } from "ulid";

/** ULIDs everywhere: lexically time-sortable, so sibling order is free. */
export const newId = (): string => ulid();

export type GameId = string;
export type NodeId = string;
export type EventId = string;
export type FactId = string;
export type ConversationId = string;
export type MessageId = string;
export type ActionId = string;
export type PolityCode = string;
export type RegionId = string;
