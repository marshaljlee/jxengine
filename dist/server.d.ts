import { ModelRuntimeOrchestrator } from "./runtime.js";
export interface GatewayConfig {
    port: number;
    host?: string;
    modelDirs?: string[];
    orchestrator: ModelRuntimeOrchestrator;
    defaultModelId?: string;
}
export declare class UniversalGateway {
    private config;
    private server?;
    private billionContext;
    constructor(config: GatewayConfig);
    private getModelDirs;
    start(): Promise<number>;
    private readJsonBody;
    stop(): void;
}
//# sourceMappingURL=server.d.ts.map