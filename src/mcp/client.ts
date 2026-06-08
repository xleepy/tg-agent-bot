import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { Logger } from "pino";
import type { McpServerConfig } from "./config.js";

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: "text"; text: string } | { type: string; [k: string]: unknown }>;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpServerHandle {
  serverName: string;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult>;
  close(): Promise<void>;
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 30000;

class StdioMcpServer implements McpServerHandle {
  readonly serverName: string;
  private child: ChildProcess;
  private stdout: Readable;
  private stdin: Writable;
  private stderrBuf = "";
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private closed = false;
  private logger: Logger;
  private requestTimeoutMs: number;

  constructor(serverName: string, cfg: McpServerConfig, logger: Logger, requestTimeoutMs: number) {
    this.serverName = serverName;
    this.logger = logger;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = spawn(cfg.command, cfg.args, {
      env: { ...process.env, ...(cfg.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.stdin = this.child.stdin!;
    this.stdout = this.child.stdout!;
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBuf += chunk.toString("utf-8");
      if (this.stderrBuf.length > 4096) this.stderrBuf = this.stderrBuf.slice(-4096);
    });
    this.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.child.on("exit", (code, signal) => {
      this.closed = true;
      const err = new Error(`mcp server ${serverName} exited (code=${code}, signal=${signal})`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
    this.child.on("error", (err) => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  private onStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const prefix = this.buffer.toString("utf-8", 0, Math.min(this.buffer.length, 64));
      let body: string;
      if (/^Content-Length:/i.test(prefix)) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const header = this.buffer.slice(0, headerEnd).toString("utf-8");
        const m = /^Content-Length:\s*(\d+)/i.exec(header);
        if (!m || !m[1]) {
          this.logger.warn({ server: this.serverName, header }, "mcp: bad content-length header");
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }
        const len = Number(m[1]);
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + len) return;
        body = this.buffer.slice(bodyStart, bodyStart + len).toString("utf-8");
        this.buffer = this.buffer.slice(bodyStart + len);
      } else {
        const lineEnd = this.buffer.indexOf("\n");
        if (lineEnd === -1) return;
        body = this.buffer.slice(0, lineEnd).toString("utf-8").replace(/\r$/, "");
        this.buffer = this.buffer.slice(lineEnd + 1);
        if (body.trim().length === 0) continue;
      }
      let parsed: JsonRpcResponse;
      try {
        parsed = JSON.parse(body) as JsonRpcResponse;
      } catch (err) {
        this.logger.warn({ server: this.serverName, err, body }, "mcp: failed to parse frame");
        continue;
      }
      const handler = this.pending.get(parsed.id);
      if (handler) {
        this.pending.delete(parsed.id);
        if (parsed.error) {
          handler.reject(new Error(`mcp ${this.serverName}: ${parsed.error.message}`));
        } else {
          handler.resolve(parsed);
        }
      } else if (typeof parsed.id === "number") {
        this.logger.debug({ server: this.serverName, id: parsed.id }, "mcp: response without pending request");
      }
    }
  }

  private send(req: JsonRpcRequest | JsonRpcNotification): void {
    if (this.closed) throw new Error(`mcp ${this.serverName}: connection closed`);
    const body = JSON.stringify(req);
    this.stdin.write(`${body}\n`);
  }

  private notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
  }

  private request<T>(method: string, params?: unknown, signal?: AbortSignal): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      if (this.closed) {
        reject(new Error(`mcp ${this.serverName}: connection closed`));
        return;
      }
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      const pending = this.pending;
      const serverName = this.serverName;
      const requestTimeoutMs = this.requestTimeoutMs;
      function cleanup(): void {
        pending.delete(id);
        if (signal) signal.removeEventListener("abort", onAbort);
        clearTimeout(timeout);
      }
      const onAbort = () => {
        const handler = pending.get(id);
        if (handler) {
          cleanup();
          handler.reject(new Error("aborted"));
        }
      };
      pending.set(id, {
        resolve: (r) => {
          cleanup();
          resolve(r.result as T);
        },
        reject: (e) => {
          cleanup();
          reject(e);
        },
      });
      const timeout = setTimeout(() => {
        const handler = pending.get(id);
        if (handler) {
          cleanup();
          handler.reject(new Error(`mcp ${serverName}: ${method} timed out after ${requestTimeoutMs}ms`));
        }
      }, requestTimeoutMs);
      timeout.unref?.();
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      try {
        this.send({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
      } catch (err) {
        cleanup();
        reject(err as Error);
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "tg-agent-bot",
        version: "0.1.0",
      },
    });
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = await this.request<{ tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }>(
      "tools/list",
    );
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    const result = await this.request<{ content?: McpToolResult["content"]; isError?: boolean }>(
      "tools/call",
      { name, arguments: args },
      signal,
    );
    return {
      content: result.content ?? [],
      ...(result.isError ? { isError: result.isError } : {}),
    };
  }

  stderrTail(): string | undefined {
    const tail = this.stderrBuf.trim();
    return tail.length > 0 ? tail : undefined;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.stdin.end();
    } catch {
      this.logger.debug({ server: this.serverName }, "mcp: stdin.end threw during close");
    }
    await new Promise<void>((resolve) => {
      if (!this.child || this.child.exitCode !== null) {
        resolve();
        return;
      }
      this.child.once("exit", () => resolve());
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill("SIGKILL");
        resolve();
      }, 1000);
    });
  }
}

export interface CreateMcpServersOptions {
  servers: Record<string, McpServerConfig>;
  logger: Logger;
  requestTimeoutMs?: number;
}

export interface McpServerWithTools extends McpServerHandle {
  cachedTools: McpToolDescriptor[];
}

export interface McpRegistry {
  servers: McpServerWithTools[];
  closeAll(): Promise<void>;
}

export async function createMcpServers(opts: CreateMcpServersOptions): Promise<McpRegistry> {
  const entries = Object.entries(opts.servers);
  const servers: McpServerWithTools[] = [];
  const requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS;
  for (const [name, cfg] of entries) {
    let handle: StdioMcpServer;
    try {
      handle = new StdioMcpServer(name, cfg, opts.logger, requestTimeoutMs);
    } catch (err) {
      opts.logger.error({ err, server: name }, "mcp: failed to spawn server");
      continue;
    }
    try {
      await handle.initialize();
    } catch (err) {
      opts.logger.warn({ err, server: name, stderr: handle.stderrTail() }, "mcp: initialize failed; skipping server");
      await handle.close().catch(() => undefined);
      continue;
    }
    let cachedTools: McpToolDescriptor[] = [];
    try {
      cachedTools = await handle.listTools();
    } catch (err) {
      opts.logger.warn({ err, server: name, stderr: handle.stderrTail() }, "mcp: tools/list failed; skipping server");
      await handle.close().catch(() => undefined);
      continue;
    }
    servers.push(Object.assign(handle, { cachedTools }));
    opts.logger.info({ server: name, toolCount: cachedTools.length }, "mcp server ready");
  }
  return {
    servers,
    closeAll: async () => {
      for (const s of servers) {
        await s.close().catch(() => undefined);
      }
    },
  };
}
