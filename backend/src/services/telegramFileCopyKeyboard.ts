import { Api } from 'telegram';
import { DEFAULT_LOCALE, t, type TelegramLocale } from '../i18n/telegram.js';

export function buildTelegramFileCopyKeyboard(files: Array<{ name: string; id?: string }>, locale: TelegramLocale = DEFAULT_LOCALE): Api.ReplyInlineMarkup | undefined {
    if (!files.length) return undefined;
    return new Api.ReplyInlineMarkup({ rows: files.slice(0, 12).map(file => {
        const buttons: Api.TypeKeyboardButton[] = [new Api.KeyboardButtonCopy({
            text: `📋 ${file.name.length > 38 ? file.name.slice(0, 37) + '…' : file.name}`,
            copyText: file.name,
        })];
        if (file.id) buttons.push(new Api.KeyboardButtonCallback({
            text: t(locale, 'fileBrowser.detail'), data: Buffer.from(`fb_detail_${file.id}`),
        }));
        return new Api.KeyboardButtonRow({ buttons });
    }) });
}
