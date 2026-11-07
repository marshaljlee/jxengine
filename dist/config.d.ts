export interface JXEngineSettings {
    modelDirs: string[];
    activeModelId?: string;
    defaultPort: number;
}
export declare function loadSettings(): JXEngineSettings;
export declare function saveSettings(settings: JXEngineSettings): void;
export declare function addModelDirectory(dir: string): string[];
export declare function removeModelDirectory(dir: string): string[];
//# sourceMappingURL=config.d.ts.map