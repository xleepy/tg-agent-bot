import { OpenAI } from "openai";
import type { Logger } from "pino";
import type { ProviderAdapter, ProviderChatRequest, ProviderChatResult } from "./types.js";
import {
  runChatCompletionsWithTools,
  toChatMessages,
} from "./chat-completions-loop.js";
import type { RunChatCompletionsOnceResult } from "./chat-completions-loop.js";

export interface OpenCodeAdapterOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  logger: Logger;
}

export class OpenCodeAdapter implements ProviderAdapter {
  readonly name = "opencode";
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(opts: OpenCodeAdapterOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl });
    this.model = opts.model;
    this.logger = opts.logger;
  }

  getDefaultModel(): string {
    return this.model;
  }

  async chat(req: ProviderChatRequest): Promise<ProviderChatResult> {
    const model = req.model ?? this.model;
    return runChatCompletionsWithTools({
      client: this.client,
      model,
      providerName: this.name,
      logger: this.logger,
      request: req,
      messages: toChatMessages(req.messages),
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
