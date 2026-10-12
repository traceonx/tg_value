import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupOrphanFiles, isAutoCleanupEnabled } from './orphanCleanup.js';

test('legacy enabled cleanup preserves old unindexed torrent files and empty folders', async (t) => {
    // Node 22 can misparse non-ASCII stdout as test IPC (nodejs/node#65934).
    // Capture this expected log and assert it instead of writing it to the pipe.
    const log = t.mock.method(console, 'log', () => undefined);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orphan-safety-'));
    const previousDir = process.env.UPLOAD_DIR;
    const previousEnabled = process.env.AUTO_CLEANUP_ORPHANS;
    try {
        process.env.UPLOAD_DIR = root;
        process.env.AUTO_CLEANUP_ORPHANS = 'true';
        const folder = path.join(root, 'telegram', 'torrent');
        await fs.mkdir(path.join(folder, 'empty'), { recursive: true });
        const file = path.join(folder, 'download.bin');
        await fs.writeFile(file, 'external download');
        await fs.utimes(file, new Date(0), new Date(0));
        const result = await cleanupOrphanFiles();
        assert.equal(log.mock.callCount(), 1);
        assert.match(String(log.mock.calls[0].arguments[0]), /已跳过孤儿文件删除/);
        assert.equal(result.deletedCount, 0);
        assert.equal(result.freedBytes, 0);
        assert.equal(await fs.readFile(file, 'utf8'), 'external download');
        assert.ok((await fs.stat(path.join(folder, 'empty'))).isDirectory());
    } finally {
        if (previousDir === undefined) delete process.env.UPLOAD_DIR;
        else process.env.UPLOAD_DIR = previousDir;
        if (previousEnabled === undefined) delete process.env.AUTO_CLEANUP_ORPHANS;
        else process.env.AUTO_CLEANUP_ORPHANS = previousEnabled;
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('automatic cleanup defaults to disabled', () => {
    const previous = process.env.AUTO_CLEANUP_ORPHANS;
    try {
        delete process.env.AUTO_CLEANUP_ORPHANS;
        assert.equal(isAutoCleanupEnabled(), false);
    } finally {
        if (previous === undefined) delete process.env.AUTO_CLEANUP_ORPHANS;
        else process.env.AUTO_CLEANUP_ORPHANS = previous;
    }
});
