import { t, formatBytes, type TelegramLocale, DEFAULT_LOCALE } from '../i18n/telegram.js';

export interface TransferProgressSample {
    downloaded: number;
    total: number;
    bytesPerSecond?: number;
    updatedAt: number;
}

/** Per-file byte samples; resets on a retry and excludes time spent in the queue. */
export class TransferProgressTracker {
    private baseline?: { bytes: number; at: number };
    private lastBytes = 0;
    private lastChangedAt = 0;
    private speed?: number;
    constructor(private now = Date.now) {}
    update(downloaded: number, total: number): TransferProgressSample {
        const now = this.now();
        const bytes = Number.isFinite(downloaded) ? Math.max(0, downloaded) : 0;
        if (!this.baseline || bytes < this.lastBytes) {
            this.baseline = { bytes, at: now };
            this.speed = undefined;
            this.lastChangedAt = now;
        } else if (now - this.baseline.at >= 1000) {
            this.speed = Math.max(0, (bytes - this.baseline.bytes) * 1000 / (now - this.baseline.at));
            this.baseline = { bytes, at: now };
        }
        if (bytes !== this.lastBytes) this.lastChangedAt = now;
        this.lastBytes = bytes;
        return { downloaded: bytes, total: Number.isFinite(total) ? Math.max(0, total) : 0, bytesPerSecond: this.speed, updatedAt: this.lastChangedAt };
    }
}

export function transferProgressLines(downloaded: number, total: number, sample?: TransferProgressSample, locale: TelegramLocale = DEFAULT_LOCALE, now = Date.now()): string[] {
    const bytes = Number.isFinite(downloaded) ? Math.max(0, downloaded) : 0;
    const size = Number.isFinite(total) ? Math.max(0, total) : 0;
    const complete = size > 0 && bytes >= size;
    const stale = sample !== undefined && now - sample.updatedAt >= 15_000;
    const speed = !stale && Number.isFinite(sample?.bytesPerSecond) && sample!.bytesPerSecond! > 0 ? sample!.bytesPerSecond! : undefined;
    const cells = 10;
    const ratio = size > 0 ? Math.min(1, bytes / size) : 0;
    const percentage = complete ? '100' : (Math.floor(ratio * 1000) / 10).toFixed(1).replace(/\.0$/, '');
    const filled = Math.floor(ratio * cells);
    const bar = size > 0
        ? '▰'.repeat(filled) + '▱'.repeat(cells - filled)
        : '▱'.repeat(Math.floor(now / 1000) % cells) + '▰' + '▱'.repeat(cells - 1 - Math.floor(now / 1000) % cells);
    const lines = [
        `📊 ${bar} ${size > 0 ? `${percentage}%` : t(locale, 'progress.unknownSize')}`,
        `💾 ${formatBytes(size > 0 ? Math.min(bytes, size) : bytes, locale)} / ${size > 0 ? formatBytes(size, locale) : '—'}`,
    ];
    if (complete) return [...lines, t(locale, 'progress.saving')];
    const etaSeconds = speed && size > bytes ? Math.ceil((size - bytes) / speed) : undefined;
    const eta = etaSeconds === undefined ? '—' : `${String(Math.floor(etaSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(etaSeconds / 60) % 60).padStart(2, '0')}:${String(etaSeconds % 60).padStart(2, '0')}`;
    lines.push(t(locale, 'progress.speed', { speed: speed ? `${formatBytes(speed, locale)}/s` : t(locale, 'progress.calculating') }));
    lines.push(t(locale, 'progress.eta', { eta: etaSeconds === undefined ? t(locale, 'progress.calculating') : eta }));
    if (stale) lines.push(`🕓 ${t(locale, 'progress.waitingData')}`);
    return lines;
}
