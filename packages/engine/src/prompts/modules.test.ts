import { describe, expect, it } from "vitest";
import { DIFFICULTIES } from "@pax/domain";
import { CORE_MODULES, DIFFICULTY_DIRECTIVES, PROMPT_PACK_VERSION } from "./modules.ts";

describe("prompt modules", () => {
  it("has a directive for every rung of the difficulty ladder", () => {
    for (const level of DIFFICULTIES) {
      const directive = DIFFICULTY_DIRECTIVES[level.id];
      expect(directive, level.id).toBeTruthy();
      expect(directive!.trim().length, level.id).toBeGreaterThan(40);
      expect(directive!.toLowerCase()).toContain(level.id);
    }
  });

  it("keeps legacy save values resolving to a rung", () => {
    expect(DIFFICULTY_DIRECTIVES.easy).toBe(DIFFICULTY_DIRECTIVES.permissive);
    expect(DIFFICULTY_DIRECTIVES.hard).toBe(DIFFICULTY_DIRECTIVES.challenging);
  });

  it("gives every directive a distinct text", () => {
    const texts = DIFFICULTIES.map((level) => DIFFICULTY_DIRECTIVES[level.id]!);
    expect(new Set(texts).size).toBe(DIFFICULTIES.length);
  });

  it("versions the core module pack", () => {
    expect(CORE_MODULES.length).toBeGreaterThan(0);
    expect(PROMPT_PACK_VERSION).toMatch(/^v\d+-\d+m$/);
  });
});
