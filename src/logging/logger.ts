import { pino, type Logger } from "pino";
import type { ValidatedConfig } from "../config/index.js";

export function createLogger(config: ValidatedConfig): Logger {
  return pino({
    level: config.logLevel,
    base: { service: "tg-agent-bot" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
