import { Api } from 'telegram';
import { withTelegramOperationDeadline } from './telegramOperationDeadline.js';

/*
 * GramJS 2.26 can strand a client after a failed reconnect: MTProtoSender
 * closes the old socket (`_userConnected = false`), and if every connection
 * attempt fails, `reconnect()` becomes a no-op because it only runs while
 * `_userConnected` is true. The ping loop keeps failing silently, no update
 * is ever delivered again and the Bot looks dead until the process restarts.
 *
 * The watchdog notices a client that once connected but stays disconnected
 * while no reconnect is in progress, then reconnects it through the public
 * `connect()` path and asks Telegram to resume update delivery.
 */

export interface TelegramWatchdogSender {
    isConnected(): boolean;
    reconnect?(): void;
    isConnecting?: boolean;
    isReconnecting?: boolean;
    userDisconnected?: boolean;
}

export interface TelegramWatchdogClient {
    _sender?: TelegramWatchdogSender;
    _destroyed?: boolean;
    _isSwitchingDc?: boolean;
    connect(): Promise<boolean | void>;
    disconnect(): Promise<unknown>;
    destroy(): Promise<unknown>;
    invoke(request: any): Promise<unknown>;
}

export interface TelegramConnectionWatchdogOptions {
    label: string;
    /** How often the connection state is sampled. */
    intervalMs?: number;
    /** Consecutive unhealthy samples tolerated before recovering. */
    graceChecks?: number;
    connectTimeoutMs?: number;
    resumeTimeoutMs?: number;
    log?: Pick<Console, 'warn' | 'log'>;
    setInterval?: (callback: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
    /** Builds the request that makes Telegram resume pushing updates. */
    resumeRequest?: () => unknown;
}

export interface TelegramConnectionWatchdog {
    /** Runs one sample immediately; exposed for tests. */
    check(): Promise<void>;
    stop(): void;
}

const installed = new WeakMap<object, TelegramConnectionWatchdog>();

export function installTelegramConnectionWatchdog(
    client: TelegramWatchdogClient,
    options: TelegramConnectionWatchdogOptions,
): TelegramConnectionWatchdog {
    const existing = installed.get(client);
    if (existing) return existing;

    const intervalMs = options.intervalMs ?? 30_000;
    const graceChecks = Math.max(1, options.graceChecks ?? 2);
    const connectTimeoutMs = options.connectTimeoutMs ?? 120_000;
    const resumeTimeoutMs = options.resumeTimeoutMs ?? 15_000;
    const log = options.log ?? console;
    const schedule = options.setInterval ?? ((callback, ms) => setInterval(callback, ms));
    const cancel = options.clearInterval ?? (handle => clearInterval(handle as ReturnType<typeof setInterval>));
    const resumeRequest = options.resumeRequest ?? (() => new Api.updates.GetState());

    let armed = false;
    let stopped = false;
    let unhealthy = 0;
    let running: Promise<void> | null = null;
    let handle: unknown;

    const stop = () => {
        if (stopped) return;
        stopped = true;
        if (handle !== undefined) cancel(handle);
        handle = undefined;
    };

    // An intentional shutdown must not be undone by the watchdog.
    const disconnect = client.disconnect.bind(client);
    client.disconnect = async () => { stop(); return disconnect(); };
    const destroy = client.destroy.bind(client);
    client.destroy = async () => { stop(); return destroy(); };

    const recover = async (sender: TelegramWatchdogSender) => {
        log.warn(`[TelegramWatchdog] ${options.label}: connection stayed down, reconnecting`);
        if (sender.isConnected() && typeof sender.reconnect === 'function') {
            // Receive loop gave up but the sender still believes it is
            // connected; GramJS' own reconnect path works in this state.
            sender.reconnect();
            return;
        }
        let connected: boolean | void;
        try {
            connected = await withTelegramOperationDeadline(client.connect(), connectTimeoutMs,
                `${options.label} reconnect timed out`);
        } catch (error) {
            log.warn(`[TelegramWatchdog] ${options.label}: reconnect failed, will retry:`, error instanceof Error ? error.message : error);
            return;
        }
        if (connected === false || !client._sender?.isConnected()) {
            log.warn(`[TelegramWatchdog] ${options.label}: reconnect did not succeed, will retry`);
            return;
        }
        unhealthy = 0;
        try {
            await withTelegramOperationDeadline(client.invoke(resumeRequest()), resumeTimeoutMs,
                `${options.label} update resume timed out`);
        } catch (error) {
            log.warn(`[TelegramWatchdog] ${options.label}: reconnected, update resume request failed:`, error instanceof Error ? error.message : error);
            return;
        }
        log.log(`[TelegramWatchdog] ${options.label}: connection restored`);
    };

    const sample = async () => {
        if (stopped) return;
        if (client._destroyed) { stop(); return; }
        const sender = client._sender;
        if (!sender) return;
        const healthy = sender.isConnected() && !sender.userDisconnected;
        if (healthy) {
            armed = true;
            unhealthy = 0;
            return;
        }
        // Never act before the owner finished its first successful connect.
        if (!armed) return;
        if (client._isSwitchingDc || sender.isConnecting || sender.isReconnecting) {
            unhealthy = 0;
            return;
        }
        unhealthy += 1;
        if (unhealthy < graceChecks) return;
        await recover(sender);
    };

    const check = () => {
        if (!running) {
            running = sample()
                .catch(error => log.warn(`[TelegramWatchdog] ${options.label}: check failed:`, error))
                .finally(() => { running = null; });
        }
        return running;
    };

    handle = schedule(() => { void check(); }, intervalMs);
    (handle as { unref?: () => void } | undefined)?.unref?.();

    const watchdog = { check, stop };
    installed.set(client, watchdog);
    return watchdog;
}
