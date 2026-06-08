import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteHistoryStore } from "../../src/history/index.js";

let dir: string;
let storePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tgbot-history-"));
  storePath = join(dir, "history.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createSqliteHistoryStore", () => {
  it("appends and reads back messages in order", () => {
    const store = createSqliteHistoryStore({ path: storePath });
    store.append(1, { role: "user", content: "hi", createdAt: 1 });
    store.append(1, { role: "assistant", content: "hello", createdAt: 2 });
    const recent = store.recent(1, 10);
    expect(recent.map((m) => [m.role, m.content])).toEqual([
      ["user", "hi"],
      ["assistant", "hello"],
    ]);
    store.close();
  });

  it("keeps chats isolated by id", () => {
    const store = createSqliteHistoryStore({ path: storePath });
    store.append(1, { role: "user", content: "chat 1", createdAt: 1 });
    store.append(2, { role: "user", content: "chat 2", createdAt: 1 });
    expect(store.recent(1, 10).map((m) => m.content)).toEqual(["chat 1"]);
    expect(store.recent(2, 10).map((m) => m.content)).toEqual(["chat 2"]);
    store.close();
  });

  it("prunes to retention after each append", () => {
    const store = createSqliteHistoryStore({ path: storePath, retention: 3 });
    for (let i = 1; i <= 5; i++) {
      store.append(1, { role: "user", content: `m${i}`, createdAt: i });
    }
    const recent = store.recent(1, 100);
    expect(recent.map((m) => m.content)).toEqual(["m3", "m4", "m5"]);
    store.close();
  });

  it("clear() removes all messages for a chat but not others", () => {
    const store = createSqliteHistoryStore({ path: storePath });
    store.append(1, { role: "user", content: "a", createdAt: 1 });
    store.append(2, { role: "user", content: "b", createdAt: 1 });
    store.clear(1);
    expect(store.recent(1, 10)).toEqual([]);
    expect(store.recent(2, 10).map((m) => m.content)).toEqual(["b"]);
    store.close();
  });

  it("recent() respects the limit and returns oldest-first", () => {
    const store = createSqliteHistoryStore({ path: storePath });
    for (let i = 1; i <= 5; i++) {
      store.append(1, { role: "user", content: `m${i}`, createdAt: i });
    }
    const last2 = store.recent(1, 2);
    expect(last2.map((m) => m.content)).toEqual(["m4", "m5"]);
    store.close();
  });
});
