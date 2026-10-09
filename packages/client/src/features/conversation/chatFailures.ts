import { create } from "zustand";

/**
 * A reply that never came back, kept per conversation so the thread can say
 * so in place (instead of a blocking alert, or — for regeneration — nothing
 * at all). Cleared by the next attempt or by dismissing it.
 */
export interface ChatFailure {
  action: "send" | "regenerate" | "edit";
  detail: string;
  /** Re-run the failed request, when it can be repeated from here. */
  retry?: () => void;
}

interface ChatFailuresState {
  failures: Record<string, ChatFailure>;
  report: (conversationId: string, failure: ChatFailure) => void;
  dismiss: (conversationId: string) => void;
}

export const useChatFailures = create<ChatFailuresState>((set) => ({
  failures: {},
  report: (conversationId, failure) =>
    set((state) => ({ failures: { ...state.failures, [conversationId]: failure } })),
  dismiss: (conversationId) =>
    set((state) => {
      if (!(conversationId in state.failures)) return state;
      const failures = { ...state.failures };
      delete failures[conversationId];
      return { failures };
    }),
}));

export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
