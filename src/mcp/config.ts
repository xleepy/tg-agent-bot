import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import type { Logger } from "pino";

const mcpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
});

const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
});

export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;

export interface LoadedMcpConfig {
  servers: Record<string, McpServerConfig>;
  source: "file" | "default";
}

export function loadMcpConfig(path: string, logger: Logger): LoadedMcpConfig {
  if (!existsSync(path)) {
    logger.info({ path }, "mcp.json not found; starting with zero MCP servers");
    return { servers: {}, source: "default" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`failed to parse mcp.json at ${path}: ${(err as Error).message}`);
  }
  const parsed = mcpConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid mcp.json at ${path}: ${issues}`);
  }
  const count = Object.keys(parsed.data.mcpServers).length;
  logger.info({ path, count }, "mcp.json loaded");
  return { servers: parsed.data.mcpServers, source: "file" };
}
