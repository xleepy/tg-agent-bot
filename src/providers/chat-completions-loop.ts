import type { OpenAI } from "openai";
import type { Logger } from "pino";
import type {
  ProviderChatRequest,
  ProviderChatResult,
  ProviderChatTool,
} from "./types.js";

export const DEFAULT_MAX_TOOL_ITERATIONS = 5;

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: ToolCallRequest[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCallRequest {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatCompletionMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCallRequest[];
}

interface ChatCompletionLike {
  choices: Array<{ message: ChatCompletionMessage; finish_reason?: string }>;
}

export interface RunChatCompletionsOnceOptions {
  client: OpenAI;
  model: string;
  messages: ChatMessage[];
  tools: Array<Record<string, unknown>>;
  signal?: AbortSignal;
}

export type RunChatCompletionsOnceResult = ChatCompletionLike;
export type RunChatCompletionsOnce = (
  opts: RunChatCompletionsOnceOptions,
) => Promise<RunChatCompletionsOnceResult>;

export interface RunChatCompletionsWithToolsOptions {
  client: OpenAI;
  model: string;
  providerName: string;
  logger: Logger;
  request: ProviderChatRequest;
  messages: ChatMessage[];
  extraTools?: Array<Record<string, unknown>>;
  runOnce: RunChatCompletionsOnce;
}

export async function runChatCompletionsWithTools(
  opts: RunChatCompletionsWithToolsOptions,
): Promise<ProviderChatResult> {
  const {
    client,
    model,
    providerName,
    logger,
    request,
    messages,
    extraTools,
    runOnce,
  } = opts;
  const maxIter = request.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let workingMessages: ChatMessage[] = messages;
  const tools: Array<Record<string, unknown>> = [...(extraTools ?? [])];
  if (request.tools && request.tools.length > 0) {
    for (const t of request.tools) {
      tools.push(chatCompletionsTool(t));
    }
  }
  let finalText = "";
  let iterations = 0;
  let lastFinishReason: string | undefined;

  for (;;) {
    const response = await runOnce({
      client,
      model,
      messages: workingMessages,
      tools,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const choice = response.choices[0];
    const msg = choice?.message;
    lastFinishReason = choice?.finish_reason;
    if (msg?.content) finalText += msg.content;

    const toolCalls = msg?.tool_calls;
    if (!toolCalls || toolCalls.length === 0 || !request.onToolCall) break;

    iterations += 1;
    if (iterations > maxIter) {
      logger.warn(
        { provider: providerName, maxIter, tool: toolCalls[0]?.function.name },
        "chat-completions: max tool iterations reached; returning partial response",
      );
      break;
    }
    if (request.signal?.aborted) {
      throw new Error("aborted");
    }

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: msg?.content ?? null,
      tool_calls: toolCalls,
    };
    const toolResultMessages: ChatMessage[] = [];
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function.arguments) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch (err) {
        logger.warn(
          { err, tool: call.function.name, raw: call.function.arguments },
          "chat-completions: tool arguments not valid JSON; using empty object",
        );
      }

      let output: string;
      try {
        output = await request.onToolCall(call.function.name, args);
      } catch (err) {
        output = `Tool call failed: ${(err as Error).message}`;
        logger.warn(
          { err, tool: call.function.name },
          "chat-completions: tool call failed",
        );
      }
      toolResultMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: output,
      });
    }

    workingMessages = [
      ...workingMessages,
      assistantMessage,
      ...toolResultMessages,
    ];
  }

  logger.debug(
    {
      provider: providerName,
      model,
      toolIterations: iterations,
      finishReason: lastFinishReason,
    },
    "chat-completions: chat complete",
  );
  return { text: finalText, model, provider: providerName };
}

export function chatCompletionsTool(
  t: ProviderChatTool,
): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.parameters,
    },
  };
}

export function toChatMessages(
  messages: ProviderChatRequest["messages"],
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === "system" || m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
