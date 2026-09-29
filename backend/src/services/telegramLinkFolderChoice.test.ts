import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramLinkFolderChoices, runTelegramLinkFolderChoice } from './telegramLinkFolderChoice.js';
import { Api } from 'telegram';
import bigInt from 'big-integer';
import { messageChatKey, callbackChatKey } from '../bot/context.js';
import type { TelegramMessageLink } from './telegramMessageLink.js';

test('folder choices continue the second link without retrieving the menu in private and group chats', async () => {
    for (const [chatId, peer] of [['42', new Api.PeerUser({ userId: bigInt(42) })], ['-123', new Api.PeerChat({ chatId: bigInt(123) })], ['-100123', new Api.PeerChannel({ channelId: bigInt(123) })]] as const) {
        for (const reuse of [true, false]) {
            const now = Date.parse('2026-09-29T12:00:00Z');
            const choices = new TelegramLinkFolderChoices<Api.Message>(() => now);
            const message = { chatId: bigInt(chatId), id: 2 } as Api.Message;
            const scope = `${messageChatKey(message, 42)}:42`;
            choices.prepare(scope, { source: '@channel', messageId: 1, folderName: '目录A/目录B', fileName: '1' }, message);
            const link = { source: '@channel', messageId: 2, commentId: 4913 };
            const pending = choices.prepare(scope, link, message)!;
            const update = new Api.UpdateBotCallbackQuery({ queryId: bigInt(1), userId: bigInt(42), peer, msgId: 10, chatInstance: bigInt(1) });
            let downloads = 0;
            const effects = {
                answer: async (accepted: boolean) => { assert.equal(accepted, downloads === 0); },
                update: async (folder: string) => { assert.equal(folder, reuse ? '目录A/目录B' : '2026-09-29'); },
                download: async (context: Api.Message, actual: TelegramMessageLink) => {
                    downloads++;
                    assert.equal(context, message);
                    assert.deepEqual(actual, { ...link, folderName: reuse ? '目录A/目录B' : '2026-09-29' });
                },
                feedbackError: (error: unknown) => { throw error; },
            };
            const callbackScope = `${callbackChatKey(update, 42)}:42`;
            assert.equal(await runTelegramLinkFolderChoice(choices, pending.token, callbackScope, reuse, effects), true);
            assert.equal(await runTelegramLinkFolderChoice(choices, pending.token, callbackScope, reuse, effects), false);
            assert.equal(downloads, 1);
        }
    }
});

test('callback acknowledgement and menu edit failures do not swallow the selected download', async () => {
    const choices = new TelegramLinkFolderChoices<string>();
    choices.prepare('chat:user', { source: '@channel', messageId: 1, folderName: '目录' }, 'first');
    const next = choices.prepare('chat:user', { source: '@channel', messageId: 2 }, 'second')!;
    let downloads = 0, errors = 0;
    const effects = {
        answer: async () => { throw new Error('QUERY_ID_INVALID'); },
        update: async () => { throw new Error('MESSAGE_ID_INVALID'); },
        download: async (context: string) => { assert.equal(context, 'second'); downloads++; },
        feedbackError: () => { errors++; },
    };
    await runTelegramLinkFolderChoice(choices, next.token, 'chat:other', true, effects);
    assert.equal(downloads, 0);
    assert.equal(await runTelegramLinkFolderChoice(choices, next.token, 'chat:user', true, effects), true);
    assert.equal(downloads, 1);
    assert.equal(errors, 3);
});

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
