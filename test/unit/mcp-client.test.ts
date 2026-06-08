import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pino } from "pino";
import { createMcpServers, loadMcpConfig } from "../../src/mcp/index.js";

const SILENT = pino({ level: "silent" });

let dir = "";

function setup(): string {
  dir = mkdtempSync(join(tmpdir(), "tgbot-mcp-client-"));
  return dir;
}

function teardown(): void {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function writeFakeMcpServer(path: string, responseFormat: "jsonl" | "content-length" = "jsonl"): void {
  writeFileSync(
    path,
    `
let buffer = "";
let initialized = false;
const responseFormat = ${JSON.stringify(responseFormat)};

function send(message) {
  const body = JSON.stringify(message);
  if (responseFormat === "content-length") {
    process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body);
  } else {
    process.stdout.write(body + "\\n");
  }
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, message) {
  send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
}

function handle(message) {
  if (message.method === "initialize") {
    sendResult(message.id, {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "fake", version: "1.0.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    initialized = true;
    return;
  }
  if (message.method === "tools/list") {
    if (!initialized) {
      sendError(message.id, "not initialized");
      return;
    }
    sendResult(message.id, {
      tools: [
        {
          name: "echo",
          description: "Echo args",
          inputSchema: { type: "object", properties: { value: { type: "string" } } },
        },
      ],
    });
    return;
  }
  if (message.method === "tools/call") {
    sendResult(message.id, {
      content: [{ type: "text", text: JSON.stringify(message.params.arguments) }],
    });
    return;
  }
  sendError(message.id, "method not found");
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const lineEnd = buffer.indexOf("\\n");
    if (lineEnd === -1) return;
    const line = buffer.slice(0, lineEnd).replace(/\\r$/, "");
    buffer = buffer.slice(lineEnd + 1);
    if (line.trim().length === 0) continue;
    handle(JSON.parse(line));
  }
});
`,
  );
}

describe("createMcpServers", () => {
  beforeEach(() => {
    setup();
  });

  afterEach(() => {
    teardown();
  });

  it("initializes stdio MCP servers before listing tools", async () => {
    const serverPath = join(dir, "fake-mcp-server.cjs");
    writeFakeMcpServer(serverPath);
    let registry: Awaited<ReturnType<typeof createMcpServers>> | undefined;
    try {
      registry = await createMcpServers({
        servers: { fake: { command: process.execPath, args: [serverPath] } },
        logger: SILENT,
        requestTimeoutMs: 500,
      });
      expect(registry.servers).toHaveLength(1);
      const server = registry.servers[0];
      expect(server?.cachedTools).toEqual([
        {
          name: "echo",
          description: "Echo args",
          inputSchema: { type: "object", properties: { value: { type: "string" } } },
        },
      ]);
      const result = await server?.callTool("echo", { value: "ok" });
      expect(result?.content).toEqual([{ type: "text", text: '{"value":"ok"}' }]);
    } finally {
      await registry?.closeAll();
    }
  });

  it("parses content-length MCP responses", async () => {
    const serverPath = join(dir, "fake-content-length-mcp-server.cjs");
    writeFakeMcpServer(serverPath, "content-length");
    let registry: Awaited<ReturnType<typeof createMcpServers>> | undefined;
    try {
      registry = await createMcpServers({
        servers: { fake: { command: process.execPath, args: [serverPath] } },
        logger: SILENT,
        requestTimeoutMs: 500,
      });
      expect(registry.servers).toHaveLength(1);
      expect(registry.servers[0]?.cachedTools.map((tool) => tool.name)).toEqual(["echo"]);
    } finally {
      await registry?.closeAll();
    }
  });

  it("loads the checked-in dummy MCP server from mcp.json", async () => {
    let registry: Awaited<ReturnType<typeof createMcpServers>> | undefined;
    try {
      const loaded = loadMcpConfig("./mcp.json", SILENT);
      registry = await createMcpServers({
        servers: loaded.servers,
        logger: SILENT,
        requestTimeoutMs: 500,
      });
      expect(registry.servers).toHaveLength(1);
      const server = registry.servers[0];
      expect(server?.serverName).toBe("dummy");
      expect(server?.cachedTools.map((tool) => tool.name)).toEqual(["dummy_echo"]);
      const result = await server?.callTool("dummy_echo", { value: "ok" });
      expect(result?.content).toEqual([{ type: "text", text: 'dummy_echo received: {"value":"ok"}' }]);
    } finally {
      await registry?.closeAll();
    }
  });

  it("skips MCP servers that do not answer initialization", async () => {
    const serverPath = join(dir, "hung-mcp-server.cjs");
    writeFileSync(serverPath, "process.stdin.resume();\n");
    let registry: Awaited<ReturnType<typeof createMcpServers>> | undefined;
    try {
      const startedAt = Date.now();
      registry = await createMcpServers({
        servers: { hung: { command: process.execPath, args: [serverPath] } },
        logger: SILENT,
        requestTimeoutMs: 100,
      });
      expect(Date.now() - startedAt).toBeLessThan(1000);
      expect(registry.servers).toEqual([]);
    } finally {
      await registry?.closeAll();
    }
  });
});
