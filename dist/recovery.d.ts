export interface EngineSessionState {
    activeModelId?: string;
    activeModelPath?: string;
    activePort?: number;
    nCtx?: number;
    nGPULayers?: number;
    lastActiveTimestamp: number;
}
export declare function saveSessionState(state: Partial<EngineSessionState>): void;
export declare function loadSessionState(): EngineSessionState | null;
export declare function clearSessionState(): void;
//# sourceMappingURL=recovery.d.ts.map