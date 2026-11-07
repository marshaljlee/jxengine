/**
 * Slot Management & Client Disconnect Cancellation for llama-server.
 * Automatically halts background GPU/CPU computation when an agent cancels a request.
 */
export class SlotManager {
    /**
     * Sends an abort request to llama-server to stop an active generation slot immediately.
     */
    static async abortSlot(enginePort, slotId = 0) {
        try {
            const res = await fetch(`http://127.0.0.1:${enginePort}/slots/${slotId}?action=abort`, {
                method: "POST",
                signal: AbortSignal.timeout(2000),
            });
            return res.ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Discovers active processing slots on llama-server and aborts all non-idle slots.
     */
    static async abortAllActiveSlots(enginePort) {
        try {
            const res = await fetch(`http://127.0.0.1:${enginePort}/slots`, {
                signal: AbortSignal.timeout(2000),
            });
            if (!res.ok) {
                // Fall back to aborting slot 0
                await SlotManager.abortSlot(enginePort, 0);
                return 1;
            }
            const slots = await res.json();
            let abortedCount = 0;
            if (Array.isArray(slots)) {
                for (const slot of slots) {
                    // If state is processing or has active task
                    if (slot.state === 1 || slot.is_processing || slot.id_task !== undefined) {
                        await SlotManager.abortSlot(enginePort, slot.id ?? 0);
                        abortedCount++;
                    }
                }
            }
            if (abortedCount === 0) {
                await SlotManager.abortSlot(enginePort, 0);
                abortedCount = 1;
            }
            return abortedCount;
        }
        catch {
            await SlotManager.abortSlot(enginePort, 0);
            return 1;
        }
    }
    /**
     * Binds an HTTP request lifecycle to an engine slot, aborting upstream generation if client aborts.
     */
    static bindDisconnect(req, enginePort, slotId = 0) {
        let finished = false;
        const onAbort = () => {
            if (!finished) {
                SlotManager.abortAllActiveSlots(enginePort);
            }
        };
        req.on("close", onAbort);
        req.on("aborted", onAbort);
        return () => {
            finished = true;
        };
    }
}
//# sourceMappingURL=slots.js.map