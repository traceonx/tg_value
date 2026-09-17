import assert from 'node:assert/strict';
import test from 'node:test';
import bigInt from 'big-integer';
import { Api } from 'telegram';
import { resolveTelegramCommentLink } from './telegramCommentLink.js';

const peer = new Api.PeerChannel({ channelId: bigInt(987) });
const root = new Api.Message({ id: 4900, peerId: peer, date: 0, message: '' });
function clientFor(messages: Api.Message[], roots: Api.Message[] = [root]) {
    return {
        async invoke(request: Api.messages.GetDiscussionMessage) {
            assert.ok(request instanceof Api.messages.GetDiscussionMessage);
            assert.equal(request.peer, '@dmlfse'); assert.equal(request.msgId, 7788);
            return { messages: roots };
        },
        async getMessages(source: string, options: { ids: number[] }) {
            assert.equal(source, '-100987'); assert.deepEqual(options.ids, [4913]);
            return messages;
        },
    } as unknown as Parameters<typeof resolveTelegramCommentLink>[0];
}

test('explicit comment uses the discussion peer and supports direct and nested replies', async () => {
    for (const replyTo of [new Api.MessageReplyHeader({ replyToMsgId: 4900 }), new Api.MessageReplyHeader({ replyToMsgId: 4910, replyToTopId: 4900 })]) {
        const comment = new Api.Message({ id: 4913, peerId: peer, date: 0, message: '', replyTo });
        assert.deepEqual(await resolveTelegramCommentLink(clientFor([comment], [comment, root]), '@dmlfse', 7788, 4913), { source: '-100987', messageId: 4913 });
    }
});

test('missing comments, missing discussion and unrelated thread messages fail without falling back to the post', async () => {
    await assert.rejects(resolveTelegramCommentLink(clientFor([]), '@dmlfse', 7788, 4913), /已删除/);
    await assert.rejects(resolveTelegramCommentLink(clientFor([], []), '@dmlfse', 7788, 4913), /没有可访问/);
    const unrelated = new Api.Message({ id: 4913, peerId: peer, date: 0, message: '', replyTo: new Api.MessageReplyHeader({ replyToMsgId: 3000 }) });
    await assert.rejects(resolveTelegramCommentLink(clientFor([unrelated]), '@dmlfse', 7788, 4913), /不属于/);
});

test('Telegram access errors propagate instead of being converted to success', async () => {
    const client = clientFor([]);
    client.invoke = async () => { throw new Error('CHANNEL_PRIVATE'); };
    await assert.rejects(resolveTelegramCommentLink(client, '@dmlfse', 7788, 4913), /CHANNEL_PRIVATE/);
});
