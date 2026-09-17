import assert from 'node:assert/strict';
import test from 'node:test';
import bigInt from 'big-integer';
import { Api } from 'telegram';
import { scanCommentVideos, COMMENT_SCAN_PAGE_SIZE, CommentVideoChoices, commentVideoMenu, commentMessageScope, commentCallbackScope, collectAllCommentVideos, commentDownloadLink, type CommentVideoPage } from './telegramCommentVideos.js';

const group = new Api.PeerChannel({ channelId: bigInt(987) });
const channel = new Api.PeerChannel({ channelId: bigInt(123) });
function media(mimeType = 'video/mp4', videoAttribute = false) {
    return new Api.MessageMediaDocument({ document: new Api.Document({
        id: bigInt(1), accessHash: bigInt(2), fileReference: Buffer.alloc(0), date: 0,
        mimeType, size: bigInt(1536), dcId: 1,
        attributes: [new Api.DocumentAttributeFilename({ fileName: mimeType.startsWith('video/') ? 'clip.mp4' : 'file.bin' }),
            ...(videoAttribute ? [new Api.DocumentAttributeVideo({ duration: 10, w: 100, h: 100 })] : [])],
    }) });
}
function comment(id: number, mimeType?: string, threadId = 4900) {
    return new Api.Message({ id, peerId: group, date: 0, message: 'caption',
        replyTo: new Api.MessageReplyHeader({ replyToMsgId: threadId }), ...(mimeType ? { media: media(mimeType) } : {}),
    });
}
function clientFor(comments: Api.Message[], hasComments = true, expectedOffset = 0) {
    const calls: string[] = [];
    const post = new Api.Message({ id: 7788, peerId: channel, date: 0, message: 'post', media: media(),
        ...(hasComments ? { replies: new Api.MessageReplies({ comments: true, replies: 80, repliesPts: 1, channelId: bigInt(987) }) } : {}),
    });
    const client = {
        async getMessages(source: string, options: { ids?: number[]; replyTo?: number; limit?: number; offsetId?: number }) {
            if (options.ids) { assert.equal(source, '@dmlfse'); assert.deepEqual(options.ids, [7788]); calls.push('post'); return [post]; }
            assert.equal(source, '-100987'); assert.equal(options.replyTo, 4900);
            assert.equal(options.limit, COMMENT_SCAN_PAGE_SIZE); assert.equal(options.offsetId, expectedOffset);
            calls.push('comments'); return comments;
        },
        async invoke(request: Api.messages.GetDiscussionMessage) {
            assert.ok(request instanceof Api.messages.GetDiscussionMessage);
            assert.equal(request.peer, '@dmlfse'); assert.equal(request.msgId, 7788);
            calls.push('discussion');
            return { messages: [new Api.Message({ id: 4900, peerId: group, date: 0, message: 'root' })] };
        },
    } as unknown as Parameters<typeof scanCommentVideos>[0];
    return { client, calls };
}

test('comment scan lists videos in the linked thread, excluding text, other threads and duplicates', async () => {
    const attributeVideo = comment(4920, 'application/octet-stream');
    attributeVideo.media = media('application/octet-stream', true);
    const video = comment(4913, 'video/mp4');
    const { client, calls } = clientFor([attributeVideo, video, video, comment(4912), comment(4911, 'audio/mpeg'), comment(4910, 'video/mp4', 4000)]);
    const page = (await scanCommentVideos(client, '@dmlfse', 7788))!;
    assert.deepEqual(page.videos.map(video => video.id), [4920, 4913]);
    assert.equal(page.videos[1].size, 1536);
    assert.equal(page.hasPostFile, true); assert.equal(page.nextOffset, undefined);
    assert.deepEqual(calls, ['post', 'discussion', 'comments']);
});

test('ordinary posts without a comment section never query group history', async () => {
    const { client, calls } = clientFor([], false);
    assert.equal(await scanCommentVideos(client, '@dmlfse', 7788), null);
    assert.deepEqual(calls, ['post']);
});

test('pages without videos still allow scanning older comments and terminate when exhausted', async () => {
    const messages = Array.from({ length: COMMENT_SCAN_PAGE_SIZE }, (_, i) => comment(5000 - i));
    const first = (await scanCommentVideos(clientFor(messages).client, '@dmlfse', 7788))!;
    assert.equal(first.videos.length, 0); assert.equal(first.nextOffset, 4971);
    const second = (await scanCommentVideos(clientFor([comment(4970, 'video/mp4')], true, 4971).client, '@dmlfse', 7788, 4971))!;
    assert.equal(second.videos.length, 1); assert.equal(second.nextOffset, undefined);
});

test('scan access errors propagate without reporting an empty comment section', async () => {
    const { client } = clientFor([]);
    client.invoke = async () => { throw new Error('CHANNEL_PRIVATE'); };
    await assert.rejects(scanCommentVideos(client, '@dmlfse', 7788), /CHANNEL_PRIVATE/);
});

const page: CommentVideoPage = { videos: [{ id: 4913, name: 'clip.mp4', size: 1536 }], scanned: 30, hasPostFile: true, nextOffset: 4901 };
test('selection is scoped, validated, expires and cannot submit duplicate downloads', () => {
    let now = 0;
    const choices = new CommentVideoChoices<{ folderName: string; fileName: string }>(() => now);
    const context = { folderName: 'A/B', fileName: '1' };
    const token = choices.create('chat:user', context, page);
    assert.equal(choices.consume(token, 'chat:other', '4913'), null);
    assert.equal(choices.consume(token, 'other:user', '4913'), null);
    assert.equal(choices.consume(token, 'chat:user', '9999'), null);
    assert.equal(choices.consume(token, 'chat:user', '4913')?.context, context);
    assert.equal(choices.consume(token, 'chat:user', '4913'), null);
    const expired = choices.create('chat:user', context, page);
    now = 600_000;
    assert.equal(choices.consume(expired, 'chat:user', 'post'), null);
    const cancel = choices.create('chat:user', context, page);
    assert.ok(choices.consume(cancel, 'chat:user', 'cancel'));
    assert.equal(choices.consume(cancel, 'chat:user', 'post'), null);
    const noActions = choices.create('chat:user', context, { videos: [], scanned: 0, hasPostFile: false });
    assert.equal(choices.consume(noActions, 'chat:user', 'next'), null);
    assert.equal(choices.consume(noActions, 'chat:user', 'post'), null);
});

test('menu presents file size, page navigation, post and cancel in all locales', () => {
    for (const locale of ['zh-CN', 'en', 'ru'] as const) {
        const view = commentVideoMenu(page, 'a'.repeat(32), locale);
        assert.equal(view.parseMode, false);
        assert.match(view.message, /clip.mp4/); assert.match(view.message, /1[.,]5/);
        const buttons = view.buttons.rows.flatMap(row => row.buttons) as Api.KeyboardButtonCallback[];
        assert.deepEqual(buttons.map(button => button.data.toString().split('_').at(-1)), ['4913', 'all', 'next', 'post', 'cancel']);
        assert.ok(buttons.every(button => button.data.length <= 64));
    }
});

test('private, group and channel callbacks resolve choices without retrieving the bot menu message', () => {
    for (const [chatId, peer] of [
        ['42', new Api.PeerUser({ userId: bigInt(42) })],
        ['-987', new Api.PeerChat({ chatId: bigInt(987) })],
        ['-100987', new Api.PeerChannel({ channelId: bigInt(987) })],
    ] as const) {
        const message = { chatId: bigInt(chatId) } as Api.Message;
        const callback = new Api.UpdateBotCallbackQuery({ queryId: bigInt(1), userId: bigInt(42), peer, msgId: 9, chatInstance: bigInt(1) });
        const choices = new CommentVideoChoices<string>();
        const token = choices.create(commentMessageScope(message, 42), 'original-request', page);
        assert.equal(choices.consume(token, commentCallbackScope(callback), '4913')?.context, 'original-request');
    }
});

test('download all is single-use and available even when the first page has no video', () => {
    const choices = new CommentVideoChoices<string>();
    const token = choices.create('chat:user', 'request', { ...page, videos: [] });
    assert.equal(choices.consume(token, 'other:user', 'all'), null);
    assert.equal(choices.consume(token, 'chat:user', 'all')?.context, 'request');
    assert.equal(choices.consume(token, 'chat:user', 'all'), null);
    const empty = choices.create('chat:user', 'request', { ...page, videos: [], nextOffset: undefined });
    assert.equal(choices.consume(empty, 'chat:user', 'all'), null);
});

test('download all traverses empty pages, deduplicates and includes videos beyond the displayed page', async () => {
    const offsets: number[] = [];
    const videos = await collectAllCommentVideos(async offset => {
        offsets.push(offset);
        if (!offset) return { ...page, videos: [], nextOffset: 5000 };
        if (offset === 5000) return { ...page, nextOffset: 4900 };
        return { ...page, videos: [...page.videos, { id: 4890, name: 'older.mp4', size: 1024 }], nextOffset: undefined };
    });
    assert.deepEqual(offsets, [0, 5000, 4900]);
    assert.deepEqual(videos.map(video => video.id), [4913, 4890]);
    assert.deepEqual(await collectAllCommentVideos(async () => null), []);
});

test('incomplete scans and stuck pagination cannot silently report all videos collected', async () => {
    await assert.rejects(collectAllCommentVideos(async offset => offset ? null : page), /不可访问/);
    await assert.rejects(collectAllCommentVideos(async () => page), /未向前推进/);
    await assert.rejects(collectAllCommentVideos(async () => { throw new Error('FLOOD_WAIT_10'); }), /FLOOD_WAIT/);
});

test('batch naming preserves nested folders and extensions while distinguishing videos', () => {
    const link = { source: '@channel', messageId: 7788, folderName: 'A/B', fileName: '1.mp4' };
    assert.deepEqual(commentDownloadLink(link, 4913, true), { ...link, commentId: 4913, fileName: '1-4913.mp4' });
    assert.equal(commentDownloadLink({ ...link, fileName: '1' }, 4913, true).fileName, '1-4913');
    assert.equal(commentDownloadLink(link, 4913, false).fileName, '1.mp4');
    assert.equal(commentDownloadLink({ source: '@channel', messageId: 7788 }, 4913, true).fileName, undefined);
});
