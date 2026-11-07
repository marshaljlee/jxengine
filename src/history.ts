import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

export interface HistoryTurn {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  model?: string;
}

export interface ConversationHistorySession {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  turns: HistoryTurn[];
}

function getHistoryDir(): string {
  const dir = join(os.homedir(), ".jxengine", "history");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSessionFile(sessionId = "default"): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getHistoryDir(), `${safeId}.json`);
}

/**
 * Appends turns to persistent conversation history.
 */
export function recordHistoryTurns(sessionId = "default", newTurns: Array<{ role: string; content: string; model?: string }>): void {
  const file = getSessionFile(sessionId);
  let session: ConversationHistorySession;

  if (existsSync(file)) {
    try {
      session = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      session = { sessionId, createdAt: Date.now(), updatedAt: Date.now(), turns: [] };
    }
  } else {
    session = { sessionId, createdAt: Date.now(), updatedAt: Date.now(), turns: [] };
  }

  const now = Date.now();
  session.updatedAt = now;

  for (const t of newTurns) {
    session.turns.push({
      id: `turn_${now}_${Math.floor(Math.random() * 1000)}`,
      role: t.role as any,
      content: typeof t.content === "string" ? t.content : JSON.stringify(t.content),
      timestamp: now,
      model: t.model,
    });
  }

  try {
    writeFileSync(file, JSON.stringify(session, null, 2), "utf8");
  } catch {}
}

/**
 * Loads history for a given session.
 */
export function loadHistorySession(sessionId = "default"): ConversationHistorySession | null {
  const file = getSessionFile(sessionId);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Exports history in JSON or clean plain text format.
 */
export function exportHistoryFormatted(sessionId = "default", format: "json" | "txt" = "json"): string {
  const session = loadHistorySession(sessionId);
  if (!session) return format === "json" ? "{}" : "No history recorded.";

  if (format === "json") {
    return JSON.stringify(session, null, 2);
  }

  return session.turns
    .map((t) => `[${new Date(t.timestamp).toISOString()}] ${t.role.toUpperCase()}:\n${t.content}`)
    .join("\n\n---\n\n");
}
