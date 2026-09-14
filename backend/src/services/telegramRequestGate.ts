import type { TelegramClient } from 'telegram';
import { telegramAccountStopReason } from './telegramAccountSafety.js';

export class TelegramRequestGate {
    private until = 0;
    private expired = false;
    private next = 0;
    private admission = Promise.resolve();

    constructor(private readonly interval = 500, private readonly now = Date.now,
        private readonly sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

    deferUntil(until: number): void {
        if (Number.isFinite(until)) this.until = Math.max(this.until, until);
    }

    stop(error: unknown): boolean {
        const reason = telegramAccountStopReason(error);
        if (!reason) return false;
        if (reason.kind === 'expired') this.expired = true;
        else this.until = Math.max(this.until, this.now() + reason.seconds * 1000);
        return true;
    }

    check(): void {
        if (this.expired) throw Object.assign(new Error('Telegram authorization expired'), { errorMessage: 'SESSION_EXPIRED' });
        if (this.until > this.now()) {
            const seconds = Math.ceil((this.until - this.now()) / 1000);
            throw Object.assign(new Error(`Telegram FLOOD_WAIT_${seconds}`), { errorMessage: 'FLOOD_WAIT', seconds });
        }
    }

    async run<T>(operation: () => Promise<T>, paced = true): Promise<T> {
        this.check();
        if (paced) {
            const admitted = this.admission.then(async () => {
                this.check();
                const delay = this.next - this.now();
                if (delay > 0) await this.sleep(delay);
                this.check();
                this.next = this.now() + this.interval;
            });
            this.admission = admitted.catch(() => undefined);
            await admitted;
        }
        this.check();
        // Release admission before invoking: GramJS may resolve entities through nested invoke calls.
        try { return await operation(); }
        catch (error) { this.stop(error); throw error; }
    }
}

const installed = new WeakMap<object, TelegramRequestGate>();
export function canTelegramRequest(client: object | undefined): boolean {
    try { if (client) installed.get(client)?.check(); return true; }
    catch { return false; }
}
export function installTelegramRequestGate(client: TelegramClient, gate = new TelegramRequestGate(),
    onStop?: (error: unknown) => Promise<void>, options: { freshSession?: boolean } = {}): TelegramRequestGate {
    const existing = installed.get(client);
    if (existing) return existing;
    const invoke = client.invoke.bind(client);
    let freshSession = options.freshSession === true;
    client.floodSleepThreshold = 0;
    client.invoke = (async (...args: Parameters<TelegramClient['invoke']>) => {
        const request = args[0];
        const initialProbe = freshSession && request.className === 'updates.GetState';
        if (initialProbe) freshSession = false;
        let unauthenticated: unknown;
        const result = await gate.run(async () => {
            try { return await invoke(...args); }
            catch (error) {
                // GramJS start() expects this response from an empty Session, then signs in.
                const value = error as { errorMessage?: string; message?: string };
                if (initialProbe && /\bAUTH_KEY_UNREGISTERED\b/.test(value?.errorMessage || value?.message || '')) {
                    unauthenticated = error;
                    return undefined;
                }
                if (gate.stop(error)) await onStop?.(error).catch(() => undefined);
                throw error;
            }
        }, !/^upload\./.test(request.className));
        if (unauthenticated) throw unauthenticated;
        const resultType = (result as { className?: string } | undefined)?.className;
        if (resultType === 'auth.Authorization' || resultType === 'auth.LoginTokenSuccess') freshSession = false;
        return result;
    }) as TelegramClient['invoke'];
    const invokeWithSender = client.invokeWithSender.bind(client);
    client.invokeWithSender = (async (...args: Parameters<TelegramClient['invokeWithSender']>) =>
        gate.run(async () => {
            try { return await invokeWithSender(...args); }
            catch (error) {
                if (gate.stop(error)) await onStop?.(error).catch(() => undefined);
                throw error;
            }
        }, !/^upload\./.test(args[0].className))) as TelegramClient['invokeWithSender'];
    installed.set(client, gate);
    return gate;
}
