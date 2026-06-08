import { describe, it, expect } from "vitest";
import { OpenCodeAdapter } from "../../src/providers/index.js";
import { pino } from "pino";

const SILENT_LOGGER = pino({ level: "silent" });

describe("OpenCodeAdapter", () => {
  it("reports the default model and provider name", () => {
    const adapter = new OpenCodeAdapter({
      baseUrl: "https://opencode.ai/zen/go/v1",
      apiKey: "test",
      model: "kimi-k2.6",
      logger: SILENT_LOGGER,
    });
    expect(adapter.getDefaultModel()).toBe("kimi-k2.6");
    expect(adapter.name).toBe("opencode");
  });
});
