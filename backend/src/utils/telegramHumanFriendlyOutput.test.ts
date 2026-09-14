import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHelp, buildFileList } from './telegramMessages.js';

test('Bot help shows seven entry points instead of advanced command syntax', () => {
    const text = buildHelp();

    assert.match(text, /点击按钮可直接打开对应功能/);
    assert.doesNotMatch(text, /<[^>]+>/);
    assert.match(text, /\/download/);
    assert.match(text, /\/files/);
    assert.match(text, /\/settings/);
    assert.doesNotMatch(text, /\/target once|\/notifications timezone|\/task_cancel/);
    assert.ok(text.length < 1000);
});

test('recent file list avoids teaching delete and pagination commands', () => {
    const text = buildFileList([{
        id: '12345678-1234-4000-8000-123456789abc',
        name: 'photo.jpg',
        type: 'image',
        size: 1024,
        folder: 'photos',
        created_at: '2026-08-28T00:00:00.000Z',
    }], 1);

    assert.match(text, /需要搜索或操作文件，请打开“搜索和操作文件”/);
    assert.doesNotMatch(text, /\/delete|\/list 20|<ID>/);
});
