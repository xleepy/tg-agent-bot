import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type HistoryRole = "user" | "assistant";

export interface HistoryMessage {
  role: HistoryRole;
  content: string;
  createdAt: number;
}

export interface HistoryStore {
  append(chatId: number, message: HistoryMessage): void;
  recent(chatId: number, limit: number): HistoryMessage[];
  clear(chatId: number): void;
  close(): void;
}

export interface SqliteHistoryStoreOptions {
  path: string;
  retention?: number;
}

export function createSqliteHistoryStore(opts: SqliteHistoryStoreOptions): HistoryStore {
  const { path } = opts;
  const retention = opts.retention ?? 20;
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_chat_id_id ON history (chat_id, id);
  `);

  const insertStmt = db.prepare(
    "INSERT INTO history (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)",
  );
  const recentStmt = db.prepare(
    "SELECT role, content, created_at FROM history WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
  );
  const clearStmt = db.prepare("DELETE FROM history WHERE chat_id = ?");
  const pruneStmt = db.prepare(`
    DELETE FROM history
    WHERE chat_id = ? AND id NOT IN (
      SELECT id FROM history WHERE chat_id = ? ORDER BY id DESC LIMIT ?
    )
  `);

  const insertMany = db.transaction((chatId: number, messages: HistoryMessage[]) => {
    for (const m of messages) {
      insertStmt.run(chatId, m.role, m.content, m.createdAt);
    }
    pruneStmt.run(chatId, chatId, retention);
  });

  return {
    append(chatId, message) {
      insertMany(chatId, [message]);
    },
    recent(chatId, limit) {
      const rows = recentStmt.all(chatId, limit) as Array<{
        role: string;
        content: string;
        created_at: number;
      }>;
      return rows.reverse().map((r) => ({
        role: r.role as HistoryRole,
        content: r.content,
        createdAt: r.created_at,
      }));
    },
    clear(chatId) {
      clearStmt.run(chatId);
    },
    close() {
      db.close();
    },
  };
}
