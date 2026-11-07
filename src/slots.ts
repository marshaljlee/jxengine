/**
 * Slot Management & Client Disconnect Cancellation for llama-server.
 * Automatically halts background GPU/CPU computation when an agent cancels a request.
 */

export interface ActiveSlot {
  slotId: number;
  enginePort: number;
  startedAt: number;
}

export class SlotManager {
  /**
   * Sends an abort request to llama-server to stop an active generation slot immediately.
   */
  static async abortSlot(enginePort: number, slotId = 0): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${enginePort}/slots/${slotId}?action=abort`, {
        method: "POST",
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Binds an HTTP request lifecycle to an engine slot, aborting upstream generation if client aborts.
   */
  static bindDisconnect(
    req: { on: (event: string, cb: () => void) => void },
    enginePort: number,
    slotId = 0
  ): () => void {
    let finished = false;

    const onAbort = () => {
      if (!finished) {
        SlotManager.abortSlot(enginePort, slotId);
      }
    };

    req.on("close", onAbort);
    req.on("aborted", onAbort);

    return () => {
      finished = true;
    };
  }
}
