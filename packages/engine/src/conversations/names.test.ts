import { describe, expect, it } from "vitest";
import { FakeLlmClient, type LlmRequest } from "@pax/providers";
import { generateCouncilNames } from "./names.ts";
import { council, COUNCIL_NAMES } from "./council.ts";

const binding = { connectionId: "fake", model: "fake", contextWindow: 100000, maxOutput: 8000 };

const fakeReturning = (
  answer: (req: LlmRequest) => { structured?: unknown; structuredError?: string },
) => {
  const requests: LlmRequest[] = [];
  const llm = new FakeLlmClient((req) => {
    requests.push(req);
    return answer(req) as never;
  });
  return { llm, binding, requests };
};

describe("generateCouncilNames", () => {
  it("returns the cleaned pool: trimmed, deduped, empties dropped", async () => {
    const deps = fakeReturning(() => ({
      structured: { names: [" Cusi ", "Amaru", "Cusi", "", "Quispe", "Titu"] },
    }));
    const names = await generateCouncilNames(deps, {
      playerName: "Inca Empire",
      startDate: "1492-01-01",
    });
    expect(names).toEqual(["Cusi", "Amaru", "Quispe", "Titu"]);
    expect(deps.requests).toHaveLength(1);
    expect(deps.requests[0]!.messages[0]!.text).toContain("Inca Empire");
    expect(deps.requests[0]!.messages[0]!.text).toContain("1492");
  });

  it("a refused or failed call is null, never a throw", async () => {
    const deps = fakeReturning(() => ({ structuredError: "declined" }));
    await expect(
      generateCouncilNames(deps, { playerName: "X", startDate: "1900-01-01" }),
    ).resolves.toBeNull();
  });

  it("fewer than three usable names is null — the floor is better", async () => {
    const deps = fakeReturning(() => ({ structured: { names: ["One", "One", "  "] } }));
    await expect(
      generateCouncilNames(deps, { playerName: "X", startDate: "1900-01-01" }),
    ).resolves.toBeNull();
  });
});

describe("council with a generated pool", () => {
  it("draws all three ministers from the pool, deterministically", () => {
    const pool = ["Cusi", "Amaru", "Quispe", "Titu", "Huallpa"];
    const first = council("seed-1", "1492-01-01", pool);
    const second = council("seed-1", "1492-01-01", pool);
    expect(first.map((member) => member.name)).toEqual(second.map((member) => member.name));
    for (const member of first) expect(pool).toContain(member.name);
    expect(new Set(first.map((member) => member.name)).size).toBe(3);
  });

  it("a pool below three names keeps the static era floor", () => {
    const members = council("seed-1", "1492-01-01", ["Only", "Two"]);
    for (const member of members) expect(COUNCIL_NAMES.medieval).toContain(member.name);
  });

  it("a null pool is exactly the old behavior", () => {
    expect(council("seed-1", "1492-01-01", null)).toEqual(council("seed-1", "1492-01-01"));
  });
});
