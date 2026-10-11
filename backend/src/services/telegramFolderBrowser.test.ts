import assert from 'node:assert/strict';
import test from 'node:test';
import { Api } from 'telegram';
import { folderEntries, TelegramFolderBrowser } from './telegramFolderBrowser.js';

test('folder navigation lists immediate children, direct files and empty directories', () => {
    const files = [{ name: 'root.txt' }, { name: '01.mp4', folder: 'Dark Blue' }, { name: '02.mp4', folder: 'Dark Blue/Season2' }, { name: '.folder', folder: 'Empty' }];
    assert.deepEqual(folderEntries(files, '').folders, ['Dark Blue', 'Empty']);
    assert.deepEqual(folderEntries(files, '').files.map(file => file.name), ['root.txt']);
    assert.deepEqual(folderEntries(files, 'Dark Blue').folders, ['Dark Blue/Season2']);
    assert.deepEqual(folderEntries(files, 'Dark Blue').files.map(file => file.name), ['01.mp4']);
    assert.deepEqual(folderEntries(files, 'Empty').files, []);
});

test('compact folder navigation enforces scope, expiry and pagination without copy buttons', () => {
    let now = 0;
    const browser = new TelegramFolderBrowser(() => now);
    const files = Array.from({ length: 25 }, (_, i) => ({ name: 'video.mp4', folder: `Folder${String(i).padStart(2, '0')}` }));
    const view = browser.render(files, 'chat:user:storage', 'zh-CN');
    const open = view.buttons.rows[0].buttons[0] as Api.KeyboardButtonCallback;
    assert.ok(view.buttons.rows.flatMap(row => row.buttons).every(button => !(button instanceof Api.KeyboardButtonCopy)));
    assert.doesNotMatch(view.message, /Folder00/);
    assert.match(view.message, /25 个文件夹/);
    assert.ok(open.data.length <= 64);
    const token = open.data.toString().slice('folders_'.length);
    assert.equal(browser.resolve(token, 'chat:user:storage')?.folder, 'Folder00');
    assert.equal(browser.resolve(token, 'chat:other:storage'), null);
    assert.equal(browser.resolve(token, 'chat:user:other'), null);
    const next = view.buttons.rows.at(-2)!.buttons[0] as Api.KeyboardButtonCallback;
    const state = browser.resolve(next.data.toString().slice('folders_'.length), 'chat:user:storage')!;
    const page = browser.render(files, state.scope, 'zh-CN', state.folder, state.page);
    assert.match(page.buttons.rows[0].buttons[0].text, /Folder10/);
    assert.equal(page.buttons.rows.at(-2)!.buttons.length, 2);
    const refresh = page.buttons.rows.at(-1)!.buttons[0] as Api.KeyboardButtonCallback;
    assert.equal(browser.resolve(refresh.data.toString().slice('folders_'.length), state.scope)?.page, 1);
    const inside = browser.render(files, state.scope, 'zh-CN', 'Folder00');
    assert.match(inside.message, /video.mp4/);
    const parent = inside.buttons.rows.at(-1)!.buttons[0] as Api.KeyboardButtonCallback;
    assert.equal(browser.resolve(parent.data.toString().slice('folders_'.length), state.scope)?.folder, '');
    now = 15 * 60_000;
    assert.equal(browser.resolve(token, state.scope), null);
});

test('nested navigation provides parent and root and lists indexed files only as buttons', () => {
    const browser = new TelegramFolderBrowser();
    const files = [{ name: 'video.mp4', folder: 'A/B', id: 'file-id' }];
    const view = browser.render(files, 'scope', 'zh-CN', 'A/B');
    assert.match(view.message, /A\/B/);
    assert.doesNotMatch(view.message, /video.mp4/);
    assert.equal((view.buttons.rows[0].buttons[0] as Api.KeyboardButtonCallback).data.toString(), 'fb_detail_file-id');
    const destinations = view.buttons.rows.at(-1)!.buttons.map(button => browser.resolve((button as Api.KeyboardButtonCallback).data.toString().slice('folders_'.length), 'scope')?.folder);
    assert.deepEqual(destinations, ['A', '', 'A/B']);
    const empty = browser.render([], 'scope', 'zh-CN', 'Empty');
    assert.match(empty.message, /此文件夹为空/);
    assert.equal(empty.buttons.rows.length, 1);
});

