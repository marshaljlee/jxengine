import { ModelDescriptor } from "./gguf.js";
import { EngineRuntimeOptions } from "./runtime.js";
export interface SystemHardwareProfile {
    totalMemoryBytes: number;
    totalMemoryGb: number;
    cpuCores: number;
    isAppleSilicon: boolean;
}
export declare function detectSystemHardware(): SystemHardwareProfile;
export declare function autoConfigureModel(model: ModelDescriptor, hw?: SystemHardwareProfile, userOverrides?: Partial<EngineRuntimeOptions>): EngineRuntimeOptions;
//# sourceMappingURL=autoconfig.d.ts.map