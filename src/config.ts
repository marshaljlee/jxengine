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

export function getDefaultModelDirs(): string[] {
  const dirs: string[] = [
    join(homedir(), ".ollama", "models"),
    join(homedir(), ".cache", "lm-studio", "models"),
    join(homedir(), "Models"),
    join(homedir(), "Downloads"),
    join(homedir(), "Library", "Application Support", "JXEngine", "models"),
  ];

  if (process.env.JXENGINE_MODELS_PATH) {
    const customPaths = process.env.JXENGINE_MODELS_PATH.split(":").map((p) => p.trim()).filter(Boolean);
    dirs.unshift(...customPaths);
  }

  // Include Hermes volume only if currently mounted
  if (existsSync("/Volumes/Hermes/models")) {
    dirs.push("/Volumes/Hermes/models");
  }

  // Keep unique existing paths or standard directories
  return Array.from(new Set(dirs));
}

export function loadSettings(): JXEngineSettings {
  if (!existsSync(CONFIG_FILE)) {
    const defaultSettings: JXEngineSettings = {
      modelDirs: getDefaultModelDirs(),
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

