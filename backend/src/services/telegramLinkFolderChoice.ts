import { randomUUID } from 'node:crypto';
import { telegramMessageLinkFolderName, type TelegramMessageLink } from './telegramMessageLink.js';

const TTL = 10 * 60_000;
export class TelegramLinkFolderChoices<T> {
    private recent = new Map<string, { folder: string; at: number }>();
    private pending = new Map<string, { scope: string; link: TelegramMessageLink; context: T; folder: string; dateFolder: string; expires: number }>();
    constructor(private now = Date.now) {}
    prepare(scope: string, link: TelegramMessageLink, context: T) {
        const now = this.now();
        for (const [key, row] of this.recent) if (now - row.at >= TTL) this.recent.delete(key);
        for (const [key, row] of this.pending) if (row.expires <= now) this.pending.delete(key);
        if (link.folderName) {
            this.recent.set(scope, { folder: telegramMessageLinkFolderName(link), at: now });
            return null;
        }
        const recent = this.recent.get(scope);
        if (!recent) return null;
        const token = randomUUID().replaceAll('-', '');
        const dateFolder = telegramMessageLinkFolderName(link, new Date(now));
        this.pending.set(token, { scope, link, context, folder: recent.folder, dateFolder, expires: now + TTL });
        return { token, folder: recent.folder, dateFolder };
    }
    consume(token: string, scope: string, reuse: boolean) {
        const pending = this.pending.get(token);
        if (!pending || pending.scope !== scope) return null;
        this.pending.delete(token);
        if (pending.expires <= this.now()) return null;
        return { context: pending.context, link: { ...pending.link, folderName: reuse ? pending.folder : pending.dateFolder } };
    }
}
