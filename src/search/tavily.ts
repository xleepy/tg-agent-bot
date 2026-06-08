import type { Logger } from "pino";

export interface SearchResult {
  query: string;
  results: Array<{ title: string; url: string; snippet: string }>;
  provider: "tavily";
}

export interface SearchClient {
  search(query: string, signal?: AbortSignal): Promise<SearchResult>;
}

export class TavilyClient implements SearchClient {
  private readonly apiKey: string;
  private readonly endpoint = "https://api.tavily.com/search";
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey: string; logger: Logger; fetchImpl?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.logger = opts.logger;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: 5 }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { results?: Array<{ title: string; url: string; content?: string }> };
    const results = (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content ?? "",
    }));
    this.logger.debug({ query, count: results.length }, "tavily search complete");
    return { query, results, provider: "tavily" as const };
  }
}
