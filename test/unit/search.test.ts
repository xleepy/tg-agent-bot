import { describe, it, expect } from "vitest";
import {
  resolveSearch,
  formatSearchForPrompt,
  providerSupportsNativeSearch,
} from "../../src/search/index.js";

describe("providerSupportsNativeSearch", () => {
  it("openai and openrouter have native search", () => {
    expect(providerSupportsNativeSearch("openai")).toBe(true);
    expect(providerSupportsNativeSearch("openrouter")).toBe(true);
  });
  it("opencode does not", () => {
    expect(providerSupportsNativeSearch("opencode")).toBe(false);
  });
});

describe("resolveSearch", () => {
  it("user on with native provider -> native", () => {
    expect(
      resolveSearch({ mode: "off", override: "on", provider: "openai", tavilyAvailable: false }),
    ).toEqual({ strategy: "native", reason: "user_on_native" });
  });

  it("user on with opencode + tavily -> tavily fallback", () => {
    expect(
      resolveSearch({ mode: "off", override: "on", provider: "opencode", tavilyAvailable: true }),
    ).toEqual({ strategy: "tavily", reason: "user_on_tavily_fallback" });
  });

  it("user on with opencode and no tavily -> none", () => {
    expect(
      resolveSearch({ mode: "off", override: "on", provider: "opencode", tavilyAvailable: false }),
    ).toEqual({ strategy: "none", reason: "default_auto_no_search" });
  });

  it("user off always wins", () => {
    expect(
      resolveSearch({ mode: "on", override: "off", provider: "openai", tavilyAvailable: true }),
    ).toEqual({ strategy: "none", reason: "user_off" });
  });

  it("default on with native -> native", () => {
    expect(
      resolveSearch({ mode: "on", provider: "openai", tavilyAvailable: false }),
    ).toEqual({ strategy: "native", reason: "default_on_native" });
  });

  it("default auto with native -> native (not tavily)", () => {
    expect(
      resolveSearch({ mode: "auto", provider: "openai", tavilyAvailable: true }),
    ).toEqual({ strategy: "native", reason: "default_auto_native" });
  });

  it("default off -> none", () => {
    expect(
      resolveSearch({ mode: "off", provider: "openai", tavilyAvailable: true }),
    ).toEqual({ strategy: "none", reason: "user_off" });
  });

  it("default auto with opencode + tavily -> tavily fallback", () => {
    expect(
      resolveSearch({ mode: "auto", provider: "opencode", tavilyAvailable: true }),
    ).toEqual({ strategy: "tavily", reason: "default_auto_tavily_fallback" });
  });
});

describe("formatSearchForPrompt", () => {
  it("includes query and numbered results", () => {
    const out = formatSearchForPrompt({
      query: "x",
      provider: "tavily",
      results: [{ title: "T", url: "https://u", snippet: "S" }],
    });
    expect(out).toContain('"x"');
    expect(out).toContain("[1] T");
    expect(out).toContain("https://u");
  });
});
