/**
 * Salvage parse for providers without reliable constrained decoding: strict
 * JSON.parse first, then fenced blocks, then a string-aware balanced-brace
 * scan (the reference game's field-tested ladder).
 */
export const extractJson = (text: string): unknown | undefined => {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(cleaned);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const start = cleaned.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      inString = !inString;
    } else if (!inString) {
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1));
          } catch {
            return undefined;
          }
        }
      }
    }
  }
  return undefined;
};
