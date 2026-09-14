import assert from 'node:assert/strict';
import test from 'node:test';
import { menuPanels, menuLabels } from './telegramMenu.js';
import { findBotCommand, buildBotCommandMenu } from '../utils/telegramCommandRegistry.js';
import { buildHelp } from '../utils/telegramMessages.js';

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
