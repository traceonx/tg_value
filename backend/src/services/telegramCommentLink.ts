import { Api, type TelegramClient } from 'telegram';

/** Resolve only an explicitly linked comment, using the same account as the download. */
export async function resolveTelegramCommentLink(client: Pick<TelegramClient, 'invoke' | 'getMessages'>, source: string, postId: number, commentId: number) {
    if (!Number.isSafeInteger(commentId) || commentId < 1 || commentId > 2147483647) throw new Error('评论消息 ID 无效');
    const discussion = await client.invoke(new Api.messages.GetDiscussionMessage({ peer: source, msgId: postId }));
    // Telegram returns the auto-forwarded thread root last (reverse chronological order).
    const root = discussion.messages.at(-1);
    if (!(root instanceof Api.Message) || !(root.peerId instanceof Api.PeerChannel)) throw new Error('该帖子没有可访问的评论区');
    const discussionSource = `-100${root.peerId.channelId.toString()}`;
    const messages = await client.getMessages(discussionSource, { ids: [commentId] });
    const comment = messages.find(message => message instanceof Api.Message && message.id === commentId);
    if (!comment) throw new Error('指定评论已删除或当前 Telegram 账号无法读取');
    const reply = comment.replyTo;
    if (!(reply instanceof Api.MessageReplyHeader) || (reply.replyToTopId ?? reply.replyToMsgId) !== root.id) {
        throw new Error('指定消息不属于该帖子的评论区');
    }
    return { source: discussionSource, messageId: commentId };
}
