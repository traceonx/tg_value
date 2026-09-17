import { randomUUID } from 'node:crypto';
import { Api, type TelegramClient } from 'telegram';
import { extractFileInfo, getEstimatedFileSize } from '../utils/telegramMedia.js';
import { t, formatBytes, type TelegramLocale } from '../i18n/telegram.js';
import { messageChatKey, callbackChatKey } from '../bot/context.js';
import type { TelegramMessageLink } from './telegramMessageLink.js';
import path from 'node:path';

export function commentMessageScope(message: Api.Message, userId: number): string {
    return `${messageChatKey(message, userId)}:${userId}`;
}
export function commentCallbackScope(update: Api.UpdateBotCallbackQuery): string {
    const userId = update.userId.toJSNumber();
    return `${callbackChatKey(update, userId)}:${userId}`;
}

export const COMMENT_SCAN_PAGE_SIZE = 30;
export interface CommentVideoPage {
    videos: { id: number; name: string; size: number }[];
    scanned: number;
    nextOffset?: number;
    hasPostFile: boolean;
}

export async function collectAllCommentVideos(readPage: (offset: number) => Promise<CommentVideoPage | null>) {
    const videos = new Map<number, CommentVideoPage['videos'][number]>();
    let offset = 0;
    for (;;) {
        const page = await readPage(offset);
        if (!page) {
            if (offset) throw new Error('评论区在扫描期间已不可访问，请重新发送链接');
            break;
        }
        for (const video of page.videos) if (!videos.has(video.id)) videos.set(video.id, video);
        if (page.nextOffset === undefined) break;
        if (page.nextOffset <= 0 || (offset && page.nextOffset >= offset)) throw new Error('评论分页未向前推进，请重新发送链接');
        offset = page.nextOffset;
    }
    return [...videos.values()];
}

export function commentDownloadLink(link: TelegramMessageLink, commentId: number, multiple: boolean): TelegramMessageLink {
    let fileName = link.fileName;
    if (fileName !== undefined && multiple) {
        const extension = path.extname(fileName);
        fileName = `${extension ? fileName.slice(0, -extension.length) : fileName}-${commentId}${extension}`;
    }
    return { ...link, commentId, ...(fileName === undefined ? {} : { fileName }) };
}

/** Read one bounded page of this post's discussion; never start a download. */
export async function scanCommentVideos(client: Pick<TelegramClient, 'getMessages' | 'invoke'>, source: string, postId: number, offsetId = 0): Promise<CommentVideoPage | null> {
    const posts = await client.getMessages(source, { ids: [postId] });
    const post = posts.find(message => message instanceof Api.Message && message.id === postId);
    if (!post) throw new Error('帖子已删除或当前账号无法读取');
    if (!post.replies?.comments || !post.replies.replies) return null;
    const discussion = await client.invoke(new Api.messages.GetDiscussionMessage({ peer: source, msgId: postId }));
    const root = discussion.messages.at(-1);
    if (!(root instanceof Api.Message) || !(root.peerId instanceof Api.PeerChannel)) throw new Error('评论区不可访问');
    const sourceId = root.peerId.channelId.toString();
    const messages = await client.getMessages(`-100${sourceId}`, { replyTo: root.id, limit: COMMENT_SCAN_PAGE_SIZE, offsetId });
    const videos: CommentVideoPage['videos'] = [];
    const seen = new Set<number>();
    for (const message of messages) {
        if (!(message instanceof Api.Message) || !(message.peerId instanceof Api.PeerChannel) || message.peerId.channelId.toString() !== sourceId) continue;
        const reply = message.replyTo;
        if (!(reply instanceof Api.MessageReplyHeader) || (reply.replyToTopId ?? reply.replyToMsgId) !== root.id) continue;
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        const info = extractFileInfo(message);
        const videoAttribute = message.document instanceof Api.Document && message.document.attributes.some(attribute => attribute instanceof Api.DocumentAttributeVideo);
        if (!info || (!info.mimeType.startsWith('video/') && !videoAttribute)) continue;
        const caption = message.message?.split(/\r?\n/)[0]?.trim();
        videos.push({ id: message.id, name: (info.generatedName && caption ? caption : info.fileName).replace(/[\r\n\t]/g, ' ').slice(0, 70), size: getEstimatedFileSize(message) });
    }
    const oldest = messages.reduce((min, message) => message.id > 0 ? Math.min(min, message.id) : min, Infinity);
    return {
        videos, scanned: messages.length, hasPostFile: Boolean(extractFileInfo(post)),
        ...(messages.length >= COMMENT_SCAN_PAGE_SIZE && Number.isFinite(oldest) && (!offsetId || oldest < offsetId) ? { nextOffset: oldest } : {}),
    };
}

/** A menu is bound to its requesting user/chat and can submit just one selection. */
export class CommentVideoChoices<T> {
    private entries = new Map<string, { scope: string; context: T; page: CommentVideoPage; expires: number }>();
    constructor(private now = Date.now) {}
    create(scope: string, context: T, page: CommentVideoPage): string {
        for (const [key, row] of this.entries) if (row.expires <= this.now()) this.entries.delete(key);
        while (this.entries.size >= 1000) this.entries.delete(this.entries.keys().next().value!);
        const token = randomUUID().replaceAll('-', '');
        this.entries.set(token, { scope, context, page, expires: this.now() + 10 * 60_000 });
        return token;
    }
    consume(token: string, scope: string, action: string) {
        const row = this.entries.get(token);
        if (!row || row.scope !== scope || row.expires <= this.now()) return null;
        const allowed = action === 'cancel' || (action === 'next' && row.page.nextOffset !== undefined)
            || (action === 'all' && (row.page.videos.length > 0 || row.page.nextOffset !== undefined))
            || (action === 'post' && row.page.hasPostFile) || row.page.videos.some(video => String(video.id) === action);
        if (!allowed) return null;
        this.entries.delete(token);
        return row;
    }
}

export function commentVideoMenu(page: CommentVideoPage, token: string, locale: TelegramLocale) {
    const button = (text: string, action: string) => new Api.KeyboardButtonRow({ buttons: [new Api.KeyboardButtonCallback({ text, data: Buffer.from(`cv_${token}_${action}`) })] });
    const lines = [t(locale, 'bot.comments.title', { count: page.videos.length, scanned: page.scanned }), t(locale, 'bot.comments.choose'), ''];
    const rows: Api.KeyboardButtonRow[] = [];
    page.videos.forEach((video, index) => {
        lines.push(`${index + 1}. ${video.name} · ${formatBytes(video.size, locale)}`);
        rows.push(button(t(locale, 'bot.comments.download', { number: index + 1 }), String(video.id)));
    });
    if (!page.videos.length) lines.push(t(locale, 'bot.comments.empty'));
    if (page.videos.length || page.nextOffset !== undefined) rows.push(button(t(locale, 'bot.comments.all'), 'all'));
    if (page.nextOffset !== undefined) rows.push(button(t(locale, 'bot.comments.next'), 'next'));
    if (page.hasPostFile) rows.push(button(t(locale, 'bot.comments.post'), 'post'));
    rows.push(button(t(locale, 'common.cancel'), 'cancel'));
    return { message: lines.join('\n'), parseMode: false as const, buttons: new Api.ReplyInlineMarkup({ rows }) };
}
