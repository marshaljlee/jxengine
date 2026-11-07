import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface JXEngineSettings {
  modelDirs: string[];
  activeModelId?: string;
  defaultPort: number;
}

const CONFIG_DIR = join(homedir(), ".jxengine");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function loadSettings(): JXEngineSettings {
  if (!existsSync(CONFIG_FILE)) {
    const defaultSettings: JXEngineSettings = {
      modelDirs: [
        join(homedir(), ".ollama", "models"),
        join(homedir(), "Models"),
        join(homedir(), "Downloads"),
        "/Volumes/Hermes/models",
      ],
      defaultPort: 8080,
    };
    saveSettings(defaultSettings);
    return defaultSettings;
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {
      modelDirs: [],
      defaultPort: 8080,
    };
  }
}

export function saveSettings(settings: JXEngineSettings): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save jxengine settings:", err);
  }
}

export function addModelDirectory(dir: string): string[] {
  const settings = loadSettings();
  if (!settings.modelDirs.includes(dir)) {
    settings.modelDirs.push(dir);
    saveSettings(settings);
  }
  return settings.modelDirs;
}

export function removeModelDirectory(dir: string): string[] {
  const settings = loadSettings();
  settings.modelDirs = settings.modelDirs.filter((d) => d !== dir);
  saveSettings(settings);
  return settings.modelDirs;
}

