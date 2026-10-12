import assert from 'node:assert/strict';
import test from 'node:test';
import { TransferProgressTracker, transferProgressLines } from './telegramTransferProgress.js';
import { buildConsolidatedStatus, buildDownloadProgress, buildSilentProgress } from './telegramMessages.js';

test('speed samples exclude queue time, calculate byte deltas and reset on retry', () => {
    let now = 100_000;
    const tracker = new TransferProgressTracker(() => now);
    assert.equal(tracker.update(0, 10_000).bytesPerSecond, undefined);
    now += 2000;
    const sample = tracker.update(2000, 10_000);
    assert.equal(sample.bytesPerSecond, 1000);
    const text = transferProgressLines(2000, 10_000, sample, 'zh-CN', now).join('\n');
    assert.match(text, /20%/); assert.match(text, /00:00:08/);
    now += 1000;
    const retry = tracker.update(0, 10_000);
    assert.equal(retry.bytesPerSecond, undefined);
    assert.doesNotMatch(transferProgressLines(0, 10_000, retry, 'zh-CN', now).join('\n'), /00:00:08/);
});

test('progress bars represent actual bytes and never round unfinished transfers to 100 percent', () => {
    const half = transferProgressLines(500, 1000, undefined, 'en', 0)[0];
    assert.equal((half.match(/▰/g) || []).length, 5);
    assert.match(half, /50%/);
    assert.doesNotMatch(transferProgressLines(9999, 10_000, undefined, 'en', 0).join('\n'), /100%|Saving/);
    const done = transferProgressLines(10_000, 10_000, undefined, 'en', 0).join('\n');
    assert.match(done, /100%/); assert.match(done, /Saving file/); assert.doesNotMatch(done, /Remaining/);
});

test('unknown lengths animate without inventing percentages and stalled samples suppress stale ETA', () => {
    const unknown1 = transferProgressLines(200, 0, undefined, 'en', 0).join('\n');
    const unknown2 = transferProgressLines(200, 0, undefined, 'en', 1000).join('\n');
    assert.notEqual(unknown1, unknown2);
    assert.match(unknown1, /Size unknown/); assert.doesNotMatch(unknown1, /\d%|NaN|Infinity/);
    const sample = { downloaded: 500, total: 1000, bytesPerSecond: 100, updatedAt: 1000 };
    const stalled = transferProgressLines(500, 1000, sample, 'en', 16_000).join('\n');
    assert.match(stalled, /Waiting for data/); assert.doesNotMatch(stalled, /100 B\/s|00:00:05/);
    for (const locale of ['zh-CN', 'en', 'ru'] as const) {
        assert.doesNotMatch(transferProgressLines(NaN, Infinity, undefined, locale, 0).join('\n'), /NaN|Infinity/);
    }
});

test('single, consolidated and silent cards include current file byte progress', async () => {
    const sample = { downloaded: 500, total: 1000, bytesPerSecond: 100, updatedAt: Date.now() };
    const batch = { id: '1', folderName: 'A/B', totalFiles: 2, completed: 0, successful: 0, failed: 0,
        currentFileName: 'clip.mp4', currentFileActive: true, currentDownloaded: 500, currentTotal: 1000, transferProgress: sample };
    for (const text of [
        buildDownloadProgress('clip.mp4', 500, 1000, '🎬', undefined, 'zh-CN', sample),
        await buildConsolidatedStatus([], [batch]),
        await buildConsolidatedStatus([{ fileName: 'clip.mp4', typeEmoji: '🎬', phase: 'downloading', downloaded: 500, total: 1000, transferProgress: sample }], []),
        buildSilentProgress(2, [batch]),
    ]) {
        assert.match(text, /clip.mp4/); assert.match(text, /▰{5}▱{5} 50%/);
        assert.match(text, /100 B\/s/); assert.match(text, /00:00:05/);
    }
    const paused = buildSilentProgress(2, [batch], [], 0, 0, undefined, true);
    assert.doesNotMatch(paused, /100 B\/s|00:00:05/);
});
