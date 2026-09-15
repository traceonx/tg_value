import type {
    TelegramAccountRepository,
    TelegramAccountSourceAccessRecord,
    TelegramAccountSourceScope,
    TelegramUserAccountRecord,
} from './telegramAccountRepository.js';
import { telegramAccountRepository } from './telegramAccountRepository.js';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { installTelegramRequestGate } from './telegramRequestGate.js';
import { decryptCredential } from '../utils/credentialCrypto.js';
import { getTelegramProxy } from './telegramProxy.js';
import { telegramAccountStopReason } from './telegramAccountSafety.js';
import {
    selectWeightedLeastConnectedTelegramAccount,
    type TelegramAccountSchedulingOptions,
    type TelegramSourceAccessState,
} from './telegramAccountScheduler.js';

export interface TelegramPoolCredentials {
    apiId: number;
    apiHash: string;
}

export interface TelegramPooledClient {
    connected?: boolean;
    connect(): Promise<unknown>;
    checkAuthorization(): Promise<boolean>;
    getMe(): Promise<unknown>;
    disconnect(): Promise<unknown>;
    destroy(): Promise<unknown>;
}

interface PoolRepository extends Pick<TelegramAccountRepository,
    | 'migrateLegacySystemSettings'
    | 'listEnabledAccounts'
    | 'getAccount'
    | 'listSourceAccess'
    | 'updateSession'
    | 'recordHealthy'
    | 'recordFailure'
    | 'markSessionExpired'> {}

interface PoolEntry<C extends TelegramPooledClient> {
    account: TelegramUserAccountRecord;
    client: C;
    activeConnections: number;
}

export interface SelectedTelegramDownloadAccount<C extends TelegramPooledClient = TelegramPooledClient> {
    accountId: string;
    client: C;
    release(): void;
}

export interface TelegramAccountSelectionOptions extends TelegramAccountSchedulingOptions {
    scope?: TelegramAccountSourceScope;
}

export type PublicTelegramUserAccount = Omit<TelegramUserAccountRecord, 'session'> & {
    connected: boolean;
    activeConnections: number;
};

function errorName(error: unknown): string {
    const value = error as { errorMessage?: unknown; message?: unknown } | null;
    return String(value?.errorMessage || value?.message || error || 'Telegram account connection failed');
}

export function isTelegramSessionExpiredError(error: unknown): boolean {
    return telegramAccountStopReason(error)?.kind === 'expired';
}

export type TelegramUserActivationReason = 'login_complete' | 'explicit_enable';

export class TelegramUserClientPool<C extends TelegramPooledClient = TelegramPooledClient> {
    private readonly entries = new Map<string, PoolEntry<C>>();
    private credentials: TelegramPoolCredentials | null = null;
    private initializationTail: Promise<void> = Promise.resolve();

    constructor(private readonly deps: {
        repository: PoolRepository;
        decryptSession(value: string): string;
        createClient(session: string, credentials: TelegramPoolCredentials, accountId: string): C;
        saveSession?(client: C): string;
    }) {}

    async initialize(credentials: TelegramPoolCredentials): Promise<void> {
        const run = this.initializationTail.then(async () => {
            await this.shutdownEntries();
            this.credentials = credentials;
            await this.deps.repository.migrateLegacySystemSettings();
            const accounts = await this.deps.repository.listEnabledAccounts();
            await Promise.allSettled(accounts.map(account => this.connectAccount(account)));
        });
        this.initializationTail = run.catch(() => undefined);
        await run;
    }

    async refresh(): Promise<void> {
        if (!this.credentials) return;
        await this.initialize(this.credentials);
    }

    async deactivateAccount(accountId: string): Promise<void> {
        await this.runLifecycleOperation(() => this.expireEntry(accountId));
    }

    async activateAccount(
        accountId: string,
        reason: TelegramUserActivationReason,
        credentials?: TelegramPoolCredentials,
    ): Promise<void> {
        if (reason !== 'login_complete' && reason !== 'explicit_enable') throw new Error('TELEGRAM_USER_ACTIVATION_NOT_ALLOWED');
        await this.runLifecycleOperation(async () => {
            // A newly persisted session must never coexist with an older runtime
            // for the same Telegram identity. Close the old client before trying
            // the replacement so a failed reconnect cannot leave it orphaned.
            await this.expireEntry(accountId);
            if (credentials) this.credentials = credentials;
            if (!this.credentials) return;
            const account = await this.deps.repository.getAccount(accountId);
            if (!account) return;
            await this.connectAccount(account);
        });
    }

    private async connectAccount(account: TelegramUserAccountRecord): Promise<void> {
        // Older releases synthesized this exact error from the lossy boolean
        // authorization probe. Revalidate the saved session, never reset it.
        const legacyUnverifiedExpiry = account.lastError === 'SESSION_EXPIRED';
        if (!this.credentials || !account.enabled || (account.healthState === 'session_expired' && !legacyUnverifiedExpiry)) return;
        // A restart or explicit enable must not bypass a server-mandated wait.
        if (account.cooldownUntil && new Date(account.cooldownUntil).getTime() > Date.now()) return;
        let client: C | null = null;
        try {
            const session = this.deps.decryptSession(account.session);
            client = this.deps.createClient(session, this.credentials, account.id);
            await client.connect();
            // GramJS checkAuthorization converts every RPC/network error to false.
            // getMe preserves the real error so a restart during an outage cannot
            // permanently disable an otherwise valid persisted authorization.
            await client.getMe();
            const saved = this.deps.saveSession?.(client) || session;
            if (saved && saved !== session) await this.deps.repository.updateSession(account.id, saved);
            await this.deps.repository.recordHealthy(account.id);
            this.entries.set(account.id, {
                account: { ...account, healthState: 'healthy', lastError: null },
                client,
                activeConnections: 0,
            });
        } catch (error) {
            if (client) await this.closeClient(client);
            const message = errorName(error);
            if (isTelegramSessionExpiredError(error)) await this.deps.repository.markSessionExpired(account.id, message);
            else await this.deps.repository.recordFailure(account.id, message);
        }
    }

    async select(sourceKey: string, options: TelegramAccountSelectionOptions = {}): Promise<SelectedTelegramDownloadAccount<C> | null> {
        const scope = options.scope || 'download';
        const access = await this.deps.repository.listSourceAccess(sourceKey, scope);
        const accessByAccount = new Map<string, TelegramAccountSourceAccessRecord>(access.map(row => [row.accountId, row]));
        const selected = selectWeightedLeastConnectedTelegramAccount([...this.entries.values()].map(entry => ({
            accountId: entry.account.id,
            enabled: this.isRunnable(entry),
            healthState: entry.account.healthState,
            cooldownUntil: entry.account.cooldownUntil,
            weight: entry.account.weight,
            priority: entry.account.priority,
            activeConnections: entry.activeConnections,
            maxConnections: entry.account.maxConnections,
            sourceAccessState: accessByAccount.get(entry.account.id)?.accessState || 'unknown',
        })), options);
        if (!selected) return null;
        const entry = this.entries.get(selected.accountId);
        if (!entry) return null;
        entry.activeConnections += 1;
        let released = false;
        return {
            accountId: entry.account.id,
            client: entry.client,
            release: () => {
                if (released) return;
                released = true;
                entry.activeConnections = Math.max(0, entry.activeConnections - 1);
            },
        };
    }

    getDefaultClient(): C | null {
        return [...this.entries.values()]
            .filter(entry => this.isRunnable(entry))
            .sort((left, right) => right.account.priority - left.account.priority || left.account.id.localeCompare(right.account.id))[0]?.client || null;
    }

    getAccountClient(accountId: string): C | null {
        const entry = this.entries.get(accountId);
        return entry && this.isRunnable(entry) ? entry.client : null;
    }

    acquireAccount(accountId: string): SelectedTelegramDownloadAccount<C> | null {
        const entry = this.entries.get(accountId);
        if (!entry || !this.isRunnable(entry) || entry.activeConnections >= entry.account.maxConnections) return null;
        entry.activeConnections += 1;
        let released = false;
        return { accountId, client: entry.client, release: () => {
            if (released) return;
            released = true;
            entry.activeConnections = Math.max(0, entry.activeConnections - 1);
        } };
    }

    private isRunnable(entry: PoolEntry<C>): boolean {
        return entry.account.enabled && entry.account.healthState !== 'session_expired'
            && entry.client.connected !== false
            && (!entry.account.cooldownUntil || new Date(entry.account.cooldownUntil).getTime() <= Date.now());
    }

    getActiveConnections(accountId: string): number {
        return this.entries.get(accountId)?.activeConnections || 0;
    }

    getReadyAccountIds(): string[] {
        return [...this.entries.keys()];
    }

    getRuntimeState(): Array<{ accountId: string; connected: boolean; activeConnections: number }> {
        return [...this.entries.values()].map(entry => ({
            accountId: entry.account.id,
            connected: Boolean(entry.client.connected),
            activeConnections: entry.activeConnections,
        }));
    }

    updateCooldown(accountId: string, cooldownUntil: Date, error: string | null): void {
        const entry = this.entries.get(accountId);
        if (entry?.account.healthState === 'session_expired') return;
        if (entry) entry.account = { ...entry.account,
            cooldownUntil: new Date(Math.max(new Date(entry.account.cooldownUntil || 0).getTime(), cooldownUntil.getTime())),
            healthState: 'degraded', lastError: error };
    }

    markExpired(accountId: string): void {
        const entry = this.entries.get(accountId);
        if (entry) entry.account = { ...entry.account, healthState: 'session_expired' };
    }

    updateSourceAccess(_accountId: string, _sourceKey: string, _scope: TelegramAccountSourceScope, _state: TelegramSourceAccessState): void {
        // Source access is read through the repository for each selection, so no stale in-memory cache needs invalidation.
    }

    async expireAccount(accountId: string): Promise<void> {
        await this.runLifecycleOperation(() => this.expireEntry(accountId));
    }

    private async expireEntry(accountId: string): Promise<void> {
        const entry = this.entries.get(accountId);
        this.entries.delete(accountId);
        if (entry) await this.closeClient(entry.client);
    }

    async shutdown(): Promise<void> {
        await this.runLifecycleOperation(() => this.shutdownEntries());
    }

    private async shutdownEntries(): Promise<void> {
        const entries = [...this.entries.values()];
        this.entries.clear();
        await Promise.all(entries.map(entry => this.closeClient(entry.client)));
    }

    private async runLifecycleOperation<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.initializationTail.then(operation);
        this.initializationTail = run.then(() => undefined, () => undefined);
        return await run;
    }

    private async closeClient(client: C): Promise<void> {
        try { await client.disconnect(); } catch { /* best effort */ }
        try { await client.destroy(); } catch { /* best effort */ }
    }
}

export const telegramUserClientPool = new TelegramUserClientPool<TelegramClient>({
    repository: telegramAccountRepository,
    decryptSession: decryptCredential,
    createClient: (session, credentials, accountId) => {
        const client = new TelegramClient(
        new StringSession(session), credentials.apiId, credentials.apiHash, {
            proxy: getTelegramProxy(),
            connectionRetries: 15, retryDelay: 2000, useWSS: false,
            deviceModel: 'TG Vault User Downloader', systemVersion: '1.0.0', appVersion: '1.0.0', floodSleepThreshold: 0,
        },
        );
        installTelegramRequestGate(client, undefined, async error => {
            const reason = telegramAccountStopReason(error);
            if (!reason) return;
            const message = error instanceof Error ? error.message : String(error);
            if (reason.kind === 'cooldown') {
                telegramUserClientPool.updateCooldown(accountId, new Date(Date.now() + reason.seconds * 1000), message);
                await telegramAccountRepository.markCooldown(accountId, reason.seconds, message);
            } else {
                telegramUserClientPool.markExpired(accountId);
                await telegramAccountRepository.markSessionExpired(accountId, message);
            }
        });
        return client;
    },
    saveSession: client => client.session.save() as unknown as string,
});

let currentCredentials: TelegramPoolCredentials | null = null;

export async function initializeTelegramUserClientPool(credentials: TelegramPoolCredentials): Promise<void> {
    currentCredentials = credentials;
    await telegramUserClientPool.initialize(credentials);
}

export async function shutdownTelegramUserClientPool(): Promise<void> { await telegramUserClientPool.shutdown(); }
export function getTelegramUserClientPoolState() { return telegramUserClientPool.getRuntimeState(); }
export async function reloadTelegramUserClientPool(): Promise<void> {
    if (currentCredentials) await telegramUserClientPool.initialize(currentCredentials);
}

export async function listTelegramUserAccounts(): Promise<PublicTelegramUserAccount[]> {
    const accounts = await telegramAccountRepository.listAccounts();
    const ready = new Set(telegramUserClientPool.getReadyAccountIds());
    return accounts.map(({ session: _session, ...account }) => ({
        ...account, connected: ready.has(account.id), activeConnections: telegramUserClientPool.getActiveConnections(account.id),
    }));
}

export async function selectTelegramDownloadAccount(sourceKey: string, options: TelegramAccountSelectionOptions = {}) {
    return telegramUserClientPool.select(sourceKey, options);
}

export async function markTelegramAccountCooldown(accountId: string, seconds: number, error: string | null = null): Promise<boolean> {
    const changed = await telegramAccountRepository.markCooldown(accountId, seconds, error);
    if (changed) telegramUserClientPool.updateCooldown(accountId, new Date(Date.now() + Math.max(1, seconds) * 1000), error);
    return changed;
}

export async function markTelegramAccountSourceAccess(
    accountId: string, sourceKey: string, scope: TelegramAccountSourceScope,
    state: TelegramSourceAccessState, error: string | null = null,
): Promise<TelegramAccountSourceAccessRecord> {
    return telegramAccountRepository.markSourceAccess(accountId, sourceKey, scope, state, error);
}

export async function markTelegramAccountSessionExpired(accountId: string, error: string | null = null): Promise<boolean> {
    const changed = await telegramAccountRepository.markSessionExpired(accountId, error);
    if (changed) await telegramUserClientPool.expireAccount(accountId);
    return changed;
}

export async function upsertTelegramUserAccount(input: Parameters<TelegramAccountRepository['upsertAccount']>[0]): Promise<PublicTelegramUserAccount> {
    const account = await telegramAccountRepository.upsertAccount(input);
    await reloadTelegramUserClientPool();
    const { session: _session, ...publicAccount } = account;
    return { ...publicAccount, connected: telegramUserClientPool.getReadyAccountIds().includes(account.id), activeConnections: 0 };
}

export async function upsertTelegramUserAccountWithoutRuntimeRefresh(
    input: Parameters<TelegramAccountRepository['upsertAccount']>[0],
): Promise<PublicTelegramUserAccount> {
    const account = await telegramAccountRepository.upsertAccount(input);
    const { session: _session, ...publicAccount } = account;
    return {
        ...publicAccount,
        connected: telegramUserClientPool.getReadyAccountIds().includes(account.id),
        activeConnections: telegramUserClientPool.getActiveConnections(account.id),
    };
}

export async function setTelegramUserAccountEnabled(accountId: string, enabled: boolean): Promise<boolean> {
    const changed = await telegramAccountRepository.setEnabled(accountId, enabled);
    if (changed) await reloadTelegramUserClientPool();
    return changed;
}

export async function deleteTelegramUserAccount(accountId: string): Promise<boolean> {
    await telegramUserClientPool.expireAccount(accountId);
    return telegramAccountRepository.deleteAccount(accountId);
}

export const getTelegramAccountSourceAccess = telegramAccountRepository.getSourceAccess.bind(telegramAccountRepository);
export const listTelegramAccountSourceAccess = telegramAccountRepository.listSourceAccess.bind(telegramAccountRepository);
export const probeTelegramAccountSourceAccess = telegramAccountRepository.probeSourceAccess.bind(telegramAccountRepository);
export const startTelegramDownloadAttempt = telegramAccountRepository.startDownloadAttempt.bind(telegramAccountRepository);
export const finishTelegramDownloadAttempt = telegramAccountRepository.finishDownloadAttempt.bind(telegramAccountRepository);
