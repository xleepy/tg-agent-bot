import { Telegraf, type Context } from "telegraf";
import type { Logger } from "pino";
import type { ValidatedConfig } from "../config/index.js";
import { ownerOnly } from "../auth/index.js";
import { chunkMessage } from "../utils/index.js";
import { resolveSearch, type SearchInjector } from "../search/index.js";
import type { ProviderConfig } from "../providers/index.js";
import { BOT_COMMANDS } from "./commands.js";
import type { HistoryStore } from "../history/index.js";
import type {
  ProviderChatMessage,
  ProviderChatTool,
} from "../providers/index.js";
import type { McpRegistry } from "../mcp/index.js";

export interface BotDeps {
  config: ValidatedConfig;
  logger: Logger;
  provider: ProviderConfig;
  search: SearchInjector;
  tavilyAvailable: boolean;
  history: HistoryStore;
  mcp: McpRegistry;
}

const HISTORY_RETENTION = 20;

interface ChatState {
  currentModel: string;
  nextSearchOverride: "on" | "off" | undefined;
  inflight:
    | { controller: AbortController; placeholderMessageId: number }
    | undefined;
}

function formatLimitedList(items: string[], max: number): string {
  const visible = items.slice(0, max);
  const suffix = items.length > max ? `, and ${items.length - max} more` : "";
  return `${visible.join(", ")}${suffix}`;
}

function mcpServerSummaries(
  mcp: McpRegistry,
  maxToolsPerServer: number,
): string[] {
  return mcp.servers.map((server) => {
    const toolNames = (server.cachedTools ?? []).map((tool) => tool.name);
    const tools =
      toolNames.length > 0
        ? formatLimitedList(toolNames, maxToolsPerServer)
        : "no tools";
    return `${server.serverName}: ${tools}`;
  });
}

export function createBot(deps: BotDeps): Telegraf<Context> {
  const { config, logger, provider, search, tavilyAvailable, history, mcp } =
    deps;
  const bot = new Telegraf<Context>(config.telegramBotToken);

  bot.use(ownerOnly(config.ownerTelegramUserId));

  const toolByName = new Map<
    string,
    { server: McpRegistry["servers"][number]; toolName: string }
  >();
  for (const server of mcp.servers) {
    for (const tool of server.cachedTools ?? []) {
      toolByName.set(tool.name, { server, toolName: tool.name });
    }
  }
  const mcpTools: ProviderChatTool[] = (mcp.servers ?? []).flatMap((s) =>
    (s.cachedTools ?? []).map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.inputSchema,
    })),
  );
  const mcpSummaries = mcpServerSummaries(mcp, 10);
  const mcpRuntimeContext =
    mcpSummaries.length > 0
      ? [
          `Runtime MCP servers loaded: ${mcp.servers.length}.`,
          `Runtime MCP tools available: ${mcpTools.length}.`,
          `Tools by server: ${mcpSummaries.join("; ")}.`,
          "When asked about MCP or tool availability, answer from this runtime context.",
        ].join(" ")
      : undefined;

  const chatStates = new Map<string, ChatState>();
  const chatStateFor = (ownerId: number, chatId: number): ChatState => {
    const key = `${ownerId}:${chatId}`;
    let s = chatStates.get(key);
    if (!s) {
      s = {
        currentModel: provider.model,
        nextSearchOverride: undefined,
        inflight: undefined,
      };
      chatStates.set(key, s);
    }
    return s;
  };

  bot.start(async (ctx) => {
    const s = ctx.from ? chatStateFor(ctx.from.id, ctx.chat.id) : undefined;
    await ctx.reply(
      `Owner agent online.\nProvider: ${provider.providerName}\nModel: ${s?.currentModel ?? provider.model}\nSearch mode: ${config.defaultSearchMode}`,
    );
  });

  bot.help(async (ctx) => {
    const lines = [
      "Commands:",
      ...BOT_COMMANDS.map((c) => `/${c.command} - ${c.description}`),
    ];
    await ctx.reply(lines.join("\n"));
  });

  bot.command("whoami", async (ctx) => {
    const from = ctx.from;
    await ctx.reply(from ? `Your id: ${from.id}` : "No from info");
  });

  bot.command("provider", async (ctx) => {
    await ctx.reply(`Provider: ${provider.providerName}`);
  });

  bot.command("model", async (ctx) => {
    if (!ctx.from) return;
    const s = chatStateFor(ctx.from.id, ctx.chat.id);
    const arg = ctx.message.text.split(/\s+/)[1];
    if (arg) {
      s.currentModel = arg;
      await ctx.reply(`Model set to: ${s.currentModel}`);
    } else {
      await ctx.reply(`Model: ${s.currentModel}`);
    }
  });

  bot.command("search", async (ctx) => {
    if (!ctx.from) return;
    const s = chatStateFor(ctx.from.id, ctx.chat.id);
    const arg = ctx.message.text.split(/\s+/)[1]?.toLowerCase();
    if (arg === "on" || arg === "off") {
      s.nextSearchOverride = arg;
      await ctx.reply(`Next message: search ${arg}`);
    } else {
      await ctx.reply("Usage: /search on|off");
    }
  });

  bot.command("status", async (ctx) => {
    if (!ctx.from) return;
    const s = chatStateFor(ctx.from.id, ctx.chat.id);
    const historyCount = history.recent(ctx.chat.id, HISTORY_RETENTION).length;
    const mcpStatus =
      mcpSummaries.length > 0
        ? mcpSummaries.map((summary) => `MCP ${summary}`)
        : ["MCP: no servers loaded"];
    await ctx.reply(
      [
        `Provider: ${provider.providerName}`,
        `Model: ${s.currentModel}`,
        `Search mode: ${config.defaultSearchMode}`,
        `Next search override: ${s.nextSearchOverride ?? "none"}`,
        `Tavily: ${tavilyAvailable ? "configured" : "not configured"}`,
        `MCP: ${mcp.servers.length} server${mcp.servers.length === 1 ? "" : "s"}, ${mcpTools.length} tool${mcpTools.length === 1 ? "" : "s"}`,
        ...mcpStatus,
        `History: ${historyCount} message${historyCount === 1 ? "" : "s"} in context`,
      ].join("\n"),
    );
  });

  bot.command("reset", async (ctx) => {
    if (!ctx.from) return;
    history.clear(ctx.chat.id);
    await ctx.reply("History cleared.");
  });

  bot.command("stop", async (ctx) => {
    if (!ctx.from) return;
    const s = chatStateFor(ctx.from.id, ctx.chat.id);
    if (!s.inflight) {
      await ctx.reply("Nothing in progress to stop.");
      return;
    }
    const { controller, placeholderMessageId } = s.inflight;
    s.inflight = undefined;
    controller.abort();
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        placeholderMessageId,
        undefined,
        "Stopped.",
      );
    } catch (err) {
      logger.debug({ err }, "failed to edit placeholder after /stop");
    }
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      return;
    }
    if (!ctx.from) return;
    const s = chatStateFor(ctx.from.id, ctx.chat.id);
    const chatId = ctx.chat.id;

    const decision = resolveSearch({
      mode: config.defaultSearchMode,
      ...(s.nextSearchOverride ? { override: s.nextSearchOverride } : {}),
      provider: provider.providerName as "openai" | "openrouter" | "opencode",
      tavilyAvailable,
    });
    s.nextSearchOverride = undefined;

    const placeholder = await ctx.reply("thinking…").catch((err) => {
      logger.error({ err }, "failed to send placeholder");
      return undefined;
    });
    const placeholderMessageId = placeholder?.message_id;

    const controller = new AbortController();
    if (placeholderMessageId !== undefined) {
      s.inflight = { controller, placeholderMessageId };
    }

    const typingTimer = setInterval(() => {
      ctx.telegram.sendChatAction(chatId, "typing").catch((err) => {
        logger.debug({ err }, "failed to refresh typing action");
      });
    }, 4000);

    try {
      const prior = history.recent(chatId, HISTORY_RETENTION);
      let userContent = text;
      let searchUsed = false;
      if (decision.strategy === "tavily") {
        const augmented = await search.maybeAugment({ prompt: text });
        userContent = augmented.prompt;
        searchUsed = augmented.searchUsed;
      }
      const messages: ProviderChatMessage[] = [
        { role: "system", content: config.systemPrompt },
      ];
      if (mcpRuntimeContext) {
        messages.push({ role: "system", content: mcpRuntimeContext });
      }
      for (const m of prior) {
        if (m.role === "user" || m.role === "assistant") {
          messages.push({ role: m.role, content: m.content });
        }
      }
      messages.push({ role: "user", content: userContent });
      const result = await provider.provider.chat({
        messages,
        model: s.currentModel,
        searchEnabled: decision.strategy === "native" || searchUsed,
        signal: controller.signal,
        ...(mcpTools.length > 0 ? { tools: mcpTools } : {}),
        ...(mcpTools.length > 0
          ? {
              onToolCall: async (
                name: string,
                args: Record<string, unknown>,
              ) => {
                const entry = toolByName.get(name);
                if (!entry) {
                  return `Error: tool "${name}" is not registered with any MCP server`;
                }
                const result = await entry.server.callTool(
                  name,
                  args,
                  controller.signal,
                );
                console.log("result from tool call", { name, args, result });
                const text = result.content
                  .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
                  .join("\n");
                return result.isError ? `Error: ${text}` : text;
              },
            }
          : {}),
      });
      const chunks = chunkMessage(result.text);
      if (chunks.length === 0 || (chunks.length === 1 && chunks[0] === "")) {
        if (placeholderMessageId !== undefined) {
          await ctx.telegram
            .deleteMessage(chatId, placeholderMessageId)
            .catch(() => undefined);
        }
        return;
      }
      if (placeholderMessageId !== undefined) {
        await ctx.telegram
          .editMessageText(
            chatId,
            placeholderMessageId,
            undefined,
            chunks[0] ?? "",
          )
          .catch((err) => {
            logger.warn(
              { err },
              "failed to edit placeholder; sending new reply instead",
            );
            return ctx.reply(chunks[0] ?? "");
          });
        for (let i = 1; i < chunks.length; i++) {
          await ctx.reply(chunks[i] ?? "");
        }
      } else {
        for (const chunk of chunks) {
          await ctx.reply(chunk);
        }
      }
      history.append(chatId, {
        role: "user",
        content: text,
        createdAt: Date.now(),
      });
      history.append(chatId, {
        role: "assistant",
        content: result.text,
        createdAt: Date.now(),
      });
    } catch (err) {
      if (controller.signal.aborted) {
        logger.info({ chatId }, "chat aborted by /stop");
      } else {
        logger.error({ err, provider: provider.providerName }, "chat failed");
        if (placeholderMessageId !== undefined) {
          await ctx.telegram
            .editMessageText(
              chatId,
              placeholderMessageId,
              undefined,
              "Error: failed to generate response",
            )
            .catch(() => ctx.reply("Error: failed to generate response"));
        } else {
          await ctx.reply("Error: failed to generate response");
        }
      }
    } finally {
      clearInterval(typingTimer);
      if (s.inflight?.controller === controller) {
        s.inflight = undefined;
      }
    }
  });

  return bot;
}
