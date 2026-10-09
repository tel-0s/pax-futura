import { WorldStateSchema, type WorldState } from "@pax/domain";
import type { SavePort } from "@pax/engine";
import type { Db } from "./db/openDb.ts";
import { getGame, setActiveNode } from "./db/saveDb.ts";
import { collectGarbageBlobs, getJsonBlob, putJsonBlob } from "./db/blobStore.ts";
import * as nodes from "./db/stores/nodes.ts";
import * as events from "./db/stores/events.ts";
import * as actions from "./db/stores/actions.ts";
import * as conversations from "./db/stores/conversations.ts";
import * as facts from "./db/stores/facts.ts";
import * as statSheets from "./db/stores/statSheets.ts";
import * as eraSummaries from "./db/stores/eraSummaries.ts";
import * as gazettes from "./db/stores/gazettes.ts";

/** The engine's persistence port, implemented over one save DB. */
export const makeSavePort = (db: Db): SavePort => ({
  transaction: (fn) => db.transaction(fn)(),

  getGame: () => getGame(db),
  setActiveNode: (nodeId) => setActiveNode(db, nodeId),

  getNode: (id) => nodes.getNode(db, id),
  getNodeMeta: (id) => nodes.getNodeMeta(db, id),
  listNodeMetas: () => nodes.listNodeMetas(db),
  insertNode: (params) => nodes.insertNode(db, params),
  completeNode: (params) => nodes.completeNode(db, params),
  failNode: (id, error) => nodes.failNode(db, id, error),
  setPreferredChild: (parentId, childId) => nodes.setPreferredChild(db, parentId, childId),
  pathToRoot: (nodeId) => nodes.pathToRoot(db, nodeId),
  subtreeIds: (nodeId) => nodes.subtreeIds(db, nodeId),
  deleteSubtree: (nodeId) => nodes.deleteSubtree(db, nodeId),

  putWorld: (world) => putJsonBlob(db, WorldStateSchema.parse(world)),
  getWorld: (hash) => WorldStateSchema.parse(getJsonBlob<WorldState>(db, hash)),
  collectGarbageBlobs: () => collectGarbageBlobs(db),

  insertEvents: (nodeId, drafts) => events.insertEvents(db, nodeId, drafts),
  listEventsForNode: (nodeId) => events.listEventsForNode(db, nodeId),
  listEventsForNodes: (nodeIds) => events.listEventsForNodes(db, nodeIds),

  listPendingActions: (nodeId) => actions.listPendingActions(db, nodeId),
  clearPendingActions: (nodeId) => actions.clearPendingActions(db, nodeId),

  copyConversationHeads: (fromNodeId, toNodeId) =>
    conversations.copyHeads(db, fromNodeId, toNodeId),

  createConversation: (params) =>
    conversations.createConversation(db, {
      kind: params.kind,
      title: params.title,
      participants: params.participants,
      originNodeId: params.nodeId,
      nodeId: params.nodeId,
    }),
  getConversation: (id) => conversations.getConversation(db, id),
  conversationsAtNode: (nodeId) => conversations.conversationsAtNode(db, nodeId),
  insertMessage: (message) => conversations.insertMessage(db, message),
  listMessages: (conversationId) => conversations.listMessages(db, conversationId),
  messagePath: (headMessageId) => conversations.messagePath(db, headMessageId),
  setConversationHead: (nodeId, conversationId, headMessageId) =>
    conversations.setHead(db, nodeId, conversationId, headMessageId),

  insertFacts: (nodeId, factList, source, startSeq) =>
    facts.insertFacts(db, nodeId, factList, source, startSeq),
  listFactsForNode: (nodeId) => facts.listFactsForNode(db, nodeId),
  setRollup: (nodeId, rollup) => facts.setRollup(db, nodeId, rollup),
  getRollup: (nodeId) => facts.getRollup(db, nodeId),
  setExtractionStatus: (nodeId, status) => nodes.setExtractionStatus(db, nodeId, status),

  getStatSheet: (nodeId, polity) => statSheets.getStatSheet(db, nodeId, polity),
  setStatSheet: (sheet) => statSheets.setStatSheet(db, sheet),

  getGazette: (nodeId) => gazettes.getStoredGazette(db, nodeId),
  setGazette: (nodeId, gazette) => gazettes.putStoredGazette(db, nodeId, gazette),

  getEraSummary: (startNodeId, endNodeId) => eraSummaries.getEraSummary(db, startNodeId, endNodeId),
  putEraSummary: (summary) => eraSummaries.putEraSummary(db, summary),
});
