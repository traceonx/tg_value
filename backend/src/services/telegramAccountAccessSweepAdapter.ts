import { query } from '../db/index.js';
import { telegramAccountRepository } from './telegramAccountRepository.js';
import {
    configureTelegramAccountAccessSweep,
    type TelegramAccessClient,
    type TelegramAccountAccessSweepDependencies,
    type TelegramAccountSourceAccessResult,
} from './telegramAccountAccessSweep.js';

interface SweepAccountRepository {
    listEnabledAccounts(): Promise<ReadonlyArray<{ id: string; enabled: boolean }>>;
    markSourceAccess(
        accountId: string,
        sourceKey: string,
        scope: 'download' | 'scan' | 'metadata',
        accessState: 'unknown' | 'allowed' | 'denied',
        error?: string | null,
    ): Promise<unknown>;
}

interface SweepAccountClientPool {
    getAccountClient(accountId: string): TelegramAccessClient | null;
    acquireAccount?(accountId: string): { client: TelegramAccessClient; release(): void } | null;
}

interface SweepQueryResult {
    rows: Array<{ id: unknown; source: unknown; enabled: unknown }>;
}

export interface TelegramAccountAccessSweepAdapterOptions {
    repository?: SweepAccountRepository;
    clientPool: SweepAccountClientPool;
    querySubscriptions?: (text: string, params?: readonly unknown[]) => Promise<SweepQueryResult>;
    now?: () => Date;
    onAccountError?(accountId: string, error: unknown): Promise<void>;
}

/**
 * Bridges the pure sweep to the current repository/pool. The existing access
 * schema calls channel reads `scan`; the public
 * sweep API keeps the more explicit channel vocabulary.
 */
export function createTelegramAccountAccessSweepDependencies(
    options: TelegramAccountAccessSweepAdapterOptions,
): TelegramAccountAccessSweepDependencies {
    const repository = options.repository || telegramAccountRepository;
    const querySubscriptions = options.querySubscriptions || query;
    return {
        async listTelegramAccounts() {
            const accounts = await repository.listEnabledAccounts();
            return accounts.map(account => ({ accountId: account.id, enabled: account.enabled }));
        },
        async listTelegramChannelSubscriptions() {
            const result = await querySubscriptions(
                `SELECT id, source, enabled
                 FROM telegram_channel_subscriptions
                 WHERE enabled = TRUE
                 ORDER BY created_at, id`,
            );
            return result.rows.map(row => ({
                sourceId: String(row.id),
                source: String(row.source),
                enabled: Boolean(row.enabled),
                scopes: ['channel'] as const,
            }));
        },
        async getTelegramAccountRuntime(accountId) {
            if (options.clientPool.acquireAccount) return options.clientPool.acquireAccount(accountId);
            const client = options.clientPool.getAccountClient(accountId);
            return client ? { client } : null;
        },
        async markTelegramAccountSourceAccess(result: TelegramAccountSourceAccessResult) {
            const state = result.state === 'error' ? 'unknown' : result.state;
            const error = result.errorCode || result.errorMessage || null;
            await repository.markSourceAccess(result.accountId, result.source, 'scan', state, error);
            await repository.markSourceAccess(result.accountId, result.source, 'download', state, error);
        },
        now: options.now,
        onAccountError: options.onAccountError,
    };
}

/** Register the production adapters once the multi-account client pool exists. */
export function installTelegramAccountAccessSweep(
    options: TelegramAccountAccessSweepAdapterOptions,
): TelegramAccountAccessSweepDependencies {
    const dependencies = createTelegramAccountAccessSweepDependencies(options);
    configureTelegramAccountAccessSweep(dependencies);
    return dependencies;
}
