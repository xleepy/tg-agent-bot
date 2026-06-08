import type { Telegraf } from "telegraf";

export const BOT_COMMANDS: ReadonlyArray<{ command: string; description: string }> = [
  { command: "start", description: "Show bot status" },
  { command: "help", description: "List available commands" },
  { command: "whoami", description: "Show your Telegram user id" },
  { command: "provider", description: "Show the active LLM provider" },
  { command: "model", description: "Show or set the current model (use /model <name>)" },
  { command: "search", description: "Toggle web search for the next message (use /search on|off)" },
  { command: "status", description: "Show runtime state" },
  { command: "reset", description: "Clear conversation history for this chat" },
  { command: "stop", description: "Abort the in-flight response for this chat" },
];

export async function registerBotCommands<C extends import("telegraf").Context = import("telegraf").Context>(
  bot: Telegraf<C>,
): Promise<void> {
  await bot.telegram.setMyCommands([...BOT_COMMANDS], {
    scope: { type: "all_private_chats" },
  });
}
