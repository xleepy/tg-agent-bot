export interface ProviderChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ProviderChatTool {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface ProviderChatRequest {
  messages: ProviderChatMessage[];
  model?: string;
  searchEnabled: boolean;
  signal?: AbortSignal;
  tools?: ProviderChatTool[];
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<string>;
  maxToolIterations?: number;
}

export interface ProviderChatResult {
  text: string;
  model: string;
  provider: string;
  citations?: string[];
}

export interface ProviderAdapter {
  readonly name: string;
  chat(req: ProviderChatRequest): Promise<ProviderChatResult>;
  getDefaultModel(): string;
}
