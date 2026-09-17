import { Api, type TelegramClient } from 'telegram';

/** Make explicitly suggested replies copyable without sending or executing them. */
export function withPromptCopyButtons<T extends { buttons?: unknown }>(options: T, text: unknown): T {
    if (typeof text !== 'string') return options;
    const values = new Set<string>();
    // Include text inside code/quotes immediately following a "send" instruction.
    for (const match of text.matchAll(/(?:发送|回复|send|reply(?: with)?|отправьте)\s*[“"«`]+([^”"»`\r\n]{1,100})[”"»`]+/gi)) values.add(match[1]);
    if (!values.size || (options.buttons && !(options.buttons instanceof Api.ReplyInlineMarkup))) return options;
    const rows = options.buttons instanceof Api.ReplyInlineMarkup ? options.buttons.rows : [];
    const existing = new Set(rows.flatMap(row => row.buttons).filter(button => button instanceof Api.KeyboardButtonCopy).map(button => button.copyText));
    const copies = [...values].filter(value => !existing.has(value)).slice(0, 4).map(value => new Api.KeyboardButtonCopy({ text: `📋 ${value}`, copyText: value }));
    return copies.length ? { ...options, buttons: new Api.ReplyInlineMarkup({ rows: [...rows, new Api.KeyboardButtonRow({ buttons: copies })] }) } : options;
}

export function installTelegramPromptCopy(client: TelegramClient): void {
    const send = client.sendMessage.bind(client);
    client.sendMessage = ((entity, options) => send(entity, options ? withPromptCopyButtons(options, options.message) : options)) as TelegramClient['sendMessage'];
    const edit = client.editMessage.bind(client);
    client.editMessage = ((entity, options) => edit(entity, withPromptCopyButtons(options, options.text))) as TelegramClient['editMessage'];
}
