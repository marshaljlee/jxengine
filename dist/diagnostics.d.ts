import { ModelDescriptor } from "./gguf.js";
import { SystemHardwareProfile } from "./autoconfig.js";
/**
 * Vault Rule 16: Pre-Flight Diagnostics Engine
 * Checks system hardware, memory allocations, binaries, and model sidecars
 * before execution, reporting concrete diagnostics and health status.
 */
export interface PreflightDiagnosticResult {
    ok: boolean;
    hardware: SystemHardwareProfile;
    llamaServerBinary: string | null;
    kapitsaBinary: string | null;
    memoryAssessment: {
        totalGb: number;
        recommendedMaxModelGb: number;
        fitsUnifiedMemory: boolean;
    };
    warnings: string[];
    errors: string[];
}
export declare function runPreflightDiagnostics(model?: ModelDescriptor, llamaServerPath?: string): PreflightDiagnosticResult;
//# sourceMappingURL=diagnostics.d.ts.map