import { describe, it, expect, vi } from "vitest";
import { pino } from "pino";
import {
  runChatCompletionsWithTools,
  toChatMessages,
  type RunChatCompletionsOnce,
  type RunChatCompletionsOnceResult,
} from "../../src/providers/chat-completions-loop.js";

const SILENT = pino({ level: "silent" });

function ok(
  text: string | null,
  opts: { toolCalls?: Array<{ id: string; name: string; args: string }> } = {},
): RunChatCompletionsOnceResult {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: text,
          ...(opts.toolCalls
            ? {
                tool_calls: opts.toolCalls.map((c) => ({
                  id: c.id,
                  type: "function" as const,
                  function: { name: c.name, arguments: c.args },
                })),
              }
            : {}),
        },
      },
    ],
  };
}

describe("runChatCompletionsWithTools", () => {
  it("returns plain text when the model emits no tool calls", async () => {
    const runOnce: RunChatCompletionsOnce = vi.fn(async () => ok("hi"));
    const result = await runChatCompletionsWithTools({
      client: undefined as never,
      model: "m",
      providerName: "test",
      logger: SILENT,
      request: { messages: [], searchEnabled: false },
      messages: toChatMessages([{ role: "user", content: "hello" }]),
      runOnce,
    });
    expect(result.text).toBe("hi");
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("dispatches tool calls and feeds results back", async () => {
    const onToolCall = vi.fn<(name: string, args: Record<string, unknown>) => Promise<string>>(
      async () => "tool output",
    );
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const wrappedOnToolCall = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return onToolCall(name, args);
    };
    let iteration = 0;
    const runOnce: RunChatCompletionsOnce = vi.fn(async () => {
      iteration++;
      if (iteration === 1) {
        return ok(null, {
          toolCalls: [{ id: "call_1", name: "lookup", args: '{"q":"x"}' }],
        });
      }
      return ok("final answer");
    });
    const result = await runChatCompletionsWithTools({
      client: undefined as never,
      model: "m",
      providerName: "test",
      logger: SILENT,
      request: {
        messages: [],
        searchEnabled: false,
        onToolCall: wrappedOnToolCall,
      },
      messages: toChatMessages([{ role: "user", content: "hi" }]),
      runOnce,
    });
    expect(result.text).toBe("final answer");
    expect(calls).toEqual([{ name: "lookup", args: { q: "x" } }]);
    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it("captures tool errors as content and continues the loop", async () => {
    const onToolCall = vi.fn(async () => {
      throw new Error("boom");
    });
    let iteration = 0;
    const runOnce: RunChatCompletionsOnce = vi.fn(async () => {
      iteration++;
      if (iteration === 1) {
        return ok(null, {
          toolCalls: [{ id: "c1", name: "lookup", args: "{}" }],
        });
      }
      return ok("ok after error");
    });
    const result = await runChatCompletionsWithTools({
      client: undefined as never,
      model: "m",
      providerName: "test",
      logger: SILENT,
      request: {
        messages: [],
        searchEnabled: false,
        onToolCall,
      },
      messages: toChatMessages([{ role: "user", content: "hi" }]),
      runOnce,
    });
    expect(result.text).toBe("ok after error");
  });

  it("stops after maxToolIterations", async () => {
    const runOnce: RunChatCompletionsOnce = vi.fn(async () =>
      ok(null, {
        toolCalls: [{ id: "c1", name: "loop", args: "{}" }],
      }),
    );
    const onToolCall = vi.fn(async () => "ok");
    const result = await runChatCompletionsWithTools({
      client: undefined as never,
      model: "m",
      providerName: "test",
      logger: SILENT,
      request: {
        messages: [],
        searchEnabled: false,
        onToolCall,
        maxToolIterations: 2,
      },
      messages: toChatMessages([{ role: "user", content: "hi" }]),
      runOnce,
    });
    expect(result.text).toBe("");
    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(onToolCall).toHaveBeenCalledTimes(2);
  });

  it("aborts cleanly when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const onToolCall = vi.fn(async () => "ok");
    let iteration = 0;
    const runOnce: RunChatCompletionsOnce = vi.fn(async () => {
      iteration++;
      if (iteration === 1) {
        return ok(null, { toolCalls: [{ id: "c1", name: "t", args: "{}" }] });
      }
      return ok("never");
    });
    await expect(
      runChatCompletionsWithTools({
        client: undefined as never,
        model: "m",
        providerName: "test",
        logger: SILENT,
        request: { messages: [], searchEnabled: false, onToolCall, signal: controller.signal },
        messages: toChatMessages([{ role: "user", content: "hi" }]),
        runOnce,
      }),
    ).rejects.toThrow("aborted");
  });
});
