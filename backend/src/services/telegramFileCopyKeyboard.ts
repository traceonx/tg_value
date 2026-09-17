import { Api } from 'telegram';
import { DEFAULT_LOCALE, t, type TelegramLocale } from '../i18n/telegram.js';

export function buildTelegramFileCopyKeyboard(files: Array<{ name: string; id?: string; folder?: string | null }>, locale: TelegramLocale = DEFAULT_LOCALE): Api.ReplyInlineMarkup | undefined {
    if (!files.length) return undefined;
    return new Api.ReplyInlineMarkup({ rows: files.slice(0, 12).map(file => {
        const buttons: Api.TypeKeyboardButton[] = [];
        if (file.folder) buttons.push(new Api.KeyboardButtonCopy({
            text: `📋 ${file.folder.split('/').at(-1)!.slice(0, 38)}`,
            copyText: file.folder.split('/').at(-1)!,
        }));
        if (file.id) buttons.push(new Api.KeyboardButtonCallback({
            text: `${t(locale, 'fileBrowser.detail')} · ${file.name.slice(0, 30)}`, data: Buffer.from(`fb_detail_${file.id}`),
        }));
        return new Api.KeyboardButtonRow({ buttons });
    }).filter(row => row.buttons.length > 0) });
}
