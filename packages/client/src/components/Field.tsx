import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./Field.module.css";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Field({ label, ...rest }: FieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input className={styles.input} {...rest} />
    </label>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextAreaField({ label, ...rest }: TextAreaFieldProps) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <textarea className={styles.input} {...rest} />
    </label>
  );
}
