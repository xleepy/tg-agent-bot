import { describe, it, expect } from "vitest";
import { chunkMessage } from "../../src/utils/index.js";

describe("chunkMessage", () => {
  it("returns single chunk when under max", () => {
    expect(chunkMessage("hello", 4096)).toEqual(["hello"]);
  });

  it("splits long messages preserving content", () => {
    const long = "a".repeat(10_000);
    const chunks = chunkMessage(long, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(long);
  });

  it("prefers newline boundaries", () => {
    const text = "line1\n".repeat(500) + "tail";
    const chunks = chunkMessage(text, 1000);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1000);
    }
  });

  it("preserves exact content (including newlines, spaces, tabs) for arbitrary text", () => {
    const paragraphs = [
      "Paragraph one with some words and a trailing newline\n",
      "  indented second paragraph with spaces and a tab\there\n",
      "third paragraph that has code: function foo() { return 1; }\n",
      "a".repeat(4500),
      "and finally the wrap-up line.\n",
    ];
    const text = paragraphs.join("");
    const chunks = chunkMessage(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1000);
    }
  });

  it("does not lose the delimiter at a newline boundary", () => {
    const text = "a".repeat(50) + "\n" + "b".repeat(50) + "\n" + "c".repeat(50);
    const chunks = chunkMessage(text, 60);
    expect(chunks.join("")).toBe(text);
  });
});
