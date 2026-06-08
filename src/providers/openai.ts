import { OpenAI } from "openai";
import type { Logger } from "pino";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderChatTool,
} from "./types.js";

export interface OpenAIAdapterOptions {
  apiKey: string;
  model: string;
  logger: Logger;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 5;

type InputItem =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | { type: "function_call_output"; call_id: string; output: string };

function messagesToInput(
  messages: ProviderChatRequest["messages"],
  extra: InputItem[] = [],
): InputItem[] {
  const out: InputItem[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    }
  }
  out.push(...extra);
  return out;
}

function toolsToResponsesFormat(tools: ProviderChatTool[]): OpenAI.Responses.Tool[] {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    parameters: t.parameters,
    strict: false,
  }));
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(opts: OpenAIAdapterOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.logger = opts.logger;
  }

  getDefaultModel(): string {
    return this.model;
  }

  async chat(req: ProviderChatRequest): Promise<ProviderChatResult> {
    const model = req.model ?? this.model;
    const maxIter = req.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const tools: OpenAI.Responses.Tool[] = [];
    if (req.searchEnabled) tools.push({ type: "web_search_preview" });
    if (req.tools && req.tools.length > 0) tools.push(...toolsToResponsesFormat(req.tools));

    const citations: string[] = [];
    let input: InputItem[] = messagesToInput(req.messages);
    let finalText = "";
    let iterations = 0;

    for (;;) {
      const response = await this.client.responses.create(
        {
          model,
          input,
          ...(tools.length > 0 ? { tools } : {}),
        },
        { signal: req.signal },
      );

      let functionCall: { call_id: string; name: string; arguments: string } | undefined;
      for (const item of response.output ?? []) {
        if (item.type === "message") {
          for (const c of item.content) {
            if (c.type === "output_text") {
              finalText += c.text;
              if (c.annotations) {
                for (const a of c.annotations) {
                  if (a.type === "url_citation" && "url" in a) {
                    citations.push(a.url);
                  }
                }
              }
            }
          }
        } else if (item.type === "function_call") {
          functionCall = {
            call_id: item.call_id,
            name: item.name,
            arguments: item.arguments,
          };
        }
      }

      if (!functionCall || !req.onToolCall) break;
      iterations += 1;
      if (iterations > maxIter) {
        this.logger.warn(
          { maxIter, tool: functionCall.name },
          "openai: max tool iterations reached; returning partial response",
        );
        break;
      }
      if (req.signal?.aborted) {
        throw new Error("aborted");
      }

      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(functionCall.arguments) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch (err) {
        this.logger.warn(
          { err, tool: functionCall.name, raw: functionCall.arguments },
          "openai: tool arguments not valid JSON; using empty object",
        );
      }

      let output: string;
      try {
        output = await req.onToolCall(functionCall.name, args);
      } catch (err) {
        output = `Tool call failed: ${(err as Error).message}`;
        this.logger.warn({ err, tool: functionCall.name }, "openai: tool call failed");
      }

      input = messagesToInput(req.messages, [
        { type: "function_call", call_id: functionCall.call_id, name: functionCall.name, arguments: functionCall.arguments },
        { type: "function_call_output", call_id: functionCall.call_id, output },
      ]);
    }

    this.logger.debug(
      { model, citations: citations.length, toolIterations: iterations },
      "openai chat complete",
    );
    return {
      text: finalText,
      model,
      provider: this.name,
      ...(citations.length ? { citations } : {}),
    };
  }
}
