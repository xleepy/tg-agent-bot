import type { SearchClient, SearchResult } from "./tavily.js";

export type SearchMode = "auto" | "on" | "off";

export type SearchStrategy = "native" | "tavily" | "none";

export interface SearchDecision {
  strategy: SearchStrategy;
  reason:
    | "user_on_native"
    | "user_on_tavily_fallback"
    | "user_on_tavily_only"
    | "user_off"
    | "default_on_native"
    | "default_on_tavily_fallback"
    | "default_auto_native"
    | "default_auto_tavily_fallback"
    | "default_auto_no_search";
}

export type ProviderName = "openai" | "openrouter" | "opencode";

export function providerSupportsNativeSearch(provider: ProviderName): boolean {
  return provider === "openai" || provider === "openrouter";
}

export interface ResolveSearchOptions {
  mode: SearchMode;
  override?: "on" | "off";
  provider: ProviderName;
  tavilyAvailable: boolean;
}

export function resolveSearch(opts: ResolveSearchOptions): SearchDecision {
  const native = providerSupportsNativeSearch(opts.provider);

  if (opts.override === "off" || (!opts.override && opts.mode === "off")) {
    return { strategy: "none", reason: "user_off" };
  }

  if (native) {
    const reason: SearchDecision["reason"] =
      opts.override === "on"
        ? "user_on_native"
        : opts.mode === "auto"
          ? "default_auto_native"
          : "default_on_native";
    return { strategy: "native", reason };
  }
  if (opts.tavilyAvailable) {
    const reason: SearchDecision["reason"] =
      opts.override === "on"
        ? "user_on_tavily_fallback"
        : opts.mode === "auto"
          ? "default_auto_tavily_fallback"
          : "default_on_tavily_fallback";
    return { strategy: "tavily", reason };
  }
  return { strategy: "none", reason: "default_auto_no_search" };
}

export function formatSearchForPrompt(result: SearchResult): string {
  const lines = result.results.map(
    (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`,
  );
  return `Web search results for "${result.query}":\n${lines.join("\n\n")}`;
}

export interface SearchInjector {
  maybeAugment(opts: {
    prompt: string;
    signal?: AbortSignal;
  }): Promise<{ prompt: string; searchUsed: boolean }>;
}

export function createSearchInjector(client: SearchClient | undefined): SearchInjector {
  return {
    async maybeAugment({ prompt, signal }) {
      if (!client) {
        return { prompt, searchUsed: false };
      }
      const result = await client.search(prompt, signal);
      const prefix = formatSearchForPrompt(result);
      return { prompt: `${prefix}\n\nUser: ${prompt}`, searchUsed: true };
    },
  };
}
