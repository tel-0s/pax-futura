import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "ghost";
}

export function Button({ variant = "default", className, ...rest }: ButtonProps) {
  const variantClass = variant === "default" ? "" : styles[variant];
  return (
    <button
      className={[styles.button, variantClass, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
