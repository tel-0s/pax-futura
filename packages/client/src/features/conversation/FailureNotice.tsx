import { useEffect, type RefObject } from "react";
import { CircleAlert, RotateCcw, X } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { useChatFailures, type ChatFailure } from "./chatFailures.ts";
import styles from "./Letters.module.css";

const COPY: Record<ChatFailure["action"], { title: string; hint: string }> = {
  send: { title: "No reply came back", hint: "Your message is back in the composer." },
  edit: { title: "The revision wasn't sent", hint: "Your revision is back in the editor." },
  regenerate: { title: "The redraft never arrived", hint: "The previous reply still stands." },
};

/** A reply that failed, marked in place at the foot of the thread. */
export function FailureNotice({
  conversationId,
  scroller,
}: {
  conversationId: string;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const failure = useChatFailures((state) => state.failures[conversationId]);

  useEffect(() => {
    if (failure) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [failure, scroller]);

  if (!failure) return null;
  const copy = COPY[failure.action];
  const dismiss = () => useChatFailures.getState().dismiss(conversationId);

  return (
    <div className={styles.failure} role="status">
      <CircleAlert size={15} className={styles.failureIcon} />
      <div className={styles.failureText}>
        <span className={styles.failureTitle}>{copy.title}</span>
        <span className={styles.failureDetail}>{failure.detail}</span>
        <span className={styles.failureHint}>{copy.hint}</span>
      </div>
      <div className={styles.failureActions}>
        {failure.retry ? (
          <Button size="sm" variant="ghost" onClick={failure.retry}>
            <RotateCcw size={13} /> Retry
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
          <X size={13} />
        </Button>
      </div>
    </div>
  );
}
