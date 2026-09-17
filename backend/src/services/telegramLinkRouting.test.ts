import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { buildConsolidatedStatus } from '../utils/telegramMessages.js';

test('direct links are handled before pending path and tag wizard inputs', () => {
    const bot = fs.readFileSync(new URL('./telegramBot.ts', import.meta.url), 'utf8');
    const link = bot.indexOf('const messageLink = parseTelegramMessageLink(text)');
    assert.ok(link > 0);
    assert.ok(link < bot.indexOf('const handledTelegramWizard = await handleTelegramWizardMessage'));
    assert.ok(link < bot.indexOf('const appliedPath = await applyPendingTelegramPathInputPersistent'));
    const branch = bot.slice(link, bot.indexOf("if (!text.startsWith('/'))", link));
    assert.match(branch, /telegramWizardStates.delete/);
    assert.match(branch, /isAuthenticatedAsync/);
    assert.match(branch, /downloadMessageLink\(message, senderId, messageLink, locale\)/);
    const handler = bot.slice(bot.indexOf('async function downloadMessageLink'), bot.indexOf('async function handleLinkFolderChoice'));
    assert.match(handler, /getBaseFolder:.*resolveTelegramStorageFolderPersistent/);
    assert.match(branch, /linkFolderChoices.prepare/);
});

test('active link progress shows bytes and the actual destination folder', async () => {
    const text = await buildConsolidatedStatus([], [{
        id: 'one', folderName: '@channel', folderPath: 'telegram/戏精女王',
        totalFiles: 1, completed: 0, successful: 0, failed: 0,
        currentFileName: 'video.mp4', currentFileActive: true, currentDownloaded: 50, currentTotal: 100,
    }]);
    assert.match(text, /50%/);
    assert.match(text, /telegram\/戏精女王/);
    assert.match(text, /video.mp4/);
});

test('empty or interrupted batches cannot announce successful completion', async () => {
    for (const [totalFiles, completed, successful, failed] of [[0, 0, 0, 0], [1, 1, 0, 0], [2, 2, 1, 0]]) {
        const text = await buildConsolidatedStatus([], [{ id: 'one', folderName: 'folder', totalFiles, completed, successful, failed }]);
        assert.doesNotMatch(text, /任务全部完成|完成摘要/);
    }
    const success = await buildConsolidatedStatus([], [{ id: 'one', folderName: 'folder', totalFiles: 1, completed: 1, successful: 1, failed: 0 }]);
    assert.match(success, /任务全部完成/);
    const failure = await buildConsolidatedStatus([], [{ id: 'one', folderName: 'folder', totalFiles: 1, completed: 1, successful: 0, failed: 1 }]);
    assert.doesNotMatch(failure, /任务全部完成/);
    assert.match(failure, /1 个失败/);
});
