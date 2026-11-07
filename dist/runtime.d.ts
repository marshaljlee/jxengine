import { ChildProcess } from "node:child_process";
import { ModelDescriptor } from "./gguf.js";
export interface EngineRuntimeOptions {
    port?: number;
    nCtx?: number;
    nBatch?: number;
    nUBatch?: number;
    nGPULayers?: number;
    flashAttn?: boolean;
    threads?: number;
    keepAliveMs?: number;
    llamaServerPath?: string;
}
export interface RunningModelInstance {
    id: string;
    model: ModelDescriptor;
    port: number;
    pid: number | null;
    process?: ChildProcess;
    startedAt: number;
    lastUsedAt: number;
    backend: "llama-server" | "kapitsa";
}
export declare function findFreePort(): Promise<number>;
export declare function waitPortReady(port: number, timeoutMs?: number): Promise<boolean>;
export declare class ModelRuntimeOrchestrator {
    private activeInstances;
    launchModel(model: ModelDescriptor, opts?: EngineRuntimeOptions): Promise<RunningModelInstance>;
    private launchLlamaServer;
    private launchKapitsa;
    unloadModel(id: string): Promise<boolean>;
    listRunning(): RunningModelInstance[];
}
//# sourceMappingURL=runtime.d.ts.map