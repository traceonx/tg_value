import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTelegramMessageLink, runTelegramMessageLinkDownload, telegramMessageLinkFolderName, telegramDownloadFileName } from './telegramMessageLink.js';

test('comment links retain the comment id and destination and reject malformed ids', async () => {
    const raw = 'https://t.me/dmlfse/7788?comment=4913';
    for (const text of [raw, `[${raw}](${raw})`, `/tg_link ${raw}`]) {
        assert.deepEqual(parseTelegramMessageLink(text), { source: '@dmlfse', messageId: 7788, commentId: 4913 });
    }
    const link = parseTelegramMessageLink(`${raw} Dark Blue/01`)!;
    assert.equal(link.folderName, 'Dark Blue');
    assert.equal(link.fileName, '01');
    for (const value of ['0', '-1', '', 'abc', '2147483648', '1&comment=2']) assert.equal(parseTelegramMessageLink(`https://t.me/dmlfse/7788?comment=${value}`), null);
    await runTelegramMessageLinkDownload(link, {
        assertSourceAllowed: async () => {}, getBaseFolder: async () => null, getTarget: async () => 'local',
        download: async (source, ids, _target, folder, name, commentId) => {
            assert.equal(source, '@dmlfse'); assert.deepEqual(ids, [7788]);
            assert.equal(commentId, 4913); assert.equal(folder, 'Dark Blue'); assert.equal(name, '01');
            return { successful: 1, failed: 0 };
        },
    });
});

test('nested comment destinations use every directory and the final filename', async () => {
    const url = 'https://t.me/dmlfse/7788?comment=4913';
    const link = parseTelegramMessageLink(`[${url}](${url}) 文件夹A/文件夹B/1`)!;
    assert.equal(link.folderName, '文件夹A/文件夹B');
    assert.equal(link.fileName, '1');
    assert.equal(telegramDownloadFileName(link.fileName, 'video.mp4'), '1.mp4');
    await runTelegramMessageLinkDownload(link, {
        assertSourceAllowed: async () => {}, getBaseFolder: async () => 'telegram', getTarget: async () => 'local',
        download: async (_source, ids, _target, folder, name, commentId) => {
            assert.equal(folder, 'telegram/文件夹A/文件夹B');
            assert.equal(name, '1'); assert.equal(commentId, 4913); assert.deepEqual(ids, [7788]);
            return { successful: 1, failed: 0 };
        },
    });
});

test('folder slash filename syntax preserves extension and forwards requested name', async () => {
    const link = parseTelegramMessageLink('https://t.me/lifan223/2389 Dark Blue/01')!;
    assert.deepEqual(link, { source: '@lifan223', messageId: 2389, folderName: 'Dark Blue', fileName: '01' });
    assert.equal(telegramDownloadFileName(link.fileName, 'original.mp4'), '01.mp4');
    assert.equal(telegramDownloadFileName('01.mp4', 'original.mp4'), '01.mp4');
    for (const invalid of ['', '..', '../01', 'a/b', 'a\\b']) assert.throws(() => telegramDownloadFileName(invalid, 'original.mp4'));
    await runTelegramMessageLinkDownload(link, {
        assertSourceAllowed: async () => {}, getTarget: async () => 'local', getBaseFolder: async () => 'telegram',
        download: async (_source, _ids, _target, folder, name) => {
            assert.equal(folder, 'telegram/Dark Blue');
            assert.equal(name, '01');
            return { successful: 1, failed: 0 };
        },
    });
});

test('parses a single public post, including Markdown and web previews', () => {
    for (const link of ['https://t.me/lspyanxi/4375', '[视频](https://t.me/lspyanxi/4375)', ' t.me/lspyanxi/4375 ', 'https://t.me/s/lspyanxi/4375?single', 'https://telegram.me/lspyanxi/4375']) {
        assert.deepEqual(parseTelegramMessageLink(link), { source: '@lspyanxi', messageId: 4375 });
    }
    assert.deepEqual(parseTelegramMessageLink('https://t.me/c/1234567890/4375'), { source: '-1001234567890', messageId: 4375 });
});

test('rejects channel-only links, invite links, invalid IDs and unrelated text', () => {
    for (const link of ['https://t.me/lspyanxi', 'https://t.me/+abcd', 'https://t.me/joinchat/123', 'https://t.me/lspyanxi/0', 'https://t.me/lspyanxi/2147483648', 'https://t.me/lspyanxi/1/2', 'https://evil.com/lspyanxi/4375', 'https://t.me.evil.com/lspyanxi/4375', '下载 https://t.me/lspyanxi/4375', 'https://t.me/c/0/1']) {
        assert.equal(parseTelegramMessageLink(link), null, link);
    }
});

test('downloads only the requested message with the selected chat target', async () => {
    const target = { provider: 'local', accountId: 'chat-selected' };
    const result = await runTelegramMessageLinkDownload({ source: '@lspyanxi', messageId: 4375 }, {
        assertSourceAllowed: async source => { assert.equal(source, '@lspyanxi'); },
        getTarget: async () => target,
        getBaseFolder: async () => 'telegram',
        download: async (source, ids, actualTarget, folder) => {
            assert.equal(source, '@lspyanxi');
            assert.deepEqual(ids, [4375]);
            assert.equal(actualTarget, target);
            assert.equal(folder, 'telegram/2026-09-10');
            return { successful: 1, failed: 0 };
        },
    }, new Date('2026-09-09T16:00:00Z'));
    assert.equal(result.successful, 1);
});

test('denied sources cannot consume a target or start a download', async () => {
    await assert.rejects(runTelegramMessageLinkDownload({ source: '@blocked', messageId: 1 }, {
        assertSourceAllowed: async () => { throw new Error('denied'); },
        getTarget: async () => { assert.fail('target consumed'); },
        getBaseFolder: async () => { assert.fail('path consumed'); },
        download: async () => { assert.fail('download started'); },
    }), /denied/);
});

test('folder suffixes and tg_link use the same leading-link syntax', () => {
    for (const prefix of ['https://t.me/lspyanxi/4375', '[视频](https://t.me/lspyanxi/4375)', '/tg_link https://t.me/lspyanxi/4375']) {
        for (const folderName of ['视频1', '2026-09-09', '我的 视频']) {
            assert.deepEqual(parseTelegramMessageLink(`${prefix}   ${folderName}  `), { source: '@lspyanxi', messageId: 4375, folderName });
        }
    }
});

test('default date changes at Shanghai midnight, independent of server timezone', () => {
    const link = { source: '@channel', messageId: 1 };
    assert.equal(telegramMessageLinkFolderName(link, new Date('2026-09-09T15:59:59Z')), '2026-09-09');
    assert.equal(telegramMessageLinkFolderName(link, new Date('2026-09-09T16:00:00Z')), '2026-09-10');
    assert.equal(telegramMessageLinkFolderName(link, new Date('2026-12-31T16:00:00Z')), '2027-01-01');
});

test('appends explicit suffixes to the base folder and resolves settings only once', async () => {
    for (const base of ['telegram', null]) {
        for (const folderName of ['视频1', '2026-09-09', '文件夹A/文件夹B']) {
            let reads = 0;
            await runTelegramMessageLinkDownload({ source: '@channel', messageId: 1, folderName }, {
                assertSourceAllowed: async () => {},
                getBaseFolder: async () => { reads++; return base; },
                getTarget: async () => 'local',
                download: async (_source, _ids, _target, folder) => {
                    assert.equal(folder, base ? `${base}/${folderName}` : folderName);
                    return { successful: 1, failed: 0 };
                },
            });
            assert.equal(reads, 1);
        }
    }
});

test('unsafe suffixes fail before consuming settings or downloading', async () => {
    for (const folderName of ['..', '.', '../other', '/absolute', 'a/../b', 'a//b', 'a/', 'a\\b', 'C:\\data', 'bad:name', 'line\nbreak', 'x'.repeat(256)]) {
        let sourceAccessed = false;
        await assert.rejects(runTelegramMessageLinkDownload({ source: '@channel', messageId: 1, folderName }, {
            assertSourceAllowed: async () => { sourceAccessed = true; },
            getBaseFolder: async () => { assert.fail('path consumed'); },
            getTarget: async () => { assert.fail('target consumed'); },
            download: async () => { assert.fail('download started'); },
        }));
        assert.equal(sourceAccessed, false, folderName);
    }
});
