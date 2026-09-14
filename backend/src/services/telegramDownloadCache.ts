import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { IStorageProvider } from './storage/contracts.js';

export class TelegramDownloadCache<T extends { filePath: string }> {
    private result: T | null = null;
    constructor(private readonly remove = (file: string) => fs.rm(file, { force: true })) {}
    async get(download: () => Promise<T | null>): Promise<T | null> {
        if (!this.result) this.result = await download();
        return this.result;
    }
    async dispose(): Promise<void> {
        if (this.result) await this.remove(this.result.filePath);
        this.result = null;
    }
}

/** Providers may move their input. Preserve the downloaded bytes until all save attempts finish. */
export async function saveRetainingDownload(provider: IStorageProvider, file: string, name: string, mime: string, folder: string | null) {
    const staged = path.join(path.dirname(file), `${crypto.randomUUID()}.upload${path.extname(file)}`);
    try {
        await fs.copyFile(file, staged, constants.COPYFILE_FICLONE);
        return await provider.saveFile(staged, name, mime, folder);
    } finally { await fs.rm(staged, { force: true }); }
}

export function retainingProvider(provider: IStorageProvider): IStorageProvider {
    return new Proxy(provider, { get(target, key) {
        if (key === 'saveFile') return (file: string, name: string, mime: string, folder?: string | null) =>
            saveRetainingDownload(target, file, name, mime, folder ?? null);
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
    } });
}

export async function isStoredDuplicate(provider: IStorageProvider, file: { path: string } | null | undefined, size: number) {
    if (!file || size <= 0) return false;
    try {
        if (provider.getFileSize) return await provider.getFileSize(file.path) === size;
        if (provider.getFileAvailability) return (await provider.getFileAvailability(file.path)).available;
    } catch { return false; }
    return false;
}
