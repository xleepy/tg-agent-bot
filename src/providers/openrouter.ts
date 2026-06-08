import { OpenAI } from "openai";
import type { Logger } from "pino";
import type { ProviderAdapter, ProviderChatRequest, ProviderChatResult } from "./types.js";
import {
  runChatCompletionsWithTools,
  toChatMessages,
  type RunChatCompletionsOnceResult,
} from "./chat-completions-loop.js";

export interface OpenRouterAdapterOptions {
  apiKey: string;
  model: string | undefined;
  logger: Logger;
}

export class OpenRouterAdapter implements ProviderAdapter {
  readonly name = "openrouter";
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(opts: OpenRouterAdapterOptions) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
    this.model = opts.model ?? "openai/gpt-4o-mini";
    this.logger = opts.logger;
  }

  getDefaultModel(): string {
    return this.model;
  }

  async chat(req: ProviderChatRequest): Promise<ProviderChatResult> {
    const model = req.model ?? this.model;
    const extraTools = req.searchEnabled
      ? [{ type: "openrouter:web_search", parameters: { max_results: 5 } }]
      : undefined;
    return runChatCompletionsWithTools({
      client: this.client,
      model,
      providerName: this.name,
      logger: this.logger,
      request: req,
      messages: toChatMessages(req.messages),
      ...(extraTools ? { extraTools } : {}),
      runOnce: async (opts) => {
        const body: Record<string, unknown> = {
          model: opts.model,
          messages: opts.messages,
        };
        if (opts.tools.length > 0) body.tools = opts.tools;
        const response = await opts.client.chat.completions.create(
          body as unknown as Parameters<typeof opts.client.chat.completions.create>[0],
          opts.signal ? { signal: opts.signal } : {},
        );
        return response as unknown as RunChatCompletionsOnceResult;
      },
    });
  }
}
