import fs from 'node:fs/promises';
import path from 'node:path';

export async function listLocalFiles(root: string, limit: number, page: number, reserved: string[] = [], includeFolders = false) {
    const base = path.resolve(root);
    const excluded = reserved.map(dir => path.resolve(dir));
    const files: Array<{ name: string; folder: string; type: string; size: number; created_at: string }> = [];
    async function scan(dir: string): Promise<void> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.name.startsWith('.') || /\.(part|tmp|crdownload)$/i.test(entry.name)) continue;
            if (excluded.some(item => full === item || full.startsWith(item + path.sep))) continue;
            try {
                const stat = await fs.lstat(full);
                if (stat.isSymbolicLink()) continue;
                if (stat.isDirectory()) {
                    if (includeFolders) files.push({ name: '.folder', folder: path.relative(base, full).split(path.sep).join('/'), type: 'other', size: 0, created_at: stat.mtime.toISOString() });
                    await scan(full);
                }
                else if (stat.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    const type = /\.(mp4|mkv|mov|avi|webm|ts|m4v)$/.test(ext) ? 'video'
                        : /\.(jpg|jpeg|png|gif|webp|heic)$/.test(ext) ? 'image'
                        : /\.(mp3|flac|wav|ogg|m4a|aac)$/.test(ext) ? 'audio' : 'document';
                    files.push({ name: entry.name, folder: path.relative(base, dir).split(path.sep).join('/'), type, size: stat.size, created_at: stat.mtime.toISOString() });
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
    }
    await scan(base);
    files.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
    return files.slice((page - 1) * limit, page * limit);
}
