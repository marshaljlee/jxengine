import { ModelDescriptor } from "./gguf.js";
export interface MlxModelDescriptor extends ModelDescriptor {
    format: "mlx";
    mlxVariant?: string;
    isKapitsaCatalog?: boolean;
}
export declare function detectKapitsaBinary(): string | null;
export declare function listKapitsaModels(): MlxModelDescriptor[];
export declare function scanMlxDirectories(dirs: string[], maxDepth?: number): MlxModelDescriptor[];
//# sourceMappingURL=mlx.d.ts.map