import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramLinkFolderChoices } from './telegramLinkFolderChoice.js';

test('reusing a nested destination keeps the complete directory without reusing the filename', () => {
    const choices = new TelegramLinkFolderChoices<string>();
    choices.prepare('chat:user', { source: '@channel', messageId: 1, folderName: '文件夹A/文件夹B', fileName: '1' }, 'first');
    const next = { source: '@channel', messageId: 2, commentId: 4913 };
    const choice = choices.prepare('chat:user', next, 'second')!;
    assert.deepEqual(choices.consume(choice.token, 'chat:user', true)?.link, { ...next, folderName: '文件夹A/文件夹B' });
});

test('folder choice is isolated, single use, and expires after ten minutes', () => {
    let now = Date.parse('2026-09-15T15:59:59Z');
    const choices = new TelegramLinkFolderChoices<string>(() => now);
    const link = { source: '@channel', messageId: 1 };
    assert.equal(choices.prepare('chat:user', link, 'first'), null);
    assert.equal(choices.prepare('chat:user', { ...link, folderName: '我的视频' }, 'first'), null);
    now += 1000;
    assert.equal(choices.prepare('chat:other', link, 'other'), null);
    assert.equal(choices.prepare('other:user', link, 'other'), null);
    const yes = choices.prepare('chat:user', link, 'second')!;
    assert.equal(yes.dateFolder, '2026-09-16');
    assert.equal(choices.consume(yes.token, 'chat:other', true), null);
    assert.equal(choices.consume(yes.token, 'chat:user', true)?.link.folderName, '我的视频');
    assert.equal(choices.consume(yes.token, 'chat:user', true), null);
    const no = choices.prepare('chat:user', link, 'third')!;
    assert.deepEqual(choices.consume(no.token, 'chat:user', false), { context: 'third', link: { ...link, folderName: '2026-09-16' } });
    const stale = choices.prepare('chat:user', link, 'fourth')!;
    now += 600_000;
    assert.equal(choices.prepare('chat:user', link, 'late'), null);
    assert.equal(choices.consume(stale.token, 'chat:user', true), null);
});
