import { t, formatNumber, formatBytes, DEFAULT_LOCALE, type TelegramLocale } from '../i18n/telegram.js';
import { transferProgressLines } from './telegramTransferProgress.js';
import type { ConsolidatedUploadFile } from './telegramMessages.js';

export function transferName(value: string): string {
    // Status messages use plain text, so filenames cannot become markup or extra rows.
    return value.replace(/[\r\n\u0000-\u001f]/g, ' ');
}

export function buildTransferStatus(files: ConsolidatedUploadFile[], options: {
    total?: number; complete?: boolean; failed?: number; paused?: boolean; pausing?: boolean;
    startedAt?: number; endedAt?: number; locale?: TelegramLocale;
} = {}): string {
    const locale = options.locale || DEFAULT_LOCALE;
    const words = {
        active: t(locale, 'transfer.active'),
        queued: t(locale, 'transfer.queued'),
        done: t(locale, 'transfer.done'),
        complete: t(locale, 'transfer.complete'),
        partial: t(locale, 'transfer.partial'),
        failed: t(locale, 'transfer.failed'),
        cancelled: t(locale, 'transfer.cancelled'),
        saving: t(locale, 'transfer.saving'),
        retry: t(locale, 'transfer.retry'),
        unknown: t(locale, 'transfer.unknown'),
        root: t(locale, 'transfer.root'),
        paused: t(locale, 'transfer.paused'),
        pausing: t(locale, 'transfer.pausing'),
        error: t(locale, 'transfer.error')
    };
    const countText = (count: number) => t(locale, 'transfer.count.' + new Intl.PluralRules(locale).select(count), { count: formatNumber(count, locale) });
    const active = files.filter(f => ['downloading', 'saving', 'retrying'].includes(f.phase));
    const waiting = files.filter(f => f.phase === 'queued');
    const done = files.filter(f => f.phase === 'success');
    const failed = files.filter(f => f.phase === 'failed');
    const cancelled = files.filter(f => f.phase === 'cancelled');
    const total = options.total ?? files.length;
    const complete = total > 0 && (options.complete ?? (done.length + failed.length + cancelled.length === total));
    const hasErrors = (options.failed ?? failed.length) > 0 || cancelled.length > 0;
    const title = complete ? `${hasErrors ? '⚠️' : '✅'} ${hasErrors ? words.partial : words.complete} · ${countText(total)}`
        : options.paused ? `⏸️ ${words.paused}` : options.pausing ? `⏸️ ${words.pausing}` : `📥 ${words.active} · ${countText(active.length)}`;
    const blocks: string[] = [title];
    const size = (f: ConsolidatedUploadFile) => (f.size ?? f.total) === undefined ? words.unknown : formatBytes(f.size ?? f.total ?? 0, locale);
    const brief = (f: ConsolidatedUploadFile) => `📄 ${transferName(f.fileName)} · ${size(f)}`;
    let shown = 0;
    let truncated = false;
    const addFile = (text: string) => {
        // Leave room for totals, omission notice and task controls in the caller.
        if (blocks.join('\n\n').length + text.length > 3000) { truncated = true; return; }
        blocks.push(text); shown++;
    };
    if (!complete) {
        for (const file of active) {
            addFile([
                `📄 ${transferName(file.fileName)}`,
                ...(options.paused || options.pausing ? [`⏸️ ${words.paused}`] : file.phase === 'saving' ? [`💾 ${words.saving}`]
                    : file.phase === 'retrying' ? [`🔄 ${words.retry}`]
                        : transferProgressLines(file.downloaded || 0, file.total || 0, file.transferProgress, locale)),
            ].join('\n'));
        }
        if (waiting.length) blocks.push(`🕓 ${words.queued} · ${countText(waiting.length)}`);
        waiting.forEach(file => addFile(brief(file)));
        if (done.length) blocks.push(`✅ ${words.done} · ${countText(done.length)}`);
    }
    done.forEach(file => addFile(brief(file) + (complete ? `\n📂 ${transferName(file.folder === undefined ? '—' : file.folder || words.root)}` : '')));
    if (failed.length) blocks.push(`❌ ${words.failed} · ${countText(failed.length)}`);
    failed.forEach(file => addFile(`${brief(file)}\n❌ ${transferName(file.error && (locale === 'zh-CN' || !/[\u3400-\u9fff]/.test(file.error)) ? file.error : words.error)}`));
    if (cancelled.length) blocks.push(`🚫 ${words.cancelled} · ${countText(cancelled.length)}`);
    cancelled.forEach(file => addFile(brief(file)));
    if (truncated || files.length < total) blocks.push(t(locale, 'transfer.more', { count: formatNumber(Math.max(0, total - shown), locale) }));
    if (complete) {
        if (files.length === total && done.every(f => (f.size ?? f.total) !== undefined)) {
            blocks.push(t(locale, 'transfer.total', { size: formatBytes(done.reduce((sum, f) => sum + (f.size ?? f.total ?? 0), 0), locale) }));
        }
        const starts = files.map(f => f.startedAt).filter((value): value is number => value !== undefined);
        const start = options.startedAt ?? (starts.length ? Math.min(...starts) : undefined);
        if (start !== undefined) {
            const end = options.endedAt ?? Math.max(...files.map(f => f.endedAt || start));
            const seconds = Math.max(0, Math.round((end - start) / 1000));
            blocks.push(t(locale, 'transfer.elapsed', { time: `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }));
        }
    }
    return blocks.join('\n\n');
}
