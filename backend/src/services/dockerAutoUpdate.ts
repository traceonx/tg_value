import { getSetting, setSettings } from '../utils/settings.js';

export const DOCKER_AUTO_UPDATE_INTERVALS = [5, 10, 15, 30, 60, 180, 360, 720, 1440] as const;
export const DEFAULT_DOCKER_AUTO_UPDATE_INTERVAL = 5;
const ENABLED_KEY = 'docker_auto_update_enabled';
const INTERVAL_KEY = 'docker_auto_update_interval_minutes';
/** A failed or no-op upgrade is not retried for this long, even if the digest still differs. */
const RETRY_BACKOFF_MS = 60 * 60_000;

export interface DockerAutoUpdateConfig {
    enabled: boolean;
    intervalMinutes: number;
}

export type DockerAutoUpdateResult = 'latest' | 'started' | 'busy' | 'backoff' | 'unavailable' | 'error';

export interface DockerAutoUpdateState extends DockerAutoUpdateConfig {
    available: boolean;
    intervals: readonly number[];
    lastCheckedAt?: string;
    lastResult?: DockerAutoUpdateResult;
    nextCheckAt?: string;
}

export interface DockerAutoUpdateTarget {
    enabled: boolean;
    status(): Promise<{ available: boolean }>;
    start(): Promise<unknown>;
    hasRemoteUpdate(): Promise<boolean>;
    isBusy(): boolean;
    lastJob(): { phase: string; startedAt?: string };
}

export interface DockerAutoUpdateStore {
    load(): Promise<DockerAutoUpdateConfig>;
    save(config: DockerAutoUpdateConfig): Promise<void>;
}

export function normalizeDockerAutoUpdateInterval(value: unknown): number {
    const minutes = Number(value);
    if (!(DOCKER_AUTO_UPDATE_INTERVALS as readonly number[]).includes(minutes)) {
        throw new Error(`Interval must be one of ${DOCKER_AUTO_UPDATE_INTERVALS.join('/')} minutes`);
    }
    return minutes;
}

export const settingsDockerAutoUpdateStore: DockerAutoUpdateStore = {
    async load() {
        const enabled = await getSetting(ENABLED_KEY, 'false');
        const interval = await getSetting(INTERVAL_KEY, String(DEFAULT_DOCKER_AUTO_UPDATE_INTERVAL));
        let intervalMinutes = DEFAULT_DOCKER_AUTO_UPDATE_INTERVAL;
        try { intervalMinutes = normalizeDockerAutoUpdateInterval(interval); } catch { /* keep default */ }
        return { enabled: enabled === 'true', intervalMinutes };
    },
    async save(config) {
        await setSettings([[ENABLED_KEY, String(config.enabled)], [INTERVAL_KEY, String(config.intervalMinutes)]]);
    },
};

export function createDockerAutoUpdater(options: {
    updater: DockerAutoUpdateTarget;
    store?: DockerAutoUpdateStore;
    now?: () => number;
    log?: Pick<Console, 'log' | 'warn'>;
    /** Scheduler resolution; the configured interval is checked on each tick. */
    tickMs?: number;
    monitor?: boolean;
}) {
    const { updater } = options;
    const store = options.store ?? settingsDockerAutoUpdateStore;
    const now = options.now ?? Date.now;
    const log = options.log ?? console;
    let config: DockerAutoUpdateConfig | null = null;
    let lastCheckedAt: number | undefined;
    let lastResult: DockerAutoUpdateResult | undefined;
    let running: Promise<DockerAutoUpdateResult | null> | null = null;

    const getConfig = async () => {
        if (!config) config = await store.load();
        return config;
    };

    const check = async (): Promise<DockerAutoUpdateResult> => {
        if (updater.isBusy()) return 'busy';
        const job = updater.lastJob();
        const startedAt = job.startedAt ? Date.parse(job.startedAt) : NaN;
        if ((job.phase === 'failed' || job.phase === 'unchanged') && now() - startedAt < RETRY_BACKOFF_MS) return 'backoff';
        if (!(await updater.status()).available) return 'unavailable';
        if (!(await updater.hasRemoteUpdate())) return 'latest';
        log.log('[Docker auto update] New image found, starting upgrade');
        await updater.start();
        return 'started';
    };

    /** Runs a check when auto update is enabled and the interval has elapsed. */
    const tick = (): Promise<DockerAutoUpdateResult | null> => {
        if (running) return running;
        running = (async () => {
            if (!updater.enabled) return null;
            const current = await getConfig();
            if (!current.enabled) return null;
            if (lastCheckedAt !== undefined && now() - lastCheckedAt < current.intervalMinutes * 60_000) return null;
            lastCheckedAt = now();
            try {
                lastResult = await check();
            } catch (error) {
                lastResult = 'error';
                log.warn('[Docker auto update] Check failed:', error instanceof Error ? error.message : error);
            }
            return lastResult;
        })().finally(() => { running = null; });
        return running;
    };

    const state = async (): Promise<DockerAutoUpdateState> => {
        const current = await getConfig();
        const available = updater.enabled && (await updater.status()).available;
        const next = current.enabled && lastCheckedAt !== undefined ? lastCheckedAt + current.intervalMinutes * 60_000 : undefined;
        return {
            ...current,
            available,
            intervals: DOCKER_AUTO_UPDATE_INTERVALS,
            lastCheckedAt: lastCheckedAt === undefined ? undefined : new Date(lastCheckedAt).toISOString(),
            lastResult,
            nextCheckAt: next === undefined ? undefined : new Date(next).toISOString(),
        };
    };

    const configure = async (input: { enabled: unknown; intervalMinutes: unknown }): Promise<DockerAutoUpdateState> => {
        if (typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean');
        const next = { enabled: input.enabled, intervalMinutes: normalizeDockerAutoUpdateInterval(input.intervalMinutes) };
        await store.save(next);
        config = next;
        // Check soon after enabling or changing the interval.
        lastCheckedAt = undefined;
        log.log(`[Docker auto update] ${next.enabled ? `enabled, every ${next.intervalMinutes} min` : 'disabled'}`);
        return state();
    };

    const timer = updater.enabled && options.monitor !== false
        ? setInterval(() => { void tick().catch(() => undefined); }, options.tickMs ?? 60_000)
        : undefined;
    timer?.unref();

    return { tick, state, configure, close: () => { if (timer) clearInterval(timer); } };
}
