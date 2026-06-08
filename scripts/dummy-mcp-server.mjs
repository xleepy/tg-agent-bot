const tools = [
  {
    name: "dummy_echo",
    description: "Echoes the provided value and proves local MCP wiring is active.",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
    },
  },
];

let buffer = "";

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function handle(message) {
  if (message.method === "initialize") {
    result(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "tg-agent-bot-dummy", version: "0.1.0" },
    });
    return;
  }
  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "tools/list") {
    result(message.id, { tools });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (name !== "dummy_echo") {
      error(message.id, -32602, `unknown tool: ${name}`);
      return;
    }
    result(message.id, {
      content: [
        {
          type: "text",
          text: `dummy_echo received: ${JSON.stringify(args)}`,
        },
      ],
    });
    return;
  }
  if (message.id !== undefined) {
    error(message.id, -32601, `method not found: ${message.method}`);
  }
}

process.stderr.write("dummy MCP server ready\n");

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const lineEnd = buffer.indexOf("\n");
    if (lineEnd === -1) return;
    const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
    buffer = buffer.slice(lineEnd + 1);
    if (line.trim().length === 0) continue;
    try {
      handle(JSON.parse(line));
    } catch (err) {
      process.stderr.write(`dummy MCP parse error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
});
