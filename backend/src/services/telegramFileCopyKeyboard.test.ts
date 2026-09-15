import test from 'node:test';
import assert from 'node:assert/strict';
import { Api } from 'telegram';
import { buildTelegramFileCopyKeyboard } from './telegramFileCopyKeyboard.js';

test('filename button copies the complete literal filename and keeps details separate', () => {
    const name = '完整文件名_含[括号]和`符号`'.repeat(4) + '.mp4';
    const id = '00000000-0000-4000-8000-000000000001';
    const keyboard = buildTelegramFileCopyKeyboard([{ name, id }], 'zh-CN')!;
    const [copy, detail] = keyboard.rows[0].buttons;
    assert.ok(copy instanceof Api.KeyboardButtonCopy);
    assert.equal(copy.copyText, name);
    assert.ok(copy.text.length < name.length);
    assert.ok(detail instanceof Api.KeyboardButtonCallback);
    assert.equal(detail.data.toString(), `fb_detail_${id}`);
    assert.equal(detail.text, '详情');
});

test('unindexed file names can be copied without an authenticated mutation callback', () => {
    const keyboard = buildTelegramFileCopyKeyboard([{ name: '磁盘文件.mp4' }])!;
    assert.equal(keyboard.rows[0].buttons.length, 1);
    assert.ok(keyboard.rows[0].buttons[0] instanceof Api.KeyboardButtonCopy);
    assert.equal(buildTelegramFileCopyKeyboard([]), undefined);
});
