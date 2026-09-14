import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mergeLocalFiles, pageLocalFiles, aggregateLocalFolders, type LocalBrowseFile } from './localFileQuery.js';
import { normalizeFileQuery } from './fileQuery.js';

test('local browser merges disk files without duplicates and preserves indexed metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-query-'));
    try {
        await fs.mkdir(path.join(root, '频道'));
        await fs.mkdir(path.join(root, 'chunks'));
        await fs.writeFile(path.join(root, '频道', 'stored.mp4'), '12345');
        await fs.writeFile(path.join(root, '频道', 'manual.txt'), '123');
        await fs.writeFile(path.join(root, 'root.txt'), '1');
        await fs.writeFile(path.join(root, 'incomplete.part'), '1');
        await fs.writeFile(path.join(root, 'chunks', 'chunk'), '1');
        const indexed = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Original title.mp4', stored_name: 'stored.mp4', path: path.join(root, '频道', 'stored.mp4'), folder: '频道', size: 5, type: 'video', created_at: '2026-01-01T00:00:00Z', is_favorite: true }];
        const load = () => mergeLocalFiles(root, indexed, [path.join(root, 'chunks')]);
        const rows = await load();
        assert.equal(rows.length, 3);
        assert.equal(rows.find(file => file.indexed)?.name, 'Original title.mp4');
        assert.equal(rows.find(file => file.name === 'manual.txt')?.indexed, false);
        assert.deepEqual((await load()).map(file => file.id), rows.map(file => file.id));
        const query = normalizeFileQuery({ folder: '频道', sort: 'name', direction: 'asc', limit: '1' });
        const first = pageLocalFiles(rows, query);
        const second = pageLocalFiles(rows, { ...query, cursor: first.nextCursor });
        assert.equal(first.hasMore, true);
        assert.equal(second.hasMore, false);
        assert.equal(new Set([...first.files, ...second.files].map(file => file.id)).size, 2);
        assert.equal(pageLocalFiles(rows, normalizeFileQuery({ favorite: 'true' })).files.length, 1);
        assert.equal(pageLocalFiles(rows, normalizeFileQuery({ q: 'manual', type: 'document' })).files.length, 1);
        assert.equal(pageLocalFiles(rows, normalizeFileQuery({ folder: '' })).files.length, 1);
        const folder = aggregateLocalFolders(rows, query).find(folder => folder.name === '频道')!;
        assert.equal(folder.fileCount, 2);
        assert.equal(folder.totalSizeBytes, 8);
        assert.equal(folder.isFavorite, false);
        assert.throws(() => pageLocalFiles(rows, { ...query, cursor: 'garbage' }), /invalid cursor/);
        await fs.unlink(path.join(root, '频道', 'manual.txt'));
        assert.equal((await load()).length, 2);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('mixed local files page past 200 without skipping equal dates or names in either direction', () => {
    const rows: LocalBrowseFile[] = Array.from({ length: 505 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: `file-${index % 3}`, folder: 'folder', type: 'document', size: index,
        created_at: '2026-01-01T00:00:00.000Z', is_favorite: false, indexed: index % 2 === 0,
    }));
    for (const sort of ['date', 'name']) for (const direction of ['asc', 'desc']) {
        const options = normalizeFileQuery({ sort, direction, limit: '200' });
        const ids: string[] = [];
        for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
            const page = pageLocalFiles(rows, options);
            ids.push(...page.files.map(file => file.id));
            if (!page.hasMore) break;
            options.cursor = page.nextCursor;
        }
        assert.equal(ids.length, 505);
        assert.equal(new Set(ids).size, 505);
    }
    assert.equal(pageLocalFiles(rows, normalizeFileQuery({ after: '2026-01-02' })).files.length, 0);
    assert.equal(pageLocalFiles(rows, normalizeFileQuery({ before: '2025-12-31' })).files.length, 0);
});
