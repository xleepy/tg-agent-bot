import type { Logger } from "pino";
import type { ValidatedConfig } from "../config/index.js";
import { OpenAIAdapter } from "./openai.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { OpenCodeAdapter } from "./opencode.js";
import type { ProviderAdapter } from "./types.js";

export class ProviderConfig {
  constructor(
    public readonly provider: ProviderAdapter,
    public readonly providerName: string,
    public readonly model: string,
  ) {}
}

export interface BuildProvidersOptions {
  config: ValidatedConfig;
  logger: Logger;
}

export function buildProviders(opts: BuildProvidersOptions): ProviderConfig {
  const { config, logger } = opts;
  switch (config.defaultProvider) {
    case "openai": {
      if (!config.openaiApiKey) {
        throw new Error("OpenAI provider requires OPENAI_API_KEY");
      }
      const adapter = new OpenAIAdapter({ apiKey: config.openaiApiKey, model: config.openaiModel, logger });
      return new ProviderConfig(adapter, adapter.name, adapter.getDefaultModel());
    }
    case "openrouter": {
      if (!config.openrouterApiKey) {
        throw new Error("OpenRouter provider requires OPENROUTER_API_KEY");
      }
      const adapter = new OpenRouterAdapter({
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel,
        logger,
      });
      return new ProviderConfig(adapter, adapter.name, adapter.getDefaultModel());
    }
    case "opencode": {
      if (!config.opencodeApiKey) {
        throw new Error("OpenCode provider requires OPENCODE_API_KEY");
      }
      const adapter = new OpenCodeAdapter({
        baseUrl: config.opencodeBaseUrl,
        apiKey: config.opencodeApiKey,
        model: config.opencodeModel,
        logger,
      });
      return new ProviderConfig(adapter, adapter.name, adapter.getDefaultModel());
    }
  }
}
