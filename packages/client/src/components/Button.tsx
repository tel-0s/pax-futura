import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  /** Square icon-only button (children = one icon). */
  icon?: boolean;
}

export function Button({
  variant = "default",
  size = "md",
  icon = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        styles.button,
        variant === "default" ? "" : styles[variant],
        size === "md" ? "" : styles[size],
        icon ? styles.icon : "",
        "pfChamfer",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
