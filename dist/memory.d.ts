export interface MemorySnapshot {
    totalBytes: number;
    availableBytes: number;
    freeBytes: number;
    inactiveBytes: number;
    purgeableBytes: number;
    totalGb: number;
    availableGb: number;
}
/**
 * Reads detailed system memory stats, including macOS inactive and purgeable pages
 * which macOS readily releases for new process memory allocations.
 */
export declare function getDetailedMemorySnapshot(): MemorySnapshot;
/**
 * Safely releases inactive/unpinned cache memory in userland without disrupting running engines.
 * Forces garbage collection across internal buffers and triggers an allocation pulse
 * that prompts the macOS Virtual Memory subsystem to trim inactive file cache pages.
 */
export declare function freeSystemRam(): {
    before: MemorySnapshot;
    after: MemorySnapshot;
    freedMb: number;
};
/**
 * Checks if the system has sufficient memory budget for a target model size plus context buffer.
 * If deficit exists, returns warning and safe recommendation.
 */
export declare function checkMemoryReservation(modelSizeBytes: number, contextTokens?: number, quantization?: string): {
    sufficient: boolean;
    requiredGb: number;
    availableGb: number;
    deficitGb: number;
};
//# sourceMappingURL=memory.d.ts.map