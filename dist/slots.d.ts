/**
 * Slot Management & Client Disconnect Cancellation for llama-server.
 * Automatically halts background GPU/CPU computation when an agent cancels a request.
 */
export interface ActiveSlot {
    slotId: number;
    enginePort: number;
    startedAt: number;
}
export declare class SlotManager {
    /**
     * Sends an abort request to llama-server to stop an active generation slot immediately.
     */
    static abortSlot(enginePort: number, slotId?: number): Promise<boolean>;
    /**
     * Binds an HTTP request lifecycle to an engine slot, aborting upstream generation if client aborts.
     */
    static bindDisconnect(req: {
        on: (event: string, cb: () => void) => void;
    }, enginePort: number, slotId?: number): () => void;
}
//# sourceMappingURL=slots.d.ts.map