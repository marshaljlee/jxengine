import { ModelRuntimeOrchestrator } from "./runtime.js";
export interface BridgeContext {
    modelDirs: string[];
    orchestrator: ModelRuntimeOrchestrator;
}
export declare function startStdioBridge(ctx: BridgeContext): void;
//# sourceMappingURL=bridge.d.ts.map