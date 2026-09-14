const DAY_MS = 24 * 60 * 60 * 1000;
export const TELEGRAM_DATE_RANGE_WARNING_DAYS = Math.max(
    1,
    Number.parseInt(process.env.TELEGRAM_DATE_RANGE_WARNING_DAYS || '31', 10) || 31,
);

export interface TelegramDateRange {
    startDate: Date;
    endDate: Date;
    dayCount: number;
    requiresLargeRangeConfirmation: boolean;
}

export function parseDateOnlyStrict(value: string, endOfDay = false): Date {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new Error('日期格式必须是 YYYY-MM-DD');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(
        year,
        month - 1,
        day,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
    ));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new Error('请输入有效日期（YYYY-MM-DD）');
    }
    return date;
}

export function parseTelegramDateRange(
    startDateText: string,
    endDateText: string,
    options: { warningThresholdDays?: number } = {},
): TelegramDateRange {
    const startDate = parseDateOnlyStrict(startDateText);
    const endDate = parseDateOnlyStrict(endDateText, true);
    if (startDate > endDate) throw new Error('开始日期不能晚于结束日期');
    const endStartOfDay = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate());
    const dayCount = Math.floor((endStartOfDay - startDate.getTime()) / DAY_MS) + 1;
    if (dayCount < 1) throw new Error('日期范围不能为空');
    const threshold = options.warningThresholdDays ?? TELEGRAM_DATE_RANGE_WARNING_DAYS;
    return {
        startDate,
        endDate,
        dayCount,
        requiresLargeRangeConfirmation: dayCount > threshold,
    };
}
/** Telegram history offsets are exclusive, so include the final second of the selected day. */
export function telegramHistoryOffset(endDateIso: string, offsetId: number): { offsetDate?: number } {
    if (offsetId !== 0) return {};
    const end = new Date(endDateIso).getTime();
    if (!Number.isFinite(end)) throw new Error('无效的下载结束日期');
    return { offsetDate: Math.floor(end / 1000) + 1 };
}
