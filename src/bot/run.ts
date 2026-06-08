import http from "node:http";
import type { Telegraf } from "telegraf";
import type { Logger } from "pino";
import type { ValidatedConfig } from "../config/index.js";
import { registerBotCommands } from "./commands.js";

export interface StartResult {
  mode: "longpoll" | "webhook";
  stop: () => Promise<void>;
}

export async function startBot<C extends import("telegraf").Context = import("telegraf").Context>(opts: {
  bot: Telegraf<C>;
  config: ValidatedConfig;
  logger: Logger;
}): Promise<StartResult> {
  const { bot, config, logger } = opts;
  try {
    await registerBotCommands(bot);
    logger.info("bot commands registered for all_private_chats scope");
  } catch (err) {
    logger.warn({ err }, "failed to register bot commands; autocomplete will not be available");
  }

  if (config.botMode === "longpoll") {
    const server = http.createServer((req, res) => {
      if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(config.port, () => resolve()));
    logger.info({ port: config.port }, "longpoll health server listening on /healthz");
    void bot.launch();
    logger.info("longpoll started");
    return {
      mode: "longpoll",
      stop: async () => {
        await bot.stop("shutdown");
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  if (!config.publicWebhookUrl || !config.webhookSecretToken) {
    throw new Error("webhook mode requires PUBLIC_WEBHOOK_URL and WEBHOOK_SECRET_TOKEN");
  }
  const path = `/telegram/${config.webhookSecretToken}`;
  const fullUrl = `${config.publicWebhookUrl.replace(/\/$/, "")}${path}`;
  const redactedUrl = fullUrl.replace(config.webhookSecretToken, "***");
  logger.info({ url: redactedUrl, port: config.port }, "starting webhook");

  await bot.telegram.setWebhook(fullUrl, { secret_token: config.webhookSecretToken });
  const callback = bot.webhookCallback(path, { secretToken: config.webhookSecretToken });

  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    callback(req, res);
  });
  await new Promise<void>((resolve) => server.listen(config.port, () => resolve()));
  logger.info({ port: config.port }, "webhook server listening");

  return {
    mode: "webhook",
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await bot.telegram.deleteWebhook();
    },
  };
}
