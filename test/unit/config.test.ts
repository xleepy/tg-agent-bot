import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../../src/config/index.js";

const BASE_ENV: NodeJS.ProcessEnv = {
  TELEGRAM_BOT_TOKEN: "tkn",
  BOT_OWNER_TELEGRAM_USER_ID: "12345",
  DEFAULT_PROVIDER: "openai",
  OPENAI_API_KEY: "ok",
  OPENAI_MODEL: "gpt-4o",
};

describe("loadConfig", () => {
  it("accepts a valid config", () => {
    const cfg = loadConfig({ ...BASE_ENV });
    expect(cfg.ownerTelegramUserId).toBe(12345);
    expect(cfg.defaultProvider).toBe("openai");
  });

  it("rejects when BOT_OWNER_TELEGRAM_USER_ID is missing", () => {
    const env = { ...BASE_ENV };
    delete env.BOT_OWNER_TELEGRAM_USER_ID;
    try {
      loadConfig(env);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
    }
  });

  it("rejects empty", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "" })).toThrow(ConfigError);
  });

  it("rejects whitespace", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "  " })).toThrow(ConfigError);
  });

  it("rejects non-numeric", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "abc" })).toThrow(ConfigError);
  });

  it("rejects negative", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "-1" })).toThrow(ConfigError);
  });

  it("rejects zero", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "0" })).toThrow(ConfigError);
  });

  it("rejects float", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "1.5" })).toThrow(ConfigError);
  });

  it("rejects leading +", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "+1" })).toThrow(ConfigError);
  });

  it("rejects values > 10^10", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_OWNER_TELEGRAM_USER_ID: "10000000001" })).toThrow(ConfigError);
  });

  it("requires webhook secret and public url in webhook mode", () => {
    expect(() => loadConfig({ ...BASE_ENV, BOT_MODE: "webhook" })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ...BASE_ENV, BOT_MODE: "webhook", PUBLIC_WEBHOOK_URL: "https://example.com" }),
    ).toThrow(ConfigError);
  });

  it("errors when openai provider selected without a key", () => {
    const env = { ...BASE_ENV };
    delete env.OPENAI_API_KEY;
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it("requires openrouter key when provider is openrouter", () => {
    expect(() =>
      loadConfig({ ...BASE_ENV, DEFAULT_PROVIDER: "openrouter" }),
    ).toThrow(ConfigError);
  });

  it("requires opencode provider/model ids when provider is opencode", () => {
    expect(() =>
      loadConfig({ ...BASE_ENV, DEFAULT_PROVIDER: "opencode" }),
    ).toThrow(ConfigError);
  });
});
