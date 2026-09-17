import test from 'node:test';
import assert from 'node:assert/strict';
import { Api } from 'telegram';
import { buildTelegramFileCopyKeyboard } from './telegramFileCopyKeyboard.js';

test('file card copies its folder name and keeps file details separate', () => {
    const name = '完整文件名_含[括号]和`符号`'.repeat(4) + '.mp4';
    const id = '00000000-0000-4000-8000-000000000001';
    const folder = 'parent/完整[目录]`名称`';
    const keyboard = buildTelegramFileCopyKeyboard([{ name, id, folder }], 'zh-CN')!;
    const [copy, detail] = keyboard.rows[0].buttons;
    assert.ok(copy instanceof Api.KeyboardButtonCopy);
    assert.equal(copy.copyText, '完整[目录]`名称`');
    assert.ok(copy.text.length < name.length);
    assert.ok(detail instanceof Api.KeyboardButtonCallback);
    assert.equal(detail.data.toString(), `fb_detail_${id}`);
    assert.match(detail.text, /^详情/);
});

test('unindexed file folder can be copied without a mutation callback', () => {
    const keyboard = buildTelegramFileCopyKeyboard([{ name: '磁盘文件.mp4', folder: '目录' }])!;
    assert.equal(keyboard.rows[0].buttons.length, 1);
    assert.ok(keyboard.rows[0].buttons[0] instanceof Api.KeyboardButtonCopy);
    assert.equal(buildTelegramFileCopyKeyboard([]), undefined);
});
