import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildDownloadProgress, buildConsolidatedStatus, buildSilentProgress, buildSilentAllTasksComplete, type ConsolidatedUploadFile } from './telegramMessages.js';
import { buildTransferStatus } from './transferStatus.js';

const file = (name: string, phase: ConsolidatedUploadFile['phase'], extra: Partial<ConsolidatedUploadFile> = {}): ConsolidatedUploadFile => ({
    fileName: name, phase, typeEmoji: '📄', total: 1024, ...extra,
});

test('new transfers use five icon rows with separate speed and ETA', () => {
    const text = buildDownloadProgress('a_[b]*.iso', 0, 1024, '💾');
    assert.deepEqual(text.split('\n'), ['📄 a_[b]*.iso', '📊 ▱▱▱▱▱▱▱▱▱▱ 0%', '💾 0 B / 1 KB', '⚡ 速度：计算中…', '⏳ 预计剩余：计算中…']);
});

test('concurrent album files each show their own speed, while queued and completed files show sizes', async () => {
    const files = [
        file('a.iso', 'downloading', { downloaded: 512, transferProgress: { downloaded: 512, total: 1024, bytesPerSecond: 128, updatedAt: Date.now() } }),
        file('b.mp4', 'downloading', { downloaded: 256, transferProgress: { downloaded: 256, total: 1024, bytesPerSecond: 64, updatedAt: Date.now() } }),
        file('c.zip', 'queued'), file('d.pdf', 'success', { size: 1024, folder: '/docs' }),
    ];
    const batch = { id: 'batch', folderName: 'album', files, totalFiles: 4, completed: 1, successful: 1, failed: 0 };
    for (const text of [await buildConsolidatedStatus([], [batch]), buildSilentProgress(4, [batch])]) {
        assert.match(text, /正在下载 · 2 个文件/);
        assert.match(text, /⚡ 速度：128 B\/s\n⏳ 预计剩余：00:00:04/);
        assert.match(text, /⚡ 速度：64 B\/s\n⏳ 预计剩余：00:00:12/);
        assert.match(text, /🕓 等待下载 · 1 个文件\n\n📄 c.zip · 1 KB/);
        assert.match(text, /✅ 已完成 · 1 个文件\n\n📄 d.pdf · 1 KB/);
    }
});

test('completed files keep their own paths, combined size and wall clock duration', () => {
    const files = [file('a.iso', 'success', { folder: '/images', size: 1024, startedAt: 1000, endedAt: 61_000 }),
        file('b.pdf', 'success', { folder: '/docs', size: 2048, startedAt: 2000, endedAt: 121_000 })];
    const text = buildSilentAllTasksComplete(2, 0, undefined, files);
    assert.match(text, /✅ 全部下载完成 · 2 个文件/);
    assert.match(text, /📄 a.iso · 1 KB\n📂 \/images/);
    assert.match(text, /📄 b.pdf · 2 KB\n📂 \/docs/);
    assert.match(text, /💾 总大小：3 KB/);
    assert.match(text, /⏱️ 总耗时：00:02:00/);
});

test('partial failure and cancellation never claim all downloads completed', () => {
    assert.doesNotMatch(buildTransferStatus([], { complete: true }), /全部下载完成/);
    for (const phase of ['failed', 'cancelled'] as const) {
        const text = buildTransferStatus([file('a.zip', phase, { error: 'broken' })]);
        assert.doesNotMatch(text, /全部下载完成/);
        assert.match(text, /a.zip/);
    }
});

test('unknown destinations are not invented as the storage root', () => {
    const text = buildTransferStatus([file('unknown.zip', 'success'), file('root.zip', 'success', { folder: null })]);
    assert.match(text, /unknown.zip · 1 KB\n📂 —/);
    assert.match(text, /root.zip · 1 KB\n📂 \/(?:\n|$)/);
});

test('large lists are bounded with an explicit omission notice', () => {
    const files = Array.from({ length: 500 }, (_, i) => file(`file_${i}_${'名'.repeat(100)}.zip`, 'success', { folder: '/'+ '路径'.repeat(200) }));
    const text = buildTransferStatus(files);
    assert.ok(text.length < 3900);
    assert.match(text, /更多文件未展开/);
    assert.match(text, /500 个文件/);
});

test('English status text preserve locale', () => {
    for (const locale of ['en'] as const) {
        const text = buildTransferStatus([file('a.iso', 'downloading')], { locale });
        assert.doesNotMatch(text, /[\u3400-\u9fff]/);
        assert.equal(text.split('\n').filter(line => line.startsWith('⚡')).length, 1);
        assert.equal(text.split('\n').filter(line => line.startsWith('⏳')).length, 1);
    }
});

test('batch, silent completion and pause controls use the requested locale', async () => {
    const files = [file('a.iso', 'downloading')];
    const batch = { id: 'b', folderName: 'album', files, totalFiles: 1, completed: 0, successful: 0, failed: 0 };
    for (const locale of ['en'] as const) {
        const messages = [
            await buildConsolidatedStatus([], [batch], locale),
            buildSilentProgress(1, [batch], [], 0, 0, 'task', false, undefined, false, undefined, locale),
            buildSilentProgress(1, [batch], [], 0, 0, 'task', true, '磁盘空间不足', false, { kind: 'disk_pressure', reason: '磁盘空间不足', autoResume: true, recheckMs: 30000 }, locale),
            buildSilentProgress(1, [batch], [], 0, 0, 'task', false, '正在完成当前文件，随后暂停', true, undefined, locale),
            buildSilentAllTasksComplete(1, 0, undefined, [file('a.iso', 'success', { folder: '/files', startedAt: 1000, endedAt: 5000 })], [], locale),
            buildSilentAllTasksComplete(1, 1, 'task', [file('a.iso', 'failed', { error: '消息不存在或无法重新读取' })], [], locale),
        ];
        for (const text of messages) {
            assert.doesNotMatch(text, /[\u3400-\u9fff\u3000]|[：（）]|transfer\./);
        }
    }
});

test('file counts follow English plural rules', () => {
    assert.match(buildTransferStatus([file('a', 'success')], { locale: 'en' }), /1 file\n/);
    assert.match(buildTransferStatus([file('a', 'success'), file('b', 'success')], { locale: 'en' }), /2 files\n/);
});

test('production status transport uses plain text and no generated media', () => {
    const source = fs.readFileSync(new URL('../services/telegramUpload.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /renderDownloadCard|downloadCardCaption|download-progress\.png|cardFile/);
    assert.match(source, /client\.editMessage\(chatId, \{ \.\.\.params, parseMode: false \}\)/);
    assert.match(source, /message\.reply\(\{ \.\.\.params, parseMode: false \}\)/);
    assert.match(source, /files: snapshot\.map\(file => file\.view!\)/);
    assert.match(source, /files: Array\.from\(views\.values\(\)\)/);
    assert.match(source, /buildConsolidatedStatus\(files, batches, await getProgressLocale\(chatIdStr\)\)/);
    assert.match(source, /getTelegramUserLocaleOrDefault\(owner\)/);
    assert.match(source, /cardUserPaused, session.failed, locale\)/);
});
