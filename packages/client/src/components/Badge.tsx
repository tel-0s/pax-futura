import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export function Badge({
  tone = "default",
  children,
}: {
  tone?: "default" | "accent" | "warning" | "danger";
  children: ReactNode;
}) {
  const toneClass = tone === "default" ? "" : styles[tone];
  return <span className={[styles.badge, toneClass].filter(Boolean).join(" ")}>{children}</span>;
}
