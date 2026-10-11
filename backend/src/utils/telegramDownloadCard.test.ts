import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { downloadCardData, downloadCardCaption, renderDownloadCard } from './telegramDownloadCard.js';

const progress = '🎬 clip.mp4\n\n207 MB / 240 MB\n▰▰▰▰▰▰▰▰▰▰▱▱ 85.9%\n⬇ 3.9 MB/s · ⏱ 剩余 00:00:09\n📁 A/B';
test('image card extracts real transfer values and keeps controls outside the card', () => {
    assert.deepEqual(downloadCardData(progress), { title: 'clip.mp4', size: '207 MB / 240 MB', percent: 85.9, speed: '3.9 MB/s', eta: '00:00:09', folder: 'A/B' });
    assert.equal(downloadCardCaption(progress), '');
    assert.equal(downloadCardCaption(progress + '\n/tg_pause task'), '/tg_pause task');
    assert.equal(downloadCardData('任务已完成'), null);
});
test('cards render escaped filenames and terminal states as PNG', async () => {
    for (const text of [progress.replace('clip.mp4', '<a&b>.mp4'), '任务已完成\n文件保存成功']) {
        const output = await renderDownloadCard(text);
        const metadata = await sharp(output).metadata();
        assert.equal(metadata.format, 'png');
        assert.equal(metadata.width, 1440);
        assert.ok(metadata.height! >= 240);
    }
});
