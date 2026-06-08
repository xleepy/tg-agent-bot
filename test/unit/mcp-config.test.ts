import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMcpConfig } from "../../src/mcp/index.js";
import { pino } from "pino";

const SILENT = pino({ level: "silent" });

let dir: string;

function setup(): string {
  dir = mkdtempSync(join(tmpdir(), "tgbot-mcp-"));
  return dir;
}

function teardown(): void {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

describe("loadMcpConfig", () => {
  it("returns empty servers when file does not exist", () => {
    setup();
    try {
      const result = loadMcpConfig(join(dir, "missing.json"), SILENT);
      expect(result.servers).toEqual({});
      expect(result.source).toBe("default");
    } finally {
      teardown();
    }
  });

  it("parses a valid mcp.json", () => {
    setup();
    try {
      const path = join(dir, "mcp.json");
      writeFileSync(
        path,
        JSON.stringify({
          mcpServers: {
            filesystem: {
              command: "node",
              args: ["server.js"],
              env: { HOME: "/tmp" },
            },
          },
        }),
      );
      const result = loadMcpConfig(path, SILENT);
      const fs = result.servers.filesystem;
      expect(fs?.command).toBe("node");
      expect(fs?.args).toEqual(["server.js"]);
      expect(fs?.env).toEqual({ HOME: "/tmp" });
      expect(result.source).toBe("file");
    } finally {
      teardown();
    }
  });

  it("defaults args to [] when omitted", () => {
    setup();
    try {
      const path = join(dir, "mcp.json");
      writeFileSync(path, JSON.stringify({ mcpServers: { srv: { command: "node" } } }));
      const result = loadMcpConfig(path, SILENT);
      expect(result.servers.srv?.args).toEqual([]);
    } finally {
      teardown();
    }
  });

  it("throws on invalid JSON", () => {
    setup();
    try {
      const path = join(dir, "mcp.json");
      writeFileSync(path, "not json");
      expect(() => loadMcpConfig(path, SILENT)).toThrow(/parse/);
    } finally {
      teardown();
    }
  });

  it("throws on schema mismatch", () => {
    setup();
    try {
      const path = join(dir, "mcp.json");
      writeFileSync(
        path,
        JSON.stringify({ mcpServers: { srv: { command: 123 } } }),
      );
      expect(() => loadMcpConfig(path, SILENT)).toThrow(/invalid/);
    } finally {
      teardown();
    }
  });
});

describe("createMcpServers with an empty config", () => {
  it("returns zero servers", async () => {
    setup();
    try {
      const { createMcpServers } = await import("../../src/mcp/index.js");
      const registry = await createMcpServers({ servers: {}, logger: SILENT });
      expect(registry.servers).toEqual([]);
      await registry.closeAll();
    } finally {
      teardown();
    }
  });
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual };
});
