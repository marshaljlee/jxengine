export declare const GGUF_MAGIC = "GGUF";
export declare const MAX_METADATA_BYTES: number;
export declare const MAX_DIRECTORY_ENTRIES = 20000;
export declare const MMPROJ_PATTERN: RegExp;
export declare const IMATRIX_PATTERN: RegExp;
export interface GgufMetadata {
    magic: string;
    version: number;
    tensorCount: number;
    metadataKvCount: number;
    fields: Record<string, any>;
}
export interface ModelDescriptor {
    id: string;
    fileName: string;
    path: string;
    sizeBytes: number;
    format: "gguf" | "mlx";
    architecture?: string;
    contextLength?: number;
    quantization?: string;
    chatTemplate?: string;
    hasChatTemplate?: boolean;
    inferredTemplate?: string;
    projector?: string | null;
    imatrix?: string | null;
    modifiedAt: number;
}
export declare function inferTemplate(name: string): string | undefined;
export declare function readGgufMetadata(filePath: string): Promise<GgufMetadata>;
export declare function findMatchingSidecar(modelPath: string, dirFiles: string[], pattern: RegExp): string | null;
export declare function describeGgufModel(filePath: string): Promise<ModelDescriptor>;
export declare function scanDirectoriesForModels(dirs: string[], maxDepth?: number): Promise<ModelDescriptor[]>;
//# sourceMappingURL=gguf.d.ts.map