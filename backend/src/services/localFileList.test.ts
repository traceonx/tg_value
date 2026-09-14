import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listLocalFiles } from './localFileList.js';

test('local list discovers manual files, reflects deletion and pages without modifying disk', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-list-'));
    try {
        await fs.mkdir(path.join(root, '频道'));
        await fs.mkdir(path.join(root, 'chunks'));
        await fs.writeFile(path.join(root, '频道', 'video.mp4'), 'video');
        await fs.writeFile(path.join(root, 'old.mp4'), 'old');
        await fs.utimes(path.join(root, 'old.mp4'), new Date(0), new Date(0));
        await fs.writeFile(path.join(root, 'unfinished.part'), 'partial');
        await fs.writeFile(path.join(root, '.secret'), 'secret');
        await fs.writeFile(path.join(root, 'chunks', 'chunk'), 'chunk');
        const reserved = [path.join(root, 'chunks')];
        const first = await listLocalFiles(root, 1, 1, reserved);
        assert.equal(first[0].name, 'video.mp4');
        assert.equal(first[0].folder, '频道');
        assert.equal(first[0].size, 5);
        assert.equal((await listLocalFiles(root, 1, 2, reserved))[0].name, 'old.mp4');
        assert.equal((await listLocalFiles(root, 12, 1, reserved)).length, 2);
        await fs.unlink(path.join(root, '频道', 'video.mp4'));
        assert.deepEqual((await listLocalFiles(root, 12, 1, reserved)).map(file => file.name), ['old.mp4']);
        assert.equal(await fs.readFile(path.join(root, 'unfinished.part'), 'utf8'), 'partial');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
