import "dotenv/config";
import { loadConfig, redactConfig } from "./config/index.js";
import { createLogger } from "./logging/index.js";
import { buildProviders } from "./providers/index.js";
import { TavilyClient, createSearchInjector } from "./search/index.js";
import { createSqliteHistoryStore } from "./history/index.js";
import { loadMcpConfig, createMcpServers } from "./mcp/index.js";
import { createBot, startBot } from "./bot/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  logger.info(redactConfig(config), "config loaded");
  const provider = buildProviders({ config, logger });
  const tavilyAvailable = Boolean(config.tavilyApiKey);
  const tavily =
    tavilyAvailable && config.tavilyApiKey
      ? new TavilyClient({ apiKey: config.tavilyApiKey, logger })
      : undefined;
  const search = createSearchInjector(tavily);
  const history = createSqliteHistoryStore({ path: config.sqlitePath });
  const mcpFile = loadMcpConfig(config.mcpConfigPath, logger);
  const mcp = await createMcpServers({ servers: mcpFile.servers, logger });
  const bot = createBot({ config, logger, provider, search, tavilyAvailable, history, mcp });
  const result = await startBot({ bot, config, logger });
  logger.info({ mode: result.mode }, "bot started");
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await result.stop();
    await mcp.closeAll();
    history.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
