import { beforeEach, describe, expect, it } from "vitest";
import { useOrdersStore } from "./orders.ts";

beforeEach(() => {
  useOrdersStore.setState({ draft: "" });
});

describe("the orders draft", () => {
  it("appendToDraft fills an empty draft verbatim", () => {
    useOrdersStore.getState().appendToDraft("March at dawn.");
    expect(useOrdersStore.getState().draft).toBe("March at dawn.");
  });

  it("appendToDraft separates from existing text with a blank line", () => {
    useOrdersStore.setState({ draft: "Hold the northern road." });
    useOrdersStore.getState().appendToDraft("Open talks with Castile.");
    expect(useOrdersStore.getState().draft).toBe(
      "Hold the northern road.\n\nOpen talks with Castile.",
    );
  });

  it("appendToDraft trims trailing whitespace before joining, never the content", () => {
    useOrdersStore.setState({ draft: "First order.\n\n" });
    useOrdersStore.getState().appendToDraft("Second order.");
    expect(useOrdersStore.getState().draft).toBe("First order.\n\nSecond order.");
  });

  it("two adoptions stack in arrival order", () => {
    useOrdersStore.getState().appendToDraft("From the Marshal.");
    useOrdersStore.getState().appendToDraft("From the Chancellor.");
    expect(useOrdersStore.getState().draft).toBe("From the Marshal.\n\nFrom the Chancellor.");
  });
});
