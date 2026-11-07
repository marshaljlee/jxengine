import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ModelDescriptor } from "./gguf.js";
import { EngineRuntimeOptions } from "./runtime.js";

/**
 * Universal App Update Survival & Lifeboat Manifest Engine.
 *
 * When a host app (e.g. JXStack.app, bb.app, Electron container) performs an auto-update:
 * 1. The old app bundle is replaced or relaunched.
 * 2. This module persists active model bindings, search directories, and port locks
 *    in an un-wiped user data anchor (~/.jxengine/lifeboat.json or custom app support path).
 * 3. During app update handoff, a graceful drain and instant resurrect protocol
 *    ensures model sessions and API routing survive seamlessly across versions.
 */

export interface LifeboatManifest {
  manifestVersion: number;
  appName?: string;
  appVersion?: string;
  previousAppVersion?: string;
  engineVersion: string;
  survivedUpdatesCount: number;
  lastHandoffTimestamp: number;
  activeModel?: {
    id: string;
    path: string;
    format: "gguf" | "mlx";
    port: number;
    options: EngineRuntimeOptions;
  };
  persistentModelDirs: string[];
  pinnedModels: string[];
  clientEndpointPort: number;
}

const DEFAULT_LIFEBOAT_DIR = join(homedir(), ".jxengine");
const DEFAULT_LIFEBOAT_FILE = join(DEFAULT_LIFEBOAT_DIR, "lifeboat.json");

export class UpdateSurvivalManager {
  private filePath: string;

  constructor(customStorageDir?: string) {
    const dir = customStorageDir || DEFAULT_LIFEBOAT_DIR;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.filePath = join(dir, "lifeboat.json");
  }

  /**
   * Prepares the lifeboat manifest before the host app initiates an update.
   */
  prepareUpdateHandoff(
    appName: string,
    currentVersion: string,
    activeModel?: {
      descriptor: ModelDescriptor;
      port: number;
      options: EngineRuntimeOptions;
    },
    gatewayPort = 8080,
    modelDirs: string[] = []
  ): LifeboatManifest {
    const existing = this.loadManifest();
    const manifest: LifeboatManifest = {
      manifestVersion: 1,
      appName,
      appVersion: currentVersion,
      previousAppVersion: existing?.appVersion,
      engineVersion: "1.0.0",
      survivedUpdatesCount: (existing?.survivedUpdatesCount || 0) + 1,
      lastHandoffTimestamp: Date.now(),
      activeModel: activeModel
        ? {
            id: activeModel.descriptor.id,
            path: activeModel.descriptor.path,
            format: activeModel.descriptor.format,
            port: activeModel.port,
            options: activeModel.options,
          }
        : undefined,
      persistentModelDirs: Array.from(new Set([...(existing?.persistentModelDirs || []), ...modelDirs])),
      pinnedModels: existing?.pinnedModels || [],
      clientEndpointPort: gatewayPort,
    };

    writeFileSync(this.filePath, JSON.stringify(manifest, null, 2), "utf8");
    return manifest;
  }

  /**
   * Loads the surviving lifeboat manifest after the new app version starts up.
   */
  loadManifest(): LifeboatManifest | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8"));
    } catch {
      return null;
    }
  }

  /**
   * Checks if an update survival event occurred between host app launches.
   */
  hasPendingResurrection(newAppVersion?: string): boolean {
    const manifest = this.loadManifest();
    if (!manifest) return false;
    if (newAppVersion && manifest.appVersion !== newAppVersion) {
      return true;
    }
    // If written within last 5 minutes during handoff
    return Date.now() - manifest.lastHandoffTimestamp < 300000;
  }

  /**
   * Acknowledges resurrection and marks state active under the new app version.
   */
  acknowledgeResurrection(newAppVersion: string): void {
    const manifest = this.loadManifest();
    if (manifest) {
      manifest.previousAppVersion = manifest.appVersion;
      manifest.appVersion = newAppVersion;
      manifest.lastHandoffTimestamp = Date.now();
      writeFileSync(this.filePath, JSON.stringify(manifest, null, 2), "utf8");
    }
  }

  /**
   * Clears lifeboat manifest on clean intentional app uninstall.
   */
  clearLifeboat(): void {
    try {
      if (existsSync(this.filePath)) {
        writeFileSync(this.filePath, JSON.stringify({ manifestVersion: 1, clearedAt: Date.now() }), "utf8");
      }
    } catch {}
  }
}

