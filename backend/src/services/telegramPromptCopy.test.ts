import assert from 'node:assert/strict';
import test from 'node:test';
import { Api } from 'telegram';
import { withPromptCopyButtons } from './telegramPromptCopy.js';

test('suggested replies get native copy buttons without action callbacks', () => {
    for (const [text, expected] of [['发送“取消”可退出。', '取消'], ['Send “Cancel” to exit.', 'Cancel'], ['Отправьте «Отмена»', 'Отмена'], ['发送`跳过`继续', '跳过']]) {
        const result = withPromptCopyButtons({ buttons: undefined as unknown }, text);
        const button = (result.buttons as Api.ReplyInlineMarkup).rows[0].buttons[0];
        assert.ok(button instanceof Api.KeyboardButtonCopy);
        assert.equal(button.copyText, expected);
    }
});

test('copy hints preserve existing actions, do not mutate and deduplicate on edits', () => {
    const row = new Api.KeyboardButtonRow({ buttons: [new Api.KeyboardButtonCallback({ text: 'Next', data: Buffer.from('next') })] });
    const original = { buttons: new Api.ReplyInlineMarkup({ rows: [row] }) };
    const result = withPromptCopyButtons(original, '发送“取消”可退出。');
    assert.equal(original.buttons.rows.length, 1);
    assert.equal(result.buttons.rows[0], row);
    assert.equal(result.buttons.rows.length, 2);
    assert.equal(withPromptCopyButtons(result, '发送“取消”可退出。'), result);
    assert.equal(withPromptCopyButtons(original, '已取消任务'), original);
});
