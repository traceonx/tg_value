export class TelegramEditCache {
    private pending = new Map<string, Promise<unknown>>();
    private sent = new Map<string, string>();
    async run<T>(key: string, content: string, edit: () => Promise<T>): Promise<T | { notModified: true }> {
        const previous = this.pending.get(key) || Promise.resolve();
        const next = previous.catch(() => undefined).then(async () => {
            if (this.sent.get(key) === content) return { notModified: true as const };
            const result = await edit();
            if (result) {
                this.sent.delete(key);
                this.sent.set(key, content);
                if (this.sent.size > 1000) this.sent.delete(this.sent.keys().next().value!);
            }
            return result;
        });
        this.pending.set(key, next);
        try { return await next; }
        finally { if (this.pending.get(key) === next) this.pending.delete(key); }
    }
}
