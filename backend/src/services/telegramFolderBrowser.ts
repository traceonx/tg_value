import { randomUUID } from 'node:crypto';
import { Api } from 'telegram';
import { t, type TelegramLocale } from '../i18n/telegram.js';

export interface FolderBrowseFile {
    name: string; folder?: string | null; id?: string; indexed?: boolean; size?: unknown;
}
export function folderEntries(files: FolderBrowseFile[], folder: string) {
    const prefix = folder ? `${folder}/` : '';
    const folders = new Set<string>();
    for (const file of files) {
        const current = file.folder || '';
        if (current.startsWith(prefix) && current !== folder) {
            const child = current.slice(prefix.length).split('/')[0];
            if (child) folders.add(prefix + child);
        }
    }
    return {
        folders: [...folders].sort((a, b) => a.localeCompare(b)),
        files: files.filter(file => (file.folder || '') === folder && file.name !== '.folder').sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))),
    };
}

interface BrowseState { scope: string; folder: string; page: number; expires: number }
export class TelegramFolderBrowser {
    private links = new Map<string, BrowseState>();
    constructor(private now = Date.now) {}
    resolve(token: string, scope: string): BrowseState | null {
        const state = this.links.get(token);
        return state && state.scope === scope && state.expires > this.now() ? state : null;
    }
    render(files: FolderBrowseFile[], scope: string, locale: TelegramLocale, folder = '', page = 0) {
        for (const [id, state] of this.links) if (state.expires <= this.now()) this.links.delete(id);
        const entries = folderEntries(files, folder);
        const combined = [
            ...entries.folders.map(value => ({ folder: value, file: null as FolderBrowseFile | null })),
            ...entries.files.map(file => ({ folder: '', file })),
        ];
        const totalPages = Math.max(1, Math.ceil(combined.length / 10));
        page = Math.min(Math.max(0, page), totalPages - 1);
        const navigate = (text: string, target: string, targetPage = 0) => {
            const token = randomUUID().replaceAll('-', '');
            this.links.set(token, { scope, folder: target, page: targetPage, expires: this.now() + 15 * 60_000 });
            if (this.links.size > 4000) this.links.delete(this.links.keys().next().value!);
            return new Api.KeyboardButtonCallback({ text, data: Buffer.from(`folders_${token}`) });
        };
        const rows: Api.KeyboardButtonRow[] = [];
        const lines = [t(locale, 'folderBrowser.title', { folder: folder || t(locale, 'fileBrowser.rootFolder') }), t(locale, 'folderBrowser.page', { page: page + 1, total: totalPages }), ''];
        for (const entry of combined.slice(page * 10, (page + 1) * 10)) {
            if (entry.file) {
                const file = entry.file;
                lines.push(`📄 ${file.name}`);
                if (file.id && file.indexed !== false) rows.push(new Api.KeyboardButtonRow({ buttons: [new Api.KeyboardButtonCallback({ text: `📄 ${file.name.slice(0, 38)}`, data: Buffer.from(`fb_detail_${file.id}`) })] }));
            } else {
                const name = entry.folder.split('/').at(-1)!;
                lines.push(`📁 ${name}`);
                rows.push(new Api.KeyboardButtonRow({ buttons: [
                    navigate(`📂 ${name.slice(0, 32)}`, entry.folder),
                    new Api.KeyboardButtonCopy({ text: t(locale, 'folderBrowser.copy'), copyText: name }),
                ] }));
            }
        }
        if (!combined.length) lines.push(t(locale, 'folderBrowser.empty'));
        const paging: Api.TypeKeyboardButton[] = [];
        if (page > 0) paging.push(navigate('←', folder, page - 1));
        if (page + 1 < totalPages) paging.push(navigate('→', folder, page + 1));
        if (paging.length) rows.push(new Api.KeyboardButtonRow({ buttons: paging }));
        if (folder) rows.push(new Api.KeyboardButtonRow({ buttons: [
            navigate(t(locale, 'folderBrowser.parent'), folder.split('/').slice(0, -1).join('/')),
            new Api.KeyboardButtonCopy({ text: t(locale, 'folderBrowser.copy'), copyText: folder.split('/').at(-1)! }),
        ] }));
        return { message: lines.join('\n'), buttons: new Api.ReplyInlineMarkup({ rows }), parseMode: false as const };
    }
}
