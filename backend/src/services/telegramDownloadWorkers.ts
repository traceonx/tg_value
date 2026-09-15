export async function runTelegramDownloadWorkers(
    count: number,
    operation: (index: number, signal: AbortSignal) => Promise<void>,
    parentSignal?: AbortSignal,
): Promise<void> {
    const controller = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    let failure: unknown;
    let failed = false;
    await Promise.allSettled(Array.from({ length: count }, async (_, index) => {
        try { await operation(index, signal); }
        catch (error) {
            if (!failed) { failure = error; failed = true; }
            controller.abort();
        }
    }));
    // No worker may write to the file after its handle is closed or retry starts.
    if (failed) throw failure;
}
