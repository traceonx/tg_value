import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_COMMANDS, buildBotCommandMenu, buildBotHelpSections, findBotCommand } from './telegramCommandRegistry.js';
import { t, TELEGRAM_LOCALES } from '../i18n/telegram.js';

test('Bot command registry is the single source for menu and help', () => {
    const menu = buildBotCommandMenu();
    const helpCommands = buildBotHelpSections().flatMap(section => section.commands.map(command => command.command));
    assert.deepEqual(menu.map(command => command.command), BOT_COMMANDS.filter(command => command.menu).map(command => command.command));
    assert.deepEqual(new Set(helpCommands), new Set(BOT_COMMANDS.filter(command => command.help).map(command => command.command)));
    assert.equal(menu.find(command => command.command === 'help')?.description, '查看完整帮助');
});

test('high-frequency commands lead the menu and legacy aliases stay hidden', () => {
    assert.deepEqual(buildBotCommandMenu().map(command => command.command), ['start', 'download', 'files', 'tasks', 'subscriptions', 'settings', 'help']);
    assert.equal(findBotCommand('/task')?.command, 'tasks');
    assert.equal(findBotCommand('/cleanup')?.command, 'cleanup_settings');
    assert.equal(buildBotCommandMenu().some(command => command.command === 'cleanup'), false);
});

test('cleanup command labels name the affected object instead of generic cleanup', () => {
    assert.match(findBotCommand('/cleanup_settings')!.description, /临时文件/);
    assert.match(findBotCommand('/storage')!.description, /本地实体文件/);
});

test('message link download is discoverable with localized folder examples', () => {
    assert.equal(findBotCommand('/tg_link')?.menu, false);
    assert.equal(findBotCommand('/tg_link')?.help, false);
    for (const locale of Object.values(TELEGRAM_LOCALES)) {
        const entry = buildBotCommandMenu(locale.code).find(command => command.command === 'download');
        assert.ok(entry?.description);
        const help = t(locale.code, 'bot.link.help');
        assert.match(help, /https:\/\/t.me\/lspyanxi\/4375/);
        assert.match(help, /2026-09-09/);
        assert.match(help, /\/ps/);
    }
});
