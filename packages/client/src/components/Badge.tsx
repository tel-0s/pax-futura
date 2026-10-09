import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export function Badge({
  tone = "default",
  children,
  title,
}: {
  tone?: "default" | "accent" | "warning" | "danger" | "success" | "info";
  children: ReactNode;
  title?: string;
}) {
  const toneClass = tone === "default" ? "" : styles[tone];
  return (
    <span className={[styles.badge, toneClass].filter(Boolean).join(" ")} title={title}>
      {children}
    </span>
  );
}
