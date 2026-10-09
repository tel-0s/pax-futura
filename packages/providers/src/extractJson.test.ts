import { describe, expect, it } from "vitest";
import { extractJson } from "./extractJson.ts";

describe("extractJson", () => {
  it("parses strict JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips think blocks and fences", () => {
    expect(extractJson('<think>hmm</think>```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("scans balanced braces out of prose, respecting strings", () => {
    expect(extractJson('Here you go: {"title": "a {nested} brace", "n": 2} hope that helps!')).toEqual({
      title: "a {nested} brace",
      n: 2,
    });
  });

  it("returns undefined for hopeless text", () => {
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson('{"unterminated": ')).toBeUndefined();
  });
});
