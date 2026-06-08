import { describe, it, expect, vi } from "vitest";
import { Telegraf } from "telegraf";
import { registerBotCommands, BOT_COMMANDS } from "../../src/bot/commands.js";

describe("registerBotCommands", () => {
  it("exports the 9 expected commands", () => {
    const names = BOT_COMMANDS.map((c) => c.command).sort();
    expect(names).toEqual([
      "help",
      "model",
      "provider",
      "reset",
      "search",
      "start",
      "status",
      "stop",
      "whoami",
    ]);
  });

  it("calls setMyCommands with the all_private_chats scope", async () => {
    const spy = vi
      .spyOn(Telegraf.prototype, "launch")
      .mockImplementation(async () => undefined);
    const bot = new Telegraf("test-token");
    const setMyCommandsSpy = vi
      .spyOn(bot.telegram, "setMyCommands")
      .mockResolvedValue(true);
    try {
      await registerBotCommands(bot);
      expect(setMyCommandsSpy).toHaveBeenCalledTimes(1);
      const [commands, opts] = setMyCommandsSpy.mock.calls[0] ?? [];
      expect(opts).toEqual({ scope: { type: "all_private_chats" } });
      expect(commands).toHaveLength(9);
    } finally {
      setMyCommandsSpy.mockRestore();
      spy.mockRestore();
    }
  });
});
