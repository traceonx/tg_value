import { t, type TelegramLocale } from '../i18n/telegram.js';
import { APP_VERSION } from './appVersion.js';
import { DockerError } from './dockerUpdater.js';

export const TELEGRAM_UPDATE_CALLBACK_PREFIX = 'upd_';
export type TelegramUpdateAction = 'check' | 'apply' | 'confirm' | 'cancel';

export type TelegramUpdateCheck =
    | { kind: 'disabled' }
    | { kind: 'unavailable' }
    | { kind: 'busy' }
    | { kind: 'latest' }
    | { kind: 'available' }
    | { kind: 'error' };

export interface TelegramUpdateView {
    text: string;
    /** Rows of [label, callback data]. */
    buttons: Array<Array<[string, string]>>;
}

export interface TelegramDockerUpdater {
    enabled: boolean;
    status(): Promise<{ enabled: boolean; available: boolean; phase: string }>;
    hasRemoteUpdate(): Promise<boolean>;
    start(): Promise<unknown>;
    isBusy(): boolean;
}

export function parseTelegramUpdateAction(data: string): TelegramUpdateAction | null {
    const action = data.startsWith(TELEGRAM_UPDATE_CALLBACK_PREFIX) ? data.slice(TELEGRAM_UPDATE_CALLBACK_PREFIX.length) : '';
    return (['check', 'apply', 'confirm', 'cancel'] as const).find(value => value === action) ?? null;
}

export async function checkTelegramDockerUpdate(updater: TelegramDockerUpdater): Promise<TelegramUpdateCheck> {
    if (!updater.enabled) return { kind: 'disabled' };
    try {
        const status = await updater.status();
        if (!status.enabled) return { kind: 'disabled' };
        if (updater.isBusy() || status.phase === 'preparing' || status.phase === 'running') return { kind: 'busy' };
        if (!status.available) return { kind: 'unavailable' };
        return { kind: (await updater.hasRemoteUpdate()) ? 'available' : 'latest' };
    } catch (error) {
        console.warn('Telegram update check failed:', error instanceof Error ? error.message : error);
        return { kind: 'error' };
    }
}

const recheck = (locale: TelegramLocale): [string, string] => [t(locale, 'bot.update.recheck'), 'upd_check'];

export function buildTelegramUpdateView(check: TelegramUpdateCheck, locale: TelegramLocale): TelegramUpdateView {
    const header = `${t(locale, 'bot.update.title')}\n${t(locale, 'bot.update.current', { version: APP_VERSION })}\n\n`;
    switch (check.kind) {
        case 'available':
            return { text: header + t(locale, 'bot.update.available'),
                buttons: [[[t(locale, 'bot.update.apply'), 'upd_apply']], [recheck(locale)]] };
        case 'latest':
            return { text: header + t(locale, 'bot.update.latest'), buttons: [[recheck(locale)]] };
        case 'busy':
            return { text: header + t(locale, 'bot.update.busy'), buttons: [[recheck(locale)]] };
        case 'disabled':
            return { text: header + t(locale, 'bot.update.disabled'), buttons: [] };
        case 'unavailable':
            return { text: header + t(locale, 'bot.update.unavailable'), buttons: [[recheck(locale)]] };
        default:
            return { text: header + t(locale, 'bot.update.error'), buttons: [[recheck(locale)]] };
    }
}

export function buildTelegramUpdateConfirmView(locale: TelegramLocale): TelegramUpdateView {
    return {
        text: `${t(locale, 'bot.update.confirmTitle')}\n\n${t(locale, 'bot.update.confirm')}`,
        buttons: [[[t(locale, 'bot.update.confirmButton'), 'upd_confirm'], [t(locale, 'bot.update.cancel'), 'upd_cancel']]],
    };
}

/** Starts the upgrade; returns the view to show in place of the confirmation. */
export async function startTelegramDockerUpdate(updater: TelegramDockerUpdater, locale: TelegramLocale): Promise<{ started: boolean; view: TelegramUpdateView }> {
    // Re-check: the image may have been upgraded or another job started since the prompt.
    const check = await checkTelegramDockerUpdate(updater);
    if (check.kind !== 'available') return { started: false, view: buildTelegramUpdateView(check, locale) };
    try {
        await updater.start();
        return { started: true, view: { text: t(locale, 'bot.update.started'), buttons: [] } };
    } catch (error) {
        const busy = error instanceof DockerError && error.status === 409;
        return { started: false, view: buildTelegramUpdateView({ kind: busy ? 'busy' : 'error' }, locale) };
    }
}

/** Text sent after the service comes back, based on the persisted job phase. */
export function buildTelegramUpdateResultText(phase: string, locale: TelegramLocale): string | null {
    if (phase === 'success') return t(locale, 'bot.update.result.success', { version: APP_VERSION });
    if (phase === 'unchanged') return t(locale, 'bot.update.result.unchanged');
    if (phase === 'failed') return t(locale, 'bot.update.result.failed');
    return null;
}
