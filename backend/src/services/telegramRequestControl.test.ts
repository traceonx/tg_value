import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TelegramClient } from 'telegram';
import type { IStorageProvider } from './storage/contracts.js';
import { installTelegramRequestGate, TelegramRequestGate, canTelegramRequest } from './telegramRequestGate.js';
import { TelegramProgressRegistry } from './telegramProgressSettings.js';
import { TelegramEditCache } from './telegramEditCache.js';
import { TelegramDownloadCache, retainingProvider, isStoredDuplicate } from './telegramDownloadCache.js';
import { saveAndIndexWithCompensation } from './storageWrite.js';
import { telegramHistoryOffset } from './telegramDateRange.js';
import { runTelegramMessageLinkDownload } from './telegramMessageLink.js';

test('installed media hook retries a short wait at the original offset and persists cooling once', async () => {
    let now = 0;
    const offsets: number[] = [];
    let persisted = 0;
    const client = {
        async invoke() { return true; },
        async invokeWithSender(request: { offset: number }) {
            offsets.push(request.offset);
            if (offsets.length === 1) throw Object.assign(new Error('FLOOD_WAIT_2'), { seconds: 2 });
            assert.ok(now >= 2000);
            return Buffer.from('chunk');
        },
    } as unknown as TelegramClient;
    installTelegramRequestGate(client, new TelegramRequestGate(0, () => now, async ms => { now += ms; }), async () => { persisted++; });
    const chunk = await client.invokeWithSender({ className: 'upload.GetFile', offset: 524288 } as never, {} as never);
    assert.deepEqual(chunk, Buffer.from('chunk'));
    assert.deepEqual(offsets, [524288, 524288]);
    assert.equal(persisted, 1);
});

test('actual invoke and media entry points share long cooling and do not call fallback send', async () => {
    const calls: string[] = [];
    const client = {
        async invoke(request: { className: string }) { calls.push(request.className); return true; },
        async invokeWithSender(request: { className: string }) {
            calls.push(request.className); throw Object.assign(new Error('FLOOD_WAIT_120'), { seconds: 120 });
        },
    } as unknown as TelegramClient;
    let persisted = 0;
    installTelegramRequestGate(client, new TelegramRequestGate(0), async () => { persisted++; });
    await assert.rejects(client.invokeWithSender({ className: 'upload.GetFile' } as never, {} as never));
    await assert.rejects(client.invoke({ className: 'messages.SendMessage' } as never));
    await assert.rejects(client.invokeWithSender({ className: 'upload.GetFile' } as never, {} as never));
    assert.equal(canTelegramRequest(client), false);
    assert.deepEqual(calls, ['upload.GetFile']);
    assert.equal(persisted, 1);
});

test('tasks share a chat timer and releasing one task keeps the remaining updater', async () => {
    let starts = 0, stops = 0;
    let tick!: () => Promise<void>;
    const updates: string[] = [];
    const registry = new TelegramProgressRegistry(refresh => {
        starts++; tick = refresh;
        return async () => { stops++; };
    });
    const first = registry.acquire('chat', async () => { updates.push('first'); });
    const second = registry.acquire('chat', async () => { updates.push('second'); });
    await tick();
    await second();
    await tick();
    assert.equal(starts, 1);
    assert.equal(stops, 0);
    assert.deepEqual(updates, ['second', 'first']);
    await first(); await first();
    assert.equal(stops, 1);
});

test('concurrent identical edits collapse; failures never poison the content cache', async () => {
    const cache = new TelegramEditCache();
    let calls = 0;
    const send = async () => { calls++; return true; };
    await Promise.all(Array.from({ length: 8 }, () => cache.run('chat:msg', 'progress', send)));
    assert.equal(calls, 1);
    await assert.rejects(cache.run('chat:msg', 'done', async () => { throw new Error('network'); }));
    await cache.run('chat:msg', 'done', send);
    assert.equal(calls, 2);
});

test('local move plus index failure retries storage without downloading again', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-cache-test-'));
    const file = path.join(dir, 'download');
    const stored = path.join(dir, 'stored');
    let downloads = 0;
    const cache = new TelegramDownloadCache<{ filePath: string }>();
    const provider = retainingProvider({
        name: 'local',
        async saveFile(source: string) { await fs.rename(source, stored); return stored; },
        async deleteFile(source: string) { await fs.rm(source); },
    } as unknown as IStorageProvider);
    const download = async () => { downloads++; await fs.writeFile(file, 'video'); return { filePath: file }; };
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = await cache.get(download);
            const save = saveAndIndexWithCompensation(provider, result!.filePath, 'video', 'video/mp4', null, async () => {
                if (attempt === 0) throw new Error('database unavailable');
            });
            if (attempt === 0) await assert.rejects(save); else await save;
        }
        assert.equal(downloads, 1);
        assert.equal(await fs.readFile(stored, 'utf8'), 'video');
        await cache.dispose();
        await assert.rejects(fs.stat(file));
        assert.equal(await fs.readFile(stored, 'utf8'), 'video');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('pre-download duplicates require a confirmed stored file with matching size', async () => {
    const provider = { async getFileSize() { return 10; } } as unknown as IStorageProvider;
    assert.equal(await isStoredDuplicate(provider, { path: 'exists' }, 10), true);
    assert.equal(await isStoredDuplicate(provider, { path: 'exists' }, 11), false);
    provider.getFileSize = async () => { throw new Error('missing'); };
    assert.equal(await isStoredDuplicate(provider, { path: 'missing' }, 10), false);
});

test('same link and target share the in-flight download; another folder is independent', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>(resolve => { finish = resolve; });
    let calls = 0;
    const dependencies = {
        scopeKey: 'chat:user', targetKey: (target: string) => target,
        async assertSourceAllowed() {}, async getBaseFolder() { return 'root'; }, async getTarget() { return 'storage'; },
        async download() { calls++; await blocked; return { successful: 1, failed: 0 }; },
    };
    const link = { source: '@channel', messageId: 1, folderName: 'folder' };
    const tasks = [runTelegramMessageLinkDownload(link, dependencies), runTelegramMessageLinkDownload(link, dependencies),
        runTelegramMessageLinkDownload({ ...link, folderName: 'other' }, dependencies)];
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    finish(); await Promise.all(tasks);
    await runTelegramMessageLinkDownload(link, dependencies);
    assert.equal(calls, 3);
});

test('date scan starts at the inclusive end boundary, then uses the persisted ID cursor', () => {
    const end = '2026-09-14T15:59:59.999Z';
    assert.deepEqual(telegramHistoryOffset(end, 0), { offsetDate: Date.parse('2026-09-14T16:00:00Z') / 1000 });
    assert.deepEqual(telegramHistoryOffset(end, 100), {});
    assert.throws(() => telegramHistoryOffset('invalid', 0));
});
