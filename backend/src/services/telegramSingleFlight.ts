export class TelegramSingleFlight<T> {
    private pending = new Map<string, Promise<T>>();
    run(key: string, operation: () => Promise<T>): Promise<T> {
        const current = this.pending.get(key);
        if (current) return current;
        const next = Promise.resolve().then(operation).finally(() => {
            if (this.pending.get(key) === next) this.pending.delete(key);
        });
        this.pending.set(key, next);
        return next;
    }
}
