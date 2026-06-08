import { z } from "zod";

const TELEGRAM_USER_ID_MAX = 10_000_000_000;

const telegramUserId = z
  .string({
    required_error: "BOT_OWNER_TELEGRAM_USER_ID is required",
    invalid_type_error: "BOT_OWNER_TELEGRAM_USER_ID must be a string",
  })
  .trim()
  .min(1, "BOT_OWNER_TELEGRAM_USER_ID must not be empty")
  .refine(
    (s) => !/\s/.test(s),
    "BOT_OWNER_TELEGRAM_USER_ID must not contain whitespace",
  )
  .refine(
    (s) => !/^\+/.test(s),
    "BOT_OWNER_TELEGRAM_USER_ID must not start with '+'",
  )
  .refine(
    (s) => /^[0-9]+$/.test(s),
    "BOT_OWNER_TELEGRAM_USER_ID must be digits only",
  )
  .transform((s) => Number(s))
  .refine(
    (n) => Number.isInteger(n),
    "BOT_OWNER_TELEGRAM_USER_ID must be an integer",
  )
  .refine(
    (n) => n > 0,
    "BOT_OWNER_TELEGRAM_USER_ID must be positive (non-zero)",
  )
  .refine(
    (n) => n <= TELEGRAM_USER_ID_MAX,
    `BOT_OWNER_TELEGRAM_USER_ID must be <= ${TELEGRAM_USER_ID_MAX}`,
  );

const searchMode = z.enum(["auto", "on", "off"]).default("auto");
const botMode = z.enum(["longpoll", "webhook"]).default("longpoll");
const logLevel = z
  .enum(["trace", "debug", "info", "warn", "error", "fatal"])
  .default("info");
const providerName = z.enum(["openai", "openrouter", "opencode"]);

const baseSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  BOT_OWNER_TELEGRAM_USER_ID: telegramUserId,
  DEFAULT_PROVIDER: providerName.default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  OPENCODE_BASE_URL: z.string().url().default("https://opencode.ai/zen/go/v1"),
  OPENCODE_API_KEY: z.string().optional(),
  OPENCODE_MODEL: z.string().default("kimi-k2.6"),
  TAVILY_API_KEY: z.string().optional(),
  SYSTEM_PROMPT: z.string().optional(),
  DEFAULT_SYSTEM_PROMPT: z
    .string()
    .default(
      "You are a personal assistant running inside a Telegram bot. Reply in clear, conversational prose. Do not use markdown, formatting tags, or code fences — Telegram renders text as plain monospaced. Keep responses concise unless asked for detail. The bot is private and single-user; do not warn about sharing sensitive data with the user.",
    ),
  MCP_CONFIG_PATH: z.string().default("./mcp.json"),
  SQLITE_PATH: z.string().default("./data/bot.sqlite"),
  DEFAULT_SEARCH_MODE: searchMode,
  BOT_MODE: botMode,
  PORT: z.coerce.number().int().positive().default(8080),
  PUBLIC_WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET_TOKEN: z.string().optional(),
  LOG_LEVEL: logLevel,
});

export type RawConfig = z.infer<typeof baseSchema>;

export interface ValidatedConfig {
  telegramBotToken: string;
  ownerTelegramUserId: number;
  defaultProvider: "openai" | "openrouter" | "opencode";
  openaiApiKey: string | undefined;
  openaiModel: string;
  openrouterApiKey: string | undefined;
  openrouterModel: string | undefined;
  opencodeBaseUrl: string;
  opencodeApiKey: string | undefined;
  opencodeModel: string;
  tavilyApiKey: string | undefined;
  systemPrompt: string;
  mcpConfigPath: string;
  sqlitePath: string;
  defaultSearchMode: "auto" | "on" | "off";
  botMode: "longpoll" | "webhook";
  port: number;
  publicWebhookUrl: string | undefined;
  webhookSecretToken: string | undefined;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ValidatedConfig {
  const result = baseSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`,
    );
    throw new ConfigError("Invalid configuration", issues);
  }
  const data = result.data;

  if (data.BOT_MODE === "webhook") {
    if (!data.PUBLIC_WEBHOOK_URL) {
      throw new ConfigError("Invalid configuration", [
        "PUBLIC_WEBHOOK_URL: required when BOT_MODE=webhook",
      ]);
    }
    if (!data.WEBHOOK_SECRET_TOKEN) {
      throw new ConfigError("Invalid configuration", [
        "WEBHOOK_SECRET_TOKEN: required when BOT_MODE=webhook",
      ]);
    }
  }

  if (data.DEFAULT_PROVIDER === "openai" && !data.OPENAI_API_KEY) {
    throw new ConfigError("Invalid configuration", [
      "OPENAI_API_KEY: required when DEFAULT_PROVIDER=openai",
    ]);
  }
  if (data.DEFAULT_PROVIDER === "openrouter" && !data.OPENROUTER_API_KEY) {
    throw new ConfigError("Invalid configuration", [
      "OPENROUTER_API_KEY: required when DEFAULT_PROVIDER=openrouter",
    ]);
  }
  if (data.DEFAULT_PROVIDER === "opencode" && !data.OPENCODE_API_KEY) {
    throw new ConfigError("Invalid configuration", [
      "OPENCODE_API_KEY: required when DEFAULT_PROVIDER=opencode",
    ]);
  }

  return {
    telegramBotToken: data.TELEGRAM_BOT_TOKEN,
    ownerTelegramUserId: data.BOT_OWNER_TELEGRAM_USER_ID,
    defaultProvider: data.DEFAULT_PROVIDER,
    openaiApiKey: data.OPENAI_API_KEY,
    openaiModel: data.OPENAI_MODEL,
    openrouterApiKey: data.OPENROUTER_API_KEY,
    openrouterModel: data.OPENROUTER_MODEL,
    opencodeBaseUrl: data.OPENCODE_BASE_URL,
    opencodeApiKey: data.OPENCODE_API_KEY,
    opencodeModel: data.OPENCODE_MODEL,
    tavilyApiKey: data.TAVILY_API_KEY,
    systemPrompt: data.SYSTEM_PROMPT ?? data.DEFAULT_SYSTEM_PROMPT,
    mcpConfigPath: data.MCP_CONFIG_PATH,
    sqlitePath: data.SQLITE_PATH,
    defaultSearchMode: data.DEFAULT_SEARCH_MODE,
    botMode: data.BOT_MODE,
    port: data.PORT,
    publicWebhookUrl: data.PUBLIC_WEBHOOK_URL,
    webhookSecretToken: data.WEBHOOK_SECRET_TOKEN,
    logLevel: data.LOG_LEVEL,
  };
}

export interface RedactedConfigSummary {
  defaultProvider: ValidatedConfig["defaultProvider"];
  ownerTelegramUserId: ValidatedConfig["ownerTelegramUserId"];
  openaiConfigured: boolean;
  openaiModel: string;
  openrouterConfigured: boolean;
  openrouterModel: string | undefined;
  opencodeBaseUrl: string;
  opencodeConfigured: boolean;
  opencodeModel: string;
  tavilyConfigured: boolean;
  systemPrompt: string;
  mcpConfigPath: string;
  sqlitePath: string;
  defaultSearchMode: "auto" | "on" | "off";
  botMode: "longpoll" | "webhook";
  port: number;
  webhookSecretConfigured: boolean;
  logLevel: ValidatedConfig["logLevel"];
}

export function redactConfig(cfg: ValidatedConfig): RedactedConfigSummary {
  return {
    defaultProvider: cfg.defaultProvider,
    ownerTelegramUserId: cfg.ownerTelegramUserId,
    openaiConfigured: Boolean(cfg.openaiApiKey),
    openaiModel: cfg.openaiModel,
    openrouterConfigured: Boolean(cfg.openrouterApiKey),
    openrouterModel: cfg.openrouterModel,
    opencodeBaseUrl: cfg.opencodeBaseUrl,
    opencodeConfigured: Boolean(cfg.opencodeApiKey),
    opencodeModel: cfg.opencodeModel,
    tavilyConfigured: Boolean(cfg.tavilyApiKey),
    systemPrompt: cfg.systemPrompt,
    mcpConfigPath: cfg.mcpConfigPath,
    sqlitePath: cfg.sqlitePath,
    defaultSearchMode: cfg.defaultSearchMode,
    botMode: cfg.botMode,
    port: cfg.port,
    webhookSecretConfigured: Boolean(cfg.webhookSecretToken),
    logLevel: cfg.logLevel,
  };
}
