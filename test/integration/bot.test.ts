import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Telegraf, Telegram } from "telegraf";
import { createBot } from "../../src/bot/index.js";
import { BOT_COMMANDS } from "../../src/bot/commands.js";
import { ProviderConfig } from "../../src/providers/index.js";
import type { ProviderAdapter } from "../../src/providers/index.js";
import { createSearchInjector } from "../../src/search/index.js";
import type { ValidatedConfig } from "../../src/config/index.js";
import type { HistoryStore, HistoryMessage } from "../../src/history/index.js";
import type { McpRegistry } from "../../src/mcp/index.js";
import { pino } from "pino";

const SILENT = pino({ level: "silent" });

class InMemoryHistoryStore implements HistoryStore {
  private map = new Map<number, HistoryMessage[]>();
  append(chatId: number, message: HistoryMessage): void {
    const arr = this.map.get(chatId) ?? [];
    arr.push(message);
    this.map.set(chatId, arr);
  }
  recent(chatId: number, limit: number): HistoryMessage[] {
    const arr = this.map.get(chatId) ?? [];
    return arr.slice(-limit);
  }
  clear(chatId: number): void {
    this.map.delete(chatId);
  }
  close(): void {}
}

const EMPTY_MCP: McpRegistry = {
  servers: [],
  closeAll: async () => undefined,
};

function makeMcpRegistry(): { mcp: McpRegistry; callTool: ReturnType<typeof vi.fn> } {
  const tools = [
    {
      name: "echo",
      description: "Echo args",
      inputSchema: { type: "object", properties: { value: { type: "string" } } },
    },
  ];
  const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "echo result" }] });
  return {
    mcp: {
      servers: [
        {
          serverName: "everything",
          cachedTools: tools,
          listTools: async () => tools,
          callTool,
          close: async () => undefined,
        },
      ],
      closeAll: async () => undefined,
    },
    callTool,
  };
}

let callApiSpy: { mockRestore: () => void } | undefined;
let callApiCalls: Array<{ method: string; payload: unknown }> = [];
let nextMessageId = 1000;

const baseConfig: ValidatedConfig = {
  telegramBotToken: "tkn",
  ownerTelegramUserId: 12345,
  defaultProvider: "openai",
  openaiApiKey: "ok",
  openaiModel: "gpt-4o",
  openrouterApiKey: undefined,
  openrouterModel: undefined,
  opencodeBaseUrl: "https://opencode.ai/zen/go/v1",
  opencodeApiKey: undefined,
  opencodeModel: "kimi-k2.6",
  tavilyApiKey: undefined,
  sqlitePath: "./data/bot.sqlite",
  systemPrompt: "test system prompt",
  mcpConfigPath: "./mcp.json",
  defaultSearchMode: "off",
  botMode: "longpoll",
  port: 8080,
  publicWebhookUrl: undefined,
  webhookSecretToken: undefined,
  logLevel: "fatal",
};

function makeFakeProvider(respondWith = "hi"): { provider: ProviderConfig; spy: ReturnType<typeof vi.fn>; history: HistoryStore } {
  const spy = vi.fn().mockResolvedValue({ text: respondWith, model: "m", provider: "openai" });
  const adapter: ProviderAdapter = {
    name: "openai",
    chat: spy,
    getDefaultModel: () => "m",
  };
  return { provider: new ProviderConfig(adapter, "openai", "m"), spy, history: new InMemoryHistoryStore() };
}

function makeUpdate(text: string, fromId = 12345, chatType: "private" | "group" = "private") {
  const entities: Array<{ type: string; offset: number; length: number }> = [];
  if (text.startsWith("/")) {
    const space = text.indexOf(" ");
    const len = space === -1 ? text.length : space;
    entities.push({ type: "bot_command", offset: 0, length: len });
  }
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 1, type: chatType },
      from: { id: fromId, is_bot: false, username: "u" },
      text,
      entities,
    },
  };
}

function withBotInfo<T extends import("telegraf").Telegraf<import("telegraf").Context>>(bot: T): T {
  (bot as unknown as { botInfo: { id: number; username: string; is_bot: true; first_name: string } }).botInfo = {
    id: 999,
    username: "mybot",
    is_bot: true,
    first_name: "MyBot",
  };
  return bot;
}

beforeEach(() => {
  callApiCalls = [];
  nextMessageId = 1000;
  callApiSpy = vi
    .spyOn(Telegram.prototype, "callApi")
    .mockImplementation(async (method: string, payload: unknown) => {
      callApiCalls.push({ method, payload });
      if (method === "sendMessage") {
        return { message_id: nextMessageId++ } as never;
      }
      return true as never;
    });
});

afterEach(() => {
  callApiSpy?.mockRestore();
  callApiSpy = undefined;
});

describe("bot commands", () => {
  it("/whoami returns the owner's id", async () => {
    const { provider, history } = makeFakeProvider();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("/whoami") as never);
    expect(bot).toBeInstanceOf(Telegraf);
  });

  it("/provider returns provider name", async () => {
    const { provider, history } = makeFakeProvider();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("/provider") as never);
    expect(true).toBe(true);
  });

  it("/model sets the model for next message", async () => {
    const { provider, spy, history } = makeFakeProvider("ok");
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("/model gpt-4o-mini") as never);
    await bot.handleUpdate(makeUpdate("hello") as never);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].model).toBe("gpt-4o-mini");
  });

  it("/search off disables search for next message", async () => {
    const { provider, spy, history } = makeFakeProvider("ok");
    const bot = withBotInfo(createBot({
      config: { ...baseConfig, defaultSearchMode: "on" },
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("/search off") as never);
    await bot.handleUpdate(makeUpdate("hello") as never);
    expect(spy.mock.calls[0]?.[0].searchEnabled).toBe(false);
  });

  it("rejects non-owner messages in private chat", async () => {
    const { provider, spy, history } = makeFakeProvider();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("hi", 7) as never);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects any message in a group, even from the owner", async () => {
    const { provider, spy, history } = makeFakeProvider();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("hi", 12345, "group") as never);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends a 'thinking…' placeholder and edits it with the response", async () => {
    const { provider, history } = makeFakeProvider("the answer");
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("hello") as never);
    const sendMessages = callApiCalls.filter((c) => c.method === "sendMessage");
    const edits = callApiCalls.filter((c) => c.method === "editMessageText");
    const placeholder = sendMessages.find((c) => {
      const p = c.payload as { text?: string } | undefined;
      return p?.text === "thinking…";
    });
    expect(placeholder).toBeDefined();
    expect(edits).toHaveLength(1);
    const editPayload = edits[0]?.payload as { text?: string } | undefined;
    expect(editPayload?.text).toBe("the answer");
  });

  it("replaces placeholder with error message on provider failure", async () => {
    const { provider, spy, history } = makeFakeProvider();
    spy.mockRejectedValueOnce(new Error("boom"));
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("hello") as never);
    const edits = callApiCalls.filter((c) => c.method === "editMessageText");
    expect(edits).toHaveLength(1);
    const editPayload = edits[0]?.payload as { text?: string } | undefined;
    expect(editPayload?.text).toContain("Error");
  });

  it("sends prior history to the provider on the next message", async () => {
    const { provider, spy, history } = makeFakeProvider("ok");
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("first message") as never);
    await bot.handleUpdate(makeUpdate("second message") as never);
    expect(spy).toHaveBeenCalledTimes(2);
    const secondCall = spy.mock.calls[1]?.[0];
    const roles = (secondCall?.messages as Array<{ role: string; content: string }>).map((m) => m.role);
    const contents = (secondCall?.messages as Array<{ role: string; content: string }>).map((m) => m.content);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(contents).toEqual(["test system prompt", "first message", "ok", "second message"]);
  });

  it("prepends SYSTEM_PROMPT to the messages sent to the provider", async () => {
    const { provider, spy, history } = makeFakeProvider("ok");
    const bot = withBotInfo(createBot({
      config: { ...baseConfig, systemPrompt: "You are a concise assistant." },
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("hello") as never);
    const call = spy.mock.calls[0]?.[0];
    const messages = call?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "You are a concise assistant." });
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "hello" });
  });

  it("always sends a system message (the built-in default if no override)", async () => {
    const { provider, spy, history } = makeFakeProvider("ok");
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("hello") as never);
    const call = spy.mock.calls[0]?.[0];
    const messages = call?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe("test system prompt");
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "hello" });
  });

  it("adds loaded MCP tools and runtime context to provider requests", async () => {
    const { provider, spy, history } = makeFakeProvider("ok");
    const { mcp } = makeMcpRegistry();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp,
      history,
    }));
    await bot.handleUpdate(makeUpdate("do you have mcp?") as never);
    const call = spy.mock.calls[0]?.[0];
    const messages = call?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "test system prompt" });
    expect(messages[1]?.role).toBe("system");
    expect(messages[1]?.content).toContain("Runtime MCP servers loaded: 1.");
    expect(messages[1]?.content).toContain("everything: echo");
    expect(call?.tools).toEqual([
      {
        name: "echo",
        description: "Echo args",
        parameters: { type: "object", properties: { value: { type: "string" } } },
      },
    ]);
  });

  it("/status reports loaded MCP servers and tools", async () => {
    const { provider, history } = makeFakeProvider("ok");
    const { mcp } = makeMcpRegistry();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp,
      history,
    }));
    await bot.handleUpdate(makeUpdate("/status") as never);
    const statusReply = callApiCalls.find(
      (c) => c.method === "sendMessage" && (c.payload as { text?: string } | undefined)?.text?.startsWith("Provider:"),
    );
    const text = (statusReply?.payload as { text?: string } | undefined)?.text;
    expect(text).toContain("MCP: 1 server, 1 tool");
    expect(text).toContain("MCP everything: echo");
  });

  it("/stop aborts an in-flight request and edits the placeholder to 'Stopped.'", async () => {
    const slowSpy = vi
      .fn()
      .mockImplementation(
        ({ signal }: { signal?: AbortSignal }) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ text: "late", model: "m", provider: "openai" }), 5000);
            signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );
    const adapter: ProviderAdapter = {
      name: "openai",
      chat: slowSpy,
      getDefaultModel: () => "m",
    };
    const provider = new ProviderConfig(adapter, "openai", "m");
    const history = new InMemoryHistoryStore();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    const first = bot.handleUpdate(makeUpdate("thinking question") as never);
    await new Promise((r) => setTimeout(r, 5));
    await bot.handleUpdate(makeUpdate("/stop") as never);
    await first;
    const edits = callApiCalls.filter((c) => c.method === "editMessageText");
    const stoppedEdit = edits.find((c) => (c.payload as { text?: string } | undefined)?.text === "Stopped.");
    expect(stoppedEdit).toBeDefined();
    expect(slowSpy).toHaveBeenCalledTimes(1);
    expect((slowSpy.mock.calls[0]?.[0] as { signal?: AbortSignal }).signal?.aborted).toBe(true);
  });

  it("/stop with nothing in flight replies 'Nothing in progress to stop.'", async () => {
    const { provider, history } = makeFakeProvider();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("/stop") as never);
    const reply = callApiCalls.find(
      (c) =>
        c.method === "sendMessage" &&
        (c.payload as { text?: string } | undefined)?.text === "Nothing in progress to stop.",
    );
    expect(reply).toBeDefined();
  });

  it("/help lists every command registered in BOT_COMMANDS", async () => {
    const { provider, history } = makeFakeProvider();
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("/help") as never);
    const helpReply = callApiCalls.find(
      (c) => c.method === "sendMessage" && (c.payload as { text?: string } | undefined)?.text?.startsWith("Commands:"),
    );
    expect(helpReply).toBeDefined();
    const text = (helpReply?.payload as { text: string }).text;
    expect(text.split("\n").length - 1).toBe(BOT_COMMANDS.length);
  });

  it("/reset clears the history", async () => {
    const { provider, spy, history } = makeFakeProvider("ok");
    const bot = withBotInfo(createBot({
      config: baseConfig,
      logger: SILENT,
      provider,
      search: createSearchInjector(undefined),
      tavilyAvailable: false,
      mcp: EMPTY_MCP,
      history,
    }));
    await bot.handleUpdate(makeUpdate("first") as never);
    await bot.handleUpdate(makeUpdate("/reset") as never);
    await bot.handleUpdate(makeUpdate("after reset") as never);
    const secondCall = spy.mock.calls[1]?.[0];
    const messages = secondCall?.messages as Array<{ role: string; content: string }>;
    expect(messages).toEqual([
      { role: "system", content: "test system prompt" },
      { role: "user", content: "after reset" },
    ]);
  });
});
