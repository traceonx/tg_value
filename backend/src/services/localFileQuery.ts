import path from 'node:path';
import { createHash } from 'node:crypto';
import { listLocalFiles } from './localFileList.js';
import { cursorForFile, decodeFileQueryCursor, type NormalizedFileQuery } from './fileQuery.js';

export interface LocalBrowseFile extends Record<string, unknown> {
    id: string;
    name: string;
    folder: string | null;
    type: string;
    size: number;
    created_at: string;
    is_favorite: boolean;
    indexed: boolean;
}

// Read-only overlay: browsing must not register temporary downloads or change
// retention/deletion semantics for files copied onto disk outside the app.
export async function mergeLocalFiles(root: string, indexed: Record<string, any>[], reserved: string[]): Promise<LocalBrowseFile[]> {
    const disk = await listLocalFiles(root, Number.MAX_SAFE_INTEGER, 1, reserved);
    const byPath = new Map(indexed.filter(file => file.name !== '.folder').map(file => [
        path.resolve(file.path || path.join(root, file.stored_name)), file,
    ]));
    const rows: LocalBrowseFile[] = disk.map(file => {
        const fullPath = path.resolve(root, file.folder, file.name);
        const existing = byPath.get(fullPath);
        if (existing) return { ...existing, size: file.size, created_at: new Date(existing.created_at).toISOString(), indexed: true } as LocalBrowseFile;
        const hash = createHash('sha256').update(fullPath).digest('hex');
        const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        return { ...file, id, folder: file.folder || null, stored_name: file.name, source: 'local', is_favorite: false, indexed: false };
    });
    // Explicit empty folders have no visible disk file because .folder is hidden.
    rows.push(...indexed.filter(file => file.name === '.folder').map(file => ({ ...file, created_at: new Date(file.created_at).toISOString(), indexed: true }) as LocalBrowseFile));
    return rows;
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function sortValue(file: LocalBrowseFile, options: NormalizedFileQuery): string {
    return options.sort === 'name' ? file.name.toLowerCase() : file.created_at;
}

export function filterLocalFiles(files: LocalBrowseFile[], options: NormalizedFileQuery, includeFolder = true): LocalBrowseFile[] {
    return files.filter(file => {
        if (options.q && !`${file.name}\n${file.folder || ''}`.toLowerCase().includes(options.q.toLowerCase())) return false;
        const media = ['image', 'video', 'audio'].includes(file.type);
        if (options.type === 'media' ? !media : options.type === 'document' ? media : options.type && options.type !== file.type) return false;
        if (includeFolder && options.folder !== undefined && (file.folder || null) !== options.folder) return false;
        if (options.favorite !== null && !!file.is_favorite !== options.favorite) return false;
        return (!options.after || file.created_at >= options.after) && (!options.before || file.created_at <= options.before);
    });
}

export function pageLocalFiles(files: LocalBrowseFile[], options: NormalizedFileQuery) {
    const cursor = decodeFileQueryCursor(options.cursor, options.sort, options.direction);
    if (options.cursor && !cursor) throw new Error('invalid cursor');
    const sign = options.direction === 'asc' ? 1 : -1;
    const sorted = filterLocalFiles(files, options).sort((a, b) => sign * (compare(sortValue(a, options), sortValue(b, options)) || compare(a.id, b.id)));
    const remaining = cursor ? sorted.filter(file => sign * (compare(sortValue(file, options), cursor.value) || compare(file.id, cursor.id)) > 0) : sorted;
    const rows = remaining.slice(0, options.limit);
    return { files: rows, hasMore: remaining.length > rows.length, nextCursor: remaining.length > rows.length && rows.length ? cursorForFile(rows[rows.length - 1], options.sort, options.direction) : null };
}

export function aggregateLocalFolders(files: LocalBrowseFile[], options: NormalizedFileQuery) {
    const groups = new Map<string | null, LocalBrowseFile[]>();
    for (const file of filterLocalFiles(files, options, false)) {
        const folder = file.folder || null;
        const group = groups.get(folder);
        if (group) group.push(file);
        else groups.set(folder, [file]);
    }
    const folders = [...groups].map(([name, rows]) => {
        const visible = rows.filter(file => file.name !== '.folder');
        return { name, fileCount: visible.length, totalSizeBytes: visible.reduce((sum, file) => sum + Number(file.size), 0),
            latestDate: rows.map(file => file.created_at).sort().at(-1)!, isFavorite: rows.every(file => file.is_favorite),
            coverFile: visible.filter(file => file.indexed).sort((a, b) => compare(b.created_at, a.created_at) || compare(b.id, a.id))[0] || null };
    });
    const sign = options.direction === 'asc' ? 1 : -1;
    return folders.sort((a, b) => sign * ((options.sort === 'date' ? compare(a.latestDate, b.latestDate) : 0) || compare(a.name || '', b.name || '')));
}
