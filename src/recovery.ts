import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Vault Rule 40: Auto-Resume & Crash Recovery State Engine
 * Persists active model and runtime parameters to disk.
 * Allows instant resume across crashes or server restarts.
 */

const DATA_DIR = join(homedir(), ".jxengine");
const SESSION_FILE = join(DATA_DIR, "session.json");

export interface EngineSessionState {
  activeModelId?: string;
  activeModelPath?: string;
  activePort?: number;
  nCtx?: number;
  nGPULayers?: number;
  lastActiveTimestamp: number;
}

export function saveSessionState(state: Partial<EngineSessionState>): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    const current = loadSessionState() || { lastActiveTimestamp: Date.now() };
    const updated: EngineSessionState = {
      ...current,
      ...state,
      lastActiveTimestamp: Date.now(),
    };
    writeFileSync(SESSION_FILE, JSON.stringify(updated, null, 2), "utf8");
  } catch {}
}

export function loadSessionState(): EngineSessionState | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function clearSessionState(): void {
  try {
    if (existsSync(SESSION_FILE)) {
      writeFileSync(SESSION_FILE, JSON.stringify({ lastActiveTimestamp: Date.now() }), "utf8");
    }
  } catch {}
}

