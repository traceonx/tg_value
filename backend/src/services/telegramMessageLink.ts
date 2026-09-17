import { joinFolderPath, normalizeFolderName } from '../utils/folderPath.js';
import { TelegramSingleFlight } from './telegramSingleFlight.js';
import path from 'node:path';

const downloads = new TelegramSingleFlight<{ successful: number; failed: number }>();

export interface TelegramMessageLink {
    source: string;
    messageId: number;
    folderName?: string;
    fileName?: string;
}

/** Accept a leading message link and an optional child folder name. */
export function parseTelegramMessageLink(input: string): TelegramMessageLink | null {
    const trimmed = input.trim().replace(/^\/tg_link(?:@\w+)?(?:\s+|$)/i, '');
    const markdown = trimmed.match(/^\[[^\]]*\]\((https?:\/\/[^\s)]+)\)(?:\s+([\s\S]*))?$/i);
    const plain = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const link = markdown?.[1] || plain?.[1] || trimmed;
    const suffix = (markdown ? markdown[2] : plain?.[2])?.trim();
    const match = link.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:(c)\/(\d+)|(?:s\/)?([A-Za-z][A-Za-z0-9_]*))\/(\d+)\/?(?:[?#][^\s]*)?$/i);
    if (!match || (match[3] && ['c', 's', 'joinchat'].includes(match[3].toLowerCase()))) return null;
    const messageId = Number(match[4]);
    if (!Number.isSafeInteger(messageId) || messageId < 1 || messageId > 2147483647) return null;
    if (match[1] && !/^[1-9]\d*$/.test(match[2])) return null;
    const split = suffix?.lastIndexOf('/') ?? -1;
    // Validate raw components downstream before any target/path state is consumed.
    const destination = suffix && split > 0
        ? { folderName: suffix.slice(0, split), fileName: suffix.slice(split + 1) }
        : suffix ? { folderName: suffix } : {};
    return { source: match[1] ? `-100${match[2]}` : `@${match[3]}`, messageId, ...destination };
}

export function telegramDownloadFileName(requested: string | undefined, original: string): string {
    if (requested === undefined) return original;
    const name = normalizeFolderName(requested);
    if (name !== requested || /[\/\\]/.test(requested)) throw new Error('Invalid file name');
    const extension = path.extname(original);
    const result = extension && !name.toLowerCase().endsWith(extension.toLowerCase()) ? `${name}${extension}` : name;
    if (result.length > 255) throw new Error('File name is too long');
    return result;
}

export function telegramMessageLinkFolderName(link: TelegramMessageLink, now = new Date()): string {
    if (link.folderName) {
        // A suffix names one child directory, never an absolute or nested path.
        if (/[\/\\]/.test(link.folderName)) throw new Error('文件夹名称不能包含路径分隔符');
        return normalizeFolderName(link.folderName);
    }
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find(value => value.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

export async function runTelegramMessageLinkDownload<T>(
    link: TelegramMessageLink,
    dependencies: {
        assertSourceAllowed: (source: string) => Promise<void>;
        getTarget: () => Promise<T>;
        getBaseFolder: () => Promise<string | null>;
        scopeKey?: string;
        targetKey?: (target: T) => string;
        download: (source: string, ids: number[], target: T, folder: string, fileName?: string) => Promise<{ successful: number; failed: number }>;
    },
    now = new Date(),
) {
    const folderName = telegramMessageLinkFolderName(link, now);
    if (link.fileName !== undefined) telegramDownloadFileName(link.fileName, '');
    await dependencies.assertSourceAllowed(link.source);
    const folder = joinFolderPath(await dependencies.getBaseFolder(), folderName);
    const target = await dependencies.getTarget();
    const download = () => dependencies.download(link.source, [link.messageId], target, folder, link.fileName);
    if (!dependencies.scopeKey || !dependencies.targetKey) return download();
    const key = JSON.stringify([dependencies.scopeKey, link.source.toLowerCase(), link.messageId, dependencies.targetKey(target), folder, link.fileName]);
    return downloads.run(key, download);
}
