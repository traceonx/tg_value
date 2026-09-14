import test from 'node:test';
import assert from 'node:assert/strict';
import { Api } from 'telegram';
import { commandLabel, menuPanels, menuLabels } from './telegramMenu.js';
import { findBotCommand, buildBotCommandMenu } from '../utils/telegramCommandRegistry.js';
import { buildHelp } from '../utils/telegramMessages.js';
import { callbackActorMessage } from './telegramCallbackMessage.js';
import { TELEGRAM_LOCALES } from '../i18n/telegram.js';

test('seven public entries have localized menus and retain legacy commands', () => {
    for (const locale of ['zh-CN', 'en', 'ru'] as const) {
        const menu = buildBotCommandMenu(locale);
        assert.equal(menu.length, 7);
        assert.equal(menu.find(item => item.command === 'settings')?.description, (menuLabels[locale] || menuLabels.zh).settings);
        assert.ok(buildHelp(locale).includes('/download'));
        assert.ok(!buildHelp(locale).includes('/download_workers'));
    }
    for (const name of ['list', 'find', 'tg_dl', 'workers', 'task_pause', 'task_resume', 'task_cancel']) {
        assert.ok(findBotCommand('/' + name), name);
    }
});

test('panels expose existing operational handlers and stay within callback limits', () => {
    for (const [panel, rows] of Object.entries(menuPanels)) {
        assert.ok(findBotCommand('/' + panel)?.requiresAuth);
        for (const command of rows.flat()) {
            assert.ok(findBotCommand('/' + command), command);
            assert.ok(Buffer.byteLength(`home_open_${command}`) < 64);
        }
    }
    assert.deepEqual(menuPanels.download.flat(), ['tg_link', 'tg_download']);
    assert.ok(menuPanels.settings.flat().includes('file_concurrency'));
});

test('every menu panel and button renders in every supported locale', () => {
    for (const locale of Object.values(TELEGRAM_LOCALES)) {
        for (const [panel, rows] of Object.entries(menuPanels)) {
            for (const command of [panel, ...rows.flat()]) {
                assert.ok(commandLabel(command, locale.code));
            }
        }
    }
});

test('file/settings command context authenticates the clicking user and replies in the original chat', async () => {
    const botId = { toJSNumber: () => 999 } as Api.UpdateBotCallbackQuery['userId'];
    const actorId = { toJSNumber: () => 123 } as Api.UpdateBotCallbackQuery['userId'];
    const chatId = { toString: () => '-100456' };
    const sent: unknown[] = [];
    const original = {
        senderId: botId, chatId, id: 42,
        async reply(this: Api.Message, payload: unknown) { sent.push([this.chatId, this.id, payload]); },
    } as unknown as Api.Message;
    const contextual = callbackActorMessage(original, actorId);
    const authenticatedUsers = new Set([123]);
    assert.equal(authenticatedUsers.has(contextual.senderId!.toJSNumber()), true);
    assert.equal(original.senderId, botId);
    assert.equal(contextual.fromId instanceof Api.PeerUser, true);
    await contextual.reply({ message: 'files' });
    assert.deepEqual(sent, [[chatId, 42, { message: 'files' }]]);
    assert.throws(() => callbackActorMessage(undefined as unknown as Api.Message, actorId), /unavailable/);
});
